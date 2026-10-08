import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAction, checkLaunch, normalizeSettings } from '../services/adsAgent/guardrails.js';
import { modelJson } from '../utils/modelJson.js';
import {
  budgetTotal, campaignFindings, experimentFindings, experimentGroups, mergeQuality, pacingFindings, qualityFindings,
  scaleBudgets, scaleFindings, splitWindows, zScore
} from '../services/adsAgent/monitorRules.js';
import {
  bestCities, chosenNames, cityChoices, cityMenu, cityPick, droppedCity, hasProfileDetails, intakeFacts, meansAll, officeCityNote, wantsOtherCity
} from '../services/adsAgent/chatPlanner.js';
import { competitorTopic, libraryStats, wantsCompetitorInfo } from '../services/adsAgent/competitorResearch.js';
import { platformsAsked, statusGroups, wantsCampaignCount } from '../services/adsAgent/campaignCount.js';
import { reportRequest } from '../services/whatsappReport.js';
import { chatFacts, withLatest } from '../services/whatsappIntent.js';
import {
  NOT_DESIGN, RAW_PHOTO, USE_DESIGN, budgetAmount, campaignName, goalChoices, peopleCount, radiusFrom, radiusMenu, withRadius
} from '../services/metaAdChat.js';
import { demandSection } from '../services/googleAdChat.js';
import { usableInterest } from '../services/adsAgent/chatPlanner.js';
import { menuMessage, messageParts } from '../services/whatsappService.js';
import { catalogFacts, modelBusy } from '../services/llmService.js';
import { attribution, codeState, flattenFields, pickContact, scriptSources } from '../services/websiteFormService.js';
import { creativePoints, creativeSvg, ctaLabel, fitText, variantCreatives, wrapText } from '../services/adsAgent/adCreative.js';
import { budgetPlan, businessProfileSchema, googleCreativeSchema, metaCreativeSchema, strategySchemaFor } from '../domain/adsAgent.js';
import { GOAL_LABELS, SECTORS, SECTOR_KEYS, catalogFor, productAsk, sectorFacts, sectorOf } from '../domain/sectors.js';
import { competitorSchema, discoverSchema, imageUploadSchema, offeringSchema, organizationSchema } from '../validators/schemas.js';
import { pageText, pricesIn, samePageLinks } from '../integrations/webPage.js';
import { analysisFacts, analysisSchema } from '../services/competitorService.js';
import { balancedTop, collectCandidates, domainOf, dueScopes, fallbackPlan, notCompetitor, placeParts, planFacts, planSchema, trackedMatch, verdictSchema, websiteFor } from '../services/competitorDiscovery.js';
import { adLibraryUrl } from '../integrations/apify.js';
import { adStats, facebookPage, googleAd, metaAd, ownAd } from '../services/competitorAds.js';
import {
  MAX_AD_ITEMS, applyOfferings, cleanText, imageBytes, kindForSector, offeringFacts, offeringMenu, offeringPick, saveAnswer, slimOffering
} from '../services/offeringService.js';
import { itemsReady, itemsSection } from '../services/metaAdChat.js';
import { isMetaRateLimit, leadFormName } from '../integrations/metaAds.js';
import { creativeScore, scoreAds } from '../services/adsAgent/adScore.js';
import { campaignMetric, rankAds } from '../services/adsAgent/adRanking.js';
import { analysisDays, analysisText, wantsAdsAnalysis } from '../services/adsAgent/qualityService.js';

const SAVED = [
  { id: 11, kind: 'project', name: 'Green Heights', priceText: '45 lakh onwards', offer: 'Free site visit', usps: 'Near metro, 2 min to school', details: '2 and 3 BHK', locations: 'Noida Sector 150', website: 'https://green.example.com', photoCount: 2 },
  { id: 12, kind: 'project', name: 'Lake View Villas', priceText: '', offer: '', usps: '', details: '', locations: '', website: '', photoCount: 0 }
];

test('offering list menu toggles items, adds typed ones and stays inside WhatsApp limits', () => {
  const payload = { offeringChoices: SAVED.map(slimOffering) };
  assert.deepEqual(offeringPick('Done', payload), { kind: 'empty' });
  assert.equal(offeringPick('Add new', payload).kind, 'new');
  assert.equal(offeringPick('Green Heights', payload).added, true);
  assert.deepEqual(payload.pickedOfferings, [11]);
  assert.equal(offeringPick('✓ Green Heights', payload).added, false);
  assert.deepEqual(payload.pickedOfferings, []);
  assert.equal(offeringPick('Sunrise Plots', payload).added, true);
  assert.deepEqual(payload.offeringExtra, ['Sunrise Plots']);
  const menu = offeringMenu(payload, true);
  assert.ok(menu.rows.length <= 10);
  assert.ok(menu.rows.every((row) => row.title.length <= 24 && row.description.length <= 72));
  assert.equal(menu.rows[0].id, 'offer_done');
  assert.equal(menu.rows.at(-1).id, 'offer_new');
  assert.match(menu.body, /Selected: Sunrise Plots/);
  assert.match(offeringMenu({ offeringChoices: SAVED }, true).body, /own ad set/);
  assert.doesNotMatch(offeringMenu({ offeringChoices: SAVED }, true, 'google').body, /ad set/);
  assert.equal(offeringPick('1,2', payload).kind, 'final');
  assert.deepEqual(payload.pickedOfferings, [11, 12]);
});

test('chosen offerings fill the ad intake with each item kept separate', () => {
  const payload = { sector: 'real_estate', offeringChoices: SAVED.map(slimOffering), pickedOfferings: [11, 12], offeringExtra: ['Sunrise Plots'] };
  const chosen = applyOfferings(payload);
  assert.deepEqual(chosen.ids, [11, 12]);
  assert.equal(payload.product, 'Green Heights + Lake View Villas + Sunrise Plots');
  assert.equal(payload.category, sectorOf('real_estate').label);
  assert.equal(payload.website, 'https://green.example.com');
  assert.equal(payload.detailsDone, true);
  assert.match(payload.details, /Green Heights: price 45 lakh onwards; offer Free site visit; selling points Near metro/);
  assert.equal(payload.adItems.length, 3);
  assert.deepEqual(payload.adItems[0].points, ['Near metro', '2 min to school']);
  assert.equal(payload.adItems[2].id, null);
  assert.equal(payload.offeringChoices, undefined);
  assert.ok(itemsReady(payload));
  assert.ok(MAX_AD_ITEMS >= 3);
  assert.equal(offeringFacts({ name: 'x' }), '');
});

test('multi item plan shows one ad set per item with the budget split', () => {
  const text = itemsSection({
    dailyBudget: 900,
    itemCopies: [
      { name: 'Green Heights', headline: 'Homes near metro', message: 'Book a visit' },
      { name: 'Lake View Villas', headline: 'Villas by the lake', message: 'Enquire now' },
      { name: 'Sunrise Plots', headline: 'Plots from 20 lakh', message: 'Call today' }
    ]
  }, true);
  assert.match(text, /Ad sets \(3, one per item\)/);
  assert.match(text, /300/);
  assert.match(text, /3\. Sunrise Plots/);
});

test('every sector has its own catalog types and form examples', () => {
  for (const key of SECTOR_KEYS) {
    const catalog = catalogFor(key);
    assert.ok(catalog.kinds.length >= 3, key);
    assert.equal(catalog.kinds.at(-1).key, 'other', key);
    assert.ok(catalog.kinds.every((kind) => /^[a-z_]{2,40}$/.test(kind.key) && kind.label), key);
    assert.equal(new Set(catalog.kinds.map((kind) => kind.key)).size, catalog.kinds.length, key);
    for (const field of ['name', 'details', 'usps', 'offer', 'price', 'locationLabel', 'location']) assert.ok(catalog.fields[field], `${key} ${field}`);
  }
  assert.equal(catalogFor('real_estate').kinds[0].label, 'Residential project');
  assert.equal(catalogFor('real_estate').fields.locationLabel, 'PROJECT LOCATION');
  assert.equal(catalogFor('nope').sector, '');
  assert.equal(kindForSector('real_estate'), 'residential_project');
  assert.equal(kindForSector('real_estate', 'plots'), 'plots');
  assert.equal(kindForSector('real_estate', 'dish'), 'residential_project');
});

test('save question and catalog input are checked', () => {
  assert.equal(saveAnswer('Haan, save karo'), 'yes');
  assert.equal(saveAnswer('Nahi, sirf is ad ke liye'), 'no');
  assert.equal(saveAnswer('kya?'), '');
  assert.equal(cleanText('Call 98765 43210 or a@b.co for Green Heights', 200), 'Call or for Green Heights');
  const good = offeringSchema.safeParse({ body: { kind: 'project', name: 'Green Heights', website: 'https://green.example.com' }, query: {}, params: {} });
  assert.ok(good.success);
  assert.equal(good.data.body.status, 'active');
  assert.equal(offeringSchema.safeParse({ body: { kind: 'project', name: 'Green Heights', website: 'http://green.example.com' }, query: {}, params: {} }).success, false);
  assert.equal(imageUploadSchema.safeParse({ body: { imageBase64: 'x' }, query: {}, params: {} }).success, false);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200)]);
  assert.equal(imageBytes(png.toString('base64')).mime, 'image/png');
  assert.throws(() => imageBytes(Buffer.alloc(200).toString('base64')), /JPG or PNG/);
});

test('sectors are complete and give guidance, not claims', () => {
  assert.equal(new Set(SECTOR_KEYS).size, SECTORS.length);
  for (const sector of SECTORS) {
    assert.ok(sector.label && sector.leadPath, sector.key);
    assert.ok(sector.goals.length >= 3, sector.key);
    assert.equal(new Set(sector.goals.map((goal) => goal.key)).size, sector.goals.length, sector.key);
    for (const goal of sector.goals) assert.ok(GOAL_LABELS[goal.key] && goal.when, `${sector.key} ${goal.key}`);
    assert.ok(sector.angles.length && sector.creatives.length && sector.kpis.length, sector.key);
  }
  assert.equal(sectorOf('real_estate').special, 'HOUSING');
  assert.equal(sectorOf('nope'), null);
  assert.deepEqual(sectorFacts(''), []);
  const facts = sectorFacts('edtech').join('\n');
  assert.match(facts, /Business sector: /);
  assert.match(facts, /general guidance, not facts/);
  assert.match(facts, /never assume leads/);
  assert.match(facts, /awareness \(/);
});

test('meta goal choices list every sector goal, or all goals without a sector', () => {
  const restaurant = goalChoices(sectorOf('restaurant'), true);
  assert.ok(restaurant.indexOf('*awareness*') < restaurant.indexOf('*leads*'));
  assert.match(restaurant, /Table bookings/);
  const plain = goalChoices(null, true);
  for (const key of ['leads', 'appointments', 'sales', 'awareness', 'traffic']) assert.match(plain, new RegExp(`\\*${key}\\*`));
});

test('the first ad question fits the business sector', () => {
  const estate = productAsk('real_estate', false);
  assert.match(estate.question, /property/);
  assert.match(estate.example, /2BHK flats/);
  assert.doesNotMatch(estate.example, /salon|coaching/i);
  assert.match(productAsk('edtech', true).question, /course or batch/);
  assert.match(productAsk('', true).question, /What should the ad sell/);
  for (const key of SECTOR_KEYS) assert.ok(productAsk(key, true).question.length > 10, key);
});

test('sector reaches the ad planner facts', () => {
  const facts = intakeFacts({ product: 'Flats' }, { sector: 'real_estate' }).join('\n');
  assert.match(facts, /Business sector: Real estate/);
  assert.match(facts, /suggest only, never force/);
  assert.doesNotMatch(intakeFacts({ product: 'Flats' }, { category: 'Shop' }).join('\n'), /Business sector/);
});

test('office city is told to the planner as the office, not the ad target', () => {
  const facts = intakeFacts({ product: 'Online course' }, { officeCity: 'Indore' }).join('\n');
  assert.match(facts, /Office city \(where the business sits; not automatically where buyers are\): Indore/);
  assert.doesNotMatch(facts, /Target locations/);
});

test('city suggestions show a reason each and flag an office city left out', () => {
  const suggestion = {
    cities: ['Bangalore', 'Pune'],
    cityNotes: [{ city: 'bangalore', why: 'Most IT buyers' }],
    officeCity: 'Indore'
  };
  assert.deepEqual(cityChoices(suggestion), ['Bangalore - Most IT buyers', 'Pune']);
  assert.match(officeCityNote(suggestion, true), /office is in Indore/);
  assert.equal(officeCityNote({ ...suggestion, cities: ['Indore', 'Bhopal'] }, true), '');
  assert.equal(officeCityNote({ cities: ['Pune'] }, true), '');
});

test('city taps add and remove one by one, then Done, Best or typed names finish', () => {
  const suggestion = { cities: ['Noida', 'Gurgaon', 'Ghaziabad'], bestCities: ['gurgaon'], cityNotes: [{ city: 'Noida', why: 'Project city' }] };
  let pick = cityPick('Noida', suggestion, []);
  assert.deepEqual(pick, { kind: 'toggle', picked: ['Noida'], added: true, city: 'Noida' });
  pick = cityPick('Gurgaon', suggestion, pick.picked);
  assert.deepEqual(pick.picked, ['Noida', 'Gurgaon']);
  assert.deepEqual(cityPick('✓ Noida', suggestion, pick.picked).picked, ['Gurgaon']);
  assert.deepEqual(cityPick('Done', suggestion, ['Noida', 'Gurgaon']), { kind: 'final', names: ['Noida', 'Gurgaon'] });
  assert.deepEqual(cityPick('done', suggestion, []), { kind: 'empty' });
  assert.deepEqual(cityPick('Best pick', suggestion, []), { kind: 'final', names: ['Gurgaon'] });
  assert.deepEqual(bestCities({ cities: ['A', 'B', 'C'] }), ['A', 'B']);
  assert.equal(cityPick('Delhi, Pune', suggestion, []), null);
  assert.equal(cityPick('All suggested', suggestion, []), null);
});

test('meta radius reads taps and typed km, inside Meta limits', () => {
  assert.deepEqual(radiusFrom('City only'), { km: 0 });
  assert.deepEqual(radiusFrom('sirf city'), { km: 0 });
  assert.deepEqual(radiusFrom('+25 km'), { km: 25, asked: 25, adjusted: false });
  assert.deepEqual(radiusFrom('10 km'), { km: 17, asked: 10, adjusted: true });
  assert.deepEqual(radiusFrom('150km'), { km: 80, asked: 150, adjusted: true });
  assert.deepEqual(radiusFrom('3'), { km: 25 });
  assert.equal(radiusFrom('haan'), null);
  const located = withRadius([{ key: '1', name: 'Noida', radiusMode: 'city' }], 40);
  assert.deepEqual(located, [{ key: '1', name: 'Noida', radiusMode: 'radius', radius: 40 }]);
  assert.deepEqual(withRadius(located, 0), [{ key: '1', name: 'Noida', radiusMode: 'city' }]);
  const menu = radiusMenu([{ km: 0, sizeLow: 4000000, sizeHigh: 4700000 }, { km: 25, sizeLow: null, sizeHigh: null }], false);
  assert.equal(menu.rows[0].title, 'City only');
  assert.match(menu.rows[0].description, /40 lakh-47 lakh log/);
  assert.match(menu.rows[1].description, /andaaza nahi mila/);
  for (const row of menu.rows) assert.ok(row.title.length <= 24 && row.description.length <= 72 && /^radius_/.test(row.id));
});

test('google location step shows real monthly searches only', () => {
  const text = demandSection([{ text: '2bhk flats noida', searches: 5400 }, { text: 'flats noida', searches: null }], true);
  assert.match(text, /2bhk flats noida: \*5,400\*/);
  assert.doesNotMatch(text, /null/);
  assert.equal((text.match(/: \*/g) || []).length, 1);
  assert.match(demandSection([], true), /did not return search numbers/);
});

test('cities outside the list can be added and removed by text', () => {
  for (const value of ['Add other city', 'other city', 'apni city likho', 'aur city add karo', 'doosri city']) assert.equal(wantsOtherCity(value), true, value);
  for (const value of ['Lucknow', 'Noida', 'other city Lucknow ok?']) assert.equal(wantsOtherCity(value), false, value);
  assert.deepEqual(droppedCity('remove Lucknow', ['Noida', 'Lucknow']), { city: 'Lucknow', picked: ['Noida'] });
  assert.deepEqual(droppedCity('lucknow hatao', ['Noida', 'Lucknow']), { city: 'Lucknow', picked: ['Noida'] });
  assert.equal(droppedCity('remove Pune', ['Noida']), null);
  assert.equal(droppedCity('Lucknow', ['Lucknow']), null);
  assert.equal(meansAll('All suggested'), true);
  assert.equal(meansAll('Lucknow'), false);
});

test('city menu fits WhatsApp list limits and marks picked cities', () => {
  const suggestion = { cities: ['Noida', 'Gurgaon', 'Ghaziabad', 'Delhi', 'Faridabad', 'Greater Noida'], bestPick: 'Start with Noida and Gurgaon', cityNotes: [{ city: 'Noida', why: 'Project city' }] };
  const menu = cityMenu(suggestion, ['Noida'], true);
  assert.ok(menu.rows.length <= 10);
  assert.equal(menu.rows[0].title, 'Done');
  assert.ok(menu.rows.some((row) => row.title === '✓ Noida'));
  assert.ok(menu.rows.some((row) => row.title === 'All India'));
  assert.ok(menu.rows.some((row) => row.title === 'Add other city'));
  assert.equal(cityMenu(suggestion, [], true).rows.filter((row) => !['city_best', 'city_all', 'city_other', 'city_india'].includes(row.id)).length, 6);
  for (const row of menu.rows) {
    assert.ok(row.title.length <= 24 && (row.description || '').length <= 72);
    assert.match(row.id, /^city_/);
  }
  assert.equal(new Set(menu.rows.map((row) => row.id)).size, menu.rows.length);
  assert.equal(cityMenu({ cities: [] }, [], true), null);
  const message = menuMessage(menu);
  assert.equal(message.interactive.type, 'list');
  assert.ok(message.interactive.action.button.length <= 20);
});

test('organization form accepts only known sectors', () => {
  const ok = organizationSchema.safeParse({ body: { name: 'Acme Homes', sector: 'real_estate' }, query: {}, params: {} });
  assert.equal(ok.success, true);
  assert.equal(ok.data.body.city, '');
  assert.equal(organizationSchema.safeParse({ body: { name: 'Acme Homes', sector: 'space_mining' }, query: {}, params: {} }).success, false);
  assert.equal(organizationSchema.safeParse({ body: { name: 'Acme Homes' }, query: {}, params: {} }).success, false);
});

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

test('meta chat budget reads the first amount only', () => {
  assert.equal(budgetAmount('Budget is 590'), 590);
  assert.equal(budgetAmount('Rs.500 leads'), 500);
  assert.equal(budgetAmount('5k leads'), 5000);
  assert.equal(budgetAmount('1.5k daily'), 1500);
  assert.equal(budgetAmount('1,200 leads for 2 bhk'), 1200);
  assert.equal(budgetAmount('500 leads 2 bhk'), 500);
  assert.equal(budgetAmount('leads'), 0);
  assert.equal(budgetAmount('1 lakh monthly leads'), 3333);
  assert.equal(budgetAmount('30k per month'), 1000);
});

test('meta interests drop other meanings and tiny topics', () => {
  assert.equal(usableInterest({ id: '1', name: 'Real Estate (band)', path: 'Interests > Additional interests > Real Estate (band)', sizeHigh: 900000 }), false);
  assert.equal(usableInterest({ id: '2', name: 'Home loans', path: 'Interests > Business and industry > Banking', sizeHigh: 30000 }), false);
  assert.equal(usableInterest({ id: '3', name: 'Real estate', path: 'Interests > Business and industry > Real estate', sizeHigh: 90000000 }), true);
  assert.equal(usableInterest({ id: '4', name: 'Music', path: 'Interests > Entertainment > Music', sizeHigh: null }), true);
  assert.equal(peopleCount(12500000), '1.3 crore');
  assert.equal(peopleCount(450000), '4.5 lakh');
  assert.equal(peopleCount(52000), '52k');
});

test('long whatsapp replies split on blank lines under the limit', () => {
  const block = 'x'.repeat(1500);
  const parts = messageParts([block, block, block].join('\n\n'), 3800);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((part) => part.length <= 3800));
  assert.deepEqual(messageParts('short'), ['short']);
});

test('meta campaign name says what, where and the goal', () => {
  const name = campaignName({ product: 'new flats', region: 'Delhi; Noida; Gurgaon', conversion: 'messenger', objectiveLabel: 'leads' });
  assert.match(name, /^New Flats \| Delhi, Noida \+1 \| Leads \(Messenger\) \| \d{2} \w{3}$/);
  assert.match(campaignName({ product: 'Hi', category: 'Hi', pageName: 'Kala Akchar', objectiveLabel: 'appointments', conversion: 'instant_form' }), /^Kala Akchar \| India \| Appointments \|/);
  assert.equal(campaignName({ campaignName: 'Kept' }), 'Kept');
});

test('meta chat understands design approval in plain words', () => {
  const picks = (text) => USE_DESIGN.test(text) && !NOT_DESIGN.test(text);
  for (const text of ['Save kro', 'Inhi designs ko lga ke publish kro', 'Inhi design ko rakho', 'ok', 'yahi final hai', 'design']) {
    assert.ok(picks(text), text);
  }
  for (const text of ['nahi ye design pasand nahi', 'design badlo', 'kya ye sahi hai?']) {
    assert.ok(!picks(text), text);
  }
  assert.ok(RAW_PHOTO.test('meri photo original lagao'));
});

test('ad design text keeps units together and fits the line limit', () => {
  const lines = wrapText('Ready to move 2 BHK in Noida Extension', 92, 400, true);
  assert.ok(lines.some((line) => line.includes('2\u00A0BHK')));
  assert.ok(!lines.some((line) => /^BHK/.test(line)));
  const fitted = fitText('A very long headline that keeps going and going well past four lines of text', { maxWidth: 300, maxLines: 2, start: 60, min: 40, bold: true });
  assert.equal(fitted.lines.length, 2);
  assert.ok(fitted.size >= 40 && fitted.size <= 60);
  assert.equal(ctaLabel('SIGN_UP'), 'Enquire Now');
  assert.equal(ctaLabel('UNKNOWN'), 'Learn More');
});

test('ad design svg escapes text and renders one png per variant', () => {
  const svg = creativeSvg({ headline: 'Flats <2 BHK> & more', points: ['Near metro'], cta: 'SIGN_UP', business: 'Test & Co', link: 'https://www.test.in/page' });
  assert.match(svg, /Flats &lt;2 BHK&gt; &amp;/);
  assert.ok(!svg.includes('<2 BHK>'));
  assert.match(svg, /test\.in/);
  assert.deepEqual(creativePoints({ sellingPoints: ['Pool', 'pool'], suggestion: { sellingPoints: ['Gym'] } }), ['pool', 'Gym']);
  const pngs = variantCreatives({ cta: 'LEARN_MORE', variants: [{ headline: 'One' }, { headline: 'Two' }, { headline: 'Three' }] });
  assert.equal(pngs.length, 2);
  for (const png of pngs) assert.equal(png[0], 0x89);
});

test('meta lead form names are unique per attempt and within 100 characters', () => {
  const long = 'Green Heights | Noida, Gurgaon +2 | Leads | 06 Oct'.repeat(3);
  const first = leadFormName(long, new Date('2026-10-06T13:18:00Z'));
  const second = leadFormName(long, new Date('2026-10-06T13:18:05Z'));
  assert.notEqual(first, second);
  assert.ok(first.length <= 100);
  assert.match(first, / form 2026-10-06 13:18:00$/);
});

test('ad ranking scores against same-kind peers and waits for enough data', () => {
  const base = { platform: 'meta', level: 'ad', currency: 'INR', metric: 'results', resultLabel: 'leads' };
  const { items, benchmarks } = rankAds([
    { ...base, key: 'a', name: 'Cheap leads', spend: 3000, impressions: 40000, clicks: 800, results: 30 },
    { ...base, key: 'b', name: 'Typical', spend: 3000, impressions: 40000, clicks: 500, results: 15 },
    { ...base, key: 'c', name: 'No leads', spend: 3000, impressions: 40000, clicks: 300, results: 0 },
    { ...base, key: 'd', name: 'New ad', spend: 100, impressions: 300, clicks: 4, results: 0 },
    { ...base, key: 'e', name: 'Traffic ad', metric: 'clicks', spend: 2000, impressions: 30000, clicks: 600, results: 0 }
  ], { minSpend: 500 });
  const by = Object.fromEntries(items.map((row) => [row.key, row]));
  assert.equal(items[0].key, 'a');
  assert.equal(by.a.verdict, 'strong');
  assert.equal(by.c.verdict, 'weak');
  assert.match(by.c.reasons[0], /no leads/);
  assert.equal(by.d.verdict, 'learning');
  assert.equal(by.d.score, null);
  assert.equal(by.e.verdict, 'alone');
  assert.ok(by.a.score > by.b.score && by.b.score > by.c.score);
  assert.equal(benchmarks.find((row) => row.metric === 'results').costPerResult, 150);
  const meta = campaignMetric([{ campaignId: 1, results: 3 }, { campaignId: 2, results: 0 }], (row) => row.campaignId);
  assert.equal(meta({ campaignId: 1 }), 'results');
  assert.equal(meta({ campaignId: 2 }), 'clicks');
});

test('whatsapp ad analysis is asked in plain words and answered without invented numbers', () => {
  assert.ok(wantsAdsAnalysis('kaun sa ad sabse achha chal raha hai'));
  assert.ok(wantsAdsAnalysis('analyze my ads'));
  assert.ok(wantsAdsAnalysis('best campaign last 30 days'));
  assert.ok(!wantsAdsAnalysis('run meta ads for best flats'));
  assert.ok(!wantsAdsAnalysis('ads report'));
  assert.equal(analysisDays('last 30 days'), 30);
  assert.equal(analysisDays('is hafte'), 7);
  assert.equal(analysisDays('kaunsa ad'), 14);
  assert.match(analysisText({ days: 14, items: [], counts: {}, notes: [] }, true), /No ad data/);
  const text = analysisText({
    days: 14,
    counts: { total: 2, strong: 1, average: 0, weak: 1, learning: 0 },
    notes: [],
    items: [
      { name: 'Green Heights A', platform: 'meta', level: 'ad', currency: 'INR', score: 80, verdict: 'strong', costPerResult: 150.4, resultLabel: 'leads', results: 20, ctr: 2.1, spend: 3008, madeByAiro: true },
      { name: 'Old banner', platform: 'meta', level: 'ad', currency: 'INR', score: 20, verdict: 'weak', costPerResult: null, resultLabel: 'leads', results: 0, cpc: 12.5, ctr: 0.4, spend: 2500 }
    ]
  }, false);
  assert.match(text, /Sabse achhe chal rahe\*\n1\. \*Green Heights A\* \(Meta, AIRO\) · score 80 · ₹150\/lead/);
  assert.match(text, /Sabse kamzor\*\n1\. \*Old banner\* \(Meta\) · score 20 · ₹13\/click/);
});

test('ad design puts the uploaded logo on the image', () => {
  const logo = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]).toString('base64');
  assert.match(creativeSvg({ headline: 'Homes', cta: 'LEARN_MORE', logoBase64: logo }), /data:image\/png;base64,/);
  assert.doesNotMatch(creativeSvg({ headline: 'Homes', cta: 'LEARN_MORE' }), /<image/);
});
test('meta rate limit errors are recognised by code or message', () => {
  assert.equal(isMetaRateLimit({ code: 17, message: 'User request limit reached' }), true);
  assert.equal(isMetaRateLimit({ code: 80004, message: 'There have been too many calls from this ad account. Please wait a bit and try again.' }), true);
  assert.equal(isMetaRateLimit({ code: 100, message: 'Invalid parameter' }), false);
});

test('airo ad score rates the creative out of 100 and explains gaps', () => {
  const full = creativeScore({ headline: '2 & 3 BHK flats in Noida', text: 'Ready to move 2 and 3 BHK flats from Rs 45 lakh near the metro. Book a site visit this week.', cta: 'SIGN_UP', visual: 'image', leadForm: true });
  assert.equal(full.score, 100);
  assert.deepEqual(full.reasons, []);
  const thin = creativeScore({ headline: 'Hi', text: 'Hi', cta: 'LEARN_MORE', visual: '' });
  assert.ok(thin.score < 50);
  assert.ok(thin.reasons.includes('No image or video.'));
  assert.equal(creativeScore({}).score, null);
});

test('airo ad score blends results once an ad has enough data', () => {
  const base = { campaignId: '1', currency: 'INR', headline: 'Flats in Noida from 45L', text: 'Ready to move flats from Rs 45 lakh near the metro, book a visit.', cta: 'SIGN_UP', visual: 'image', leadForm: true };
  const scores = scoreAds([
    { ...base, id: 'a', spend: 1000, impressions: 5000, clicks: 100, leads: 10 },
    { ...base, id: 'b', spend: 1000, impressions: 5000, clicks: 50, leads: 2 },
    { ...base, id: 'c', spend: 0, impressions: 0, clicks: 0, leads: 0 }
  ], { minSpend: 500 });
  assert.equal(scores.a.basis, 'results_and_creative');
  assert.ok(scores.a.score > scores.b.score);
  assert.equal(scores.c.basis, 'creative');
  assert.equal(scores.c.score, scores.c.creativeScore);
});

test('catalogFacts lists saved projects for the WhatsApp reply', () => {
  assert.match(catalogFacts([]), /none saved yet/);
  const text = catalogFacts([{ name: 'Prestige Park', kind: 'project', locations: 'Noida', priceText: '80 lakh onwards', offer: '' }]);
  assert.match(text, /Saved products\/projects\/services \(1/);
  assert.match(text, /1\. Prestige Park - type project; location Noida; price 80 lakh onwards/);
  assert.doesNotMatch(text, /offer/);
});

test('website form fields: plain HTML, WordPress Contact Form 7 and Elementor', () => {
  const plain = pickContact(flattenFields({ name: 'Ravi Kumar', phone: '+91 98765 43210', email: 'ravi@example.com', city: 'Noida', message: 'Need 2 BHK', _wpnonce: 'x', password: 'secret' }));
  assert.deepEqual(plain, { name: 'Ravi Kumar', phone: '+91 98765 43210', email: 'ravi@example.com', city: 'Noida', message: 'Need 2 BHK' });
  const cf7 = pickContact(flattenFields({ 'your-name': 'Asha', 'your-email': 'asha@example.com', 'your-tel': '9876501234', _wpcf7: '12' }));
  assert.equal(cf7.name, 'Asha');
  assert.equal(cf7.phone, '9876501234');
  const elementor = pickContact(flattenFields({ form: { id: 'a1' }, fields: { name: { title: 'Name', value: 'Neha' }, field_2: { title: 'Mobile', value: '98111 22233' } } }));
  assert.equal(elementor.name, 'Neha');
  assert.equal(elementor.phone, '98111 22233');
  const split = pickContact(flattenFields({ first_name: 'Amit', last_name: 'Shah', mobile: '9000000001' }));
  assert.equal(split.name, 'Amit Shah');
  assert.equal(pickContact(flattenFields({ name: 'No phone', email: 'a@b.co' })).phone, '');
  assert.equal(flattenFields({ card_number: '4111', cvv: '1' }).card_number, undefined);
});

test('website form attribution splits Google Ads, Meta Ads and the website', () => {
  assert.equal(attribution({ gclid: 'abc' }).channel, 'google');
  assert.equal(attribution({ airo_landing: 'https://site.in/?gad_source=1&gad_campaignid=2233445566' }).campaignId, '2233445566');
  assert.equal(attribution({ utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Noida 2BHK' }).campaignName, 'Noida 2BHK');
  assert.equal(attribution({ utm_source: 'google', utm_medium: 'organic' }).channel, 'website');
  const meta = attribution({ utm_source: 'facebook', utm_medium: 'paid', utm_id: '120210000000001' });
  assert.equal(meta.channel, 'meta');
  assert.equal(meta.campaignId, '120210000000001');
  assert.equal(attribution({ utm_source: 'ig' }).channel, 'meta');
  assert.equal(attribution({ utm_source: 'facebook', utm_medium: 'organic' }).channel, 'website');
  assert.equal(attribution({ airo_page: 'https://site.in/contact?fbclid=xyz' }).channel, 'meta');
  assert.equal(attribution({}).channel, 'website');
});

test('website form check finds the current code, an old code, or nothing', () => {
  const token = 'a'.repeat(64);
  assert.equal(codeState(`<script>var AIRO = 'https://x.in/api/forms/${token}';</script>`, token), 'found');
  assert.equal(codeState(`var AIRO='https://x.in/api/forms/${'b'.repeat(64)}'`, token), 'old_code');
  assert.equal(codeState('<html><body>Hello</body></html>', token), '');
  const scripts = scriptSources('<script src="/wp-content/cache/min.js?ver=1&amp;x=2"></script><script src="https://cdn.other.com/a.js"></script><script src=\'app.js\'></script>', 'https://site.in/projects/');
  assert.deepEqual(scripts, ['https://site.in/wp-content/cache/min.js?ver=1&x=2', 'https://site.in/projects/app.js']);
});

test('competitor page reading keeps text, headings and prices, and drops scripts', () => {
  const html = `<html><head><title>Skyline &amp; Co</title><meta name="description" content="Luxury 3 BHK in Noida"><script>var x = "hidden";</script></head>
    <body><h1>Skyline Towers</h1><p>3 BHK from &#8377; 1.2 Cr onwards</p><div>2 BHK Rs 85 lakh</div><style>.a{}</style></body></html>`;
  const page = pageText(html);
  assert.equal(page.title, 'Skyline & Co');
  assert.equal(page.description, 'Luxury 3 BHK in Noida');
  assert.deepEqual(page.headings, ['Skyline Towers']);
  assert.ok(!page.text.includes('hidden'));
  assert.deepEqual(pricesIn(page.text), ['\u20b9 1.2 Cr onwards', 'Rs 85 lakh']);
});

test('competitor crawl follows only useful links on the same site', () => {
  const html = `<a href="/projects/skyline">Skyline</a><a href="https://www.skyline.example/pricing">Prices</a>
    <a href="https://other.example/projects">Other site</a><a href="/brochure.pdf">Brochure</a><a href="#top">Top</a>
    <a href="/blog/news">News</a><a href="/projects/skyline#plans">Plans</a><a href="mailto:a@b.c">Mail</a>`;
  const links = samePageLinks(html, 'https://skyline.example/', 5);
  assert.deepEqual(links.sort(), ['https://skyline.example/projects/skyline', 'https://www.skyline.example/pricing'].sort());
});

test('competitor form accepts plain domains and rejects junk links', () => {
  const parse = (body) => competitorSchema.safeParse({ body, query: {}, params: {} });
  assert.equal(parse({ name: 'Skyline', website: 'skyline.example.com' }).success, true);
  assert.equal(parse({ name: 'Skyline', website: 'https://skyline.example.com/projects' }).success, true);
  assert.equal(parse({ name: 'Skyline', website: 'not a link' }).success, false);
  assert.equal(parse({ name: 'S' }).success, false);
});

test('competitor analysis output is trimmed and unknown values fall back safely', () => {
  const result = analysisSchema.safeParse({
    summary: 'They sell 3 BHK flats in Noida Sector 150 from 1.2 Cr.',
    threat: 'HIGH',
    offerings: [{ name: 'Skyline Towers', highlights: 'not a list' }],
    comparison: [{ ours: 'Green Heights', theirs: 'Skyline Towers', verdict: 'maybe' }],
    strengths: Array.from({ length: 10 }, (_, i) => `point ${i}`)
  });
  assert.equal(result.success, true);
  assert.equal(result.data.threat, 'high');
  assert.deepEqual(result.data.offerings[0].highlights, []);
  assert.equal(result.data.comparison[0].verdict, 'unclear');
  assert.equal(result.data.strengths.length, 6);
  assert.equal(analysisSchema.safeParse({ summary: '' }).success, false);
});

test('competitor facts carry page urls, prices and keyword data within budget', () => {
  const facts = analysisFacts({
    competitor: { name: 'Skyline', city: 'Noida', website: 'https://skyline.example', notes: '' },
    pages: [{ url: 'https://skyline.example/', title: 'Skyline', description: '', headings: ['Skyline Towers'], text: 'x'.repeat(20000), prices: ['Rs 85 lakh'] }],
    keywords: { currency: 'INR', rows: [{ text: 'skyline noida', searches: '880', competition: 'HIGH' }] },
    ours: catalogFacts(SAVED),
    sector: 'Real estate'
  });
  assert.ok(facts.includes('PAGE https://skyline.example/'));
  assert.ok(facts.includes('Prices seen: Rs 85 lakh'));
  assert.ok(facts.includes('skyline noida: 880/mo, HIGH'));
  assert.ok(facts.includes('Green Heights'));
  assert.ok(facts.length < 6000);
});

test('discovery reads domains and leaves out portals, directories and social sites', () => {
  assert.equal(domainOf('https://www.Skyline.example/lp?gclid=1'), 'skyline.example');
  assert.equal(domainOf('skyline.example'), 'skyline.example');
  assert.equal(domainOf(''), '');
  assert.equal(notCompetitor('99acres.com'), true);
  assert.equal(notCompetitor('noida.justdial.com'), true);
  assert.equal(notCompetitor('wa.me'), true);
  assert.equal(notCompetitor('skyline.example'), false);
  assert.ok(adLibraryUrl('3 bhk noida').includes('q=3+bhk+noida'));
  assert.ok(adLibraryUrl('3 bhk noida').includes('country=IN'));
});

test('discovery merges one business seen on Google, Meta and Maps and skips our own and known names', () => {
  const rows = collectCandidates({
    google: [{
      searchQuery: { term: '3 bhk flats noida' },
      paidResults: [{ title: 'Skyline Towers | Skyline Group', url: 'https://www.skyline.example/lp' }],
      organicResults: [
        { title: '3 BHK in Noida', url: 'https://www.99acres.com/x', position: 1 },
        { title: 'Skyline Group - Projects', url: 'https://skyline.example/projects', position: 2 },
        { title: 'Green Heights', url: 'https://green.example.com', position: 3 },
        { title: 'Old Rival', url: 'https://oldrival.example', position: 4 }
      ]
    }],
    meta: [
      { pageID: '9', pageName: 'Skyline Group', inputUrl: 'https://www.facebook.com/ads/library/?q=3%20bhk%20noida', snapshot: { linkUrl: 'https://skyline.example/offer' } },
      { pageID: '7', pageName: 'Metro Homes', snapshot: { linkUrl: 'https://wa.me/91999' } },
      { pageID: '7', pageName: 'Metro Homes', snapshot: { linkUrl: 'https://metrohomes.example/' } },
      { pageID: '5', pageName: 'Green Builders', snapshot: { linkUrl: 'https://greenbuilders.example' } }
    ],
    maps: [
      { title: 'Metro Homes', website: 'https://metrohomes.example', totalScore: 4.4, reviewsCount: 80, categoryName: 'Real estate developer', city: 'Noida' },
      { title: 'Closed Co', permanentlyClosed: true }
    ],
    ownDomains: ['green.example.com'],
    knownDomains: ['oldrival.example'],
    orgName: 'Green Builders'
  });
  assert.deepEqual(rows.map((row) => row.key), ['skyline.example', 'metrohomes.example']);
  assert.deepEqual(rows[0].sources.map((source) => source.type), ['google_ad', 'google_search', 'meta_ad']);
  assert.equal(rows[0].sources[2].query, '3 bhk noida');
  assert.equal(rows[1].city, 'Noida');
  assert.ok(rows[1].sources.some((source) => source.note === '2 active ads'));
});

test('discovery plan and AI verdicts are checked before use', () => {
  assert.equal(planSchema.safeParse({ searches: [], adKeywords: ['x'] }).success, false);
  const plan = planSchema.safeParse({ searches: ['a', 'b', 'c', 'd', 'e'], adKeywords: 'x', location: 'Noida, India' });
  assert.equal(plan.success, true);
  assert.equal(plan.data.searches.length, 4);
  assert.deepEqual(plan.data.adKeywords, []);
  const verdicts = verdictSchema.parse({ items: [{ id: '2', verdict: 'DIRECT', reason: 'Same area' }, { id: 3, verdict: 'rival' }] });
  assert.equal(verdicts.items[0].id, 2);
  assert.equal(verdicts.items[0].verdict, 'direct');
  assert.equal(verdicts.items[1].verdict, 'unclear');
  assert.deepEqual(fallbackPlan({ profile: { category: 'Real estate', officeCity: 'Noida' } }).searches, ['real estate noida']);
  assert.equal(fallbackPlan({ profile: {} }), null);
});
test('project discovery searches only around the chosen project', () => {
  const project = { id: 7, kind: 'project', name: 'Green Heights', locations: 'Wakad, Pune', priceText: '80 lakh', details: '2 BHK flats' };
  const facts = planFacts({ profile: { officeCity: 'Noida', locations: ['Noida', 'Pune'] }, items: SAVED, sector: 'Real estate', orgName: 'Green Builders', project });
  assert.ok(facts.includes('PROJECT TO MATCH'));
  assert.ok(facts.includes('Wakad, Pune'));
  assert.ok(!facts.includes('Target areas'));
  assert.ok(planFacts({ profile: {}, items: SAVED, sector: '', orgName: 'X' }).includes('Saved products'));
  const plan = fallbackPlan({ profile: { category: 'Real estate', officeCity: 'Noida' }, project });
  assert.deepEqual(plan.searches, ['2 bhk flats wakad', '2 bhk flats pune', 'real estate pune']);
  assert.deepEqual(plan.adKeywords, ['2 bhk flats pune']);
  assert.equal(plan.location, 'pune, India');
});

test('without AI each project gets its own search words from its type and address', () => {
  assert.deepEqual(placeParts('Plot No. 21, Knowledge Park III, Greater Noida, Uttar Pradesh – 201308'), { area: 'Knowledge Park III', city: 'Greater Noida' });
  assert.deepEqual(placeParts('noida'), { area: '', city: 'noida' });
  const profile = { category: 'Real estate', officeCity: 'Noida' };
  const office = fallbackPlan({ profile, project: { kind: 'commercial_project', name: 'Biigtech', locations: 'Plot No. 21, Knowledge Park III, Greater Noida, Uttar Pradesh – 201308' } });
  const homes = fallbackPlan({ profile, project: { kind: 'residential_project', name: 'Saya', locations: 'Raj Nagar Extension, Ghaziabad' } });
  assert.deepEqual(office.adKeywords, ['commercial space greater noida']);
  assert.deepEqual(homes.adKeywords, ['flats ghaziabad']);
  assert.notDeepEqual(office.searches, homes.searches);
});

test('weekly search takes the business first and at most ten projects per business', () => {
  const projects = [
    ...Array.from({ length: 12 }, (_, i) => ({ organizationId: 1, offeringId: i + 1, searchedRecently: i === 0 ? 1 : 0 })),
    { organizationId: 2, offeringId: 50, searchedRecently: 0 }
  ];
  const due = dueScopes({ businesses: [{ organizationId: 3 }], projects, cap: 10, limit: 100 });
  assert.deepEqual(due[0], { organizationId: 3, offeringId: 0 });
  const orgOne = due.filter((row) => row.organizationId === 1).map((row) => row.offeringId);
  assert.deepEqual(orgOne, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(due.some((row) => row.offeringId === 50));
  assert.equal(dueScopes({ businesses: [], projects, limit: 6 }).length, 6);
});

test('a project suggestion that is already tracked is linked, not added twice', () => {
  const known = [{ id: 4, name: 'Skyline Group', website: 'https://www.skyline.example' }, { id: 5, name: 'Metro Homes', website: '' }];
  assert.equal(trackedMatch({ name: 'Skyline', website: 'https://skyline.example/lp' }, known)?.id, 4);
  assert.equal(trackedMatch({ name: 'metro homes', website: '' }, known)?.id, 5);
  assert.equal(trackedMatch({ name: 'New Co', website: 'https://new.example' }, known), null);
  assert.equal(domainOf(null), '');
  assert.equal(domainOf(undefined), '');
  assert.equal(trackedMatch({ name: 'Just Abode', website: null }, [{ id: 1, name: 'R-Tech Group', website: null }]), null);
  const parse = (body) => competitorSchema.safeParse({ body, query: {}, params: {} });
  assert.deepEqual(parse({ name: 'Skyline', offeringIds: ['3', 4] }).data.body.offeringIds, [3, 4]);
  assert.equal(parse({ name: 'Skyline' }).data.body.offeringIds, undefined);
  assert.equal(parse({ name: 'Skyline', offeringIds: [0] }).success, false);
  assert.equal(discoverSchema.parse({ body: {}, query: {}, params: {} }).body.offeringId, 0);
  assert.equal(discoverSchema.parse({ body: { offeringId: '9' }, query: {}, params: {} }).body.offeringId, 9);
});
test('a website is taken only when the result clearly belongs to that business', () => {
  const results = [
    { url: 'https://www.facebook.com/rtechgroup', title: 'R-Tech Group | Facebook' },
    { url: 'https://www.99acres.com/r-tech', title: 'R Tech Capital Highstreet' },
    { url: 'https://www.rtechgroup.in/', title: 'R-Tech Group - Commercial Projects Ghaziabad' }
  ];
  assert.equal(websiteFor('TRS Tamara', [{ url: 'https://trstamara.com', title: 'Luxury apartments' }]), 'https://trstamara.com');
  assert.equal(websiteFor('R-Tech Group', results), 'https://rtechgroup.in');
  assert.equal(websiteFor('Real Estate Investment', [{ url: 'https://realestateinvestment.example', title: 'Real estate investment' }]), '');
  assert.equal(websiteFor('Metro Homes', [{ url: 'https://other.example', title: 'Best flats' }]), '');
});
test('Google and Maps finds are not crowded out by Meta advertisers', () => {
  const row = (key, type, score) => ({ key, score, sources: [{ type }] });
  const meta = Array.from({ length: 20 }, (_, i) => row(`m${i}`, 'meta_ad', 30 - i));
  const rows = [...meta, row('g1', 'google_search', 3), row('p1', 'maps', 3), row('p2', 'maps', 2)];
  const top = balancedTop(rows, 15);
  assert.equal(top.length, 15);
  assert.ok(['g1', 'p1', 'p2'].every((key) => top.some((item) => item.key === key)));
  assert.equal(top[0].key, 'm0');
});
test('a busy AI model is waited out, other failures are not', () => {
  assert.equal(modelBusy(new Error('This model is currently experiencing high demand. Spikes in demand are usually temporary.')), true);
  assert.equal(modelBusy({ status: 503, message: 'x' }), true);
  assert.equal(modelBusy({ status: 429, message: 'x' }), true);
  assert.equal(modelBusy(new Error('API key not valid')), false);
  assert.equal(notCompetitor('realtyassistant.in'), true);
});
test('Keyword Planner access is read from the Google answer', async () => {
  const { plannerStatus } = await import('../services/connectionService.js');
  assert.equal(plannerStatus(null), 'ready');
  assert.equal(plannerStatus(new Error('This method is not allowed for use with explorer access. Please apply for basic or standard access.')), 'needs_basic');
  assert.equal(plannerStatus(new Error('Request had invalid authentication credentials.')), 'failed');
});
test('competitor ads: Meta and Google items are read into one shape with age and versions', () => {
  const now = Date.parse('2026-10-08T00:00:00Z');
  const meta = metaAd({
    adArchiveID: '111', pageName: 'Biigtech', pageID: '9', startDateFormatted: '2026-08-29T07:00:00.000Z', isActive: true,
    publisherPlatform: ['FACEBOOK', 'INSTAGRAM'], collationCount: 3,
    snapshot: { body: { text: 'Shops from {{product.price}} 25 Lakh' }, title: 'Greater Noida shops', ctaText: 'Learn more', linkUrl: 'https://www.biigtech.com/shops', images: [{ resizedImageUrl: 'https://img/1.jpg' }] }
  }, now);
  assert.equal(meta.days, 39);
  assert.equal(meta.versions, 3);
  assert.equal(meta.text, 'Shops from 25 Lakh');
  assert.deepEqual(meta.platforms, ['facebook', 'instagram']);
  assert.equal(meta.format, 'image');
  assert.equal(meta.url, 'https://www.facebook.com/ads/library/?id=111');

  const google = googleAd({ creativeId: 'CR1', advertiserName: 'Biigtech Pvt Ltd', format: 'TEXT', firstShown: '2026-10-03T00:00:00Z', lastShown: '2026-10-07T00:00:00Z', shownForDays: 4 }, now);
  assert.equal(google.active, true);
  assert.equal(google.days, 4);
  assert.equal(google.age, 5);
  const old = googleAd({ creativeId: 'CR2', firstShown: '2026-06-01T00:00:00Z', lastShown: '2026-07-01T00:00:00Z' }, now);
  assert.equal(old.active, false);
  assert.equal(old.days, 30);

  const stats = adStats([meta, { ...meta, id: '112', days: 3, age: 3, versions: 1 }, { ...meta, id: '113', active: false }]);
  assert.equal(stats.total, 3);
  assert.equal(stats.live, 2);
  assert.equal(stats.longRunning, 1);
  assert.equal(stats.newThisWeek, 1);
  assert.equal(stats.withVersions, 1);
  assert.equal(stats.averageDays, 21);
  assert.equal(stats.landing[0].key, 'biigtech.com');
});

test('competitor ads: name searches keep only the competitor own ads', () => {
  const competitor = { name: 'Biigtech Group', website: 'https://biigtech.com' };
  assert.equal(ownAd(competitor, { name: 'Some Broker', link: 'https://www.biigtech.com/x' }), true);
  assert.equal(ownAd(competitor, { name: 'BiigTech Official', link: '' }), true);
  assert.equal(ownAd(competitor, { name: 'Realty Assistant', link: 'https://realtyassistant.in' }), false);
  assert.equal(ownAd({ name: 'Real Estate Group', website: '' }, { name: 'Any Real Estate', link: '' }), false);
  assert.equal(facebookPage('https://www.facebook.com/biigtech'), 'https://www.facebook.com/biigtech');
  assert.equal(facebookPage('https://instagram.com/biigtech'), '');
});
