import { z } from 'zod';
import * as repo from '../repositories/competitorRepo.js';
import * as offeringRepo from '../repositories/offeringRepo.js';
import { googleSearch, mapsPlaces, metaKeywordAds } from '../integrations/apify.js';
import { fetchPublic, pageText } from '../integrations/webPage.js';
import { businessProfile } from './adsAgent/chatPlanner.js';
import { catalogFacts, structuredLlm } from './llmService.js';
import { sectorOf } from '../domain/sectors.js';
import { apifyToken } from './researchTools.js';
import { recordAudit } from './auditService.js';
import { analyzeCompetitor } from './competitorService.js';
import { ApiError } from '../utils/errors.js';

const MANUAL_COOLDOWN_MS = 30 * 60 * 1000;
const CHECK_TOP = 15;
export const WEEKLY_PROJECTS = 10;
const RUNS_PER_TICK = 6;
const running = new Set();
const scopeKey = (organizationId, offeringId) => `${organizationId}:${offeringId || 0}`;

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
  'realtyassistant.in', 'propsoch.com', 'anarock.com', 'roofandfloor.com', 'nobroker.com', 'housing.co.in',
  'linktr.ee', 'bit.ly', 'apple.com', 'play.google.com', 'yellowpages.in', 'asklaila.com', 'grotal.com', 'nobrokerhood.com'
];

export function domainOf(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
    return host.includes('.') ? host : '';
  } catch {
    return '';
  }
}

export function notCompetitor(domain) {
  if (!domain) return false;
  return NOT_COMPETITORS.some((item) => domain === item || domain.endsWith(`.${item}`));
}

const nameKey = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const token = () => apifyToken().catch(() => null);
const NOT_READY = 'Competitor search is not turned on yet. The AIRO team connects it on the platform.';

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
When a PROJECT TO MATCH is given, search only for what competes with that one item: the same type of thing, in its area, at a similar price. Use its location, not other areas of the business.
Never use the business's own name or its project or product names. Use only the facts given.`;

const VERDICT_BRIEF = `You check which businesses found online compete with the owner's business. Use only the facts given.
When the owner's facts name one PROJECT TO MATCH, judge against that project only: direct means the same type of thing in the same area at a similar price.
direct: sells the same kind of thing to the same kind of customer in the same area. indirect: overlapping offer or area but not the same. not_competitor: a portal, directory, agent listing site, supplier, news site, the owner's own business, or something unrelated. unclear: not enough facts.
reason: one short sentence that names the evidence (where they appeared and what their site says). name: the clean business name. city: their city if the facts show it.`;

export function planFacts({ profile, items, sector, orgName, project }) {
  const business = `Business: ${orgName || 'not set'}. Sector: ${sector || 'not set'}. Office city: ${profile?.officeCity || 'not set'}.`;
  if (project) {
    return [business, profile?.category ? `Category: ${profile.category}` : '', `PROJECT TO MATCH:\n${catalogFacts([project]).split('\n').slice(1).join('\n')}`]
      .filter(Boolean).join('\n');
  }
  return [
    business,
    profile?.category ? `Category: ${profile.category}` : '',
    profile?.offering ? `Main offering: ${profile.offering}` : '',
    Array.isArray(profile?.locations) && profile.locations.length ? `Target areas: ${profile.locations.join(', ')}` : '',
    catalogFacts(items)
  ].filter(Boolean).join('\n');
}

async function planSearch(organizationId, { profile, items, sector, orgName, project }) {
  const facts = planFacts({ profile, items, sector, orgName, project });
  try {
    const { data } = await structuredLlm({
      organizationId,
      schema: planSchema,
      system: PLAN_BRIEF,
      facts,
      task: 'Reply as JSON with searches[], adKeywords[], places[], location.',
      maxTokens: 600,
      purposes: ['competitors', 'ads', 'assistant', 'whatsapp']
    });
    return { ...data, searches: data.searches.filter(Boolean), adKeywords: data.adKeywords.filter(Boolean), places: data.places.filter(Boolean), by: 'ai' };
  } catch (error) {
    if (error?.code !== 'llm_missing') throw error;
    return fallbackPlan({ profile, sector, project });
  }
}

const STATES = /^(andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal pradesh|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi ncr|ncr|india|jammu and kashmir|ladakh|puducherry|up|mp)$/i;

// Reads the area and city out of a written address, skipping plot numbers, pin codes and states.
export function placeParts(text) {
  const parts = String(text || '').split(/[,;\n|]/)
    .map((part) => part.replace(/[–—-]?\s*\b\d{6}\b/g, '').replace(/\s+/g, ' ').trim())
    .filter((part) => part && part.length <= 40 && !/\d/.test(part) && !STATES.test(part));
  return { area: parts.length > 1 ? parts[0] : '', city: parts[parts.length - 1] || '' };
}

const KIND_WORDS = {
  residential_project: 'flats', commercial_project: 'commercial space', plots: 'plots', villa: 'villas', resale: 'resale flats', rental: 'property for rent'
};
const PLAIN_KINDS = new Set(['product', 'project', 'service', 'course', 'package', 'other']);

function kindWords(project) {
  const base = KIND_WORDS[project.kind] || (PLAIN_KINDS.has(project.kind) ? '' : String(project.kind || '').replace(/_/g, ' '));
  const bhk = `${project.name || ''} ${project.details || ''}`.match(/\b([1-6])\s?bhk\b/i);
  return bhk && (!base || base === 'flats') ? `${bhk[1]} bhk flats` : base;
}

export function fallbackPlan({ profile, sector, project }) {
  const where = placeParts(project?.locations);
  const city = String(where.city || profile?.officeCity || (Array.isArray(profile?.locations) ? profile.locations[0] : '') || '').trim().toLowerCase();
  const area = where.area.toLowerCase();
  const category = String(profile?.category || profile?.offering || sector || '').trim().toLowerCase();
  const kind = project ? kindWords(project) : '';
  const what = kind || category;
  if (!what) return null;
  const at = (place) => `${what} ${place}`.trim();
  const searches = [...new Set([area ? at(area) : '', at(city), kind && category && category !== kind ? `${category} ${city}`.trim() : ''].filter(Boolean))];
  return { searches, adKeywords: [at(city)], places: [category || what], location: city ? `${city}, India` : '', by: 'rules' };
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

// Meta advertisers score highest, so each source gets a few places before the rest is filled by score.
export function balancedTop(candidates, size = CHECK_TOP) {
  const per = Math.ceil(size / 4);
  const picked = new Set();
  for (const type of ['google_ad', 'google_search', 'maps', 'meta_ad']) {
    candidates.filter((row) => !picked.has(row) && row.sources.some((source) => source.type === type)).slice(0, per).forEach((row) => picked.add(row));
  }
  for (const row of candidates) {
    if (picked.size >= size) break;
    picked.add(row);
  }
  return candidates.filter((row) => picked.has(row)).slice(0, size);
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
    purposes: ['competitors', 'ads', 'assistant', 'whatsapp']
  });
  return new Map(data.items.map((item) => [item.id, item]));
}

const splitIds = (value) => String(value || '').split(',').map(Number).filter(Boolean);

const LOOKUP_MAX = 8;
const LOOKUP_COOLDOWN_MS = 10 * 60 * 1000;
const lookedUp = new Map();
const GENERIC_WORDS = new Set([
  'real', 'estate', 'group', 'builders', 'builder', 'homes', 'home', 'developers', 'developer', 'pvt', 'ltd', 'private', 'limited',
  'infra', 'infratech', 'properties', 'property', 'realty', 'realtors', 'realtor', 'the', 'and', 'india', 'investment', 'investments',
  'consultants', 'consultant', 'services', 'company', 'projects', 'project', 'housing', 'construction', 'constructions', 'official'
]);

// Takes a search result as their website only when every distinctive word of the name is in its domain or title.
export function websiteFor(name, results) {
  const words = nameKey(name).split(' ').filter((word) => word.length >= 3 && !GENERIC_WORDS.has(word));
  if (!words.length) return '';
  for (const row of (results || []).slice(0, 5)) {
    const domain = domainOf(row?.url);
    if (!domain || notCompetitor(domain)) continue;
    const compact = domain.replace(/[^a-z0-9]/g, '');
    const title = nameKey(row.title);
    if (words.every((word) => compact.includes(word) || title.includes(word))) return `https://${domain}`;
  }
  return '';
}

async function lookupWebsites(apiKey, rows) {
  const queries = rows.map((row) => `${row.name} ${row.city || ''}`.replace(/\s+/g, ' ').trim().slice(0, 80));
  const pages = await googleSearch(apiKey, queries).catch(() => []);
  const byQuery = new Map(pages.map((page) => [String(page?.searchQuery?.term || '').toLowerCase(), page?.organicResults || []]));
  return rows.map((row, index) => websiteFor(row.name, byQuery.get(queries[index].toLowerCase())));
}

export async function findWebsite(auth, req, id) {
  const apiKey = await token();
  if (!apiKey) throw new ApiError(422, NOT_READY, 'apify_missing');
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  if (found.website) return { website: found.website, analysing: false };
  const key = scopeKey(auth.organizationId, `c${id}`);
  if (Date.now() - (lookedUp.get(key) || 0) < LOOKUP_COOLDOWN_MS) {
    throw new ApiError(429, 'AIRO looked for this website a few minutes ago. Add it yourself with Edit, or try again in 10 minutes.', 'rate_limited');
  }
  lookedUp.set(key, Date.now());
  const [website] = await lookupWebsites(apiKey, [found]);
  if (!website) {
    throw new ApiError(422, `AIRO could not find a website that clearly belongs to ${found.name}. Add it yourself with Edit.`, 'website_not_found');
  }
  await repo.fillMissing(auth.organizationId, id, { website });
  await recordAudit(req, { action: 'competitor.website_found', resource: 'competitor', resourceId: id });
  let analysing = false;
  try {
    await analyzeCompetitor(auth, req, id);
    analysing = true;
  } catch {
    analysing = false;
  }
  return { website, analysing };
}

async function projectFor(organizationId, offeringId) {
  if (!offeringId) return null;
  const project = await offeringRepo.byId(organizationId, offeringId);
  if (!project) throw new ApiError(404, 'Product or project not found.', 'not_found');
  if (project.status === 'archived') throw new ApiError(422, 'This product or project is archived. Make it active to search its competitors.', 'validation_error');
  return project;
}

async function discover(organizationId, offeringId, runId) {
  const notes = [];
  const apiKey = await token();
  if (!apiKey) throw new ApiError(422, NOT_READY, 'apify_missing');
  const [profile, items, org, known, project] = await Promise.all([
    businessProfile(organizationId).catch(() => null),
    offeringRepo.list(organizationId, { limit: 30 }).catch(() => []),
    repo.organizationName(organizationId),
    repo.knownCompetitors(organizationId),
    projectFor(organizationId, offeringId)
  ]);
  const active = items.filter((item) => item.status !== 'archived');
  const sector = sectorOf(profile?.sector)?.label || '';
  const plan = await planSearch(organizationId, { profile, items: active, sector, orgName: org?.name, project });
  if (!plan) throw new ApiError(422, 'Add your products or projects first, so AIRO knows what to search for.', 'validation_error');

  const [google, meta, maps] = await Promise.all([
    plan.searches.length ? googleSearch(apiKey, plan.searches).catch((error) => { notes.push(`Google search: ${error.message}`); return []; }) : [],
    plan.adKeywords.length ? metaKeywordAds(apiKey, plan.adKeywords).catch((error) => { notes.push(`Meta ads: ${error.message}`); return []; }) : [],
    plan.places.length && plan.location ? mapsPlaces(apiKey, plan.places, plan.location).catch((error) => { notes.push(`Google Maps: ${error.message}`); return []; }) : []
  ]);
  if (!google.length && !meta.length && !maps.length && notes.length) throw new ApiError(502, notes.join(' '), 'apify_failed');

  const skipKnown = project ? known.filter((row) => splitIds(row.offeringIds).includes(project.id)) : known;
  const ownDomains = [...active.map((item) => domainOf(item.website)), domainOf(profile?.website)];
  const candidates = balancedTop(collectCandidates({
    google, meta, maps, ownDomains,
    knownDomains: skipKnown.map((row) => domainOf(row.website)),
    knownNames: [...skipKnown.map((row) => row.name), profile?.businessName || ''],
    orgName: org?.name
  }));

  const own = new Set(ownDomains.filter(Boolean));
  const missing = candidates.filter((row) => !row.website).slice(0, LOOKUP_MAX);
  if (missing.length) {
    const found = await lookupWebsites(apiKey, missing);
    missing.forEach((row, index) => {
      const domain = domainOf(found[index]);
      if (domain && !own.has(domain)) Object.assign(row, { website: found[index], domain });
    });
  }

  let verdicts = new Map();
  if (candidates.length) {
    const homes = await inBatches(candidates, 5, readHome);
    const owner = `OWNER: ${org?.name || 'the business'}. Sector: ${sector || 'not set'}. Office city: ${profile?.officeCity || 'not set'}.`;
    const ourFacts = project
      ? [owner, `PROJECT TO MATCH:\n${catalogFacts([project]).split('\n').slice(1).join('\n')}`].join('\n')
      : [owner, catalogFacts(active)].join('\n');
    try {
      verdicts = await judge(organizationId, { candidates, homes, ourFacts });
    } catch (error) {
      notes.push(error?.code === 'llm_missing' ? 'No AI model is connected, so matches were not checked by AI.' : `AI check failed: ${String(error.message || '').slice(0, 120)}`);
    }
  }

  let saved = 0;
  let dropped = 0;
  const keep = [];
  for (const [index, row] of candidates.entries()) {
    const verdict = verdicts.get(index + 1);
    if (verdict?.verdict === 'not_competitor') {
      dropped += 1;
      continue;
    }
    keep.push(row.key.slice(0, 200));
    await repo.saveSuggestion(organizationId, offeringId, {
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
  await repo.dropUnseenSuggestions(organizationId, offeringId, keep);
  const counts = { google: google.length, metaAds: meta.length, places: maps.length, candidates: candidates.length, suggested: saved, dropped };
  await repo.finishRun(runId, { status: 'ready', plan, counts, notes });
  return counts;
}

async function begin(organizationId, offeringId, trigger) {
  await repo.closeStaleRuns().catch(() => {});
  const key = scopeKey(organizationId, offeringId);
  const runId = await repo.startRun(organizationId, offeringId, trigger);
  running.add(key);
  try {
    return await discover(organizationId, offeringId, runId);
  } catch (error) {
    await repo.finishRun(runId, { status: 'failed', notes: [String(error?.message || 'The search failed.').slice(0, 300)] }).catch(() => {});
    throw error;
  } finally {
    running.delete(key);
  }
}

function utcTime(value) {
  return value ? Date.parse(`${String(value).replace(' ', 'T')}Z`) : 0;
}

export async function startDiscovery(auth, req, offeringId = 0) {
  if (!(await token())) throw new ApiError(422, NOT_READY, 'apify_missing');
  await projectFor(auth.organizationId, offeringId);
  if (running.has(scopeKey(auth.organizationId, offeringId))) return suggestionList(auth, offeringId);
  const last = await repo.latestRun(auth.organizationId, offeringId);
  if (last?.status === 'running' && Date.now() - utcTime(last.startedAt) < 20 * 60 * 1000) return suggestionList(auth, offeringId);
  if (last && last.status !== 'failed' && Date.now() - utcTime(last.startedAt) < MANUAL_COOLDOWN_MS) {
    throw new ApiError(429, 'AIRO searched less than 30 minutes ago. Try again a little later.', 'rate_limited');
  }
  await recordAudit(req, { action: 'competitor.discovery_started', resource: 'competitor', metadata: offeringId ? { offeringId } : undefined });
  begin(auth.organizationId, offeringId, 'manual').catch((error) => console.error('Competitor discovery failed:', String(error?.message || error).slice(0, 200)));
  await new Promise((resolve) => setTimeout(resolve, 300));
  return suggestionList(auth, offeringId);
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

// A suggestion for a project can be a business already tracked for another project; the owner then only links it.
export function trackedMatch(row, known) {
  const domain = domainOf(row.website);
  const key = nameKey(row.name);
  return known.find((item) => (domain && domainOf(item.website) === domain) || (key && nameKey(item.name) === key)) || null;
}

export async function suggestionList(auth, offeringId = 0) {
  try {
    const [connected, run, rows, known] = await Promise.all([
      token(),
      repo.latestRun(auth.organizationId, offeringId),
      repo.suggestions(auth.organizationId, offeringId),
      offeringId ? repo.knownCompetitors(auth.organizationId) : []
    ]);
    return {
      ready: true,
      apify: Boolean(connected),
      offeringId,
      running: running.has(scopeKey(auth.organizationId, offeringId)) || (run?.status === 'running' && Date.now() - utcTime(run.startedAt) < 20 * 60 * 1000),
      run: run ? { ...run, plan: parse(run.plan, null), counts: parse(run.counts, null), notes: parse(run.notes, []) } : null,
      items: rows.map((row) => {
        const tracked = row.status === 'new' ? trackedMatch(row, known) : null;
        return { ...row, sources: parse(row.sources, []), trackedId: tracked?.id || null };
      })
    };
  } catch (error) {
    if (error?.cause?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_NO_SUCH_TABLE' || error?.cause?.code === 'ER_BAD_FIELD_ERROR') return { ready: false, apify: false, items: [] };
    throw error;
  }
}

export async function addSuggestion(auth, req, id) {
  const row = await repo.suggestionById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Suggestion not found.', 'not_found');
  if (row.status === 'added') throw new ApiError(409, 'This one is already in your competitors.', 'conflict');
  const offeringId = Number(row.offeringId) || 0;
  const name = String(row.name).slice(0, 160);
  const known = await repo.knownCompetitors(auth.organizationId);
  const existing = (await repo.byName(auth.organizationId, name)) || trackedMatch(row, known);
  const competitorId = existing?.id || await repo.create(auth.organizationId, { name, website: row.website || '', facebook: row.facebook || '', city: row.city || '' });
  if (existing) await repo.fillMissing(auth.organizationId, competitorId, { website: row.website, facebook: row.facebook, city: row.city });
  if (offeringId) await repo.linkOffering(auth.organizationId, competitorId, offeringId);
  await repo.setSuggestionStatus(auth.organizationId, id, 'added', competitorId);
  await recordAudit(req, {
    action: existing ? 'competitor.suggestion_linked' : 'competitor.suggestion_added',
    resource: 'competitor',
    resourceId: competitorId,
    metadata: offeringId ? { offeringId } : undefined
  });
  let analysing = false;
  const current = await repo.byId(auth.organizationId, competitorId);
  if (current?.website && (!existing || offeringId)) {
    try {
      await analyzeCompetitor(auth, req, competitorId);
      analysing = true;
    } catch {
      analysing = false;
    }
  }
  const findingWebsite = Boolean(current && !current.website);
  if (findingWebsite) findWebsite(auth, req, competitorId).catch(() => {});
  return { competitorId, linked: Boolean(existing), analysing, hasWebsite: Boolean(current?.website), findingWebsite, ...(await suggestionList(auth, offeringId)) };
}

export async function ignoreSuggestion(auth, req, id) {
  const row = await repo.suggestionById(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Suggestion not found.', 'not_found');
  await repo.setSuggestionStatus(auth.organizationId, id, row.status === 'ignored' ? 'new' : 'ignored');
  return suggestionList(auth, Number(row.offeringId) || 0);
}

// Business-wide searches first, then each business's most used active projects, capped per business.
export function dueScopes({ businesses = [], projects = [], cap = WEEKLY_PROJECTS, limit = RUNS_PER_TICK }) {
  const perOrg = new Map();
  const due = [...businesses.map((row) => ({ organizationId: Number(row.organizationId), offeringId: 0 }))];
  for (const row of projects) {
    const org = Number(row.organizationId);
    const rank = (perOrg.get(org) || 0) + 1;
    perOrg.set(org, rank);
    if (rank <= cap && !Number(row.searchedRecently)) due.push({ organizationId: org, offeringId: Number(row.offeringId) });
  }
  return due.slice(0, limit);
}

// Searches run inside this process, so any still marked running at start-up were cut off by a restart.
export function closeInterruptedSearches() {
  return repo.closeInterruptedRuns().catch(() => {});
}

export async function discoverDue() {
  const result = { searches: 0, suggested: 0, notes: [] };
  if (!(await token())) return result;
  await repo.closeStaleRuns().catch(() => {});
  const [businesses, projects] = await Promise.all([repo.businessesDue(), repo.activeProjects()]);
  for (const scope of dueScopes({ businesses, projects })) {
    if (running.has(scopeKey(scope.organizationId, scope.offeringId))) continue;
    try {
      const counts = await begin(scope.organizationId, scope.offeringId, 'weekly');
      result.searches += 1;
      result.suggested += counts.suggested;
    } catch (error) {
      result.notes.push(`Org ${scope.organizationId}${scope.offeringId ? ` project ${scope.offeringId}` : ''}: ${String(error?.message || 'failed').slice(0, 120)}`);
    }
  }
  return result;
}
