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
    row.campaignExternalId || null,
    row.adsetExternalId || null,
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
       (organization_id, connection_id, platform, level, external_id, name, campaign_external_id, adset_external_id,
        metric_date, currency, spend, impressions, clicks, leads, conversions)
     VALUES ?
     ON DUPLICATE KEY UPDATE name = VALUES(name), campaign_external_id = VALUES(campaign_external_id),
       adset_external_id = VALUES(adset_external_id), currency = VALUES(currency), spend = VALUES(spend),
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
     WHERE organization_id = ? AND status = 'applied'
       AND decision_type IN ('pause', 'budget_decrease', 'budget_increase', 'scale_winner', 'experiment_winner')
       AND updated_at >= CURDATE()`,
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

export function latestApprovedStrategy(organizationId) {
  return one(
    `SELECT id, version, status, profile_snapshot AS profileSnapshot, strategy
     FROM ad_strategies WHERE organization_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1`,
    [organizationId]
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

export function decision(organizationId, id) {
  return one(
    `SELECT id, connection_id AS connectionId, platform, decision_type AS type, target_level AS targetLevel, target_external_id AS targetExternalId,
            target_name AS targetName, proposed_change AS proposedChange, status
     FROM ai_decisions WHERE organization_id = ? AND id = ?`,
    [organizationId, id]
  );
}

export async function claimDecision(organizationId, id, userId) {
  const result = await run(
    `UPDATE ai_decisions SET status = 'approved', decided_by = ?, error = NULL
     WHERE organization_id = ? AND id = ? AND status IN ('proposed', 'blocked')`,
    [userId, organizationId, id]
  );
  return result.affectedRows === 1;
}

export function finishDecision(organizationId, id, status, { guardrail, outcome, error } = {}) {
  return run(
    `UPDATE ai_decisions SET status = ?, guardrail = COALESCE(?, guardrail), outcome = ?, error = ? WHERE organization_id = ? AND id = ?`,
    [
      status,
      guardrail ? JSON.stringify(guardrail) : null,
      outcome ? JSON.stringify(outcome) : null,
      error ? String(error).slice(0, 300) : null,
      organizationId,
      id
    ]
  );
}

export function campaignDaily(organizationId, days) {
  return many(
    `SELECT platform, connection_id AS connectionId, external_id AS externalId, name, currency,
            DATE_FORMAT(metric_date, '%Y-%m-%d') AS date, spend, impressions, clicks, leads, conversions
     FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'campaign' AND metric_date >= (CURDATE() - INTERVAL ? DAY)
     ORDER BY metric_date`,
    [organizationId, days]
  );
}

export function monthSpendByCurrency(organizationId) {
  return many(
    `SELECT currency, SUM(spend) AS spend FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'campaign' AND metric_date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
     GROUP BY currency`,
    [organizationId]
  );
}

export function organizationsWithMetrics() {
  return many(`SELECT DISTINCT organization_id AS organizationId FROM ad_metrics_daily WHERE metric_date >= (CURDATE() - INTERVAL 10 DAY)`);
}

export async function recentDecisionExists(organizationId, types, targetExternalId, hours) {
  const row = await one(
    `SELECT id FROM ai_decisions
     WHERE organization_id = ? AND decision_type IN (?) AND (target_external_id <=> ?)
       AND status IN ('proposed', 'blocked', 'approved', 'applied') AND created_at >= (NOW() - INTERVAL ? HOUR)
     LIMIT 1`,
    [organizationId, [].concat(types), targetExternalId, hours]
  );
  return Boolean(row);
}

export function adWindow(organizationId, days) {
  return many(
    `SELECT connection_id AS connectionId, external_id AS externalId, MAX(name) AS name,
            campaign_external_id AS campaignId, adset_external_id AS adsetId, currency,
            SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(leads) AS leads,
            COUNT(*) AS days, DATE_FORMAT(MAX(CASE WHEN spend > 0 THEN metric_date END), '%Y-%m-%d') AS lastSpendDate
     FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'ad' AND platform = 'meta'
       AND metric_date >= (CURDATE() - INTERVAL ? DAY) AND metric_date < CURDATE()
     GROUP BY connection_id, external_id, campaign_external_id, adset_external_id, currency`,
    [organizationId, days]
  );
}

export function adObjects(organizationId) {
  return many(
    `SELECT object_type AS type, external_id AS externalId,
            JSON_UNQUOTE(JSON_EXTRACT(payload, '$.origin')) AS origin,
            JSON_UNQUOTE(JSON_EXTRACT(payload, '$.status')) AS status
     FROM integration_objects
     WHERE organization_id = ? AND object_type IN ('campaign', 'ad')`,
    [organizationId]
  );
}

export function openDecisions(organizationId, limit) {
  return many(
    `SELECT id, platform, decision_type AS type, target_name AS targetName, reason, status, created_at AS createdAt
     FROM ai_decisions WHERE organization_id = ? AND status IN ('proposed', 'blocked')
     ORDER BY id DESC LIMIT ?`,
    [organizationId, limit]
  );
}

export function dismissDecision(organizationId, id, userId) {
  return run(
    `UPDATE ai_decisions SET status = 'rejected', decided_by = ? WHERE organization_id = ? AND id = ? AND status IN ('proposed', 'blocked')`,
    [userId, organizationId, id]
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

export async function claimLeadImport(row) {
  const result = await run(
    `INSERT IGNORE INTO ad_lead_imports
       (organization_id, connection_id, platform, external_lead_id, campaign_external_id, ad_external_id, form_external_id, outcome, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', ?)`,
    [row.organizationId, row.connectionId, row.platform, row.externalLeadId, row.campaignExternalId || null, row.adExternalId || null, row.formExternalId || null, row.submittedAt || null]
  );
  return result.affectedRows === 1;
}

export function recordWebsiteImport(row) {
  return insert(
    `INSERT INTO ad_lead_imports
       (organization_id, connection_id, platform, external_lead_id, lead_id, campaign_external_id, outcome, submitted_at, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 'website')`,
    [row.organizationId, row.connectionId, row.platform, row.externalLeadId, row.leadId, row.campaignExternalId || null, row.outcome]
  );
}

export function finishLeadImport(organizationId, platform, externalLeadId, leadId, outcome) {
  return run(
    `UPDATE ad_lead_imports SET lead_id = ?, outcome = ? WHERE organization_id = ? AND platform = ? AND external_lead_id = ?`,
    [leadId, outcome, organizationId, platform, externalLeadId]
  );
}

export function releaseLeadImport(organizationId, platform, externalLeadId) {
  return run(`DELETE FROM ad_lead_imports WHERE organization_id = ? AND platform = ? AND external_lead_id = ? AND lead_id IS NULL`, [organizationId, platform, externalLeadId]);
}

export async function hasLeadImports(organizationId, connectionId) {
  return Boolean(await one(`SELECT id FROM ad_lead_imports WHERE organization_id = ? AND connection_id = ? LIMIT 1`, [organizationId, connectionId]));
}

export function leadByPhone(organizationId, digits) {
  return one(
    `SELECT id FROM leads WHERE organization_id = ? AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = ? ORDER BY id LIMIT 1`,
    [organizationId, digits]
  );
}

export function campaignIdByExternal(organizationId, externalId) {
  return one(`SELECT id FROM campaigns WHERE organization_id = ? AND external_id = ?`, [organizationId, externalId]);
}

// First touch: a lead counts for the campaign whose form created it.
export function leadQuality(organizationId, days) {
  return many(
    `SELECT i.campaign_external_id AS externalId,
            COUNT(*) AS crmLeads,
            SUM(l.status IN ('qualified', 'site_visit', 'negotiation', 'booked')) AS qualified,
            SUM(l.status = 'booked') AS booked,
            SUM(l.status IN ('unqualified', 'lost')) AS rejected,
            SUM(CASE WHEN l.status = 'booked' THEN l.deal_value_inr END) AS revenue,
            SUM(l.status = 'booked' AND l.deal_value_inr IS NULL) AS bookedWithoutValue
     FROM ad_lead_imports i
     JOIN leads l ON l.id = i.lead_id AND l.organization_id = i.organization_id
     WHERE i.organization_id = ? AND i.outcome = 'created' AND i.submitted_at >= (UTC_DATE() - INTERVAL ? DAY)
     GROUP BY i.campaign_external_id`,
    [organizationId, days]
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
