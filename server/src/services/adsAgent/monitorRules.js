// Pure rules over synced daily campaign rows. Each finding carries its evidence so the owner can check the numbers.

const RECENT_DAYS = 3;
const BASE_DAYS = 7;

function sum(rows, key) {
  let total = 0;
  let seen = false;
  for (const row of rows) {
    if (row[key] == null) continue;
    total += Number(row[key]);
    seen = true;
  }
  return seen ? total : null;
}

function round(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function windowStats(rows) {
  const spend = sum(rows, 'spend') || 0;
  const clicks = sum(rows, 'clicks') || 0;
  const impressions = sum(rows, 'impressions') || 0;
  const results = sum(rows, 'results');
  return {
    days: rows.length,
    spend: round(spend),
    clicks,
    impressions,
    results,
    ctr: impressions > 0 ? round((clicks / impressions) * 100) : null,
    costPerResult: results > 0 ? round(spend / results) : null
  };
}

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function splitWindows(rows, today) {
  const recentStart = addDays(today, -RECENT_DAYS);
  const baseStart = addDays(today, -(RECENT_DAYS + BASE_DAYS));
  const recent = rows.filter((row) => row.date >= recentStart && row.date < today);
  const base = rows.filter((row) => row.date >= baseStart && row.date < recentStart);
  return { recent: windowStats(recent), base: windowStats(base) };
}

function resultName(platform) {
  return platform === 'meta' ? 'leads' : 'conversions';
}

export function campaignFindings(campaign, { settings, profile, today }) {
  const { recent, base } = splitWindows(campaign.rows, today);
  const findings = [];
  const minSpend = Number(settings.minSpendForDecision) || 0;
  const label = resultName(campaign.platform);
  const target = Number(profile?.targetCpl) > 0 && profile?.currency === campaign.currency ? Number(profile.targetCpl) : null;
  const evidence = { currency: campaign.currency, recent, previous: base, resultType: label };
  const tracked = recent.results != null && (base.results || 0) > 0;

  if (recent.results === 0 && !tracked && base.results != null && recent.spend + base.spend >= minSpend * 2) {
    findings.push({
      type: 'no_results',
      action: null,
      reason: `${round(recent.spend + base.spend)} ${campaign.currency} spent in ${recent.days + base.days} days with no ${label} recorded. If this campaign should bring ${label}, check the form and tracking; otherwise ignore this.`,
      evidence
    });
    return findings;
  }

  if (recent.spend >= minSpend && tracked && recent.results === 0) {
    findings.push({
      type: 'pause',
      action: { type: 'pause' },
      reason: `${recent.spend} ${campaign.currency} spent in the last ${RECENT_DAYS} days with 0 ${label}. Pause it or check the form, landing page and tracking.`,
      evidence
    });
    return findings;
  }

  if (recent.spend >= minSpend && recent.costPerResult != null && base.costPerResult != null && (base.results || 0) >= 3) {
    const change = (recent.costPerResult - base.costPerResult) / base.costPerResult;
    if (change >= 0.5) {
      findings.push({
        type: 'budget_decrease',
        action: { type: 'budget', changePct: -20 },
        reason: `Cost per ${label.slice(0, -1)} rose ${Math.round(change * 100)}% (${base.costPerResult} → ${recent.costPerResult} ${campaign.currency}). Lower the budget by 20% or refresh the ads.`,
        evidence: { ...evidence, changePct: Math.round(change * 100) }
      });
    }
  }

  if (recent.impressions >= 1000 && base.impressions >= 1000 && recent.ctr != null && base.ctr > 0) {
    const drop = (base.ctr - recent.ctr) / base.ctr;
    if (drop >= 0.4) {
      findings.push({
        type: 'refresh_creative',
        action: null,
        reason: `Click rate fell ${Math.round(drop * 100)}% (${base.ctr}% → ${recent.ctr}%). People may be tired of these ads. Try a new image or headline.`,
        evidence: { ...evidence, dropPct: Math.round(drop * 100) }
      });
    }
  }

  if (target) {
    const week = windowStats(campaign.rows.filter((row) => row.date >= addDays(today, -7) && row.date < today));
    if (week.spend >= minSpend && week.costPerResult != null && week.costPerResult > target * 1.3) {
      findings.push({
        type: 'above_target',
        action: null,
        reason: `Cost per ${label.slice(0, -1)} over 7 days is ${week.costPerResult} ${campaign.currency}, above your target of ${target}. Review audience and ads before adding budget.`,
        evidence: { ...evidence, week, target }
      });
    } else if (week.costPerResult != null && week.costPerResult <= target * 0.7 && (week.results || 0) >= 5) {
      const pct = Math.min(20, Number(settings.maxBudgetChangePct) || 20);
      findings.push({
        type: 'budget_increase',
        action: { type: 'budget', changePct: pct },
        reason: `Cost per ${label.slice(0, -1)} over 7 days is ${week.costPerResult} ${campaign.currency}, well under your target of ${target}, with ${week.results} ${label}. Raise the budget by ${pct}%.`,
        evidence: { ...evidence, week, target }
      });
    }
  }
  return findings;
}

const num = (value) => (value == null ? 0 : Number(value));
const per = (top, bottom) => (bottom > 0 ? round(top / bottom) : null);

// Joins synced spend with CRM outcomes of leads that Meta lead forms created. Revenue is in INR, so ROAS is INR only.
export function mergeQuality(campaigns, quality) {
  const byId = new Map(quality.map((row) => [String(row.externalId), row]));
  const rows = [];
  for (const campaign of campaigns) {
    if (campaign.platform !== 'meta') continue;
    const q = byId.get(String(campaign.externalId));
    byId.delete(String(campaign.externalId));
    rows.push(qualityRow(campaign, q));
  }
  for (const q of byId.values()) {
    rows.push(qualityRow({ platform: 'meta', externalId: q.externalId, name: null, currency: '', spend: 0, leads: null }, q));
  }
  return rows;
}

function qualityRow(campaign, q) {
  const spend = num(campaign.spend);
  const crmLeads = num(q?.crmLeads);
  const qualified = num(q?.qualified);
  const booked = num(q?.booked);
  const revenue = q?.revenue == null ? null : num(q.revenue);
  return {
    platform: campaign.platform,
    connectionId: campaign.connectionId || null,
    externalId: String(campaign.externalId),
    name: campaign.name,
    currency: campaign.currency,
    spend: round(spend),
    platformLeads: campaign.leads == null ? null : num(campaign.leads),
    crmLeads,
    qualified,
    booked,
    rejected: num(q?.rejected),
    bookedWithoutValue: num(q?.bookedWithoutValue),
    revenue,
    qualifiedRate: crmLeads ? round((qualified / crmLeads) * 100, 1) : null,
    costPerLead: per(spend, crmLeads),
    costPerQualifiedLead: per(spend, qualified),
    costPerBooking: per(spend, booked),
    roas: campaign.currency === 'INR' && revenue && spend > 0 ? round(revenue / spend) : null
  };
}

export function qualityFindings(row) {
  if (row.crmLeads < 10 || row.qualifiedRate == null) return [];
  if (row.qualifiedRate <= 10 && row.rejected >= row.crmLeads / 2) {
    return [{
      type: 'low_quality',
      action: null,
      reason: `${row.crmLeads} leads in 14 days, only ${row.qualified} qualified and ${row.rejected} marked unqualified or lost. Tighten the audience or add a qualifying question to the form before adding budget.`,
      evidence: { crmLeads: row.crmLeads, qualified: row.qualified, rejected: row.rejected, qualifiedRate: row.qualifiedRate, costPerLead: row.costPerLead, currency: row.currency }
    }];
  }
  return [];
}

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

export function zScore(s1, n1, s2, n2) {
  if (!(n1 > 0) || !(n2 > 0)) return 0;
  const pooled = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  return se > 0 ? (s1 / n1 - s2 / n2) / se : 0;
}

const MIN_IMPRESSIONS = 1000;
const MIN_LIFT = 0.2;
const MIN_Z = 1.96;

// Compares ads that run side by side in one ad set. Leads per impression when there are enough leads, else click rate.
export function experimentGroups(ads, { today, minSpend }) {
  const activeSince = addDays(today, -2);
  const groups = new Map();
  for (const ad of ads) {
    if (!ad.adsetId || !(ad.lastSpendDate >= activeSince)) continue;
    const key = `${ad.connectionId}|${ad.adsetId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ad);
  }
  const result = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const totalLeads = list.reduce((sum, ad) => sum + num(ad.leads), 0);
    const metric = totalLeads >= 10 && list.every((ad) => ad.leads != null) ? 'leads' : 'clicks';
    const rows = list.map((ad) => {
      const impressions = num(ad.impressions);
      const successes = num(ad[metric]);
      const eligible = impressions >= MIN_IMPRESSIONS && num(ad.spend) >= minSpend / 2 && num(ad.days) >= 3;
      return {
        id: String(ad.externalId),
        name: ad.name,
        spend: round(num(ad.spend)),
        impressions,
        clicks: num(ad.clicks),
        leads: ad.leads == null ? null : num(ad.leads),
        successes,
        rate: impressions ? successes / impressions : 0,
        costPerResult: successes ? round(num(ad.spend) / successes) : null,
        eligible,
        role: eligible ? 'tie' : 'learning'
      };
    });
    const ready = rows.filter((row) => row.eligible).sort((a, b) => b.rate - a.rate);
    let verdict = ready.length >= 2 ? 'no_winner_yet' : 'learning';
    if (ready.length >= 2) {
      const best = ready[0];
      for (const other of ready.slice(1)) {
        const z = zScore(best.successes, best.impressions, other.successes, other.impressions);
        const lift = other.rate > 0 ? (best.rate - other.rate) / other.rate : best.rate > 0 ? Infinity : 0;
        other.confidence = Math.min(99.9, round(normalCdf(z) * 100, 1));
        other.liftPct = Number.isFinite(lift) ? Math.round(lift * 100) : null;
        if (z >= MIN_Z && lift >= MIN_LIFT) {
          other.role = 'loser';
          best.role = 'winner';
          verdict = 'winner';
        }
      }
    }
    const first = list[0];
    result.push({
      key,
      connectionId: first.connectionId,
      campaignId: first.campaignId,
      adsetId: first.adsetId,
      currency: first.currency,
      metric,
      verdict,
      ads: rows.map(({ successes, rate, eligible, ...row }) => ({ ...row, ratePct: round(rate * 100, metric === 'leads' ? 3 : 2) }))
    });
  }
  return result;
}

export function experimentFindings(group) {
  if (group.verdict !== 'winner') return [];
  const winner = group.ads.find((ad) => ad.role === 'winner');
  const label = group.metric === 'leads' ? 'leads per impression' : 'click rate';
  return group.ads.filter((ad) => ad.role === 'loser').map((ad) => ({
    type: 'experiment_winner',
    action: { type: 'pause' },
    target: { level: 'ad', externalId: ad.id, name: ad.name },
    reason: `"${winner.name}" beats "${ad.name}" on ${label} by ${ad.liftPct == null ? 'a wide margin' : `${ad.liftPct}%`} (${ad.confidence}% confidence, 14 days). Pause the weaker ad so the budget goes to the winner.`,
    evidence: { metric: group.metric, adsetId: group.adsetId, campaignId: group.campaignId, currency: group.currency, winner, loser: ad }
  }));
}

// Scale campaigns that are much cheaper per result than the account average. Only when no target cost is set.
export function scaleFindings(campaigns, { settings, profile, today, quality = new Map() }) {
  if (Number(profile?.targetCpl) > 0) return [];
  const minSpend = Number(settings.minSpendForDecision) || 0;
  const stats = campaigns.map((campaign) => ({
    campaign,
    week: windowStats(campaign.rows.filter((row) => row.date >= addDays(today, -7) && row.date < today)),
    recent: splitWindows(campaign.rows, today).recent
  }));
  const pools = new Map();
  for (const item of stats) {
    if (!(item.week.results > 0)) continue;
    const key = `${item.campaign.platform}|${item.campaign.currency}`;
    const pool = pools.get(key) || { spend: 0, results: 0, count: 0 };
    pool.spend += item.week.spend;
    pool.results += item.week.results;
    pool.count += 1;
    pools.set(key, pool);
  }
  const findings = [];
  const pct = Math.min(20, Number(settings.maxBudgetChangePct) || 20);
  for (const { campaign, week, recent } of stats) {
    const pool = pools.get(`${campaign.platform}|${campaign.currency}`);
    if (!pool || pool.count < 2) continue;
    const average = pool.spend / pool.results;
    if ((week.results || 0) < 10 || week.spend < minSpend || week.costPerResult == null || week.costPerResult > average * 0.6) continue;
    if (recent.costPerResult == null || recent.costPerResult > week.costPerResult * 1.2) continue;
    const q = quality.get(String(campaign.externalId));
    if (q && q.crmLeads >= 10 && q.qualifiedRate < 15) continue;
    const label = resultName(campaign.platform);
    findings.push({
      type: 'scale_winner',
      action: { type: 'budget', changePct: pct },
      reason: `Cost per ${label.slice(0, -1)} over 7 days is ${week.costPerResult} ${campaign.currency}, well under the account average of ${round(average)}, with ${week.results} ${label} and a steady last 3 days. Raise the budget by ${pct}%.`,
      evidence: { currency: campaign.currency, week, recent, accountAverage: round(average), qualifiedRate: q?.qualifiedRate ?? null },
      campaign
    });
  }
  return findings;
}

export function scaleBudgets(items, changePct) {
  // Round toward the current amount so the change never passes the percent limit.
  const toward = changePct > 0 ? Math.floor : Math.ceil;
  return items.map((item) => ({ id: item.id, daily: round(toward(Number((item.daily * (1 + changePct / 100) * 100).toFixed(6))) / 100) }));
}

export function budgetTotal(items) {
  return round(items.reduce((total, item) => total + Number(item.daily || 0), 0));
}

export function pacingFindings({ monthSpend, profile, settings, today }) {
  const findings = [];
  const date = new Date(`${today}T00:00:00Z`);
  const dayOfMonth = date.getUTCDate();
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = Math.max(1, dayOfMonth - 1);
  if (dayOfMonth < 4 || !(monthSpend > 0)) return findings;
  const projected = round((monthSpend / elapsed) * daysInMonth, 0);
  const budget = Number(settings.monthlySpendCap) || Number(profile?.monthlyBudget) || 0;
  if (!budget) return findings;
  const source = Number(settings.monthlySpendCap) ? 'monthly spend cap' : 'monthly budget';
  const evidence = { monthSpend: round(monthSpend), projected, budget, dayOfMonth, daysInMonth };
  if (projected > budget * 1.1) {
    findings.push({
      type: 'pacing_over',
      action: null,
      reason: `At this pace the month ends near ${projected}, above the ${source} of ${budget}. Lower daily budgets or pause weak campaigns.`,
      evidence
    });
  } else if (dayOfMonth >= 10 && projected < budget * 0.7) {
    findings.push({
      type: 'pacing_under',
      action: null,
      reason: `At this pace the month ends near ${projected}, well under the ${source} of ${budget}. There is room to raise budgets on campaigns that are working.`,
      evidence
    });
  }
  return findings;
}
