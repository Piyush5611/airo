import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, checkLaunch, normalizeSettings } from '../services/adsAgent/guardrails.js';
import { modelJson } from '../utils/modelJson.js';
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
