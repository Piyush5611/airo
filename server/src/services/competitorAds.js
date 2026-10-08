import * as repo from '../repositories/competitorRepo.js';
import { adLibraryUrl, googleTransparencyAds, metaAdsFrom } from '../integrations/apify.js';
import { apifyToken } from './researchTools.js';
import { distinctWords, domainOf } from './competitorDiscovery.js';
import { recordAudit } from './auditService.js';
import { ApiError } from '../utils/errors.js';

const DAY_MS = 86400000;
const AD_LIMIT = 30;
const COOLDOWN_MS = 30 * 60 * 1000;
const LONG_RUNNING_DAYS = 30;
const NEW_DAYS = 7;
const running = new Set();
const NOT_READY = 'Competitor ad checks are not turned on yet. The AIRO team connects Apify on the platform.';

const clip = (value, max) => String(value || '').replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseJson(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function daysSince(iso, now) {
  const time = Date.parse(iso || '');
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / DAY_MS)) : null;
}

function isoDate(value) {
  if (!value) return '';
  if (typeof value === 'number') return new Date(value * (value < 1e12 ? 1000 : 1)).toISOString();
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function facebookPage(url) {
  const domain = domainOf(url);
  return domain === 'facebook.com' || domain.endsWith('.facebook.com') ? String(url).trim() : '';
}

export function metaAd(item, now = Date.now()) {
  const snap = item?.snapshot || {};
  const cards = Array.isArray(snap.cards) ? snap.cards : [];
  const card = cards.find((row) => row?.body || row?.title) || cards[0] || {};
  const image = snap.images?.[0] || {};
  const video = snap.videos?.[0] || {};
  const id = String(item?.adArchiveID || item?.adArchiveId || '');
  const startDate = isoDate(item?.startDateFormatted || item?.startDate);
  const display = String(snap.displayFormat || '').toLowerCase();
  return {
    id,
    page: clip(item?.pageName || snap.pageName, 120),
    pageId: String(item?.pageID || item?.pageId || snap.pageId || ''),
    text: clip(snap.body?.text || (typeof snap.body === 'string' ? snap.body : '') || card.body, 400),
    title: clip(snap.title || card.title, 140),
    cta: clip(snap.ctaText || card.ctaText, 40),
    link: String(snap.linkUrl || card.linkUrl || '').slice(0, 500),
    image: String(image.resizedImageUrl || image.originalImageUrl || video.videoPreviewImageUrl || card.resizedImageUrl || card.originalImageUrl || card.videoPreviewImageUrl || '').slice(0, 1000),
    format: display.includes('video') || video.videoPreviewImageUrl || card.videoPreviewImageUrl ? 'video' : cards.length > 1 || display.includes('carousel') ? 'carousel' : 'image',
    platforms: (Array.isArray(item?.publisherPlatform) ? item.publisherPlatform : []).map((name) => String(name).toLowerCase()),
    versions: Math.max(1, Number(item?.collationCount) || 1),
    active: item?.isActive !== false,
    startDate,
    days: daysSince(startDate, now),
    age: daysSince(startDate, now),
    url: id ? `https://www.facebook.com/ads/library/?id=${id}` : ''
  };
}

export function googleAd(item, now = Date.now()) {
  const firstShown = isoDate(item?.firstShown);
  const lastShown = isoDate(item?.lastShown);
  const shown = Number(item?.shownForDays);
  const lastAge = daysSince(lastShown, now);
  return {
    id: String(item?.creativeId || ''),
    advertiser: clip(item?.advertiserName, 120),
    format: String(item?.format || '').toLowerCase(),
    image: String(item?.imageUrl || '').slice(0, 1000),
    firstShown,
    lastShown,
    days: Number.isFinite(shown) ? shown : (firstShown && lastShown ? Math.max(0, Math.round((Date.parse(lastShown) - Date.parse(firstShown)) / DAY_MS)) : null),
    age: daysSince(firstShown, now),
    active: lastAge != null && lastAge <= NEW_DAYS,
    url: String(item?.adUrl || '').slice(0, 500)
  };
}

// Keyword and name searches return other advertisers too; keep only ads whose name or landing site is this competitor's.
export function ownAd(competitor, { name, link }) {
  const site = domainOf(competitor.website);
  if (site && link && domainOf(link) === site) return true;
  const words = distinctWords(competitor.name);
  if (!words.length) return false;
  const compact = nameKey(name).replace(/ /g, '');
  return words.every((word) => compact.includes(word));
}

function countBy(values) {
  const counts = {};
  for (const value of values) if (value) counts[value] = (counts[value] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([key, total]) => ({ key, total }));
}

function average(values) {
  const list = values.filter((value) => value != null);
  return list.length ? Math.round(list.reduce((sum, value) => sum + value, 0) / list.length) : null;
}

export function adStats(ads) {
  const live = ads.filter((ad) => ad.active);
  return {
    total: ads.length,
    live: live.length,
    longRunning: live.filter((ad) => ad.days != null && ad.days >= LONG_RUNNING_DAYS).length,
    newThisWeek: live.filter((ad) => ad.age != null && ad.age <= NEW_DAYS).length,
    withVersions: live.filter((ad) => ad.versions > 1).length,
    averageDays: average(live.map((ad) => ad.days)),
    longestDays: live.reduce((max, ad) => Math.max(max, ad.days || 0), 0),
    formats: countBy(live.map((ad) => ad.format)),
    platforms: countBy(live.flatMap((ad) => ad.platforms || [])),
    ctas: countBy(live.map((ad) => ad.cta)).slice(0, 4),
    landing: countBy(live.map((ad) => domainOf(ad.link))).slice(0, 4)
  };
}

const byDays = (a, b) => Number(b.active) - Number(a.active) || (b.days || 0) - (a.days || 0);

async function readMeta(apiKey, competitor, notes) {
  const page = facebookPage(competitor.facebook);
  const source = page || adLibraryUrl(competitor.name);
  const items = await metaAdsFrom(apiKey, source, AD_LIMIT);
  const now = Date.now();
  let ads = items.map((item) => metaAd(item, now)).filter((ad) => ad.id);
  if (!page) {
    ads = ads.filter((ad) => ownAd(competitor, { name: ad.page, link: ad.link }));
    notes.push('No Facebook page is saved for this competitor, so AIRO searched the Ad Library by name. Add their Facebook page with Edit for exact results.');
  }
  const unique = [...new Map(ads.map((ad) => [ad.id, ad])).values()].sort(byDays);
  return { source: page ? 'page' : 'name', page: unique[0]?.page || '', stats: adStats(unique), ads: unique.slice(0, AD_LIMIT) };
}

async function readGoogle(apiKey, competitor, notes) {
  const domain = domainOf(competitor.website);
  const items = await googleTransparencyAds(apiKey, domain ? { domain } : { name: competitor.name }, AD_LIMIT);
  const now = Date.now();
  let ads = items.map((item) => googleAd(item, now)).filter((ad) => ad.id);
  if (!domain) {
    ads = ads.filter((ad) => ownAd(competitor, { name: ad.advertiser, link: '' }));
    notes.push('No website is saved for this competitor, so AIRO searched Google by name. Add their website for exact results.');
  }
  const unique = [...new Map(ads.map((ad) => [ad.id, ad])).values()].sort(byDays);
  return {
    source: domain ? 'domain' : 'name',
    advertisers: countBy(unique.map((ad) => ad.advertiser)).slice(0, 3).map((row) => row.key),
    stats: adStats(unique),
    ads: unique.slice(0, AD_LIMIT)
  };
}

async function runCheck(organizationId, competitor, checkId) {
  const apiKey = await apifyToken().catch(() => null);
  const notes = [];
  const [meta, google] = await Promise.all([
    readMeta(apiKey, competitor, notes).catch((error) => { notes.push(`Meta ads could not be read: ${clip(error?.message, 160)}`); return null; }),
    readGoogle(apiKey, competitor, notes).catch((error) => { notes.push(`Google ads could not be read: ${clip(error?.message, 160)}`); return null; })
  ]);
  await repo.finishAdCheck(checkId, { status: meta || google ? 'ready' : 'failed', meta, google, notes });
}

function ourSummary(rows) {
  return rows.map((row) => {
    const spend = Number(row.spend) || 0;
    const clicks = Number(row.clicks) || 0;
    const impressions = Number(row.impressions) || 0;
    const leads = Number(row.leads) || 0;
    return {
      platform: row.platform,
      currency: row.currency || '',
      campaigns: Number(row.campaigns) || 0,
      spend,
      impressions,
      clicks,
      leads,
      conversions: Number(row.conversions) || 0,
      ctr: impressions ? Math.round((clicks / impressions) * 10000) / 100 : null,
      cpl: leads ? Math.round((spend / leads) * 100) / 100 : null
    };
  });
}

export async function competitorAds(auth, id) {
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  const [check, ours, apiKey] = await Promise.all([
    repo.latestAdCheck(auth.organizationId, id).catch(() => null),
    repo.ourAdTotals(auth.organizationId, 30).catch(() => []),
    apifyToken().catch(() => null)
  ]);
  const busy = running.has(Number(id));
  let view = null;
  if (check) {
    view = {
      id: check.id,
      status: check.status === 'running' && !busy ? 'failed' : check.status,
      meta: parseJson(check.meta),
      google: parseJson(check.google),
      notes: check.status === 'running' && !busy ? ['The check was stopped before it finished. Press Check ads again.'] : parseJson(check.notes) || [],
      startedAt: check.startedAt,
      finishedAt: check.finishedAt
    };
  }
  return { ready: Boolean(apiKey), running: busy, check: view, ours: ourSummary(ours) };
}

export async function checkCompetitorAds(auth, req, id) {
  if (!(await apifyToken().catch(() => null))) throw new ApiError(422, NOT_READY, 'apify_missing');
  const found = await repo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Competitor not found.', 'not_found');
  const key = Number(found.id);
  if (running.has(key)) return competitorAds(auth, id);
  const last = await repo.latestAdCheck(auth.organizationId, id).catch(() => null);
  const finished = last?.finishedAt ? Date.parse(`${String(last.finishedAt).replace(' ', 'T')}Z`) : 0;
  if (last?.status === 'ready' && finished && Date.now() - finished < COOLDOWN_MS) {
    throw new ApiError(429, 'Their ads were checked in the last 30 minutes. Try again later.', 'rate_limited');
  }
  const checkId = await repo.startAdCheck(auth.organizationId, found.id);
  running.add(key);
  await recordAudit(req, { action: 'competitor.ads_checked', resource: 'competitor', resourceId: found.id });
  runCheck(auth.organizationId, found, checkId)
    .catch(async (error) => {
      console.error('Competitor ad check failed:', clip(error?.message || error, 200));
      await repo.finishAdCheck(checkId, { status: 'failed', notes: ['The check failed. Try again later.'] }).catch(() => {});
    })
    .finally(() => running.delete(key));
  return competitorAds(auth, id);
}

export function closeInterruptedAdChecks() {
  return repo.closeInterruptedAdChecks().catch(() => {});
}
