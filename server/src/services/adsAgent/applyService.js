import { editGoogleCampaign, googleCampaignBudget, setGoogleCampaignStatus } from '../../integrations/googleAds.js';
import { editMetaItem, metaCampaignBudgets, setMetaCampaignStatus, setMetaDailyBudget } from '../../integrations/metaAds.js';
import * as repo from '../../repositories/adsAgentRepo.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { checkAction, normalizeSettings } from './guardrails.js';
import { adConnections } from './metricsSync.js';
import { budgetTotal, scaleBudgets } from './monitorRules.js';

export const APPLICABLE = new Set(['pause', 'budget_decrease', 'budget_increase', 'scale_winner', 'experiment_winner']);
const PAUSES = new Set(['pause', 'experiment_winner']);

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function googleInput(secret) {
  return { refreshToken: secret.apiKey, accountId: secret.accountId, loginCustomerId: secret.loginCustomerId || '' };
}

async function guardContext(organizationId, settings) {
  const [applied, spend] = await Promise.all([repo.actionsToday(organizationId), repo.spendNow(organizationId)]);
  return {
    settings,
    actionsToday: Number(applied?.total || 0),
    spendToday: Number(spend?.spendToday || 0),
    spendMonth: Number(spend?.spendMonth || 0)
  };
}

async function pause(account, row, context) {
  const guardrail = checkAction({ type: 'pause' }, context);
  if (!guardrail.allowed) return { guardrail };
  if (row.targetLevel === 'ad') {
    if (account.platform !== 'meta') throw new ApiError(422, 'Only Meta ads can be paused one by one.', 'validation_error');
    await editMetaItem({ apiKey: account.secret.apiKey, accountId: account.secret.accountId }, 'ad', row.targetExternalId, { status: 'PAUSED' });
    return { guardrail, outcome: { status: 'PAUSED', level: 'ad' } };
  }
  if (account.platform === 'meta') {
    await setMetaCampaignStatus({ apiKey: account.secret.apiKey, campaignId: row.targetExternalId, status: 'PAUSED' });
  } else {
    await setGoogleCampaignStatus({ ...googleInput(account.secret), campaignId: row.targetExternalId, status: 'PAUSED' });
  }
  return { guardrail, outcome: { status: 'PAUSED' } };
}

async function budget(account, row, change, context, auto) {
  const pct = Number(change?.changePct);
  if (!Number.isFinite(pct) || pct === 0) throw new ApiError(422, 'This recommendation has no budget change.', 'validation_error');
  let items;
  let currency = '';
  if (account.platform === 'meta') {
    const info = await metaCampaignBudgets({ apiKey: account.secret.apiKey, accountId: account.secret.accountId }, row.targetExternalId);
    if (info.lifetime || !info.items.length) {
      throw new ApiError(422, 'This campaign has no daily budget the agent can change. Change it in Meta Ads Manager.', 'validation_error');
    }
    items = info.items;
    currency = info.currency;
  } else {
    const info = await googleCampaignBudget(googleInput(account.secret), row.targetExternalId);
    if (info.shared) throw new ApiError(422, 'This campaign uses a shared budget. Change it in Google Ads.', 'validation_error');
    if (!(info.daily > 0)) throw new ApiError(422, 'Google Ads did not return the campaign budget.', 'validation_error');
    items = [{ id: String(row.targetExternalId), daily: info.daily }];
  }
  const next = scaleBudgets(items, pct);
  const guardrail = checkAction({ type: 'budget', currentBudget: budgetTotal(items), newBudget: budgetTotal(next) }, context);
  if (auto && pct > 0 && context.settings.dailySpendCap == null && context.settings.monthlySpendCap == null) {
    guardrail.reasons.push('Set a daily or monthly spend cap before the agent raises budgets on its own.');
    guardrail.allowed = false;
  }
  const outcome = { before: items, after: next, changePct: pct, currency };
  if (!guardrail.allowed) return { guardrail, outcome };
  if (account.platform === 'meta') {
    let done = 0;
    try {
      for (const item of next) {
        await setMetaDailyBudget({ apiKey: account.secret.apiKey, currency }, item.id, item.daily);
        done += 1;
      }
    } catch (error) {
      if (done) error.message = `${error.message} (${done} of ${next.length} budgets were already changed.)`;
      throw error;
    }
  } else {
    await editGoogleCampaign({ ...googleInput(account.secret), campaignId: row.targetExternalId, dailyBudget: next[0].daily });
  }
  return { guardrail, outcome };
}

export async function applyDecision({ organizationId, id, userId = null, auto = false, req }) {
  const row = await repo.decision(organizationId, id);
  if (!row) throw new ApiError(404, 'Recommendation not found.', 'not_found');
  if (!APPLICABLE.has(row.type)) throw new ApiError(422, 'This recommendation has no action to apply.', 'validation_error');
  const settings = normalizeSettings(await repo.settings(organizationId));
  if (!['approve', 'auto'].includes(settings.mode)) {
    throw new ApiError(422, 'Switch the agent to Approve or Auto mode to apply recommendations.', 'validation_error');
  }
  if (!(await repo.claimDecision(organizationId, id, userId))) {
    throw new ApiError(409, 'This recommendation was already handled.', 'conflict');
  }
  const meta = { decisionId: id, type: row.type, platform: row.platform, campaignId: row.targetExternalId, auto };
  try {
    const account = (await adConnections(organizationId)).find((item) => Number(item.id) === Number(row.connectionId));
    if (!account) throw new ApiError(422, 'This ad account is not connected any more.', 'validation_error');
    const context = await guardContext(organizationId, settings);
    const result = PAUSES.has(row.type)
      ? await pause(account, row, context)
      : await budget(account, row, parseJson(row.proposedChange), context, auto);
    if (!result.guardrail.allowed) {
      await repo.finishDecision(organizationId, id, 'blocked', { guardrail: result.guardrail, outcome: result.outcome });
      await recordAudit(req, { action: 'ads_agent.decision_blocked', resource: 'ai_decisions', resourceId: id, metadata: { ...meta, reasons: result.guardrail.reasons } });
      return { id, status: 'blocked', reasons: result.guardrail.reasons };
    }
    await repo.finishDecision(organizationId, id, 'applied', { guardrail: result.guardrail, outcome: result.outcome });
    await recordAudit(req, { action: 'ads_agent.decision_applied', resource: 'ai_decisions', resourceId: id, metadata: meta });
    return { id, status: 'applied', outcome: result.outcome };
  } catch (error) {
    await repo.finishDecision(organizationId, id, 'failed', { error: error.message });
    await recordAudit(req, { action: 'ads_agent.decision_failed', resource: 'ai_decisions', resourceId: id, metadata: { ...meta, error: error.message.slice(0, 200) } });
    throw error;
  }
}

export function approve(auth, req, id) {
  return applyDecision({ organizationId: auth.organizationId, id, userId: auth.userId, req });
}
