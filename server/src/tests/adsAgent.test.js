import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, checkLaunch, normalizeSettings } from '../services/adsAgent/guardrails.js';
import { modelJson } from '../utils/modelJson.js';
import {
  budgetTotal, campaignFindings, experimentFindings, experimentGroups, mergeQuality, pacingFindings, qualityFindings,
  scaleBudgets, scaleFindings, splitWindows, zScore
} from '../services/adsAgent/monitorRules.js';
import { chosenNames, hasProfileDetails, intakeFacts } from '../services/adsAgent/chatPlanner.js';
import { competitorTopic, libraryStats, wantsCompetitorInfo } from '../services/adsAgent/competitorResearch.js';
import { platformsAsked, statusGroups, wantsCampaignCount } from '../services/adsAgent/campaignCount.js';
import { reportRequest } from '../services/whatsappReport.js';
import { chatFacts, withLatest } from '../services/whatsappIntent.js';
import { budgetPlan, businessProfileSchema, googleCreativeSchema, metaCreativeSchema, strategySchemaFor } from '../domain/adsAgent.js';

const profile = businessProfileSchema.parse({
  businessName: 'Test Homes',
  category: 'Real estate',
  offering: '2 and 3 BHK flats near the metro',
  locations: ['Noida'],
  goal: 'leads',
  platforms: ['meta', 'google'],
  monthlyBudget: 60000
});

const strategy = {
  summary: 'First test across Meta lead forms and Google search for flat buyers in Noida.',
  platforms: [
    { platform: 'meta', budgetSharePct: 60, objective: 'Leads', why: 'Instant forms reach buyers early.' },
    { platform: 'google', budgetSharePct: 40, objective: 'Leads', why: 'Search catches people already looking.' }
  ],
  audiences: [{ platform: 'meta', name: 'Families', description: 'Families looking to buy', locations: ['Noida'], ageMin: 28, ageMax: 50, interests: ['Real estate'] }],
  keywords: ['flats in noida', '2 bhk noida', '3 bhk noida', 'noida apartments', 'flats near metro noida'].map((text) => ({ text, matchType: 'PHRASE' })),
  angles: [{ name: 'Metro', message: 'Close to the metro' }, { name: 'Space', message: 'Large rooms' }],
  headlines: ['Flats near Noida metro', '2 and 3 BHK in Noida', 'Book a site visit'],
  primaryTexts: ['Looking for a home near the metro in Noida? See our 2 and 3 BHK flats.', 'Spacious 2 and 3 BHK flats in Noida. Ask for the price list.']
};

const auto = { mode: 'auto', maxBudgetChangePct: 20, maxActionsPerDay: 5, dailySpendCap: 5000, monthlySpendCap: 100000, killSwitch: 0 };

test('missing settings fall back to recommend mode', () => {
  const settings = normalizeSettings(null);
  assert.equal(settings.mode, 'recommend');
  assert.equal(settings.killSwitch, false);
  const result = checkAction({ type: 'pause' }, { settings: null });
  assert.equal(result.allowed, true);
  assert.equal(result.applyNow, false);
  assert.equal(result.recommendOnly, true);
});

test('kill switch and off mode block every action', () => {
  assert.equal(checkAction({ type: 'pause' }, { settings: { ...auto, killSwitch: 1 } }).allowed, false);
  assert.equal(checkAction({ type: 'pause' }, { settings: { ...auto, mode: 'off' } }).allowed, false);
});

test('budget change above the limit is blocked', () => {
  const result = checkAction({ type: 'budget', currentBudget: 1000, newBudget: 1300 }, { settings: auto });
  assert.equal(result.allowed, false);
  assert.match(result.reasons.join(' '), /30%/);
  assert.equal(checkAction({ type: 'budget', currentBudget: 1000, newBudget: 1200 }, { settings: auto }).applyNow, true);
  assert.equal(checkAction({ type: 'budget', currentBudget: 1000, newBudget: 800 }, { settings: auto }).allowed, true);
});

test('spend caps block increases and resumes but never pauses', () => {
  const context = { settings: auto, spendToday: 5000 };
  assert.equal(checkAction({ type: 'budget', currentBudget: 1000, newBudget: 1100 }, context).allowed, false);
  assert.equal(checkAction({ type: 'resume' }, context).allowed, false);
  assert.equal(checkAction({ type: 'pause' }, context).allowed, true);
  assert.equal(checkAction({ type: 'resume' }, { settings: auto, spendMonth: 100000 }).allowed, false);
  assert.equal(checkAction({ type: 'budget', currentBudget: 4500, newBudget: 5400 }, { settings: auto }).allowed, false);
});

test('daily action limit and approve mode', () => {
  assert.equal(checkAction({ type: 'pause' }, { settings: auto, actionsToday: 5 }).allowed, false);
  const approve = checkAction({ type: 'pause' }, { settings: { ...auto, mode: 'approve' } });
  assert.equal(approve.needsApproval, true);
  assert.equal(approve.applyNow, false);
  assert.equal(checkAction({ type: 'delete' }, { settings: auto }).allowed, false);
  assert.equal(checkAction({ type: 'budget', currentBudget: 0, newBudget: 100 }, { settings: auto }).allowed, false);
});

test('strategy schema enforces platforms, budget split and keywords', () => {
  const schema = strategySchemaFor(profile);
  assert.equal(schema.safeParse(strategy).success, true);
  const badShare = schema.safeParse({ ...strategy, platforms: [{ ...strategy.platforms[0], budgetSharePct: 90 }, strategy.platforms[1]] });
  assert.equal(badShare.success, false);
  const metaOnly = strategySchemaFor({ ...profile, platforms: ['meta'] });
  assert.equal(metaOnly.safeParse(strategy).success, false);
  assert.equal(schema.safeParse({ ...strategy, keywords: [] }).success, false);
  assert.equal(schema.safeParse({ ...strategy, headlines: ['This headline is far too long to fit in forty chars', 'b2345', 'c2345'] }).success, false);
});

test('budget plan comes from the profile, not the model', () => {
  const plan = budgetPlan(profile, strategy);
  assert.deepEqual(plan.platforms, [
    { platform: 'meta', monthly: 36000, daily: 1200 },
    { platform: 'google', monthly: 24000, daily: 800 }
  ]);
  assert.equal(budgetPlan({ ...profile, monthlyBudget: null }, strategy), null);
});

test('launch guardrail ignores agent mode but keeps kill switch and caps', () => {
  assert.equal(checkLaunch({ dailyBudget: 1000, settings: { mode: 'off' } }).allowed, true);
  assert.equal(checkLaunch({ dailyBudget: 1000, settings: { killSwitch: 1 } }).allowed, false);
  assert.equal(checkLaunch({ dailyBudget: 6000, settings: { dailySpendCap: 5000 } }).allowed, false);
  assert.equal(checkLaunch({ dailyBudget: 1000, settings: { dailySpendCap: 5000 }, spendToday: 5000 }).allowed, false);
  assert.equal(checkLaunch({ dailyBudget: 1000, settings: { monthlySpendCap: 20000 }, spendMonth: 20000 }).allowed, false);
  assert.equal(checkLaunch({ dailyBudget: 0, settings: null }).allowed, false);
});

test('creative schemas keep platform limits', () => {
  const meta = { variants: [{ headline: 'Flats near Noida metro', primaryText: 'See 2 and 3 BHK flats close to the metro in Noida.' }, { headline: 'Ready to move in Noida', primaryText: 'Ready to move 2 and 3 BHK flats. Ask for the price list.' }] };
  assert.equal(metaCreativeSchema.safeParse(meta).success, true);
  assert.equal(metaCreativeSchema.safeParse({ variants: [meta.variants[0]] }).success, false);
  const headlines = ['Flats in Noida', '2 BHK in Noida', '3 BHK in Noida', 'Near Noida metro', 'Ready to move flats', 'Gated society Noida', 'Book a site visit', 'Ask for price list'];
  const google = { headlines, descriptions: ['Spacious 2 and 3 BHK flats near the metro.', 'Ready to move homes in a gated society.'] };
  assert.equal(googleCreativeSchema.safeParse(google).success, true);
  assert.equal(googleCreativeSchema.safeParse({ ...google, headlines: [...headlines.slice(0, 7), 'Flats in Noida'] }).success, false);
  assert.equal(googleCreativeSchema.safeParse({ ...google, headlines: [...headlines.slice(0, 7), 'This headline is longer than thirty chars'] }).success, false);
});

test('model JSON is read from fenced or padded replies', () => {
  assert.deepEqual(modelJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(modelJson('Here it is: {"a":{"b":2}} thanks'), { a: { b: 2 } });
  assert.equal(modelJson('no json here'), null);
  assert.equal(modelJson('{"a":'), null);
});

const TODAY = '2026-10-15';
const rules = normalizeSettings({ mode: 'recommend', minSpendForDecision: 500 });

function days(from, count, row) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return { date: date.toISOString().slice(0, 10), ...row };
  });
}

test('splitWindows uses the 3 days before today and the 7 before that', () => {
  const rows = days('2026-10-02', 14, { spend: 100, clicks: 10, impressions: 1000, results: 1 });
  const { recent, base } = splitWindows(rows, TODAY);
  assert.equal(recent.days, 3);
  assert.equal(base.days, 7);
  assert.equal(recent.spend, 300);
});

test('pause only when a campaign that brought results stops bringing them', () => {
  const rows = [
    ...days('2026-10-05', 7, { spend: 300, clicks: 30, impressions: 3000, results: 2 }),
    ...days('2026-10-12', 3, { spend: 300, clicks: 30, impressions: 3000, results: 0 })
  ];
  const found = campaignFindings({ platform: 'meta', currency: 'INR', rows }, { settings: rules, profile: null, today: TODAY });
  assert.equal(found[0].type, 'pause');
  assert.deepEqual(found[0].action, { type: 'pause' });
});

test('campaigns that never recorded results get a note, not a pause', () => {
  const rows = days('2026-10-05', 10, { spend: 300, clicks: 30, impressions: 3000, results: 0 });
  const found = campaignFindings({ platform: 'meta', currency: 'INR', rows }, { settings: rules, profile: null, today: TODAY });
  assert.equal(found.length, 1);
  assert.equal(found[0].type, 'no_results');
  assert.equal(found[0].action, null);
});

test('rising cost per result and falling click rate are flagged', () => {
  const rows = [
    ...days('2026-10-05', 7, { spend: 300, clicks: 60, impressions: 3000, results: 3 }),
    ...days('2026-10-12', 3, { spend: 300, clicks: 20, impressions: 3000, results: 1 })
  ];
  const types = campaignFindings({ platform: 'google', currency: 'INR', rows }, { settings: rules, profile: null, today: TODAY }).map((item) => item.type);
  assert.deepEqual(types, ['budget_decrease', 'refresh_creative']);
});

test('target cost rules only apply in the profile currency', () => {
  const rows = days('2026-10-05', 10, { spend: 1000, clicks: 50, impressions: 3000, results: 4 });
  const cheap = { targetCpl: 500, currency: 'INR' };
  const inr = campaignFindings({ platform: 'meta', currency: 'INR', rows }, { settings: rules, profile: cheap, today: TODAY });
  assert.equal(inr.find((item) => item.type === 'budget_increase')?.action.changePct, 20);
  const usd = campaignFindings({ platform: 'meta', currency: 'USD', rows }, { settings: rules, profile: cheap, today: TODAY });
  assert.equal(usd.some((item) => item.type === 'budget_increase'), false);
  const dear = campaignFindings({ platform: 'meta', currency: 'INR', rows }, { settings: rules, profile: { targetCpl: 100, currency: 'INR' }, today: TODAY });
  assert.equal(dear.some((item) => item.type === 'above_target'), true);
});

test('pacing compares the projected month with the cap or budget', () => {
  const over = pacingFindings({ monthSpend: 70000, profile: { monthlyBudget: 60000 }, settings: rules, today: TODAY });
  assert.equal(over[0].type, 'pacing_over');
  const under = pacingFindings({ monthSpend: 10000, profile: { monthlyBudget: 60000 }, settings: rules, today: TODAY });
  assert.equal(under[0].type, 'pacing_under');
  assert.deepEqual(pacingFindings({ monthSpend: 10000, profile: null, settings: rules, today: '2026-10-02' }), []);
});

test('budget scaling keeps each item and the guardrail sees the real total', () => {
  const before = [{ id: '1', daily: 1000 }, { id: '2', daily: 333.33 }];
  const after = scaleBudgets(before, 20);
  assert.deepEqual(after, [{ id: '1', daily: 1200 }, { id: '2', daily: 399.99 }]);
  const check = checkAction({ type: 'budget', currentBudget: budgetTotal(before), newBudget: budgetTotal(after) }, { settings: { mode: 'approve', maxBudgetChangePct: 20 } });
  assert.equal(check.allowed, true);
  assert.equal(check.needsApproval, true);
  assert.deepEqual(scaleBudgets([{ id: '1', daily: 500 }], -20), [{ id: '1', daily: 400 }]);
});

test('lead quality joins spend with CRM outcomes and keeps ROAS to INR', () => {
  const campaigns = [
    { platform: 'meta', connectionId: 1, externalId: '111', name: 'A', currency: 'INR', spend: '10000', leads: '25' },
    { platform: 'meta', connectionId: 1, externalId: '222', name: 'B', currency: 'USD', spend: '500', leads: '5' },
    { platform: 'google', connectionId: 2, externalId: '333', name: 'G', currency: 'INR', spend: '900', leads: null }
  ];
  const quality = [
    { externalId: '111', crmLeads: 20, qualified: 5, booked: 1, rejected: 8, revenue: '50000', bookedWithoutValue: 0 },
    { externalId: '222', crmLeads: 4, qualified: 2, booked: 1, rejected: 0, revenue: '9000', bookedWithoutValue: 0 }
  ];
  const [a, b] = mergeQuality(campaigns, quality);
  assert.equal(mergeQuality(campaigns, quality).length, 2);
  assert.equal(a.costPerLead, 500);
  assert.equal(a.costPerQualifiedLead, 2000);
  assert.equal(a.qualifiedRate, 25);
  assert.equal(a.roas, 5);
  assert.equal(b.roas, null);
});

test('low lead quality is flagged only with enough leads and many rejections', () => {
  const row = (crmLeads, qualified, rejected) => mergeQuality(
    [{ platform: 'meta', externalId: '1', name: 'A', currency: 'INR', spend: 5000, leads: crmLeads }],
    [{ externalId: '1', crmLeads, qualified, booked: 0, rejected, revenue: null, bookedWithoutValue: 0 }]
  )[0];
  assert.equal(qualityFindings(row(12, 1, 8))[0].type, 'low_quality');
  assert.deepEqual(qualityFindings(row(12, 1, 2)), []);
  assert.deepEqual(qualityFindings(row(6, 0, 6)), []);
});

const ad = (id, adsetId, impressions, clicks, leads, extra = {}) => ({
  connectionId: 1, externalId: id, name: `Ad ${id}`, campaignId: 'c1', adsetId, currency: 'INR',
  spend: 2000, impressions, clicks, leads, days: 10, lastSpendDate: '2026-10-14', ...extra
});

test('A/B test needs a clear, confident lift before naming a winner', () => {
  assert.ok(zScore(60, 10000, 30, 10000) > 1.96);
  const clear = experimentGroups([ad('a', 's1', 10000, 200, 60), ad('b', 's1', 10000, 190, 30)], { today: TODAY, minSpend: 500 });
  assert.equal(clear[0].metric, 'leads');
  assert.equal(clear[0].verdict, 'winner');
  const found = experimentFindings(clear[0]);
  assert.equal(found.length, 1);
  assert.equal(found[0].target.externalId, 'b');
  assert.deepEqual(found[0].action, { type: 'pause' });

  const close = experimentGroups([ad('a', 's1', 10000, 200, 32), ad('b', 's1', 10000, 190, 30)], { today: TODAY, minSpend: 500 });
  assert.equal(close[0].verdict, 'no_winner_yet');
  assert.deepEqual(experimentFindings(close[0]), []);
});

test('A/B test skips small, stopped and lone ads', () => {
  const small = experimentGroups([ad('a', 's1', 500, 20, 5), ad('b', 's1', 10000, 100, 5)], { today: TODAY, minSpend: 500 });
  assert.equal(small[0].verdict, 'learning');
  const stopped = experimentGroups([ad('a', 's1', 10000, 300, 60), ad('b', 's1', 10000, 100, 10, { lastSpendDate: '2026-10-01' })], { today: TODAY, minSpend: 500 });
  assert.deepEqual(stopped, []);
  const separate = experimentGroups([ad('a', 's1', 10000, 300, 60), ad('b', 's2', 10000, 100, 10)], { today: TODAY, minSpend: 500 });
  assert.deepEqual(separate, []);
});

test('scaling picks campaigns far cheaper than the account average, never with a target or poor quality', () => {
  const campaign = (id, results) => ({ platform: 'meta', connectionId: 1, externalId: id, name: id, currency: 'INR', rows: days('2026-10-05', 10, { spend: 1000, clicks: 50, impressions: 5000, results }) });
  const list = [campaign('cheap', 4), campaign('dear1', 1), campaign('dear2', 1)];
  const found = scaleFindings(list, { settings: rules, profile: null, today: TODAY });
  assert.deepEqual(found.map((item) => item.campaign.externalId), ['cheap']);
  assert.equal(found[0].action.changePct, 20);
  assert.deepEqual(scaleFindings(list, { settings: rules, profile: { targetCpl: 300, currency: 'INR' }, today: TODAY }), []);
  const poor = new Map([['cheap', { crmLeads: 20, qualifiedRate: 5 }]]);
  assert.deepEqual(scaleFindings(list, { settings: rules, profile: null, today: TODAY, quality: poor }), []);
});

test('whatsapp city replies pick suggestions by ok, numbers, or names', () => {
  const suggested = ['Noida', 'Greater Noida', 'Ghaziabad'];
  assert.deepEqual(chosenNames('ok', suggested), suggested);
  assert.deepEqual(chosenNames('1, 3', suggested), ['Noida', 'Ghaziabad']);
  assert.deepEqual(chosenNames('1 2 9', suggested), ['Noida', 'Greater Noida']);
  assert.deepEqual(chosenNames('Delhi, Gurgaon aur Faridabad', suggested), ['Delhi', 'Gurgaon', 'Faridabad']);
  assert.deepEqual(chosenNames('Pune', []), ['Pune']);
});

test('chat facts use the business profile and never add empty lines', () => {
  assert.equal(hasProfileDetails(null), false);
  assert.equal(hasProfileDetails({ usps: ['Near metro'] }), true);
  const facts = intakeFacts({ product: '2bhk flats', details: 'Possession 2027', website: '' }, { businessName: 'Test Homes', usps: ['Near metro'] });
  assert.ok(facts.includes('Business name: Test Homes'));
  assert.ok(facts.includes('Selling points: Near metro'));
  assert.ok(facts.includes('Website: none'));
  assert.ok(facts.every((line) => line.length > 0));
});

test('competitor questions are detected and reduced to a search topic', () => {
  assert.equal(wantsCompetitorInfo('What competitors do'), true);
  assert.equal(wantsCompetitorInfo('competitors kya run kr rahe hai'), true);
  assert.equal(wantsCompetitorInfo('haan'), false);
  assert.equal(competitorTopic('What competitors do'), '');
  assert.equal(competitorTopic('competitors kya chala rahe hai saya raj nagar project pe'), 'saya raj nagar');
  assert.equal(competitorTopic('competitors 2bhk flats noida'), '2bhk flats noida');
});

test('ad library stats count advertisers and platform share', () => {
  const stats = libraryStats([
    { pageId: '1', page: 'A Homes', platforms: ['facebook', 'instagram'], startDate: '2026-09-01' },
    { pageId: '1', page: 'A Homes', platforms: ['instagram'], startDate: '2026-08-01' },
    { pageId: '2', page: 'B Realty', platforms: ['facebook'], startDate: '' }
  ]);
  assert.equal(stats.ads, 3);
  assert.equal(stats.advertisers.length, 2);
  assert.deepEqual(stats.advertisers[0], { page: 'A Homes', count: 2, firstStart: '2026-08-01' });
  assert.equal(stats.platforms.instagram, 2);
  assert.equal(stats.platforms.facebook, 2);
});

test('campaign count questions are routed, report questions are not', () => {
  assert.equal(wantsCampaignCount('Total campaign kitne hai google ads pe'), true);
  assert.equal(wantsCampaignCount('how many campaigns on meta'), true);
  assert.equal(wantsCampaignCount('campaign wise report'), false);
  assert.equal(wantsCampaignCount('campaign ke leads kitne aaye'), false);
  assert.deepEqual(platformsAsked('Total campaign kitne hai google ads pe'), { google: true, meta: false });
  assert.deepEqual(platformsAsked('campaigns kitne hai'), { google: true, meta: true });
  const groups = statusGroups([{ status: 'ENABLED' }, { status: 'PAUSED' }, { status: 'ACTIVE' }, { status: 'REMOVED' }]);
  assert.equal(groups.active.length, 2);
  assert.equal(groups.paused.length, 1);
  assert.equal(groups.other.length, 1);
});

test('an ads question ends an older call report request', () => {
  const user = (content) => ({ role: 'user', content });
  assert.equal(reportRequest([user('Call report do'), user('Total campaign kitne hai google ads pe'), user('Kya hua')]), '');
  assert.equal(reportRequest([user('Call report do'), user('Kya hua')]), 'Call report do');
  assert.equal(reportRequest([user('google ads ke leads kitne aaye')]), 'google ads ke leads kitne aaye');
});
test('router facts show the open ad step and only the latest user line is rewritten', () => {
  const messages = [{ role: 'user', content: 'Call report do' }, { role: 'assistant', content: 'Report...' }, { role: 'user', content: 'Kya hua' }];
  const facts = chatFacts(messages, { platform: 'Google', step: 'approval' });
  assert.match(facts, /Open ad setup: Google, waiting for whether to publish/);
  assert.match(facts, /User: Kya hua$/);
  assert.match(chatFacts(messages, null), /Open ad setup: none/);
  const rewritten = withLatest(messages, 'call report today | Kya hua');
  assert.equal(rewritten[0].content, 'Call report do');
  assert.equal(rewritten[2].content, 'call report today | Kya hua');
  assert.equal(messages[2].content, 'Kya hua');
});