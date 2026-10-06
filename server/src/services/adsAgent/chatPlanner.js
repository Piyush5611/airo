import { z } from 'zod';
import { googleKeywordIdeas, suggestGoogleLocations } from '../../integrations/googleAds.js';
import { listMetaBehaviors, searchMetaAudience } from '../../integrations/metaAds.js';
import * as repo from '../../repositories/adsAgentRepo.js';
import { organizationSector } from '../../repositories/workspaceRepo.js';
import { sectorFacts } from '../../domain/sectors.js';
import { structuredLlm } from '../llmService.js';

const text = (min, max) => z.string().trim().min(min).max(max);

const suggestionSchema = z.object({
  cities: z.array(text(2, 40)).min(1).max(6),
  ageMin: z.coerce.number().int().min(18).max(65),
  ageMax: z.coerce.number().int().min(18).max(65),
  gender: z.enum(['all', 'men', 'women']).default('all'),
  interestSeeds: z.array(text(2, 40)).max(12).default([]),
  keywordSeeds: z.array(text(2, 60)).max(10).default([]),
  negatives: z.array(text(2, 40)).max(20).default([]),
  sellingPoints: z.array(text(3, 90)).max(5).default([]),
  why: text(0, 300).default('')
}).refine((value) => value.ageMin <= value.ageMax, { message: 'ageMin must not be above ageMax', path: ['ageMin'] });

const SUGGEST_BRIEF = `You are a senior performance marketer in India planning one ad for a small business.
From the facts, suggest targeting the owner can accept or change:
- cities: 2 to 6 Indian cities or localities where likely buyers are. Start with the business city if the facts give one. For local services (clinic, salon, coaching, restaurant, shop) stay in that city and nearby areas. For real estate include the project city and nearby cities buyers move from.
- ageMin / ageMax / gender: the likely buyer. Use all genders unless the product is clearly for one.
- interestSeeds: 8 to 12 short Meta interest topics that BUYERS follow, not sellers or workers in the field. Mix:
  1) the core topic (Real estate, Dentistry, Fitness),
  2) the buying need around it (Home loans, Mortgage loans, Property finder, Teeth whitening, Weight loss),
  3) well-known Indian platforms or brands buyers use (99acres, MagicBricks, Housing.com, NoBroker, Practo, Cult.fit) only when you are sure they exist,
  4) lifestyle signals of the buyer (Interior design, Home appliances, Luxury goods for premium products).
  Avoid topics that bring agents, job seekers or students (Property management, Real estate agent, Real estate license).
- keywordSeeds: up to 10 buyer-intent Google searches in English (examples: "2bhk flats in noida", "dentist near me", "best coaching for neet in kota"). Mix product + city, "near me", price and "best" searches.
- negatives: up to 20 single words or short phrases that bring non-buyers (examples: jobs, salary, free, pdf, course, internship, rent when the business sells, second hand when it sells new).
- sellingPoints: up to 5 short selling points taken ONLY from the facts. Never invent prices, offers, awards, years or ratings. Empty list if the facts have none.
- why: one sentence on the reasoning.`;

const googleCopySchema = z.object({
  strategy: text(10, 400),
  headlines: z.array(text(3, 30)).min(10).max(15),
  descriptions: z.array(text(20, 90)).min(3).max(4),
  path1: text(0, 15).default(''),
  path2: text(0, 15).default(''),
  keywords: z.array(z.object({ text: text(2, 80), matchType: z.enum(['EXACT', 'PHRASE', 'BROAD']) })).min(5).max(20),
  negatives: z.array(text(2, 40)).max(25).default([])
}).superRefine((value, ctx) => {
  if (new Set(value.headlines.map((item) => item.toLowerCase())).size !== value.headlines.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['headlines'], message: 'Headlines must all be different.' });
  }
});

const GOOGLE_COPY_BRIEF = `You write one Google responsive search ad for an Indian business, like an expert Google Ads copywriter.
Use only the facts. Never invent prices, offers, discounts, awards, ratings, years, phone numbers or claims.
Headlines (10 to 15, each 30 characters or fewer, all different, no exclamation marks, no ALL CAPS words):
- at least 3 contain the main keyword, at least 2 contain the city, 2 are clear calls to action (Book a Site Visit, Get a Free Quote only if free is in the facts, Call Today, Enquire Now),
- the rest use the selling points from the facts, one each. No filler like "Visit Our Website" or "Contact Us Now".
Descriptions (3 or 4, each 90 characters or fewer): benefit + proof from the facts + a call to action.
path1/path2: short URL path words like "2bhk" / "noida".
keywords: choose 8 to 20 ONLY from the keyword ideas list in the facts (copy the text exactly). Prefer buyer intent and higher searches. Drop jobs, free, courses, rentals when selling, competitor brands and unrelated ideas. Use PHRASE for most, EXACT for the 3 strongest.
negatives: words that bring non-buyers for this business.
strategy: two sentences on who searches and why these keywords.
If the facts include an owner idea, follow it within these rules.`;

const metaCopySchema = z.object({
  strategy: text(10, 400),
  variants: z.array(z.object({ angle: text(2, 40), headline: text(5, 40), primaryText: text(40, 300) })).min(2).max(3),
  cta: z.enum(['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'BOOK_NOW']).optional(),
  tips: z.array(text(10, 200)).max(4).default([])
});

const META_COPY_BRIEF = `You write Meta (Facebook and Instagram) image ad copy for an Indian business, like an expert direct-response copywriter.
Use only the facts and the public ads list. Never invent prices, offers, discounts, awards, ratings, years or guarantees.
Write 3 variants, each with a clearly different angle, chosen for this buyer:
- pain or need (problem the buyer has, then the fix),
- proof or value (price, size, location or other hard facts from the facts),
- desire or lifestyle (how life looks after buying),
- urgency only if the facts give a real reason (limited units, launch, offer end date).
Put the angle name in "angle". If public ads from others are listed, do not copy them; make ours more specific than theirs.
headline: under 40 characters, specific, with the product and the city or a hard fact. No ALL CAPS, no exclamation marks, no emojis, no clickbait.
primaryText: 2 or 3 short lines, 120 to 280 characters. Line 1 is a hook the buyer recognises (a question or a sharp fact). Then 1 or 2 selling points from the facts. End with one call to action that matches the objective (site visit, WhatsApp/Messenger chat, form, order).
Write in the language the facts ask for (English or Hinglish in English letters, never Hindi script). Simple words a local buyer uses.
If the special category is HOUSING, CREDIT or EMPLOYMENT, do not mention age, gender, family status or religion.
strategy: two sentences on who this targets and why these angles.
tips: 2 to 4 practical suggestions for the owner to get better results with THIS ad, based on the facts. For example: a missing detail that would make the ad stronger (price, possession date, offer), whether a lead form or Messenger suits the goal, a real photo idea for the creative, when to judge the A/B test. Never promise results or invent numbers.`;

function profileLines(profile) {
  if (!profile) return [];
  const list = (value) => (Array.isArray(value) && value.length ? value.join(', ') : '');
  return [
    profile.businessName ? `Business name: ${profile.businessName}` : '',
    profile.category ? `Business category: ${profile.category}` : '',
    profile.offering ? `What it sells: ${profile.offering}` : '',
    list(profile.locations) ? `Business locations: ${list(profile.locations)}` : '',
    profile.audience ? `Audience: ${profile.audience}` : '',
    list(profile.usps) ? `Selling points: ${list(profile.usps)}` : '',
    profile.priceMin || profile.priceMax ? `Price range: ${profile.priceMin || '?'} to ${profile.priceMax || '?'} ${profile.currency || ''}`.trim() : '',
    list(profile.competitors) ? `Competitors: ${list(profile.competitors)}` : '',
    profile.notes ? `Notes: ${profile.notes}` : '',
    ...sectorFacts(profile.sector)
  ].filter(Boolean);
}

export async function businessProfile(organizationId) {
  const sector = await organizationSector(organizationId);
  let profile = null;
  try {
    const row = await repo.profile(organizationId);
    if (row?.profile) profile = typeof row.profile === 'object' ? row.profile : JSON.parse(row.profile);
  } catch {
    profile = null;
  }
  if (!profile && !sector) return null;
  return { ...(profile || {}), sector };
}

export function hasProfileDetails(profile) {
  return Boolean(profile && ((profile.usps || []).length || profile.offering || profile.priceMin || profile.priceMax));
}

export function intakeFacts(payload, profile) {
  return [
    ...profileLines(profile),
    payload.category ? `Ad category: ${payload.category}` : '',
    payload.product ? `Product or service to advertise: ${payload.product}` : '',
    payload.details ? `Owner's details (price, offer, selling points): ${payload.details}` : '',
    payload.website ? `Website: ${payload.website}` : 'Website: none',
    payload.region ? `Target locations: ${payload.region}` : '',
    payload.dailyBudget ? `Daily budget: ${payload.dailyBudget}${payload.currency ? ` ${payload.currency}` : ''}` : '',
    payload.objectiveLabel ? `Objective: ${payload.objectiveLabel}` : '',
    payload.idea ? `Owner idea: ${payload.idea}` : ''
  ].filter(Boolean);
}

export async function suggestTargeting({ organizationId, payload, profile, platform }) {
  try {
    const { data } = await structuredLlm({
      organizationId,
      schema: suggestionSchema,
      system: SUGGEST_BRIEF,
      facts: [`Platform: ${platform === 'google' ? 'Google Search' : 'Meta (Facebook and Instagram)'}`, ...intakeFacts(payload, profile)].join('\n'),
      task: 'Suggest the targeting as JSON: {"cities":[],"ageMin":25,"ageMax":55,"gender":"all","interestSeeds":[],"keywordSeeds":[],"negatives":[],"sellingPoints":[],"why":""}',
      maxTokens: 1500
    });
    return data;
  } catch {
    return null;
  }
}

function sameName(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function chosenNames(textValue, suggested = []) {
  const value = String(textValue || '').trim();
  if (/^(ok|okay|yes|haan|han|theek|thik|sab|all suggested|suggested)\b/i.test(value) && suggested.length) return suggested.slice();
  const numbers = value.match(/^\s*\d+(\s*[, ]\s*\d+)*\s*$/) ? value.split(/[\s,]+/).map(Number) : [];
  if (numbers.length) return [...new Set(numbers)].map((n) => suggested[n - 1]).filter(Boolean);
  return [...new Set(value.split(/,|\n| and | aur /i).map((item) => item.trim()).filter((item) => item.length >= 2))].slice(0, 8);
}

export async function resolveMetaCities(apiKey, names) {
  const found = [];
  const missing = [];
  for (const name of names) {
    let rows = [];
    try { rows = await searchMetaAudience({ apiKey, kind: 'city', query: name }); } catch { rows = []; }
    const picked = rows.find((row) => sameName(row.name, name)) || rows[0];
    if (picked && !found.some((item) => item.key === picked.key)) {
      found.push({ key: picked.key, name: picked.name, region: picked.region || '', radiusMode: 'city' });
    } else if (!picked) {
      missing.push(name);
    }
  }
  return { found, missing };
}

export async function resolveGoogleLocations(refreshToken, names) {
  const found = [];
  const missing = [];
  for (const name of names) {
    let rows = [];
    try { rows = await suggestGoogleLocations({ refreshToken, query: name }); } catch { rows = []; }
    const picked = rows.find((row) => row.name.toLowerCase().startsWith(name.toLowerCase())) || rows[0];
    if (picked && !found.some((item) => item.id === picked.id)) found.push({ id: picked.id, name: picked.name });
    else if (!picked) missing.push(name);
  }
  return { found, missing };
}

const OFF_TOPIC = /\((band|film|movie|tv series|tv show|tv program|song|album|musician|singer|video game|game|magazine|novel|book|play|soundtrack)\)/i;
const MIN_AUDIENCE = 50000;

export function usableInterest(row) {
  if (!row?.id || !row.name) return false;
  if (OFF_TOPIC.test(`${row.name} ${row.path || ''}`)) return false;
  if (row.sizeHigh != null && row.sizeHigh < MIN_AUDIENCE) return false;
  return true;
}

export async function resolveMetaInterests(apiKey, seeds) {
  const found = [];
  for (const seed of seeds.slice(0, 8)) {
    let rows = [];
    try { rows = await searchMetaAudience({ apiKey, kind: 'interest', query: seed }); } catch { rows = []; }
    const clean = rows.filter(usableInterest);
    const picked = clean.find((row) => sameName(row.name, seed)) || clean[0];
    if (picked && !found.some((item) => item.id === picked.id)) found.push(picked);
    if (found.length >= 6) break;
  }
  return found;
}

async function interestPool(apiKey, seeds) {
  const pool = new Map();
  const lists = await Promise.all(seeds.slice(0, 12).map((seed) => searchMetaAudience({ apiKey, kind: 'interest', query: seed }).catch(() => [])));
  for (const rows of lists) {
    for (const row of rows.filter(usableInterest)) if (!pool.has(row.id)) pool.set(row.id, row);
  }
  return [...pool.values()].slice(0, 70);
}

function sizeText(row) {
  if (!row.sizeLow && !row.sizeHigh) return 'size unknown';
  return `${Math.round((row.sizeLow || 0) / 1000)}k-${Math.round((row.sizeHigh || 0) / 1000)}k people`;
}

const audienceSchema = z.object({
  interests: z.array(z.object({ id: text(1, 20), why: text(3, 120) })).min(1).max(8),
  behaviors: z.array(z.object({ id: text(1, 20), why: text(3, 120) })).max(3).default([]),
  note: text(0, 300).default('')
});

const AUDIENCE_BRIEF = `You pick Meta detailed targeting for one Indian ad, like a senior media buyer.
Choose ONLY from the candidate lists in the facts and copy the id exactly.
- interests: 4 to 8 that the likely BUYER follows. Prefer the buying need, platforms buyers use and close lifestyle signals.
  Drop anything that brings sellers, agents, job seekers, students, hobby fans or another meaning of the word (a band, film, game or team with the same name).
  Drop very small topics and near-duplicates of each other.
- behaviors: 0 to 3 only when they clearly fit the buyer (for example frequent travellers or technology early adopters for premium homes). Usually none for local services.
- why: a short reason per pick in the language of the facts.
- note: one sentence on the audience logic.
With Advantage+ audience on, these are suggestions Meta can widen, so relevance matters more than size.`;

export async function pickMetaAudience({ organizationId, apiKey, payload, profile, seeds, english }) {
  const pool = await interestPool(apiKey, seeds);
  let behaviors = [];
  try { behaviors = (await listMetaBehaviors({ apiKey })).slice(0, 80); } catch { behaviors = []; }
  if (!pool.length) return { interests: [], behaviors: [], note: '' };
  try {
    const { data } = await structuredLlm({
      organizationId,
      schema: audienceSchema,
      system: AUDIENCE_BRIEF,
      facts: [
        `Language: ${english ? 'English' : 'Hinglish'}`,
        ...intakeFacts(payload, profile),
        `Interest candidates (id · name · category path · size):\n${pool.map((row) => `- ${row.id} · ${row.name} · ${row.path || row.topic || '-'} · ${sizeText(row)}`).join('\n')}`,
        behaviors.length ? `Behavior candidates (id · name · path):\n${behaviors.map((row) => `- ${row.id} · ${row.name} · ${row.path || '-'}`).join('\n')}` : 'Behavior candidates: none'
      ].join('\n'),
      task: 'Pick the targeting as JSON: {"interests":[{"id":"","why":""}],"behaviors":[{"id":"","why":""}],"note":""}',
      maxTokens: 1500
    });
    const byId = new Map(pool.map((row) => [row.id, row]));
    const behaviorById = new Map(behaviors.map((row) => [row.id, row]));
    const interests = [...new Map(data.interests.filter((item) => byId.has(item.id)).map((item) => [item.id, { ...byId.get(item.id), why: item.why }])).values()];
    const chosenBehaviors = [...new Map(data.behaviors.filter((item) => behaviorById.has(item.id)).map((item) => [item.id, { ...behaviorById.get(item.id), why: item.why }])).values()];
    if (interests.length) return { interests, behaviors: chosenBehaviors, note: data.note };
  } catch {
    // Falls back to the closest name match below.
  }
  const fallback = await resolveMetaInterests(apiKey, seeds);
  return { interests: fallback, behaviors: [], note: '' };
}

export async function keywordCandidates(input, { seeds, website, locations }) {
  const unique = [...new Set(seeds.map((item) => String(item).trim().toLowerCase()).filter(Boolean))].slice(0, 10);
  let ideas = [];
  try {
    ideas = await googleKeywordIdeas(input, { seeds: unique, url: website, locations });
  } catch {
    ideas = [];
  }
  const map = new Map();
  for (const idea of ideas) map.set(idea.text.toLowerCase(), { text: idea.text.toLowerCase(), searches: idea.searches == null ? null : Number(idea.searches), competition: idea.competition });
  for (const seed of unique) if (!map.has(seed)) map.set(seed, { text: seed, searches: null, competition: '' });
  return [...map.values()].sort((a, b) => (b.searches || 0) - (a.searches || 0)).slice(0, 40);
}

export async function writeGoogleCopy({ organizationId, payload, profile, candidates }) {
  const facts = [
    ...intakeFacts(payload, profile),
    payload.sellingPoints?.length ? `Selling points: ${payload.sellingPoints.join('; ')}` : '',
    `Keyword ideas (text · monthly searches):\n${candidates.map((item) => `- ${item.text} · ${item.searches ?? 'unknown'}`).join('\n')}`
  ].filter(Boolean).join('\n');
  const { data } = await structuredLlm({
    organizationId,
    schema: googleCopySchema,
    system: GOOGLE_COPY_BRIEF,
    facts,
    task: 'Write the Google Search ad as JSON: {"strategy":"","headlines":[],"descriptions":[],"path1":"","path2":"","keywords":[{"text":"","matchType":"PHRASE"}],"negatives":[]}',
    maxTokens: 3000
  });
  const allowed = new Map(candidates.map((item) => [item.text, item]));
  const keywords = [];
  for (const item of data.keywords) {
    const key = item.text.trim().toLowerCase();
    if (allowed.has(key) && !keywords.some((row) => row.text === key)) keywords.push({ text: key, matchType: item.matchType, searches: allowed.get(key).searches });
  }
  for (const item of candidates) {
    if (keywords.length >= 8) break;
    if (!keywords.some((row) => row.text === item.text)) keywords.push({ text: item.text, matchType: 'PHRASE', searches: item.searches });
  }
  return { ...data, keywords: keywords.slice(0, 20), negatives: [...new Set([...(payload.negatives || []), ...data.negatives].map((item) => item.toLowerCase()))].slice(0, 30) };
}

export async function writeMetaCopy({ organizationId, payload, profile, publicAds, english }) {
  const facts = [
    `Language: ${english ? 'English' : 'Hinglish'}`,
    ...intakeFacts(payload, profile),
    payload.sellingPoints?.length ? `Selling points: ${payload.sellingPoints.join('; ')}` : '',
    `Special category: ${payload.specialCategory || 'none'}`,
    payload.interests?.length ? `Audience interests chosen: ${payload.interests.map((item) => item.name).join(', ')}` : '',
    payload.objectiveLabel ? `Where leads go: ${payload.conversion === 'messenger' ? 'Messenger chat (no website)' : payload.conversion === 'instant_form' ? 'Meta instant form' : 'website'}` : '',
    publicAds?.length ? `Public ads from others:\n${publicAds.map((ad) => `- ${[ad.page, ad.title, ad.text].filter(Boolean).join(' · ')}`).join('\n')}` : 'Public ads: none returned.'
  ].filter(Boolean).join('\n');
  const { data } = await structuredLlm({
    organizationId,
    schema: metaCopySchema,
    system: META_COPY_BRIEF,
    facts,
    task: 'Write the Meta ad as JSON: {"strategy":"","variants":[{"angle":"","headline":"","primaryText":""}],"cta":"LEARN_MORE","tips":[]}',
    maxTokens: 2500
  });
  return data;
}
