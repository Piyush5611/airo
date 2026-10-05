import { googleDailyStats } from '../../integrations/googleAds.js';
import { metaDailyStats } from '../../integrations/metaAds.js';
import { liveConnections } from '../../repositories/connectionRepo.js';
import * as repo from '../../repositories/adsAgentRepo.js';
import { decryptJson } from '../../utils/cryptoBox.js';

const PLATFORMS = [
  { providerKey: 'meta_ads', platform: 'meta' },
  { providerKey: 'google_ads', platform: 'google' }
];

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function adConnections(organizationId) {
  const found = [];
  for (const { providerKey, platform } of PLATFORMS) {
    const rows = await liveConnections(providerKey);
    for (const row of rows) {
      if (organizationId && Number(row.organizationId) !== Number(organizationId)) continue;
      let secret;
      try { secret = decryptJson(row.ciphertext); } catch { continue; }
      if (!secret?.apiKey || secret.verified !== true || !secret.accountId) continue;
      found.push({ id: row.id, organizationId: row.organizationId, platform, secret });
    }
  }
  return found;
}

async function pull(connection, range) {
  const { secret } = connection;
  if (connection.platform === 'meta') {
    return metaDailyStats({ apiKey: secret.apiKey, accountId: secret.accountId }, range);
  }
  return googleDailyStats({
    refreshToken: secret.apiKey,
    accountId: secret.accountId,
    loginCustomerId: secret.loginCustomerId || '',
    currency: secret.currency || ''
  }, range);
}

export async function syncOrganization(organizationId, range) {
  const connections = await adConnections(organizationId);
  if (!connections.length) return { connections: 0, rows: 0, notes: ['Meta Ads or Google Ads is not connected.'] };
  const chosen = range || ((await repo.lastSynced(organizationId))?.syncedAt ? 'LAST_7_DAYS' : 'LAST_30_DAYS');
  return syncConnections(connections, chosen);
}

export async function syncAll() {
  const connections = await adConnections(null);
  return syncConnections(connections, 'LAST_7_DAYS');
}

async function syncConnections(connections, range) {
  let saved = 0;
  const notes = [];
  for (const connection of connections) {
    try {
      const report = await pull(connection, range);
      const rows = report.rows.map((row) => ({
        organizationId: connection.organizationId,
        connectionId: connection.id,
        platform: connection.platform,
        level: 'campaign',
        externalId: row.id.slice(0, 80),
        name: row.name.slice(0, 180) || row.id,
        date: row.date,
        currency: String(report.currency || '').slice(0, 8),
        spend: number(row.spend) ?? 0,
        impressions: Math.round(number(row.impressions) ?? 0),
        clicks: Math.round(number(row.clicks) ?? 0),
        leads: connection.platform === 'meta' ? number(row.leads) : null,
        conversions: connection.platform === 'google' ? number(row.conversions) : null
      }));
      await repo.upsertMetrics(rows);
      saved += rows.length;
    } catch (error) {
      notes.push(`${connection.platform === 'meta' ? 'Meta' : 'Google'} connection ${connection.id}: ${error.message || 'sync failed'}`);
    }
  }
  return { connections: connections.length, rows: saved, range, notes };
}
