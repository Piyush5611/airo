import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.js';
import { blockSupportWrites, requirePermission, requireRealm } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/errors.js';
import { ok } from '../controllers/http.js';
import * as schemas from '../validators/schemas.js';
import * as auth from '../services/authService.js';
import * as growth from '../services/growthService.js';
import * as sales from '../services/salesService.js';
import * as connections from '../services/connectionService.js';
import * as intel from '../services/intelligenceService.js';
import * as workspace from '../services/workspaceService.js';
import * as platform from '../services/platformService.js';
import * as whatsapp from '../services/whatsappService.js';
import * as metaWebhook from '../services/metaWebhookService.js';
import { pingDatabase } from '../config/db.js';

const router = Router();

router.get('/health', asyncHandler(async (_req, res) => {
  const database = await pingDatabase();
  ok(res, { service: 'airo', database: database ? 'up' : 'down' });
}));

router.get('/whatsapp/webhook', asyncHandler(async (req, res) => {
  const challenge = await whatsapp.verifyWebhook(req.query);
  if (!challenge) return res.sendStatus(403);
  res.status(200).type('text/plain').send(challenge);
}));

router.post('/whatsapp/webhook', asyncHandler(async (req, res) => {
  await whatsapp.receiveWebhook(req.body);
  res.sendStatus(200);
}));

router.get('/meta/webhook', asyncHandler(async (req, res) => {
  const challenge = metaWebhook.verifyWebhook(req.query);
  if (!challenge) return res.sendStatus(403);
  res.status(200).type('text/plain').send(challenge);
}));

router.post('/meta/webhook', asyncHandler(async (req, res) => {
  await metaWebhook.receiveWebhook(req.body);
  res.sendStatus(200);
}));

router.post('/hooks/:token', asyncHandler(async (req, res) => {
  ok(res, await connections.ingestWebhook(req.params.token, req.body));
}));

const authRouter = Router();
authRouter.post('/login', validate(schemas.loginSchema), asyncHandler(async (req, res) => ok(res, await auth.login(req, res))));
authRouter.post('/refresh', asyncHandler(async (req, res) => ok(res, await auth.refresh(req, res))));
authRouter.post('/logout', asyncHandler(async (req, res) => {
  await auth.logout(req, res);
  ok(res, { signedOut: true });
}));
authRouter.post('/password/forgot', validate(schemas.forgotSchema), asyncHandler(async (req, res) => ok(res, await auth.forgotPassword(req))));
authRouter.post('/password/reset', validate(schemas.resetSchema), asyncHandler(async (req, res) => ok(res, await auth.resetPassword(req))));
authRouter.get('/demo-hints', asyncHandler(async (_req, res) => {
  const hints = auth.demoHints();
  if (!hints) return res.status(404).json({ success: false, error: { code: 'not_found', message: 'Not available.' } });
  ok(res, hints);
}));
authRouter.get('/me', authenticate, asyncHandler(async (req, res) => ok(res, await auth.me(req.auth))));
authRouter.post('/switch', authenticate, requireRealm('client'), validate(schemas.switchSchema), asyncHandler(async (req, res) => {
  ok(res, await auth.switchOrganization(req, res));
}));
router.use('/auth', authRouter);

const client = Router();
client.use((req, _res, next) => {
  if (req.path === '/admin' || req.path.startsWith('/admin/')) return next('router');
  next();
});
client.use(authenticate, requireRealm('client'), blockSupportWrites);

client.get('/command', requirePermission('command.view'), asyncHandler(async (req, res) => ok(res, await intel.command(req.auth))));
client.get('/leads', requirePermission('leads.view'), asyncHandler(async (req, res) => ok(res, await growth.leads(req.auth, req.query))));
client.get('/leads/export', requirePermission('leads.export'), asyncHandler(async (req, res) => {
  const csv = await growth.exportLeads(req.auth);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send(csv);
}));
client.post('/leads', requirePermission('leads.create'), validate(schemas.leadCreateSchema), asyncHandler(async (req, res) => {
  ok(res, await growth.createLead(req.auth, req), 201);
}));
client.get('/leads/:id', requirePermission('leads.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await growth.lead(req.auth, req.params.id));
}));
client.patch('/leads/:id', requirePermission('leads.update'), validate(schemas.idParams.merge(schemas.leadUpdateSchema)), asyncHandler(async (req, res) => {
  ok(res, await growth.updateLead(req.auth, req, req.params.id));
}));
client.post('/leads/:id/assign', requirePermission('leads.assign'), validate(schemas.idParams.merge(schemas.assignSchema)), asyncHandler(async (req, res) => {
  ok(res, await growth.assignLead(req.auth, req, req.params.id));
}));
client.delete('/leads/:id', requirePermission('leads.delete'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await growth.removeLead(req.auth, req, req.params.id));
}));
client.get('/sources', requirePermission('sources.view'), asyncHandler(async (req, res) => ok(res, await growth.leadSources(req.auth))));
client.get('/campaigns', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await growth.campaigns(req.auth))));
client.get('/campaigns/:id', requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await growth.campaign(req.auth, req.params.id));
}));
client.get('/pipeline', requirePermission('pipeline.view'), asyncHandler(async (req, res) => ok(res, await sales.pipeline(req.auth))));
client.get('/pipeline/:id', requirePermission('pipeline.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await sales.opportunity(req.auth, req.params.id));
}));
client.patch('/pipeline/:id', requirePermission('pipeline.update'), validate(schemas.idParams.merge(schemas.moveSchema)), asyncHandler(async (req, res) => {
  ok(res, await sales.moveOpportunity(req.auth, req, req.params.id));
}));
client.get('/calls', requirePermission('calls.view'), asyncHandler(async (req, res) => ok(res, await sales.calls(req.auth))));
client.get('/calls/:id', requirePermission('calls.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await sales.call(req.auth, req.params.id));
}));
client.get('/activities', requirePermission('activities.view'), asyncHandler(async (req, res) => ok(res, await sales.activities(req.auth))));
client.post('/activities/tasks', requirePermission('activities.create'), validate(schemas.taskSchema), asyncHandler(async (req, res) => {
  ok(res, await sales.createTask(req.auth, req), 201);
}));
client.post('/activities/tasks/:id/complete', requirePermission('activities.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await sales.completeTask(req.auth, req, req.params.id));
}));
client.get('/reports', requirePermission('reports.view'), asyncHandler(async (req, res) => ok(res, await intel.reportList(req.auth))));
client.get('/reports/:slug', requirePermission('reports.view'), asyncHandler(async (req, res) => ok(res, await intel.reportView(req.auth, req.params.slug))));
client.get('/analytics', requirePermission('analytics.view'), asyncHandler(async (req, res) => ok(res, await intel.analytics(req.auth, req.query.view || 'marketing'))));
client.get('/connections', requirePermission('connections.view'), asyncHandler(async (req, res) => ok(res, await connections.index(req.auth))));
client.post('/connections', requirePermission('connections.manage'), validate(schemas.connectSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.connect(req.auth, req), 201);
}));
client.post('/connections/api', requirePermission('connections.manage'), validate(schemas.providerApiSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.saveProviderApi(req.auth, req));
}));
client.get('/connections/:id', requirePermission('connections.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.detail(req.auth, req.params.id));
}));
client.patch('/connections/:id', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.configSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.updateConfig(req.auth, req, req.params.id));
}));
client.post('/connections/:id/nexcall-key', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.nexcallKeySchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.saveNexcallKey(req.auth, req, req.params.id));
}));
client.post('/connections/:id/sync', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.sync(req.auth, req, req.params.id));
}));
client.get('/connections/:id/meta/pages', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaPages(req.auth, req.params.id));
}));
client.get('/connections/:id/meta/pixels', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaPixels(req.auth, req.params.id));
}));
client.get('/connections/:id/meta/instagram', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaInstagram(req.auth, req.params.id, req.query.pageId));
}));
client.post('/connections/:id/meta/campaigns', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.metaCampaignSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.createMetaCampaign(req.auth, req, req.params.id), 201);
}));
client.post('/connections/:id/meta/ads', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.metaAdSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.publishMetaAd(req.auth, req, req.params.id), 201);
}));
client.post('/connections/:id/meta/edit', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.metaEditSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.editMetaAdCampaign(req.auth, req, req.params.id));
}));
client.post('/connections/:id/meta/status', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.metaStatusSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.updateMetaCampaignStatus(req.auth, req, req.params.id));
}));
client.post('/connections/:id/disconnect', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.disconnect(req.auth, req, req.params.id));
}));
client.get('/ai/insights', requirePermission('ai.use'), asyncHandler(async (req, res) => ok(res, await intel.listInsights(req.auth))));
client.get('/ai/recommendations', requirePermission('ai.use'), asyncHandler(async (req, res) => ok(res, await intel.listRecommendations(req.auth))));
client.patch('/ai/recommendations/:id', requirePermission('ai.use'), validate(schemas.idParams.merge(schemas.recommendationSchema)), asyncHandler(async (req, res) => {
  ok(res, await intel.setRecommendation(req.auth, req, req.params.id));
}));
client.get('/ai/monitoring', requirePermission('ai.use'), asyncHandler(async (req, res) => ok(res, await intel.monitoring(req.auth))));
client.post('/ai/ask', requirePermission('ai.use'), validate(schemas.askSchema), asyncHandler(async (req, res) => ok(res, await intel.ask(req.auth, req))));
client.get('/ai/history', requirePermission('ai.use'), asyncHandler(async (req, res) => ok(res, await intel.history(req.auth, req.query.conversationId))));
client.get('/notifications', asyncHandler(async (req, res) => ok(res, await intel.notifications(req.auth))));
client.post('/notifications/read-all', asyncHandler(async (req, res) => {
  await intel.readAllNotifications(req.auth);
  ok(res, { read: true });
}));
client.post('/notifications/:id/read', validate(schemas.idParams), asyncHandler(async (req, res) => {
  await intel.readNotification(req.auth, req.params.id);
  ok(res, { read: true });
}));
client.get('/search', asyncHandler(async (req, res) => ok(res, await intel.search(req.auth, req.query.q || ''))));
client.get('/team', requirePermission('users.view'), asyncHandler(async (req, res) => ok(res, await workspace.team(req.auth))));
client.post('/team/invite', requirePermission('users.invite'), validate(schemas.inviteSchema), asyncHandler(async (req, res) => {
  ok(res, await workspace.invite(req.auth, req), 201);
}));
client.get('/settings', requirePermission('settings.view'), asyncHandler(async (req, res) => ok(res, await workspace.settings(req.auth))));
client.patch('/settings', requirePermission('settings.manage'), validate(schemas.settingSchema), asyncHandler(async (req, res) => {
  ok(res, await workspace.updateSettings(req.auth, req));
}));
client.get('/audit', requirePermission('audit.view'), asyncHandler(async (req, res) => ok(res, await intel.clientAudit(req.auth))));
router.use(client);

const admin = Router();
admin.use(authenticate, requireRealm('platform'));
admin.get('/overview', requirePermission('platform.overview.view'), asyncHandler(async (req, res) => ok(res, await platform.overview())));
admin.get('/organizations', requirePermission('organizations.view'), asyncHandler(async (req, res) => ok(res, await platform.organizations())));
admin.get('/organizations/:id', requirePermission('organizations.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await platform.organization(req.params.id));
}));
admin.post('/organizations/:id/support-access', requirePermission('organizations.impersonate'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await platform.supportAccess(req, req.params.id));
}));
admin.get('/users', requirePermission('platform_users.view'), asyncHandler(async (req, res) => ok(res, await platform.users())));
admin.post('/users/invite', requirePermission('platform_users.invite'), validate(schemas.platformInviteSchema), asyncHandler(async (req, res) => {
  ok(res, await platform.invitePlatformUser(req), 201);
}));
admin.patch('/users/:id', requirePermission('platform_users.manage'), validate(schemas.idParams.merge(schemas.statusSchema)), asyncHandler(async (req, res) => {
  ok(res, await platform.setUserStatus(req, req.params.id));
}));
admin.get('/sales', requirePermission('platform_sales.view'), asyncHandler(async (req, res) => ok(res, await platform.sales())));
admin.patch('/sales/:id', requirePermission('platform_sales.manage'), validate(schemas.idParams.merge(schemas.saleSchema)), asyncHandler(async (req, res) => {
  ok(res, await platform.updateSale(req, req.params.id));
}));
admin.get('/support', requirePermission('support.view'), asyncHandler(async (req, res) => ok(res, await platform.support())));
admin.get('/support/:id', requirePermission('support.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await platform.supportTicket(req.params.id));
}));
admin.post('/support/:id/notes', requirePermission('support.manage'), validate(schemas.idParams.merge(schemas.noteSchema)), asyncHandler(async (req, res) => {
  ok(res, await platform.addSupportNote(req, req.params.id));
}));
admin.get('/finance', requirePermission('finance.view'), asyncHandler(async (req, res) => ok(res, await platform.finance())));
admin.get('/moderation', requirePermission('moderation.view'), asyncHandler(async (req, res) => ok(res, await platform.moderation())));
admin.patch('/moderation/:id', requirePermission('moderation.manage'), validate(schemas.idParams.merge(schemas.moderationSchema)), asyncHandler(async (req, res) => {
  ok(res, await platform.actOnModeration(req, req.params.id));
}));
admin.get('/analytics', requirePermission('platform_analytics.view'), asyncHandler(async (req, res) => ok(res, await platform.overview())));
admin.get('/integrations', requirePermission('platform_integrations.view'), asyncHandler(async (req, res) => ok(res, await platform.integrations())));
admin.post('/integrations/api-keys', requirePermission('platform_integrations.manage'), validate(schemas.apiKeySchema), asyncHandler(async (req, res) => {
  ok(res, await platform.createApiKey(req), 201);
}));
admin.get('/ai', requirePermission('platform_ai.view'), asyncHandler(async (req, res) => ok(res, await platform.ai())));
admin.get('/security', requirePermission('security.view'), asyncHandler(async (req, res) => ok(res, await platform.security())));
admin.get('/settings', requirePermission('platform_settings.view'), asyncHandler(async (req, res) => ok(res, await platform.settings())));
admin.patch('/settings', requirePermission('platform_settings.manage'), validate(schemas.settingSchema), asyncHandler(async (req, res) => {
  ok(res, await platform.updateSettings(req));
}));
admin.get('/whatsapp', requirePermission('whatsapp_bot.manage'), asyncHandler(async (req, res) => ok(res, await whatsapp.overview())));
admin.post('/whatsapp/connect', requirePermission('whatsapp_bot.manage'), validate(schemas.whatsappConnectSchema), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.connectBot(req));
}));
admin.post('/whatsapp/disconnect', requirePermission('whatsapp_bot.manage'), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.disconnectBot(req));
}));
admin.patch('/whatsapp', requirePermission('whatsapp_bot.manage'), validate(schemas.whatsappBotSchema), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.updateBot(req));
}));
admin.patch('/whatsapp/businesses', requirePermission('whatsapp_bot.manage'), validate(schemas.whatsappBusinessSchema), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.setBusiness(req));
}));
admin.get('/whatsapp/conversations/:id', requirePermission('whatsapp_bot.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.conversation(req.params.id));
}));
admin.get('/search', asyncHandler(async (req, res) => ok(res, await platform.search(req.query.q || ''))));
router.use('/admin', admin);

export default router;
