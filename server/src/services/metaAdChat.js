import { one, run } from '../db/sql.js';
import { decryptJson } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';
import { createMetaAd, listMetaPages, searchMetaAudience, searchPublicAds, setMetaCampaignStatus } from '../integrations/metaAds.js';
import { upsertObject } from '../repositories/connectionRepo.js';
import { recordAudit } from './auditService.js';
import { writeAdPlan } from './llmService.js';

const START = /\b(run|start|launch|chalao|chala|banao)\b.{0,40}\bmeta\b|\bmeta\s+ads?\b.{0,24}\b(run|start|launch|chalao|chala|banao)\b/i;
const CANCEL = /^(cancel|stop|ruk|band|nahi chahiye|nahin chahiye)\b/i;
const REPORT = /\b(report|nexcall|hisab|yesterday|aaj ka|calling report|kitne call)\b/i;
const HINGLISH = /\b(kya|hai|hain|karo|chahiye|bhejo|nahi|nahin|haan|mujhe|mera|meri|chalao|banao|ruk|theek|thik|yaar|kro)\b/i;
const CTA = new Set(['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'BOOK_NOW']);

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
    `SELECT id, step, payload, campaign_id AS campaignId
     FROM meta_ad_drafts WHERE conversation_id = ?`,
    [conversationId]
  );
  if (!row) return null;
  return { ...row, payload: parsePayload(row.payload) };
}

async function saveDraft(organizationId, conversationId, step, payload, campaignId = null) {
  await run(
    `INSERT INTO meta_ad_drafts (organization_id, conversation_id, step, payload, campaign_id)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE organization_id = VALUES(organization_id), step = VALUES(step),
       payload = VALUES(payload), campaign_id = VALUES(campaign_id)`,
    [organizationId, conversationId, step, JSON.stringify(payload), campaignId]
  );
}

async function clearDraft(conversationId) {
  await run(`DELETE FROM meta_ad_drafts WHERE conversation_id = ?`, [conversationId]);
}

async function metaAccount(organizationId) {
  const row = await one(
    `SELECT c.id, c.status, c.mode, cred.ciphertext
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND p.provider_key = 'meta_ads'
     LIMIT 1`,
    [organizationId]
  );
  if (!row?.ciphertext || row.status !== 'connected' || row.mode !== 'live') return null;
  let secret;
  try { secret = decryptJson(row.ciphertext); } catch { return null; }
  if (!secret?.apiKey || secret.verified !== true || !secret.accountId) return null;
  return { connectionId: row.id, apiKey: secret.apiKey, accountId: secret.accountId };
}

function connectLine(english) {
  return say(
    english,
    'Meta Ads is not connected for this business. Open Connections, then Advertising, then Meta Ads. Press Connect API, paste the access token and the ad account id (act_...), then Save.',
    'Meta Ads is business pe connected nahi hai. Connections kholo, Advertising, phir Meta Ads. Connect API dabao, access token aur ad account id (act_...) paste karo, phir Save.'
  );
}

function objectiveFrom(text) {
  const value = text.toLowerCase();
  if (/appoint/.test(value)) return { key: 'OUTCOME_LEADS', label: 'appointments', conversion: 'instant_form', cta: 'BOOK_NOW' };
  if (/sale|ecommerce|order|shop|kharid/.test(value)) return { key: 'OUTCOME_SALES', label: 'ecommerce sales', conversion: 'website', cta: 'SHOP_NOW' };
  if (/traffic|visit/.test(value)) return { key: 'OUTCOME_TRAFFIC', label: 'traffic', conversion: 'website', cta: 'LEARN_MORE' };
  if (/aware|reach|brand/.test(value)) return { key: 'OUTCOME_AWARENESS', label: 'awareness', conversion: 'website', cta: 'LEARN_MORE' };
  if (/lead|enquir|inquir/.test(value)) return { key: 'OUTCOME_LEADS', label: 'leads', conversion: 'instant_form', cta: 'SIGN_UP' };
  return null;
}

function specialFrom(text) {
  const value = text.toLowerCase();
  if (/^(none|nahi|nahin|no|skip|normal)\b/.test(value)) return '';
  if (/\bhousing\b|\bproperty\b/.test(value)) return 'HOUSING';
  if (/\bemployment\b|\bjob\b/.test(value)) return 'EMPLOYMENT';
  if (/\bcredit\b|\bloan\b/.test(value)) return 'CREDIT';
  if (/\bissues\b|\belection\b|\bpolitic/.test(value)) return 'ISSUES_ELECTIONS_POLITICS';
  return null;
}

function audienceFrom(text) {
  const value = text.toLowerCase();
  const skipped = /^(skip|none|all|nahi|nahin|no|koi nahi)\b/.test(value.trim());
  const ages = value.match(/(\d{2})\s*(?:-|to|se)\s*(\d{2})/);
  let ageMin;
  let ageMax;
  if (ages) {
    ageMin = Number(ages[1]);
    ageMax = Number(ages[2]);
    if (ageMin < 13 || ageMax > 65 || ageMin > ageMax) return { error: 'age' };
  }
  let gender = '';
  if (/\b(men|male|purush)\b/.test(value)) gender = 'men';
  else if (/\b(women|female|ladies|mahila)\b/.test(value)) gender = 'women';
  if (!skipped && !ages && !gender) return { error: 'format' };
  return { ageMin, ageMax, gender };
}

function httpsWebsite(text) {
  const match = String(text || '').match(/https:\/\/[^\s]+/i);
  if (!match) return '';
  const raw = match[0].replace(/[),.;]+$/, '');
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    return url.toString().slice(0, 300);
  } catch {
    return '';
  }
}

function publicImageUrl(text) {
  const match = String(text || '').match(/https:\/\/[^\s]+/i);
  if (!match) return null;
  let url;
  try { url = new URL(match[0].replace(/[),.;]+$/, '')); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0') return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.').map(Number);
    if (a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)) return null;
  }
  return url.toString().slice(0, 400);
}

function indiaWide(text) {
  return /\b(all india|poora india|poore india|pan india|entire india|india only)\b/i.test(text)
    || /^(india|bharat)$/i.test(text.trim());
}

function lineField(text, name) {
  const match = String(text || '').match(new RegExp(`^${name}:\\s*(.+)$`, 'im'));
  return match ? match[1].trim() : '';
}

function planFromModel(text, intake) {
  const headline = lineField(text, 'HEADLINE').slice(0, 40);
  const message = lineField(text, 'TEXT').slice(0, 200);
  const strategy = lineField(text, 'STRATEGY').slice(0, 400);
  const ctaRaw = lineField(text, 'CTA').toUpperCase().replace(/[^A-Z_]/g, '');
  return {
    headline: headline || String(intake.product || 'Offer').slice(0, 40),
    message: message || `${intake.product} · ${intake.region}`.slice(0, 200),
    strategy: strategy || '',
    cta: CTA.has(ctaRaw) ? ctaRaw : intake.cta
  };
}

function researchLines(note, ads, english) {
  if (!ads.length) {
    return say(
      english,
      note || 'Public competitor ads could not be read. I will not guess them.',
      note || 'Public competitor ads padhe nahi ja sake. Main unhe guess nahi karunga.'
    );
  }
  const rows = ads.slice(0, 5).map((ad) => `- ${[ad.page, ad.title].filter(Boolean).join(': ') || ad.text}`);
  return say(english, `Public ads found:\n${rows.join('\n')}`, `Public ads mile:\n${rows.join('\n')}`);
}

async function downloadImage(url) {
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ApiError(422, 'The image link did not open.', 'validation_error');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ApiError(422, 'Send a direct https link to the image.', 'validation_error');
  }
  if (!response.ok) throw new ApiError(422, 'The image link did not open.', 'validation_error');
  const bytes = Buffer.from(await response.arrayBuffer());
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  if ((!jpeg && !png) || bytes.length < 100 || bytes.length > 2500000) {
    throw new ApiError(422, 'Send a JPG or PNG under 2 MB.', 'validation_error');
  }
  return bytes.toString('base64');
}

async function rememberCampaign(organizationId, account, created, intake) {
  await upsertObject({
    organizationId,
    connectionId: account.connectionId,
    objectType: 'campaign',
    externalId: created.campaignId,
    name: String(intake.product || 'Meta ad').slice(0, 180),
    parentExternalId: null,
    payload: {
      origin: 'api',
      status: 'PAUSED',
      objective: intake.objectiveKey,
      budget: String(intake.dailyBudget),
      budgetKind: 'daily'
    }
  });
}

export async function handleMetaAdChat({ organizationId, conversationId, recognized, messages }) {
  const text = lastUser(messages);
  if (!text || !organizationId || !conversationId) return null;
  let draft = null;
  try {
    draft = await loadDraft(conversationId);
  } catch (error) {
    if (!missingTable(error)) throw error;
    if (!START.test(text)) return null;
    return {
      text: 'Meta ad chat is not ready on this server yet. Run npm run migrate once, then say run meta ads again.'
    };
  }
  const starting = START.test(text);
  if (!draft && !starting) return null;
  if (draft?.step === 'done' && !starting) return null;
  if (draft && !starting && REPORT.test(text)) return null;
  if (!recognized) {
    return {
      text: say(
        englishOnly(text),
        'This WhatsApp number is not registered to a business in AIRO. A Meta ad can only be created for a registered business number.',
        'Yeh WhatsApp number kisi business se registered nahi hai. Meta ad sirf registered business number se banta hai.'
      )
    };
  }
  if (starting) return begin(organizationId, conversationId, text);
  if (CANCEL.test(text)) {
    await clearDraft(conversationId);
    return {
      text: say(
        draft.payload.lang === 'en',
        'Meta ad setup is cancelled. Say run meta ads when you want to start again.',
        'Meta ad setup cancel ho gaya. Dubara start karne ke liye run meta ads likho.'
      )
    };
  }
  return continueDraft(organizationId, conversationId, draft, text);
}

async function begin(organizationId, conversationId, text) {
  const english = englishOnly(text);
  const account = await metaAccount(organizationId);
  if (!account) return { text: `I am the AIRO assistant. ${connectLine(english)}` };
  const payload = { lang: english ? 'en' : 'hi', sample: text.slice(0, 80) };
  await saveDraft(organizationId, conversationId, 'category', payload);
  return {
    text: say(
      english,
      'I am the AIRO assistant. To run a Meta ad I need the business details first. What is the business category?',
      'I am the AIRO assistant. Meta ad chalane ke liye pehle business details. Category kya hai?'
    )
  };
}

function langOf(draft, text) {
  if (draft.payload.lang === 'en' && englishOnly(text)) return true;
  if (HINGLISH.test(text)) return false;
  return draft.payload.lang === 'en';
}

async function continueDraft(organizationId, conversationId, draft, text) {
  const english = langOf(draft, text);
  const payload = { ...draft.payload, lang: english ? 'en' : 'hi' };
  const ask = (step, message) => saveDraft(organizationId, conversationId, step, payload, draft.campaignId).then(() => ({ text: message }));

  if (draft.step === 'category') {
    if (text.length < 2) {
      return { text: say(english, 'Tell me the business category.', 'Business category likho.') };
    }
    payload.category = text.slice(0, 80);
    return ask('product', say(english, 'What product or service should the ad sell?', 'Product ya service kya hai?'));
  }
  if (draft.step === 'product') {
    if (text.length < 2) return { text: say(english, 'Tell me the product or service.', 'Product ya service likho.') };
    payload.product = text.slice(0, 120);
    return ask('website', say(english, 'Send the website link. It must start with https.', 'Website link bhejo. https se start hona chahiye.'));
  }
  if (draft.step === 'website') {
    const website = httpsWebsite(text);
    if (!website) return { text: say(english, 'Send a website link that starts with https.', 'https se start hone wala website link bhejo.') };
    payload.website = website;
    return ask('region', say(english, 'Which city should this ad target? Or say all India.', 'Kaunsi city target karni hai? Ya all India likho.'));
  }
  if (draft.step === 'region' || draft.step === 'region_pick') {
    return pickRegion(organizationId, conversationId, payload, text, english, draft.step);
  }
  if (draft.step === 'budget') {
    const amount = Number(String(text).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(amount) || amount < 1) {
      return { text: say(english, 'Send the daily budget as a number, for example 500.', 'Daily budget number mein bhejo, jaise 500.') };
    }
    payload.dailyBudget = Math.round(amount);
    return ask('objective', say(english, 'What is the objective: leads, appointments, or ecommerce sales?', 'Objective kya hai: leads, appointments, ya ecommerce sales?'));
  }
  if (draft.step === 'objective') {
    const objective = objectiveFrom(text);
    if (!objective) {
      return { text: say(english, 'Reply with leads, appointments, or ecommerce sales.', 'Leads, appointments, ya ecommerce sales likho.') };
    }
    payload.objectiveKey = objective.key;
    payload.objectiveLabel = objective.label;
    payload.conversion = objective.conversion;
    payload.cta = objective.cta;
    return ask('special', say(
      english,
      'Special ad category: reply housing, employment, credit, or issues. If this is not one of those, reply none.',
      'Special ad category: housing, employment, credit, ya issues. Inme se nahi hai to none likho.'
    ));
  }
  if (draft.step === 'special') {
    const special = specialFrom(text);
    if (special == null) {
      return { text: say(english, 'Reply none, housing, employment, credit, or issues.', 'None, housing, employment, credit, ya issues likho.') };
    }
    payload.specialCategory = special;
    return ask('audience', say(
      english,
      'Age and gender are optional. Example: 25-45 women. Or reply skip.',
      'Age aur gender optional hai. Example: 25-45 women. Ya skip likho.'
    ));
  }
  if (draft.step === 'audience') {
    const audience = audienceFrom(text);
    if (audience.error === 'age') {
      return { text: say(english, 'Use an age range from 13 to 65, such as 25-45, or reply skip.', 'Age 13 se 65 ke beech do, jaise 25-45, ya skip likho.') };
    }
    if (audience.error) {
      return { text: say(english, 'Example: 25-45 women. Or reply skip.', 'Example: 25-45 women. Ya skip likho.') };
    }
    if (audience.ageMin) payload.ageMin = audience.ageMin;
    if (audience.ageMax) payload.ageMax = audience.ageMax;
    if (audience.gender) payload.gender = audience.gender;
    return choosePage(organizationId, conversationId, payload, english);
  }
  if (draft.step === 'page') {
    const pages = Array.isArray(payload.pages) ? payload.pages : [];
    const number = Number(text.trim());
    const picked = Number.isInteger(number) && pages[number - 1]
      ? pages[number - 1]
      : pages.find((page) => page.name.toLowerCase() === text.trim().toLowerCase());
    if (!picked) {
      return { text: say(english, 'Reply with the page number from the list.', 'List mein se page number bhejo.') };
    }
    payload.pageId = picked.id;
    payload.pageName = picked.name;
    delete payload.pages;
    return buildPlan(organizationId, conversationId, payload, english);
  }
  if (draft.step === 'image') {
    return acceptCreative(organizationId, conversationId, payload, text, english);
  }
  if (draft.step === 'approval') {
    return approve(organizationId, conversationId, draft, payload, text, english);
  }
  return null;
}

async function pickRegion(organizationId, conversationId, payload, text, english, step) {
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  if (step === 'region' && indiaWide(text)) {
    payload.region = 'India';
    payload.locations = [];
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return { text: say(english, 'What is the daily budget? Send a number, for example 500.', 'Daily budget kitna hai? Number bhejo, jaise 500.') };
  }
  let choices = step === 'region_pick' && Array.isArray(payload.locationChoices) ? payload.locationChoices : [];
  if (step === 'region_pick') {
    const number = Number(text.trim());
    const picked = Number.isInteger(number) ? choices[number - 1] : null;
    if (!picked) return { text: say(english, 'Reply with the city number from the list.', 'List mein se city number bhejo.') };
    payload.region = picked.region ? `${picked.name}, ${picked.region}` : picked.name;
    payload.locations = [{ key: picked.key, name: picked.name, radiusMode: 'city' }];
    delete payload.locationChoices;
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return { text: say(english, 'What is the daily budget? Send a number, for example 500.', 'Daily budget kitna hai? Number bhejo, jaise 500.') };
  }
  try {
    choices = await searchMetaAudience({ apiKey: account.apiKey, kind: 'city', query: text });
  } catch {
    choices = [];
  }
  const exact = choices.filter((city) => city.name.toLowerCase() === text.trim().toLowerCase());
  const picked = exact.length === 1 ? exact[0] : (choices.length === 1 ? choices[0] : null);
  if (picked) {
    payload.region = picked.region ? `${picked.name}, ${picked.region}` : picked.name;
    payload.locations = [{ key: picked.key, name: picked.name, radiusMode: 'city' }];
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return { text: say(english, 'What is the daily budget? Send a number, for example 500.', 'Daily budget kitna hai? Number bhejo, jaise 500.') };
  }
  if (choices.length > 1) {
    payload.locationChoices = choices.slice(0, 5);
    await saveDraft(organizationId, conversationId, 'region_pick', payload);
    const lines = payload.locationChoices.map((city, index) => `${index + 1}. ${city.name}${city.region ? `, ${city.region}` : ''}`);
    return { text: say(english, `Which city?\n${lines.join('\n')}`, `Kaunsi city?\n${lines.join('\n')}`) };
  }
  return { text: say(english, 'Meta did not find that city. Send another city, or say all India.', 'Meta ko yeh city nahi mili. Doosri city bhejo, ya all India likho.') };
}

async function choosePage(organizationId, conversationId, payload, english) {
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  let pages = [];
  try {
    pages = await listMetaPages({ apiKey: account.apiKey, accountId: account.accountId });
  } catch (error) {
    return { text: say(english, `Meta did not return a Facebook Page. ${String(error.message || '').slice(0, 160)}`, `Meta ne Facebook Page nahi di. ${String(error.message || '').slice(0, 160)}`) };
  }
  if (!pages.length) {
    await clearDraft(conversationId);
    return { text: say(english, 'This Meta token has no Facebook Page. Add a Page on the token, then say run meta ads again.', 'Is Meta token pe Facebook Page nahi hai. Page add karke run meta ads dubara likho.') };
  }
  if (pages.length === 1) {
    payload.pageId = pages[0].id;
    payload.pageName = pages[0].name;
    return buildPlan(organizationId, conversationId, payload, english);
  }
  payload.pages = pages.slice(0, 8).map((page) => ({ id: page.id, name: page.name }));
  await saveDraft(organizationId, conversationId, 'page', payload);
  const lines = payload.pages.map((page, index) => `${index + 1}. ${page.name}`);
  return { text: say(english, `Which Facebook Page should run the ad?\n${lines.join('\n')}`, `Ad kis Facebook Page se chalegi?\n${lines.join('\n')}`) };
}

async function buildPlan(organizationId, conversationId, payload, english) {
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  const library = await searchPublicAds({ apiKey: account.apiKey, query: payload.product || payload.category });
  payload.publicNote = library.note || '';
  payload.publicAds = library.ads.slice(0, 5);
  let interests = [];
  try {
    const found = await searchMetaAudience({ apiKey: account.apiKey, kind: 'interest', query: payload.category });
    interests = found.slice(0, 3);
  } catch {
    interests = [];
  }
  payload.interests = interests;
  let plan;
  try {
    const written = await writeAdPlan({
      intake: { ...payload, organizationId },
      publicAds: payload.publicAds,
      english
    });
    plan = planFromModel(written?.text || '', payload);
    if (!lineField(written?.text || '', 'STRATEGY')) {
      plan.strategy = say(
        english,
        'No ad-writing model answered, so this copy uses only the details you sent.',
        'Ad writing model ne jawab nahi diya, isliye copy sirf aapki details se bani hai.'
      );
    }
  } catch {
    plan = planFromModel('', payload);
    plan.strategy = say(
      english,
      'The ad model did not answer, so this copy uses only the details you sent.',
      'Ad model ne jawab nahi diya, isliye copy sirf aapki details se bani hai.'
    );
  }
  payload.headline = plan.headline;
  payload.message = plan.message;
  payload.strategy = plan.strategy;
  payload.cta = plan.cta || payload.cta;
  await saveDraft(organizationId, conversationId, 'image', payload);
  const interestLine = interests.length
    ? say(english, `Interests Meta returned: ${interests.map((item) => item.name).join(', ')}.`, `Meta interests: ${interests.map((item) => item.name).join(', ')}.`)
    : say(english, 'Meta did not return an interest for this category, so none is attached.', 'Is category ke liye Meta ne interest nahi diya, isliye interest attach nahi hai.');
  return {
    text: [
      say(english, 'I am the AIRO assistant. Here is the Meta plan. It is not published yet.', 'I am the AIRO assistant. Yeh Meta plan hai. Abhi publish nahi hua.'),
      researchLines(payload.publicNote, payload.publicAds, english),
      say(english, `Strategy: ${payload.strategy}`, `Strategy: ${payload.strategy}`),
      say(
        english,
        `Page ${payload.pageName}. Objective ${payload.objectiveLabel}. Daily budget ${payload.dailyBudget}. Region ${payload.region}. Special category ${payload.specialCategory || 'none'}.`,
        `Page ${payload.pageName}. Objective ${payload.objectiveLabel}. Daily budget ${payload.dailyBudget}. Region ${payload.region}. Special category ${payload.specialCategory || 'none'}.`
      ),
      interestLine,
      `Headline: ${payload.headline}`,
      `Text: ${payload.message}`,
      say(
        english,
        'Send an https link to a JPG or PNG under 2 MB. To change the copy first, send it as: headline | ad text',
        'JPG ya PNG ka https link bhejo, 2 MB se kam. Copy badalni ho to pehle aise bhejo: headline | ad text'
      )
    ].join('\n')
  };
}

async function acceptCreative(organizationId, conversationId, payload, text, english) {
  if (text.includes('|') && !publicImageUrl(text)) {
    const [headline, message] = text.split('|').map((part) => part.trim());
    if (!headline || !message) {
      return { text: say(english, 'Send the new copy as: headline | ad text', 'Nayi copy aise bhejo: headline | ad text') };
    }
    payload.headline = headline.slice(0, 40);
    payload.message = message.slice(0, 200);
    await saveDraft(organizationId, conversationId, 'image', payload);
    return {
      text: say(
        english,
        `Updated.\nHeadline: ${payload.headline}\nText: ${payload.message}\nNow send the https image link.`,
        `Update ho gaya.\nHeadline: ${payload.headline}\nText: ${payload.message}\nAb image ka https link bhejo.`
      )
    };
  }
  const imageUrl = publicImageUrl(text);
  if (!imageUrl) {
    return { text: say(english, 'Send a direct https link to a JPG or PNG under 2 MB.', 'JPG ya PNG ka direct https link bhejo, 2 MB se kam.') };
  }
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  let imageBase64;
  try {
    imageBase64 = await downloadImage(imageUrl);
  } catch (error) {
    return { text: say(english, error.message, error.message) };
  }
  try {
    const created = await createMetaAd({
      apiKey: account.apiKey,
      accountId: account.accountId,
      name: String(payload.product || 'Meta ad').slice(0, 80),
      objective: payload.objectiveKey,
      dailyBudget: payload.dailyBudget,
      pageId: payload.pageId,
      headline: payload.headline,
      message: payload.message,
      link: payload.website,
      imageBase64,
      publish: false,
      budgetLevel: 'adset',
      budgetMode: 'daily',
      advantageAudience: true,
      specialCategory: payload.specialCategory || '',
      ageMin: payload.ageMin,
      ageMax: payload.ageMax,
      gender: payload.gender || '',
      interests: payload.interests || [],
      locations: payload.locations || [],
      conversion: payload.conversion,
      cta: payload.cta
    });
    payload.campaignId = created.campaignId;
    await saveDraft(organizationId, conversationId, 'approval', payload, created.campaignId);
    await rememberCampaign(organizationId, account, created, payload);
    await recordAudit({ auth: null, ip: null }, {
      action: 'connection.meta_ad_created',
      resource: 'connection',
      resourceId: account.connectionId,
      organizationId,
      metadata: { channel: 'whatsapp', publish: false }
    });
    return {
      text: say(
        english,
        `Paused campaign saved on Meta. Campaign id ${created.campaignId}. It is not live. Reply haan to publish, or nahi to leave it paused.`,
        `Paused campaign Meta pe save ho gaya. Campaign id ${created.campaignId}. Abhi live nahi hai. Publish karne ke liye haan likho, paused chhodne ke liye nahi.`
      )
    };
  } catch (error) {
    const reason = String(error.message || 'Meta did not save the ad.').replace(/access_token=[^&\s]+/gi, '').slice(0, 200);
    return { text: say(english, `Meta did not save the ad. ${reason} Send the image link again, or say cancel.`, `Meta ne ad save nahi kiya. ${reason} Image link dubara bhejo, ya cancel likho.`) };
  }
}

async function approve(organizationId, conversationId, draft, payload, text, english) {
  const yes = /^(haan|han|ha|yes|y|publish|live)\b/i.test(text.trim());
  const no = /^(nahi|nahin|no|mat|pause|ruk)\b/i.test(text.trim());
  if (!yes && !no) {
    return { text: say(english, 'Reply haan to publish this paused campaign, or nahi to leave it paused.', 'Publish ke liye haan likho, paused chhodne ke liye nahi.') };
  }
  if (no) {
    await saveDraft(organizationId, conversationId, 'done', payload, draft.campaignId);
    return { text: say(english, `Campaign ${draft.campaignId} stays paused. You can turn it on later from Connections, Meta Ads.`, `Campaign ${draft.campaignId} paused hi rahegi. Baad mein Connections, Meta Ads se on kar sakte ho.`) };
  }
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  try {
    await setMetaCampaignStatus({ apiKey: account.apiKey, campaignId: draft.campaignId, status: 'ACTIVE' });
  } catch (error) {
    const reason = String(error.message || 'Meta did not publish the campaign.').slice(0, 200);
    return { text: say(english, `The campaign is still paused. ${reason}`, `Campaign abhi bhi paused hai. ${reason}`) };
  }
  await saveDraft(organizationId, conversationId, 'done', payload, draft.campaignId);
  await upsertObject({
    organizationId,
    connectionId: account.connectionId,
    objectType: 'campaign',
    externalId: String(draft.campaignId),
    name: String(payload.product || 'Meta ad').slice(0, 180),
    parentExternalId: null,
    payload: {
      origin: 'api',
      status: 'ACTIVE',
      objective: payload.objectiveKey,
      budget: String(payload.dailyBudget),
      budgetKind: 'daily'
    }
  });
  await recordAudit({ auth: null, ip: null }, {
    action: 'connection.meta_ad_published',
    resource: 'connection',
    resourceId: account.connectionId,
    organizationId,
    metadata: { channel: 'whatsapp', publish: true }
  });
  return {
    text: say(
      english,
      `Published. Campaign ${draft.campaignId}, its ad set, and its ad are active on Meta.`,
      `Publish ho gaya. Campaign ${draft.campaignId}, uska ad set, aur ad Meta pe active hain.`
    )
  };
}
