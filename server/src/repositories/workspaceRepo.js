import { insert, many, one, run } from '../db/sql.js';

export function members(organizationId) {
  return many(
    `SELECT u.id, u.full_name AS fullName, u.email, u.status AS userStatus, ou.status,
            r.role_key AS roleKey, r.name AS roleName, u.last_login_at AS lastLoginAt
     FROM organization_users ou
     JOIN users u ON u.id = ou.user_id
     JOIN roles r ON r.id = ou.role_id
     WHERE ou.organization_id = ?
     ORDER BY u.full_name`,
    [organizationId]
  );
}

export function teams(organizationId) {
  return many(
    `SELECT t.id, t.name, t.description,
            GROUP_CONCAT(u.full_name ORDER BY u.full_name SEPARATOR ', ') AS memberNames
     FROM teams t
     LEFT JOIN team_members tm ON tm.team_id = t.id
     LEFT JOIN users u ON u.id = tm.user_id
     WHERE t.organization_id = ?
     GROUP BY t.id, t.name, t.description`,
    [organizationId]
  );
}

export function scopes(organizationId) {
  return many(
    `SELECT d.user_id AS userId, u.full_name AS fullName, d.resource_name AS resourceName, d.scope_type AS scopeType
     FROM data_scopes d
     JOIN users u ON u.id = d.user_id
     WHERE d.organization_id = ?`,
    [organizationId]
  );
}

export function roles() {
  return many(
    `SELECT r.id, r.role_key AS roleKey, r.name, r.description,
            GROUP_CONCAT(p.perm_key ORDER BY p.perm_key SEPARATOR ',') AS permissions
     FROM roles r
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE r.scope = 'client'
     GROUP BY r.id, r.role_key, r.name, r.description`
  );
}

export function activity(organizationId) {
  return many(
    `SELECT a.action, a.resource_name AS resourceName, a.created_at AS createdAt, u.full_name AS actorName
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     WHERE a.organization_id = ?
     ORDER BY a.created_at DESC LIMIT 20`,
    [organizationId]
  );
}

export function clientRole(roleKey) {
  return one(`SELECT id, role_key AS roleKey, name FROM roles WHERE scope = 'client' AND role_key = ?`, [roleKey]);
}

export function createInvitedUser({ email, fullName, passwordHash }) {
  return insert(
    `INSERT INTO users (email, password_hash, full_name, realm, status) VALUES (?, ?, ?, 'client', 'invited')`,
    [email, passwordHash, fullName]
  );
}

export function addMembership({ organizationId, userId, roleId }) {
  return insert(
    `INSERT INTO organization_users (organization_id, user_id, role_id, status) VALUES (?, ?, ?, 'invited')`,
    [organizationId, userId, roleId]
  );
}

export function addUserRole({ userId, roleId, organizationId }) {
  return insert(
    `INSERT INTO user_roles (user_id, role_id, organization_id) VALUES (?, ?, ?)`,
    [userId, roleId, organizationId]
  );
}

export function setScope({ organizationId, userId, resourceName, scopeType }) {
  return run(
    `INSERT INTO data_scopes (organization_id, user_id, resource_name, scope_type) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE scope_type = VALUES(scope_type)`,
    [organizationId, userId, resourceName, scopeType]
  );
}

export function settings(organizationId) {
  return many(
    `SELECT setting_key AS settingKey, setting_value AS settingValue FROM organization_settings WHERE organization_id = ?`,
    [organizationId]
  );
}

export function organization(id) {
  return one(
    `SELECT id, name, legal_name AS legalName, slug, city, sector, status FROM organizations WHERE id = ?`,
    [id]
  );
}

export function updateOrganization(id, { name, legalName, city, sector }) {
  return run(
    `UPDATE organizations SET name = ?, legal_name = ?, city = ?, sector = ? WHERE id = ?`,
    [name, legalName || null, city || null, sector, id]
  );
}

export async function organizationSector(id) {
  try {
    const row = await one(`SELECT sector FROM organizations WHERE id = ?`, [id]);
    return row?.sector || '';
  } catch {
    return '';
  }
}

export function saveSetting(organizationId, key, value) {
  return run(
    `INSERT INTO organization_settings (organization_id, setting_key, setting_value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [organizationId, key, JSON.stringify(value)]
  );
}

export function billing(organizationId) {
  return one(
    `SELECT p.name AS planName, p.monthly_inr AS monthlyInr, s.status, s.current_period_end AS periodEnd
     FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.organization_id = ? ORDER BY s.id DESC LIMIT 1`,
    [organizationId]
  );
}

export function invoices(organizationId) {
  return many(
    `SELECT invoice_number AS invoiceNumber, amount_inr AS amountInr, status, issued_on AS issuedOn
     FROM invoices WHERE organization_id = ? ORDER BY issued_on DESC`,
    [organizationId]
  );
}
