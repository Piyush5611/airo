import { one, run } from '../db/sql.js';
import { decryptJson } from '../utils/cryptoBox.js';
import { createGoogleSearchCampaign, googleKeywordIdeas, setGoogleCampaignStatus, suggestGoogleLocations } from '../integrations/googleAds.js';
import { upsertObject } from '../repositories/connectionRepo.js';
import { recordAudit } from './auditService.js';
import { writeGoogleAdPlan } from './llmService.js';

const START = /\b(run|start|launch|create|chalao|chala|chalana|chalani|banao|bana|banana|banani|lagao|lagana)\b.{0,40}\bgoogle\b|\bgoogle\s+ads?\b.{0,24}\b(run|start|launch|create|chalao|chala|chalana|chalani|banao|bana|banana|banani|lagao|lagana)\b/i;
const CANCEL = /^(cancel|stop|ruk|band|nahi chahiye|nahin chahiye)\b/i;
const GREETING = /^(hi+|hello|hey|hlo|namaste|namaskar|good\s+(morning|afternoon|evening))[\s!.?]*$/i;
const YES = /^(ok|okay|haan|han|ha|yes|y|theek|thik|done|approve|approved|save|publish|live|chalao)\b/i;
const NO = /^(nahi|nahin|no|mat|pause|ruk)\b/i;
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

async function googleAccount(organizationId) {
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

function planText(payload, english) {
  const keywordLine = payload.keywords.map((item) => item.text).join(', ');
  return [
    say(english, 'Here is the Google Search plan. Nothing is created yet.', 'Yeh Google Search plan hai. Abhi kuch bana nahi hai.'),
    payload.strategy ? `Strategy: ${payload.strategy}` : '',
    say(
      english,
      `Website ${payload.website}. Location ${payload.region}. Daily budget ${payload.dailyBudget}${payload.currency ? ` ${payload.currency}` : ''}. Bidding: maximize clicks.`,
      `Website ${payload.website}. Location ${payload.region}. Daily budget ${payload.dailyBudget}${payload.currency ? ` ${payload.currency}` : ''}. Bidding: maximize clicks.`
    ),
    `${say(english, payload.keywordsFromGoogle ? 'Keywords from Google ideas' : 'Keywords (Google gave no ideas, so these use your words)', payload.keywordsFromGoogle ? 'Google ke keyword ideas' : 'Keywords (Google ne ideas nahi diye, isliye aapke shabd)')}: ${keywordLine}`,
    `Headlines: ${payload.headlines.join(' | ')}`,
    `Descriptions: ${payload.descriptions.join(' | ')}`,
    say(
      english,
      'Reply ok to save it on Google Ads as paused. To change something, send your idea in words, or send: headlines: a | b | c, descriptions: a | b, keywords: x, y, budget: 500. Reply cancel to stop.',
      'Paused save karne ke liye ok likho. Kuch badalna ho to apna idea likho, ya aise bhejo: headlines: a | b | c, descriptions: a | b, keywords: x, y, budget: 500. Band karne ke liye cancel.'
    )
  ].filter(Boolean).join('\n');
}

function intakePrompt(step, english) {
  if (step === 'product') return say(english, 'I am the AIRO assistant. What should the Google ad promote? Example: 2BHK flats in Noida, dental clinic, coaching classes.', 'I am the AIRO assistant. Google ad kis cheez ki hai? Example: 2BHK flats in Noida, dental clinic, coaching classes.');
  if (step === 'website') return say(english, 'Send the website link where people should land, starting with https.', 'Website link bhejo jahan log aayenge, https se.');
  if (step === 'region') return say(english, 'Which city should the ad show in? Or say all India.', 'Ad kis city mein dikhani hai? Ya all India likho.');
  return say(english, 'What daily budget should the campaign use? Send a number, for example 500.', 'Daily budget kitna rakhna hai? Number bhejo, jaise 500.');
}

export async function handleGoogleAdChat({ organizationId, conversationId, recognized, messages }) {
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
    if (site) payload.website = site;
    return ask(payload.website ? 'region' : 'website', intakePrompt(payload.website ? 'region' : 'website', english));
  }
  if (draft.step === 'website') {
    const site = httpsWebsite(text);
    if (site) {
      payload.website = site;
      return ask('region', intakePrompt('region', english));
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
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return { text: intakePrompt('budget', english) };
  }
  if (indiaWide(text)) {
    payload.region = 'India';
    payload.locations = [];
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return { text: intakePrompt('budget', english) };
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
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return { text: intakePrompt('budget', english) };
  }
  if (choices.length > 1) {
    payload.locationChoices = choices.slice(0, 5).map((item) => ({ id: item.id, name: item.name }));
    await saveDraft(organizationId, conversationId, 'region_pick', payload);
    const lines = payload.locationChoices.map((item, index) => `${index + 1}. ${item.name}`);
    return { text: say(english, `Which location?\n${lines.join('\n')}`, `Kaunsi location?\n${lines.join('\n')}`) };
  }
  return { text: say(english, 'Google did not find that location. Send another city, or say all India.', 'Google ko yeh location nahi mili. Doosri city bhejo, ya all India likho.') };
}

async function buildPlan(organizationId, conversationId, payload, english) {
  const account = await googleAccount(organizationId);
  if (!account) return { text: connectLine(english) };
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
  const budget = String(text).match(/^\s*budget\s*:?\s*(\d[\d,.]*)/im)?.[1] || '';
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
  if (!headlines && !descriptions && !keywords && !budget) {
    if (text.length < 4) return { text: planText(payload, english) };
    payload.idea = text.slice(0, 400);
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
      keywords: payload.keywords,
      finalUrl: payload.website,
      headlines: payload.headlines,
      descriptions: payload.descriptions,
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
  return {
    text: say(
      english,
      `Paused campaign saved on Google Ads. Campaign id ${created.campaignId}. It is not live. Reply haan to publish, or nahi to leave it paused.`,
      `Paused campaign Google Ads pe save ho gaya. Campaign id ${created.campaignId}. Abhi live nahi hai. Publish ke liye haan likho, paused chhodne ke liye nahi.`
    )
  };
}

async function approve(organizationId, conversationId, draft, payload, text, english) {
  const value = text.trim();
  const yes = /^(haan|han|ha|yes|y|publish|live|ok|okay)\b/i.test(value);
  const no = NO.test(value);
  if (!yes && !no) return { text: say(english, 'Reply haan to publish this paused campaign, or nahi to leave it paused.', 'Publish ke liye haan likho, paused chhodne ke liye nahi.') };
  if (no) {
    await saveDraft(organizationId, conversationId, 'done', payload, draft.campaignId);
    return { text: say(english, `Campaign ${draft.campaignId} stays paused. You can turn it on later from Connections, Google Ads.`, `Campaign ${draft.campaignId} paused hi rahegi. Baad mein Connections, Google Ads se on kar sakte ho.`) };
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
    text: say(
      english,
      `Published. Campaign ${draft.campaignId} is turned on in Google Ads. Google reviews new ads before they start showing, which can take up to a day.`,
      `Publish ho gaya. Campaign ${draft.campaignId} Google Ads mein on ho gaya. Google naye ads ko dikhane se pehle review karta hai, isme ek din tak lag sakta hai.`
    )
  };
}
