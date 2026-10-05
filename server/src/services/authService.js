import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { hashToken, randomToken } from '../utils/cryptoBox.js';
import { clearRefreshCookie, readCookie, setRefreshCookie } from '../utils/cookies.js';
import * as authRepo from '../repositories/authRepo.js';
import { recordAudit } from './auditService.js';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 14;
const SESSION_DAYS = 1;

function asUtc(value) {
  const text = String(value).replace(' ', 'T');
  return new Date(text.endsWith('Z') ? text : `${text}Z`);
}

function accessToken(user, context) {
  return jwt.sign(
    {
      sub: user.id,
      realm: user.realm,
      organizationId: context.organizationId || null,
      workspaceId: context.workspaceId || null,
      role: context.roleKey || null,
      email: user.email,
      supportAccess: false
    },
    env.jwtSecret,
    { expiresIn: ACCESS_TTL }
  );
}

async function issueRefresh(res, req, userId, organizationId, remember = true) {
  const token = randomToken();
  const days = remember ? REFRESH_DAYS : SESSION_DAYS;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const id = await authRepo.saveRefresh({
    userId,
    organizationId,
    tokenHash: hashToken(token),
    expiresAt: expires.toISOString().slice(0, 19).replace('T', ' '),
    remember,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 255) || null
  });
  setRefreshCookie(res, token, remember);
  return id;
}

async function profile(user, organizationId) {
  if (user.realm === 'platform') {
    const role = await authRepo.platformRoleFor(user.id);
    return {
      id: user.id,
      email: user.email,
      name: user.fullName || user.name,
      realm: 'platform',
      role: role?.roleKey || null,
      roleName: role?.roleName || null,
      organization: null,
      workspace: null,
      teams: [],
      memberships: [],
      supportAccess: false
    };
  }
  const memberships = await authRepo.membershipsFor(user.id);
  const active = memberships.find((item) => item.organizationId === organizationId) || memberships[0];
  if (!active) throw new ApiError(403, 'No workspace is assigned to this account.', 'forbidden');
  const teams = await authRepo.teamsFor(user.id, active.organizationId);
  return {
    id: user.id,
    email: user.email,
    name: user.fullName || user.name,
    realm: 'client',
    role: active.roleKey,
    roleName: active.roleName,
    organization: {
      id: active.organizationId,
      name: active.organizationName,
      slug: active.slug,
      city: active.city,
      status: active.status
    },
    workspace: { id: active.workspaceId, name: active.workspaceName },
    teams,
    memberships: memberships.map((item) => ({
      organizationId: item.organizationId,
      name: item.organizationName,
      workspaceId: item.workspaceId,
      role: item.roleKey
    })),
    supportAccess: false
  };
}

export async function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await authRepo.findUserByEmail(email);
  const matches = user ? await bcrypt.compare(req.body.password, user.passwordHash) : false;
  if (!user || !matches) {
    await authRepo.recordSecurity({
      organizationId: null,
      eventType: 'login_failed',
      severity: 'warning',
      message: 'Rejected sign-in attempt.',
      ip: req.ip,
      metadata: null
    });
    throw new ApiError(401, 'Email or password is incorrect.', 'unauthorized');
  }
  if (user.status === 'suspended') {
    throw new ApiError(403, 'This account is suspended.', 'forbidden');
  }
  if (user.status !== 'active') {
    throw new ApiError(403, 'Set a password from the invitation before signing in.', 'forbidden');
  }

  let context = { organizationId: null, workspaceId: null, roleKey: null };
  if (user.realm === 'client') {
    const memberships = await authRepo.membershipsFor(user.id);
    if (!memberships.length) throw new ApiError(403, 'No workspace is assigned to this account.', 'forbidden');
    context = {
      organizationId: memberships[0].organizationId,
      workspaceId: memberships[0].workspaceId,
      roleKey: memberships[0].roleKey
    };
  } else {
    const role = await authRepo.platformRoleFor(user.id);
    context.roleKey = role?.roleKey || null;
  }

  await issueRefresh(res, req, user.id, context.organizationId, req.body.remember !== false);
  await authRepo.touchLogin(user.id);
  await authRepo.openSession({ userId: user.id, ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 255) || null });
  const body = await profile(user, context.organizationId);
  req.auth = { userId: user.id, actorId: user.id, organizationId: context.organizationId };
  await recordAudit(req, { action: 'auth.login', resource: 'session', resourceId: user.id, organizationId: context.organizationId });
  return { accessToken: accessToken(user, context), user: body };
}

export async function refresh(req, res) {
  const raw = readCookie(req, 'airo_refresh');
  if (!raw) throw new ApiError(401, 'Sign in to continue.', 'unauthorized');
  const current = await authRepo.findRefresh(hashToken(raw));
  if (!current || current.revokedAt || asUtc(current.expiresAt).getTime() < Date.now()) {
    clearRefreshCookie(res);
    throw new ApiError(401, 'Sign in to continue.', 'unauthorized');
  }
  const user = await authRepo.findUserById(current.userId);
  if (!user || user.status !== 'active') throw new ApiError(401, 'Sign in to continue.', 'unauthorized');

  let context = { organizationId: current.organizationId, workspaceId: null, roleKey: null };
  if (user.realm === 'client') {
    const memberships = await authRepo.membershipsFor(user.id);
    const active = memberships.find((item) => item.organizationId === current.organizationId) || memberships[0];
    if (!active) throw new ApiError(403, 'No workspace is assigned to this account.', 'forbidden');
    context = {
      organizationId: active.organizationId,
      workspaceId: active.workspaceId,
      roleKey: active.roleKey
    };
  } else {
    const role = await authRepo.platformRoleFor(user.id);
    context = { organizationId: null, workspaceId: null, roleKey: role?.roleKey || null };
  }

  const nextId = await issueRefresh(res, req, user.id, context.organizationId, Boolean(current.remember));
  await authRepo.revokeRefresh(current.id, nextId);
  return { accessToken: accessToken(user, context), user: await profile(user, context.organizationId) };
}

export async function logout(req, res) {
  const raw = readCookie(req, 'airo_refresh');
  if (raw) {
    const current = await authRepo.findRefresh(hashToken(raw));
    if (current) await authRepo.revokeRefresh(current.id);
  }
  clearRefreshCookie(res);
  if (req.auth?.userId) {
    await recordAudit(req, { action: 'auth.logout', resource: 'session', resourceId: req.auth.userId });
  }
}

export async function forgotPassword(req) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = await authRepo.findUserByEmail(email);
  if (user && user.status !== 'suspended') {
    const token = randomToken();
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await authRepo.saveReset({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: expires.toISOString().slice(0, 19).replace('T', ' ')
    });
    if (!env.isProd) {
      console.log(`Password reset for ${user.email}: /reset-password?token=${token}`);
    }
  }
  return { message: 'If the account exists, a reset link has been issued.' };
}

export async function resetPassword(req) {
  const record = await authRepo.findReset(hashToken(req.body.token));
  if (!record || record.usedAt || asUtc(record.expiresAt).getTime() < Date.now()) {
    throw new ApiError(400, 'This reset link is no longer valid.', 'invalid_token');
  }
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  await authRepo.updatePassword(record.userId, passwordHash);
  await authRepo.markResetUsed(record.id);
  await authRepo.revokeAllForUser(record.userId);
  await runActivation(record.userId);
  return { message: 'Password updated. Sign in with the new password.' };
}

async function runActivation(userId) {
  const { run } = await import('../db/sql.js');
  await run(`UPDATE users SET status = 'active' WHERE id = ? AND status = 'invited'`, [userId]);
  await run(`UPDATE organization_users SET status = 'active' WHERE user_id = ? AND status = 'invited'`, [userId]);
}

export async function me(auth) {
  const user = await authRepo.findUserById(auth.userId);
  if (auth.supportAccess) {
    const { one } = await import('../db/sql.js');
    const organization = await one(
      `SELECT o.id, o.name, o.slug, o.city, o.status, w.id AS workspaceId, w.name AS workspaceName
       FROM organizations o
       JOIN workspaces w ON w.organization_id = o.id AND w.is_default = 1
       WHERE o.id = ?`,
      [auth.organizationId]
    );
    return {
      id: auth.userId,
      email: auth.email,
      name: 'AIRO Support',
      realm: 'client',
      role: 'viewer',
      roleName: 'Support access',
      organization: organization && {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        city: organization.city,
        status: organization.status
      },
      workspace: organization && { id: organization.workspaceId, name: organization.workspaceName },
      teams: [],
      memberships: [],
      supportAccess: true,
      permissions: auth.permissions
    };
  }
  const body = await profile(user, auth.organizationId);
  body.permissions = auth.permissions;
  body.dataScopes = auth.dataScopes;
  return body;
}

export async function switchOrganization(req, res) {
  const user = await authRepo.findUserById(req.auth.userId);
  const memberships = await authRepo.membershipsFor(user.id);
  const active = memberships.find((item) => item.organizationId === Number(req.body.organizationId));
  if (!active) throw new ApiError(403, 'You are not a member of that organization.', 'forbidden');
  const raw = readCookie(req, 'airo_refresh');
  let remember = true;
  if (raw) {
    const current = await authRepo.findRefresh(hashToken(raw));
    if (current) {
      remember = Boolean(current.remember);
      await authRepo.revokeRefresh(current.id);
    }
  }
  await issueRefresh(res, req, user.id, active.organizationId, remember);
  const context = {
    organizationId: active.organizationId,
    workspaceId: active.workspaceId,
    roleKey: active.roleKey
  };
  return { accessToken: accessToken(user, context), user: await profile(user, active.organizationId) };
}

export function demoHints() {
  if (env.isProd) return null;
  return {
    password: env.seedPassword,
    client: 'rahul.sharma@prestigehomes.in',
    platform: 'arjun.mehta@airo.internal',
    others: [
      ['neha.kapoor@airo.internal', 'Operations Admin'],
      ['sameer.qureshi@airo.internal', 'Support Admin'],
      ['sales.iyer@airo.internal', 'Sales Admin'],
      ['isha.bansal@airo.internal', 'Finance Admin'],
      ['moderation.das@airo.internal', 'Content/Moderation'],
      ['analyst.sen@airo.internal', 'Analyst'],
      ['dev.rao@airo.internal', 'Developer/Admin'],
      ['meera.nair@prestigehomes.in', 'Admin, Prestige Homes'],
      ['kabir.malhotra@prestigehomes.in', 'Member, Sales, assigned leads'],
      ['ananya.gupta@prestigehomes.in', 'Viewer, Prestige Homes'],
      ['vikram.singh@aureliaestates.in', 'Owner, Aurelia Estates']
    ]
  };
}
