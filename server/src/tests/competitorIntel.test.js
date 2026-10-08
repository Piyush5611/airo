import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COPY_RULE, NOT_AVAILABLE, adAnalysisSchema, competitorSummary, confidenceFor, contentHash, creativeFormat, discoveryFields,
  marketGaps, normalizeAd, strategySchema, timeline
} from '../services/competitorIntel.js';
import { duplicateOf, siteKey } from '../services/competitorService.js';
import { competitorAdFilterSchema, competitorSchema, competitorVerifySchema } from '../validators/schemas.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const metaAd = {
  id: '111', page: 'Rival Homes', title: '2 BHK in Noida', text: 'Book a site visit today', cta: 'Learn more',
  link: 'https://rival.example/flats?utm_source=fb', image: 'https://cdn.example/a.jpg', format: 'IMAGE', platforms: ['facebook'],
  versions: 2, active: true, startDate: '2026-08-01T00:00:00Z', url: 'https://www.facebook.com/ads/library/?id=111'
};

function analysed(competitorId, themes, extra = {}) {
  return {
    competitorId, platform: 'meta', format: 'static', status: 'active', link: '',
    analysis: { copyAvailable: true, themes, offers: ['none'], cta: 'learn_more', styles: ['product'], tone: 'trust', intent: 'conversion', ...extra }
  };
}

test('normalizeAd maps a Meta ad and a Google ad to one shape', () => {
  const meta = normalizeAd('meta', metaAd);
  assert.equal(meta.externalId, '111');
  assert.equal(meta.headline, '2 BHK in Noida');
  assert.equal(meta.format, 'static');
  assert.equal(meta.status, 'active');
  assert.equal(meta.firstShown, '2026-08-01');
  assert.equal(meta.source, 'meta_ad_library');
  const google = normalizeAd('google', { id: 'CR1', advertiser: 'Rival Pvt Ltd', format: 'VIDEO', firstShown: '2026-07-01', lastShown: '2026-10-01', active: false });
  assert.equal(google.format, 'video');
  assert.equal(google.headline, '');
  assert.equal(google.status, 'inactive');
  assert.equal(google.lastShown, '2026-10-01');
  assert.equal(google.source, 'google_ads_transparency');
});

test('contentHash ignores image links, dates and tracking parameters but not copy', () => {
  const base = normalizeAd('meta', metaAd);
  const sameCopy = normalizeAd('meta', { ...metaAd, image: 'https://cdn.example/other.jpg', startDate: '2026-09-01', link: 'https://rival.example/flats?utm_source=ig' });
  const newCopy = normalizeAd('meta', { ...metaAd, text: 'Flat 10% off this week' });
  assert.equal(base.contentHash, sameCopy.contentHash);
  assert.notEqual(base.contentHash, newCopy.contentHash);
  assert.equal(contentHash(base), base.contentHash);
});

test('creativeFormat groups source formats', () => {
  assert.equal(creativeFormat('VIDEO', 'meta'), 'video');
  assert.equal(creativeFormat('DCO', 'meta'), 'static');
  assert.equal(creativeFormat('carousel', 'meta'), 'carousel');
  assert.equal(creativeFormat('', 'google'), 'other');
  assert.equal(creativeFormat('', 'meta'), 'static');
});

test('adAnalysisSchema keeps only allowed labels and fills safe defaults for malformed output', () => {
  const parsed = adAnalysisSchema.parse({
    items: [{ id: '7', styles: ['Product', 'made-up'], offers: ['site visit', 'bogus'], cta: 'Book Visit', tone: 'shouty', intent: null, themes: 'price', urgency: 'true', confidence: 'HIGH', hook: '  Big   hook ' }]
  });
  const item = parsed.items[0];
  assert.equal(item.id, 7);
  assert.deepEqual(item.styles, ['product']);
  assert.deepEqual(item.offers, ['site_visit']);
  assert.equal(item.cta, 'book_visit');
  assert.equal(item.tone, 'promotional');
  assert.equal(item.intent, 'consideration');
  assert.deepEqual(item.themes, []);
  assert.equal(item.urgency, true);
  assert.equal(item.confidence, 'high');
  assert.equal(item.hook, 'Big hook');
  assert.deepEqual(adAnalysisSchema.parse({ items: 'nope' }).items, []);
  assert.equal(adAnalysisSchema.safeParse({ items: [{ id: 'abc' }] }).success, false);
});

test('strategySchema rejects an empty strategy and trims long lists', () => {
  assert.equal(strategySchema.safeParse({}).success, false);
  const parsed = strategySchema.parse({ advertising: 'Ready flats in Noida', hooks: Array.from({ length: 9 }, (_, i) => `hook ${i}`), confidence: 'certain' });
  assert.equal(parsed.hooks.length, 6);
  assert.equal(parsed.confidence, 'low');
  assert.deepEqual(parsed.whitespace, []);
});

test('confidenceFor needs several competitors and ads for high confidence', () => {
  assert.equal(confidenceFor(5, 30), 'high');
  assert.equal(confidenceFor(3, 10), 'medium');
  assert.equal(confidenceFor(10, 5), 'low');
  assert.equal(confidenceFor(1, 100), 'low');
});

test('marketGaps finds rare and crowded themes from observed ads only', () => {
  const rows = [
    analysed(1, ['price', 'location']), analysed(1, ['price']),
    analysed(2, ['price', 'investment']), analysed(3, ['price', 'location']),
    analysed(4, ['price', 'testimonial']),
    { competitorId: 5, platform: 'google', format: 'video', status: 'active', analysis: { copyAvailable: false } },
    { ...analysed(6, ['trust']), status: 'inactive' }
  ];
  const result = marketGaps(rows);
  assert.equal(result.ads, 6);
  assert.equal(result.analysedAds, 5);
  assert.equal(result.analysedCompetitors, 4);
  assert.equal(result.confidence, 'low');
  assert.ok(result.gaps.some((gap) => gap.type === 'crowded' && gap.key === 'price'));
  assert.ok(result.gaps.some((gap) => gap.type === 'theme' && gap.key === 'testimonial'));
  assert.ok(result.gaps.some((gap) => gap.type === 'offer'));
  assert.match(result.gaps.find((gap) => gap.key === 'trust').text, /\(0 of 4\)/, 'stopped ads are not counted');
  assert.ok(result.gaps.every((gap) => ['high', 'medium', 'low'].includes(gap.confidence)));
  assert.match(result.note, /not predictions/);
  assert.deepEqual(marketGaps([]).gaps, []);
});

test('timeline groups ads by start month and reports what was new', () => {
  const ads = [
    { ...analysed(1, ['price']), firstShown: '2026-07-03', platform: 'meta' },
    { ...analysed(1, ['price', 'payment_plan'], { offers: ['emi'] }), firstShown: '2026-08-10', format: 'video', platform: 'meta' },
    { ...analysed(1, []), firstShown: null, firstObservedAt: null }
  ];
  const result = timeline(ads, [{ adId: 1, platform: 'meta', changeType: 'stopped', observedAt: '2026-09-01' }, { adId: 2, changeType: 'new' }]);
  assert.equal(result.months.length, 2);
  assert.equal(result.months[0].month, '2026-08');
  assert.ok(result.months[0].changes.some((line) => line.includes('Video')));
  assert.ok(result.months[0].changes.some((line) => line.includes('EMI')));
  assert.deepEqual(result.months[1].changes, []);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].change, 'stopped');
});

test('competitorSummary counts only active ads and skips the no-offer label', () => {
  const summary = competitorSummary([analysed(1, ['price'], { offerText: 'Zero brokerage', offers: ['none', 'discount'] }), { ...analysed(1, ['trust']), status: 'inactive' }]);
  assert.equal(summary.ads, 2);
  assert.equal(summary.active, 1);
  assert.deepEqual(summary.offers.map((row) => row.key), ['discount']);
  assert.deepEqual(summary.offerTexts, ['Zero brokerage']);
});

test('discoveryFields turns a suggestion into type, confidence and source', () => {
  const found = discoveryFields({ verdict: 'direct', reason: 'Same city flats', sources: JSON.stringify([{ type: 'google_ad' }, { type: 'maps' }, { type: 'maps' }]) });
  assert.equal(found.competitorType, 'direct');
  assert.equal(found.confidence, 86);
  assert.equal(found.source, 'google_ad,maps');
  const unclear = discoveryFields({ verdict: 'unclear', sources: [] });
  assert.equal(unclear.competitorType, null);
  assert.equal(unclear.confidence, 40);
  assert.equal(unclear.source, 'discovery');
  assert.ok(discoveryFields({ verdict: 'direct', sources: [1, 2, 3, 4, 5].map((n) => ({ type: `t${n}` })) }).confidence <= 95);
});

test('duplicateOf matches by name or website domain', () => {
  const known = [{ id: 1, name: 'Rival Homes', website: 'https://www.rival.example/' }];
  assert.equal(siteKey('m.rival.example/path'), 'rival.example');
  assert.equal(duplicateOf({ name: ' rival homes ', website: '' }, known)?.id, 1);
  assert.equal(duplicateOf({ name: 'Other', website: 'rival.example' }, known)?.id, 1);
  assert.equal(duplicateOf({ name: 'Other', website: 'other.example' }, known), null);
});

test('competitor validators accept types, verify flags and ad filters', () => {
  assert.equal(competitorSchema.safeParse({ body: { name: 'Rival', competitorType: 'emerging' }, query: {}, params: {} }).success, true);
  assert.equal(competitorSchema.safeParse({ body: { name: 'Rival', competitorType: 'partner' }, query: {}, params: {} }).success, false);
  assert.equal(competitorVerifySchema.safeParse({ body: { verified: true }, query: {}, params: {} }).success, true);
  assert.equal(competitorVerifySchema.safeParse({ body: { verified: 'yes' }, query: {}, params: {} }).success, false);
  const filters = competitorAdFilterSchema.parse({ body: {}, params: {}, query: { competitorId: '4', platform: 'meta', from: '2026-01-01' } });
  assert.equal(filters.query.competitorId, 4);
  assert.equal(competitorAdFilterSchema.safeParse({ body: {}, params: {}, query: { platform: 'tiktok' } }).success, false);
  assert.equal(competitorAdFilterSchema.safeParse({ body: {}, params: {}, query: { from: '01/01/2026' } }).success, false);
});

test('every competitor intelligence query is scoped to the organization', () => {
  const source = fs.readFileSync(path.join(here, '../repositories/competitorIntelRepo.js'), 'utf8');
  const queries = [...source.matchAll(/`([^`]*\b(?:SELECT|UPDATE|INSERT|DELETE)\b[^`]*)`/g)].map((match) => match[1]).filter((sql) => /\bFROM\b|\bINTO\b|^\s*UPDATE/i.test(sql));
  assert.ok(queries.length >= 10);
  for (const sql of queries) assert.match(sql, /organization_id/, sql.slice(0, 80));
});

test('competitor intelligence routes require permissions', () => {
  const source = fs.readFileSync(path.join(here, '../routes/index.js'), 'utf8');
  const lines = source.split('\n').filter((line) => /client\.(get|post)\('\/competitors\/(intelligence|ads\/|:id\/(insights|strategy|verify))/.test(line));
  assert.equal(lines.length, 8);
  for (const line of lines) assert.match(line, /requirePermission\('campaigns\.(view|update)'\)/);
  for (const line of lines.filter((item) => item.includes('client.post'))) assert.match(line, /campaigns\.update/);
});

test('the copy rule and missing-metric marker are fixed strings', () => {
  assert.match(COPY_RULE, /do not copy competitor wording, creatives, trademarks, or claims/);
  assert.equal(NOT_AVAILABLE, 'NOT_AVAILABLE');
});
