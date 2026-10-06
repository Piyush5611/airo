import { campaignMetric, rankAds } from './adRanking.js';

const ACTION_CTA = new Set([
  'SIGN_UP', 'GET_QUOTE', 'APPLY_NOW', 'CONTACT_US', 'BOOK_NOW', 'BOOK_TRAVEL', 'CALL_NOW', 'SEND_MESSAGE',
  'MESSAGE_PAGE', 'WHATSAPP_MESSAGE', 'GET_OFFER', 'SUBSCRIBE', 'DOWNLOAD', 'SHOP_NOW', 'ORDER_NOW', 'REQUEST_TIME', 'GET_DIRECTIONS'
]);
const CHAT_CTA = /MESSAGE|WHATSAPP|CALL/;
const HOOK = /\d|₹|\brs\.?\s|offer|\boff\b|discount|free|limited|only|new launch|ready to move/i;

const yes = (value) => value === true || value === 'true';

// ad: { headline, text, cta, visual: 'image'|'video'|'', link, leadForm }
export function creativeScore(ad) {
  const headline = String(ad.headline || '').trim();
  const text = String(ad.text || '').trim();
  const cta = String(ad.cta || '').toUpperCase();
  if (!headline && !text && !ad.visual) {
    return { score: null, reasons: ['Meta did not return the creative for this ad yet. Press Sync.'] };
  }
  const reasons = [];
  let score = 0;
  if (ad.visual) score += 20;
  else reasons.push('No image or video.');

  if (headline) {
    score += 10;
    if (headline.length >= 15 && headline.length <= 40) score += 10;
    else {
      score += 4;
      reasons.push(headline.length < 15 ? 'Headline is very short.' : 'Headline is long; Meta may cut it off.');
    }
  } else reasons.push('No headline.');

  if (text) {
    score += 10;
    if (text.length >= 60 && text.length <= 300) score += 8;
    else {
      score += 3;
      reasons.push(text.length < 60 ? 'Main text is short; add a benefit or detail.' : 'Main text is long; only the first lines show.');
    }
    if (HOOK.test(`${headline} ${text}`)) score += 7;
    else reasons.push('No price, number or offer in the text.');
  } else reasons.push('No main text.');

  if (cta && cta !== 'NO_BUTTON') {
    score += 10;
    if (ACTION_CTA.has(cta)) score += 5;
    else reasons.push('The button could ask for a clearer action than "Learn more".');
  } else reasons.push('No call-to-action button.');

  if (yes(ad.leadForm) || /^https:\/\//i.test(String(ad.link || '')) || CHAT_CTA.test(cta)) score += 10;
  else reasons.push('No lead form, chat or website for people to go to.');

  if (headline && text) {
    if (!text.toLowerCase().includes(headline.toLowerCase())) score += 10;
    else reasons.push('Headline repeats the main text.');
  }
  return { score: Math.min(100, score), reasons };
}

export function gradeOf(score) {
  if (score == null) return 'unknown';
  if (score >= 75) return 'great';
  if (score >= 55) return 'good';
  if (score >= 35) return 'fair';
  return 'weak';
}

// ads: [{ id, campaignId, currency, headline, text, cta, visual, link, leadForm, spend, impressions, clicks, leads }]
export function scoreAds(ads, { minSpend = 500 } = {}) {
  const rows = ads.map((ad) => ({
    key: String(ad.id),
    campaignId: String(ad.campaignId || ''),
    platform: 'meta',
    currency: ad.currency || '',
    spend: ad.spend,
    impressions: ad.impressions,
    clicks: ad.clicks,
    results: ad.leads,
    resultLabel: 'leads'
  }));
  const metricOf = campaignMetric(rows, (row) => row.campaignId);
  const ranked = rankAds(rows.map((row) => ({ ...row, metric: metricOf(row) })), { minSpend });
  const performance = new Map(ranked.items.map((item) => [item.key, item]));
  const scores = {};
  for (const ad of ads) {
    const creative = creativeScore(ad);
    const perf = performance.get(String(ad.id));
    const perfScore = perf?.score ?? null;
    let score = creative.score;
    let basis = 'creative';
    if (perfScore != null && creative.score != null) {
      score = Math.round(0.6 * perfScore + 0.4 * creative.score);
      basis = 'results_and_creative';
    } else if (perfScore != null) {
      score = perfScore;
      basis = 'results';
    }
    scores[String(ad.id)] = {
      score,
      grade: gradeOf(score),
      basis,
      creativeScore: creative.score,
      resultsScore: perfScore,
      reasons: [...(perfScore != null ? perf.reasons : []), ...creative.reasons].slice(0, 4)
    };
  }
  return scores;
}
