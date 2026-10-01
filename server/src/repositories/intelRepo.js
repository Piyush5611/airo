import { insert, many, one, run } from '../db/sql.js';

export function qualifiedWindows(organizationId) {
  return one(
    `SELECT
       SUM(created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS thisWeek,
       SUM(created_at < UTC_TIMESTAMP() - INTERVAL 7 DAY AND created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY) AS previousWeek
     FROM leads
     WHERE organization_id = ?
       AND status IN ('qualified','site_visit','negotiation','booked')`,
    [organizationId]
  );
}

export function leadWindows(organizationId) {
  return one(
    `SELECT
       SUM(created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS thisWeek,
       SUM(created_at < UTC_TIMESTAMP() - INTERVAL 7 DAY AND created_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY) AS previousWeek
     FROM leads WHERE organization_id = ?`,
    [organizationId]
  );
}

export function funnel(organizationId) {
  return many(
    `SELECT status, COUNT(*) AS total FROM leads WHERE organization_id = ? GROUP BY status`,
    [organizationId]
  );
}

export function hotLeads(organizationId, scopeSql = '', scopeParams = []) {
  return many(
    `SELECT l.id, l.full_name AS fullName, l.project, l.score, l.status, l.created_at AS createdAt,
            s.name AS sourceName
     FROM leads l
     LEFT JOIN lead_sources s ON s.id = l.source_id
     WHERE l.organization_id = ? AND l.score >= 80 ${scopeSql}
     ORDER BY l.score DESC, l.created_at DESC
     LIMIT 4`,
    [organizationId, ...scopeParams]
  );
}

export function uncontacted(organizationId) {
  return one(
    `SELECT COUNT(*) AS total FROM leads
     WHERE organization_id = ? AND status = 'new' AND score >= 80
       AND created_at <= UTC_TIMESTAMP() - INTERVAL 1 DAY`,
    [organizationId]
  );
}

export function campaignEfficiency(organizationId) {
  return many(
    `SELECT c.id, c.name, c.project, c.provider_key AS providerKey,
       SUM(CASE WHEN m.metric_date >= UTC_DATE() - INTERVAL 7 DAY THEN m.spend_inr ELSE 0 END) AS spendNow,
       SUM(CASE WHEN m.metric_date >= UTC_DATE() - INTERVAL 7 DAY THEN m.leads ELSE 0 END) AS leadsNow,
       SUM(CASE WHEN m.metric_date < UTC_DATE() - INTERVAL 7 DAY AND m.metric_date >= UTC_DATE() - INTERVAL 14 DAY THEN m.spend_inr ELSE 0 END) AS spendPrev,
       SUM(CASE WHEN m.metric_date < UTC_DATE() - INTERVAL 7 DAY AND m.metric_date >= UTC_DATE() - INTERVAL 14 DAY THEN m.leads ELSE 0 END) AS leadsPrev
     FROM campaigns c
     JOIN campaign_metrics m ON m.campaign_id = c.id
     WHERE c.organization_id = ?
     GROUP BY c.id, c.name, c.project, c.provider_key`,
    [organizationId]
  );
}

export function dailySeries(organizationId) {
  return many(
    `SELECT m.metric_date AS metricDate,
            SUM(m.leads) AS leads,
            SUM(m.qualified_leads) AS qualifiedLeads,
            SUM(m.spend_inr) AS spendInr
     FROM campaign_metrics m
     WHERE m.organization_id = ? AND m.metric_date >= UTC_DATE() - INTERVAL 14 DAY
     GROUP BY m.metric_date
     ORDER BY m.metric_date`,
    [organizationId]
  );
}

export function sourcePerformance(organizationId) {
  return many(
    `SELECT s.name, s.category, s.provider_key AS providerKey, COUNT(l.id) AS leads,
            SUM(l.status IN ('qualified','site_visit','negotiation','booked')) AS qualified,
            SUM(l.status = 'booked') AS booked
     FROM lead_sources s
     LEFT JOIN leads l ON l.source_id = s.id
     WHERE s.organization_id = ?
     GROUP BY s.id, s.name, s.category, s.provider_key
     ORDER BY leads DESC`,
    [organizationId]
  );
}

export function pipelineValue(organizationId) {
  return one(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'open' THEN value_inr END), 0) AS openValue,
       COALESCE(SUM(CASE WHEN status = 'won' THEN value_inr END), 0) AS wonValue,
       SUM(status = 'open') AS openDeals,
       SUM(status = 'won') AS wonDeals,
       SUM(status = 'lost') AS lostDeals
     FROM opportunities WHERE organization_id = ?`,
    [organizationId]
  );
}

export function callSummary(organizationId) {
  return one(
    `SELECT COUNT(*) AS total,
            SUM(status = 'missed') AS missed,
            AVG(a.score) AS averageScore
     FROM calls c
     LEFT JOIN call_analysis a ON a.call_id = c.id
     WHERE c.organization_id = ?`,
    [organizationId]
  );
}

export function problemConnections(organizationId) {
  return many(
    `SELECT c.id, c.status, p.name, p.provider_key AS providerKey,
            (SELECT e.message FROM integration_errors e
             WHERE e.connection_id = c.id AND e.resolved_at IS NULL
             ORDER BY e.created_at DESC LIMIT 1) AS message
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     WHERE c.organization_id = ? AND c.status IN ('error', 'degraded')`,
    [organizationId]
  );
}

export function upsertInsight(row) {
  return run(
    `INSERT INTO ai_insights (organization_id, insight_key, title, body, evidence, severity, action_label, action_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), evidence = VALUES(evidence),
       severity = VALUES(severity), action_label = VALUES(action_label), action_path = VALUES(action_path)`,
    [row.organizationId, row.key, row.title, row.body, row.evidence, row.severity, row.actionLabel, row.actionPath]
  );
}

export function upsertRecommendation(row) {
  return run(
    `INSERT INTO ai_recommendations (organization_id, rec_key, category, title, body, evidence, action_label, action_path, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
     ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), evidence = VALUES(evidence),
       action_label = VALUES(action_label), action_path = VALUES(action_path)`,
    [row.organizationId, row.key, row.category, row.title, row.body, row.evidence, row.actionLabel, row.actionPath]
  );
}

export function upsertAlert(row) {
  return run(
    `INSERT INTO ai_alerts (organization_id, alert_key, category, title, body, priority, action_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), body = VALUES(body), priority = VALUES(priority), action_path = VALUES(action_path)`,
    [row.organizationId, row.key, row.category, row.title, row.body, row.priority, row.actionPath]
  );
}

export function insights(organizationId) {
  return many(
    `SELECT insight_key AS insightKey, title, body, evidence, severity, action_label AS actionLabel, action_path AS actionPath
     FROM ai_insights WHERE organization_id = ? ORDER BY FIELD(severity, 'critical', 'watch', 'info'), title`,
    [organizationId]
  );
}

export function recommendations(organizationId, status) {
  const params = [organizationId];
  let sql = `SELECT id, rec_key AS recKey, category, title, body, evidence, action_label AS actionLabel,
                    action_path AS actionPath, status
             FROM ai_recommendations WHERE organization_id = ?`;
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ` ORDER BY FIELD(status, 'open', 'accepted', 'dismissed'), category`;
  return many(sql, params);
}

export function setRecommendationStatus(organizationId, id, status) {
  return run(
    `UPDATE ai_recommendations SET status = ? WHERE organization_id = ? AND id = ?`,
    [status, organizationId, id]
  );
}

export function alerts(organizationId) {
  return many(
    `SELECT alert_key AS alertKey, category, title, body, priority, action_path AS actionPath
     FROM ai_alerts WHERE organization_id = ? ORDER BY FIELD(priority, 'high', 'normal', 'low')`,
    [organizationId]
  );
}

export function reports(organizationId) {
  return many(
    `SELECT slug, name, report_kind AS reportKind, description, is_custom AS isCustom
     FROM reports WHERE organization_id = ? ORDER BY is_custom, name`,
    [organizationId]
  );
}

export function report(organizationId, slug) {
  return one(
    `SELECT slug, name, report_kind AS reportKind, description, config_json AS config, is_custom AS isCustom
     FROM reports WHERE organization_id = ? AND slug = ?`,
    [organizationId, slug]
  );
}

export function notifyOwners(organizationId, notification) {
  return run(
    `INSERT INTO notifications (organization_id, user_id, notification_key, category, priority, title, body, action_path)
     SELECT ?, ou.user_id, ?, ?, ?, ?, ?, ?
     FROM organization_users ou
     JOIN roles r ON r.id = ou.role_id
     WHERE ou.organization_id = ? AND ou.status = 'active' AND r.role_key IN ('owner', 'admin')
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.user_id = ou.user_id AND n.notification_key = ? AND n.read_at IS NULL
       )`,
    [
      organizationId,
      notification.key,
      notification.category,
      notification.priority,
      notification.title,
      notification.body,
      notification.actionPath,
      organizationId,
      notification.key
    ]
  );
}

export function organizationIds() {
  return many(`SELECT id FROM organizations`);
}

const STALE_COLUMNS = {
  ai_insights: 'insight_key',
  ai_alerts: 'alert_key',
  ai_recommendations: 'rec_key'
};

export function clearStale(organizationId, table, keys) {
  const column = STALE_COLUMNS[table];
  if (!column) return Promise.resolve();
  if (!keys.length) return run(`DELETE FROM ${table} WHERE organization_id = ?`, [organizationId]);
  return run(
    `DELETE FROM ${table} WHERE organization_id = ? AND ${column} NOT IN (${keys.map(() => '?').join(',')})`,
    [organizationId, ...keys]
  );
}

export function ownConversation(id, organizationId, userId) {
  return one(
    `SELECT id FROM ai_conversations WHERE id = ? AND organization_id = ? AND user_id = ?`,
    [id, organizationId, userId]
  );
}

export function saveConversation({ organizationId, userId, title }) {
  return insert(
    `INSERT INTO ai_conversations (organization_id, user_id, title) VALUES (?, ?, ?)`,
    [organizationId, userId, title.slice(0, 160)]
  );
}

export function saveMessage({ conversationId, role, content, payload }) {
  return insert(
    `INSERT INTO ai_messages (conversation_id, role, content, payload) VALUES (?, ?, ?, ?)`,
    [conversationId, role, content, payload ? JSON.stringify(payload) : null]
  );
}

export function conversations(organizationId, userId) {
  return many(
    `SELECT id, title, created_at AS createdAt FROM ai_conversations
     WHERE organization_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 12`,
    [organizationId, userId]
  );
}

export function messages(conversationId, organizationId) {
  return many(
    `SELECT m.role, m.content, m.payload, m.created_at AS createdAt
     FROM ai_messages m
     JOIN ai_conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = ? AND c.organization_id = ?
     ORDER BY m.id`,
    [conversationId, organizationId]
  );
}

export function logUsage({ organizationId, userId, surface, excerpt }) {
  return insert(
    `INSERT INTO ai_usage_logs (organization_id, user_id, surface, prompt_excerpt) VALUES (?, ?, ?, ?)`,
    [organizationId, userId, surface, excerpt?.slice(0, 180) || null]
  );
}

export function notifications(userId) {
  return many(
    `SELECT id, category, priority, title, body, action_path AS actionPath, read_at AS readAt, created_at AS createdAt
     FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`,
    [userId]
  );
}

export function markRead(userId, id) {
  return run(`UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND id = ?`, [userId, id]);
}

export function markAllRead(userId) {
  return run(`UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL`, [userId]);
}

export function searchLeads(organizationId, like, scopeSql, scopeParams) {
  return many(
    `SELECT l.id, l.full_name AS label, l.project AS detail, 'lead' AS kind
     FROM leads l
     WHERE l.organization_id = ? AND (l.full_name LIKE ? OR l.phone LIKE ? OR l.project LIKE ?) ${scopeSql}
     ORDER BY l.created_at DESC LIMIT 6`,
    [organizationId, like, like, like, ...scopeParams]
  );
}

export function searchCampaigns(organizationId, like) {
  return many(
    `SELECT id, name AS label, project AS detail, 'campaign' AS kind
     FROM campaigns WHERE organization_id = ? AND name LIKE ? LIMIT 5`,
    [organizationId, like]
  );
}

export function searchCalls(organizationId, like) {
  return many(
    `SELECT c.id, COALESCE(l.full_name, 'Call') AS label, c.outcome AS detail, 'call' AS kind
     FROM calls c LEFT JOIN leads l ON l.id = c.lead_id
     WHERE c.organization_id = ? AND (l.full_name LIKE ? OR c.outcome LIKE ?)
     LIMIT 5`,
    [organizationId, like, like]
  );
}

export function audit(organizationId) {
  return many(
    `SELECT a.action, a.resource_name AS resourceName, a.resource_id AS resourceId, a.created_at AS createdAt,
            u.full_name AS actorName
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.organization_id = ?
     ORDER BY a.created_at DESC LIMIT 40`,
    [organizationId]
  );
}
