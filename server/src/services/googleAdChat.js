import { one, run } from '../db/sql.js';
import { decryptJson } from '../utils/cryptoBox.js';
import { createGoogleSearchCampaign, googleKeywordIdeas, setGoogleCampaignStatus, suggestGoogleLocations } from '../integrations/googleAds.js';
import { upsertObject } from '../repositories/connectionRepo.js';
import { recordAudit } from './auditService.js';
import { writeGoogleAdPlan } from './llmService.js';
import { LINE, bullets, card, field, header, hint, money, numbered, options, section, step as fmtStep } from './adsAgent/waFormat.js';
import {
  businessProfile, chosenNames, cityChoices, cityMenu, cityPick, droppedCity, hasProfileDetails, keywordCandidates, meansAll, officeCityNote, wantsOtherCity, resolveGoogleLocations, suggestTargeting, writeGoogleCopy
} from './adsAgent/chatPlanner.js';

const START = /\b(run|start|launch|create|chalao|chala|chalana|chalani|banao|bana|banana|banani|lagao|lagana)\b.{0,40}\bgoogle\b|\bgoogle\s+ads?\b.{0,24}\b(run|start|launch|create|chalao|chala|chalana|chalani|banao|bana|banana|banani|lagao|lagana)\b/i;
const CANCEL = /^(cancel|stop|ruk|band|nahi chahiye|nahin chahiye)\b/i;
const GREETING = /^(hi+|hello|hey|hlo|namaste|namaskar|good\s+(morning|afternoon|evening))[\s!.?]*$/i;
const YES = /^(ok|okay|haan|han|ha|yes|y|theek|thik|done|approve|approved|save|publish|live|chalao)\b/i;
const NO = /^(nahi|nahin|no|mat|pause|ruk)\b/i;
const APPROVAL_REPLY = /^(haan|han|ha|yes|y|publish|live|ok|okay|nahi|nahin|no|mat|pause|ruk)\b/i;
const AWAY = /\b(reports?|kitne|kitni|how many|kya hua|calls?)\b/i;
const HINGLISH = /\b(kya|hai|hain|karo|chahiye|bhejo|nahi|nahin|haan|mujhe|mera|meri|chalao|banao|ruk|theek|thik|yaar|kro)\b/i;
const STALE_HOURS = 24;
const MAX_KEYWORDS = 15;

function lastUser(messages) {
  const users = (messages || []).filter((row) => row.role === 'user');
  return String(users.at(-1)?.content || '').trim();
}

function englishOnly(text) {
  return !HINGLISH.test(String(text || ''));
}

function say(english, en, hi) {
  return english ? en : hi;
}

function langOf(draft, text) {
  if (draft.payload.lang === 'en' && englishOnly(text)) return true;
  if (HINGLISH.test(text)) return false;
  return draft.payload.lang === 'en';
}

function missingTable(error) {
  const code = error?.cause?.code || error?.code;
  return code === 'ER_NO_SUCH_TABLE';
}

function parsePayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

async function loadDraft(conversationId) {
  const row = await one(
    `SELECT id, step, payload, campaign_id AS campaignId,
       TIMESTAMPDIFF(HOUR, updated_at, NOW()) AS ageHours
     FROM google_ad_drafts WHERE conversation_id = ?`,
    [conversationId]
  );
  if (!row) return null;
  return { ...row, payload: parsePayload(row.payload) };
}

async function saveDraft(organizationId, conversationId, step, payload, campaignId = null) {
  await run(
    `INSERT INTO google_ad_drafts (organization_id, conversation_id, step, payload, campaign_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id), step = VALUES(step),
       payload = VALUES(payload), campaign_id = VALUES(campaign_id)`,
    [organizationId, conversationId, step, JSON.stringify(payload), campaignId]
  );
}

export async function clearGoogleDraft(conversationId) {
  try {
    await run(`DELETE FROM google_ad_drafts WHERE conversation_id = ?`, [conversationId]);
  } catch (error) {
    if (!missingTable(error)) throw error;
  }
}

async function clearMetaDraft(conversationId) {
  try {
    const result = await run(`DELETE FROM meta_ad_drafts WHERE conversation_id = ? AND step <> 'done'`, [conversationId]);
    return Number(result?.affectedRows || 0) > 0;
  } catch (error) {
    if (missingTable(error)) return false;
    throw error;
  }
}

export async function googleAccount(organizationId) {
  const row = await one(
    `SELECT c.id, c.status, c.mode, cred.ciphertext
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND p.provider_key = 'google_ads' AND c.status = 'connected' AND c.mode = 'live'
     ORDER BY c.id
     LIMIT 1`,
    [organizationId]
  );
  if (!row?.ciphertext || row.status !== 'connected' || row.mode !== 'live') return null;
  let secret;
  try { secret = decryptJson(row.ciphertext); } catch { return null; }
  if (!secret?.apiKey || secret.verified !== true || !secret.accountId) return null;
  return {
    connectionId: row.id,
    input: {
      refreshToken: secret.apiKey,
      accountId: secret.accountId,
      loginCustomerId: secret.loginCustomerId || '',
      currency: secret.currency || ''
    }
  };
}

function connectLine(english) {
  return say(
    english,
    'Google Ads is not connected for this business. Open AIRO, then Connections, Advertising, Google Ads, and press Connect with Google.',
    'Is business pe Google Ads connected nahi hai. AIRO mein Connections, Advertising, Google Ads kholo aur Connect with Google dabao.'
  );
}

function notRegistered(english) {
  return say(
    english,
    'This WhatsApp number is not registered to a business in AIRO. A Google ad can only be created for a registered business number.',
    'Yeh WhatsApp number kisi business se registered nahi hai. Google ad sirf registered business number se banta hai.'
  );
}

function httpsWebsite(text) {
  const match = String(text || '').match(/https?:\/\/[^\s]+/i);
  if (!match) return '';
  try {
    const url = new URL(match[0].replace(/[),.;]+$/, ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

function noWebsite(text) {
  const value = String(text || '').toLowerCase().trim();
  if (/^(no|nahi|nahin|nhi|none)$/.test(value)) return true;
  return /web\s*si|website|site\b|link\b/.test(value) && /don'?t|do not|nahi|nahin|nhi|no\b|without|not have|nai/.test(value);
}

function indiaWide(text) {
  return /\b(all india|poora india|poore india|pan india|entire india|india only)\b/i.test(text) || /^(india|bharat)$/i.test(text.trim());
}

function cleanHeadline(text) {
  return String(text || '').replace(/!/g, '').replace(/\s+/g, ' ').trim();
}

function uniqueTexts(list, max, limit) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const key = text.toLowerCase();
    if (!text || text.length > max || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function lineValues(text, name) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.match(new RegExp(`^\\s*${name}\\s*\\d*\\s*:\\s*(.+)$`, 'i'))?.[1] || '')
    .filter(Boolean);
}

function fallbackCopy(payload) {
  const product = String(payload.product || '').trim();
  const city = String(payload.region || '').split(',')[0].trim();
  const headlines = uniqueTexts([
    cleanHeadline(product),
    city && city !== 'India' ? cleanHeadline(`${product} in ${city}`) : '',
    city && city !== 'India' ? cleanHeadline(`${city} ${product}`) : '',
    'Enquire Today',
    'Visit Our Website',
    'Contact Us Now'
  ], 30, 8);
  const descriptions = uniqueTexts([
    `${product}${city && city !== 'India' ? ` in ${city}` : ''}. Visit our website to know more.`,
    `Looking for ${product}? Send an enquiry on our website today.`
  ], 90, 4);
  return { headlines, descriptions };
}

async function writeCopy(payload, english) {
  let written = null;
  try {
    written = await writeGoogleAdPlan({ intake: payload, english });
  } catch {
    written = null;
  }
  const text = written?.text || '';
  const headlines = uniqueTexts(lineValues(text, 'HEADLINE').map(cleanHeadline), 30, 15);
  const descriptions = uniqueTexts(lineValues(text, 'DESCRIPTION'), 90, 4);
  const strategy = lineValues(text, 'STRATEGY')[0]?.slice(0, 400) || '';
  if (headlines.length >= 3 && descriptions.length >= 2) return { headlines, descriptions, strategy, fromModel: true };
  const fallback = fallbackCopy(payload);
  return {
    headlines: fallback.headlines,
    descriptions: fallback.descriptions,
    strategy: say(english, 'No ad-writing model answered, so this copy uses only the details you sent.', 'Ad writing model ne jawab nahi diya, isliye copy sirf aapki details se bani hai.'),
    fromModel: false
  };
}

async function pickKeywords(account, payload) {
  const seeds = uniqueTexts([payload.product, payload.category].filter(Boolean), 80, 3);
  try {
    const ideas = await googleKeywordIdeas(account.input, {
      seeds,
      url: payload.website,
      locations: payload.locations?.map((item) => item.id) || []
    });
    const picked = uniqueTexts(ideas.map((idea) => idea.text), 80, MAX_KEYWORDS);
    if (picked.length) return { keywords: picked.map((text) => ({ text, matchType: 'PHRASE' })), fromGoogle: true };
  } catch {
    // Fall back to the owner's own words below.
  }
  const city = String(payload.region || '').split(',')[0].trim();
  const own = uniqueTexts([
    payload.product,
    city && city !== 'India' ? `${payload.product} ${city}` : '',
    city && city !== 'India' ? `${payload.product} near me` : ''
  ].map((text) => String(text || '').toLowerCase()), 80, 5);
  return { keywords: own.map((text) => ({ text, matchType: 'PHRASE' })), fromGoogle: false };
}

function keywordLabel(item) {
  const match = item.matchType === 'EXACT' ? `[${item.text}]` : item.matchType === 'BROAD' ? item.text : `"${item.text}"`;
  return item.searches ? `${match} (${Number(item.searches).toLocaleString('en-IN')}/mo)` : match;
}

function planText(payload, english) {
  const source = payload.copyFromModel
    ? say(english, 'picked from Google Keyword Planner', 'Google Keyword Planner se chune')
    : payload.keywordsFromGoogle ? say(english, 'from Google ideas', 'Google ideas se') : say(english, 'Google gave no ideas, so these use your words', 'Google ne ideas nahi diye, isliye aapke shabd');
  const host = (() => { try { return new URL(payload.website).hostname; } catch { return payload.website; } })();
  return card([
    header(say(english, 'Google Search Ad Plan', 'Google Search Ad Plan'), say(english, 'Draft · nothing is created yet', 'Draft · abhi kuch bana nahi hai')),
    section('Strategy', payload.strategy),
    section('Setup', [
      field('Website', host),
      field(say(english, 'Locations', 'Locations'), payload.region),
      field(say(english, 'Daily budget', 'Daily budget'), money(payload.dailyBudget, payload.currency)),
      field('Bidding', 'Maximize clicks'),
      payload.path1 ? field(say(english, 'Display link', 'Display link'), `${host}/${payload.path1}${payload.path2 ? `/${payload.path2}` : ''}`) : ''
    ]),
    payload.sellingPoints?.length ? section('Selling points', bullets(payload.sellingPoints)) : '',
    section(`Keywords (${payload.keywords.length})`, [hint(source), bullets(payload.keywords.map(keywordLabel))]),
    payload.negatives?.length ? section(say(english, 'Negative keywords', 'Negative keywords'), [hint(say(english, 'The ad will not show for these', 'Inpe ad nahi dikhegi')), payload.negatives.join(' · ')]) : '',
    section(`Headlines (${payload.headlines.length})`, numbered(payload.headlines)),
    section(`Descriptions (${payload.descriptions.length})`, numbered(payload.descriptions)),
    LINE,
    section(say(english, 'What next?', 'Aage kya?'), options([
      ['ok', say(english, 'save on Google Ads as paused', 'Google Ads pe paused save karo')],
      ['cancel', say(english, 'stop this setup', 'setup band karo')]
    ])),
    section(say(english, 'Want changes?', 'Kuch badalna hai?'), [
      say(english, 'Write your idea, e.g. _focus on ready to move flats_', 'Apna idea likho, jaise _ready to move flats pe focus karo_'),
      say(english, 'Or edit directly:', 'Ya seedha edit karo:'),
      '`headlines: a | b | c`',
      '`descriptions: a | b`',
      '`keywords: x, y`',
      '`negatives: x, y`',
      '`budget: 500`'
    ])
  ]);
}

function regionPrompt(payload, english) {
  const cities = payload.suggestion?.cities || [];
  if (!cities.length) return intakePrompt('region', english);
  return card([
    `*Step 4/5 · ${say(english, 'Locations', 'Locations')}*`,
    section(say(english, 'Where your buyers search from (AIRO suggestion)', 'Buyers kahan se search karte hain (AIRO suggestion)'), numbered(cityChoices(payload.suggestion))),
    payload.suggestion.bestPick ? `*${say(english, 'Best to start', 'Shuru karne ke liye best')}:* ${payload.suggestion.bestPick}` : '',
    hint(officeCityNote(payload.suggestion, english)),
    payload.suggestion.why ? hint(`${say(english, 'Why', 'Kyun')}: ${payload.suggestion.why}`) : '',
    section(say(english, 'Choose', 'Chuno'), options([
      [say(english, 'Choose cities', 'Cities chuno'), say(english, 'tap the button below and add cities one by one', 'neeche button dabao aur cities ek-ek add karo')],
      ['best', say(english, 'use the best pick', 'best pick use karo')],
      ['ok', say(english, 'use all of them', 'sab use karo')],
      ['1,2', say(english, 'pick by number', 'number se chuno')],
      ['Delhi, Pune', say(english, 'your own cities', 'apni cities')],
      ['all India', say(english, 'whole country', 'poora desh')]
    ]))
  ]);
}

async function prepareRegion(organizationId, conversationId, payload, english) {
  const profile = await businessProfile(organizationId);
  const suggestion = await suggestTargeting({ organizationId, payload, profile, platform: 'google' });
  if (suggestion) {
    payload.suggestion = {
      cities: suggestion.cities,
      cityNotes: suggestion.cityNotes,
      bestCities: suggestion.bestCities,
      bestPick: suggestion.bestPick,
      officeCity: profile?.officeCity || '',
      keywordSeeds: suggestion.keywordSeeds,
      why: suggestion.why
    };
    payload.negatives = suggestion.negatives.map((item) => item.toLowerCase());
    payload.sellingPoints = suggestion.sellingPoints;
  }
  await saveDraft(organizationId, conversationId, 'region', payload);
  return { text: regionPrompt(payload, english), menu: cityMenu(payload.suggestion, [], english) };
}

async function afterWebsite(organizationId, conversationId, payload, english) {
  if (hasProfileDetails(await businessProfile(organizationId))) return prepareRegion(organizationId, conversationId, payload, english);
  await saveDraft(organizationId, conversationId, 'details', payload);
  return { text: intakePrompt('details', english) };
}

function intakePrompt(step, english) {
  if (step === 'product') {
    return card([
      header(say(english, 'Google Search Ad Setup', 'Google Search Ad Setup'), say(english, 'AIRO assistant · 5 quick steps', 'AIRO assistant · 5 chhote steps')),
      fmtStep(1, 5, say(english, 'Product', 'Product'), say(english, 'What should the ad promote?', 'Ad kis cheez ki hai?'), say(english, 'Example: 2BHK flats in Noida, dental clinic, coaching classes', 'Example: 2BHK flats in Noida, dental clinic, coaching classes'))
    ]);
  }
  if (step === 'website') return fmtStep(2, 5, 'Website', say(english, 'Send the link where people should land.', 'Woh link bhejo jahan log aayenge.'), say(english, 'Must start with https://', 'https:// se shuru hona chahiye'));
  if (step === 'details') {
    return fmtStep(
      3, 5, say(english, 'What makes it special', 'Khaas kya hai'),
      card([
        say(english, 'Strong ads need real selling points. Tell me any of these:', 'Achhe ads ke liye asli selling points chahiye. Inme se jo ho batao:'),
        bullets(say(english, ['Price or range', 'Offer', 'Location advantages', 'Experience or trust', 'Amenities or features'], ['Price ya range', 'Offer', 'Location ke fayde', 'Experience ya trust', 'Amenities ya features']))
      ]),
      say(english, 'Or reply skip', 'Ya skip likho')
    );
  }
  if (step === 'region') return fmtStep(4, 5, say(english, 'Locations', 'Locations'), say(english, 'Which cities should the ad show in?', 'Ad kin cities mein dikhani hai?'), say(english, 'Separate with commas, or reply all India', 'Comma se alag likho, ya all India'));
  return fmtStep(5, 5, say(english, 'Daily budget', 'Daily budget'), say(english, 'How much per day should the campaign spend?', 'Roz ka budget kitna rakhna hai?'), say(english, 'Send a number, for example 500', 'Number bhejo, jaise 500'));
}

export async function handleGoogleAdChat({ organizationId, conversationId, recognized, messages, force = false }) {
  const text = lastUser(messages);
  if (!text || !organizationId || !conversationId) return null;
  const starting = START.test(text);
  let draft = null;
  try {
    draft = await loadDraft(conversationId);
  } catch (error) {
    if (!missingTable(error)) throw error;
    if (!starting) return null;
    return { text: 'Google ad chat is not ready on this server yet. Run npm run migrate once, then say run google ads again.' };
  }
  if (draft && draft.step !== 'done' && !starting && Number(draft.ageHours) >= STALE_HOURS) {
    await clearGoogleDraft(conversationId);
    draft = null;
  }
  if (!starting && (!draft || draft.step === 'done')) return null;
  const english = draft && !starting ? langOf(draft, text) : englishOnly(text);
  if (!recognized) return { text: notRegistered(english) };
  if (starting) return begin(organizationId, conversationId, text, english);
  if (CANCEL.test(text)) {
    await clearGoogleDraft(conversationId);
    return { text: say(english, 'Google ad setup is cancelled. Say run google ads when you want to start again.', 'Google ad setup cancel ho gaya. Dubara start karne ke liye run google ads likho.') };
  }
  if (GREETING.test(text)) {
    return {
      text: say(
        english,
        `Hi, I am the AIRO assistant. A Google ad setup${draft.payload.product ? ` for ${draft.payload.product}` : ''} is still open in this chat. Continue with the last question, or reply cancel to close it.`,
        `Hi, main AIRO assistant hoon. Is chat mein ek Google ad setup${draft.payload.product ? ` (${draft.payload.product})` : ''} abhi khula hai. Pichhle sawaal ka jawab do, ya band karne ke liye cancel likho.`
      )
    };
  }
  if (/^Photo \d{6,40}$/.test(text)) {
    return { text: say(english, 'Google Search ads use text only, no photo. Answer the last question in text.', 'Google Search ads mein photo nahi lagti, sirf text. Pichhle sawaal ka jawab text mein do.') };
  }
  if (!force && (draft.step === 'approval' ? !APPROVAL_REPLY.test(text.trim()) : AWAY.test(text))) return null;
  return continueDraft(organizationId, conversationId, draft, text, english);
}

async function begin(organizationId, conversationId, text, english) {
  const account = await googleAccount(organizationId);
  if (!account) return { text: `I am the AIRO assistant. ${connectLine(english)}` };
  const closedMeta = await clearMetaDraft(conversationId);
  const payload = { lang: english ? 'en' : 'hi', currency: account.input.currency };
  await saveDraft(organizationId, conversationId, 'product', payload);
  const note = closedMeta ? say(english, 'The open Meta ad setup in this chat is closed. ', 'Is chat ka khula Meta ad setup band kar diya. ') : '';
  return { text: `${note}${intakePrompt('product', english)}` };
}

async function continueDraft(organizationId, conversationId, draft, text, english) {
  const payload = { ...draft.payload, lang: english ? 'en' : 'hi' };
  const ask = (step, message) => saveDraft(organizationId, conversationId, step, payload, draft.campaignId).then(() => ({ text: message }));

  if (draft.step === 'product') {
    if (text.length < 2) return { text: intakePrompt('product', english) };
    payload.product = text.slice(0, 120);
    const site = httpsWebsite(text);
    if (site) {
      payload.website = site;
      return afterWebsite(organizationId, conversationId, payload, english);
    }
    return ask('website', intakePrompt('website', english));
  }
  if (draft.step === 'details') {
    payload.details = /^(skip|no|nahi|nahin|none)\b/i.test(text) ? '' : text.slice(0, 500);
    return prepareRegion(organizationId, conversationId, payload, english);
  }
  if (draft.step === 'website') {
    const site = httpsWebsite(text);
    if (site) {
      payload.website = site;
      return afterWebsite(organizationId, conversationId, payload, english);
    }
    if (noWebsite(text)) {
      await clearGoogleDraft(conversationId);
      return {
        text: say(
          english,
          'Google Search ads need a website for people to land on. Without a website, say run meta ads and I will make a Meta ad that uses your Facebook Page instead.',
          'Google Search ads ke liye website zaroori hai. Website nahi hai to run meta ads likho, main Facebook Page wali Meta ad bana dunga.'
        )
      };
    }
    return { text: say(english, 'Send a website link starting with https, or say no website.', 'https se website link bhejo, ya no website likho.') };
  }
  if (draft.step === 'region' || draft.step === 'region_pick') return pickRegion(organizationId, conversationId, draft, payload, text, english);
  if (draft.step === 'budget') {
    const amount = Number(String(text).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount < 1) return { text: intakePrompt('budget', english) };
    payload.dailyBudget = Math.round(amount);
    return buildPlan(organizationId, conversationId, payload, english);
  }
  if (draft.step === 'review') return reviewPlan(organizationId, conversationId, payload, text, english);
  if (draft.step === 'approval') return approve(organizationId, conversationId, draft, payload, text, english);
  return null;
}

async function pickRegion(organizationId, conversationId, draft, payload, text, english) {
  const account = await googleAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  if (draft.step === 'region_pick') {
    const choices = Array.isArray(payload.locationChoices) ? payload.locationChoices : [];
    const number = Number(text.trim());
    const picked = Number.isInteger(number) ? choices[number - 1] : null;
    if (!picked) return { text: say(english, 'Reply with the location number from the list.', 'List mein se location number bhejo.') };
    payload.region = picked.name;
    payload.locations = [{ id: picked.id, name: picked.name }];
    delete payload.locationChoices;
    return locationsReady(account, organizationId, conversationId, payload, english);
  }
  if (indiaWide(text)) {
    payload.region = 'India';
    payload.locations = [];
    return locationsReady(account, organizationId, conversationId, payload, english);
  }
  const tapped = payload.pickedCities || [];
  const pick = cityPick(text, payload.suggestion, tapped);
  if (pick?.kind === 'toggle' || pick?.kind === 'empty') {
    if (pick.kind === 'toggle') payload.pickedCities = pick.picked;
    await saveDraft(organizationId, conversationId, 'region', payload);
    const note = pick.kind === 'empty'
      ? say(english, 'No location selected yet. Tap a city first.', 'Abhi koi location select nahi hui. Pehle city tap karo.')
      : pick.added ? say(english, `${pick.city} added.`, `${pick.city} add ho gaya.`) : say(english, `${pick.city} removed.`, `${pick.city} hata diya.`);
    return { text: note, menu: cityMenu(payload.suggestion, payload.pickedCities || [], english) };
  }
  if (payload.suggestion?.cities?.length && !pick) {
    const menu = () => cityMenu(payload.suggestion, payload.pickedCities || [], english);
    if (wantsOtherCity(text)) {
      payload.addingCity = true;
      await saveDraft(organizationId, conversationId, 'region', payload);
      return { text: say(english, 'Type the city name. For more than one, separate with commas (example: Lucknow, Kanpur).', 'City ka naam likho. Ek se zyada ho to comma se alag karo (example: Lucknow, Kanpur).') };
    }
    const dropped = droppedCity(text, tapped);
    if (dropped) {
      payload.pickedCities = dropped.picked;
      await saveDraft(organizationId, conversationId, 'region', payload);
      return { text: say(english, `${dropped.city} removed.`, `${dropped.city} hata diya.`), menu: menu() };
    }
    if ((tapped.length || payload.addingCity) && !meansAll(text) && !/^\s*\d+(\s*[, ]\s*\d+)*\s*$/.test(text)) {
      const { found, missing } = await resolveGoogleLocations(account.input.refreshToken, chosenNames(text, []));
      if (!found.length) {
        return { text: say(english, 'Google did not find that city. Check the spelling and type it again.', 'Google ko ye city nahi mili. Spelling check karke dobara likho.'), menu: menu() };
      }
      const added = found.map((item) => item.name.split(',')[0].trim());
      payload.pickedCities = [...new Set([...tapped, ...added])];
      delete payload.addingCity;
      await saveDraft(organizationId, conversationId, 'region', payload);
      return {
        text: card([
          say(english, `${added.join(', ')} added.`, `${added.join(', ')} add ho gaya.`),
          missing.length ? hint(say(english, `Not found on Google: ${missing.join(', ')}`, `Google pe nahi mili: ${missing.join(', ')}`)) : ''
        ]),
        menu: menu()
      };
    }
  }
  const typed = pick?.kind === 'final' ? pick.names : chosenNames(text, payload.suggestion?.cities || []);
  const names = pick?.kind === 'final' ? typed : [...new Set([...tapped, ...typed])];
  if (names.length > 1 || payload.suggestion?.cities?.length) {
    delete payload.pickedCities;
    delete payload.addingCity;
    const { found, missing } = await resolveGoogleLocations(account.input.refreshToken, names);
    if (!found.length) {
      return { text: say(english, 'Google did not find those locations. Send other cities, or say all India.', 'Google ko ye locations nahi mili. Doosri cities bhejo, ya all India likho.') };
    }
    payload.locations = found;
    payload.region = found.map((item) => item.name.split(',')[0]).join(', ');
    return locationsReady(account, organizationId, conversationId, payload, english, card([
      section(say(english, 'Locations set', 'Locations set'), bullets(found.map((item) => item.name))),
      missing.length ? hint(say(english, `Not found on Google: ${missing.join(', ')}`, `Google pe nahi mili: ${missing.join(', ')}`)) : ''
    ]));
  }
  let choices = [];
  try {
    choices = await suggestGoogleLocations({ refreshToken: account.input.refreshToken, query: text });
  } catch {
    choices = [];
  }
  if (choices.length === 1) {
    payload.region = choices[0].name;
    payload.locations = [{ id: choices[0].id, name: choices[0].name }];
    return locationsReady(account, organizationId, conversationId, payload, english);
  }
  if (choices.length > 1) {
    payload.locationChoices = choices.slice(0, 5).map((item) => ({ id: item.id, name: item.name }));
    await saveDraft(organizationId, conversationId, 'region_pick', payload);
    const lines = payload.locationChoices.map((item, index) => `${index + 1}. ${item.name}`);
    return { text: say(english, `Which location?\n${lines.join('\n')}`, `Kaunsi location?\n${lines.join('\n')}`) };
  }
  return { text: say(english, 'Google did not find that location. Send another city, or say all India.', 'Google ko yeh location nahi mili. Doosri city bhejo, ya all India likho.') };
}

async function fillKeywordPool(account, payload) {
  const cities = (payload.locations || []).map((item) => item.name.split(',')[0].toLowerCase());
  const product = String(payload.product || '').toLowerCase();
  const seeds = [...(payload.suggestion?.keywordSeeds || []), product, ...cities.slice(0, 2).map((city) => `${product} ${city}`)].filter(Boolean);
  payload.keywordPool = await keywordCandidates(account.input, { seeds, website: payload.website, locations: (payload.locations || []).map((item) => item.id) });
}

export function demandSection(pool, english) {
  const top = (pool || []).filter((item) => Number(item.searches) > 0).slice(0, 3);
  if (!top.length) {
    return hint(say(english, 'Google did not return search numbers for these locations yet.', 'Google ne in locations ke search numbers abhi nahi diye.'));
  }
  return card([
    section(
      say(english, 'Google searches per month here (Keyword Planner)', 'Yahan Google pe har mahine searches (Keyword Planner)'),
      bullets(top.map((item) => `${item.text}: *${Number(item.searches).toLocaleString('en-IN')}*`))
    ),
    hint(say(english, 'Google\'s monthly average for these locations. Search ads reach people when they search, so this is the real audience size on Google.', 'Yeh Google ka in locations ka monthly average hai. Search ads tab dikhte hain jab log search karte hain, isliye Google pe asli audience yahi hai.'))
  ]);
}

async function locationsReady(account, organizationId, conversationId, payload, english, intro = '') {
  await fillKeywordPool(account, payload).catch(() => { payload.keywordPool = []; });
  await saveDraft(organizationId, conversationId, 'budget', payload);
  return {
    text: card([
      intro,
      demandSection(payload.keywordPool, english),
      payload.locations?.length ? hint(say(english, 'Google targets the whole of each location here; a km radius is not set from chat yet.', 'Google pe yahan poori location target hoti hai; km radius abhi chat se set nahi hota.')) : '',
      LINE,
      intakePrompt('budget', english)
    ])
  };
}

async function expertCopy(organizationId, account, payload) {
  const profile = await businessProfile(organizationId);
  if (!payload.keywordPool?.length) await fillKeywordPool(account, payload);
  const copy = await writeGoogleCopy({ organizationId, payload, profile, candidates: payload.keywordPool });
  payload.headlines = copy.headlines;
  payload.descriptions = copy.descriptions;
  payload.path1 = copy.path1.replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 15);
  payload.path2 = copy.path2.replace(/[^\p{L}\p{N}-]/gu, '').slice(0, 15);
  payload.keywords = copy.keywords;
  payload.negatives = copy.negatives;
  payload.strategy = copy.strategy;
  payload.copyFromModel = true;
}

async function buildPlan(organizationId, conversationId, payload, english) {
  const account = await googleAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  try {
    await expertCopy(organizationId, account, payload);
    await saveDraft(organizationId, conversationId, 'review', payload);
    return { text: planText(payload, english) };
  } catch {
    payload.copyFromModel = false;
  }
  const picked = await pickKeywords(account, payload);
  payload.keywords = picked.keywords;
  payload.keywordsFromGoogle = picked.fromGoogle;
  if (!payload.keywords.length) {
    await saveDraft(organizationId, conversationId, 'review', { ...payload, headlines: [], descriptions: [] });
    return { text: say(english, 'I could not find keywords. Send them as: keywords: word one, word two', 'Keywords nahi mile. Aise bhejo: keywords: word one, word two') };
  }
  const copy = await writeCopy(payload, english);
  payload.headlines = copy.headlines;
  payload.descriptions = copy.descriptions;
  payload.strategy = copy.strategy;
  await saveDraft(organizationId, conversationId, 'review', payload);
  if (payload.headlines.length < 3 || payload.descriptions.length < 2) {
    return { text: say(english, 'I could not write enough ad text. Send it as: headlines: a | b | c and descriptions: a | b', 'Ad text kaafi nahi bana. Aise bhejo: headlines: a | b | c aur descriptions: a | b') };
  }
  return { text: planText(payload, english) };
}

function editField(text, name) {
  const match = String(text || '').match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

async function reviewPlan(organizationId, conversationId, payload, text, english) {
  if (YES.test(text.trim())) {
    if ((payload.headlines || []).length < 3 || (payload.descriptions || []).length < 2 || !(payload.keywords || []).length) {
      return { text: say(english, 'The plan needs at least 3 headlines, 2 descriptions and 1 keyword first.', 'Pehle kam se kam 3 headlines, 2 descriptions aur 1 keyword chahiye.') };
    }
    return createPaused(organizationId, conversationId, payload, english);
  }
  const headlines = editField(text, 'headlines?');
  const descriptions = editField(text, 'descriptions?');
  const keywords = editField(text, 'keywords?');
  const negatives = editField(text, 'negatives?');
  const budget = String(text).match(/^\s*budget\s*:?\s*(\d[\d,.]*)/im)?.[1] || '';
  if (negatives) payload.negatives = uniqueTexts(negatives.split(',').map((item) => item.toLowerCase()), 40, 30);
  const notes = [];
  if (headlines) {
    const list = uniqueTexts(headlines.split('|').map(cleanHeadline), 30, 15);
    if (list.length < 3) notes.push(say(english, 'Send at least 3 headlines under 30 characters each.', 'Kam se kam 3 headlines bhejo, har ek 30 characters se kam.'));
    else payload.headlines = list;
  }
  if (descriptions) {
    const list = uniqueTexts(descriptions.split('|'), 90, 4);
    if (list.length < 2) notes.push(say(english, 'Send at least 2 descriptions under 90 characters each.', 'Kam se kam 2 descriptions bhejo, har ek 90 characters se kam.'));
    else payload.descriptions = list;
  }
  if (keywords) {
    const list = uniqueTexts(keywords.split(',').map((item) => item.toLowerCase()), 80, MAX_KEYWORDS);
    if (!list.length) notes.push(say(english, 'Send keywords separated by commas.', 'Keywords comma se alag karke bhejo.'));
    else {
      payload.keywords = list.map((item) => ({ text: item, matchType: 'PHRASE' }));
      payload.keywordsFromGoogle = false;
    }
  }
  if (budget) {
    const amount = Number(budget.replace(/[^\d.]/g, ''));
    if (Number.isFinite(amount) && amount >= 1) payload.dailyBudget = Math.round(amount);
    else notes.push(say(english, 'Send the budget as a number.', 'Budget number mein bhejo.'));
  }
  if (!headlines && !descriptions && !keywords && !budget && !negatives) {
    if (text.length < 4) return { text: planText(payload, english) };
    payload.idea = text.slice(0, 400);
    const account = await googleAccount(organizationId);
    if (account) {
      try {
        await expertCopy(organizationId, account, payload);
        await saveDraft(organizationId, conversationId, 'review', payload);
        return { text: planText(payload, english) };
      } catch {
        // Fall back to the simple writer below.
      }
    }
    const copy = await writeCopy(payload, english);
    if (!copy.fromModel) {
      await saveDraft(organizationId, conversationId, 'review', payload);
      return {
        text: say(
          english,
          'No ad-writing model is connected, so I cannot rewrite from your idea. Send the text as: headlines: a | b | c and descriptions: a | b',
          'Ad writing model connected nahi hai, isliye idea se dobara nahi likh sakta. Aise bhejo: headlines: a | b | c aur descriptions: a | b'
        )
      };
    }
    payload.headlines = copy.headlines;
    payload.descriptions = copy.descriptions;
    payload.strategy = copy.strategy;
  }
  await saveDraft(organizationId, conversationId, 'review', payload);
  return { text: [notes.join(' '), planText(payload, english)].filter(Boolean).join('\n') };
}

async function createPaused(organizationId, conversationId, payload, english) {
  const account = await googleAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  const name = `${String(payload.product || 'Search campaign').slice(0, 120)} - ${new Date().toISOString().slice(0, 10)}`;
  let created;
  try {
    created = await createGoogleSearchCampaign({
      ...account.input,
      name,
      dailyBudget: payload.dailyBudget,
      bidding: 'MAXIMIZE_CLICKS',
      locations: payload.locations || [],
      keywords: payload.keywords.map((item) => ({ text: item.text, matchType: item.matchType })),
      negatives: payload.negatives || [],
      finalUrl: payload.website,
      headlines: payload.headlines,
      descriptions: payload.descriptions,
      path1: payload.path1 || '',
      path2: payload.path1 ? payload.path2 || '' : '',
      publish: false
    });
  } catch (error) {
    const reason = String(error.message || 'Google Ads did not save the campaign.').slice(0, 220);
    return { text: say(english, `Google Ads did not save the campaign. ${reason} Change the plan and reply ok again, or say cancel.`, `Google Ads ne campaign save nahi kiya. ${reason} Plan badal kar dobara ok likho, ya cancel.`) };
  }
  payload.campaignId = created.campaignId;
  payload.campaignName = name;
  await saveDraft(organizationId, conversationId, 'approval', payload, created.campaignId);
  await upsertObject({
    organizationId,
    connectionId: account.connectionId,
    objectType: 'campaign',
    externalId: String(created.campaignId),
    name: name.slice(0, 180),
    parentExternalId: null,
    payload: { origin: 'api', status: 'PAUSED', channel: 'SEARCH', budget: String(payload.dailyBudget), budgetKind: 'daily', currency: payload.currency || '' }
  });
  await recordAudit({ auth: null, ip: null }, {
    action: 'connection.google_campaign_created',
    resource: 'connection',
    resourceId: account.connectionId,
    organizationId,
    metadata: { channel: 'whatsapp', publish: false }
  });
  return { text: savedCard(created.campaignId, payload, english) };
}

function savedCard(campaignId, payload, english) {
  return card([
    header(say(english, 'Campaign saved (paused)', 'Campaign save ho gaya (paused)'), say(english, 'Not live yet · no money spent', 'Abhi live nahi · koi paisa kharch nahi')),
    section('Google Ads', [
      field('Campaign id', campaignId),
      field(say(english, 'Daily budget', 'Daily budget'), money(payload.dailyBudget, payload.currency)),
      field(say(english, 'Locations', 'Locations'), payload.region),
      field('Keywords', payload.keywords?.length)
    ]),
    section(say(english, 'Publish now?', 'Ab publish karein?'), options([
      ['haan', say(english, 'turn it on', 'on kar do')],
      ['nahi', say(english, 'keep it paused', 'paused rehne do')]
    ]))
  ]);
}

async function approve(organizationId, conversationId, draft, payload, text, english) {
  const value = text.trim();
  const yes = /^(haan|han|ha|yes|y|publish|live|ok|okay)\b/i.test(value);
  const no = NO.test(value);
  if (!yes && !no) {
    return {
      text: card([
        say(english, `Campaign *${draft.campaignId}* is saved and paused.`, `Campaign *${draft.campaignId}* save hai aur paused hai.`),
        options([
          ['haan', say(english, 'publish it', 'publish karo')],
          ['nahi', say(english, 'keep it paused', 'paused rehne do')]
        ]),
        hint(say(english, 'To see competitors, send: competitors <product and city>', 'Competitors dekhne ke liye likho: competitors <product aur city>'))
      ])
    };
  }
  if (no) {
    await saveDraft(organizationId, conversationId, 'done', payload, draft.campaignId);
    return {
      text: card([
        header(say(english, 'Kept paused', 'Paused rakha'), `Campaign ${draft.campaignId}`),
        say(english, 'Turn it on anytime from AIRO → Connections → Google Ads.', 'Kabhi bhi AIRO → Connections → Google Ads se on kar sakte ho.')
      ])
    };
  }
  const account = await googleAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  try {
    await setGoogleCampaignStatus({ ...account.input, campaignId: draft.campaignId, status: 'ENABLED' });
  } catch (error) {
    return { text: say(english, `The campaign is still paused. ${String(error.message || '').slice(0, 200)}`, `Campaign abhi bhi paused hai. ${String(error.message || '').slice(0, 200)}`) };
  }
  await saveDraft(organizationId, conversationId, 'done', payload, draft.campaignId);
  await upsertObject({
    organizationId,
    connectionId: account.connectionId,
    objectType: 'campaign',
    externalId: String(draft.campaignId),
    name: String(payload.campaignName || payload.product || 'Search campaign').slice(0, 180),
    parentExternalId: null,
    payload: { origin: 'api', status: 'ENABLED', channel: 'SEARCH', budget: String(payload.dailyBudget), budgetKind: 'daily', currency: payload.currency || '' }
  });
  await recordAudit({ auth: null, ip: null }, {
    action: 'connection.google_campaign_published',
    resource: 'connection',
    resourceId: account.connectionId,
    organizationId,
    metadata: { channel: 'whatsapp', publish: true }
  });
  return {
    text: card([
      header(say(english, 'Campaign is live', 'Campaign live ho gaya'), `Campaign ${draft.campaignId}`),
      bullets([
        say(english, 'Google reviews new ads first, which can take up to a day.', 'Google pehle naye ads review karta hai, isme ek din tak lag sakta hai.'),
        say(english, 'AIRO will watch results and suggest changes.', 'AIRO results dekhega aur changes suggest karega.')
      ])
    ])
  };
}
