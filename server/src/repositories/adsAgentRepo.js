import { insert, many, one, run } from '../db/sql.js';

export function settings(organizationId) {
  return one(
    `SELECT mode, daily_spend_cap AS dailySpendCap, monthly_spend_cap AS monthlySpendCap,
            max_budget_change_pct AS maxBudgetChangePct, max_actions_per_day AS maxActionsPerDay,
            min_spend_for_decision AS minSpendForDecision, kill_switch AS killSwitch, updated_at AS updatedAt
     FROM ads_agent_settings WHERE organization_id = ?`,
    [organizationId]
  );
}

export function saveSettings(organizationId, userId, row) {
  return run(
    `INSERT INTO ads_agent_settings
       (organization_id, mode, daily_spend_cap, monthly_spend_cap, max_budget_change_pct, max_actions_per_day, min_spend_for_decision, kill_switch, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mode = VALUES(mode), daily_spend_cap = VALUES(daily_spend_cap),
       monthly_spend_cap = VALUES(monthly_spend_cap), max_budget_change_pct = VALUES(max_budget_change_pct),
       max_actions_per_day = VALUES(max_actions_per_day), min_spend_for_decision = VALUES(min_spend_for_decision),
       kill_switch = VALUES(kill_switch), updated_by = VALUES(updated_by)`,
    [
      organizationId,
      row.mode,
      row.dailySpendCap,
      row.monthlySpendCap,
      row.maxBudgetChangePct,
      row.maxActionsPerDay,
      row.minSpendForDecision,
      row.killSwitch ? 1 : 0,
      userId
    ]
  );
}

export function upsertMetrics(rows) {
  if (!rows.length) return Promise.resolve();
  const values = rows.map((row) => [
    row.organizationId,
    row.connectionId,
    row.platform,
    row.level,
    row.externalId,
    row.name,
    row.date,
    row.currency,
    row.spend,
    row.impressions,
    row.clicks,
    row.leads,
    row.conversions
  ]);
  return run(
    `INSERT INTO ad_metrics_daily
       (organization_id, connection_id, platform, level, external_id, name, metric_date, currency, spend, impressions, clicks, leads, conversions)
     VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name), currency = VALUES(currency), spend = VALUES(spend),
       impressions = VALUES(impressions), clicks = VALUES(clicks), leads = VALUES(leads), conversions = VALUES(conversions)`,
    [values]
  );
}

export function dailyTotals(organizationId, days) {
  return many(
    `SELECT DATE_FORMAT(metric_date, '%Y-%m-%d') AS date, platform, currency,
            SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(leads) AS leads, SUM(conversions) AS conversions
     FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'campaign' AND metric_date >= (UTC_DATE() - INTERVAL ? DAY)
     GROUP BY metric_date, platform, currency
     ORDER BY metric_date`,
    [organizationId, days]
  );
}

export function campaignTotals(organizationId, days) {
  return many(
    `SELECT platform, connection_id AS connectionId, external_id AS externalId, MAX(name) AS name, currency,
            SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks,
            SUM(leads) AS leads, SUM(conversions) AS conversions, COUNT(*) AS days
     FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'campaign' AND metric_date >= (UTC_DATE() - INTERVAL ? DAY)
     GROUP BY platform, connection_id, external_id, currency
     ORDER BY SUM(spend) DESC
     LIMIT 100`,
    [organizationId, days]
  );
}

export function lastSynced(organizationId) {
  return one(`SELECT MAX(synced_at) AS syncedAt FROM ad_metrics_daily WHERE organization_id = ?`, [organizationId]);
}

export function addDecision(row) {
  return insert(
    `INSERT INTO ai_decisions
       (organization_id, connection_id, platform, decision_type, target_level, target_external_id, target_name,
        reason, evidence, proposed_change, guardrail, mode, status, error, decided_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.organizationId,
      row.connectionId || null,
      row.platform || null,
      row.type,
      row.targetLevel || null,
      row.targetExternalId || null,
      row.targetName || null,
      row.reason,
      row.evidence ? JSON.stringify(row.evidence) : null,
      row.proposedChange ? JSON.stringify(row.proposedChange) : null,
      row.guardrail ? JSON.stringify(row.guardrail) : null,
      row.mode,
      row.status,
      row.error || null,
      row.decidedBy || null
    ]
  );
}

export function decisions(organizationId, limit) {
  return many(
    `SELECT id, platform, decision_type AS type, target_level AS targetLevel, target_external_id AS targetExternalId,
            target_name AS targetName, reason, evidence, proposed_change AS proposedChange, guardrail, mode, status,
            error, outcome, created_at AS createdAt, updated_at AS updatedAt
     FROM ai_decisions WHERE organization_id = ?
     ORDER BY id DESC LIMIT ?`,
    [organizationId, limit]
  );
}

export function actionsToday(organizationId) {
  return one(
    `SELECT COUNT(*) AS total FROM ai_decisions
     WHERE organization_id = ? AND status = 'applied' AND updated_at >= CURDATE()`,
    [organizationId]
  );
}

export function profile(organizationId) {
  return one(`SELECT profile, updated_at AS updatedAt FROM business_profiles WHERE organization_id = ?`, [organizationId]);
}

export function saveProfile(organizationId, userId, value) {
  return run(
    `INSERT INTO business_profiles (organization_id, profile, updated_by) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE profile = VALUES(profile), updated_by = VALUES(updated_by)`,
    [organizationId, JSON.stringify(value), userId]
  );
}

export function strategies(organizationId, limit) {
  return many(
    `SELECT id, version, status, profile_snapshot AS profileSnapshot, metrics_snapshot AS metricsSnapshot, strategy, model,
            created_at AS createdAt, approved_at AS approvedAt
     FROM ad_strategies WHERE organization_id = ? ORDER BY version DESC LIMIT ?`,
    [organizationId, limit]
  );
}

export function strategy(organizationId, id) {
  return one(`SELECT id, version, status FROM ad_strategies WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export async function addStrategy(row) {
  const next = await one(`SELECT COALESCE(MAX(version), 0) + 1 AS version FROM ad_strategies WHERE organization_id = ?`, [row.organizationId]);
  const id = await insert(
    `INSERT INTO ad_strategies (organization_id, version, status, profile_snapshot, metrics_snapshot, strategy, model, created_by)
     VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
    [
      row.organizationId,
      next.version,
      JSON.stringify(row.profile),
      row.metrics ? JSON.stringify(row.metrics) : null,
      JSON.stringify(row.strategy),
      row.model || null,
      row.userId || null
    ]
  );
  return { id, version: next.version };
}

export async function approveStrategy(organizationId, id, userId) {
  await run(`UPDATE ad_strategies SET status = 'archived' WHERE organization_id = ? AND status = 'approved' AND id <> ?`, [organizationId, id]);
  return run(
    `UPDATE ad_strategies SET status = 'approved', approved_by = ?, approved_at = UTC_TIMESTAMP() WHERE organization_id = ? AND id = ?`,
    [userId, organizationId, id]
  );
}

export function archiveStrategy(organizationId, id) {
  return run(`UPDATE ad_strategies SET status = 'archived' WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function approvedStrategy(organizationId, id) {
  return one(
    `SELECT id, version, status, profile_snapshot AS profileSnapshot, strategy
     FROM ad_strategies WHERE organization_id = ? AND id = ? AND status = 'approved'`,
    [organizationId, id]
  );
}

export function spendNow(organizationId) {
  return one(
    `SELECT COALESCE(SUM(CASE WHEN metric_date = CURDATE() THEN spend END), 0) AS spendToday,
            COALESCE(SUM(spend), 0) AS spendMonth
     FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'campaign' AND metric_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')`,
    [organizationId]
  );
}

const LAUNCH_FIELDS = `id, strategy_id AS strategyId, platform, connection_id AS connectionId, status, creative, settings,
  external_campaign_id AS externalCampaignId, error, model, created_at AS createdAt, updated_at AS updatedAt,
  launched_at AS launchedAt, published_at AS publishedAt`;

export function launches(organizationId, limit) {
  return many(`SELECT ${LAUNCH_FIELDS} FROM ad_launches WHERE organization_id = ? ORDER BY id DESC LIMIT ?`, [organizationId, limit]);
}

export function launch(organizationId, id) {
  return one(`SELECT ${LAUNCH_FIELDS} FROM ad_launches WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function addLaunch(row) {
  return insert(
    `INSERT INTO ad_launches (organization_id, strategy_id, platform, connection_id, creative, settings, model, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.organizationId, row.strategyId, row.platform, row.connectionId, JSON.stringify(row.creative), JSON.stringify(row.settings), row.model || null, row.userId || null]
  );
}

export function updateLaunchDraft(organizationId, id, { creative, settings }) {
  return run(
    `UPDATE ad_launches SET creative = ?, settings = ?, error = NULL WHERE organization_id = ? AND id = ? AND status = 'draft'`,
    [JSON.stringify(creative), JSON.stringify(settings), organizationId, id]
  );
}

export function setLaunchError(organizationId, id, error) {
  return run(`UPDATE ad_launches SET error = ? WHERE organization_id = ? AND id = ?`, [String(error || '').slice(0, 400), organizationId, id]);
}

export function markLaunchCreated(organizationId, id, campaignId, userId) {
  return run(
    `UPDATE ad_launches SET status = 'created', external_campaign_id = ?, error = NULL, launched_by = ?, launched_at = UTC_TIMESTAMP()
     WHERE organization_id = ? AND id = ? AND status = 'draft'`,
    [campaignId, userId, organizationId, id]
  );
}

export function markLaunchPublished(organizationId, id, userId) {
  return run(
    `UPDATE ad_launches SET status = 'published', error = NULL, published_by = ?, published_at = UTC_TIMESTAMP()
     WHERE organization_id = ? AND id = ? AND status = 'created'`,
    [userId, organizationId, id]
  );
}

export function cancelLaunch(organizationId, id) {
  return run(`UPDATE ad_launches SET status = 'cancelled' WHERE organization_id = ? AND id = ? AND status = 'draft'`, [organizationId, id]);
}

export function setDecisionStatus(organizationId, id, status, extra = {}) {
  return run(
    `UPDATE ai_decisions SET status = ?, error = ?, outcome = ? WHERE organization_id = ? AND id = ?`,
    [status, extra.error ? String(extra.error).slice(0, 300) : null, extra.outcome ? JSON.stringify(extra.outcome) : null, organizationId, id]
  );
}

export async function claimJob(jobKey, minutes) {
  await run(`INSERT IGNORE INTO agent_jobs (job_key) VALUES (?)`, [jobKey]);
  const result = await run(
    `UPDATE agent_jobs SET locked_until = UTC_TIMESTAMP() + INTERVAL ? MINUTE, last_started_at = UTC_TIMESTAMP()
     WHERE job_key = ? AND (locked_until IS NULL OR locked_until < UTC_TIMESTAMP())`,
    [minutes, jobKey]
  );
  return result.affectedRows === 1;
}

export function finishJob(jobKey, { status, summary = null, error = null }) {
  return run(
    `UPDATE agent_jobs SET locked_until = NULL, last_finished_at = UTC_TIMESTAMP(), last_status = ?,
       last_summary = ?, last_error = ?
     WHERE job_key = ?`,
    [status, summary ? String(summary).slice(0, 300) : null, error ? String(error).slice(0, 300) : null, jobKey]
  );
}

export function jobState(jobKey) {
  return one(
    `SELECT last_started_at AS startedAt, last_finished_at AS finishedAt, last_status AS status,
            last_summary AS summary, last_error AS error, locked_until AS lockedUntil
     FROM agent_jobs WHERE job_key = ?`,
    [jobKey]
  );
}
