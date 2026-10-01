import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { many, one } from '../db/sql.js';
import { VIEWER_KEYS } from '../domain/access.js';
import { ApiError } from '../utils/errors.js';

export async function authenticate(req, _res, next) {
  try {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) throw new ApiError(401, 'Sign in to continue.', 'unauthorized');

    let payload;
    try {
      payload = jwt.verify(token, env.jwtSecret);
    } catch {
      throw new ApiError(401, 'Sign in to continue.', 'unauthorized');
    }

    if (payload.supportAccess) {
      const allowed = await one(
        `SELECT 1 AS ok
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE ur.user_id = ? AND ur.organization_id IS NULL AND p.perm_key = 'organizations.impersonate'
         LIMIT 1`,
        [payload.actorId]
      );
      if (!allowed) throw new ApiError(403, 'Support access is no longer available.', 'forbidden');
      req.auth = {
        userId: payload.actorId,
        actorId: payload.actorId,
        email: payload.email || '',
        name: 'AIRO Support',
        realm: 'client',
        organizationId: payload.organizationId,
        workspaceId: payload.workspaceId,
        role: 'viewer',
        permissions: VIEWER_KEYS,
        supportAccess: true,
        dataScopes: {}
      };
      return next();
    }

    const user = await one(
      `SELECT id, email, full_name AS fullName, realm, status FROM users WHERE id = ?`,
      [payload.sub]
    );
    if (!user || user.status !== 'active') {
      throw new ApiError(401, 'Sign in to continue.', 'unauthorized');
    }
    if (user.realm === 'client' && !payload.organizationId) {
      throw new ApiError(401, 'Workspace context is missing.', 'unauthorized');
    }

    const permissions = await loadPermissions(user.id, payload.organizationId || null);
    const dataScopes = payload.organizationId
      ? await loadScopes(user.id, payload.organizationId)
      : {};

    req.auth = {
      userId: user.id,
      actorId: user.id,
      email: user.email,
      name: user.fullName,
      realm: user.realm,
      organizationId: payload.organizationId || null,
      workspaceId: payload.workspaceId || null,
      role: payload.role || null,
      permissions,
      supportAccess: false,
      dataScopes
    };
    next();
  } catch (error) {
    next(error);
  }
}

async function loadPermissions(userId, organizationId) {
  const rows = await many(
    `SELECT DISTINCT p.perm_key AS permKey
     FROM user_roles ur
     JOIN role_permissions rp ON rp.role_id = ur.role_id
     JOIN permissions p ON p.id = rp.permission_id
     WHERE ur.user_id = ? AND ur.organization_id <=> ?`,
    [userId, organizationId]
  );
  return rows.map((row) => row.permKey);
}

async function loadScopes(userId, organizationId) {
  const rows = await many(
    `SELECT resource_name AS resourceName, scope_type AS scopeType
     FROM data_scopes
     WHERE user_id = ? AND organization_id = ?`,
    [userId, organizationId]
  );
  return Object.fromEntries(rows.map((row) => [row.resourceName, row.scopeType]));
}
