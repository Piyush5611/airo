import * as repo from '../../repositories/adsAgentRepo.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { APPLICABLE, applyDecision } from './applyService.js';
import { checkAction, normalizeSettings } from './guardrails.js';
import { campaignFindings, experimentFindings, experimentGroups, mergeQuality, pacingFindings, qualityFindings, scaleFindings } from './monitorRules.js';

const REPEAT_HOURS = 72;
const BUDGET_TYPES = ['budget_increase', 'budget_decrease', 'scale_winner'];
const TITLES = {
  pause: 'Pause suggestion',
  no_results: 'No results recorded',
  low_quality: 'Low lead quality',
  scale_winner: 'Scale a winner',
  experiment_winner: 'A/B test result',
  budget_decrease: 'Lower budget',
  budget_increase: 'Raise budget',
  refresh_creative: 'Refresh ads',
  above_target: 'Above target cost',
  pacing_over: 'Overspending pace',
  pacing_under: 'Underspending pace'
};

function parseJson(value) {
  if (value == null || typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function todayIn(timeZone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function groupCampaigns(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.connectionId}|${row.externalId}`;
    const item = map.get(key) || { platform: row.platform, connectionId: row.connectionId, externalId: row.externalId, name: row.name, currency: row.currency, rows: [] };
    item.name = row.name || item.name;
    item.rows.push({
      date: row.date,
      spend: Number(row.spend || 0),
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      results: row.platform === 'meta' ? (row.leads == null ? null : Number(row.leads)) : (row.conversions == null ? null : Number(row.conversions))
    });
    map.set(key, item);
  }
  return [...map.values()];
}

// Current campaign budgets are not synced, so budget moves are checked by percent and caps only.
export function actionGuardrail(action, context) {
  if (action.type !== 'budget') return checkAction(action, context);
  const result = checkAction({ type: action.changePct > 0 ? 'resume' : 'pause' }, context);
  const limit = normalizeSettings(context.settings).maxBudgetChangePct;
  if (Math.abs(action.changePct) > limit + 1e-9) {
    result.reasons.push(`Budget change ${Math.abs(action.changePct)}% is above the ${limit}% limit.`);
    Object.assign(result, { allowed: false, applyNow: false, needsApproval: false, recommendOnly: false });
  }
  return result;
}

export async function monitorOrganization(organizationId) {
  const [settingsRow, profileRow, rows, months, doneToday] = await Promise.all([
    repo.settings(organizationId),
    repo.profile(organizationId).catch(() => null),
    repo.campaignDaily(organizationId, 12),
    repo.monthSpendByCurrency(organizationId),
    repo.actionsToday(organizationId)
  ]);
  const settings = normalizeSettings(settingsRow);
  if (settings.mode === 'off') return { created: 0, skipped: 'Agent is off.' };
  const profile = parseJson(profileRow?.profile) || null;
  const today = todayIn();
  const spend = await repo.spendNow(organizationId);
  const context = {
    settings,
    actionsToday: Number(doneToday?.total || 0),
    spendToday: Number(spend?.spendToday || 0),
    spendMonth: Number(spend?.spendMonth || 0)
  };
  const findings = [];
  const campaigns = groupCampaigns(rows);
  for (const campaign of campaigns) {
    for (const finding of campaignFindings(campaign, { settings, profile, today })) {
      findings.push({ ...finding, campaign });
    }
  }
  const currency = profile?.currency || months[0]?.currency;
  const monthSpend = Number(months.find((row) => row.currency === currency)?.spend || 0);
  for (const finding of pacingFindings({ monthSpend, profile, settings, today })) findings.push(finding);
  const [recentTotals, recentQuality] = await Promise.all([
    repo.campaignTotals(organizationId, 14),
    repo.leadQuality(organizationId, 14).catch(() => [])
  ]);
  const qualityRows = mergeQuality(recentTotals, recentQuality);
  for (const row of qualityRows) {
    for (const finding of qualityFindings(row)) {
      findings.push({ ...finding, campaign: { platform: 'meta', connectionId: row.connectionId, externalId: row.externalId, name: row.name || `Meta campaign ${row.externalId}` } });
    }
  }
  const flagged = new Set(findings.filter((item) => item.campaign).map((item) => `${item.campaign.connectionId}|${item.campaign.externalId}`));
  const quality = new Map(qualityRows.map((row) => [row.externalId, row]));
  for (const finding of scaleFindings(campaigns, { settings, profile, today, quality })) {
    if (!flagged.has(`${finding.campaign.connectionId}|${finding.campaign.externalId}`)) findings.push(finding);
  }
  const ads = await repo.adWindow(organizationId, 14).catch(() => []);
  for (const group of experimentGroups(ads, { today, minSpend: settings.minSpendForDecision })) {
    for (const finding of experimentFindings(group)) {
      findings.push({ ...finding, campaign: { platform: 'meta', connectionId: group.connectionId, externalId: finding.target.externalId, name: finding.target.name }, level: 'ad' });
    }
  }

  let created = 0;
  let applied = 0;
  const touched = new Set();
  for (const finding of findings) {
    const target = finding.campaign?.externalId || null;
    const types = BUDGET_TYPES.includes(finding.type) ? BUDGET_TYPES : finding.type;
    if (await repo.recentDecisionExists(organizationId, types, target, REPEAT_HOURS)) continue;
    const guardrail = finding.action ? actionGuardrail(finding.action, context) : null;
    const id = await repo.addDecision({
      organizationId,
      connectionId: finding.campaign?.connectionId || null,
      platform: finding.campaign?.platform || null,
      type: finding.type,
      targetLevel: finding.level || (finding.campaign ? 'campaign' : 'account'),
      targetExternalId: target,
      targetName: finding.campaign?.name || TITLES[finding.type],
      reason: finding.reason.slice(0, 600),
      evidence: finding.evidence,
      proposedChange: finding.action,
      guardrail,
      mode: settings.mode,
      status: guardrail && !guardrail.allowed ? 'blocked' : 'proposed'
    });
    created += 1;
    const key = `${finding.campaign?.connectionId}|${target}`;
    if (guardrail?.applyNow && APPLICABLE.has(finding.type) && !touched.has(key)) {
      touched.add(key);
      const req = { auth: { organizationId }, ip: null };
      const result = await applyDecision({ organizationId, id, auto: true, req }).catch(() => null);
      if (result?.status === 'applied') {
        applied += 1;
        context.actionsToday += 1;
      }
    }
  }
  return { created, applied, checked: findings.length };
}

export async function monitorAll() {
  const orgs = await repo.organizationsWithMetrics();
  let created = 0;
  let applied = 0;
  const notes = [];
  for (const { organizationId } of orgs) {
    try {
      const result = await monitorOrganization(organizationId);
      created += result.created;
      applied += result.applied || 0;
    } catch (error) {
      notes.push(`org ${organizationId}: ${error.message}`);
    }
  }
  return { organizations: orgs.length, created, applied, notes };
}

export async function monitorNow(auth, req) {
  if (!(await repo.claimJob(`ads.monitor.org.${auth.organizationId}`, 2))) {
    throw new ApiError(429, 'A check ran in the last 2 minutes. Try again shortly.', 'rate_limited');
  }
  const result = await monitorOrganization(auth.organizationId);
  await recordAudit(req, { action: 'ads_agent.monitor', resource: 'ai_decisions', metadata: result });
  return result;
}

export async function dismiss(auth, req, id) {
  const result = await repo.dismissDecision(auth.organizationId, id, auth.userId);
  if (!result.affectedRows) throw new ApiError(404, 'Open recommendation not found.', 'not_found');
  await recordAudit(req, { action: 'ads_agent.decision_dismissed', resource: 'ai_decisions', resourceId: id });
  return { id, status: 'rejected' };
}

const ADVICE_ASK = /\b(recommend\w*|suggest\w*|sujhav|salah|alerts?|advice|kya\s+karu|kya\s+karna|optimi[sz]\w*)\b/i;
const ADS_WORD = /\b(ads?|campaigns?|meta|google|facebook)\b/i;

export function wantsAdsAdvice(text) {
  const value = String(text || '');
  return ADVICE_ASK.test(value) && ADS_WORD.test(value);
}

export async function adsAdviceReply(organizationId, messages, { force = false } = {}) {
  const last = [...(messages || [])].reverse().find((row) => row.role === 'user');
  if (!force && !wantsAdsAdvice(last?.content)) return null;
  let rows;
  try {
    rows = await repo.openDecisions(organizationId, 5);
  } catch {
    return null;
  }
  if (!rows.length) {
    return 'AI Ads Agent ke paas abhi koi open recommendation nahi hai. Synced ad data har 3 ghante mein check hota hai. AIRO mein Growth → AI Ads Agent pe details dekh sakte ho.';
  }
  const lines = rows.map((row, index) => {
    const where = row.platform ? `${row.platform === 'meta' ? 'Meta' : 'Google'} · ` : '';
    const blocked = row.status === 'blocked' ? ' (guardrail ne roka)' : '';
    return `${index + 1}. *${TITLES[row.type] || row.type}* — ${where}${row.targetName || ''}${blocked}\n${row.reason}`;
  });
  return `*AI Ads Agent recommendations*\n\n${lines.join('\n\n')}\n\nYe sirf suggestions hain, ad account mein kuch change nahi hua. Details aur dismiss AIRO mein Growth → AI Ads Agent pe.`;
}
