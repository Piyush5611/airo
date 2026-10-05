import { budgetPlan, googleCreativeSchema, launchEditSchema, metaCreativeSchema, OBJECTIVE_FOR_GOAL } from '../../domain/adsAgent.js';
import { createGoogleSearchCampaign, setGoogleCampaignStatus, suggestGoogleLocations } from '../../integrations/googleAds.js';
import { createMetaAd, searchMetaAudience, setMetaCampaignStatus } from '../../integrations/metaAds.js';
import * as repo from '../../repositories/adsAgentRepo.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { structuredLlm } from '../llmService.js';
import { checkLaunch, normalizeSettings } from './guardrails.js';
import { adConnections } from './metricsSync.js';

const PLATFORM_NAME = { meta: 'Meta Ads', google: 'Google Ads' };

const META_BRIEF = `You write Meta (Facebook and Instagram) image ad copy for one business from its profile and approved strategy.
- Write 2 or 3 variants. Each variant tests a different angle from the strategy.
- headline under 40 characters, primaryText under 300 characters.
- Use only facts from the profile and strategy. Never invent prices, offers, discounts, awards, dates, or guarantees.
- No ALL CAPS words, no exclamation marks, no emojis. Write in the profile's ad language, English if none is given.
JSON shape: {"variants":[{"headline":"","primaryText":""}]}`;

const GOOGLE_BRIEF = `You write one Google responsive search ad for one business from its profile and approved strategy.
- 8 to 15 headlines, each 30 characters or fewer, all different. Include the main keywords and locations naturally.
- 2 to 4 descriptions, each 90 characters or fewer.
- path1 and path2: short URL path words, 15 characters or fewer each, or empty.
- Use only facts from the profile and strategy. Never invent prices, offers, discounts, awards, dates, or guarantees.
- No ALL CAPS words, no exclamation marks.
JSON shape: {"headlines":[""],"descriptions":[""],"path1":"","path2":""}`;

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function publicLaunch(row) {
  const settings = parseJson(row.settings) || {};
  return {
    ...row,
    creative: parseJson(row.creative),
    settings,
    missing: missingFor(row.platform, settings)
  };
}

function missingFor(platform, settings) {
  const missing = [];
  if (!(Number(settings.dailyBudget) > 0)) missing.push('dailyBudget');
  if (platform === 'meta') {
    if (!settings.pageId) missing.push('pageId');
    if (!/^https:\/\//i.test(settings.link || '')) missing.push('link');
  } else {
    if (!/^https?:\/\//i.test(settings.link || '')) missing.push('link');
    if (!settings.keywords?.length) missing.push('keywords');
  }
  return missing;
}

async function accountFor(organizationId, platform, connectionId) {
  const accounts = (await adConnections(organizationId)).filter((item) => item.platform === platform);
  const chosen = connectionId ? accounts.find((item) => Number(item.id) === Number(connectionId)) : accounts[0];
  if (!chosen) throw new ApiError(422, `${PLATFORM_NAME[platform]} is not connected. Connect it under Connections first.`, 'validation_error');
  return chosen;
}

function googleInput(secret) {
  return { refreshToken: secret.apiKey, accountId: secret.accountId, loginCustomerId: secret.loginCustomerId || '', currency: secret.currency || '' };
}

function placeNames(list) {
  return [...new Set(list.flatMap((item) => String(item).split(',')).map((item) => item.trim()).filter(Boolean))].slice(0, 10);
}

async function metaTargeting(secret, profile, audience) {
  const notes = [];
  const locations = [];
  for (const place of placeNames(audience?.locations?.length ? audience.locations : profile.locations)) {
    const found = await searchMetaAudience({ apiKey: secret.apiKey, kind: 'city', query: place }).catch(() => []);
    const hit = found.find((row) => row.name.toLowerCase() === place.toLowerCase()) || found[0];
    if (hit) locations.push({ key: hit.key, name: hit.name, region: hit.region || '', radiusMode: 'city' });
    else notes.push(`Meta did not find the city "${place}". The ad targets India until you add a city in Meta.`);
  }
  const interests = [];
  for (const name of (audience?.interests || []).slice(0, 8)) {
    const found = await searchMetaAudience({ apiKey: secret.apiKey, kind: 'interest', query: name }).catch(() => []);
    const hit = found.find((row) => row.name.toLowerCase() === name.toLowerCase()) || found[0];
    if (hit) interests.push({ id: hit.id, name: hit.name });
    else notes.push(`Meta has no interest called "${name}". It was left out.`);
  }
  return { locations, interests, notes };
}

async function googleLocations(secret, profile) {
  const notes = [];
  const locations = [];
  for (const place of placeNames(profile.locations)) {
    const found = await suggestGoogleLocations({ refreshToken: secret.apiKey, query: place }).catch(() => []);
    const hit = found.find((row) => /city/i.test(row.type)) || found[0];
    if (hit) locations.push({ id: hit.id, name: hit.name });
    else notes.push(`Google did not find "${place}". The campaign targets India until you add it.`);
  }
  return { locations, notes };
}

function creativeFacts(profile, strategy, platform) {
  return [
    `Business profile: ${JSON.stringify(profile)}`,
    `Approved strategy summary: ${strategy.summary}`,
    `Angles: ${JSON.stringify(strategy.angles)}`,
    `Strategy headlines: ${JSON.stringify(strategy.headlines)}`,
    `Strategy primary texts: ${JSON.stringify(strategy.primaryTexts)}`,
    platform === 'google' ? `Keywords: ${strategy.keywords.map((item) => item.text).join(', ')}` : `Audiences: ${JSON.stringify(strategy.audiences.filter((row) => row.platform === 'meta'))}`
  ].join('\n');
}

export async function listLaunches(auth) {
  const [rows, accounts] = await Promise.all([repo.launches(auth.organizationId, 20), adConnections(auth.organizationId)]);
  return {
    items: rows.map(publicLaunch),
    accounts: accounts.map((item) => ({ id: item.id, platform: item.platform, accountId: String(item.secret.accountId || '') }))
  };
}

export async function createLaunch(auth, req) {
  const { strategyId, platform, connectionId } = req.body;
  const row = await repo.approvedStrategy(auth.organizationId, strategyId);
  if (!row) throw new ApiError(422, 'Approve a strategy before making ads from it.', 'validation_error');
  const profile = parseJson(row.profileSnapshot);
  const strategy = parseJson(row.strategy);
  if (!strategy.platforms.some((item) => item.platform === platform)) {
    throw new ApiError(422, `This strategy does not use ${PLATFORM_NAME[platform]}.`, 'validation_error');
  }
  const account = await accountFor(auth.organizationId, platform, connectionId);
  if (!(await repo.claimJob(`ads.creative.org.${auth.organizationId}`, 1))) {
    throw new ApiError(429, 'Ads were requested less than a minute ago. Try again shortly.', 'rate_limited');
  }
  const written = await structuredLlm({
    organizationId: auth.organizationId,
    schema: platform === 'meta' ? metaCreativeSchema : googleCreativeSchema,
    system: platform === 'meta' ? META_BRIEF : GOOGLE_BRIEF,
    facts: creativeFacts(profile, strategy, platform),
    task: `Write the ${PLATFORM_NAME[platform]} ad copy as JSON.`
  });
  const daily = budgetPlan(profile, strategy)?.platforms.find((item) => item.platform === platform)?.daily || null;
  const name = `${profile.businessName} · AIRO v${row.version}`.slice(0, 150);
  let settings;
  if (platform === 'meta') {
    const audience = strategy.audiences.find((item) => item.platform === 'meta');
    const target = await metaTargeting(account.secret, profile, audience);
    const goal = OBJECTIVE_FOR_GOAL[profile.goal] || OBJECTIVE_FOR_GOAL.leads;
    settings = {
      name,
      objective: goal.objective,
      conversion: goal.conversion,
      dailyBudget: daily,
      currency: profile.currency,
      link: profile.website || '',
      pageId: '',
      specialCategory: 'none',
      ageMin: audience?.ageMin || null,
      ageMax: audience?.ageMax || null,
      locations: target.locations,
      interests: target.interests,
      notes: target.notes
    };
  } else {
    const target = await googleLocations(account.secret, profile);
    settings = {
      name,
      dailyBudget: daily,
      currency: profile.currency,
      link: profile.website || '',
      bidding: 'MAXIMIZE_CLICKS',
      locations: target.locations,
      keywords: strategy.keywords,
      negatives: strategy.negativeKeywords || [],
      notes: target.notes
    };
  }
  const id = await repo.addLaunch({
    organizationId: auth.organizationId,
    strategyId: row.id,
    platform,
    connectionId: account.id,
    creative: written.data,
    settings,
    model: written.model,
    userId: auth.userId
  });
  await recordAudit(req, { action: 'ads_agent.launch_drafted', resource: 'ad_launches', resourceId: id, metadata: { platform, strategyId: row.id } });
  return publicLaunch(await repo.launch(auth.organizationId, id));
}

export async function updateLaunch(auth, req, id) {
  const row = await repo.launch(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Ad draft not found.', 'not_found');
  if (row.status !== 'draft') throw new ApiError(422, 'Only drafts can be edited here.', 'validation_error');
  const edit = launchEditSchema.parse(req.body);
  const creative = parseJson(row.creative);
  const settings = parseJson(row.settings);
  if (edit.dailyBudget !== undefined) settings.dailyBudget = edit.dailyBudget;
  if (edit.link !== undefined) settings.link = edit.link;
  if (row.platform === 'meta') {
    if (edit.pageId !== undefined) settings.pageId = edit.pageId;
    if (edit.specialCategory !== undefined) settings.specialCategory = edit.specialCategory;
    if (edit.metaVariants) creative.variants = edit.metaVariants;
  } else {
    if (edit.googleHeadlines) creative.headlines = edit.googleHeadlines;
    if (edit.googleDescriptions) creative.descriptions = edit.googleDescriptions;
    if (edit.keywords) settings.keywords = edit.keywords;
    if (edit.negatives) settings.negatives = edit.negatives;
  }
  await repo.updateLaunchDraft(auth.organizationId, id, { creative, settings });
  await recordAudit(req, { action: 'ads_agent.launch_edited', resource: 'ad_launches', resourceId: id, metadata: { fields: Object.keys(edit) } });
  return publicLaunch(await repo.launch(auth.organizationId, id));
}

function metaPayload(settings, creative, imageBase64) {
  const special = settings.specialCategory && settings.specialCategory !== 'none' ? settings.specialCategory : 'none';
  const [first, second] = creative.variants;
  const payload = {
    name: settings.name,
    objective: settings.objective,
    conversion: settings.conversion,
    dailyBudget: Number(settings.dailyBudget),
    pageId: settings.pageId,
    headline: first.headline,
    message: first.primaryText,
    link: settings.link,
    imageBase64,
    publish: false,
    specialCategory: special,
    advantageAudience: true,
    locations: settings.locations.map((item) => (special === 'none' ? item : { ...item, radiusMode: 'radius', radius: 25 })),
    creativeTest: Boolean(second),
    headlineB: second?.headline,
    messageB: second?.primaryText
  };
  if (special === 'none') {
    if (settings.ageMin) payload.ageMin = settings.ageMin;
    if (settings.ageMax) payload.ageMax = settings.ageMax;
    payload.interests = settings.interests;
  }
  return payload;
}

async function logDecision(auth, row, type, status, reason, extra = {}) {
  const settings = normalizeSettings(await repo.settings(auth.organizationId));
  return repo.addDecision({
    organizationId: auth.organizationId,
    connectionId: row.connectionId,
    platform: row.platform,
    type,
    targetLevel: 'campaign',
    targetExternalId: extra.campaignId || row.externalCampaignId || null,
    targetName: parseJson(row.settings)?.name || null,
    reason,
    evidence: { launchId: row.id, strategyId: row.strategyId },
    proposedChange: extra.change || null,
    guardrail: extra.guardrail || null,
    mode: settings.mode,
    status,
    error: extra.error || null,
    decidedBy: auth.userId
  });
}

export async function createPaused(auth, req, id) {
  const row = await repo.launch(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Ad draft not found.', 'not_found');
  if (row.status !== 'draft') throw new ApiError(422, 'This draft was already created on the ad account.', 'validation_error');
  const settings = parseJson(row.settings);
  const creative = parseJson(row.creative);
  const missing = missingFor(row.platform, settings);
  if (missing.length) throw new ApiError(422, `Fill these first: ${missing.join(', ')}.`, 'validation_error');
  const rules = normalizeSettings(await repo.settings(auth.organizationId));
  if (rules.dailySpendCap != null && Number(settings.dailyBudget) > rules.dailySpendCap) {
    throw new ApiError(422, `Daily budget is above the daily spend cap (${rules.dailySpendCap}).`, 'validation_error');
  }
  if (row.platform === 'meta' && !req.body?.imageBase64) {
    throw new ApiError(422, 'Upload the ad image (JPG or PNG under 2 MB).', 'validation_error');
  }
  const account = await accountFor(auth.organizationId, row.platform, row.connectionId);
  let campaignId;
  try {
    if (row.platform === 'meta') {
      const result = await createMetaAd({ apiKey: account.secret.apiKey, accountId: account.secret.accountId, ...metaPayload(settings, creative, req.body.imageBase64) });
      campaignId = result.campaignId;
    } else {
      const result = await createGoogleSearchCampaign({
        ...googleInput(account.secret),
        name: settings.name,
        dailyBudget: Number(settings.dailyBudget),
        bidding: settings.bidding || 'MAXIMIZE_CLICKS',
        locations: settings.locations,
        keywords: settings.keywords,
        negatives: settings.negatives,
        finalUrl: settings.link,
        headlines: creative.headlines,
        descriptions: creative.descriptions,
        path1: creative.path1 || undefined,
        path2: creative.path2 || undefined,
        publish: false
      });
      campaignId = result.campaignId;
    }
  } catch (error) {
    await repo.setLaunchError(auth.organizationId, id, error.message);
    await logDecision(auth, row, 'campaign_create', 'failed', 'Owner asked to create the paused campaign.', { error: error.message });
    throw error;
  }
  await repo.markLaunchCreated(auth.organizationId, id, campaignId, auth.userId);
  await logDecision(auth, row, 'campaign_create', 'applied', 'Created as PAUSED from the approved strategy. Nothing is spent until it is published.', {
    campaignId,
    change: { status: 'PAUSED', dailyBudget: Number(settings.dailyBudget) }
  });
  await recordAudit(req, { action: 'ads_agent.launch_created', resource: 'ad_launches', resourceId: id, metadata: { platform: row.platform, campaignId } });
  return publicLaunch(await repo.launch(auth.organizationId, id));
}

export async function publish(auth, req, id) {
  const row = await repo.launch(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Ad draft not found.', 'not_found');
  if (row.status !== 'created' || !row.externalCampaignId) throw new ApiError(422, 'Create the paused campaign first.', 'validation_error');
  const settings = parseJson(row.settings);
  const spend = await repo.spendNow(auth.organizationId);
  const guardrail = checkLaunch({
    dailyBudget: settings.dailyBudget,
    settings: await repo.settings(auth.organizationId),
    spendToday: Number(spend?.spendToday || 0),
    spendMonth: Number(spend?.spendMonth || 0)
  });
  if (!guardrail.allowed) {
    await logDecision(auth, row, 'campaign_publish', 'blocked', 'Owner asked to publish.', { guardrail });
    throw new ApiError(422, guardrail.reasons.join(' '), 'guardrail_blocked');
  }
  const account = await accountFor(auth.organizationId, row.platform, row.connectionId);
  try {
    if (row.platform === 'meta') {
      await setMetaCampaignStatus({ apiKey: account.secret.apiKey, campaignId: row.externalCampaignId, status: 'ACTIVE' });
    } else {
      await setGoogleCampaignStatus({ ...googleInput(account.secret), campaignId: row.externalCampaignId, status: 'ENABLED' });
    }
  } catch (error) {
    await repo.setLaunchError(auth.organizationId, id, error.message);
    await logDecision(auth, row, 'campaign_publish', 'failed', 'Owner asked to publish.', { guardrail, error: error.message });
    throw error;
  }
  await repo.markLaunchPublished(auth.organizationId, id, auth.userId);
  await logDecision(auth, row, 'campaign_publish', 'applied', 'Published after owner approval.', {
    guardrail,
    change: { status: row.platform === 'meta' ? 'ACTIVE' : 'ENABLED', dailyBudget: Number(settings.dailyBudget) }
  });
  await recordAudit(req, { action: 'ads_agent.launch_published', resource: 'ad_launches', resourceId: id, metadata: { platform: row.platform, campaignId: row.externalCampaignId } });
  return publicLaunch(await repo.launch(auth.organizationId, id));
}

export async function cancel(auth, req, id) {
  const row = await repo.launch(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Ad draft not found.', 'not_found');
  if (row.status !== 'draft') throw new ApiError(422, 'Only drafts can be cancelled. Pause a created campaign from Connections.', 'validation_error');
  await repo.cancelLaunch(auth.organizationId, id);
  await recordAudit(req, { action: 'ads_agent.launch_cancelled', resource: 'ad_launches', resourceId: id });
  return publicLaunch(await repo.launch(auth.organizationId, id));
}
