import { z } from 'zod';
import * as repo from '../repositories/competitorRepo.js';
import * as offeringRepo from '../repositories/offeringRepo.js';
import { fetchPublic, pageText, pricesIn, samePageLinks } from '../integrations/webPage.js';
import { googleKeywordIdeas } from '../integrations/googleAds.js';
import { googleAccount } from './googleAdChat.js';
import { businessProfile } from './adsAgent/chatPlanner.js';
import { catalogFacts, structuredLlm } from './llmService.js';
import { organizationSector } from '../repositories/workspaceRepo.js';
import { sectorOf } from '../domain/sectors.js';
import { recordAudit } from './auditService.js';
import { ApiError } from '../utils/errors.js';

const HOME_BYTES = 2 * 1024 * 1024;
const PAGE_BYTES = 1536 * 1024;
const EXTRA_PAGES = 5;
const PAGE_TEXT = 2600;
const COOLDOWN_MS = 5 * 60 * 1000;
const running = new Map();

const text = (max) => z.preprocess((value) => (value == null ? '' : String(value)), z.string())
  .transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, max));
const list = (item, max) => z.preprocess((value) => (Array.isArray(value) ? value.slice(0, max) : []), z.array(item));

export const analysisSchema = z.object({
  summary: text(700),
  positioning: text(300),
  audience: text(300),
  priceRange: text(120),
  offerings: list(z.object({
    name: text(120),
    type: text(40),
    location: text(120),
    price: text(80),
    offer: text(160),
    highlights: list(text(100), 6),
    source: text(500)
  }), 12),
  strengths: list(text(220), 6),
  weaknesses: list(text(220), 6),
  messaging: list(text(160), 6),
  leadCapture: list(text(120), 6),
  comparison: list(z.object({
    ours: text(120),
    theirs: text(120),
    verdict: z.preprocess((value) => String(value || '').toLowerCase(), z.enum(['we_lead', 'they_lead', 'even', 'unclear']).catch('unclear')),
    note: text(260)
  }), 8),
  actions: list(z.object({ title: text(120), detail: text(320) }), 6),
  threat: z.preprocess((value) => String(value || '').toLowerCase(), z.enum(['high', 'medium', 'low', 'unknown']).catch('unknown')),
  threatWhy: text(260),
  gaps: list(text(200), 6)
}).refine((value) => value.summary.length > 10, { message: 'summary is required', path: ['summary'] });

const BRIEF = `You are AIRO's competitor analyst for an Indian business. You study one competitor and compare it with the owner's business.
Use only the facts in this message: the competitor's own web pages (text, headings, prices seen) and Google keyword data if present.
Never invent prices, project or product names, locations, offers, ratings, ad spend, traffic, review counts or anything else. If something is not in the facts, leave the field empty and say it in gaps.
offerings: what the competitor sells as seen on their pages. Every item needs source = the exact page URL where it was seen.
messaging: the main claims or themes their website pushes (for example "ready to move", "no brokerage", "EMI from").
leadCapture: how they collect enquiries as seen on the pages (enquiry form, WhatsApp button, call button, site visit booking, brochure download).
comparison: compare with the owner's saved items only where both sides have a comparable item. verdict is we_lead, they_lead, even or unclear, judged only on what both sides state (price, location, offer, highlights).
actions: up to 6 practical steps for the owner, each tied to something seen in the facts (an offer to match, a message to answer, a gap to use).
threat: high if they sell similar things in the same area at a similar or better price or offer, low if they clearly serve a different market, unknown if the facts are too thin. threatWhy says why in one sentence.
Write in simple English.`;

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function bodyRow(body) {
  return {
    name: String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 160),
    website: cleanUrl(body.website).slice(0, 500),
    facebook: cleanUrl(body.facebook).slice(0, 300),
    instagram: String(body.instagram || '').trim().replace(/^@/, '').slice(0, 120),
    city: String(body.city || '').trim().slice(0, 120),
    notes: String(body.notes || '').trim().slice(0, 1000),
    status: body.status === 'archived' ? 'archived' : 'active'
  };
}

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function missingTable(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE' || code === 'ER_BAD_FIELD_ERROR';
}

const idList = (value) => String(value || '').split(',').map(Number).filter(Boolean);

async function saveLinks(auth, id, offeringIds) {
  if (!Array.isArray(offeringIds)) return;
  await repo.setOfferings(auth.organizationId, id, [...new Set(offeringIds.map(Number).filter(Boolean))].slice(0, 50));
}

export async function listCompetitors(auth) {
  try {
    const items = await repo.list(auth.organizationId);
    return { ready: true, items: items.map((row) => ({ ...row, offeringIds: idList(row.offeringIds), running: running.has(row.id) })) };
  } catch (error) {
    if (missingTable(error)) return { ready: false, items: [], note: 'Run npm run migrate to set up competitors.' };
    throw error;
  }
}

export async function competitorDetail(auth, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  const [report, history] = await Promise.all([repo.latestReport(auth.organizationId, id), repo.reportHistory(auth.organizationId, id)]);
  return {
    ...found,
    offeringIds: idList(found.offeringIds),
    running: running.has(found.id),
    report: report ? {
      ...report,
      website: parseJson(report.website),
      keywords: parseJson(report.keywords),
      analysis: parseJson(report.analysis),
      notes: parseJson(report.notes) || []
    } : null,
    history
  };
}

export async function createCompetitor(auth, req) {
  const row = bodyRow(req.body);
  if (await repo.byName(auth.organizationId, row.name)) throw new ApiError(409, 'A competitor with this name is already saved.', 'conflict');
  const id = await repo.create(auth.organizationId, row);
  await saveLinks(auth, id, req.body.offeringIds);
  await recordAudit(req, { action: 'competitor.created', resource: 'competitor', resourceId: id });
  return competitorDetail(auth, id);
}

export async function updateCompetitor(auth, req, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  const row = bodyRow(req.body);
  const clash = await repo.byName(auth.organizationId, row.name);
  if (clash && clash.id !== found.id) throw new ApiError(409, 'A competitor with this name is already saved.', 'conflict');
  await repo.update(auth.organizationId, id, row);
  await saveLinks(auth, id, req.body.offeringIds);
  await recordAudit(req, { action: 'competitor.updated', resource: 'competitor', resourceId: id });
  return competitorDetail(auth, id);
}

export async function deleteCompetitor(auth, req, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  await repo.remove(auth.organizationId, id);
  await recordAudit(req, { action: 'competitor.deleted', resource: 'competitor', resourceId: id });
  return listCompetitors(auth);
}

export async function importFromProfile(auth, req) {
  const profile = await businessProfile(auth.organizationId);
  const names = Array.isArray(profile?.competitors) ? profile.competitors : [];
  let added = 0;
  for (const raw of names.slice(0, 15)) {
    const value = String(raw || '').trim();
    const domain = value.match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0] || '';
    const name = value.replace(/https?:\/\//i, '').replace(domain, '').replace(/[()\-|,]+/g, ' ').replace(/\s+/g, ' ').trim() || domain;
    if (name.length < 2 || await repo.byName(auth.organizationId, name.slice(0, 160))) continue;
    await repo.create(auth.organizationId, { name: name.slice(0, 160), website: domain ? `https://${domain}` : '' });
    added += 1;
  }
  if (added) await recordAudit(req, { action: 'competitor.imported', resource: 'competitor', metadata: { added } });
  return { added, found: names.length, ...(await listCompetitors(auth)) };
}

async function readSite(website, notes) {
  const home = await fetchPublic(website, HOME_BYTES);
  if (home.blocked) {
    notes.push('The website link cannot be read. Use the public https link.');
    return [];
  }
  if (home.body == null) {
    notes.push(`The website did not open${home.status ? ` (it answered ${home.status})` : ''}.`);
    return [];
  }
  const links = samePageLinks(home.body, home.url, EXTRA_PAGES);
  const extra = await Promise.all(links.map(async (link) => ({ link, page: await fetchPublic(link, PAGE_BYTES) })));
  const pages = [{ url: home.url.toString(), html: home.body }];
  for (const { link, page } of extra) if (page.body) pages.push({ url: page.url?.toString() || link, html: page.body });
  const read = pages.map((page) => {
    const parsed = pageText(page.html);
    return { url: page.url, ...parsed, prices: pricesIn(parsed.text) };
  });
  if (read.every((page) => page.text.length < 200)) {
    notes.push('The pages had very little readable text. The site may load its content with JavaScript, which AIRO does not run yet.');
  }
  return read;
}

async function readKeywords(organizationId, competitor, notes) {
  const account = await googleAccount(organizationId).catch(() => null);
  if (!account) {
    notes.push('Google Ads is not connected, so search demand for this competitor was not checked.');
    return null;
  }
  try {
    const ideas = await googleKeywordIdeas(account.input, { seeds: [competitor.name, competitor.city ? `${competitor.name} ${competitor.city}` : ''].filter(Boolean), url: competitor.website });
    const rows = ideas
      .filter((row) => row.searches != null)
      .sort((a, b) => Number(b.searches) - Number(a.searches))
      .slice(0, 15);
    return { currency: account.input.currency || '', rows };
  } catch (error) {
    notes.push(/explorer access|basic or standard access/i.test(String(error?.message || ''))
      ? 'Search demand is empty because Google Keyword Planner needs Basic access on the AIRO Google Ads developer token. The rest of the report is not affected.'
      : `Google Keyword Planner did not answer: ${String(error?.message || 'unknown error').slice(0, 160)}`);
    return null;
  }
}

export function analysisFacts({ competitor, pages, keywords, ours, sector }) {
  let budget = 15000;
  const pageLines = [];
  for (const page of pages) {
    const body = page.text.slice(0, Math.min(PAGE_TEXT, Math.max(0, budget)));
    budget -= body.length;
    pageLines.push([
      `PAGE ${page.url}`,
      page.title ? `Title: ${page.title}` : '',
      page.description ? `Description: ${page.description}` : '',
      page.headings.length ? `Headings: ${page.headings.slice(0, 15).join(' / ')}` : '',
      page.prices.length ? `Prices seen: ${page.prices.join(', ')}` : '',
      body ? `Text: ${body}` : ''
    ].filter(Boolean).join('\n'));
  }
  return [
    `Owner's business sector: ${sector || 'not set'}.`,
    ours,
    '',
    `COMPETITOR: ${competitor.name}${competitor.city ? ` (${competitor.city})` : ''}`,
    competitor.website ? `Website: ${competitor.website}` : '',
    competitor.notes ? `Owner's notes about them: ${competitor.notes}` : '',
    '',
    pageLines.length ? pageLines.join('\n\n') : 'No page of their website could be read.',
    '',
    keywords?.rows?.length
      ? `Google keyword data (India, monthly searches, competition):\n${keywords.rows.map((row) => `${row.text}: ${row.searches}/mo, ${row.competition || 'n/a'}`).join('\n')}`
      : 'No Google keyword data.'
  ].filter((line) => line !== null).join('\n');
}

async function runAnalysis(organizationId, competitor) {
  const notes = [];
  const pages = competitor.website ? await readSite(competitor.website, notes) : [];
  const keywords = await readKeywords(organizationId, competitor, notes);
  const website = { pages: pages.map((page) => ({ url: page.url, title: page.title, description: page.description, headings: page.headings.slice(0, 10), prices: page.prices })) };
  if (!pages.length) {
    await repo.addReport({ organizationId, competitorId: competitor.id, status: 'failed', website, keywords, notes });
    return;
  }
  const [items, linked, sectorKey] = await Promise.all([
    offeringRepo.list(organizationId, { limit: 30 }).catch(() => []),
    repo.linkedOfferings(organizationId, competitor.id).catch(() => []),
    organizationSector(organizationId)
  ]);
  const ours = linked.length
    ? `The owner tracks this competitor against these of its own items only; compare with these:\n${catalogFacts(linked)}`
    : catalogFacts(items);
  const facts = analysisFacts({ competitor, pages, keywords, ours, sector: sectorOf(sectorKey)?.label || '' });
  try {
    const { data, model } = await structuredLlm({
      organizationId,
      schema: analysisSchema,
      system: BRIEF,
      facts,
      task: 'Analyse this competitor and reply as JSON with: summary, positioning, audience, priceRange, offerings[{name,type,location,price,offer,highlights[],source}], strengths[], weaknesses[], messaging[], leadCapture[], comparison[{ours,theirs,verdict,note}], actions[{title,detail}], threat, threatWhy, gaps[].',
      maxTokens: 3500,
      purposes: ['competitors', 'ads', 'assistant']
    });
    const seen = new Set(pages.map((page) => page.url));
    data.offerings = data.offerings.filter((item) => item.name).map((item) => ({ ...item, source: seen.has(item.source) ? item.source : '' }));
    await repo.addReport({ organizationId, competitorId: competitor.id, status: 'ready', website, keywords, analysis: data, notes, model });
  } catch (error) {
    notes.push(error?.code === 'llm_missing' ? 'No AI model is connected. Connect one on Platform AI (Competitor research, Ad writing or Workspace assistant).' : `The AI analysis failed: ${String(error?.message || 'unknown error').slice(0, 160)}`);
    await repo.addReport({ organizationId, competitorId: competitor.id, status: 'failed', website, keywords, notes });
  }
}

export async function analyzeCompetitor(auth, req, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  if (!found.website) throw new ApiError(422, 'Add the competitor website first. AIRO reads it to analyse them.', 'validation_error');
  if (running.has(found.id)) return competitorDetail(auth, id);
  const last = found.lastAnalyzedAt ? Date.parse(`${String(found.lastAnalyzedAt).replace(' ', 'T')}Z`) : 0;
  if (last && Date.now() - last < COOLDOWN_MS) throw new ApiError(429, 'This competitor was analysed a few minutes ago. Try again in 5 minutes.', 'rate_limited');
  running.set(found.id, Date.now());
  await repo.markAnalyzed(auth.organizationId, id);
  await recordAudit(req, { action: 'competitor.analyzed', resource: 'competitor', resourceId: id });
  runAnalysis(auth.organizationId, found)
    .catch((error) => console.error('Competitor analysis failed:', String(error?.message || error).slice(0, 200)))
    .finally(() => running.delete(found.id));
  return competitorDetail(auth, id);
}
