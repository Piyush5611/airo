import { CATEGORIES } from '../domain/providers.js';
import { NEXCALL_BASE, NEXCALL_DESCRIPTION, NEXCALL_ENDPOINTS, NEXCALL_MAPPING, pullNexcall } from '../integrations/nexcall.js';
import { createMetaCampaign as createOnMeta, pullMetaAds, setMetaCampaignStatus, verifyMetaAccount } from '../integrations/metaAds.js';
import { verifyProviderKey } from '../integrations/verify.js';
import { decryptJson, encryptJson, randomToken } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';
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

function isLinked(connection, secret, lastJobStatus) {
  if (!secret?.apiKey || connection.status !== 'connected' || connection.mode !== 'live') return false;
  if (connection.providerKey === 'nexcall') return lastJobStatus === 'succeeded';
  return secret.verified === true;
}

function publicConnection(row) {
  const { ciphertext, ...connection } = row;
  const secret = readSecret(ciphertext);
  const preview = keyPreview(secret);
  const live = connection.mode === 'live' && Boolean(preview);
  const linked = isLinked(connection, secret, connection.lastJobStatus);
  return {
    ...connection,
    apiKeyStored: Boolean(preview),
    apiLive: live,
    apiKeyPreview: preview,
    linked
  };
}

export async function index(auth) {
  const [rows, providers] = await Promise.all([repo.list(auth.organizationId), repo.catalog()]);
  const connections = rows.map(publicConnection);
  return {
    categories: CATEGORIES.map((category) => ({
      ...category,
      providers: providers
        .filter((provider) => provider.category === category.key)
        .map((provider) => ({
          ...provider,
          connection: connections.find((item) => item.providerKey === provider.providerKey) || null,
          connected: connections.some((item) => item.providerKey === provider.providerKey)
        }))
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
    records: objects.map(liveRecord).filter(Boolean),
    linked: isLinked(connection, storedSecret, jobs[0]?.status),
    webhookPath: canManage && token ? `/api/hooks/${token}` : null,
    tool: connection.providerKey === 'nexcall' ? await nexcallTool(id, connection.mode) : null
  };
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
  const preview = keyPreview(readSecret(row?.ciphertext));
  if (connection.providerKey === 'whatsapp') {
    return 'The shared AIRO chatbot is connected on the platform. This workspace does not store a WhatsApp API key.';
  }
  if (connection.providerKey === 'nexcall' && connection.mode === 'live' && preview) {
    return `Live key ${preview}. Sync calls the W-Caller pull API.`;
  }
  if (connection.providerKey === 'meta_ads' && preview) {
    return `Live token ${preview}. Sync reads campaigns, ads, and the last 30 days from Meta.`;
  }
  if (preview) {
    return `API key ${preview} is saved encrypted. Sync still uses the development adapter and does not call this provider.`;
  }
  return 'No API key is stored. Sync uses the development adapter.';
}

async function ensureConnection(auth, req, provider) {
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
  const apiKey = req.body.apiKey.trim();
  const accountId = (req.body.accountId || '').trim();
  const baseUrl = (req.body.baseUrl || '').trim().replace(/\/$/, '');
  if (provider.providerKey === 'nexcall') {
    const url = baseUrl || NEXCALL_BASE;
    try {
      await pullNexcall({ apiKey, baseUrl: url });
    } catch (error) {
      if (error.code === 'nexcall_unreachable') throw new ApiError(422, 'The API did not respond.', 'validation_error');
      throw new ApiError(422, 'Wrong API.', 'validation_error');
    }
  } else if (provider.providerKey === 'meta_ads') {
    if (!accountId) throw new ApiError(422, 'Account id is required for Meta Ads.', 'validation_error');
    await verifyMetaAccount({ apiKey, accountId });
  } else {
    await verifyProviderKey({ providerKey: provider.providerKey, apiKey, baseUrl });
  }
  const id = await ensureConnection(auth, req, provider);
  if (provider.providerKey === 'nexcall') {
    const url = baseUrl || NEXCALL_BASE;
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
  if (provider.providerKey === 'nexcall' || provider.providerKey === 'meta_ads') {
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
  saved.notice = `${provider.name} is connected.`;
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
  if (connection.providerKey !== 'nexcall') throw new ApiError(422, 'An API key is only stored on Nexcall.', 'validation_error');
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
