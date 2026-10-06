import { insert, many, one, run } from '../db/sql.js';

export function counts() {
  return one(
    `SELECT
       (SELECT COUNT(*) FROM organizations) AS organizations,
       (SELECT COUNT(*) FROM organizations WHERE status = 'active') AS activeOrganizations,
       (SELECT COUNT(*) FROM users WHERE realm = 'client') AS clientUsers,
       (SELECT COUNT(*) FROM users WHERE realm = 'platform') AS platformUsers,
       (SELECT COUNT(*) FROM tickets WHERE status IN ('open','escalated')) AS openTickets,
       (SELECT COUNT(*) FROM integration_connections WHERE status IN ('error','degraded')) AS unhealthyConnections,
       (SELECT COUNT(*) FROM payments WHERE status = 'failed') AS failedPayments`
  );
}

export function recentAudit() {
  return many(
    `SELECT a.action, a.resource_name AS resourceName, a.created_at AS createdAt, u.full_name AS actorName, o.name AS organizationName
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN organizations o ON o.id = a.organization_id
     ORDER BY a.created_at DESC LIMIT 12`
  );
}

export function organizations() {
  return many(
    `SELECT o.id, o.name, o.city, o.status, o.health_score AS healthScore, o.onboarding_step AS onboardingStep, o.created_at AS createdAt,
            p.name AS planName, s.status AS subscriptionStatus,
            (SELECT COUNT(*) FROM organization_users ou WHERE ou.organization_id = o.id) AS members,
            (SELECT COUNT(*) FROM leads l WHERE l.organization_id = o.id) AS leads
     FROM organizations o
     LEFT JOIN subscriptions s ON s.organization_id = o.id
     LEFT JOIN plans p ON p.id = s.plan_id
     ORDER BY o.name`
  );
}

export function organization(id) {
  return one(
    `SELECT o.id, o.name, o.legal_name AS legalName, o.slug, o.city, o.sector, o.status, o.health_score AS healthScore,
            o.onboarding_step AS onboardingStep, o.created_at AS createdAt, p.name AS planName,
            s.status AS subscriptionStatus, s.current_period_end AS periodEnd, p.monthly_inr AS monthlyInr
     FROM organizations o
     LEFT JOIN subscriptions s ON s.organization_id = o.id
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE o.id = ?`,
    [id]
  );
}

export function orgUsage(id) {
  return one(
    `SELECT
       (SELECT COUNT(*) FROM leads WHERE organization_id = ?) AS leads,
       (SELECT COUNT(*) FROM campaigns WHERE organization_id = ?) AS campaigns,
       (SELECT COUNT(*) FROM calls WHERE organization_id = ?) AS calls,
       (SELECT COUNT(*) FROM integration_connections WHERE organization_id = ?) AS connections,
       (SELECT COUNT(*) FROM ai_usage_logs WHERE organization_id = ?) AS aiUses`,
    [id, id, id, id, id]
  );
}

export function workspaceFor(organizationId) {
  return one(
    `SELECT id, name FROM workspaces WHERE organization_id = ? AND is_default = 1`,
    [organizationId]
  );
}

export function platformUsers() {
  return many(
    `SELECT u.id, u.full_name AS fullName, u.email, u.status, u.last_login_at AS lastLoginAt, r.role_key AS roleKey, r.name AS roleName
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.organization_id IS NULL
     JOIN roles r ON r.id = ur.role_id
     WHERE u.realm = 'platform'
     ORDER BY u.full_name`
  );
}

export function prospects() {
  return many(
    `SELECT p.id, p.company_name AS companyName, p.contact_name AS contactName, p.city, p.stage,
            p.value_inr AS valueInr, p.next_follow_up AS nextFollowUp, p.source_name AS sourceName, p.notes,
            u.full_name AS ownerName
     FROM platform_prospects p
     LEFT JOIN users u ON u.id = p.owner_user_id
     ORDER BY p.value_inr DESC`
  );
}

export function updateProspect(id, stage, nextFollowUp) {
  return run(`UPDATE platform_prospects SET stage = ?, next_follow_up = ? WHERE id = ?`, [stage, nextFollowUp, id]);
}

export function tickets() {
  return many(
    `SELECT t.id, t.subject, t.category, t.priority, t.status, t.requester_name AS requesterName,
            t.sla_due_at AS slaDueAt, t.created_at AS createdAt, o.name AS organizationName, u.full_name AS assigneeName
     FROM tickets t
     JOIN organizations o ON o.id = t.organization_id
     LEFT JOIN users u ON u.id = t.assignee_user_id
     ORDER BY FIELD(t.priority, 'high', 'normal', 'low'), t.created_at DESC`
  );
}

export function ticket(id) {
  return one(
    `SELECT t.id, t.subject, t.category, t.priority, t.status, t.requester_name AS requesterName,
            t.sla_due_at AS slaDueAt, o.name AS organizationName
     FROM tickets t JOIN organizations o ON o.id = t.organization_id WHERE t.id = ?`,
    [id]
  );
}

export function ticketMessages(id) {
  return many(
    `SELECT author_name AS authorName, body, created_at AS createdAt FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at`,
    [id]
  );
}

export function addTicketMessage({ ticketId, authorUserId, authorName, body }) {
  return insert(
    `INSERT INTO ticket_messages (ticket_id, author_user_id, author_name, body) VALUES (?, ?, ?, ?)`,
    [ticketId, authorUserId, authorName, body]
  );
}

export function finance() {
  return Promise.all([
    many(`SELECT id, plan_key AS planKey, name, monthly_inr AS monthlyInr, description FROM plans`),
    many(
      `SELECT o.name AS organizationName, p.name AS planName, s.status, s.current_period_end AS periodEnd, p.monthly_inr AS monthlyInr
       FROM subscriptions s JOIN organizations o ON o.id = s.organization_id JOIN plans p ON p.id = s.plan_id`
    ),
    many(
      `SELECT i.invoice_number AS invoiceNumber, i.amount_inr AS amountInr, i.status, i.issued_on AS issuedOn, o.name AS organizationName
       FROM invoices i JOIN organizations o ON o.id = i.organization_id ORDER BY i.issued_on DESC`
    ),
    many(
      `SELECT p.amount_inr AS amountInr, p.status, p.method_label AS methodLabel, p.failure_reason AS failureReason,
              p.paid_at AS paidAt, o.name AS organizationName
       FROM payments p JOIN organizations o ON o.id = p.organization_id ORDER BY p.created_at DESC`
    ),
    many(`SELECT c.amount_inr AS amountInr, c.reason, o.name AS organizationName, c.created_at AS createdAt FROM credits c JOIN organizations o ON o.id = c.organization_id`),
    many(
      `SELECT r.amount_inr AS amountInr, r.reason, o.name AS organizationName, r.created_at AS createdAt
       FROM refunds r JOIN organizations o ON o.id = r.organization_id`
    )
  ]);
}

export function moderation() {
  return many(
    `SELECT m.id, m.item_type AS itemType, m.summary, m.status, m.severity, m.created_at AS createdAt, o.name AS organizationName
     FROM moderation_items m JOIN organizations o ON o.id = m.organization_id
     ORDER BY FIELD(m.status, 'queue', 'flagged', 'appealed', 'actioned', 'dismissed'), m.created_at DESC`
  );
}

export function setModeration(id, status) {
  return run(`UPDATE moderation_items SET status = ? WHERE id = ?`, [status, id]);
}

export function registry() {
  return many(
    `SELECT p.provider_key AS providerKey, p.name, p.category, p.availability,
            COUNT(c.id) AS connections,
            SUM(c.status = 'error') AS errors
     FROM integration_providers p
     LEFT JOIN integration_connections c ON c.provider_id = p.id
     GROUP BY p.id, p.provider_key, p.name, p.category, p.availability
     ORDER BY p.category, p.name`
  );
}

export function syncJobs() {
  return many(
    `SELECT j.status, j.summary, j.started_at AS startedAt, o.name AS organizationName, p.name AS providerName
     FROM integration_sync_jobs j
     JOIN organizations o ON o.id = j.organization_id
     JOIN integration_connections c ON c.id = j.connection_id
     JOIN integration_providers p ON p.id = c.provider_id
     ORDER BY j.started_at DESC LIMIT 20`
  );
}

export function apiKeys() {
  return many(
    `SELECT id, name, key_prefix AS keyPrefix, last_used_at AS lastUsedAt, revoked_at AS revokedAt, created_at AS createdAt
     FROM platform_api_keys ORDER BY created_at DESC`
  );
}

export function createApiKey({ name, prefix, hash, userId }) {
  return insert(
    `INSERT INTO platform_api_keys (name, key_prefix, key_hash, created_by) VALUES (?, ?, ?, ?)`,
    [name, prefix, hash, userId]
  );
}

export function webhooks() {
  return many(`SELECT id, name, target_url AS targetUrl, event_name AS eventName, status, last_delivery_at AS lastDeliveryAt FROM platform_webhooks`);
}

export function oauthClients() {
  return many(`SELECT name, client_public_id AS clientId, redirect_uri AS redirectUri, status FROM oauth_clients`);
}

export function aiUsage() {
  return many(
    `SELECT surface, COUNT(*) AS total FROM ai_usage_logs GROUP BY surface`
  );
}

export function securityEvents() {
  return many(
    `SELECT event_type AS eventType, severity, message, ip, created_at AS createdAt
     FROM security_events ORDER BY created_at DESC LIMIT 30`
  );
}

export function sessions() {
  return many(
    `SELECT u.full_name AS fullName, u.realm, s.ip, s.started_at AS startedAt, s.ended_at AS endedAt
     FROM sessions s JOIN users u ON u.id = s.user_id
     ORDER BY s.started_at DESC LIMIT 20`
  );
}

export function platformAudit() {
  return many(
    `SELECT a.action, a.resource_name AS resourceName, a.resource_id AS resourceId, a.ip, a.created_at AS createdAt,
            u.full_name AS actorName
     FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id
     ORDER BY a.created_at DESC LIMIT 40`
  );
}

export function platformSettings() {
  return many(`SELECT setting_key AS settingKey, setting_value AS settingValue FROM platform_settings`);
}

export function savePlatformSetting(key, value) {
  return run(
    `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [key, JSON.stringify(value)]
  );
}

export function suspendUser(id, status) {
  return run(`UPDATE users SET status = ? WHERE id = ? AND realm = 'platform'`, [status, id]);
}

export function platformRole(roleKey) {
  return one(`SELECT id FROM roles WHERE scope = 'platform' AND role_key = ?`, [roleKey]);
}
