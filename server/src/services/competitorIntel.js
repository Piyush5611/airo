import crypto from 'crypto';
import { z } from 'zod';
import * as intelRepo from '../repositories/competitorIntelRepo.js';
import * as repo from '../repositories/competitorRepo.js';
import * as offeringRepo from '../repositories/offeringRepo.js';
import { claimJob } from '../repositories/adsAgentRepo.js';
import { catalogFacts, structuredLlm } from './llmService.js';
import { businessProfile } from './adsAgent/chatPlanner.js';
import { domainOf } from './competitorDiscovery.js';
import { recordAudit } from './auditService.js';
import { ApiError } from '../utils/errors.js';

export const NOT_AVAILABLE = 'NOT_AVAILABLE';
export const ANALYSIS_VERSION = 1;
const STRATEGY_VERSION = 1;
const IDEAS_VERSION = 1;
const BATCH = 15;
const ORG_LIMIT_PER_RUN = 45;
const PURPOSES = ['competitors', 'ads', 'assistant', 'whatsapp'];
const analysing = new Set();
const analyseAgain = new Set();

export const STYLES = ['product', 'lifestyle', 'ugc', 'testimonial', 'educational', 'founder_led', 'offer', 'before_after', 'social_proof', 'announcement', 'comparison'];
export const OFFERS = ['discount', 'price', 'emi', 'free_trial', 'consultation', 'site_visit', 'limited_time', 'bundle', 'guarantee', 'other', 'none'];
export const CTAS = ['buy_now', 'learn_more', 'contact_us', 'whatsapp', 'book_now', 'book_visit', 'enquire_now', 'sign_up', 'download', 'call_now', 'other'];
export const TONES = ['premium', 'urgent', 'educational', 'emotional', 'promotional', 'trust', 'professional', 'casual'];
export const INTENTS = ['awareness', 'consideration', 'conversion'];
export const THEMES = ['price', 'offer', 'location', 'quality', 'features', 'trust', 'testimonial', 'social_proof', 'convenience', 'urgency', 'payment_plan', 'brand', 'lifestyle', 'investment', 'service', 'other'];
const CONFIDENCE = ['high', 'medium', 'low'];

export const LABELS = {
  product: 'Product-focused', lifestyle: 'Lifestyle', ugc: 'UGC', testimonial: 'Testimonial', educational: 'Educational', founder_led: 'Founder-led',
  offer: 'Offer', before_after: 'Before/After', social_proof: 'Social proof', announcement: 'Announcement', comparison: 'Comparison',
  discount: 'Discount', price: 'Price', emi: 'EMI', free_trial: 'Free trial', consultation: 'Consultation', site_visit: 'Site visit',
  limited_time: 'Limited-time', bundle: 'Bundle', guarantee: 'Guarantee', other: 'Other', none: 'No offer',
  buy_now: 'Buy now', learn_more: 'Learn more', contact_us: 'Contact us', whatsapp: 'WhatsApp', book_now: 'Book now', book_visit: 'Book visit',
  enquire_now: 'Enquire now', sign_up: 'Sign up', download: 'Download', call_now: 'Call now',
  premium: 'Premium', urgent: 'Urgent', emotional: 'Emotional', promotional: 'Promotional', trust: 'Trust', professional: 'Professional', casual: 'Casual',
  awareness: 'Awareness', consideration: 'Consideration', conversion: 'Conversion',
  location: 'Location', quality: 'Quality', features: 'Features', convenience: 'Convenience', urgency: 'Urgency', payment_plan: 'Payment plan',
  brand: 'Brand', investment: 'Investment', service: 'Service',
  static: 'Static', video: 'Video', carousel: 'Carousel', reel: 'Reel', text: 'Text', image: 'Image',
  meta: 'Meta', google: 'Google'
};
const label = (key) => LABELS[key] || String(key || '').replace(/_/g, ' ');

const text = (max) => z.preprocess((value) => (value == null ? '' : String(value)), z.string())
  .transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, max));
const pick = (values, fallback) => z.preprocess((value) => String(value || '').toLowerCase().replace(/[\s-/]+/g, '_'), z.enum(values).catch(fallback));
const pickList = (values, max) => z.preprocess(
  (value) => (Array.isArray(value) ? value : []).map((item) => String(item || '').toLowerCase().replace(/[\s-/]+/g, '_')).filter((item) => values.includes(item)),
  z.array(z.enum(values))
).transform((list) => [...new Set(list)].slice(0, max));
const flag = z.preprocess((value) => value === true || value === 'true', z.boolean());

export const adAnalysisSchema = z.object({
  items: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, BATCH) : []), z.array(z.object({
    id: z.coerce.number().int().positive(),
    styles: pickList(STYLES, 3),
    hook: text(200),
    message: text(240),
    valueProp: text(200),
    painPoint: text(160),
    benefit: text(160),
    usp: text(160),
    offers: pickList(OFFERS, 4),
    offerText: text(160),
    cta: pick(CTAS, 'other'),
    tone: pick(TONES, 'promotional'),
    intent: pick(INTENTS, 'consideration'),
    themes: pickList(THEMES, 5),
    urgency: flag,
    scarcity: flag,
    socialProof: flag,
    trustSignal: text(160),
    emotion: text(80),
    confidence: pick(CONFIDENCE, 'low')
  })))
});

export const strategySchema = z.object({
  advertising: text(400),
  mainOffers: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 6) : []), z.array(text(160))),
  mainMessages: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 6) : []), z.array(text(160))),
  positioning: text(300),
  changes: text(300),
  whitespace: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 6) : []), z.array(text(220))),
  hooks: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 6) : []), z.array(text(160))),
  offers: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 5) : []), z.array(text(160))),
  formats: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 5) : []), z.array(text(160))),
  positioningIdeas: z.preprocess((value) => (Array.isArray(value) ? value.slice(0, 5) : []), z.array(text(220))),
  confidence: pick(CONFIDENCE, 'low')
}).refine((value) => value.advertising.length > 5, { message: 'advertising is required', path: ['advertising'] });

export const COPY_RULE = 'Use competitor intelligence to understand the market, but do not copy competitor wording, creatives, trademarks, or claims.';

const copy = (max, min) => z.string().trim().min(min).max(max);
const short = (max) => z.preprocess((value) => (value == null ? '' : String(value)), z.string().trim().max(max));
const noBangOrCaps = (value) => !/[!]/.test(value) && !/\b[A-Z]{5,}\b/.test(value);

// Ad copy goes straight into a launch draft, so the limits match metaCreativeSchema and googleCreativeSchema.
export function adIdeasSchemaFor(competitorNames = []) {
  const names = competitorNames.map((name) => String(name || '').trim().toLowerCase()).filter((name) => name.length >= 3);
  const mentions = (value) => names.find((name) => value.toLowerCase().includes(name));
  return z.object({
    verdict: copy(600, 20),
    suggestions: z.array(z.object({ title: copy(120, 3), why: copy(360, 10), basedOn: short(240) })).min(2).max(6),
    meta: z.object({
      variants: z.array(z.object({
        angle: copy(120, 3),
        headline: copy(40, 5),
        primaryText: copy(300, 20),
        why: copy(260, 10)
      })).min(2).max(3)
    }),
    google: z.object({
      headlines: z.array(copy(30, 3)).min(8).max(15),
      descriptions: z.array(copy(90, 10)).min(2).max(4),
      why: copy(260, 10)
    }),
    avoid: z.array(copy(220, 5)).max(5).default([]),
    confidence: pick(CONFIDENCE, 'low')
  }).superRefine((value, ctx) => {
    if (new Set(value.google.headlines.map((item) => item.toLowerCase())).size !== value.google.headlines.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['google', 'headlines'], message: 'Headlines must all be different.' });
    }
    const copyLines = [
      ...value.meta.variants.flatMap((item) => [['meta', item.headline], ['meta', item.primaryText]]),
      ...value.google.headlines.map((item) => ['google', item]),
      ...value.google.descriptions.map((item) => ['google', item])
    ];
    for (const [platform, line] of copyLines) {
      const name = mentions(line);
      if (name) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [platform], message: `Ad copy must not name a competitor ("${name}").` });
      if (!noBangOrCaps(line)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [platform], message: 'No exclamation marks or ALL CAPS words in ad copy.' });
    }
  });
}

const IDEAS_BRIEF = `You are AIRO's ad strategist for an Indian business. You get what competitors show publicly (their website reports and their observed public ads, already classified) and the owner's own business facts.
Decide what is right for the owner, then write ads that stand apart from the competitors.
${COPY_RULE}
- verdict: in 2 to 4 plain sentences, what AIRO thinks the owner should do against these competitors and why.
- suggestions: 2 to 6 concrete moves. why = the reasoning. basedOn = the observed competitor fact it comes from (for example "4 of 6 of their ads push EMI"), or empty.
- meta.variants: 2 or 3 Meta image ads, each a different angle. headline under 40 characters, primaryText under 300 characters, why = how it differs from what competitors say.
- google: one responsive search ad. 8 to 15 headlines of 30 characters or fewer, all different. 2 to 4 descriptions of 90 characters or fewer. why = how it differs.
- avoid: up to 5 things the owner should not do (for example fighting on the same discount everyone runs).
- Claims in the ads must come only from the owner's facts. Never invent prices, offers, discounts, awards, dates, rankings or guarantees.
- Never name a competitor in ad copy, never compare by name, never use their trademarks or slogans.
- No ALL CAPS words, no exclamation marks, no emojis. Write ads in the owner's ad language, English if none is given.
- Spend, reach, targeting and results of competitors are not public. Never state or guess them.
- confidence: high only with website reports and many analysed ads from several competitors, otherwise medium or low.`;

const ANALYSIS_BRIEF = `You are AIRO's ad analyst. You classify competitor ads that are public in the Meta Ad Library or the Google Ads Transparency Center.
Use only the ad text, headline, button and landing page given. You cannot see the image or video, so do not describe visuals you were not told about.
Never guess spend, reach, targeting, results or performance. They are not public.
For each ad return: id (as given), styles, hook (the opening line or idea that grabs attention, in your own short words), message (main marketing message), valueProp, painPoint, benefit, usp, offers, offerText (the offer as stated, short), cta, tone, intent, themes, urgency, scarcity, socialProof, trustSignal, emotion, confidence.
Allowed values:
styles: ${STYLES.join(', ')}
offers: ${OFFERS.join(', ')} (use none when the ad has no offer)
cta: ${CTAS.join(', ')}
tone: ${TONES.join(', ')}
intent: ${INTENTS.join(', ')}
themes: ${THEMES.join(', ')}
confidence: high when the text is clear, low when the ad has very little text.
Leave a text field empty when the ad does not show it. Do not invent.`;

const STRATEGY_BRIEF = `You are AIRO's competitive strategist for an Indian business.
You get observed public ads of competitors (already classified) and the owner's business. Spend, reach, targeting and results of competitors are not public; never state or guess them.
Describe what is observed, then how the owner can stand apart.
${COPY_RULE}
Recommend whitespace, alternative hooks, offers, formats and positioning. Never recommend copying an ad.
advertising: what they advertise. mainOffers, mainMessages: as observed. positioning: their likely positioning, worded as an observation. changes: what changed over time, or empty.
whitespace, hooks, offers, formats, positioningIdeas: for the owner. confidence: high only with many ads from several competitors, otherwise medium or low.
Write in simple English.`;

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function missingTable(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR';
}

export function creativeFormat(format, platform) {
  const value = String(format || '').toLowerCase();
  if (value.includes('video')) return 'video';
  if (value.includes('carousel')) return 'carousel';
  if (value.includes('reel')) return 'reel';
  if (value === 'text') return 'text';
  if (value === 'image' || value === 'static' || value === 'dpa' || value === 'dco') return 'static';
  return platform === 'google' && !value ? 'other' : value ? 'other' : 'static';
}

// Only the copy decides whether an ad needs analysing again; image links and dates change on every read.
export function contentHash(ad) {
  return sha(JSON.stringify([ad.format || '', ad.headline || '', ad.body || '', ad.cta || '', String(ad.link || '').split('?')[0]]));
}

function dateOnly(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

export function normalizeAd(platform, ad) {
  const row = platform === 'meta'
    ? {
      platform,
      externalId: String(ad.id || ''),
      advertiser: ad.page || '',
      format: creativeFormat(ad.format, platform),
      headline: ad.title || '',
      body: ad.text || '',
      cta: ad.cta || '',
      link: ad.link || '',
      imageUrl: ad.image || '',
      placements: ad.platforms || [],
      versions: ad.versions || 1,
      status: ad.active ? 'active' : 'inactive',
      firstShown: dateOnly(ad.startDate),
      lastShown: null,
      source: 'meta_ad_library',
      sourceUrl: ad.url || ''
    }
    : {
      platform,
      externalId: String(ad.id || ''),
      advertiser: ad.advertiser || '',
      format: creativeFormat(ad.format, platform),
      headline: '',
      body: '',
      cta: '',
      link: '',
      imageUrl: ad.image || '',
      placements: [],
      versions: 1,
      status: ad.active ? 'active' : 'inactive',
      firstShown: dateOnly(ad.firstShown),
      lastShown: dateOnly(ad.lastShown),
      source: 'google_ads_transparency',
      sourceUrl: ad.url || ''
    };
  return { ...row, contentHash: contentHash(row) };
}

const snapshotPayload = (row) => ({ format: row.format, headline: row.headline, body: row.body, cta: row.cta, link: row.link, status: row.status });

// Stores what one ad check saw: new ads, changed copy, and ads that are no longer returned. Each change is a snapshot.
export async function storeCheckAds(organizationId, competitorId, checkId, { meta, google }) {
  const counts = { added: 0, changed: 0, stopped: 0, restarted: 0 };
  try {
    for (const [platform, result] of [['meta', meta], ['google', google]]) {
      if (!result) continue;
      const rows = (result.ads || []).map((ad) => normalizeAd(platform, ad)).filter((row) => row.externalId);
      const existing = await intelRepo.adsByExternalIds(organizationId, competitorId, platform, rows.map((row) => row.externalId));
      const byExternal = new Map(existing.map((row) => [row.externalId, row]));
      const seen = [];
      for (const row of rows) {
        const found = byExternal.get(row.externalId);
        if (!found) {
          const id = await intelRepo.insertAd({ ...row, organizationId, competitorId });
          await intelRepo.addSnapshot(organizationId, { adId: id, checkId, change: 'new', contentHash: row.contentHash, status: row.status, payload: snapshotPayload(row) });
          seen.push(id);
          counts.added += 1;
          continue;
        }
        seen.push(found.id);
        await intelRepo.updateAd(organizationId, found.id, row);
        const change = found.contentHash !== row.contentHash ? 'changed' : found.status !== row.status ? (row.status === 'active' ? 'restarted' : 'stopped') : '';
        if (change) {
          await intelRepo.addSnapshot(organizationId, { adId: found.id, checkId, change, contentHash: row.contentHash, status: row.status, payload: snapshotPayload(row) });
          counts[change] += 1;
        }
      }
      const gone = await intelRepo.activeAdsNotIn(organizationId, competitorId, platform, seen);
      await intelRepo.setAdsInactive(organizationId, gone.map((row) => row.id));
      for (const row of gone) {
        await intelRepo.addSnapshot(organizationId, { adId: row.id, checkId, change: 'stopped', contentHash: row.contentHash, status: 'inactive', payload: snapshotPayload({ ...row, status: 'inactive' }) });
        counts.stopped += 1;
      }
    }
  } catch (error) {
    if (missingTable(error)) return counts;
    throw error;
  }
  return counts;
}

function adFacts(rows) {
  return rows.map((row) => [
    `AD ${row.id} (${row.platform}, ${row.format || 'format unknown'}, competitor ${row.competitor})`,
    row.headline ? `Headline: ${row.headline}` : '',
    row.body ? `Text: ${String(row.body).slice(0, 700)}` : '',
    row.cta ? `Button: ${row.cta}` : '',
    row.link ? `Landing page: ${domainOf(row.link)}${(() => { try { return new URL(row.link).pathname; } catch { return ''; } })()}` : ''
  ].filter(Boolean).join('\n')).join('\n\n');
}

const noCopy = (row) => !String(row.headline || '').trim() && !String(row.body || '').trim();

// Ads without any copy (most Google previews) are not sent to the model; only their format is known.
function blankAnalysis(row) {
  return { styles: [], hook: '', message: '', valueProp: '', painPoint: '', benefit: '', usp: '', offers: [], offerText: '', cta: 'other', tone: NOT_AVAILABLE, intent: NOT_AVAILABLE, themes: [], urgency: false, scarcity: false, socialProof: false, trustSignal: '', emotion: '', confidence: 'low', copyAvailable: false, format: row.format || NOT_AVAILABLE };
}

export async function analyzePending(organizationId, limit = ORG_LIMIT_PER_RUN) {
  const result = { analysed: 0, reused: 0, skipped: 0, failed: 0, notes: [] };
  if (analysing.has(organizationId)) {
    analyseAgain.add(organizationId);
    return { ...result, queued: true };
  }
  analysing.add(organizationId);
  try {
    const rows = await intelRepo.pendingAnalysis(organizationId, ANALYSIS_VERSION, limit);
    if (!rows.length) return result;
    const cached = await intelRepo.analysisByHashes(organizationId, [...new Set(rows.map((row) => row.contentHash))], ANALYSIS_VERSION);
    const cache = new Map(cached.map((row) => [row.hash, row]));
    const todo = [];
    for (const row of rows) {
      const hit = cache.get(row.contentHash);
      if (hit) {
        await intelRepo.saveAnalysis(organizationId, row.id, { analysis: parseJson(hit.analysis, {}), hash: row.contentHash, model: hit.model, version: ANALYSIS_VERSION });
        result.reused += 1;
      } else if (noCopy(row)) {
        await intelRepo.saveAnalysis(organizationId, row.id, { analysis: blankAnalysis(row), hash: row.contentHash, model: null, version: ANALYSIS_VERSION });
        result.skipped += 1;
      } else {
        todo.push(row);
      }
    }
    const unique = [...new Map(todo.map((row) => [row.contentHash, row])).values()];
    for (let start = 0; start < unique.length; start += BATCH) {
      const batch = unique.slice(start, start + BATCH);
      try {
        const { data, model } = await structuredLlm({
          organizationId,
          schema: adAnalysisSchema,
          feature: 'competitor_ad_analysis',
          system: ANALYSIS_BRIEF,
          facts: adFacts(batch),
          task: `Classify these ${batch.length} ads. Reply as JSON: {"items":[{"id":<ad id>, ...}]} with one item per ad.`,
          maxTokens: 6000,
          purposes: PURPOSES
        });
        const byId = new Map(data.items.map((item) => [item.id, item]));
        for (const row of batch) {
          const item = byId.get(Number(row.id));
          if (!item) {
            result.failed += 1;
            continue;
          }
          const { id, ...analysis } = item;
          const value = { ...analysis, copyAvailable: true, format: row.format || NOT_AVAILABLE };
          for (const same of todo.filter((other) => other.contentHash === row.contentHash)) {
            await intelRepo.saveAnalysis(organizationId, same.id, { analysis: value, hash: row.contentHash, model, version: ANALYSIS_VERSION });
            result.analysed += 1;
          }
        }
      } catch (error) {
        result.failed += batch.length;
        result.notes.push(`Ad analysis failed: ${String(error?.message || 'unknown error').slice(0, 160)}`);
        if (error?.code === 'llm_missing') break;
      }
    }
    if (rows.length >= limit && result.analysed + result.reused + result.skipped > 0) analyseAgain.add(organizationId);
    if (result.analysed) {
      await recordAudit({ auth: null, ip: null }, { action: 'competitor.ads_analysed', resource: 'competitor_ads', organizationId, metadata: { analysed: result.analysed, reused: result.reused } }).catch(() => {});
    }
    return result;
  } catch (error) {
    if (missingTable(error)) return result;
    throw error;
  } finally {
    analysing.delete(organizationId);
    // A second check that finished during this run stored ads this run did not see.
    if (analyseAgain.delete(organizationId)) {
      setImmediate(() => analyzePending(organizationId, limit).catch((error) => console.error('Competitor ad analysis failed:', String(error?.message || error).slice(0, 200))));
    }
  }
}

export async function analyzeDue() {
  const total = { organizations: 0, analysed: 0, reused: 0, failed: 0, notes: [] };
  let orgs = [];
  try {
    orgs = await intelRepo.organizationsWithPending(ANALYSIS_VERSION, 10);
  } catch (error) {
    if (missingTable(error)) return total;
    throw error;
  }
  for (const { organizationId } of orgs) {
    const result = await analyzePending(organizationId);
    total.organizations += 1;
    total.analysed += result.analysed;
    total.reused += result.reused;
    total.failed += result.failed;
    total.notes.push(...result.notes);
  }
  return total;
}

export async function analyzeNow(auth, req) {
  if (analysing.has(auth.organizationId)) return { started: false, running: true };
  await recordAudit(req, { action: 'competitor.ads_analysis_requested', resource: 'competitor_ads' });
  analyzePending(auth.organizationId).catch((error) => console.error('Competitor ad analysis failed:', String(error?.message || error).slice(0, 200)));
  return { started: true, running: true };
}

function share(rows, values) {
  const total = rows.length;
  const counts = {};
  for (const list of values) for (const key of new Set(list)) if (key) counts[key] = (counts[key] || 0) + 1;
  return Object.entries(counts)
    .map(([key, count]) => ({ key, label: label(key), count, share: total ? Math.round((count / total) * 100) : 0 }))
    .sort((a, b) => b.count - a.count);
}

export function confidenceFor(competitors, ads) {
  if (competitors >= 5 && ads >= 30) return 'high';
  if (competitors >= 3 && ads >= 10) return 'medium';
  return 'low';
}

const WATCH_THEMES = ['testimonial', 'social_proof', 'quality', 'trust', 'features', 'payment_plan', 'convenience', 'service'];

// Observations only: what is common and what is rare among observed public ads. Not a performance prediction.
export function marketGaps(rows) {
  const ads = rows.filter((row) => row.status === 'active');
  const analysed = ads.filter((row) => row.analysis?.copyAvailable);
  const competitors = [...new Set(ads.map((row) => row.competitorId))];
  const analysedCompetitors = [...new Set(analysed.map((row) => row.competitorId))];
  const confidence = confidenceFor(analysedCompetitors.length, analysed.length);
  const byCompetitor = (field) => {
    const sets = new Map();
    for (const row of analysed) {
      const set = sets.get(row.competitorId) || new Set();
      for (const key of [].concat(row.analysis[field] || [])) set.add(key);
      sets.set(row.competitorId, set);
    }
    return [...sets.values()];
  };
  const distributions = {
    platforms: share(ads, ads.map((row) => [row.platform])),
    formats: share(ads, ads.map((row) => [row.format || 'other'])),
    themes: share(analysed, analysed.map((row) => row.analysis.themes || [])),
    ctas: share(analysed, analysed.map((row) => [row.analysis.cta])),
    offers: share(analysed, analysed.map((row) => row.analysis.offers || [])),
    styles: share(analysed, analysed.map((row) => row.analysis.styles || [])),
    tones: share(analysed, analysed.map((row) => [row.analysis.tone]).filter((list) => list[0] !== NOT_AVAILABLE)),
    intents: share(analysed, analysed.map((row) => [row.analysis.intent]).filter((list) => list[0] !== NOT_AVAILABLE))
  };
  const gaps = [];
  const total = analysedCompetitors.length;
  if (total >= 2) {
    const themeSets = byCompetitor('themes');
    for (const theme of WATCH_THEMES) {
      const using = themeSets.filter((set) => set.has(theme)).length;
      if (using / total <= 0.25) {
        gaps.push({ type: 'theme', key: theme, text: `Few competitors talk about ${label(theme).toLowerCase()} (${using} of ${total}).`, confidence });
      }
    }
    for (const theme of distributions.themes.slice(0, 2)) {
      const using = themeSets.filter((set) => set.has(theme.key)).length;
      if (using / total >= 0.6) {
        gaps.push({ type: 'crowded', key: theme.key, text: `Most competitors lead with ${theme.label.toLowerCase()} (${using} of ${total}). Messages on other points may stand out more.`, confidence });
      }
    }
    const offerSets = byCompetitor('offers');
    const withOffer = offerSets.filter((set) => [...set].some((key) => key !== 'none')).length;
    if (withOffer / total <= 0.3) gaps.push({ type: 'offer', key: 'offers', text: `Few competitors state a clear offer in their ads (${withOffer} of ${total}).`, confidence });
    const topCta = distributions.ctas[0];
    if (topCta && topCta.share >= 60 && analysed.length >= 5) {
      gaps.push({ type: 'cta', key: topCta.key, text: `${topCta.share}% of observed ads use "${topCta.label}". A different next step may stand out.`, confidence });
    }
  }
  if (ads.length >= 5) {
    for (const format of ['video', 'carousel']) {
      const row = distributions.formats.find((item) => item.key === format);
      const value = row?.share || 0;
      if (value < 20) gaps.push({ type: 'format', key: format, text: `${label(format)} creatives are rare among observed ads (${value}%).`, confidence: confidenceFor(competitors.length, ads.length) });
    }
  }
  return {
    competitors: competitors.length,
    analysedCompetitors: total,
    ads: ads.length,
    analysedAds: analysed.length,
    confidence,
    distributions,
    gaps,
    note: 'These are observations of public ads, not predictions of what will perform. Competitor spend, reach, targeting and results are not public.'
  };
}

function monthOf(row) {
  const value = row.firstShown || (row.firstObservedAt ? String(row.firstObservedAt).slice(0, 10) : '');
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : '';
}

// Groups ads by the month they started and lists what was new in each month compared with the months before.
export function timeline(ads, snapshots = []) {
  const months = new Map();
  for (const ad of ads) {
    const month = monthOf(ad);
    if (!month) continue;
    const entry = months.get(month) || { month, ads: 0, formats: new Set(), themes: new Set(), offers: new Set(), ctas: new Set(), landing: new Set(), platforms: new Set() };
    entry.ads += 1;
    entry.formats.add(ad.format || 'other');
    entry.platforms.add(ad.platform);
    if (ad.link) entry.landing.add(domainOf(ad.link));
    for (const key of ad.analysis?.themes || []) entry.themes.add(key);
    for (const key of ad.analysis?.offers || []) if (key !== 'none') entry.offers.add(key);
    if (ad.analysis?.cta && ad.analysis.copyAvailable) entry.ctas.add(ad.analysis.cta);
    months.set(month, entry);
  }
  const seen = { formats: new Set(), themes: new Set(), offers: new Set(), ctas: new Set(), landing: new Set(), platforms: new Set() };
  const rows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((entry, index) => {
    const changes = [];
    for (const [field, word] of [['platforms', 'platform'], ['formats', 'format'], ['offers', 'offer'], ['themes', 'message'], ['ctas', 'button'], ['landing', 'landing page']]) {
      const fresh = [...entry[field]].filter((key) => key && !seen[field].has(key));
      if (index > 0 && fresh.length) changes.push(`New ${word}: ${fresh.map((key) => (field === 'landing' ? key : label(key))).join(', ')}`);
      for (const key of entry[field]) seen[field].add(key);
    }
    return {
      month: entry.month,
      ads: entry.ads,
      formats: [...entry.formats].map(label),
      themes: [...entry.themes].map(label),
      offers: [...entry.offers].map(label),
      ctas: [...entry.ctas].map(label),
      platforms: [...entry.platforms],
      changes
    };
  });
  const events = snapshots
    .filter((row) => row.changeType !== 'new')
    .slice(0, 40)
    .map((row) => ({ adId: row.adId, platform: row.platform, change: row.changeType, at: row.observedAt }));
  return { months: rows.reverse(), events };
}

function adRow(row) {
  return { ...row, placements: parseJson(row.placements, []), analysis: parseJson(row.analysis, null) };
}

export function competitorSummary(ads) {
  const active = ads.filter((row) => row.status === 'active');
  const analysed = active.filter((row) => row.analysis?.copyAvailable);
  return {
    ads: ads.length,
    active: active.length,
    analysed: analysed.length,
    platforms: share(active, active.map((row) => [row.platform])),
    formats: share(active, active.map((row) => [row.format || 'other'])),
    themes: share(analysed, analysed.map((row) => row.analysis.themes || [])),
    offers: share(analysed, analysed.map((row) => (row.analysis.offers || []).filter((key) => key !== 'none'))),
    offerTexts: [...new Set(analysed.map((row) => row.analysis.offerText).filter(Boolean))].slice(0, 6),
    ctas: share(analysed, analysed.map((row) => [row.analysis.cta])),
    styles: share(analysed, analysed.map((row) => row.analysis.styles || [])),
    messages: [...new Set(analysed.map((row) => row.analysis.message).filter(Boolean))].slice(0, 6),
    landing: share(active, active.map((row) => [domainOf(row.link)].filter(Boolean))).slice(0, 5),
    confidence: confidenceFor(1, analysed.length)
  };
}

async function ourFacts(organizationId) {
  const [profile, items] = await Promise.all([
    businessProfile(organizationId).catch(() => null),
    offeringRepo.list(organizationId, { limit: 20 }).catch(() => [])
  ]);
  return [
    profile ? `Owner's business profile: ${JSON.stringify(profile).slice(0, 2500)}` : 'Owner business profile: not saved.',
    catalogFacts(items)
  ].join('\n');
}

function summaryFacts(name, summary, months) {
  const list = (rows) => rows.slice(0, 6).map((row) => `${row.label} ${row.share}%`).join(', ') || 'none observed';
  return [
    `${name}: ${summary.active} active public ads observed (${summary.analysed} with readable copy).`,
    `Platforms: ${list(summary.platforms)}. Formats: ${list(summary.formats)}.`,
    `Themes: ${list(summary.themes)}. Offers: ${list(summary.offers)}. Buttons: ${list(summary.ctas)}. Styles: ${list(summary.styles)}.`,
    summary.offerTexts.length ? `Offers as stated: ${summary.offerTexts.join(' | ')}` : '',
    summary.messages.length ? `Main messages (classified): ${summary.messages.join(' | ')}` : '',
    months?.length ? `By month: ${months.slice(0, 6).map((row) => `${row.month} ${row.ads} ads${row.changes.length ? ` (${row.changes.join('; ')})` : ''}`).join(' / ')}` : ''
  ].filter(Boolean).join('\n');
}

async function loadCompetitor(organizationId, id) {
  const found = await repo.byId(organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  return found;
}

export async function competitorInsights(auth, id) {
  const found = await loadCompetitor(auth.organizationId, id);
  try {
    const [ads, snapshots, strategy] = await Promise.all([
      intelRepo.listAds(auth.organizationId, { competitorId: id }, 500),
      intelRepo.competitorSnapshots(auth.organizationId, id),
      intelRepo.latestInsight(auth.organizationId, id, 'strategy')
    ]);
    const rows = ads.map(adRow);
    const summary = competitorSummary(rows);
    const history = timeline(rows, snapshots);
    return {
      ready: true,
      competitor: { id: found.id, name: found.name },
      summary,
      timeline: history,
      strategy: strategy ? { ...strategy, payload: parseJson(strategy.payload, null), current: strategy.inputHash === sha(summaryFacts(found.name, summary, history.months)) } : null
    };
  } catch (error) {
    if (missingTable(error)) return { ready: false, note: 'Run npm run migrate to set up competitor intelligence.' };
    throw error;
  }
}

export async function generateStrategy(auth, req, competitorId = 0) {
  let name = 'All tracked competitors';
  let facts;
  if (competitorId) {
    const found = await loadCompetitor(auth.organizationId, competitorId);
    name = found.name;
    const ads = (await intelRepo.listAds(auth.organizationId, { competitorId }, 500)).map(adRow);
    const summary = competitorSummary(ads);
    if (!summary.analysed) throw new ApiError(422, 'No analysed ads for this competitor yet. Check their ads first; AIRO classifies them after the check.', 'validation_error');
    const history = timeline(ads, await intelRepo.competitorSnapshots(auth.organizationId, competitorId));
    facts = summaryFacts(name, summary, history.months);
  } else {
    const market = marketGaps((await intelRepo.marketAds(auth.organizationId)).map(adRow));
    if (!market.analysedAds) throw new ApiError(422, 'No analysed competitor ads yet. Check competitor ads first.', 'validation_error');
    const list = (rows) => rows.slice(0, 8).map((row) => `${row.label} ${row.share}%`).join(', ') || 'none';
    facts = [
      `Market: ${market.analysedCompetitors} competitors, ${market.analysedAds} analysed active ads (confidence ${market.confidence}).`,
      `Themes: ${list(market.distributions.themes)}. Offers: ${list(market.distributions.offers)}. Buttons: ${list(market.distributions.ctas)}. Formats: ${list(market.distributions.formats)}. Styles: ${list(market.distributions.styles)}.`,
      market.gaps.length ? `Observed gaps: ${market.gaps.map((gap) => gap.text).join(' ')}` : 'No clear gaps observed.'
    ].join('\n');
  }
  const inputHash = sha(facts);
  const last = await intelRepo.latestInsight(auth.organizationId, competitorId, 'strategy');
  if (last && last.inputHash === inputHash && Number(last.version) >= STRATEGY_VERSION) {
    return { ...last, payload: parseJson(last.payload, null), current: true, reused: true };
  }
  const { data, model } = await structuredLlm({
    organizationId: auth.organizationId,
    schema: strategySchema,
    feature: 'competitor_strategy',
    system: STRATEGY_BRIEF,
    facts: `${facts}\n\n${await ourFacts(auth.organizationId)}`,
    task: 'Reply as JSON with: advertising, mainOffers[], mainMessages[], positioning, changes, whitespace[], hooks[], offers[], formats[], positioningIdeas[], confidence.',
    maxTokens: 2500,
    purposes: PURPOSES
  });
  const id = await intelRepo.addInsight(auth.organizationId, { competitorId, kind: 'strategy', inputHash, payload: data, model, version: STRATEGY_VERSION });
  await recordAudit(req, { action: 'competitor.strategy_generated', resource: 'competitor', resourceId: competitorId || null, metadata: { model } });
  return { id, payload: data, model, version: STRATEGY_VERSION, current: true, reused: false, name };
}

function reportFacts(name, analysis) {
  if (!analysis) return '';
  const list = (rows, max = 5) => (rows || []).slice(0, max).join(' | ');
  const offers = (analysis.offerings || []).slice(0, 6)
    .map((row) => [row.name, row.price, row.offer].filter(Boolean).join(' - ')).filter(Boolean).join(' | ');
  return [
    `${name} website report: ${analysis.summary || ''}`,
    analysis.positioning ? `Their positioning: ${analysis.positioning}` : '',
    analysis.priceRange ? `Their price range: ${analysis.priceRange}` : '',
    offers ? `Their offerings: ${offers}` : '',
    analysis.messaging?.length ? `Their website messages: ${list(analysis.messaging)}` : '',
    analysis.strengths?.length ? `Their strengths: ${list(analysis.strengths)}` : '',
    analysis.weaknesses?.length ? `Their weak spots: ${list(analysis.weaknesses)}` : '',
    analysis.gaps?.length ? `Gaps seen: ${list(analysis.gaps)}` : ''
  ].filter(Boolean).join('\n');
}

async function ideaFacts(organizationId, competitorId) {
  const parts = [];
  let names;
  let label;
  if (competitorId) {
    const found = await loadCompetitor(organizationId, competitorId);
    label = found.name;
    names = [found.name];
    const ads = (await intelRepo.listAds(organizationId, { competitorId }, 500)).map(adRow);
    const summary = competitorSummary(ads);
    if (summary.analysed) parts.push(summaryFacts(found.name, summary, timeline(ads, await intelRepo.competitorSnapshots(organizationId, competitorId)).months));
    const report = await repo.latestReport(organizationId, competitorId);
    if (report?.status === 'ready') parts.push(reportFacts(found.name, parseJson(report.analysis, null)));
  } else {
    label = 'All tracked competitors';
    names = (await intelRepo.competitorRows(organizationId)).map((row) => row.name);
    const market = marketGaps((await intelRepo.marketAds(organizationId)).map(adRow));
    if (market.analysedAds) {
      const list = (rows) => rows.slice(0, 8).map((row) => `${row.label} ${row.share}%`).join(', ') || 'none';
      parts.push([
        `Market: ${market.analysedCompetitors} competitors, ${market.analysedAds} analysed active ads (confidence ${market.confidence}).`,
        `Themes: ${list(market.distributions.themes)}. Offers: ${list(market.distributions.offers)}. Buttons: ${list(market.distributions.ctas)}. Formats: ${list(market.distributions.formats)}. Styles: ${list(market.distributions.styles)}.`,
        market.gaps.length ? `Observed gaps: ${market.gaps.map((gap) => gap.text).join(' ')}` : 'No clear gaps observed.'
      ].join('\n'));
    }
    for (const row of await repo.readyReports(organizationId, 5)) parts.push(reportFacts(row.name, parseJson(row.analysis, null)));
  }
  const evidence = parts.filter(Boolean);
  if (!evidence.length) {
    throw new ApiError(422, competitorId
      ? 'Nothing to work from yet. Press Analyse website or Check ads for this competitor first.'
      : 'Nothing to work from yet. Analyse a competitor website or check competitor ads first.', 'validation_error');
  }
  const strategy = await intelRepo.latestInsight(organizationId, competitorId, 'strategy');
  const ideas = parseJson(strategy?.payload, null);
  if (ideas) evidence.push(`AIRO's earlier stand-apart ideas: whitespace ${ideas.whitespace.join(' | ')}. Hooks ${ideas.hooks.join(' | ')}.`);
  return { label, names, competitorFacts: evidence.join('\n\n') };
}

export async function generateAdIdeas(auth, req, competitorId = 0) {
  const { label, names, competitorFacts } = await ideaFacts(auth.organizationId, competitorId);
  const facts = `${competitorFacts}\n\n${await ourFacts(auth.organizationId)}`;
  const inputHash = sha(facts);
  const last = await intelRepo.latestInsight(auth.organizationId, competitorId, 'ad_ideas');
  if (last && last.inputHash === inputHash && Number(last.version) >= IDEAS_VERSION) {
    return { ...last, payload: parseJson(last.payload, null), current: true, reused: true, name: label };
  }
  if (!(await claimJob(`competitors.ideas.org.${auth.organizationId}`, 1))) {
    throw new ApiError(429, 'Ad ideas were requested less than a minute ago. Try again shortly.', 'rate_limited');
  }
  const { data, model } = await structuredLlm({
    organizationId: auth.organizationId,
    schema: adIdeasSchemaFor(names),
    feature: 'competitor_ad_ideas',
    system: IDEAS_BRIEF,
    facts,
    task: 'Reply as JSON with: verdict, suggestions[{title, why, basedOn}], meta{variants[{angle, headline, primaryText, why}]}, google{headlines[], descriptions[], why}, avoid[], confidence.',
    maxTokens: 3500,
    purposes: ['ads', ...PURPOSES.filter((item) => item !== 'ads')]
  });
  const id = await intelRepo.addInsight(auth.organizationId, { competitorId, kind: 'ad_ideas', inputHash, payload: data, model, version: IDEAS_VERSION });
  await recordAudit(req, { action: 'competitor.ad_ideas_generated', resource: 'competitor', resourceId: competitorId || null, metadata: { model } });
  return { id, payload: data, model, version: IDEAS_VERSION, current: true, reused: false, name: label, createdAt: new Date().toISOString() };
}

export async function latestAdIdeas(auth, competitorId = 0) {
  try {
    const row = await intelRepo.latestInsight(auth.organizationId, competitorId, 'ad_ideas');
    return { ready: true, ideas: row ? { ...row, payload: parseJson(row.payload, null) } : null };
  } catch (error) {
    if (missingTable(error)) return { ready: false, ideas: null, note: 'Run npm run migrate to set up competitor intelligence.' };
    throw error;
  }
}

export async function overview(auth) {
  try {
    const [ads, competitors, strategy] = await Promise.all([
      intelRepo.marketAds(auth.organizationId),
      intelRepo.competitorRows(auth.organizationId),
      intelRepo.latestInsight(auth.organizationId, 0, 'strategy')
    ]);
    const rows = ads.map(adRow);
    const market = marketGaps(rows);
    const perCompetitor = competitors.map((row) => {
      const own = rows.filter((ad) => ad.competitorId === row.id);
      const active = own.filter((ad) => ad.status === 'active');
      return {
        ...row,
        domain: domainOf(row.website),
        ads: own.length,
        activeAds: active.length,
        platforms: [...new Set(active.map((ad) => ad.platform))],
        topThemes: share(active.filter((ad) => ad.analysis?.copyAvailable), active.filter((ad) => ad.analysis?.copyAvailable).map((ad) => ad.analysis.themes || [])).slice(0, 3).map((item) => item.label)
      };
    });
    return {
      ready: true,
      tracked: competitors.length,
      activeAdvertisers: perCompetitor.filter((row) => row.activeAds > 0).length,
      pendingAnalysis: rows.filter((row) => !row.analysis).length,
      analysing: analysing.has(auth.organizationId),
      market,
      competitors: perCompetitor,
      strategy: strategy ? { ...strategy, payload: parseJson(strategy.payload, null) } : null
    };
  } catch (error) {
    if (missingTable(error)) return { ready: false, note: 'Run npm run migrate to set up competitor intelligence.' };
    throw error;
  }
}

export async function adList(auth, filters) {
  try {
    const rows = (await intelRepo.listAds(auth.organizationId, filters, 300)).map(adRow);
    return { ready: true, items: rows.map((row) => ({ ...row, body: String(row.body || '').slice(0, 400) })) };
  } catch (error) {
    if (missingTable(error)) return { ready: false, items: [] };
    throw error;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Only what the public ad libraries show. Running time is the usual public hint that an ad works for its owner.
export function publicSignals(row, sameCopy = { total: 1, active: 0 }, now = Date.now()) {
  const start = Date.parse(row.firstShown || '');
  const end = row.status === 'active' ? now : Date.parse(row.lastShown || row.lastObservedAt || '');
  const days = Number.isFinite(start) && Number.isFinite(end) && end >= start ? Math.floor((end - start) / DAY_MS) + 1 : null;
  return {
    status: row.status,
    days,
    longRunning: days != null && days >= 30,
    firstShown: row.firstShown || null,
    lastShown: row.lastShown || null,
    versions: Number(row.versions || 1),
    sameCopyAds: Math.max(1, sameCopy.total),
    sameCopyActive: sameCopy.active,
    placements: parseJson(row.placements, []),
    landing: row.link ? domainOf(row.link) : null,
    cta: row.cta || null,
    source: row.source
  };
}

export async function adDetail(auth, id) {
  const row = await intelRepo.adById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Ad not found.', 'not_found');
  const [snapshots, sameCopy] = await Promise.all([
    intelRepo.adSnapshots(auth.organizationId, id),
    intelRepo.sameCopyCount(auth.organizationId, row.competitorId, row.contentHash)
  ]);
  return {
    ...adRow(row),
    signals: publicSignals(row, sameCopy),
    snapshots: snapshots.map((item) => ({ ...item, payload: parseJson(item.payload, {}) })),
    notAvailable: ['spend', 'impressions', 'reach', 'targeting', 'clicks', 'conversions', 'roas'],
    note: 'Spend, reach, targeting and results of another business are not public and are not shown.'
  };
}

// Short market context for the existing ad writers. Read from stored results only; no model call.
export async function competitorContext(organizationId) {
  try {
    const market = marketGaps((await intelRepo.marketAds(organizationId)).map(adRow));
    if (!market.analysedAds) return '';
    const list = (rows) => rows.slice(0, 5).map((row) => `${row.label} ${row.share}%`).join(', ') || 'none';
    return [
      `COMPETITOR INTELLIGENCE (observed public ads, ${market.analysedCompetitors} competitors, ${market.analysedAds} ads, confidence ${market.confidence}):`,
      `Common themes: ${list(market.distributions.themes)}. Common offers: ${list(market.distributions.offers)}. Common buttons: ${list(market.distributions.ctas)}. Formats: ${list(market.distributions.formats)}.`,
      market.gaps.length ? `Observed gaps: ${market.gaps.slice(0, 5).map((gap) => gap.text).join(' ')}` : '',
      `Differentiate from these. ${COPY_RULE}`
    ].filter(Boolean).join('\n');
  } catch (error) {
    if (!missingTable(error)) console.error('Competitor context skipped:', String(error?.message || error).slice(0, 200));
    return '';
  }
}

export async function setCompetitorVerified(auth, req, id, verified) {
  await loadCompetitor(auth.organizationId, id);
  await repo.setVerified(auth.organizationId, id, verified);
  await recordAudit(req, { action: verified ? 'competitor.verified' : 'competitor.unverified', resource: 'competitor', resourceId: id });
  return { id, verified };
}

const VERDICT_TYPE = { direct: 'direct', indirect: 'indirect' };

// Match confidence for a discovered competitor: the AI verdict plus how many independent sources found it.
export function discoveryFields(row) {
  const sources = parseJson(row.sources, []);
  const types = [...new Set(sources.map((item) => item.type).filter(Boolean))];
  const base = row.verdict === 'direct' ? 70 : row.verdict === 'indirect' ? 55 : 40;
  return {
    competitorType: VERDICT_TYPE[row.verdict] || null,
    confidence: Math.min(95, base + types.length * 8),
    source: types.join(',').slice(0, 80) || 'discovery',
    reason: String(row.reason || '').slice(0, 500)
  };
}
