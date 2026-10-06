import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { CATEGORIES } from '../domain/providers.js';
import { createGoogleSearchCampaign, editGoogleCampaign, editGoogleItem, exchangeGoogleCode, googleAuthUrl, googleCampaignDetail, googleKeywordIdeas, googleReport, listGoogleAccounts, pullGoogleAds, searchGoogleLanguages, setGoogleCampaignStatus, suggestGoogleLocations, verifyGoogleAccount } from '../integrations/googleAds.js';
import { cleanNexcallKey, nexcallBase, nexcallCallReport, nexcallCalls, nexcallFollowups, nexcallLeads, NEXCALL_BASE, NEXCALL_DESCRIPTION, NEXCALL_ENDPOINTS, NEXCALL_MAPPING, pullNexcall, verifyNexcall } from '../integrations/nexcall.js';
import { attachMetaPages, createMetaAd, createMetaCampaign as createOnMeta, editMetaCampaign, editMetaItem, exchangeMetaCode, listAdInstagram, listMetaAdAccounts, listMetaPages, listMetaPixels, listPageInstagram, metaAuthUrl, metaCampaignDetail, metaReport, pullMetaAds, searchMetaAudience, setMetaCampaignStatus, verifyMetaAccount } from '../integrations/metaAds.js';
import { verifyProviderKey } from '../integrations/verify.js';
import { decryptJson, encryptJson, randomToken } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';
import { leadScope } from '../utils/scope.js';
import * as repo from '../repositories/connectionRepo.js';
import { recordAudit } from './auditService.js';
import { refreshOrganization } from './intelligenceService.js';

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const defaultMapping = {
  account: 'connection',
  campaigns: 'campaigns',
  spend: 'campaign_metrics',
  leads: 'leads',
  conversions: 'leads.status'
};

const defaultSync = { frequency: 'hourly', objects: ['campaigns', 'leads', 'spend'] };

function readSecret(ciphertext) {
  if (!ciphertext) return null;
  try {
    return decryptJson(ciphertext);
  } catch {
    return null;
  }
}

function keyPreview(secret) {
  if (!secret?.apiKey) return null;
  return `••••${String(secret.apiKey).slice(-4)}`;
}

function isLinked(connection, secret) {
  if (!secret?.apiKey || connection.status !== 'connected' || connection.mode !== 'live') return false;
  return secret.verified === true;
}

function publicConnection(row) {
  const { ciphertext, ...connection } = row;
  const secret = readSecret(ciphertext);
  const preview = keyPreview(secret);
  const live = connection.mode === 'live' && Boolean(preview);
  const linked = isLinked(connection, secret);
  return {
    ...connection,
    apiKeyStored: Boolean(preview),
    apiLive: live,
    apiKeyPreview: preview,
    accountId: MULTI_ACCOUNT.has(connection.providerKey) ? secret?.accountId || null : null,
    linked
  };
}

const MULTI_ACCOUNT = new Set(['meta_ads', 'google_ads']);

function accountKey(value) {
  return String(value || '').replace(/^act_/i, '').replace(/-/g, '');
}

async function providerRows(organizationId, providerKey) {
  return (await repo.list(organizationId)).filter((item) => item.providerKey === providerKey);
}

async function takenAccounts(organizationId, providerKey, exceptId) {
  const rows = await providerRows(organizationId, providerKey);
  return new Set(rows
    .filter((row) => row.id !== exceptId)
    .map((row) => ({ row, secret: readSecret(row.ciphertext) }))
    .filter(({ row, secret }) => isLinked(row, secret) && secret.accountId)
    .map(({ secret }) => accountKey(secret.accountId)));
}

export async function index(auth) {
  const [rows, providers] = await Promise.all([repo.list(auth.organizationId), repo.catalog()]);
  const connections = rows.map(publicConnection);
  return {
    categories: CATEGORIES.map((category) => ({
      ...category,
      providers: providers
        .filter((provider) => provider.category === category.key)
        .map((provider) => {
          const own = connections.filter((item) => item.providerKey === provider.providerKey);
          const accounts = own.filter((item) => item.linked);
          return {
            ...provider,
            multiAccount: MULTI_ACCOUNT.has(provider.providerKey),
            accounts,
            connection: accounts[0] || own[0] || null,
            connected: own.length > 0
          };
        })
    })),
    connections
  };
}

export async function detail(auth, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  const token = await ensureHook(connection);
  const [objects, jobs, logs, errors] = await Promise.all([
    repo.objects(id),
    repo.jobs(id),
    repo.logs(id),
    repo.errors(id)
  ]);
  const canManage = auth.permissions?.includes('connections.manage');
  const storedSecret = readSecret((await repo.credential(connection.id))?.ciphertext);
  const accounts = MULTI_ACCOUNT.has(connection.providerKey)
    ? (await repo.list(auth.organizationId))
        .filter((row) => row.providerKey === connection.providerKey)
        .map(publicConnection)
        .filter((row) => row.linked || row.id === connection.id)
        .map((row) => ({ id: row.id, accountLabel: row.accountLabel, accountId: row.accountId, linked: row.linked }))
    : [];
  return {
    id: connection.id,
    status: connection.status,
    accountLabel: connection.accountLabel,
    mode: connection.mode,
    connectedAt: connection.connectedAt,
    lastSyncAt: connection.lastSyncAt,
    providerKey: connection.providerKey,
    name: connection.name,
    category: connection.category,
    description: connection.description,
    credentialsStored: Boolean(connection.credentialRow),
    credentialPreview: await credentialPreview(connection),
    apiKeyStored: Boolean(keyPreview(storedSecret)),
    jobs,
    logs,
    errors,
    records: connection.providerKey === 'nexcall' ? [] : objects.map(liveRecord).filter(Boolean),
    linked: isLinked(connection, storedSecret),
    accountId: MULTI_ACCOUNT.has(connection.providerKey) ? storedSecret?.accountId || null : null,
    accounts,
    tokenExpiresAt: storedSecret?.tokenExpiresAt || null,
    webhookPath: canManage && token ? `/api/hooks/${token}` : null,
    tool: connection.providerKey === 'nexcall' ? await nexcallTool(id, connection.mode) : null
  };
}

const STATS_TTL_MS = 10 * 60 * 1000;
const statsCache = new Map();

function istDate(offsetDays = 0) {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000 - offsetDays * 24 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function istHourNow() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).getUTCHours();
}

async function cachedReport(id, secret, from, to) {
  const key = `${id}|${from}|${to}`;
  const hit = statsCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const body = await nexcallCallReport({ apiKey: secret.apiKey, baseUrl: secret.baseUrl, from, to });
  const value = {
    totals: body.data?.summary?.totals || {},
    employees: (body.data?.employees || []).map(({ employee_email: _email, ...row }) => row)
  };
  statsCache.set(key, { value, expires: Date.now() + STATS_TTL_MS });
  if (statsCache.size > 500) statsCache.delete(statsCache.keys().next().value);
  return value;
}

async function inBatches(items, size, task) {
  const out = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(...await Promise.all(items.slice(index, index + size).map(task)));
  }
  return out;
}

export async function callYatriStats(auth, id, requestedDay) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'nexcall') throw new ApiError(422, 'Call stats are only available on Call Yatri.', 'validation_error');
  const secret = await storedSecret(id);
  if (!secret?.apiKey) throw new ApiError(422, 'No Call Yatri API key is saved.', 'validation_error');

  const dates = Array.from({ length: 7 }, (_, index) => istDate(6 - index));
  const day = dates.includes(requestedDay) ? requestedDay : dates[dates.length - 1];
  const lastHour = day === istDate(0) ? istHourNow() : 23;
  const hours = Array.from({ length: lastHour + 1 }, (_, hour) => hour);
  const pad = (value) => String(value).padStart(2, '0');
  const failed = [];

  const days = await inBatches(dates, 4, async (date) => {
    try {
      const report = await cachedReport(id, secret, `${date} 00:00:00`, `${date} 23:59:59`);
      return { date, ...report };
    } catch (error) {
      failed.push(`${date}: ${error.message}`);
      return { date, totals: null, employees: [] };
    }
  });
  const hourly = await inBatches(hours, 6, async (hour) => {
    try {
      const report = await cachedReport(id, secret, `${day} ${pad(hour)}:00:00`, `${day} ${pad(hour)}:59:59`);
      return { hour, totals: report.totals };
    } catch (error) {
      failed.push(`${day} ${pad(hour)}:00: ${error.message}`);
      return { hour, totals: null };
    }
  });
  return { day, days, hours: hourly, failed: failed.slice(0, 10) };
}

const RECORD_PULLS = { calls: nexcallCalls, followups: nexcallFollowups, leads: nexcallLeads };

export async function connectionLeads(auth, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'meta_ads' && connection.providerKey !== 'google_ads') {
    throw new ApiError(422, 'Leads are only linked for ad accounts.', 'validation_error');
  }
  if (connection.providerKey === 'google_ads') {
    return { linked: false, items: [], counts: { created: 0, matched: 0, skipped: 0 } };
  }
  const scope = leadScope(auth);
  const [items, outcomes] = await Promise.all([
    repo.adLeads({ organizationId: auth.organizationId, connectionId: connection.id, scopeSql: scope.sql, scopeParams: scope.params, limit: 200 }),
    scope.sql ? Promise.resolve([]) : repo.adLeadCounts(auth.organizationId, connection.id)
  ]);
  const counts = { created: 0, matched: 0, skipped: 0 };
  for (const row of outcomes) counts[row.outcome] = Number(row.total);
  return { linked: true, items, counts: scope.sql ? null : counts };
}

export async function callYatriRecords(auth, id, kind, requestedDay) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'nexcall') throw new ApiError(422, 'Call records are only available on Call Yatri.', 'validation_error');
  const pullRecords = RECORD_PULLS[kind];
  if (!pullRecords) throw new ApiError(422, 'Choose calls, followups, or leads.', 'validation_error');
  const secret = await storedSecret(id);
  if (!secret?.apiKey) throw new ApiError(422, 'No Call Yatri API key is saved.', 'validation_error');

  const dates = Array.from({ length: 7 }, (_, index) => istDate(6 - index));
  const week = requestedDay === 'week';
  const day = dates.includes(requestedDay) ? requestedDay : dates[dates.length - 1];
  const from = `${week ? dates[0] : day} 00:00:00`;
  const to = `${week ? dates[dates.length - 1] : day} 23:59:59`;
  let body;
  try {
    body = await pullRecords({ apiKey: secret.apiKey, baseUrl: secret.baseUrl, from, to, page: 1, limit: 100 });
  } catch (error) {
    const reason = String(error.message || 'Call Yatri did not respond.').replace(/x-api-key[=:]\s*\S+/gi, '').slice(0, 160);
    throw new ApiError(502, reason, 'provider_error');
  }
  const rows = (Array.isArray(body?.data) ? body.data : []).map(({ employee_email: _email, ...row }) => row);
  const total = Number(body?.pagination?.total ?? body?.meta?.total ?? body?.total ?? rows.length) || rows.length;
  return { kind, day: week ? 'week' : day, from, to, total, rows };
}

async function callYatriConnection(auth, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'nexcall') throw new ApiError(422, 'Team heads are only set on Call Yatri.', 'validation_error');
  return connection;
}

export async function callYatriTeams(auth, id) {
  await callYatriConnection(auth, id);
  const rows = await repo.callTeamRows(id);
  const heads = new Map();
  for (const row of rows) {
    const head = heads.get(row.id) || { id: row.id, headEmployeeId: row.headEmployeeId, headName: row.headName, members: [] };
    if (row.employeeId != null) head.members.push({ employeeId: row.employeeId, employeeName: row.employeeName });
    heads.set(row.id, head);
  }
  return { heads: [...heads.values()] };
}

export async function saveCallYatriTeams(auth, req, id) {
  await callYatriConnection(auth, id);
  const taken = new Set();
  const heads = [];
  for (const head of req.body.heads) {
    if (heads.some((item) => item.headEmployeeId === head.headEmployeeId)) continue;
    const members = [{ employeeId: head.headEmployeeId, employeeName: head.headName }, ...head.members]
      .filter((member) => {
        if (taken.has(member.employeeId)) return false;
        taken.add(member.employeeId);
        return true;
      });
    heads.push({ ...head, members });
  }
  await repo.replaceCallTeams(auth.organizationId, id, heads);
  await recordAudit(req, { action: 'connection.call_teams_saved', resource: 'connection', resourceId: id, metadata: { heads: heads.length } });
  return callYatriTeams(auth, id);
}

function liveRecord(row) {
  const payload = parseJson(row.payload, null);
  if (!payload || (payload.origin !== 'api' && payload.origin !== 'webhook')) return null;
  const fields = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'origin' || value == null) continue;
    fields[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return {
    id: `${row.objectType}-${row.externalId}`,
    type: row.objectType,
    name: row.name,
    externalId: row.externalId,
    parent: row.parentExternalId || null,
    origin: payload.origin,
    fields
  };
}

async function ensureHook(connection) {
  if (connection.webhookToken) return connection.webhookToken;
  const token = randomToken();
  await repo.setWebhookToken(connection.id, token);
  const fresh = await repo.getConnection(connection.organizationId, connection.id);
  return fresh?.webhookToken || token;
}

export async function ingestWebhook(token, body) {
  const connection = await repo.findByWebhookToken(token);
  if (!connection || connection.status === 'disconnected') throw new ApiError(404, 'Unknown webhook.', 'not_found');
  if (connection.providerKey === 'nexcall') {
    throw new ApiError(422, 'Call Yatri data is read live from its API and is not stored in AIRO.', 'validation_error');
  }
  const items = Array.isArray(body) ? body.slice(0, 50) : [body];
  if (!items.length || items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    throw new ApiError(422, 'Post a JSON object or a list of objects.', 'validation_error');
  }
  for (const item of items) {
    const externalId = String(item.id ?? item.external_id ?? item.externalId ?? randomToken().slice(0, 16)).slice(0, 80);
    const name = String(item.name || item.full_name || item.event || item.type || 'Webhook event').slice(0, 180);
    const type = String(item.type || item.object_type || 'event').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'event';
    await repo.upsertObject({
      organizationId: connection.organizationId,
      connectionId: connection.id,
      objectType: type,
      externalId,
      name,
      parentExternalId: null,
      payload: { ...item, origin: 'webhook' }
    });
  }
  return { stored: items.length };
}

async function credentialPreview(connection) {
  const row = await repo.credential(connection.id);
  const secret = readSecret(row?.ciphertext);
  const preview = keyPreview(secret);
  if (connection.providerKey === 'meta_ads' && preview && secret?.oauth) {
    const expires = secret.tokenExpiresAt ? ` The login expires on ${secret.tokenExpiresAt.slice(0, 10)}; connect again before then.` : '';
    return `Signed in with Facebook. Sync reads campaigns, ads, and the last 30 days from Meta.${expires}`;
  }
  if (connection.providerKey === 'whatsapp') {
    return 'The shared AIRO chatbot is connected on the platform. This workspace does not store a WhatsApp API key.';
  }
  if (connection.providerKey === 'nexcall' && connection.mode === 'live' && preview) {
    return `Live key ${preview}. Calls, follow-ups, leads, and the report are read live from Call Yatri and are not stored in AIRO.`;
  }
  if (connection.providerKey === 'meta_ads' && preview) {
    return `Live token ${preview}. Sync reads campaigns, ads, and the last 30 days from Meta.`;
  }
  if (connection.providerKey === 'google_ads' && preview) {
    return 'Signed in with Google. Sync reads campaigns, ad groups, ads, keywords, and the last 30 days from Google Ads.';
  }
  if (preview) {
    return `API key ${preview} is saved encrypted. Sync still uses the development adapter and does not call this provider.`;
  }
  return 'No API key is stored. Sync uses the development adapter.';
}

async function ensureConnection(auth, req, provider, accountId = '') {
  if (MULTI_ACCOUNT.has(provider.providerKey)) {
    const rows = await providerRows(auth.organizationId, provider.providerKey);
    const wanted = accountKey(accountId);
    const target = rows.find((row) => wanted && accountKey(readSecret(row.ciphertext)?.accountId) === wanted)
      || rows.find((row) => !isLinked(row, readSecret(row.ciphertext)));
    if (target) {
      if (target.status !== 'connected') await repo.setStatus(auth.organizationId, target.id, 'connected');
      return target.id;
    }
    return repo.createConnection({
      organizationId: auth.organizationId,
      providerId: provider.id,
      status: 'connected',
      accountLabel: req.body.accountLabel || provider.name
    });
  }
  const existing = (await repo.list(auth.organizationId)).find((item) => item.providerKey === provider.providerKey);
  if (existing && existing.status !== 'disconnected') return existing.id;
  if (existing) {
    await repo.setStatus(auth.organizationId, existing.id, 'connected');
    return existing.id;
  }
  return repo.createConnection({
    organizationId: auth.organizationId,
    providerId: provider.id,
    status: 'connected',
    accountLabel: req.body.accountLabel || provider.name
  });
}

export async function saveProviderApi(auth, req) {
  const provider = await repo.findProvider(req.body.providerKey);
  if (!provider) throw new ApiError(422, 'Unknown provider.', 'validation_error');
  if (provider.providerKey === 'whatsapp') {
    throw new ApiError(422, 'WhatsApp uses the shared AIRO chatbot. Super Admin and Developer/Admin connect that API on the platform.', 'validation_error');
  }
  if (provider.providerKey === 'google_ads') {
    throw new ApiError(422, 'Google Ads connects with the Connect with Google button.', 'validation_error');
  }
  const apiKey = provider.providerKey === 'nexcall' ? cleanNexcallKey(req.body.apiKey) : req.body.apiKey.trim();
  const accountId = (req.body.accountId || '').trim();
  const baseUrl = (req.body.baseUrl || '').trim().replace(/\/$/, '');
  if (provider.providerKey === 'nexcall') {
    if (!apiKey) throw new ApiError(422, 'Wrong API.', 'validation_error');
    const url = nexcallBase(baseUrl || NEXCALL_BASE);
    try {
      await verifyNexcall({ apiKey, baseUrl: url });
    } catch (error) {
      if (error.code === 'nexcall_unreachable') {
        const cause = error.cause;
        const timedOut = cause?.name === 'TimeoutError' || cause?.code === 23 || cause?.code === 'ABORT_ERR';
        throw new ApiError(422, timedOut ? `The API did not respond. ${error.message}` : 'The API did not respond.', 'validation_error');
      }
      const reason = String(error.message || '')
        .replace(/x-api-key[=:]\s*\S+/gi, '')
        .replace(/wext_[A-Za-z0-9_-]+/gi, '')
        .trim()
        .slice(0, 160);
      if (Number(error.status) === 404) {
        throw new ApiError(422, 'Call Yatri calls URL was not found. Leave Base URL blank, or use https://w-caller.workians.com/api/external, then save again.', 'validation_error');
      }
      const rejected = Number(error.status) === 401 || Number(error.status) === 403 || /access denied|invalid (api )?key|unauthorized/i.test(reason);
      throw new ApiError(422, rejected && reason ? `Wrong API. ${reason}` : (reason || 'Wrong API.'), 'validation_error');
    }
  } else if (provider.providerKey === 'meta_ads') {
    if (!accountId) throw new ApiError(422, 'Account id is required for Meta Ads.', 'validation_error');
    await verifyMetaAccount({ apiKey, accountId });
  } else {
    await verifyProviderKey({ providerKey: provider.providerKey, apiKey, baseUrl });
  }
  const id = await ensureConnection(auth, req, provider, accountId);
  if (provider.providerKey === 'nexcall') {
    const url = nexcallBase(baseUrl || NEXCALL_BASE);
    await repo.saveCredential(id, encryptJson({ mode: 'live', provider: 'nexcall', apiKey, baseUrl: url, verified: true }));
    await repo.saveConfig(id, NEXCALL_MAPPING, { frequency: 'hourly', objects: ['leads', 'calls', 'callReport', 'followups'] });
  } else {
    await repo.saveCredential(id, encryptJson({
      mode: 'live',
      provider: provider.providerKey,
      apiKey,
      baseUrl: baseUrl || null,
      accountId: accountId || null,
      verified: true
    }));
  }
  await repo.setMode(auth.organizationId, id, 'live');
  await repo.setStatus(auth.organizationId, id, 'connected');
  await recordAudit(req, {
    action: 'connection.credential_saved',
    resource: 'connection',
    resourceId: id,
    metadata: { provider: provider.providerKey }
  });
  if (provider.providerKey === 'meta_ads') {
    const synced = await sync(auth, req, id);
    const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
    const campaigns = (synced.records || []).filter((row) => row.type === 'campaign').length;
    synced.notice = failed
      ? `${provider.name} is connected. Sync failed: ${failed}`
      : provider.providerKey === 'meta_ads'
        ? (campaigns ? `${provider.name} is connected. ${campaigns} campaigns came back from Meta.` : `${provider.name} is connected. Meta returned no campaigns.`)
        : (synced.records.length ? `${provider.name} is connected. ${synced.records.length} records came back from the API.` : `${provider.name} is connected. The API returned no records.`);
    synced.linked = true;
    return synced;
  }
  const saved = await detail(auth, id);
  saved.notice = provider.providerKey === 'nexcall'
    ? 'Call Yatri is connected. The API key is saved for this business.'
    : `${provider.name} is connected.`;
  saved.linked = true;
  return saved;
}

async function nexcallTool(connectionId, mode) {
  const row = await repo.credential(connectionId);
  let keyPreview = null;
  let baseUrl = NEXCALL_BASE;
  if (row?.ciphertext) {
    try {
      const secret = decryptJson(row.ciphertext);
      if (secret?.apiKey) keyPreview = `••••${String(secret.apiKey).slice(-4)}`;
      if (secret?.baseUrl) baseUrl = secret.baseUrl;
    } catch {
      keyPreview = null;
    }
  }
  return {
    description: NEXCALL_DESCRIPTION,
    baseUrl,
    authHeader: 'x-api-key',
    keyPreview,
    live: mode === 'live' && Boolean(keyPreview),
    endpoints: NEXCALL_ENDPOINTS,
    mapping: NEXCALL_MAPPING
  };
}

export async function saveNexcallKey(auth, req, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'nexcall') throw new ApiError(422, 'An API key is only stored on Call Yatri.', 'validation_error');
  const apiKey = req.body.apiKey.trim();
  const baseUrl = (req.body.baseUrl || NEXCALL_BASE).trim().replace(/\/$/, '');
  await repo.saveCredential(id, encryptJson({ mode: 'live', provider: 'nexcall', apiKey, baseUrl }));
  await repo.saveConfig(id, NEXCALL_MAPPING, { frequency: 'hourly', objects: ['leads', 'calls', 'callReport', 'followups'] });
  await repo.setMode(auth.organizationId, id, 'live');
  await recordAudit(req, { action: 'connection.credential_saved', resource: 'connection', resourceId: id, metadata: { provider: 'nexcall' } });
  return sync(auth, req, id);
}

export async function connect(auth, req) {
  const provider = await repo.findProvider(req.body.providerKey);
  if (!provider) throw new ApiError(422, 'Unknown provider.', 'validation_error');
  const existing = (await repo.list(auth.organizationId)).find((item) => item.providerKey === provider.providerKey);
  if (existing && existing.status !== 'disconnected') {
    return detail(auth, existing.id);
  }
  const id = existing
    ? existing.id
    : await repo.createConnection({
        organizationId: auth.organizationId,
        providerId: provider.id,
        status: 'connected',
        accountLabel: req.body.accountLabel || provider.name
      });
  if (existing) await repo.setStatus(auth.organizationId, id, 'connected');
  await repo.saveCredential(id, encryptJson({ mode: 'development', provider: provider.providerKey, secret: null }));
  await repo.saveConfig(id, defaultMapping, defaultSync);
  await recordAudit(req, { action: 'connection.connected', resource: 'connection', resourceId: id, metadata: { provider: provider.providerKey } });
  return detail(auth, id);
}

export async function updateConfig(auth, req, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  const mapping = req.body.mapping || parseJson(connection.mapping, defaultMapping);
  const syncSettings = req.body.sync || parseJson(connection.syncSettings, defaultSync);
  await repo.saveConfig(id, mapping, syncSettings);
  await recordAudit(req, { action: 'connection.configured', resource: 'connection', resourceId: id });
  return detail(auth, id);
}

export async function sync(auth, req, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.status === 'disconnected') {
    throw new ApiError(409, 'Connect this provider before syncing.', 'conflict');
  }
  const jobId = await repo.createJob({
    connectionId: id,
    organizationId: auth.organizationId,
    status: 'running',
    summary: null
  });
  if (connection.status === 'error') {
    await repo.addLog(jobId, 'error', 'Sync stopped because provider authentication is expired.');
    await repo.finishJob(jobId, 'failed', 'Authentication expired. Reconnect before the next sync.');
    await recordAudit(req, { action: 'connection.sync_failed', resource: 'connection', resourceId: id });
    return detail(auth, id);
  }
  let result;
  try {
    result = await pullConnection(connection, id);
  } catch (error) {
    const message = error.message || 'Sync failed.';
    await repo.addLog(jobId, 'error', message);
    await repo.finishJob(jobId, 'failed', message);
    await recordAudit(req, { action: 'connection.sync_failed', resource: 'connection', resourceId: id });
    return detail(auth, id);
  }
  if (connection.providerKey === 'nexcall') {
    for (const key of statsCache.keys()) if (key.startsWith(`${id}|`)) statsCache.delete(key);
  }
  if (result.mode === 'live') {
    if (result.replaceTypes?.length) await repo.deleteObjects(id, result.replaceTypes);
    for (const object of result.objects) {
      await repo.upsertObject({
        organizationId: auth.organizationId,
        connectionId: id,
        objectType: object.type,
        externalId: object.externalId,
        name: object.name,
        parentExternalId: object.parent || null,
        payload: object.payload || { origin: 'api' }
      });
    }
  }
  const summary = String(result.summary || '').slice(0, 250);
  await repo.addLog(jobId, 'info', summary);
  for (const warning of result.warnings || []) {
    await repo.addLog(jobId, 'warning', String(warning).slice(0, 250));
  }
  if (connection.status === 'degraded') {
    await repo.addLog(jobId, 'warning', 'Sync completed with delay. The connector is degraded.');
  }
  await repo.finishJob(jobId, 'succeeded', summary);
  await repo.markSynced(id);
  await recordAudit(req, { action: 'connection.synced', resource: 'connection', resourceId: id });
  await refreshOrganization(auth.organizationId);
  return detail(auth, id);
}

function storedSecret(id) {
  return repo.credential(id).then((row) => readSecret(row?.ciphertext));
}

async function metaSecret(auth, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'meta_ads') throw new ApiError(422, 'This action is only for Meta Ads.', 'validation_error');
  const secret = await storedSecret(id);
  if (!secret?.apiKey || !secret.verified) throw new ApiError(422, 'Connect Meta Ads before managing campaigns.', 'validation_error');
  if (!secret.accountId) throw new ApiError(422, 'Account id is required for Meta Ads.', 'validation_error');
  return secret;
}

export async function metaReportFor(auth, id, range) {
  const secret = await metaSecret(auth, id);
  return metaReport({ apiKey: secret.apiKey, accountId: secret.accountId }, range);
}

export async function metaCampaignFor(auth, id, campaignId, range) {
  const secret = await metaSecret(auth, id);
  return metaCampaignDetail({ apiKey: secret.apiKey, accountId: secret.accountId }, campaignId, range);
}

export async function createMetaCampaign(auth, req, id) {
  const secret = await metaSecret(auth, id);
  await createOnMeta({
    apiKey: secret.apiKey,
    accountId: secret.accountId,
    name: req.body.name,
    objective: req.body.objective,
    dailyBudget: req.body.dailyBudget,
    status: req.body.status
  });
  await recordAudit(req, { action: 'connection.meta_campaign_created', resource: 'connection', resourceId: id });
  const synced = await sync(auth, req, id);
  const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
  synced.notice = failed
    ? `Campaign was created in Meta. Sync failed: ${failed}`
    : 'Campaign created in Meta Ads.';
  return synced;
}

export async function metaPages(auth, id) {
  const secret = await metaSecret(auth, id);
  return listMetaPages({ apiKey: secret.apiKey, accountId: secret.accountId });
}

export async function connectMetaPages(auth, id) {
  const secret = await metaSecret(auth, id);
  return attachMetaPages({ apiKey: secret.apiKey, accountId: secret.accountId });
}

export async function metaAudienceSearch(auth, id, kind, query) {
  const secret = await metaSecret(auth, id);
  try {
    return { results: await searchMetaAudience({ apiKey: secret.apiKey, kind, query }) };
  } catch (error) {
    return { results: [], note: error.message };
  }
}

export async function metaPixels(auth, id) {
  const secret = await metaSecret(auth, id);
  try {
    return { pixels: await listMetaPixels({ apiKey: secret.apiKey, accountId: secret.accountId }) };
  } catch (error) {
    return { pixels: [], note: error.message };
  }
}

export async function metaInstagram(auth, id, pageId) {
  const secret = await metaSecret(auth, id);
  const fromAccount = await listAdInstagram({ apiKey: secret.apiKey, accountId: secret.accountId });
  let fromPage = [];
  if (/^\d{5,20}$/.test(String(pageId || ''))) {
    try { fromPage = await listPageInstagram({ apiKey: secret.apiKey, pageId }); } catch { fromPage = []; }
  }
  const profiles = [...fromAccount, ...fromPage].filter((profile, index, all) => all.findIndex((item) => item.id === profile.id) === index);
  return { profiles };
}

export async function editMetaAdCampaign(auth, req, id) {
  const secret = await metaSecret(auth, id);
  await editMetaCampaign({
    apiKey: secret.apiKey,
    accountId: secret.accountId,
    campaignId: req.body.campaignId,
    name: req.body.name,
    dailyBudget: req.body.dailyBudget,
    status: req.body.status
  });
  await recordAudit(req, { action: 'connection.meta_campaign_edited', resource: 'connection', resourceId: id });
  const synced = await sync(auth, req, id);
  synced.notice = 'Campaign updated in Meta.';
  return synced;
}

export async function publishMetaAd(auth, req, id) {
  const secret = await metaSecret(auth, id);
  await createMetaAd({
    apiKey: secret.apiKey,
    accountId: secret.accountId,
    ...req.body
  });
  await recordAudit(req, {
    action: req.body.publish ? 'connection.meta_ad_published' : 'connection.meta_ad_created',
    resource: 'connection',
    resourceId: id
  });
  const synced = await sync(auth, req, id);
  const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
  synced.notice = failed
    ? `The ad was created in Meta. Sync failed: ${failed}`
    : (req.body.publish ? 'Ad published on Meta.' : 'Ad saved on Meta as paused.');
  return synced;
}

export async function updateMetaCampaignStatus(auth, req, id) {
  const secret = await metaSecret(auth, id);
  await setMetaCampaignStatus({
    apiKey: secret.apiKey,
    campaignId: req.body.campaignId,
    status: req.body.status
  });
  await recordAudit(req, { action: 'connection.meta_campaign_updated', resource: 'connection', resourceId: id, metadata: { status: req.body.status } });
  const synced = await sync(auth, req, id);
  const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
  synced.notice = failed
    ? `Campaign was updated in Meta. Sync failed: ${failed}`
    : 'Campaign updated in Meta Ads.';
  return synced;
}

const CONNECTIONS_BACK = '/app/connections?section=Advertising';
const OAUTH = {
  google_ads: { flag: 'google', label: 'Google' },
  meta_ads: { flag: 'meta', label: 'Facebook' }
};

function oauthStateSecret(providerKey) {
  return `${env.jwtSecret}:${providerKey}_oauth`;
}

async function oauthStart(auth, providerKey, buildUrl, requested) {
  let target = null;
  if (requested === 'new') target = 'new';
  else if (requested != null && requested !== '') {
    const id = Number(requested);
    const row = Number.isInteger(id) ? (await providerRows(auth.organizationId, providerKey)).find((item) => item.id === id) : null;
    if (!row) throw new ApiError(404, 'Connection not found.', 'not_found');
    target = id;
  }
  const state = jwt.sign(
    { purpose: providerKey, organizationId: auth.organizationId, userId: auth.userId, target },
    oauthStateSecret(providerKey),
    { expiresIn: '10m' }
  );
  return { url: buildUrl(state) };
}

async function oauthCallback(req, providerKey, exchange) {
  const { flag, label: name } = OAUTH[providerKey];
  const fail = (message) => `${CONNECTIONS_BACK}&${flag}=error&reason=${encodeURIComponent(String(message || `${name} sign-in failed.`).slice(0, 200))}`;
  let state;
  try {
    state = jwt.verify(String(req.query.state || ''), oauthStateSecret(providerKey));
  } catch {
    return fail(`${name} sign-in expired. Start again from Connections.`);
  }
  if (state.purpose !== providerKey || !state.organizationId) return fail(`${name} sign-in expired. Start again from Connections.`);
  if (req.query.error) return fail(req.query.error === 'access_denied' ? `${name} access was not allowed.` : `${name} sign-in failed.`);
  const code = String(req.query.code || '');
  if (!code || code.length > 2048) return fail(`${name} sign-in failed.`);
  try {
    const pending = await exchange(code);
    const provider = await repo.findProvider(providerKey);
    if (!provider) return fail('This provider is not in the provider list.');
    const rows = await providerRows(state.organizationId, providerKey);
    let existing = rows[0];
    if (state.target === 'new') {
      existing = rows.find((row) => !isLinked(row, readSecret(row.ciphertext)));
    } else if (state.target) {
      existing = rows.find((row) => row.id === state.target);
      if (!existing) return fail('This connection was removed. Start again from Connections.');
    }
    const id = existing?.id || await repo.createConnection({
      organizationId: state.organizationId,
      providerId: provider.id,
      status: 'pending',
      accountLabel: provider.name
    });
    const previous = readSecret(existing?.ciphertext) || {};
    await repo.saveCredential(id, encryptJson({
      ...previous,
      provider: providerKey,
      pendingToken: pending.token,
      pendingExpiresAt: pending.expiresAt || null
    }));
    if (existing?.status === 'disconnected') await repo.setStatus(state.organizationId, id, 'pending');
    await recordAudit({ ip: req.ip, auth: { userId: state.userId } }, {
      action: `connection.${flag}_authorized`,
      resource: 'connection',
      resourceId: id,
      organizationId: state.organizationId
    });
    return `${CONNECTIONS_BACK}&${flag}=pick&connection=${id}`;
  } catch (error) {
    return fail(error.message);
  }
}

async function oauthRow(auth, providerKey, connectionId) {
  const rows = await providerRows(auth.organizationId, providerKey);
  const wanted = Number(connectionId);
  const row = wanted
    ? rows.find((item) => item.id === wanted)
    : rows.find((item) => readSecret(item.ciphertext)?.pendingToken) || rows[0];
  const secret = row ? readSecret(row.ciphertext) || {} : {};
  const token = secret.pendingToken || secret.apiKey;
  if (!row || !token) throw new ApiError(422, `Sign in with ${OAUTH[providerKey].label} first.`, 'validation_error');
  const fresh = Boolean(secret.pendingToken);
  return {
    id: row.id,
    token,
    previousAccountId: secret.accountId || '',
    expiresAt: fresh ? secret.pendingExpiresAt || null : secret.tokenExpiresAt || null,
    oauth: fresh || Boolean(secret.oauth)
  };
}

async function claimAccount(auth, providerKey, id, previousAccountId, accountId) {
  if ((await takenAccounts(auth.organizationId, providerKey, id)).has(accountKey(accountId))) {
    throw new ApiError(422, 'This ad account is already connected in AIRO. Open it from Connections.', 'validation_error');
  }
  if (previousAccountId && accountKey(previousAccountId) !== accountKey(accountId)) await repo.clearObjects(id);
}

function googleInput(secret) {
  return {
    refreshToken: secret.apiKey,
    accountId: secret.accountId,
    loginCustomerId: secret.loginCustomerId || '',
    currency: secret.currency || ''
  };
}

async function googleSecret(auth, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  if (connection.providerKey !== 'google_ads') throw new ApiError(422, 'This action is only for Google Ads.', 'validation_error');
  const secret = await storedSecret(id);
  if (!secret?.apiKey || !secret.verified || !secret.accountId || connection.status !== 'connected') {
    throw new ApiError(422, 'Connect Google Ads before managing campaigns.', 'validation_error');
  }
  return googleInput(secret);
}

async function syncWithNotice(auth, req, id, done) {
  const synced = await sync(auth, req, id);
  const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
  synced.notice = failed ? `${done} Sync failed: ${failed}` : done;
  return synced;
}

export function googleStart(auth, target) {
  return oauthStart(auth, 'google_ads', googleAuthUrl, target);
}

export function googleCallback(req) {
  return oauthCallback(req, 'google_ads', async (code) => ({ token: await exchangeGoogleCode(code) }));
}

export async function googleAccounts(auth, connectionId) {
  const { id, token } = await oauthRow(auth, 'google_ads', connectionId);
  const listed = await listGoogleAccounts({ refreshToken: token });
  const taken = await takenAccounts(auth.organizationId, 'google_ads', id);
  return { ...listed, connectionId: id, accounts: (listed.accounts || []).map((account) => ({ ...account, taken: taken.has(accountKey(account.id)) })) };
}

export function metaStart(auth, target) {
  return oauthStart(auth, 'meta_ads', metaAuthUrl, target);
}

export function metaCallback(req) {
  return oauthCallback(req, 'meta_ads', exchangeMetaCode);
}

export async function metaAccounts(auth, connectionId) {
  const { id, token } = await oauthRow(auth, 'meta_ads', connectionId);
  const accounts = await listMetaAdAccounts({ apiKey: token });
  const taken = await takenAccounts(auth.organizationId, 'meta_ads', id);
  return {
    connectionId: id,
    accounts: accounts.map((account) => ({ ...account, taken: taken.has(accountKey(account.id)) })),
    note: accounts.length ? '' : 'Facebook returned no ad accounts for this login. Give this login access to the ad account in Meta Business Settings.'
  };
}

export async function chooseMetaAccount(auth, req) {
  const { id, token, expiresAt, oauth, previousAccountId } = await oauthRow(auth, 'meta_ads', req.body.connectionId);
  const wanted = `act_${req.body.accountId.replace(/^act_/i, '')}`;
  const chosen = (await listMetaAdAccounts({ apiKey: token })).find((account) => account.id === wanted);
  if (!chosen) throw new ApiError(422, 'This Facebook login cannot open that ad account.', 'validation_error');
  await verifyMetaAccount({ apiKey: token, accountId: chosen.id });
  await claimAccount(auth, 'meta_ads', id, previousAccountId, chosen.id);
  await repo.saveCredential(id, encryptJson({
    mode: 'live',
    provider: 'meta_ads',
    apiKey: token,
    accountId: chosen.id,
    oauth,
    tokenExpiresAt: expiresAt,
    verified: true
  }));
  await repo.setAccountLabel(auth.organizationId, id, chosen.name);
  await repo.setMode(auth.organizationId, id, 'live');
  await repo.setStatus(auth.organizationId, id, 'connected');
  await recordAudit(req, { action: 'connection.credential_saved', resource: 'connection', resourceId: id, metadata: { provider: 'meta_ads' } });
  const synced = await sync(auth, req, id);
  const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
  const campaigns = (synced.records || []).filter((row) => row.type === 'campaign').length;
  synced.notice = failed
    ? `Meta Ads is connected. Sync failed: ${failed}`
    : (campaigns ? `Meta Ads is connected. ${campaigns} campaigns came back from Meta.` : 'Meta Ads is connected. Meta returned no campaigns.');
  synced.linked = true;
  return synced;
}

export async function chooseGoogleAccount(auth, req) {
  const { id, token: refreshToken, previousAccountId } = await oauthRow(auth, 'google_ads', req.body.connectionId);
  const wanted = req.body.customerId.replace(/-/g, '');
  const listed = await listGoogleAccounts({ refreshToken });
  const chosen = listed.accounts.find((account) => account.id === wanted);
  if (!chosen) throw new ApiError(422, listed.note || 'This Google login cannot open that ad account.', 'validation_error');
  const account = await verifyGoogleAccount({ refreshToken, accountId: chosen.id, loginCustomerId: chosen.loginCustomerId });
  await claimAccount(auth, 'google_ads', id, previousAccountId, chosen.id);
  await repo.saveCredential(id, encryptJson({
    mode: 'live',
    provider: 'google_ads',
    apiKey: refreshToken,
    accountId: chosen.id,
    loginCustomerId: chosen.loginCustomerId || null,
    accountName: account.name,
    currency: account.currency,
    timeZone: account.timeZone,
    verified: true
  }));
  await repo.saveConfig(id, defaultMapping, { frequency: 'hourly', objects: ['campaigns', 'ad_groups', 'ads', 'keywords', 'spend'] });
  await repo.setAccountLabel(auth.organizationId, id, account.name);
  await repo.setMode(auth.organizationId, id, 'live');
  await repo.setStatus(auth.organizationId, id, 'connected');
  await recordAudit(req, { action: 'connection.credential_saved', resource: 'connection', resourceId: id, metadata: { provider: 'google_ads' } });
  const synced = await sync(auth, req, id);
  const failed = synced.jobs?.[0]?.status === 'failed' ? synced.jobs[0].summary : '';
  const campaigns = (synced.records || []).filter((row) => row.type === 'campaign').length;
  synced.notice = failed
    ? `Google Ads is connected. Sync failed: ${failed}`
    : (campaigns ? `Google Ads is connected. ${campaigns} campaigns came back from Google.` : 'Google Ads is connected. Google returned no campaigns.');
  synced.linked = true;
  return synced;
}

export async function googleLocations(auth, id, query) {
  const input = await googleSecret(auth, id);
  try {
    return { results: await suggestGoogleLocations({ refreshToken: input.refreshToken, query }) };
  } catch (error) {
    return { results: [], note: error.message };
  }
}

export async function googleLanguages(auth, id, query) {
  const input = await googleSecret(auth, id);
  try {
    return { results: await searchGoogleLanguages(input, query) };
  } catch (error) {
    return { results: [], note: error.message };
  }
}

export async function googleIdeas(auth, req, id) {
  const input = await googleSecret(auth, id);
  return { ideas: await googleKeywordIdeas(input, req.body) };
}

export async function googleReportFor(auth, id, range) {
  const input = await googleSecret(auth, id);
  return googleReport(input, range);
}

export async function googleCampaignFor(auth, id, campaignId, range) {
  const input = await googleSecret(auth, id);
  return googleCampaignDetail(input, campaignId, range);
}

const EDIT_NOTICE = {
  campaign: 'Campaign updated.',
  adset: 'Ad set updated.',
  ad_group: 'Ad group updated.',
  ad: 'Ad updated.',
  keyword: 'Keyword updated.',
  keywords: 'Keywords added.'
};

export async function editGoogleItemFor(auth, req, id) {
  const input = await googleSecret(auth, id);
  await editGoogleItem(input, req.params.kind, req.params.itemId, req.body);
  await recordAudit(req, { action: 'connection.google_item_edited', resource: 'connection', resourceId: id, metadata: { kind: req.params.kind, fields: Object.keys(req.body) } });
  return syncWithNotice(auth, req, id, `${EDIT_NOTICE[req.params.kind] || 'Updated.'} Changes are live in Google Ads.`);
}

export async function editMetaItemFor(auth, req, id) {
  const secret = await metaSecret(auth, id);
  await editMetaItem({ apiKey: secret.apiKey, accountId: secret.accountId }, req.params.kind, req.params.itemId, req.body);
  await recordAudit(req, { action: 'connection.meta_item_edited', resource: 'connection', resourceId: id, metadata: { kind: req.params.kind, fields: Object.keys(req.body) } });
  return syncWithNotice(auth, req, id, `${EDIT_NOTICE[req.params.kind] || 'Updated.'} Changes are live in Meta.`);
}

export async function createGoogleCampaign(auth, req, id) {
  const input = await googleSecret(auth, id);
  await createGoogleSearchCampaign({ ...req.body, ...input });
  await recordAudit(req, {
    action: req.body.publish ? 'connection.google_campaign_published' : 'connection.google_campaign_created',
    resource: 'connection',
    resourceId: id
  });
  return syncWithNotice(auth, req, id, req.body.publish ? 'Campaign published on Google Ads.' : 'Campaign saved on Google Ads as paused.');
}

export async function editGoogleAdCampaign(auth, req, id) {
  const input = await googleSecret(auth, id);
  await editGoogleCampaign({ ...req.body, ...input });
  await recordAudit(req, { action: 'connection.google_campaign_edited', resource: 'connection', resourceId: id });
  return syncWithNotice(auth, req, id, 'Campaign updated in Google Ads.');
}

export async function updateGoogleCampaignStatus(auth, req, id) {
  const input = await googleSecret(auth, id);
  await setGoogleCampaignStatus({ ...input, campaignId: req.body.campaignId, status: req.body.status });
  await recordAudit(req, { action: 'connection.google_campaign_updated', resource: 'connection', resourceId: id, metadata: { status: req.body.status } });
  return syncWithNotice(auth, req, id, req.body.status === 'ENABLED' ? 'Campaign is live on Google Ads.' : 'Campaign paused on Google Ads.');
}

async function pullConnection(connection, id) {
  const secret = await storedSecret(id);
  if (connection.providerKey === 'nexcall' && secret?.apiKey) {
    return pullNexcall({ apiKey: secret.apiKey, baseUrl: secret.baseUrl });
  }
  if (connection.providerKey === 'meta_ads') {
    if (!secret?.apiKey || !secret.accountId) {
      throw new ApiError(422, 'Account id is required for Meta Ads.', 'validation_error');
    }
    return pullMetaAds({ apiKey: secret.apiKey, accountId: secret.accountId });
  }
  if (connection.providerKey === 'google_ads') {
    if (!secret?.apiKey || !secret.accountId || !secret.verified) {
      throw new ApiError(422, 'Choose a Google Ads account before syncing.', 'validation_error');
    }
    return pullGoogleAds(googleInput(secret));
  }
  return {
    mode: 'empty',
    providerKey: connection.providerKey,
    summary: 'No API response was stored. This page shows records only after the provider API or a webhook sends them.',
    objects: []
  };
}

export async function disconnect(auth, req, id) {
  const connection = await repo.getConnection(auth.organizationId, id);
  if (!connection) throw new ApiError(404, 'Connection not found.', 'not_found');
  await repo.setStatus(auth.organizationId, id, 'disconnected');
  await repo.resolveErrors(id);
  await recordAudit(req, { action: 'connection.disconnected', resource: 'connection', resourceId: id });
  return detail(auth, id);
}
