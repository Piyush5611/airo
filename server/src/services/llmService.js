import { ApiError } from '../utils/errors.js';
import { decryptJson, encryptJson } from '../utils/cryptoBox.js';
import { reportFacts, reportRequest } from './whatsappReport.js';
import { whatsappReportCard } from './whatsappCards.js';
import { recordAudit } from './auditService.js';
import { listLlmModels, llmProviderName, replyLlm, verifyLlm, WHATSAPP_BRIEF } from '../integrations/llm.js';
import { LLM_PURPOSES, purposeLabel } from '../domain/llmPurposes.js';
import { many, one } from '../db/sql.js';
import { modelJson } from '../utils/modelJson.js';
import { adsAdviceReply } from './adsAgent/monitorService.js';
import * as whatsappRepo from '../repositories/whatsappRepo.js';
import * as repo from '../repositories/llmRepo.js';
import * as offeringRepo from '../repositories/offeringRepo.js';
import { organizationSector } from '../repositories/workspaceRepo.js';
import { sectorOf } from '../domain/sectors.js';

function preview(apiKey) {
  const value = String(apiKey || '');
  return value ? `••••${value.slice(-4)}` : '';
}

function publicRow(row) {
  return {
    id: row.id,
    purpose: row.purpose,
    purposeLabel: purposeLabel(row.purpose),
    provider: row.provider,
    providerName: llmProviderName(row.provider),
    model: row.modelName,
    baseUrl: row.baseUrl || '',
    keyPreview: row.keyPreview || '',
    connectedAt: row.connectedAt,
    connected: true
  };
}

function schemaMissing(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR';
}

export async function llmStatus() {
  try {
    const rows = await repo.connections();
    return {
      models: rows.filter((row) => row.credentialCiphertext).map(publicRow),
      purposes: LLM_PURPOSES,
      note: ''
    };
  } catch (error) {
    if (schemaMissing(error)) {
      return { models: [], purposes: LLM_PURPOSES, note: 'Run migrate before connecting a model.' };
    }
    throw error;
  }
}

async function readKey(row) {
  let secret;
  try { secret = decryptJson(row.credentialCiphertext); } catch {
    throw new ApiError(422, 'Connect the model again. The saved key could not be read.', 'validation_error');
  }
  if (!secret?.apiKey) throw new ApiError(422, 'Enter the API key to load models.', 'validation_error');
  return secret.apiKey;
}

async function keyFor(req) {
  const typed = String(req.body.apiKey || '').trim();
  if (typed) return { apiKey: typed, baseUrl: req.body.baseUrl };
  const row = await repo.connectionForProvider(req.body.provider);
  if (!row?.credentialCiphertext) throw new ApiError(422, 'Enter the API key to load models.', 'validation_error');
  return { apiKey: await readKey(row), baseUrl: req.body.baseUrl || row.baseUrl || '' };
}

export async function llmModels(req) {
  const { apiKey, baseUrl } = await keyFor(req);
  const listed = await listLlmModels({ provider: req.body.provider, apiKey, baseUrl });
  return { models: listed.models };
}

export async function connectLlm(req) {
  const purpose = req.body.purpose;
  const provider = req.body.provider;
  const model = req.body.model.trim();
  if (!purposeLabel(purpose) || !LLM_PURPOSES.some((row) => row.key === purpose)) {
    throw new ApiError(422, 'Choose a purpose.', 'validation_error');
  }
  const { apiKey, baseUrl } = await keyFor(req);
  const checked = await verifyLlm({
    provider,
    model,
    apiKey,
    baseUrl,
    manual: req.body.manual === true
  });
  await repo.saveConnection({
    purpose,
    provider,
    modelName: model,
    baseUrl: checked.baseUrl || baseUrl || '',
    ciphertext: encryptJson({ apiKey }),
    keyPreview: preview(apiKey),
    note: `${llmProviderName(provider)} accepted this key for ${purposeLabel(purpose)}.`
  });
  const saved = await repo.connections();
  const row = saved.find((item) => item.purpose === purpose);
  await recordAudit(req, {
    action: 'llm.connected',
    resource: 'llm_connection',
    resourceId: row?.id || null,
    organizationId: null,
    metadata: { purpose, provider, model }
  });
  return llmStatus();
}

async function assistantFacts(auth) {
  const lines = [];
  const platform = auth?.realm === 'platform';
  const perms = auth?.permissions || [];
  const canConnect = !platform && (perms.includes('*') || perms.includes('connections.manage'));
  lines.push(platform
    ? 'This person is a platform user and is already signed in.'
    : `This person is already signed in to their workspace as ${auth?.role || 'a member'}. ${canConnect ? 'They can press Connect API.' : 'They cannot press Connect API. An Owner or Admin must save the key.'}`);
  try {
    const models = await repo.connections();
    const purposes = platform ? LLM_PURPOSES : LLM_PURPOSES.filter((item) => item.key === 'assistant');
    for (const purpose of purposes) {
      const row = models.find((item) => item.purpose === purpose.key && item.credentialCiphertext);
      lines.push(row
        ? `${purpose.label}: connected, ${llmProviderName(row.provider)} ${row.modelName}`
        : `${purpose.label}: not connected`);
    }
  } catch {
    lines.push('AI models: status could not be read');
  }
  try {
    const bot = await whatsappRepo.bot();
    const connected = bot?.status === 'connected' && Boolean(bot.credentialCiphertext);
    const label = platform && connected && bot.phoneLabel && bot.phoneLabel !== 'Not connected' ? `, number ${bot.phoneLabel}` : '';
    lines.push(connected ? `WhatsApp chatbot: connected${label}` : 'WhatsApp chatbot: not connected');
  } catch {
    lines.push('WhatsApp chatbot: status could not be read');
  }
  try {
    const orgId = auth?.realm === 'client' ? auth.organizationId : null;
    const links = await many(
      `SELECT o.name AS organizationName, p.name AS providerName, c.status, c.mode,
              CASE WHEN cred.ciphertext IS NULL OR cred.ciphertext = '' THEN 0 ELSE 1 END AS hasSecret
       FROM integration_connections c
       JOIN organizations o ON o.id = c.organization_id
       JOIN integration_providers p ON p.id = c.provider_id
       LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
       ${orgId ? 'WHERE c.organization_id = ?' : ''}
       ORDER BY o.name, p.name`,
      orgId ? [orgId] : []
    );
    if (!links.length) lines.push('Business connections: none saved');
    for (const row of links) {
      const on = row.status === 'connected' && row.mode === 'live' && Number(row.hasSecret) === 1;
      lines.push(`${row.organizationName} · ${row.providerName}: ${on ? 'connected' : 'not connected'}`);
    }
  } catch {
    lines.push('Business connections: status could not be read');
  }
  return lines.join('\n');
}

export async function assistantPublic() {
  try {
    const row = await repo.connectionByPurpose('assistant');
    if (!row?.credentialCiphertext) return { connected: false, providerName: '', model: '' };
    return { connected: true, providerName: llmProviderName(row.provider), model: row.modelName };
  } catch (error) {
    if (schemaMissing(error)) return { connected: false, providerName: '', model: '', note: 'Run migrate before using the assistant.' };
    throw error;
  }
}

function withoutPermissionNote(reply) {
  const kept = String(reply || '')
    .split(/\n+/)
    .filter((line) => !/option nahi dikh|cannot press connect api|owner ya admin|owner or admin/i.test(line))
    .join('\n')
    .trim();
  return kept || reply;
}

function wantsReport(messages) {
  return Boolean(reportRequest(messages));
}

export function catalogFacts(items) {
  if (!items.length) return 'Saved products/projects/services: none saved yet. They can be added in AIRO under Offerings.';
  const clip = (value, size) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, size);
  return [
    `Saved products/projects/services (${items.length}, from the AIRO Offerings page):`,
    ...items.map((item, index) => {
      const parts = [
        item.kind ? `type ${clip(item.kind, 30)}` : '',
        item.locations ? `location ${clip(item.locations, 80)}` : '',
        item.priceText ? `price ${clip(item.priceText, 60)}` : '',
        item.offer ? `offer ${clip(item.offer, 80)}` : '',
        item.usps ? `highlights ${clip(item.usps, 120)}` : '',
        item.details ? `details ${clip(item.details, 160)}` : '',
        item.website ? `website ${clip(item.website, 100)}` : ''
      ].filter(Boolean);
      return `${index + 1}. ${clip(item.name, 80)}${parts.length ? ` - ${parts.join('; ')}` : ''}`;
    })
  ].join('\n');
}

async function whatsappFacts({ organizationId, recognized, businessLabel, messages }) {
  if (!recognized || !organizationId) {
    return 'This WhatsApp number is not registered to a business in AIRO. Do not name a business or share connection status.';
  }
  const lines = [];
  const org = await one(
    `SELECT name FROM organizations WHERE id = ?`,
    [organizationId]
  ).catch(() => null);
  const name = org?.name || 'this business';
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  lines.push(`Current date and time: ${now} IST. Use this for "today"; never guess another date.`);
  lines.push(businessLabel
    ? `This WhatsApp number is registered to ${name} (${businessLabel}).`
    : `This WhatsApp number is registered to ${name}.`);
  const sector = sectorOf(await organizationSector(organizationId));
  if (sector) lines.push(`Business sector (set by the owner): ${sector.label}. Ad goals that fit this sector, most common first: ${sector.goals.map((goal) => goal.key).join(', ')}. The goal is chosen per campaign.`);
  try {
    const links = await many(
      `SELECT p.name AS providerName, c.status, c.mode,
              CASE WHEN cred.ciphertext IS NULL OR cred.ciphertext = '' THEN 0 ELSE 1 END AS hasSecret
       FROM integration_connections c
       JOIN integration_providers p ON p.id = c.provider_id
       LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
       WHERE c.organization_id = ?
       ORDER BY p.name`,
      [organizationId]
    );
    if (!links.length) lines.push('Connections: none saved');
    for (const row of links) {
      const on = row.status === 'connected' && row.mode === 'live' && Number(row.hasSecret) === 1;
      lines.push(`${row.providerName}: ${on ? 'connected' : 'not connected'}`);
    }
  } catch {
    lines.push('Connections: status could not be read');
  }
  try {
    lines.push(catalogFacts(await offeringRepo.list(organizationId, { limit: 40 })));
  } catch {
    lines.push('Saved products/projects/services: list could not be read');
  }
  if (wantsReport(messages)) {
    try { lines.push(await reportFacts(organizationId, messages)); } catch {
      lines.push('The report could not be read.');
    }
  }
  return lines.join('\n');
}

async function whatsappModels() {
  const attempts = [];
  const primary = await repo.connectionByPurpose('whatsapp');
  if (primary?.credentialCiphertext) attempts.push({ purpose: 'whatsapp', row: primary });
  const backup = await repo.connectionByPurpose('assistant');
  if (backup?.credentialCiphertext && Number(backup.id) !== Number(primary?.id)) {
    attempts.push({ purpose: 'assistant', row: backup });
  }
  return attempts;
}

const AD_PLAN_BRIEF = `You plan one Meta ad for AIRO.
Write with English letters only. Never use Hindi script.
If the intake says Language: English, write STRATEGY, HEADLINE, and TEXT in English.
If the intake says Language: Hinglish, write those three lines in Hinglish.
Use only the intake and the public ads in this message. If no public ads are listed, say public competitor ads were not available. Do not invent competitor names, ad spend, audiences, or ads.
Do not add a special ad category. Do not mention housing unless the intake already says HOUSING.
Return exactly four lines and nothing else:
STRATEGY: one or two sentences
HEADLINE: under 40 characters
TEXT: under 200 characters
CTA: LEARN_MORE or SIGN_UP or SHOP_NOW or BOOK_NOW`;

const GOOGLE_PLAN_BRIEF = `You write one Google Search ad for AIRO.
Write the ad itself in English with English letters only. Never use Hindi script.
Use only the facts in this message. Do not invent prices, offers, discounts, awards, ratings, phone numbers, or claims the business did not give.
If the facts include an owner idea, follow it as long as it fits these rules.
Headlines: under 30 characters each, no exclamation marks, no ALL CAPS words, all different.
Descriptions: under 90 characters each, all different.
Return lines in exactly this format and nothing else:
STRATEGY: one or two sentences about who searches for this and why these keywords
HEADLINE: text (write this line 8 times, one headline per line)
DESCRIPTION: text (write this line 3 times, one description per line)`;

async function adModels(purposes = ['ads', 'whatsapp', 'assistant']) {
  const attempts = [];
  for (const purpose of purposes) {
    let row;
    try { row = await repo.connectionByPurpose(purpose); } catch (error) {
      if (schemaMissing(error)) return [];
      throw error;
    }
    if (row?.credentialCiphertext && !attempts.some((item) => Number(item.row.id) === Number(row.id))) {
      attempts.push({ purpose, row });
    }
  }
  return attempts;
}

const BUSY_RETRIES = 2;
const BUSY_WAIT_MS = 6000;

// Providers answer "high demand", "overloaded", 429/503 or an empty reply for short spikes; those are worth waiting out.
export function modelBusy(error) {
  const status = Number(error?.status || error?.statusCode || error?.details?.status || 0);
  return error?.code === 'llm_empty'
    || [429, 503, 529].includes(status)
    || /high demand|overloaded|temporarily unavailable|try again later|too many requests|rate limit/i.test(String(error?.message || ''));
}

export async function structuredLlm({ organizationId = null, schema, system, facts, task, maxTokens = 4096, purposes }) {
  const attempts = await adModels(purposes);
  if (!attempts.length) throw new ApiError(422, 'Connect an AI model for Ad writing on Platform AI first.', 'llm_missing');
  const brief = `${system}\nReply with one JSON object only. No markdown and no text outside the JSON.`;
  let lastError = null;
  for (const attempt of attempts) {
    let messages = [{ role: 'user', content: task }];
    let busyWaits = 0;
    for (let tries = 0; tries < 2; tries += 1) {
      let text;
      try {
        text = await replyLlm({
          provider: attempt.row.provider,
          model: attempt.row.modelName,
          apiKey: await readKey(attempt.row),
          baseUrl: attempt.row.baseUrl || '',
          messages,
          facts,
          system: brief,
          maxTokens,
          maxChars: 24000
        });
      } catch (error) {
        lastError = error;
        if (busyWaits < BUSY_RETRIES && modelBusy(error)) {
          busyWaits += 1;
          tries -= 1;
          await new Promise((resolve) => setTimeout(resolve, busyWaits * BUSY_WAIT_MS));
          continue;
        }
        break;
      }
      const parsed = schema.safeParse(modelJson(text));
      if (parsed.success) {
        await recordAudit({ auth: null, ip: null }, {
          action: 'llm.structured',
          resource: 'llm_connection',
          resourceId: attempt.row.id,
          organizationId,
          metadata: { purpose: attempt.purpose, provider: attempt.row.provider, model: attempt.row.modelName }
        });
        return { data: parsed.data, model: attempt.row.modelName, providerName: llmProviderName(attempt.row.provider) };
      }
      const problems = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; ');
      lastError = new ApiError(502, 'The model reply did not match the expected format.', 'llm_invalid');
      messages = [
        ...messages,
        { role: 'assistant', content: String(text || '').slice(0, 4000) || '(empty)' },
        { role: 'user', content: `That reply was not valid: ${problems}. Send the corrected JSON object only.` }
      ];
    }
  }
  throw lastError;
}

// Loaded lazily: competitorIntel itself calls structuredLlm from this module.
async function marketContext(organizationId) {
  if (!organizationId) return '';
  const { competitorContext } = await import('./competitorIntel.js');
  return competitorContext(organizationId);
}

export async function writeGoogleAdPlan({ intake, english }) {
  const attempts = await adModels();
  if (!attempts.length) return null;
  const facts = [
    `Chat language: ${english ? 'English' : 'Hinglish'} (the ad text stays English).`,
    `Product or service: ${intake.product}`,
    `Website: ${intake.website}`,
    `Location: ${intake.region}`,
    `Daily budget: ${intake.dailyBudget}`,
    `Keywords: ${(intake.keywords || []).map((item) => item.text).join(', ') || 'none yet'}`,
    intake.idea ? `Owner idea: ${intake.idea}` : 'Owner idea: none',
    await marketContext(intake.organizationId)
  ].filter(Boolean).join('\n');
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const text = await replyLlm({
        provider: attempt.row.provider,
        model: attempt.row.modelName,
        apiKey: await readKey(attempt.row),
        baseUrl: attempt.row.baseUrl || '',
        messages: [{ role: 'user', content: 'Write the Google Search ad from these facts.' }],
        facts,
        system: GOOGLE_PLAN_BRIEF
      });
      await recordAudit({ auth: null, ip: null }, {
        action: 'llm.chat',
        resource: 'llm_connection',
        resourceId: attempt.row.id,
        organizationId: intake.organizationId || null,
        metadata: { purpose: attempt.purpose, provider: attempt.row.provider, model: attempt.row.modelName, channel: 'whatsapp' }
      });
      return { text: String(text || '').slice(0, 3000), model: attempt.row.modelName };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function writeAdPlan({ intake, publicAds, english }) {
  const attempts = await adModels();
  if (!attempts.length) return null;
  const facts = [
    `Language: ${english ? 'English' : 'Hinglish'}.`,
    `Category: ${intake.category}`,
    `Product: ${intake.product}`,
    `Website: ${intake.website || 'No website. Use the Facebook Page. Do not invent a website.'}`,
    `Region: ${intake.region}`,
    `Daily budget: ${intake.dailyBudget}`,
    `Objective: ${intake.objectiveLabel}`,
    `Special category: ${intake.specialCategory || 'none'}`,
    publicAds.length
      ? `Public ads:\n${publicAds.map((ad) => `- ${[ad.page, ad.title, ad.text].filter(Boolean).join(' · ')}`).join('\n')}`
      : 'Public ads: none returned.',
    await marketContext(intake.organizationId)
  ].filter(Boolean).join('\n');
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const text = await replyLlm({
        provider: attempt.row.provider,
        model: attempt.row.modelName,
        apiKey: await readKey(attempt.row),
        baseUrl: attempt.row.baseUrl || '',
        messages: [{ role: 'user', content: 'Write the Meta ad plan from the intake.' }],
        facts,
        system: AD_PLAN_BRIEF
      });
      await recordAudit({ auth: null, ip: null }, {
        action: 'llm.chat',
        resource: 'llm_connection',
        resourceId: attempt.row.id,
        organizationId: intake.organizationId || null,
        metadata: { purpose: attempt.purpose, provider: attempt.row.provider, model: attempt.row.modelName, channel: 'whatsapp' }
      });
      return {
        text: String(text || '').slice(0, 2000),
        purpose: attempt.purpose,
        providerName: llmProviderName(attempt.row.provider),
        model: attempt.row.modelName
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function replyWhatsapp({ organizationId, recognized, businessLabel, messages, intent = '' }) {
  if (recognized && organizationId) {
    if (!intent || intent === 'ads_advice') {
      const advice = await adsAdviceReply(organizationId, messages, { force: intent === 'ads_advice' }).catch(() => null);
      if (advice) return { text: advice, image: null, purpose: 'ads_agent', providerName: 'AIRO', model: 'rules' };
    }
    if (!intent || intent === 'ads_report' || intent === 'call_report') {
      try {
        const org = await one(`SELECT name FROM organizations WHERE id = ?`, [organizationId]);
        const only = intent === 'ads_report' ? 'ads' : intent === 'call_report' ? 'call' : '';
        const card = await whatsappReportCard(organizationId, messages, org?.name || businessLabel || '', { only });
        if (card?.text) return { text: card.text, image: card.image || null, purpose: 'report', providerName: 'AIRO', model: card.model };
      } catch {
        // The model reply below still answers with the report facts.
      }
    }
  }
  let attempts;
  try {
    attempts = await whatsappModels();
  } catch (error) {
    if (schemaMissing(error)) return null;
    throw error;
  }
  if (!attempts.length) return null;
  const facts = await whatsappFacts({ organizationId, recognized, businessLabel, messages });
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const text = await replyLlm({
        provider: attempt.row.provider,
        model: attempt.row.modelName,
        apiKey: await readKey(attempt.row),
        baseUrl: attempt.row.baseUrl || '',
        messages,
        facts,
        system: WHATSAPP_BRIEF
      });
      await recordAudit({ auth: null, ip: null }, {
        action: 'llm.chat',
        resource: 'llm_connection',
        resourceId: attempt.row.id,
        organizationId: organizationId || null,
        metadata: { purpose: attempt.purpose, provider: attempt.row.provider, model: attempt.row.modelName, channel: 'whatsapp' }
      });
      return {
        text: String(text || '').slice(0, 4000),
        purpose: attempt.purpose,
        providerName: llmProviderName(attempt.row.provider),
        model: attempt.row.modelName
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function chatLlm(req) {
  let row;
  try {
    row = await repo.connectionByPurpose('assistant');
  } catch (error) {
    if (schemaMissing(error)) throw new ApiError(422, 'Run migrate before using the assistant.', 'validation_error');
    throw error;
  }
  if (!row?.credentialCiphertext) {
    throw new ApiError(422, 'Connect a model for Workspace assistant first.', 'validation_error');
  }
  const canConnect = req.auth?.realm !== 'platform' && ((req.auth?.permissions || []).includes('*') || (req.auth?.permissions || []).includes('connections.manage'));
  const reply = await replyLlm({
    provider: row.provider,
    model: row.modelName,
    apiKey: await readKey(row),
    baseUrl: row.baseUrl || '',
    messages: req.body.messages,
    facts: await assistantFacts(req.auth)
  });
  const text = canConnect || req.auth?.realm === 'platform' ? withoutPermissionNote(reply) : reply;
  await recordAudit(req, {
    action: 'llm.chat',
    resource: 'llm_connection',
    resourceId: row.id,
    organizationId: null,
    metadata: { purpose: 'assistant', provider: row.provider, model: row.modelName }
  });
  return { reply: text, providerName: llmProviderName(row.provider), model: row.modelName };
}

export async function disconnectLlm(req) {
  const current = await repo.connectionById(req.body.id);
  if (!current || current.status !== 'connected') throw new ApiError(404, 'That model is not connected.', 'not_found');
  await repo.clearConnection(current.id);
  await recordAudit(req, {
    action: 'llm.disconnected',
    resource: 'llm_connection',
    resourceId: current.id,
    organizationId: null,
    metadata: { purpose: current.purpose, provider: current.provider, model: current.modelName }
  });
  return llmStatus();
}
