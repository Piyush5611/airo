import express, { Router } from 'express';
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
import * as llm from '../services/llmService.js';
import * as metaWebhook from '../services/metaWebhookService.js';
import * as adsAgent from '../services/adsAgent/agentService.js';
import * as adsStrategy from '../services/adsAgent/strategyService.js';
import * as adsLaunch from '../services/adsAgent/launchService.js';
import * as adsMonitor from '../services/adsAgent/monitorService.js';
import * as adsApply from '../services/adsAgent/applyService.js';
import * as adsQuality from '../services/adsAgent/qualityService.js';
import * as offerings from '../services/offeringService.js';
import * as websiteForms from '../services/websiteFormService.js';
import * as competitors from '../services/competitorService.js';
import * as discovery from '../services/competitorDiscovery.js';
import * as competitorAds from '../services/competitorAds.js';
import * as compIntel from '../services/competitorIntel.js';
import * as research from '../services/researchTools.js';
import * as usage from '../services/usageService.js';
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

router.get('/google-ads/callback', asyncHandler(async (req, res) => {
  res.redirect(302, await connections.googleCallback(req));
}));

router.get('/meta-ads/callback', asyncHandler(async (req, res) => {
  res.redirect(302, await connections.metaCallback(req));
}));

router.post('/hooks/:token', asyncHandler(async (req, res) => {
  ok(res, await connections.ingestWebhook(req.params.token, req.body));
}));

router.post('/forms/:token', express.urlencoded({ extended: true, limit: '64kb', parameterLimit: 120 }), asyncHandler(async (req, res) => {
  ok(res, await websiteForms.ingestWebsiteForm(req.params.token, req.body));
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

router.get('/assistant', authenticate, asyncHandler(async (req, res) => {
  ok(res, await llm.assistantPublic());
}));
router.post('/assistant/chat', authenticate, validate(schemas.llmChatSchema), asyncHandler(async (req, res) => {
  ok(res, await llm.chatLlm(req));
}));

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
client.get('/offerings', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await offerings.listOfferings(req.auth))));
client.post('/offerings', requirePermission('campaigns.update'), validate(schemas.offeringSchema), asyncHandler(async (req, res) => {
  ok(res, await offerings.createOffering(req.auth, req), 201);
}));
client.put('/offerings/logo', requirePermission('campaigns.update'), validate(schemas.imageUploadSchema), asyncHandler(async (req, res) => {
  ok(res, await offerings.saveLogo(req.auth, req));
}));
client.get('/offerings/media/:id', requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  const image = await offerings.media(req.auth, req.params.id);
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(image.bytes);
}));
client.delete('/offerings/media/:id', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await offerings.deleteMedia(req.auth, req, req.params.id));
}));
client.patch('/offerings/:id', requirePermission('campaigns.update'), validate(schemas.idParams.merge(schemas.offeringSchema)), asyncHandler(async (req, res) => {
  ok(res, await offerings.updateOffering(req.auth, req, req.params.id));
}));
client.delete('/offerings/:id', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await offerings.deleteOffering(req.auth, req, req.params.id));
}));
client.post('/offerings/:id/website-form', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  await websiteForms.enableWebsiteForm(req.auth, req, req.params.id);
  ok(res, await offerings.listOfferings(req.auth));
}));
client.get('/offerings/:id/website-form/leads', requirePermission('campaigns.view'), requirePermission('leads.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await websiteForms.websiteFormLeads(req.auth, req.params.id));
}));
client.post('/offerings/:id/website-form/check', requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  const check = await websiteForms.checkWebsiteForm(req.auth, req, req.params.id);
  ok(res, { check, ...(await offerings.listOfferings(req.auth)) });
}));
client.delete('/offerings/:id/website-form', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  await websiteForms.disableWebsiteForm(req.auth, req, req.params.id);
  ok(res, await offerings.listOfferings(req.auth));
}));
client.get('/competitors', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await competitors.listCompetitors(req.auth))));
client.post('/competitors', requirePermission('campaigns.update'), validate(schemas.competitorSchema), asyncHandler(async (req, res) => {
  ok(res, await competitors.createCompetitor(req.auth, req), 201);
}));
client.get('/competitors/suggestions', requirePermission('campaigns.view'), asyncHandler(async (req, res) => {
  const offeringId = Math.max(0, Math.trunc(Number(req.query.offeringId) || 0));
  ok(res, await discovery.suggestionList(req.auth, offeringId));
}));
client.post('/competitors/discover', requirePermission('campaigns.update'), validate(schemas.discoverSchema), asyncHandler(async (req, res) => {
  ok(res, await discovery.startDiscovery(req.auth, req, req.body.offeringId));
}));
client.post('/competitors/suggestions/:id/add', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await discovery.addSuggestion(req.auth, req, req.params.id));
}));
client.post('/competitors/suggestions/:id/ignore', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await discovery.ignoreSuggestion(req.auth, req, req.params.id));
}));
client.post('/competitors/import-profile', requirePermission('campaigns.update'), asyncHandler(async (req, res) => {
  ok(res, await competitors.importFromProfile(req.auth, req));
}));
client.get('/competitors/intelligence', requirePermission('campaigns.view'), asyncHandler(async (req, res) => {
  ok(res, await compIntel.overview(req.auth));
}));
client.get(['/competitors/intelligence/ads', '/competitors/intelligence/creatives'], requirePermission('campaigns.view'), validate(schemas.competitorAdFilterSchema), asyncHandler(async (req, res) => {
  ok(res, await compIntel.adList(req.auth, req.query));
}));
client.post('/competitors/intelligence/analyze', requirePermission('campaigns.update'), asyncHandler(async (req, res) => {
  ok(res, await compIntel.analyzeNow(req.auth, req));
}));
client.post('/competitors/intelligence/strategy', requirePermission('campaigns.update'), asyncHandler(async (req, res) => {
  ok(res, await compIntel.generateStrategy(req.auth, req, 0));
}));
client.get('/competitors/intelligence/ad-ideas', requirePermission('campaigns.view'), asyncHandler(async (req, res) => {
  ok(res, await compIntel.latestAdIdeas(req.auth, 0));
}));
client.post('/competitors/intelligence/ad-ideas', requirePermission('campaigns.update'), asyncHandler(async (req, res) => {
  ok(res, await compIntel.generateAdIdeas(req.auth, req, 0));
}));
client.get(['/competitors/ads/:id', '/competitors/creatives/:id'], requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await compIntel.adDetail(req.auth, req.params.id));
}));
client.get('/competitors/:id/insights', requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await compIntel.competitorInsights(req.auth, req.params.id));
}));
client.post('/competitors/:id/strategy', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await compIntel.generateStrategy(req.auth, req, req.params.id));
}));
client.get('/competitors/:id/ad-ideas', requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await compIntel.latestAdIdeas(req.auth, req.params.id));
}));
client.post('/competitors/:id/ad-ideas', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await compIntel.generateAdIdeas(req.auth, req, req.params.id));
}));
client.post('/competitors/:id/verify', requirePermission('campaigns.update'), validate(schemas.idParams.merge(schemas.competitorVerifySchema)), asyncHandler(async (req, res) => {
  ok(res, await compIntel.setCompetitorVerified(req.auth, req, req.params.id, req.body.verified));
}));
client.get('/competitors/:id', requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await competitors.competitorDetail(req.auth, req.params.id));
}));
client.patch('/competitors/:id', requirePermission('campaigns.update'), validate(schemas.idParams.merge(schemas.competitorSchema)), asyncHandler(async (req, res) => {
  ok(res, await competitors.updateCompetitor(req.auth, req, req.params.id));
}));
client.delete('/competitors/:id', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await competitors.deleteCompetitor(req.auth, req, req.params.id));
}));
client.post('/competitors/:id/find-website', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await discovery.findWebsite(req.auth, req, req.params.id));
}));
client.post('/competitors/:id/analyze', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await competitors.analyzeCompetitor(req.auth, req, req.params.id));
}));
client.get(['/competitors/:id/ads', '/competitors/:id/watch'], requirePermission('campaigns.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await competitorAds.competitorAds(req.auth, req.params.id));
}));
client.post(['/competitors/:id/ads/check', '/competitors/:id/watch/check'], requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await competitorAds.checkCompetitorAds(req.auth, req, req.params.id));
}));
client.post('/offerings/:id/photos', requirePermission('campaigns.update'), validate(schemas.idParams.merge(schemas.imageUploadSchema)), asyncHandler(async (req, res) => {
  ok(res, await offerings.addPhoto(req.auth, req, req.params.id), 201);
}));
client.get('/ads-agent', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsAgent.overview(req.auth, req.query.days))));
client.put('/ads-agent/settings', requirePermission('campaigns.update'), validate(schemas.adsAgentSettingsSchema), asyncHandler(async (req, res) => {
  ok(res, await adsAgent.saveSettings(req.auth, req));
}));
client.post('/ads-agent/sync', requirePermission('campaigns.update'), validate(schemas.adsAgentSyncSchema), asyncHandler(async (req, res) => {
  ok(res, await adsAgent.syncNow(req.auth, req));
}));
client.get('/ads-agent/profile', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsStrategy.getProfile(req.auth))));
client.put('/ads-agent/profile', requirePermission('campaigns.update'), validate(schemas.businessProfileBody), asyncHandler(async (req, res) => {
  ok(res, await adsStrategy.saveProfile(req.auth, req));
}));
client.get('/ads-agent/strategies', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsStrategy.listStrategies(req.auth))));
client.post('/ads-agent/strategies', requirePermission('campaigns.update'), asyncHandler(async (req, res) => {
  ok(res, await adsStrategy.generateStrategy(req.auth, req), 201);
}));
client.post('/ads-agent/strategies/:id/approve', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await adsStrategy.setStrategyStatus(req.auth, req, req.params.id, 'approved'));
}));
client.post('/ads-agent/strategies/:id/archive', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await adsStrategy.setStrategyStatus(req.auth, req, req.params.id, 'archived'));
}));
client.post('/ads-agent/monitor', requirePermission('campaigns.update'), asyncHandler(async (req, res) => ok(res, await adsMonitor.monitorNow(req.auth, req))));
client.post('/ads-agent/decisions/:id/dismiss', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await adsMonitor.dismiss(req.auth, req, req.params.id));
}));
client.get('/ads-agent/quality', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsQuality.quality(req.auth, req.query))));
client.get('/ads-agent/analysis', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsQuality.analysis(req.auth, req.query))));
client.get('/ads-agent/experiments', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsQuality.experiments(req.auth))));
client.post('/ads-agent/leads/import', requirePermission('campaigns.update'), asyncHandler(async (req, res) => ok(res, await adsQuality.importNow(req.auth, req))));
client.post('/ads-agent/decisions/:id/apply', requirePermission('campaigns.update', 'connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await adsApply.approve(req.auth, req, req.params.id));
}));
client.get('/ads-agent/launches', requirePermission('campaigns.view'), asyncHandler(async (req, res) => ok(res, await adsLaunch.listLaunches(req.auth))));
client.post('/ads-agent/launches', requirePermission('campaigns.update'), validate(schemas.launchCreateSchema), asyncHandler(async (req, res) => {
  ok(res, await adsLaunch.createLaunch(req.auth, req), 201);
}));
client.patch('/ads-agent/launches/:id', requirePermission('campaigns.update'), validate(schemas.launchEditBody), asyncHandler(async (req, res) => {
  ok(res, await adsLaunch.updateLaunch(req.auth, req, req.params.id));
}));
client.post('/ads-agent/launches/:id/create', requirePermission('campaigns.update', 'connections.manage'), validate(schemas.launchPausedBody), asyncHandler(async (req, res) => {
  ok(res, await adsLaunch.createPaused(req.auth, req, req.params.id));
}));
client.post('/ads-agent/launches/:id/publish', requirePermission('campaigns.update', 'connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await adsLaunch.publish(req.auth, req, req.params.id));
}));
client.post('/ads-agent/launches/:id/cancel', requirePermission('campaigns.update'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await adsLaunch.cancel(req.auth, req, req.params.id));
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
client.get('/connections/:id/leads', requirePermission('connections.view'), requirePermission('leads.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.connectionLeads(req.auth, req.params.id));
}));
client.patch('/connections/:id', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.configSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.updateConfig(req.auth, req, req.params.id));
}));
client.post('/connections/:id/nexcall-key', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.nexcallKeySchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.saveNexcallKey(req.auth, req, req.params.id));
}));
client.get('/connections/:id/call-yatri/stats', requirePermission('connections.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.callYatriStats(req.auth, req.params.id, String(req.query.day || '')));
}));
client.get('/connections/:id/call-yatri/records', requirePermission('connections.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.callYatriRecords(req.auth, req.params.id, String(req.query.kind || ''), String(req.query.day || '')));
}));
client.get('/connections/:id/call-yatri/teams', requirePermission('connections.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.callYatriTeams(req.auth, req.params.id));
}));
client.put('/connections/:id/call-yatri/teams', requirePermission('connections.manage'), validate(schemas.callTeamsSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.saveCallYatriTeams(req.auth, req, req.params.id));
}));
client.post('/connections/:id/sync', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.sync(req.auth, req, req.params.id));
}));
client.get('/connections/:id/meta/pages', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaPages(req.auth, req.params.id));
}));
client.post('/connections/:id/meta/pages', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.connectMetaPages(req.auth, req.params.id));
}));
client.get('/connections/:id/meta/report', requirePermission('connections.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaReportFor(req.auth, req.params.id, String(req.query.range || 'LAST_30_DAYS')));
}));
client.get('/connections/:id/meta/campaigns/:campaignId', requirePermission('connections.view'), validate(schemas.campaignParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaCampaignFor(req.auth, req.params.id, String(req.params.campaignId || ''), String(req.query.range || 'LAST_30_DAYS')));
}));
client.get('/connections/:id/meta/audience', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.metaAudienceSearch(req.auth, req.params.id, req.query.kind, req.query.q));
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
client.post('/connections/:id/meta/items/:kind/:itemId', requirePermission('connections.manage'), validate(schemas.metaItemEdit), asyncHandler(async (req, res) => {
  ok(res, await connections.editMetaItemFor(req.auth, req, req.params.id));
}));
client.post('/connections/:id/google/items/:kind/:itemId', requirePermission('connections.manage'), validate(schemas.googleItemEdit), asyncHandler(async (req, res) => {
  ok(res, await connections.editGoogleItemFor(req.auth, req, req.params.id));
}));
client.post('/connections/:id/meta/edit', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.metaEditSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.editMetaAdCampaign(req.auth, req, req.params.id));
}));
client.post('/connections/:id/meta/status', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.metaStatusSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.updateMetaCampaignStatus(req.auth, req, req.params.id));
}));
client.post('/connections/meta/start', requirePermission('connections.manage'), validate(schemas.oauthStartSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.metaStart(req.auth, req.body.target));
}));
client.get('/connections/meta/accounts', requirePermission('connections.manage'), validate(schemas.oauthAccountsQuery), asyncHandler(async (req, res) => {
  ok(res, await connections.metaAccounts(req.auth, req.query.connection));
}));
client.post('/connections/meta/account', requirePermission('connections.manage'), validate(schemas.metaAccountSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.chooseMetaAccount(req.auth, req));
}));
client.post('/connections/google/start', requirePermission('connections.manage'), validate(schemas.oauthStartSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.googleStart(req.auth, req.body.target));
}));
client.get('/connections/google/accounts', requirePermission('connections.manage'), validate(schemas.oauthAccountsQuery), asyncHandler(async (req, res) => {
  ok(res, await connections.googleAccounts(req.auth, req.query.connection));
}));
client.post('/connections/google/account', requirePermission('connections.manage'), validate(schemas.googleAccountSchema), asyncHandler(async (req, res) => {
  ok(res, await connections.chooseGoogleAccount(req.auth, req));
}));
client.post('/connections/:id/google/keyword-check', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.recheckKeywordPlanner(req.auth, req, req.params.id));
}));
client.get('/connections/:id/google/locations', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.googleLocations(req.auth, req.params.id, req.query.q));
}));
client.get('/connections/:id/google/languages', requirePermission('connections.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.googleLanguages(req.auth, req.params.id, req.query.q));
}));
client.post('/connections/:id/google/ideas', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.googleIdeasSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.googleIdeas(req.auth, req, req.params.id));
}));
client.get('/connections/:id/google/report', requirePermission('connections.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await connections.googleReportFor(req.auth, req.params.id, String(req.query.range || 'LAST_30_DAYS')));
}));
client.get('/connections/:id/google/campaigns/:campaignId', requirePermission('connections.view'), validate(schemas.campaignParams), asyncHandler(async (req, res) => {
  ok(res, await connections.googleCampaignFor(req.auth, req.params.id, String(req.params.campaignId || ''), String(req.query.range || 'LAST_30_DAYS')));
}));
client.post('/connections/:id/google/campaigns', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.googleCampaignSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.createGoogleCampaign(req.auth, req, req.params.id), 201);
}));
client.post('/connections/:id/google/edit', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.googleEditSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.editGoogleAdCampaign(req.auth, req, req.params.id));
}));
client.post('/connections/:id/google/status', requirePermission('connections.manage'), validate(schemas.idParams.merge(schemas.googleStatusSchema)), asyncHandler(async (req, res) => {
  ok(res, await connections.updateGoogleCampaignStatus(req.auth, req, req.params.id));
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
client.patch('/organization', requirePermission('settings.manage'), validate(schemas.organizationSchema), asyncHandler(async (req, res) => {
  ok(res, await workspace.updateOrganization(req.auth, req));
}));
client.get('/audit', requirePermission('audit.view'), asyncHandler(async (req, res) => ok(res, await intel.clientAudit(req.auth))));
client.get('/whatsapp/live', requirePermission('leads.view'), (req, res) => {
  whatsapp.streamClientLive(req, res);
});
client.get('/whatsapp', requirePermission('leads.view'), asyncHandler(async (req, res) => ok(res, await whatsapp.clientInbox(req.auth))));
client.post('/whatsapp/numbers', requirePermission('settings.manage'), validate(schemas.whatsappNumberSchema), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.addBusinessNumber(req), 201);
}));
client.patch('/whatsapp/numbers/:id', requirePermission('settings.manage'), validate(schemas.idParams.merge(schemas.whatsappNumberSchema)), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.updateBusinessNumber(req, req.params.id));
}));
client.delete('/whatsapp/numbers/:id', requirePermission('settings.manage'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.removeBusinessNumber(req, req.params.id));
}));
client.get('/whatsapp/leads/:id', requirePermission('leads.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.clientLeadChats(req.auth, req.params.id));
}));
client.get('/whatsapp/conversations/:id', requirePermission('leads.view'), validate(schemas.idParams), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.clientConversation(req.auth, req.params.id));
}));
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
admin.get('/ai', requirePermission('platform_ai.view'), asyncHandler(async (req, res) => {
  ok(res, { ...(await platform.ai()), canManage: req.auth.permissions.includes('platform_ai.manage') });
}));
admin.post('/ai/models', requirePermission('platform_ai.manage'), validate(schemas.llmModelsSchema), asyncHandler(async (req, res) => {
  ok(res, await llm.llmModels(req));
}));
admin.post('/ai/connect', requirePermission('platform_ai.manage'), validate(schemas.llmConnectSchema), asyncHandler(async (req, res) => {
  ok(res, await llm.connectLlm(req));
}));
admin.post('/ai/disconnect', requirePermission('platform_ai.manage'), validate(schemas.llmDisconnectSchema), asyncHandler(async (req, res) => {
  ok(res, await llm.disconnectLlm(req));
}));
admin.get('/usage', requirePermission('platform_ai.view'), asyncHandler(async (req, res) => ok(res, await usage.platformUsage(req.query))));
admin.get('/research', requirePermission('research_tools.manage'), asyncHandler(async (req, res) => ok(res, await research.researchTools())));
admin.post('/research/apify', requirePermission('research_tools.manage'), validate(schemas.researchKeySchema), asyncHandler(async (req, res) => {
  ok(res, await research.connectApify(req));
}));
admin.delete('/research/apify', requirePermission('research_tools.manage'), asyncHandler(async (req, res) => {
  ok(res, await research.disconnectApify(req));
}));
admin.get('/security', requirePermission('security.view'), asyncHandler(async (req, res) => ok(res, await platform.security())));
admin.get('/settings', requirePermission('platform_settings.view'), asyncHandler(async (req, res) => ok(res, await platform.settings())));
admin.patch('/settings', requirePermission('platform_settings.manage'), validate(schemas.settingSchema), asyncHandler(async (req, res) => {
  ok(res, await platform.updateSettings(req));
}));
admin.get('/whatsapp/live', requirePermission('whatsapp_bot.manage'), (req, res) => {
  whatsapp.streamLive(req, res);
});
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
admin.post('/whatsapp/conversations/:id/messages', requirePermission('whatsapp_bot.manage'), validate(schemas.idParams.merge(schemas.whatsappSendSchema)), asyncHandler(async (req, res) => {
  ok(res, await whatsapp.sendMessage(req, req.params.id), 201);
}));
admin.get('/search', asyncHandler(async (req, res) => ok(res, await platform.search(req.query.q || ''))));
router.use('/admin', admin);

export default router;
