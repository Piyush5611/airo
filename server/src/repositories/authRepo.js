import { insert, many, one, run } from '../db/sql.js';

export function findUserByEmail(email) {
  return one(
    `SELECT id, email, password_hash AS passwordHash, full_name AS fullName, realm, status
     FROM users WHERE email = ?`,
    [email]
  );
}

export function findUserById(id) {
  return one(
    `SELECT id, email, full_name AS fullName, phone, realm, status, last_login_at AS lastLoginAt
     FROM users WHERE id = ?`,
    [id]
  );
}

export function membershipsFor(userId) {
  return many(
    `SELECT ou.organization_id AS organizationId, o.name AS organizationName, o.slug, o.city, o.status,
            w.id AS workspaceId, w.name AS workspaceName, r.role_key AS roleKey, r.name AS roleName
     FROM organization_users ou
     JOIN organizations o ON o.id = ou.organization_id
     JOIN roles r ON r.id = ou.role_id
     JOIN workspaces w ON w.organization_id = o.id AND w.is_default = 1
     WHERE ou.user_id = ? AND ou.status = 'active'`,
    [userId]
  );
}

export function platformRoleFor(userId) {
  return one(
    `SELECT r.role_key AS roleKey, r.name AS roleName
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND ur.organization_id IS NULL
     LIMIT 1`,
    [userId]
  );
}

export function teamsFor(userId, organizationId) {
  return many(
    `SELECT t.id, t.name
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE tm.user_id = ? AND t.organization_id = ?`,
    [userId, organizationId]
  );
}

export async function saveRefresh({ userId, organizationId, tokenHash, expiresAt, ip, userAgent }) {
  return insert(
    `INSERT INTO refresh_tokens (user_id, organization_id, token_hash, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, organizationId, tokenHash, expiresAt, ip, userAgent]
  );
}

export function findRefresh(tokenHash) {
  return one(
    `SELECT id, user_id AS userId, organization_id AS organizationId, expires_at AS expiresAt, revoked_at AS revokedAt
     FROM refresh_tokens WHERE token_hash = ?`,
    [tokenHash]
  );
}

export function revokeRefresh(id, replacedBy = null) {
  return run(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), replaced_by = ? WHERE id = ?`, [replacedBy, id]);
}

export function revokeAllForUser(userId) {
  return run(`UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL`, [userId]);
}

export function touchLogin(userId) {
  return run(`UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?`, [userId]);
}

export function openSession({ userId, ip, userAgent }) {
  return insert(
    `INSERT INTO sessions (user_id, ip, user_agent) VALUES (?, ?, ?)`,
    [userId, ip, userAgent]
  );
}

export function saveReset({ userId, tokenHash, expiresAt }) {
  return insert(
    `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
}

export function findReset(tokenHash) {
  return one(
    `SELECT id, user_id AS userId, expires_at AS expiresAt, used_at AS usedAt
     FROM password_resets WHERE token_hash = ?`,
    [tokenHash]
  );
}

export function markResetUsed(id) {
  return run(`UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE id = ?`, [id]);
}

export function updatePassword(userId, passwordHash) {
  return run(`UPDATE users SET password_hash = ? WHERE id = ?`, [passwordHash, userId]);
}

export function recordSecurity({ organizationId, eventType, severity, message, ip, metadata }) {
  return insert(
    `INSERT INTO security_events (organization_id, event_type, severity, message, ip, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [organizationId, eventType, severity, message, ip, metadata ? JSON.stringify(metadata) : null]
  );
}
