import * as repo from '../../repositories/adsAgentRepo.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { checkAction, normalizeSettings } from './guardrails.js';
import { syncOrganization } from './metricsSync.js';

const RANGES = [7, 14, 30];

function schemaMissing(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR';
}

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function ratio(top, bottom, scale = 1) {
  const a = Number(top);
  const b = Number(bottom);
  if (!Number.isFinite(a) || !(b > 0)) return null;
  return Math.round((a / b) * scale * 100) / 100;
}

function withRatios(row) {
  const results = row.platform === 'meta' ? row.leads : row.conversions;
  return {
    ...row,
    results: results == null ? null : Number(results),
    resultLabel: row.platform === 'meta' ? 'leads' : 'conversions',
    ctr: ratio(row.clicks, row.impressions, 100),
    cpc: ratio(row.spend, row.clicks),
    costPerResult: ratio(row.spend, results)
  };
}

function totalsOf(daily) {
  const groups = new Map();
  for (const row of daily) {
    const key = `${row.platform}|${row.currency}`;
    const sum = groups.get(key) || { platform: row.platform, currency: row.currency, spend: 0, impressions: 0, clicks: 0, leads: null, conversions: null };
    sum.spend += Number(row.spend || 0);
    sum.impressions += Number(row.impressions || 0);
    sum.clicks += Number(row.clicks || 0);
    if (row.leads != null) sum.leads = (sum.leads || 0) + Number(row.leads);
    if (row.conversions != null) sum.conversions = (sum.conversions || 0) + Number(row.conversions);
    groups.set(key, sum);
  }
  return [...groups.values()].map((row) => withRatios({ ...row, spend: Math.round(row.spend * 100) / 100 }));
}

export async function overview(auth, daysValue) {
  const days = RANGES.includes(Number(daysValue)) ? Number(daysValue) : 7;
  try {
    const [settings, daily, campaigns, synced, job, decisions] = await Promise.all([
      repo.settings(auth.organizationId),
      repo.dailyTotals(auth.organizationId, days),
      repo.campaignTotals(auth.organizationId, days),
      repo.lastSynced(auth.organizationId),
      repo.jobState('ads.metrics_sync'),
      repo.decisions(auth.organizationId, 20)
    ]);
    return {
      ready: true,
      days,
      settings: normalizeSettings(settings),
      lastSyncedAt: synced?.syncedAt || null,
      job: job ? { status: job.status, finishedAt: job.finishedAt } : null,
      totals: totalsOf(daily),
      daily,
      campaigns: campaigns.map(withRatios),
      decisions: decisions.map((row) => ({
        ...row,
        evidence: parseJson(row.evidence),
        proposedChange: parseJson(row.proposedChange),
        guardrail: parseJson(row.guardrail),
        outcome: parseJson(row.outcome)
      }))
    };
  } catch (error) {
    if (schemaMissing(error)) return { ready: false, note: 'Run npm run migrate to set up the ads agent.' };
    throw error;
  }
}

export async function saveSettings(auth, req) {
  const body = req.body;
  const next = normalizeSettings({
    mode: body.mode,
    dailySpendCap: body.dailySpendCap,
    monthlySpendCap: body.monthlySpendCap,
    maxBudgetChangePct: body.maxBudgetChangePct,
    maxActionsPerDay: body.maxActionsPerDay,
    minSpendForDecision: body.minSpendForDecision,
    killSwitch: body.killSwitch ? 1 : 0
  });
  if (next.mode === 'auto' && auth.role !== 'owner') {
    throw new ApiError(403, 'Only the Owner can turn on auto mode.', 'forbidden');
  }
  const before = normalizeSettings(await repo.settings(auth.organizationId));
  await repo.saveSettings(auth.organizationId, auth.userId, next);
  await recordAudit(req, { action: 'ads_agent.settings', resource: 'ads_agent_settings', resourceId: auth.organizationId, metadata: { before, after: next } });
  return next;
}

export async function syncNow(auth, req) {
  const key = `ads.sync.org.${auth.organizationId}`;
  if (!(await repo.claimJob(key, 5))) {
    throw new ApiError(429, 'A sync ran in the last few minutes. Try again shortly.', 'rate_limited');
  }
  const result = await syncOrganization(auth.organizationId, req.body?.range);
  await recordAudit(req, { action: 'ads_agent.sync', resource: 'ad_metrics_daily', metadata: { rows: result.rows, connections: result.connections } });
  return result;
}

export async function recordDecision({ organizationId, decision, action = null, decidedBy = null, context = {} }) {
  const settings = normalizeSettings(await repo.settings(organizationId));
  const guardrail = action
    ? checkAction(action, { settings, actionsToday: Number((await repo.actionsToday(organizationId))?.total || 0), ...context })
    : null;
  const status = guardrail && !guardrail.allowed ? 'blocked' : 'proposed';
  const id = await repo.addDecision({
    ...decision,
    organizationId,
    mode: settings.mode,
    status,
    guardrail,
    proposedChange: action,
    decidedBy
  });
  return { id, status, guardrail };
}
