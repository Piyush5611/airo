import { insert, many, one, run } from '../db/sql.js';

export function list(organizationId) {
  return many(
    `SELECT c.id, c.status, c.account_label AS accountLabel, c.mode, c.connected_at AS connectedAt,
            c.last_sync_at AS lastSyncAt, p.provider_key AS providerKey, p.name, p.category, p.description,
            cred.ciphertext AS ciphertext,
            (SELECT j.status FROM integration_sync_jobs j WHERE j.connection_id = c.id ORDER BY j.started_at DESC LIMIT 1) AS lastJobStatus,
            (SELECT COUNT(*) FROM integration_errors e WHERE e.connection_id = c.id AND e.resolved_at IS NULL) AS openErrors
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ?
     ORDER BY p.category, p.name`,
    [organizationId]
  );
}

export function catalog() {
  return many(
    `SELECT id, category, provider_key AS providerKey, name, description, availability FROM integration_providers ORDER BY category, name`
  );
}

export function findProvider(providerKey) {
  return one(
    `SELECT id, category, provider_key AS providerKey, name, description FROM integration_providers WHERE provider_key = ?`,
    [providerKey]
  );
}

export function getConnection(organizationId, id) {
  return one(
    `SELECT c.id, c.organization_id AS organizationId, c.status, c.account_label AS accountLabel, c.mode,
            c.connected_at AS connectedAt, c.last_sync_at AS lastSyncAt, c.webhook_token AS webhookToken,
            c.provider_id AS providerId,
            p.provider_key AS providerKey, p.name, p.category, p.description,
            cfg.mapping_json AS mapping, cfg.sync_json AS syncSettings,
            cred.connection_id AS credentialRow
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_configs cfg ON cfg.connection_id = c.id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND c.id = ?`,
    [organizationId, id]
  );
}

export function createConnection(row) {
  return insert(
    `INSERT INTO integration_connections (organization_id, provider_id, status, account_label, mode, connected_at)
     VALUES (?, ?, ?, ?, 'development', UTC_TIMESTAMP())`,
    [row.organizationId, row.providerId, row.status, row.accountLabel]
  );
}

export function credential(connectionId) {
  return one(`SELECT ciphertext FROM integration_credentials WHERE connection_id = ?`, [connectionId]);
}

export function setMode(organizationId, id, mode) {
  return run(
    `UPDATE integration_connections SET mode = ? WHERE organization_id = ? AND id = ?`,
    [mode, organizationId, id]
  );
}

export function saveCredential(connectionId, ciphertext) {
  return run(
    `INSERT INTO integration_credentials (connection_id, ciphertext) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE ciphertext = VALUES(ciphertext)`,
    [connectionId, ciphertext]
  );
}

export function saveConfig(connectionId, mapping, sync) {
  return run(
    `INSERT INTO integration_configs (connection_id, mapping_json, sync_json) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE mapping_json = VALUES(mapping_json), sync_json = VALUES(sync_json)`,
    [connectionId, JSON.stringify(mapping), JSON.stringify(sync)]
  );
}

export function objects(connectionId) {
  return many(
    `SELECT object_type AS objectType, external_id AS externalId, name, parent_external_id AS parentExternalId, payload
     FROM integration_objects WHERE connection_id = ? ORDER BY object_type, name`,
    [connectionId]
  );
}

export function upsertObject(row) {
  return run(
    `INSERT INTO integration_objects (organization_id, connection_id, object_type, external_id, name, parent_external_id, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), parent_external_id = VALUES(parent_external_id), payload = VALUES(payload)`,
    [row.organizationId, row.connectionId, row.objectType, row.externalId, row.name, row.parentExternalId, JSON.stringify(row.payload || null)]
  );
}

export function setWebhookToken(id, token) {
  return run(
    `UPDATE integration_connections SET webhook_token = ? WHERE id = ? AND webhook_token IS NULL`,
    [token, id]
  );
}

export function findByWebhookToken(token) {
  return one(
    `SELECT id, organization_id AS organizationId, status
     FROM integration_connections WHERE webhook_token = ?`,
    [token]
  );
}

export function jobs(connectionId) {
  return many(
    `SELECT id, status, started_at AS startedAt, finished_at AS finishedAt, summary
     FROM integration_sync_jobs WHERE connection_id = ? ORDER BY started_at DESC LIMIT 12`,
    [connectionId]
  );
}

export function logs(connectionId) {
  return many(
    `SELECT l.level, l.message, l.created_at AS createdAt, j.id AS jobId
     FROM integration_sync_logs l
     JOIN integration_sync_jobs j ON j.id = l.job_id
     WHERE j.connection_id = ?
     ORDER BY l.created_at DESC
     LIMIT 30`,
    [connectionId]
  );
}

export function errors(connectionId) {
  return many(
    `SELECT id, code, message, resolved_at AS resolvedAt, created_at AS createdAt
     FROM integration_errors WHERE connection_id = ? ORDER BY created_at DESC`,
    [connectionId]
  );
}

export function createJob(row) {
  return insert(
    `INSERT INTO integration_sync_jobs (connection_id, organization_id, status, summary) VALUES (?, ?, ?, ?)`,
    [row.connectionId, row.organizationId, row.status, row.summary]
  );
}

export function finishJob(id, status, summary) {
  return run(
    `UPDATE integration_sync_jobs SET status = ?, summary = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?`,
    [status, summary, id]
  );
}

export function addLog(jobId, level, message) {
  return insert(
    `INSERT INTO integration_sync_logs (job_id, level, message) VALUES (?, ?, ?)`,
    [jobId, level, message]
  );
}

export function markSynced(connectionId) {
  return run(`UPDATE integration_connections SET last_sync_at = UTC_TIMESTAMP() WHERE id = ?`, [connectionId]);
}

export function setStatus(organizationId, id, status) {
  return run(
    `UPDATE integration_connections SET status = ? WHERE organization_id = ? AND id = ?`,
    [status, organizationId, id]
  );
}

export function resolveErrors(connectionId) {
  return run(`UPDATE integration_errors SET resolved_at = UTC_TIMESTAMP() WHERE connection_id = ? AND resolved_at IS NULL`, [connectionId]);
}

export function domainCampaigns(organizationId, providerKey) {
  return many(
    `SELECT c.id, c.name, c.project, c.status, c.budget_inr AS budgetInr,
            COALESCE(SUM(m.spend_inr), 0) AS spendInr,
            COALESCE(SUM(m.leads), 0) AS leads
     FROM campaigns c
     LEFT JOIN campaign_metrics m ON m.campaign_id = c.id
       AND m.metric_date >= (UTC_DATE() - INTERVAL 14 DAY)
     WHERE c.organization_id = ? AND c.provider_key = ?
     GROUP BY c.id, c.name, c.project, c.status, c.budget_inr
     ORDER BY c.name`,
    [organizationId, providerKey]
  );
}

export function workspaceId(organizationId) {
  return one(
    `SELECT id FROM workspaces WHERE organization_id = ? ORDER BY is_default DESC, id LIMIT 1`,
    [organizationId]
  );
}

export async function sourceForProvider(organizationId, name, providerKey) {
  const existing = await one(
    `SELECT id FROM lead_sources WHERE organization_id = ? AND provider_key = ? LIMIT 1`,
    [organizationId, providerKey]
  );
  if (existing) return existing.id;
  return insert(
    `INSERT INTO lead_sources (organization_id, name, category, provider_key) VALUES (?, ?, 'advertising', ?)`,
    [organizationId, name, providerKey]
  );
}

export function upsertDomainCampaign(row) {
  return run(
    `INSERT INTO campaigns (organization_id, workspace_id, source_id, provider_key, external_id, name, project, status, budget_inr)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0)
     ON DUPLICATE KEY UPDATE name = VALUES(name)`,
    [row.organizationId, row.workspaceId, row.sourceId, row.providerKey, row.externalId, row.name, row.project]
  );
}

export function domainLeadCount(organizationId, providerKey) {
  return one(
    `SELECT COUNT(*) AS total
     FROM leads l
     JOIN lead_sources s ON s.id = l.source_id
     WHERE l.organization_id = ? AND s.provider_key = ?`,
    [organizationId, providerKey]
  );
}

export function domainSpend(organizationId, providerKey) {
  return one(
    `SELECT COALESCE(SUM(m.spend_inr), 0) AS spendInr, COALESCE(SUM(m.leads), 0) AS leads
     FROM campaign_metrics m
     JOIN campaigns c ON c.id = m.campaign_id
     WHERE m.organization_id = ? AND c.provider_key = ?
       AND m.metric_date >= (UTC_DATE() - INTERVAL 14 DAY)`,
    [organizationId, providerKey]
  );
}
