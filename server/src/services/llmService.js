import { ApiError } from '../utils/errors.js';
import { decryptJson, encryptJson } from '../utils/cryptoBox.js';
import { recordAudit } from './auditService.js';
import { listLlmModels, llmProviderName, replyLlm, verifyLlm } from '../integrations/llm.js';
import { LLM_PURPOSES, purposeLabel } from '../domain/llmPurposes.js';
import { many } from '../db/sql.js';
import * as whatsappRepo from '../repositories/whatsappRepo.js';
import * as repo from '../repositories/llmRepo.js';

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
