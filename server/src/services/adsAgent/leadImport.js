import { metaFormLeads } from '../../integrations/metaAds.js';
import * as repo from '../../repositories/adsAgentRepo.js';
import { sourceForProvider, upsertDomainCampaign, workspaceId } from '../../repositories/connectionRepo.js';
import { addLeadActivity, createLead } from '../../repositories/growthRepo.js';
import { adConnections } from './metricsSync.js';

const FIRST_DAYS = 30;
const REPEAT_DAYS = 3;

export function phoneDigits(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function utcDateTime(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function campaignRef(organizationId, wsId, sourceId, row, cache) {
  if (!row.campaignId) return null;
  const externalId = `meta:${row.campaignId}`;
  if (cache.has(externalId)) return cache.get(externalId);
  const name = (row.campaignName || `Meta campaign ${row.campaignId}`).slice(0, 180);
  await upsertDomainCampaign({ organizationId, workspaceId: wsId, sourceId, providerKey: 'meta_ads', externalId, name, project: name.slice(0, 120) });
  const id = (await repo.campaignIdByExternal(organizationId, externalId))?.id || null;
  cache.set(externalId, id);
  return id;
}

async function importRow(connection, row, ctx) {
  const { organizationId } = connection;
  const claimed = await repo.claimLeadImport({
    organizationId,
    connectionId: connection.id,
    platform: 'meta',
    externalLeadId: row.id,
    campaignExternalId: row.campaignId || null,
    adExternalId: row.adId,
    formExternalId: row.formId,
    submittedAt: utcDateTime(row.createdTime)
  });
  if (!claimed) return 'seen';
  try {
    const digits = phoneDigits(row.phone);
    if (!digits) {
      await repo.finishLeadImport(organizationId, 'meta', row.id, null, 'skipped');
      return 'skipped';
    }
    const existing = await repo.leadByPhone(organizationId, digits);
    if (existing) {
      await addLeadActivity({ organizationId, leadId: existing.id, actorUserId: null, activityType: 'ad_lead', body: `Submitted a Meta lead form again${row.campaignName ? ` (${row.campaignName.slice(0, 120)})` : ''}.` });
      await repo.finishLeadImport(organizationId, 'meta', row.id, existing.id, 'matched');
      return 'matched';
    }
    const campaignId = await campaignRef(organizationId, ctx.workspaceId, ctx.sourceId, row, ctx.campaigns);
    const leadId = await createLead({
      organizationId,
      workspaceId: ctx.workspaceId,
      sourceId: ctx.sourceId,
      campaignId,
      assignedUserId: null,
      fullName: row.name || 'Meta lead',
      phone: row.phone,
      email: row.email || null,
      project: (row.campaignName || 'Meta lead form').slice(0, 120),
      city: row.city || null,
      score: 40,
      intent: 'medium',
      budgetInr: null,
      configuration: null,
      notesSummary: null
    });
    await addLeadActivity({ organizationId, leadId, actorUserId: null, activityType: 'created', body: 'Lead came from a Meta lead form.' });
    await repo.finishLeadImport(organizationId, 'meta', row.id, leadId, 'created');
    return 'created';
  } catch (error) {
    await repo.releaseLeadImport(organizationId, 'meta', row.id).catch(() => {});
    throw error;
  }
}

export async function importConnection(connection) {
  const { organizationId, secret } = connection;
  const days = (await repo.hasLeadImports(organizationId, connection.id)) ? REPEAT_DAYS : FIRST_DAYS;
  const since = Date.now() / 1000 - days * 86400;
  const result = await metaFormLeads({ apiKey: secret.apiKey, accountId: secret.accountId }, since);
  const counts = { created: 0, matched: 0, skipped: 0, seen: 0, failed: 0 };
  if (!result.rows.length) return { counts, notes: result.notes };
  const ws = await workspaceId(organizationId);
  if (!ws) return { counts, notes: ['No workspace to add leads to.'] };
  const ctx = {
    workspaceId: ws.id,
    sourceId: await sourceForProvider(organizationId, 'Meta Lead Ads', 'meta_ads'),
    campaigns: new Map()
  };
  for (const row of result.rows) {
    try {
      counts[await importRow(connection, row, ctx)] += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return { counts, notes: result.notes };
}

export async function importOrganization(organizationId) {
  const connections = (await adConnections(organizationId)).filter((item) => item.platform === 'meta');
  const totals = { created: 0, matched: 0, skipped: 0, seen: 0, failed: 0 };
  const notes = [];
  for (const connection of connections) {
    try {
      const { counts, notes: more } = await importConnection(connection);
      for (const key of Object.keys(totals)) totals[key] += counts[key];
      notes.push(...more);
    } catch (error) {
      notes.push(`connection ${connection.id}: ${error.message}`);
    }
  }
  return { connections: connections.length, ...totals, notes };
}

export async function importAll() {
  const connections = (await adConnections(null)).filter((item) => item.platform === 'meta');
  const totals = { connections: connections.length, created: 0, matched: 0, failed: 0 };
  const notes = [];
  for (const connection of connections) {
    try {
      const { counts, notes: more } = await importConnection(connection);
      totals.created += counts.created;
      totals.matched += counts.matched;
      totals.failed += counts.failed;
      notes.push(...more.map((note) => `org ${connection.organizationId}: ${note}`));
    } catch (error) {
      notes.push(`org ${connection.organizationId}: ${error.message}`);
    }
  }
  return { ...totals, notes };
}
