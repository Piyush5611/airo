import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { VIEWER_KEYS } from '../domain/access.js';
import { hashToken, randomToken } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';
import * as authRepo from '../repositories/authRepo.js';
import * as repo from '../repositories/platformRepo.js';
import { recordAudit } from './auditService.js';
import { llmStatus } from './llmService.js';

function parseValue(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value; }
}

export async function overview() {
  const [counts, activity, organizations] = await Promise.all([
    repo.counts(),
    repo.recentAudit(),
    repo.organizations()
  ]);
  return {
    counts,
    activity,
    organizations: organizations.slice(0, 6),
    health: {
      database: 'connected',
      unhealthyConnections: Number(counts?.unhealthyConnections || 0),
      openTickets: Number(counts?.openTickets || 0),
      failedPayments: Number(counts?.failedPayments || 0)
    }
  };
}

export async function organizations() {
  return { items: await repo.organizations() };
}

export async function organization(id) {
  const row = await repo.organization(id);
  if (!row) throw new ApiError(404, 'Organization not found.', 'not_found');
  const usage = await repo.orgUsage(id);
  return { organization: row, usage };
}

export async function supportAccess(req, id) {
  const organization = await repo.organization(id);
  if (!organization) throw new ApiError(404, 'Organization not found.', 'not_found');
  const workspace = await repo.workspaceFor(id);
  const token = jwt.sign(
    {
      sub: req.auth.userId,
      actorId: req.auth.userId,
      realm: 'client',
      organizationId: organization.id,
      workspaceId: workspace?.id || null,
      supportAccess: true,
      email: req.auth.email,
      permissions: VIEWER_KEYS
    },
    env.jwtSecret,
    { expiresIn: '30m' }
  );
  await recordAudit(req, {
    action: 'support.access_opened',
    resource: 'organization',
    resourceId: id,
    organizationId: id,
    metadata: { mode: 'read_only' }
  });
  return {
    accessToken: token,
    organization: { id: organization.id, name: organization.name },
    note: 'Support access is read only and expires in 30 minutes.'
  };
}

export async function users() {
  return { items: await repo.platformUsers() };
}

export async function setUserStatus(req, id) {
  await repo.suspendUser(id, req.body.status);
  await recordAudit(req, { action: 'platform_user.status', resource: 'user', resourceId: id, organizationId: null, metadata: req.body });
  return users();
}

export async function invitePlatformUser(req) {
  const email = req.body.email.trim().toLowerCase();
  if (await authRepo.findUserByEmail(email)) throw new ApiError(409, 'That email is already in use.', 'conflict');
  const role = await repo.platformRole(req.body.role);
  if (!role) throw new ApiError(422, 'Unknown platform role.', 'validation_error');
  const passwordHash = await bcrypt.hash(randomToken(), 12);
  const { insert } = await import('../db/sql.js');
  const userId = await insert(
    `INSERT INTO users (email, password_hash, full_name, realm, status) VALUES (?, ?, ?, 'platform', 'invited')`,
    [email, passwordHash, req.body.fullName.trim()]
  );
  await insert(`INSERT INTO user_roles (user_id, role_id, organization_id) VALUES (?, ?, NULL)`, [userId, role.id]);
  const token = randomToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await authRepo.saveReset({
    userId,
    tokenHash: hashToken(token),
    expiresAt: expires.toISOString().slice(0, 19).replace('T', ' ')
  });
  await recordAudit(req, { action: 'platform_user.invited', resource: 'user', resourceId: userId, organizationId: null });
  return { invited: true, developmentResetPath: env.isProd ? undefined : `/reset-password?token=${token}` };
}

export async function sales() {
  const items = await repo.prospects();
  const stages = ['prospect', 'qualified', 'demo', 'proposal', 'won', 'lost'];
  return {
    items,
    stages: stages.map((stage) => ({
      stage,
      count: items.filter((item) => item.stage === stage).length,
      value: items.filter((item) => item.stage === stage).reduce((sum, item) => sum + Number(item.valueInr || 0), 0)
    }))
  };
}

export async function updateSale(req, id) {
  await repo.updateProspect(id, req.body.stage, req.body.nextFollowUp || null);
  await recordAudit(req, { action: 'platform_sale.updated', resource: 'prospect', resourceId: id, organizationId: null });
  return sales();
}

export async function support() {
  return { items: await repo.tickets() };
}

export async function supportTicket(id) {
  const ticket = await repo.ticket(id);
  if (!ticket) throw new ApiError(404, 'Ticket not found.', 'not_found');
  return { ticket, messages: await repo.ticketMessages(id) };
}

export async function addSupportNote(req, id) {
  const ticket = await repo.ticket(id);
  if (!ticket) throw new ApiError(404, 'Ticket not found.', 'not_found');
  await repo.addTicketMessage({
    ticketId: id,
    authorUserId: req.auth.userId,
    authorName: req.auth.name,
    body: req.body.body.trim()
  });
  await recordAudit(req, { action: 'support.note_added', resource: 'ticket', resourceId: id, organizationId: null });
  return supportTicket(id);
}

export async function finance() {
  const [plans, subscriptions, invoices, payments, credits, refunds] = await repo.finance();
  const active = subscriptions.filter((item) => item.status === 'active');
  return {
    summary: {
      mrr: active.reduce((sum, item) => sum + Number(item.monthlyInr || 0), 0),
      openInvoices: invoices.filter((item) => item.status === 'open').reduce((sum, item) => sum + Number(item.amountInr || 0), 0),
      failed: payments.filter((item) => item.status === 'failed').length
    },
    plans,
    subscriptions,
    invoices,
    payments,
    credits,
    refunds
  };
}

export async function moderation() {
  const items = await repo.moderation();
  return {
    items,
    queue: items.filter((item) => ['queue', 'flagged', 'appealed'].includes(item.status)).length
  };
}

export async function actOnModeration(req, id) {
  await repo.setModeration(id, req.body.status);
  await recordAudit(req, { action: 'moderation.updated', resource: 'moderation_item', resourceId: id, organizationId: null, metadata: req.body });
  return moderation();
}

export async function integrations() {
  const [providers, jobs, apiKeys, webhooks, oauthClients] = await Promise.all([
    repo.registry(),
    repo.syncJobs(),
    repo.apiKeys(),
    repo.webhooks(),
    repo.oauthClients()
  ]);
  return { providers, jobs, apiKeys, webhooks, oauthClients };
}

export async function createApiKey(req) {
  const secret = `airo_${randomToken()}`;
  const prefix = secret.slice(0, 12);
  await repo.createApiKey({ name: req.body.name.trim(), prefix, hash: hashToken(secret), userId: req.auth.userId });
  await recordAudit(req, { action: 'api_key.created', resource: 'api_key', organizationId: null });
  return { secret, prefix, ...(await integrations()) };
}

export async function ai() {
  const status = await llmStatus();
  const summary = status.models.length
    ? status.models.map((row) => `${row.purposeLabel}: ${row.providerName} · ${row.model}`).join('. ')
    : 'No model is connected yet.';
  return {
    usage: await repo.aiUsage(),
    models: status.models,
    purposes: status.purposes,
    policy: status.note || `${summary} Each purpose keeps its own model. Workspace answers still come from each organization's own records.`
  };
}

export async function security() {
  const [events, sessions, audit] = await Promise.all([
    repo.securityEvents(),
    repo.sessions(),
    repo.platformAudit()
  ]);
  return { events, sessions, audit };
}

export async function settings() {
  const rows = await repo.platformSettings();
  return { values: Object.fromEntries(rows.map((row) => [row.settingKey, parseValue(row.settingValue)])) };
}

export async function updateSettings(req) {
  const allowed = ['general', 'notifications', 'email', 'security', 'featureFlags', 'localization'];
  if (!allowed.includes(req.body.key)) throw new ApiError(422, 'Unknown setting.', 'validation_error');
  await repo.savePlatformSetting(req.body.key, req.body.value);
  await recordAudit(req, { action: 'platform_settings.updated', resource: 'settings', resourceId: req.body.key, organizationId: null });
  return settings();
}

export async function search(q) {
  const like = `%${String(q || '').replace(/[%_]/g, '').slice(0, 80)}%`;
  if (!q || String(q).trim().length < 2) return { groups: [] };
  const { many } = await import('../db/sql.js');
  const [organizations, users] = await Promise.all([
    many(`SELECT id, name AS label, city AS detail FROM organizations WHERE name LIKE ? LIMIT 6`, [like]),
    many(`SELECT id, full_name AS label, email AS detail FROM users WHERE realm = 'platform' AND (full_name LIKE ? OR email LIKE ?) LIMIT 6`, [like, like])
  ]);
  return {
    groups: [
      { label: 'Organizations', items: organizations.map((item) => ({ ...item, path: `/platform/organizations/${item.id}` })) },
      { label: 'Platform users', items: users.map((item) => ({ ...item, path: '/platform/users' })) }
    ].filter((group) => group.items.length)
  };
}
