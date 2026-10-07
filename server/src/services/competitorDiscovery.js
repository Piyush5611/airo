import { z } from 'zod';
import { one } from '../db/sql.js';
import * as repo from '../repositories/competitorRepo.js';
import * as offeringRepo from '../repositories/offeringRepo.js';
import { googleSearch, mapsPlaces, metaKeywordAds } from '../integrations/apify.js';
import { fetchPublic, pageText } from '../integrations/webPage.js';
import { businessProfile } from './adsAgent/chatPlanner.js';
import { catalogFacts, structuredLlm } from './llmService.js';
import { sectorOf } from '../domain/sectors.js';
import { decryptJson } from '../utils/cryptoBox.js';
import { recordAudit } from './auditService.js';
import { analyzeCompetitor } from './competitorService.js';
import { ApiError } from '../utils/errors.js';

const MANUAL_COOLDOWN_MS = 30 * 60 * 1000;
const CHECK_TOP = 15;
const running = new Set();

// Portals, directories, news and social sites list businesses; they are not competitors themselves.
const NOT_COMPETITORS = [
  '99acres.com', 'magicbricks.com', 'housing.com', 'nobroker.in', 'squareyards.com', 'commonfloor.com', 'makaan.com', 'proptiger.com',
  'propertywala.com', 'nestaway.com', 'olx.in', 'quikr.com', 'justdial.com', 'sulekha.com', 'indiamart.com', 'tradeindia.com',
  'practo.com', 'lybrate.com', 'zomato.com', 'swiggy.com', 'tripadvisor.in', 'tripadvisor.com', 'makemytrip.com', 'goibibo.com',
  'booking.com', 'agoda.com', 'amazon.in', 'amazon.com', 'flipkart.com', 'myntra.com', 'meesho.com', 'naukri.com', 'indeed.com',
  'glassdoor.co.in', 'glassdoor.com', 'shiksha.com', 'collegedunia.com', 'urbancompany.com', 'facebook.com', 'fb.com', 'fb.me',
  'instagram.com', 'youtube.com', 'youtu.be', 'linkedin.com', 'twitter.com', 'x.com', 'pinterest.com', 'quora.com', 'reddit.com',
  'wikipedia.org', 'google.com', 'google.co.in', 'goo.gl', 'g.co', 'g.page', 'wa.me', 'whatsapp.com', 'medium.com', 'blogspot.com',
  'wordpress.com', 'timesofindia.indiatimes.com', 'indiatimes.com', 'hindustantimes.com', 'ndtv.com', 'livemint.com', 'moneycontrol.com',
  'business-standard.com', 'economictimes.com', 'news18.com', 'indiatoday.in', 'thehindu.com', 'financialexpress.com', 'gov.in', 'nic.in',
  'linktr.ee', 'bit.ly', 'apple.com', 'play.google.com', 'yellowpages.in', 'asklaila.com', 'grotal.com', 'nobrokerhood.com'
];

export function domainOf(raw) {
  try {
    const url = new URL(/^https?:\/\//i.test(String(raw || '')) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  } catch {
    return '';
  }
}

export function notCompetitor(domain) {
  if (!domain) return false;
  return NOT_COMPETITORS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

const nameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function token(organizationId) {
  return one(
    `SELECT c.status, c.mode, cred.ciphertext
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND p.provider_key = 'apify' AND c.status = 'connected' AND c.mode = 'live'
     ORDER BY c.id LIMIT 1`,
    [organizationId]
  ).then((row) => {
    if (!row?.ciphertext) return null;
    try {
      const secret = decryptJson(row.ciphertext);
      return secret?.verified === true && secret.apiKey ? secret.apiKey : null;
    } catch {
      return null;
    }
  }).catch(() => null);
}

const text = (max) => z.preprocess((value) => (value == null ? '' : String(value)), z.string())
  .transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, max));
const list = (item, max) => z.preprocess((value) => (Array.isArray(value) ? value.slice(0, max) : []), z.array(item));

export const planSchema = z.object({
  searches: list(text(80), 4),
  adKeywords: list(text(40), 3),
  places: list(text(60), 2),
  location: text(80)
}).refine((value) => value.searches.filter(Boolean).length > 0, { message: 'searches are required', path: ['searches'] });

export const verdictSchema = z.object({
  items: list(z.object({
    id: z.coerce.number().int(),
    verdict: z.preprocess((value) => String(value || '').toLowerCase(), z.enum(['direct', 'indirect', 'not_competitor', 'unclear']).catch('unclear')),
    reason: text(240),
    name: text(120),
    city: text(80)
  }), 20)
});

const PLAN_BRIEF = `You plan a competitor search for an Indian business. Write what a customer would type to find what this business sells, in its area.
searches: up to 4 Google searches, 2 to 6 words each, with the area (for example "3 bhk flats noida sector 150", "dental clinic andheri west").
adKeywords: up to 3 short words people would see in Facebook or Instagram ads for this kind of offer (for example "3 bhk noida", "invisible braces").
places: up to 2 Google Maps business categories (for example "real estate developer", "dental clinic").
location: the main city and state or "City, India".
Never use the business's own name or its project or product names. Use only the facts given.`;

const VERDICT_BRIEF = `You check which businesses found online compete with the owner's business. Use only the facts given.
direct: sells the same kind of thing to the same kind of customer in the same area. indirect: overlapping offer or area but not the same. not_competitor: a portal, directory, agent listing site, supplier, news site, the owner's own business, or something unrelated. unclear: not enough facts.
reason: one short sentence that names the evidence (where they appeared and what their site says). name: the clean business name. city: their city if the facts show it.`;

async function planSearch(organizationId, { profile, items, sector, orgName }) {
  const facts = [
    `Business: ${orgName || 'not set'}. Sector: ${sector || 'not set'}. Office city: ${profile?.officeCity || 'not set'}.`,
    profile?.category ? `Category: ${profile.category}` : '',
    profile?.offering ? `Main offering: ${profile.offering}` : '',
    Array.isArray(profile?.locations) && profile.locations.length ? `Target areas: ${profile.locations.join(', ')}` : '',
    catalogFacts(items)
  ].filter(Boolean).join('\n');
  try {
    const { data } = await structuredLlm({
      organizationId,
      schema: planSchema,
      system: PLAN_BRIEF,
      facts,
      task: 'Reply as JSON with searches[], adKeywords[], places[], location.',
      maxTokens: 600,
      purposes: ['competitors', 'ads', 'assistant']
    });
    return { ...data, searches: data.searches.filter(Boolean), adKeywords: data.adKeywords.filter(Boolean), places: data.places.filter(Boolean), by: 'ai' };
  } catch (error) {
    if (error?.code !== 'llm_missing') throw error;
    return fallbackPlan({ profile, sector });
  }
}

export function fallbackPlan({ profile, sector }) {
  const city = profile?.officeCity || (Array.isArray(profile?.locations) ? profile.locations[0] : '') || '';
  const what = String(profile?.category || profile?.offering || sector || '').trim();
  if (!what) return null;
  const search = `${what} ${city}`.trim().toLowerCase();
  return { searches: [search], adKeywords: [what.toLowerCase()], places: [what.toLowerCase()], location: city ? `${city}, India` : '', by: 'rules' };
}

function addSource(map, { key, name, domain, website, facebook, city, category }, source, points) {
  const current = map.get(key) || { key, name, domain: domain || '', website: website || '', facebook: facebook || '', city: city || '', category: category || '', sources: [], score: 0, types: new Set() };
  if (!current.name && name) current.name = name;
  if (!current.website && website) current.website = website;
  if (!current.domain && domain) current.domain = domain;
  if (!current.facebook && facebook) current.facebook = facebook;
  if (!current.city && city) current.city = city;
  if (!current.category && category) current.category = category;
  if (current.sources.length < 8) current.sources.push(source);
  current.score += points;
  current.types.add(source.type);
  map.set(key, current);
}

function titleName(title, domain) {
  const part = String(title || '').split(/\s[|\-–:]\s/).map((value) => value.trim()).filter(Boolean);
  const short = part.length > 1 ? part[part.length - 1] : part[0];
  return (short && short.length <= 60 ? short : domain).slice(0, 160);
}

// Turns raw Apify rows into scored candidates; own domains, known competitors and portals are left out.
export function collectCandidates({ google = [], meta = [], maps = [], ownDomains = [], knownDomains = [], knownNames = [], orgName = '' }) {
  const own = new Set(ownDomains.filter(Boolean));
  const known = new Set(knownDomains.filter(Boolean));
  const names = new Set([...knownNames, orgName].map(nameKey).filter(Boolean));
  const skip = (domain, name) => (domain && (own.has(domain) || known.has(domain) || notCompetitor(domain))) || (name && names.has(nameKey(name)));
  const map = new Map();

  for (const page of google) {
    const query = String(page?.searchQuery?.term || '').slice(0, 80);
    for (const row of page?.paidResults || []) {
      const domain = domainOf(row.url || row.displayedUrl);
      if (!domain || skip(domain)) continue;
      addSource(map, { key: domain, name: titleName(row.title, domain), domain, website: `https://${domain}` }, { type: 'google_ad', query, note: String(row.title || '').slice(0, 120) }, 4);
    }
    for (const row of page?.organicResults || []) {
      const domain = domainOf(row.url);
      if (!domain || skip(domain)) continue;
      const position = Number(row.position) || 10;
      addSource(map, { key: domain, name: titleName(row.title, domain), domain, website: `https://${domain}` }, { type: 'google_search', query, note: `#${position} ${String(row.title || '').slice(0, 100)}` }, position <= 3 ? 3 : position <= 6 ? 2 : 1);
    }
  }

  const pages = new Map();
  for (const ad of meta) {
    const snap = ad?.snapshot || {};
    const pageId = String(ad?.pageID || ad?.pageId || snap.pageId || '');
    const name = String(ad?.pageName || snap.pageName || '').trim();
    if (!pageId || !name) continue;
    const link = snap.linkUrl || snap.cards?.find((card) => card?.linkUrl)?.linkUrl || '';
    const domain = domainOf(link);
    const page = pages.get(pageId) || { name, facebook: snap.pageProfileUri || `https://www.facebook.com/${pageId}`, domain: '', ads: 0, query: '', categories: snap.pageCategories || [] };
    page.ads += 1;
    if (!page.domain && domain && !notCompetitor(domain)) page.domain = domain;
    if (!page.query) {
      try {
        page.query = new URL(ad.inputUrl || ad.url || '').searchParams.get('q') || '';
      } catch {
        page.query = '';
      }
    }
    pages.set(pageId, page);
  }
  for (const page of pages.values()) {
    if (skip(page.domain, page.name)) continue;
    const key = page.domain || `name:${nameKey(page.name)}`;
    addSource(map, {
      key, name: page.name, domain: page.domain, website: page.domain ? `https://${page.domain}` : '', facebook: page.facebook, category: page.categories.slice(0, 2).join(', ')
    }, { type: 'meta_ad', query: page.query.slice(0, 80), note: `${page.ads} active ad${page.ads === 1 ? '' : 's'}` }, 3 + Math.min(page.ads, 10) / 2);
  }

  for (const place of maps) {
    const name = String(place?.title || '').trim();
    if (!name || place?.permanentlyClosed) continue;
    const domain = domainOf(place.website);
    if (skip(domain, name)) continue;
    const key = domain && !notCompetitor(domain) ? domain : `name:${nameKey(name)}`;
    const rating = place.totalScore ? `${place.totalScore} stars, ${place.reviewsCount || 0} reviews` : 'no rating';
    addSource(map, {
      key, name, domain: domain && !notCompetitor(domain) ? domain : '', website: domain && !notCompetitor(domain) ? `https://${domain}` : '', city: place.city || '', category: place.categoryName || ''
    }, { type: 'maps', query: String(place.searchString || '').slice(0, 80), note: `${place.categoryName || 'Place'} · ${rating}` }, 2 + (Number(place.reviewsCount) > 50 ? 1 : 0));
  }

  for (const [key, row] of map) {
    if (!key.startsWith('name:')) continue;
    const twin = [...map.values()].find((other) => !other.key.startsWith('name:') && nameKey(other.name) === key.slice(5));
    if (!twin) continue;
    twin.sources.push(...row.sources.slice(0, Math.max(0, 8 - twin.sources.length)));
    twin.score += row.score;
    for (const type of row.types) twin.types.add(type);
    if (!twin.facebook) twin.facebook = row.facebook;
    if (!twin.city) twin.city = row.city;
    if (!twin.category) twin.category = row.category;
    map.delete(key);
  }

  return [...map.values()]
    .map(({ types, ...row }) => ({ ...row, score: Math.round(row.score + (types.size - 1) * 3) }))
    .sort((a, b) => b.score - a.score);
}

async function readHome(candidate) {
  if (!candidate.website) return null;
  const page = await fetchPublic(candidate.website, 768 * 1024).catch(() => ({ failed: true }));
  if (!page?.body) return null;
  const parsed = pageText(page.body);
  return { title: parsed.title, description: parsed.description, headings: parsed.headings.slice(0, 6), text: parsed.text.slice(0, 900) };
}

async function inBatches(rows, size, work) {
  const out = [];
  for (let index = 0; index < rows.length; index += size) {
    out.push(...await Promise.all(rows.slice(index, index + size).map(work)));
  }
  return out;
}

const SOURCE_LABEL = { google_ad: 'Google ad', google_search: 'Google result', meta_ad: 'Meta ads', maps: 'Google Maps' };

async function judge(organizationId, { candidates, homes, ourFacts }) {
  const lines = candidates.map((row, index) => {
    const home = homes[index];
    return [
      `CANDIDATE ${index + 1}: ${row.name}${row.domain ? ` (${row.domain})` : ''}${row.city ? `, ${row.city}` : ''}${row.category ? `, ${row.category}` : ''}`,
      `Seen: ${row.sources.map((source) => `${SOURCE_LABEL[source.type]}${source.query ? ` for "${source.query}"` : ''} ${source.note}`).join('; ')}`,
      home ? `Site: ${[home.title, home.description, home.headings.join(' / '), home.text].filter(Boolean).join(' | ')}` : 'Site: not read'
    ].join('\n');
  });
  const { data } = await structuredLlm({
    organizationId,
    schema: verdictSchema,
    system: VERDICT_BRIEF,
    facts: `${ourFacts}\n\n${lines.join('\n\n')}`,
    task: `Reply as JSON: {"items":[{"id":<candidate number>,"verdict":"direct|indirect|not_competitor|unclear","reason":"","name":"","city":""}]} for all ${candidates.length} candidates.`,
    maxTokens: 2500,
    purposes: ['competitors', 'ads', 'assistant']
  });
  return new Map(data.items.map((item) => [item.id, item]));
}

async function discover(organizationId, trigger, runId) {
  const notes = [];
  const apiKey = await token(organizationId);
  if (!apiKey) throw new ApiError(422, 'Connect Apify in Connections, Research first.', 'apify_missing');
  const [profile, items, org, known] = await Promise.all([
    businessProfile(organizationId).catch(() => null),
    offeringRepo.list(organizationId, { limit: 30 }).catch(() => []),
    repo.organizationName(organizationId),
    repo.knownCompetitors(organizationId)
  ]);
  const active = items.filter((item) => item.status !== 'archived');
  const sector = sectorOf(profile?.sector)?.label || '';
  const plan = await planSearch(organizationId, { profile, items: active, sector, orgName: org?.name });
  if (!plan) throw new ApiError(422, 'Add your products or projects first, so AIRO knows what to search for.', 'validation_error');

  const [google, meta, maps] = await Promise.all([
    plan.searches.length ? googleSearch(apiKey, plan.searches).catch((error) => { notes.push(`Google search: ${error.message}`); return []; }) : [],
    plan.adKeywords.length ? metaKeywordAds(apiKey, plan.adKeywords).catch((error) => { notes.push(`Meta ads: ${error.message}`); return []; }) : [],
    plan.places.length && plan.location ? mapsPlaces(apiKey, plan.places, plan.location).catch((error) => { notes.push(`Google Maps: ${error.message}`); return []; }) : []
  ]);
  if (!google.length && !meta.length && !maps.length && notes.length) throw new ApiError(502, notes.join(' '), 'apify_failed');

  const ownDomains = [...active.map((item) => domainOf(item.website)), domainOf(profile?.website)];
  const candidates = collectCandidates({
    google, meta, maps, ownDomains,
    knownDomains: known.map((row) => domainOf(row.website)),
    knownNames: [...known.map((row) => row.name), profile?.businessName || ''],
    orgName: org?.name
  }).slice(0, CHECK_TOP);

  let verdicts = new Map();
  if (candidates.length) {
    const homes = await inBatches(candidates, 5, readHome);
    const ourFacts = [`OWNER: ${org?.name || 'the business'}. Sector: ${sector || 'not set'}. Office city: ${profile?.officeCity || 'not set'}.`, catalogFacts(active)].join('\n');
    try {
      verdicts = await judge(organizationId, { candidates, homes, ourFacts });
    } catch (error) {
      notes.push(error?.code === 'llm_missing' ? 'No AI model is connected, so matches were not checked by AI.' : `AI check failed: ${String(error.message || '').slice(0, 120)}`);
    }
  }

  let saved = 0;
  let dropped = 0;
  for (const [index, row] of candidates.entries()) {
    const verdict = verdicts.get(index + 1);
    if (verdict?.verdict === 'not_competitor') {
      dropped += 1;
      continue;
    }
    await repo.saveSuggestion(organizationId, {
      matchKey: row.key.slice(0, 200),
      name: (verdict?.name || row.name).slice(0, 160),
      website: row.website,
      facebook: row.facebook,
      city: (verdict?.city || row.city).slice(0, 120),
      category: row.category.slice(0, 160),
      sources: row.sources,
      score: row.score,
      verdict: verdict?.verdict || 'unclear',
      reason: (verdict?.reason || '').slice(0, 400)
    });
    saved += 1;
  }
  const counts = { google: google.length, metaAds: meta.length, places: maps.length, candidates: candidates.length, suggested: saved, dropped };
  await repo.finishRun(runId, { status: 'ready', plan, counts, notes });
  return counts;
}

async function begin(organizationId, trigger) {
  await repo.closeStaleRuns().catch(() => {});
  const runId = await repo.startRun(organizationId, trigger);
  running.add(organizationId);
  try {
    return await discover(organizationId, trigger, runId);
  } catch (error) {
    await repo.finishRun(runId, { status: 'failed', notes: [String(error?.message || 'The search failed.').slice(0, 300)] }).catch(() => {});
    throw error;
  } finally {
    running.delete(organizationId);
  }
}

function utcTime(value) {
  return value ? Date.parse(`${String(value).replace(' ', 'T')}Z`) : 0;
}

export async function startDiscovery(auth, req) {
  if (!(await token(auth.organizationId))) throw new ApiError(422, 'Connect Apify in Connections, Research first.', 'apify_missing');
  if (running.has(auth.organizationId)) return suggestionList(auth);
  const last = await repo.latestRun(auth.organizationId);
  if (last?.status === 'running' && Date.now() - utcTime(last.startedAt) < 20 * 60 * 1000) return suggestionList(auth);
  if (last && Date.now() - utcTime(last.startedAt) < MANUAL_COOLDOWN_MS) {
    throw new ApiError(429, 'AIRO searched less than 30 minutes ago. Try again a little later.', 'rate_limited');
  }
  await recordAudit(req, { action: 'competitor.discovery_started', resource: 'competitor' });
  begin(auth.organizationId, 'manual').catch((error) => console.error('Competitor discovery failed:', String(error?.message || error).slice(0, 200)));
  await new Promise((resolve) => setTimeout(resolve, 300));
  return suggestionList(auth);
}

function parse(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function suggestionList(auth) {
  try {
    const [connected, run, rows] = await Promise.all([token(auth.organizationId), repo.latestRun(auth.organizationId), repo.suggestions(auth.organizationId)]);
    return {
      ready: true,
      apify: Boolean(connected),
      running: running.has(auth.organizationId) || (run?.status === 'running' && Date.now() - utcTime(run.startedAt) < 20 * 60 * 1000),
      run: run ? { ...run, plan: parse(run.plan, null), counts: parse(run.counts, null), notes: parse(run.notes, []) } : null,
      items: rows.map((row) => ({ ...row, sources: parse(row.sources, []) }))
    };
  } catch (error) {
    if (error?.cause?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_NO_SUCH_TABLE') return { ready: false, apify: false, items: [] };
    throw error;
  }
}

export async function addSuggestion(auth, req, id) {
  const row = await repo.suggestionById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Suggestion not found.', 'not_found');
  if (row.status === 'added') throw new ApiError(409, 'This one is already in your competitors.', 'conflict');
  const name = String(row.name).slice(0, 160);
  const existing = await repo.byName(auth.organizationId, name);
  const competitorId = existing?.id || await repo.create(auth.organizationId, { name, website: row.website || '', facebook: row.facebook || '', city: row.city || '' });
  await repo.setSuggestionStatus(auth.organizationId, id, 'added', competitorId);
  await recordAudit(req, { action: 'competitor.suggestion_added', resource: 'competitor', resourceId: competitorId });
  let analysing = false;
  if (row.website && !existing) {
    try {
      await analyzeCompetitor(auth, req, competitorId);
      analysing = true;
    } catch {
      analysing = false;
    }
  }
  return { competitorId, analysing, ...(await suggestionList(auth)) };
}

export async function ignoreSuggestion(auth, req, id) {
  const row = await repo.suggestionById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Suggestion not found.', 'not_found');
  await repo.setSuggestionStatus(auth.organizationId, id, row.status === 'ignored' ? 'new' : 'ignored');
  return suggestionList(auth);
}

export async function discoverDue() {
  await repo.closeStaleRuns().catch(() => {});
  const rows = await repo.dueForDiscovery(3);
  const result = { organizations: 0, suggested: 0, notes: [] };
  for (const row of rows) {
    if (running.has(row.organizationId)) continue;
    try {
      const counts = await begin(row.organizationId, 'weekly');
      result.organizations += 1;
      result.suggested += counts.suggested;
    } catch (error) {
      result.notes.push(`Org ${row.organizationId}: ${String(error?.message || 'failed').slice(0, 120)}`);
    }
  }
  return result;
}
