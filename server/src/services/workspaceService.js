import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { hashToken, randomToken } from '../utils/cryptoBox.js';
import * as authRepo from '../repositories/authRepo.js';
import * as repo from '../repositories/workspaceRepo.js';
import { recordAudit } from './auditService.js';

function parseValue(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export async function team(auth) {
  const [members, teams, scopes, roles, activity] = await Promise.all([
    repo.members(auth.organizationId),
    repo.teams(auth.organizationId),
    repo.scopes(auth.organizationId),
    repo.roles(),
    repo.activity(auth.organizationId)
  ]);
  return {
    members,
    teams,
    scopes,
    roles: roles.map((role) => ({
      ...role,
      permissions: role.permissions ? role.permissions.split(',') : []
    })),
    activity
  };
}

export async function invite(auth, req) {
  const email = req.body.email.trim().toLowerCase();
  const existing = await authRepo.findUserByEmail(email);
  if (existing) throw new ApiError(409, 'That email is already in use.', 'conflict');
  const role = await repo.clientRole(req.body.role);
  if (!role || role.roleKey === 'owner') {
    throw new ApiError(422, 'Choose Admin, Member, or Viewer.', 'validation_error');
  }
  const passwordHash = await bcrypt.hash(randomToken(), 12);
  const userId = await repo.createInvitedUser({ email, fullName: req.body.fullName.trim(), passwordHash });
  await repo.addMembership({ organizationId: auth.organizationId, userId, roleId: role.id });
  await repo.addUserRole({ userId, roleId: role.id, organizationId: auth.organizationId });
  if (req.body.dataScope) {
    await repo.setScope({
      organizationId: auth.organizationId,
      userId,
      resourceName: 'leads',
      scopeType: req.body.dataScope
    });
  }
  const token = randomToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await authRepo.saveReset({
    userId,
    tokenHash: hashToken(token),
    expiresAt: expires.toISOString().slice(0, 19).replace('T', ' ')
  });
  await recordAudit(req, { action: 'user.invited', resource: 'user', resourceId: userId, metadata: { email, role: role.roleKey } });
  return {
    invited: true,
    email,
    developmentResetPath: env.isProd ? undefined : `/reset-password?token=${token}`
  };
}

export async function settings(auth) {
  const [rows, organization, billing, invoices] = await Promise.all([
    repo.settings(auth.organizationId),
    repo.organization(auth.organizationId),
    repo.billing(auth.organizationId),
    repo.invoices(auth.organizationId)
  ]);
  const values = Object.fromEntries(rows.map((row) => [row.settingKey, parseValue(row.settingValue)]));
  return { organization, values, billing, invoices };
}

const SETTING_KEYS = ['workspace', 'branding', 'notifications', 'ai', 'security'];

export async function updateSettings(auth, req) {
  const key = req.body.key;
  if (!SETTING_KEYS.includes(key)) throw new ApiError(422, 'That setting cannot be changed here.', 'validation_error');
  await repo.saveSetting(auth.organizationId, key, req.body.value);
  await recordAudit(req, { action: 'settings.updated', resource: 'settings', resourceId: key });
  return settings(auth);
}
