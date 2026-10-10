import * as repo from '../repositories/usageRepo.js';
import * as llmRepo from '../repositories/llmRepo.js';
import { apifyAccountUsage } from '../integrations/apify.js';
import { llmProviderName } from '../integrations/llm.js';
import { apifyToken } from './researchTools.js';

export const RANGES = [7, 30, 90];

const FEATURE = {
  structured: 'Other AI tasks',
  whatsapp_router: 'WhatsApp: understand message',
  whatsapp_reply: 'WhatsApp: reply',
  assistant_chat: 'Assistant chat',
  ad_targeting: 'Ad chat: cities and audience',
  meta_audience: 'Ad chat: Meta interests',
  google_ad_copy: 'Ad chat: Google ad copy',
  meta_ad_copy: 'Ad chat: Meta ad copy',
  google_ad_plan: 'Ad chat: Google plan (fallback)',
  meta_ad_plan: 'Ad chat: Meta plan (fallback)',
  ads_strategy: 'Ads Agent: strategy',
  launch_ad_copy: 'Ads Agent: launch copy',
  offering_capture: 'Products from chat',
  competitor_search_plan: 'Competitors: search plan',
  competitor_verdict: 'Competitors: fit check',
  competitor_website: 'Competitors: website report',
  competitor_ad_analysis: 'Competitors: ad analysis',
  competitor_strategy: 'Competitors: strategy',
  competitor_ad_ideas: 'Competitors: ads for you',
  google_search: 'Google search',
  meta_ad_library: 'Meta Ad Library',
  google_maps: 'Google Maps',
  google_ads_transparency: 'Google Ads Transparency'
};

const n = (value) => Number(value) || 0;

function sums(row) {
  return {
    calls: n(row?.calls),
    failed: n(row?.failed),
    inputTokens: n(row?.inputTokens),
    outputTokens: n(row?.outputTokens),
    items: n(row?.items),
    maxChargeUsd: Math.round(n(row?.maxChargeUsd) * 100) / 100
  };
}

// Every day in the window, so charts show quiet days as zero instead of skipping them.
export function fillDays(rows, days, now = new Date()) {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const out = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(now.getTime() - back * 86400000).toISOString().slice(0, 10);
    out.push({ day, ...sums(byDay.get(day)) });
  }
  return out;
}

function missingTable(error) {
  return (error?.cause?.code || error?.code) === 'ER_NO_SUCH_TABLE';
}

async function toolUsage(tool, days) {
  const [total, daily, models, features, organizations] = await Promise.all([
    repo.totals(tool, days),
    repo.daily(tool, days),
    repo.grouped(tool, 'model', days),
    repo.grouped(tool, 'feature', days),
    repo.byOrganization(tool, days)
  ]);
  return {
    totals: { ...sums(total), firstAt: total?.firstAt || null },
    daily: fillDays(daily, days),
    models: models.map((row) => ({ provider: row.provider, providerName: llmProviderName(row.provider) || row.provider, model: row.model || '—', ...sums(row) })),
    features: features.map((row) => ({ key: row.feature || 'other', label: FEATURE[row.feature] || row.feature || 'Other', ...sums(row) })),
    organizations: organizations.map((row) => ({ id: row.organizationId, name: row.name || (row.organizationId ? `Organization ${row.organizationId}` : 'Platform / no business'), ...sums(row) }))
  };
}

async function apifyAccount() {
  const token = await apifyToken().catch(() => null);
  if (!token) return { connected: false };
  try {
    return { connected: true, ...(await apifyAccountUsage(token)) };
  } catch (error) {
    return { connected: true, error: error.message };
  }
}

export async function platformUsage(query) {
  const days = RANGES.includes(Number(query.days)) ? Number(query.days) : 30;
  const [models, account, whatsapp] = await Promise.all([
    llmRepo.connections().catch(() => []),
    apifyAccount(),
    repo.whatsappDaily(days).catch(() => [])
  ]);
  const connected = models.map((row) => ({ purpose: row.purpose, provider: row.provider, providerName: llmProviderName(row.provider), model: row.modelName }));
  const waDays = new Map(whatsapp.map((row) => [row.day, row]));
  const whatsappDaily = fillDays([], days).map(({ day }) => ({ day, sent: n(waDays.get(day)?.sent), received: n(waDays.get(day)?.received) }));
  try {
    const [llm, apify] = await Promise.all([toolUsage('llm', days), toolUsage('apify', days)]);
    return { ready: true, days, ranges: RANGES, connected, llm, apify: { ...apify, account }, whatsapp: { daily: whatsappDaily } };
  } catch (error) {
    if (!missingTable(error)) throw error;
    return { ready: false, days, ranges: RANGES, connected, note: 'Run npm run migrate to start recording usage.', apify: { account }, whatsapp: { daily: whatsappDaily } };
  }
}
