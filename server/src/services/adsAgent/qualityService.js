import * as repo from '../../repositories/adsAgentRepo.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { importOrganization } from './leadImport.js';
import { normalizeSettings } from './guardrails.js';
import { experimentGroups, mergeQuality } from './monitorRules.js';
import { campaignMetric, rankAds } from './adRanking.js';
import { card, header, hint, money as cash, numbered, section } from './waFormat.js';

export async function quality(auth, query) {
  const days = [7, 14, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30;
  const [campaigns, rows, job] = await Promise.all([
    repo.campaignTotals(auth.organizationId, days),
    repo.leadQuality(auth.organizationId, days),
    repo.jobState('ads.lead_import')
  ]);
  const items = mergeQuality(campaigns, rows).filter((row) => row.spend > 0 || row.crmLeads > 0);
  const sum = (key) => items.reduce((total, row) => total + Number(row[key] || 0), 0);
  return {
    days,
    lastImport: job ? { status: job.status, finishedAt: job.finishedAt } : null,
    totals: {
      crmLeads: sum('crmLeads'),
      qualified: sum('qualified'),
      booked: sum('booked'),
      revenue: items.some((row) => row.revenue != null) ? sum('revenue') : null,
      bookedWithoutValue: sum('bookedWithoutValue')
    },
    items
  };
}

export async function experiments(auth) {
  const [settingsRow, ads, campaigns] = await Promise.all([
    repo.settings(auth.organizationId),
    repo.adWindow(auth.organizationId, 14),
    repo.campaignTotals(auth.organizationId, 14)
  ]);
  const names = new Map(campaigns.map((row) => [String(row.externalId), row.name]));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const groups = experimentGroups(ads, { today, minSpend: normalizeSettings(settingsRow).minSpendForDecision });
  return {
    adsSynced: ads.length,
    items: groups
      .map((group) => ({ ...group, campaignName: names.get(String(group.campaignId)) || null }))
      .sort((a, b) => ['winner', 'no_winner_yet', 'learning'].indexOf(a.verdict) - ['winner', 'no_winner_yet', 'learning'].indexOf(b.verdict))
  };
}

export async function analysis(auth, query = {}) {
  const { organizationId } = auth;
  const days = [7, 14, 30].includes(Number(query.days)) ? Number(query.days) : 14;
  const [settingsRow, ads, campaigns, objects, synced] = await Promise.all([
    repo.settings(organizationId),
    repo.adWindow(organizationId, days),
    repo.campaignTotals(organizationId, days),
    repo.adObjects(organizationId).catch(() => []),
    repo.lastSynced(organizationId)
  ]);
  const info = new Map(objects.map((row) => [`${row.type}:${row.externalId}`, row]));
  const names = new Map(campaigns.map((row) => [String(row.externalId), row.name]));
  const rows = [];
  const metaAds = ads.filter((row) => Number(row.impressions) > 0 || Number(row.spend) > 0);
  const metaMetric = campaignMetric(metaAds.map((row) => ({ ...row, results: row.leads })), (row) => String(row.campaignId));
  for (const row of metaAds) {
    const object = info.get(`ad:${row.externalId}`);
    rows.push({
      key: `meta-ad-${row.connectionId}-${row.externalId}`,
      connectionId: row.connectionId,
      platform: 'meta',
      level: 'ad',
      externalId: String(row.externalId),
      name: row.name,
      campaignName: names.get(String(row.campaignId)) || null,
      currency: row.currency,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      results: row.leads,
      resultLabel: 'leads',
      metric: metaMetric({ campaignId: row.campaignId }),
      status: object?.status || null,
      madeByAiro: object?.origin === 'api' || info.get(`campaign:${row.campaignId}`)?.origin === 'api'
    });
  }
  const fallback = campaigns.filter((row) => (row.platform === 'google' || (row.platform === 'meta' && !metaAds.length)) && (Number(row.impressions) > 0 || Number(row.spend) > 0));
  const googleHasResults = fallback.some((row) => row.platform === 'google' && Number(row.conversions) > 0);
  const metaCampaignMetric = campaignMetric(fallback.filter((row) => row.platform === 'meta').map((row) => ({ ...row, results: row.leads })), (row) => String(row.externalId));
  for (const row of fallback) {
    const google = row.platform === 'google';
    const object = info.get(`campaign:${row.externalId}`);
    rows.push({
      key: `${row.platform}-campaign-${row.connectionId}-${row.externalId}`,
      connectionId: row.connectionId,
      platform: row.platform,
      level: 'campaign',
      externalId: String(row.externalId),
      name: row.name,
      campaignName: null,
      currency: row.currency,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      results: google ? row.conversions : row.leads,
      resultLabel: google ? 'conversions' : 'leads',
      metric: google ? (googleHasResults ? 'results' : 'clicks') : metaCampaignMetric({ externalId: row.externalId }),
      status: object?.status || null,
      madeByAiro: object?.origin === 'api'
    });
  }
  const ranked = rankAds(rows, { minSpend: normalizeSettings(settingsRow).minSpendForDecision });
  const count = (verdict) => ranked.items.filter((row) => row.verdict === verdict).length;
  return {
    days,
    lastSyncedAt: synced?.syncedAt || null,
    counts: { total: ranked.items.length, strong: count('strong'), average: count('average'), weak: count('weak'), learning: count('learning') + count('alone') },
    benchmarks: ranked.benchmarks,
    items: ranked.items,
    notes: [
      fallback.some((row) => row.platform === 'meta') ? 'Meta ad-level data is not synced yet, so Meta is judged per campaign.' : '',
      fallback.some((row) => row.platform === 'google') ? 'Google is judged per campaign. Ad-level Google data is not synced yet.' : ''
    ].filter(Boolean)
  };
}

const ANALYSIS_ASK = /\b(analy[sz]\w*|kaun\s*sa|kaunsa|konsa|kon\s*sa|best|worst|sabse|rank\w*|score|kitna\s+ac+h+a|acc?h+a\s+chal|perform\w*\s+(kaisa|kaise|kitna))\b/i;
const ADS_WORDS = /\b(ads?|campaigns?|creatives?)\b/i;

export function wantsAdsAnalysis(text) {
  const value = String(text || '');
  return ANALYSIS_ASK.test(value) && ADS_WORDS.test(value) && !/\b(run|launch|chalao|banao|start)\b/i.test(value);
}

export function analysisDays(text) {
  const value = String(text || '').toLowerCase();
  if (/\b(30|month|mahina|mahine)\b/.test(value)) return 30;
  if (/\b(7|week|hafta|hafte)\b/.test(value)) return 7;
  return 14;
}

function adLine(row, english) {
  const say = (en, hi) => (english ? en : hi);
  const money = (value, currency) => cash(Number(value) >= 10 ? Math.round(Number(value)) : Number(Number(value).toFixed(2)), currency);
  const what = row.costPerResult
    ? `${money(row.costPerResult, row.currency)}/${row.resultLabel === 'leads' ? 'lead' : 'conversion'}`
    : row.results ? `${row.results} ${row.resultLabel}` : row.cpc ? `${money(row.cpc, row.currency)}/click` : say('no clicks', 'koi click nahi');
  const place = `${row.platform === 'google' ? 'Google' : 'Meta'}${row.level === 'campaign' ? ' campaign' : ''}`;
  return `*${row.name}* (${place}${row.madeByAiro ? ', AIRO' : ''}) · score ${row.score} · ${what} · CTR ${row.ctr ?? 0}% · ${say('spend', 'kharch')} ${money(row.spend, row.currency)}`;
}

export function analysisText(data, english) {
  const say = (en, hi) => (english ? en : hi);
  if (!data.items.length) {
    return say('No ad data for this period yet. Connect Meta Ads or Google Ads, then press Sync now in AIRO → AI Ads Agent.', 'Is period ka ad data abhi nahi hai. Meta Ads ya Google Ads connect karo, phir AIRO → AI Ads Agent mein Sync now dabao.');
  }
  const scored = data.items.filter((row) => row.score != null);
  const top = scored.filter((row) => row.verdict === 'strong').slice(0, 3);
  const weak = scored.filter((row) => row.verdict === 'weak').slice(-3).reverse();
  const c = data.counts;
  return card([
    header(say('Ad analysis', 'Ad analysis'), say(`Last ${data.days} days · ${c.total} ads`, `Pichhle ${data.days} din · ${c.total} ads`)),
    say(`Strong ${c.strong} · Average ${c.average} · Weak ${c.weak} · Need more data ${c.learning}`, `Strong ${c.strong} · Average ${c.average} · Weak ${c.weak} · Data kam ${c.learning}`),
    top.length ? section(say('Doing best', 'Sabse achhe chal rahe'), numbered(top.map((row) => adLine(row, english)))) : '',
    weak.length ? section(say('Weakest', 'Sabse kamzor'), numbered(weak.map((row) => adLine(row, english)))) : '',
    !scored.length ? hint(say('No ad has enough data to judge yet (needs about 1,000 impressions each).', 'Abhi kisi ad ka itna data nahi ki judge kar sakein (har ad ko lagbhag 1,000 impressions chahiye).')) : '',
    hint(say('Score 50 = typical for your account. Judged on cost per lead/conversion and click rate against your other ads of the same kind.', 'Score 50 = aapke account ka normal. Same tarah ke dusre ads ke muqable cost per lead/conversion aur click rate pe judge kiya.')),
    ...data.notes.map((note) => hint(note)),
    hint(say('Full list: AIRO → AI Ads Agent → Ad analysis.', 'Poori list: AIRO → AI Ads Agent → Ad analysis.'))
  ]);
}

export async function analysisReply({ organizationId, text }) {
  if (!organizationId) return '';
  const data = await analysis({ organizationId }, { days: analysisDays(text) });
  const english = !/\b(kya|hai|kaun|konsa|kaunsa|sabse|kitna|achha|acha|chal|raha|rha|batao|bta)\b/i.test(String(text || ''));
  return analysisText(data, english);
}

export async function importNow(auth, req) {
  if (!(await repo.claimJob(`ads.lead_import.org.${auth.organizationId}`, 5))) {
    throw new ApiError(429, 'Leads were imported in the last 5 minutes. Try again shortly.', 'rate_limited');
  }
  const result = await importOrganization(auth.organizationId);
  await recordAudit(req, {
    action: 'ads_agent.leads_imported',
    resource: 'ad_lead_imports',
    metadata: { connections: result.connections, created: result.created, matched: result.matched, skipped: result.skipped, failed: result.failed }
  });
  return result;
}
