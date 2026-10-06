import { budgetPlan, businessProfileSchema, strategySchemaFor } from '../../domain/adsAgent.js';
import * as repo from '../../repositories/adsAgentRepo.js';
import { organizationSector } from '../../repositories/workspaceRepo.js';
import { sectorFacts, sectorOf } from '../../domain/sectors.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { structuredLlm } from '../llmService.js';

const STRATEGY_BRIEF = `You are the AIRO ads strategist. Plan paid ads for one business from the profile and the past results in the status.
Rules:
- Use only the platforms listed in the profile. budgetSharePct values must add up to 100.
- Never invent numbers, results, prices, offers, awards, or claims that are not in the profile or past results. Do not promise results.
- Do not write money amounts. AIRO calculates budgets from the profile.
- Meta interests are plain names; AIRO looks up real ids later. Locations must come from the profile.
- If Google is used, give 5 to 30 search keywords people would type, with match types. If not, leave keywords empty.
- Headlines under 40 characters, primary texts under 300 characters, in English unless the profile asks for another language. No ALL CAPS words, no exclamation marks.
- If past results exist, say in the summary what to keep or change and why. If there are none, say this is a first test.
- Keep risks honest and short (policy, small budget, missing website, special ad category if property, jobs, or loans).
JSON shape:
{"summary":"","platforms":[{"platform":"meta|google","budgetSharePct":0,"objective":"","why":""}],
"audiences":[{"platform":"meta|google","name":"","description":"","locations":[""],"ageMin":null,"ageMax":null,"interests":[""]}],
"keywords":[{"text":"","matchType":"EXACT|PHRASE|BROAD"}],"negativeKeywords":[""],
"angles":[{"name":"","message":""}],"headlines":[""],"primaryTexts":[""],
"tests":[{"hypothesis":"","variantA":"","variantB":"","metric":"ctr|cost_per_result|lead_quality"}],"risks":[""]}`;

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function schemaMissing(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR';
}

export async function getProfile(auth) {
  try {
    const row = await repo.profile(auth.organizationId);
    const sector = sectorOf(await organizationSector(auth.organizationId));
    return {
      ready: true,
      profile: row ? parseJson(row.profile) : null,
      updatedAt: row?.updatedAt || null,
      sector: sector ? { key: sector.key, label: sector.label, goal: sector.goal } : null
    };
  } catch (error) {
    if (schemaMissing(error)) return { ready: false, note: 'Run npm run migrate to set up the ads agent.' };
    throw error;
  }
}

export async function saveProfile(auth, req) {
  const value = businessProfileSchema.parse(req.body);
  if (value.priceMin != null && value.priceMax != null && value.priceMin > value.priceMax) {
    throw new ApiError(422, 'Lowest price is above the highest price.', 'validation_error');
  }
  await repo.saveProfile(auth.organizationId, auth.userId, value);
  await recordAudit(req, { action: 'ads_agent.profile', resource: 'business_profiles', resourceId: auth.organizationId });
  return { profile: value };
}

async function pastResults(organizationId) {
  const rows = await repo.campaignTotals(organizationId, 30);
  if (!rows.length) return null;
  return rows.slice(0, 10).map((row) => {
    const results = row.platform === 'meta' ? row.leads : row.conversions;
    return {
      platform: row.platform,
      campaign: row.name,
      currency: row.currency,
      spend: Number(row.spend),
      clicks: Number(row.clicks),
      impressions: Number(row.impressions),
      results: results == null ? null : Number(results),
      resultType: row.platform === 'meta' ? 'leads' : 'conversions',
      days: Number(row.days)
    };
  });
}

function factsFor(profile, metrics, sector) {
  const lines = [`Business profile (from the owner): ${JSON.stringify(profile)}`, ...sectorFacts(sector)];
  lines.push(metrics
    ? `Past 30 days by campaign (synced from the ad accounts): ${JSON.stringify(metrics)}`
    : 'Past results: none synced yet.');
  return lines.join('\n');
}

function publicStrategy(row) {
  const profile = parseJson(row.profileSnapshot);
  const strategy = parseJson(row.strategy);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    model: row.model,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    usedPastResults: Boolean(parseJson(row.metricsSnapshot)),
    strategy,
    budget: profile && strategy ? budgetPlan(profile, strategy) : null
  };
}

export async function listStrategies(auth) {
  try {
    const rows = await repo.strategies(auth.organizationId, 10);
    return { items: rows.map(publicStrategy) };
  } catch (error) {
    if (schemaMissing(error)) return { items: [] };
    throw error;
  }
}

export async function generateStrategy(auth, req) {
  const saved = await repo.profile(auth.organizationId);
  const parsedProfile = businessProfileSchema.safeParse(parseJson(saved?.profile));
  if (!parsedProfile.success) throw new ApiError(422, 'Save the business profile first.', 'validation_error');
  const profile = parsedProfile.data;
  if (!(await repo.claimJob(`ads.strategy.org.${auth.organizationId}`, 1))) {
    throw new ApiError(429, 'A strategy was requested less than a minute ago. Try again shortly.', 'rate_limited');
  }
  const metrics = await pastResults(auth.organizationId);
  const result = await structuredLlm({
    organizationId: auth.organizationId,
    schema: strategySchemaFor(profile),
    system: STRATEGY_BRIEF,
    facts: factsFor(profile, metrics, await organizationSector(auth.organizationId)),
    task: 'Write the ads strategy for this business as JSON.'
  });
  const created = await repo.addStrategy({
    organizationId: auth.organizationId,
    userId: auth.userId,
    profile,
    metrics,
    strategy: result.data,
    model: result.model
  });
  await recordAudit(req, { action: 'ads_agent.strategy_generated', resource: 'ad_strategies', resourceId: created.id, metadata: { version: created.version, model: result.model } });
  return { id: created.id, version: created.version, strategy: result.data, budget: budgetPlan(profile, result.data), model: result.model };
}

export async function setStrategyStatus(auth, req, id, status) {
  const row = await repo.strategy(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Strategy not found.', 'not_found');
  if (status === 'approved') {
    if (row.status === 'archived') throw new ApiError(422, 'Archived strategies cannot be approved. Generate a new one.', 'validation_error');
    await repo.approveStrategy(auth.organizationId, id, auth.userId);
  } else {
    await repo.archiveStrategy(auth.organizationId, id);
  }
  await recordAudit(req, { action: `ads_agent.strategy_${status}`, resource: 'ad_strategies', resourceId: id, metadata: { version: row.version } });
  return { id, status };
}
