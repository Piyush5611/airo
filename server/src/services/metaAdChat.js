import { one, run } from '../db/sql.js';
import { decryptJson } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';
import { addMetaImageAd, campaignObjective, createMetaAd, createMetaAdSet, createMetaCampaign, listMetaPages, searchMetaAudience, searchPublicAds, setMetaCampaignStatus } from '../integrations/metaAds.js';
import { upsertObject } from '../repositories/connectionRepo.js';
import { recordAudit } from './auditService.js';
import { writeAdPlan } from './llmService.js';
import { clearGoogleDraft } from './googleAdChat.js';
import { LINE, bullets, card, field, header, hint, money, numbered, options, section, step as fmtStep } from './adsAgent/waFormat.js';
import {
  businessProfile, chosenNames, hasProfileDetails, resolveMetaCities, resolveMetaInterests, suggestTargeting, writeMetaCopy
} from './adsAgent/chatPlanner.js';
import { variantCreatives } from './adsAgent/adCreative.js';

const START = /\b(run|start|launch|chalao|chala|banao)\b.{0,40}\bmeta\b|\bmeta\s+ads?\b.{0,24}\b(run|start|launch|chalao|chala|banao)\b/i;
const OTHER_ADS = /\b(linkedin|youtube)\b.{0,24}\bads?\b|\b(run|start|launch|chalao|chala|banao)\b.{0,40}\b(linkedin|youtube)\b/i;
const STALE_HOURS = 24;
const GREETING = /^(hi+|hello|hey|hlo|namaste|namaskar|good\s+(morning|afternoon|evening))[\s!.?]*$/i;
const CANCEL = /^(cancel|stop|ruk|band|nahi chahiye|nahin chahiye)\b/i;
const FILLER = /^(hi+|hello|hey|hlo|ok|okay|k|yes|haan|han|ha|no|nahi|thik|theek|done|start|go|meta|meta ads?|ads?|run meta ads?)[\s!.?]*$/i;
const SKIP_IMAGE = /^(skip|baad mein|baad me|later|no image|image nahi|image nahin|without image)\b|\b(bina|without) (photo|image)\b/i;
export const USE_DESIGN = /\b(design|designs|creative|save|rakho|rakh|final|ok|okay|haan|han|yes|done|banao|bana do|publish|lagao|laga|lga|chalao|theek|thik|sahi|perfect|good|badhiya|accha|achha)\b/i;
export const NOT_DESIGN = /\b(nahi|nahin|nhi|no|mat|change|badlo|badal|dusra|doosra|dusri|doosri|pasand nahi|achha nahi|accha nahi)\b|\?/i;
export const RAW_PHOTO = /\b(original|as is|as-is|raw|bina design|without design)\b/i;
const REPORT = /\b(report|nexcall|hisab|yesterday|aaj ka|calling report|kitne call)\b/i;
const HINGLISH = /\b(kya|hai|hain|karo|chahiye|bhejo|nahi|nahin|haan|mujhe|mera|meri|chalao|banao|ruk|theek|thik|yaar|kro)\b/i;
const CTA = new Set(['LEARN_MORE', 'SIGN_UP', 'SHOP_NOW', 'BOOK_NOW']);

export function budgetAmount(text) {
  const value = String(text || '');
  const match = value.replace(/(\d),(\d)/g, '$1$2').match(/(\d+(?:\.\d+)?)\s*(k|thousand|hazar|hazaar|hajar|lakh|lakhs|lac|lacs)?\b/i);
  if (!match) return 0;
  const unit = /^la/i.test(match[2] || '') ? 100000 : match[2] ? 1000 : 1;
  const amount = Number(match[1]) * unit;
  return Math.round(/\b(month|monthly|mahina|mahine|mahiney|per month|pm)\b/i.test(value) ? amount / 30 : amount);
}

function budgetHint(reason, english) {
  if (!/budget/i.test(reason)) return '';
  return say(english, ' To change it, reply for example: budget 600', ' Badalne ke liye aise likho: budget 600');
}

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
    `SELECT id, step, payload, campaign_id AS campaignId,
       TIMESTAMPDIFF(HOUR, updated_at, NOW()) AS ageHours
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

export async function metaAccount(organizationId) {
  const row = await one(
    `SELECT c.id, c.status, c.mode, cred.ciphertext
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND p.provider_key = 'meta_ads' AND c.status = 'connected' AND c.mode = 'live'
     ORDER BY c.id
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

function withoutWebsite(text) {
  const value = String(text || '').toLowerCase();
  if (/^(no|nahi|nahin|nhi|none|skip)$/i.test(value.trim())) return true;
  const mentionsSite = /web\s*si|website|site\b|link\b/.test(value);
  const denies = /don'?t|do not|nahi|nahin|nhi|no\b|without|not have|nai/.test(value);
  return mentionsSite && denies;
}

function adLink(payload) {
  if (payload.website) return payload.website;
  return `https://www.facebook.com/${payload.pageId}`;
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
    return hint(say(
      english,
      note || 'Public competitor ads could not be read. I will not guess them.',
      note || 'Public competitor ads padhe nahi ja sake. Main unhe guess nahi karunga.'
    ));
  }
  const rows = ads.slice(0, 5).map((ad) => [ad.page, ad.title].filter(Boolean).join(': ') || ad.text);
  return section(say(english, 'Public ads found', 'Public ads mile'), bullets(rows));
}

function checkedImage(raw) {
  const cleaned = String(raw || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s/g, '');
  const bytes = Buffer.from(cleaned, 'base64');
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if ((!jpeg && !png) || bytes.length < 100 || bytes.length > 2500000) {
    throw new ApiError(422, 'Send a JPG or PNG photo under 2 MB. A sticker will not work.', 'validation_error');
  }
  return cleaned;
}

function sharedPhoto(text, imageBase64, imageError) {
  return Boolean(imageBase64 || imageError) || /^Photo \d{6,40}$/.test(String(text || ''));
}

function imageAsk(english, designs = false) {
  if (designs) {
    return card([
      section(say(english, 'Next: pick the creative', 'Ab creative chuno'), [
        hint(say(english, 'AIRO designed one image per variant (shown above).', 'AIRO ne har variant ki alag image design ki hai (upar dekho).'))
      ]),
      options([
        ['design', say(english, 'create the paused ad with these designs', 'inhi designs se paused ad bana do')],
        [say(english, 'send a photo', 'photo bhejo'), say(english, 'your photo becomes the design background', 'aapki photo design ka background banegi')],
        ['original', say(english, 'next photo is used as-is, no design', 'agli photo bina design ke as-is lagegi')],
        ['skip', say(english, 'save without image for now', 'abhi bina image save karo')],
        ['cancel', say(english, 'stop this setup', 'setup band karo')]
      ])
    ]);
  }
  return card([
    section(say(english, 'Next: send the ad photo', 'Ab ad ki photo bhejo'), [
      hint(say(english, 'JPG or PNG under 2 MB, in this chat. An https image link also works.', 'JPG ya PNG, 2 MB se kam, isi chat mein. https image link bhi chalega.'))
    ]),
    options([
      [say(english, 'photo', 'photo'), say(english, 'create the paused ad', 'paused ad bana do')],
      ['skip', say(english, 'save without photo for now', 'abhi bina photo save karo')],
      ['cancel', say(english, 'stop this setup', 'setup band karo')]
    ])
  ]);
}

async function downloadImage(url) {
  let response;
  try {
    response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ApiError(422, 'The image link did not open.', 'validation_error');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ApiError(422, 'Send a direct https link to the image, or share the photo in this chat.', 'validation_error');
  }
  if (!response.ok) throw new ApiError(422, 'The image link did not open.', 'validation_error');
  const length = Number(response.headers.get('content-length') || 0);
  if (length > 2500000) throw new ApiError(422, 'Send a JPG or PNG photo under 2 MB.', 'validation_error');
  const bytes = Buffer.from(await response.arrayBuffer());
  return checkedImage(bytes.toString('base64'));
}

function titleCase(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').replace(/\b([a-z])/g, (char) => char.toUpperCase());
}

export function campaignName(payload) {
  if (payload.campaignName) return payload.campaignName;
  const usable = (value) => (value && !FILLER.test(String(value).trim()) ? value : '');
  const title = titleCase(usable(payload.product) || usable(payload.category) || payload.pageName || 'Meta ad').slice(0, 60);
  const places = String(payload.region || '').split(/[;,]/).map((item) => item.trim()).filter(Boolean);
  const place = places.length > 2 ? `${places.slice(0, 2).join(', ')} +${places.length - 2}` : places.join(', ') || 'India';
  const goal = payload.conversion === 'messenger' ? 'Leads (Messenger)' : titleCase(payload.objectiveLabel || 'Leads');
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
  payload.campaignName = `${title} | ${place} | ${goal} | ${date}`.slice(0, 150);
  return payload.campaignName;
}

async function rememberCampaign(organizationId, account, created, intake) {
  await upsertObject({
    organizationId,
    connectionId: account.connectionId,
    objectType: 'campaign',
    externalId: created.campaignId,
    name: campaignName(intake),
    parentExternalId: null,
    payload: {
      origin: 'api',
      status: 'PAUSED',
      objective: campaignObjective(intake.objectiveKey, intake.conversion),
      goal: intake.conversion === 'messenger' ? 'messages' : '',
      budget: String(intake.dailyBudget),
      budgetKind: 'daily'
    }
  });
  for (const set of created.adsets || []) {
    await upsertObject({
      organizationId,
      connectionId: account.connectionId,
      objectType: 'adset',
      externalId: set.id,
      name: set.name,
      parentExternalId: String(created.campaignId),
      payload: { origin: 'api', status: 'PAUSED', budget: String(intake.dailyBudget), campaignId: String(created.campaignId) }
    });
  }
  for (const ad of created.ads || []) {
    await upsertObject({
      organizationId,
      connectionId: account.connectionId,
      objectType: 'ad',
      externalId: ad.id,
      name: ad.name,
      parentExternalId: ad.adsetId,
      payload: { origin: 'api', status: 'PAUSED', campaignId: String(created.campaignId) }
    });
  }
}

export async function handleMetaAdChat({ organizationId, conversationId, recognized, messages, imageBase64 = '', imageError = '', force = false, forwarded = false }) {
  const text = lastUser(messages);
  if ((!text && !imageBase64 && !imageError) || !organizationId || !conversationId) return null;
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
  if (!starting && recognized && OTHER_ADS.test(text)) {
    const english = englishOnly(text);
    const name = text.match(/linkedin|youtube/i)[0].toLowerCase();
    const label = { linkedin: 'LinkedIn', youtube: 'YouTube' }[name];
    const open = draft && draft.step !== 'done';
    return {
      text: say(
        english,
        `${label} ads cannot be created from WhatsApp yet. Open AIRO, then Connections, Advertising, ${label === 'YouTube' ? 'Google' : label} Ads.${open ? ' Your Meta ad setup in this chat is still open. Say cancel to stop it.' : ''}`,
        `${label} ads abhi WhatsApp se nahi bante. AIRO mein Connections, Advertising, ${label === 'YouTube' ? 'Google' : label} Ads kholo.${open ? ' Is chat mein Meta ad setup abhi khula hai. Band karne ke liye cancel likho.' : ''}`
      )
    };
  }
  if (draft && draft.step !== 'done' && !starting && Number(draft.ageHours) >= STALE_HOURS) {
    await clearDraft(conversationId);
    draft = null;
  }
  if (!draft && !starting) return null;
  if (draft?.step === 'done' && !starting) {
    const english = englishOnly(text) && draft.payload.lang !== 'hi';
    const needsAdSet = draft.payload?.skippedImage && draft.campaignId && !draft.payload?.adsetId && !REPORT.test(text);
    const canUsePhoto = sharedPhoto(text, imageBase64, imageError) && draft.payload?.adsetId && !draft.payload?.adId;
    if (!needsAdSet && !canUsePhoto) return null;
    if (!recognized) {
      return {
        text: say(
          english,
          'This WhatsApp number is not registered to a business in AIRO. A Meta ad can only be created for a registered business number.',
          'Yeh WhatsApp number kisi business se registered nahi hai. Meta ad sirf registered business number se banta hai.'
        )
      };
    }
    if (needsAdSet) return attachAdSet(organizationId, conversationId, draft, english, imageBase64, imageError);
    return finishAd(organizationId, conversationId, draft.payload, text, english, imageBase64, imageError);
  }
  if (!force && draft && !starting && REPORT.test(text)) return null;
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
  if (GREETING.test(text)) {
    const english = draft.payload.lang !== 'hi';
    return {
      text: say(
        english,
        `Hi, I am the AIRO assistant. A Meta ad setup${draft.payload.product ? ` for ${draft.payload.product}` : ''} is still open in this chat. Continue with the last question, or reply cancel to close it and ask me anything else.`,
        `Hi, main AIRO assistant hoon. Is chat mein ek Meta ad setup${draft.payload.product ? ` (${draft.payload.product})` : ''} abhi khula hai. Pichhle sawaal ka jawab do, ya band karke kuch aur poochhne ke liye cancel likho.`
      )
    };
  }
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
  const photo = sharedPhoto(text, imageBase64, imageError);
  if (photo && draft.step !== 'image' && draft.step !== 'ad' && /^Photo \d{6,40}$/.test(text)) {
    return {
      text: say(
        draft.payload.lang === 'en',
        'Photo received. Answer this question in text. Send the photo again when I ask for the ad image.',
        'Photo mil gayi. Is sawaal ka jawab text mein bhejo. Ad ki photo tab bhejna jab main maangu.'
      )
    };
  }
  if (!force && draft.step === 'approval' && !/^(haan|han|ha|yes|y|publish|live|nahi|nahin|no|mat|pause|ruk)\b/i.test(text.trim())) return null;
  if (forwarded && (imageBase64 || imageError) && draft.step === 'image' && !draft.payload?.rawPhoto) {
    const english = draft.payload.lang === 'en';
    const result = await continueDraft(organizationId, conversationId, draft, 'design', messages);
    const note = say(english, '_Forwarded image taken as "use the AIRO designs". To use your own photo, send it from the camera or gallery, not forwarded._', '_Forward ki hui image ko "AIRO designs use karo" maana. Apni photo lagani ho to camera ya gallery se bhejo, forward mat karo._');
    return { ...result, text: `${note}\n\n${result.text}` };
  }
  return continueDraft(organizationId, conversationId, draft, text, messages, imageBase64, imageError);
}

async function begin(organizationId, conversationId, text) {
  const english = englishOnly(text);
  const account = await metaAccount(organizationId);
  if (!account) return { text: `I am the AIRO assistant. ${connectLine(english)}` };
  const payload = { lang: english ? 'en' : 'hi', sample: text.slice(0, 80) };
  await clearGoogleDraft(conversationId);
  await saveDraft(organizationId, conversationId, 'category', payload);
  return { text: intakePrompt('category', english, payload) };
}

function publishOptions(english) {
  return section(say(english, 'Publish now?', 'Ab publish karein?'), options([
    ['haan', say(english, 'turn it on', 'on kar do')],
    ['nahi', say(english, 'keep it paused', 'paused rehne do')]
  ]));
}

function applyObjective(payload, objective) {
  payload.objectiveKey = objective.key;
  payload.objectiveLabel = objective.label;
  payload.conversion = payload.noWebsite && objective.key === 'OUTCOME_LEADS' ? 'messenger' : objective.conversion;
  payload.cta = payload.conversion === 'messenger' ? 'MESSAGE_PAGE' : objective.cta;
}

function impliedSpecial(text) {
  const value = String(text || '').toLowerCase();
  if (/\bhousing\b/.test(value)) return 'HOUSING';
  if (/\bemployment\b|\bjobs?\b/.test(value)) return 'EMPLOYMENT';
  if (/\bcredit\b|\bloan\b/.test(value)) return 'CREDIT';
  if (/\belection\b|\bpolitic/.test(value)) return 'ISSUES_ELECTIONS_POLITICS';
  return '';
}

function nextIntake(payload) {
  if (!payload.category) return 'category';
  if (!payload.product) return 'product';
  if (!payload.website && !payload.noWebsite) return 'website';
  if (!payload.detailsDone) return 'details';
  if (!payload.region && !(Array.isArray(payload.locations) && payload.locations.length)) return 'region';
  if (!payload.dailyBudget) return 'budget';
  if (!payload.objectiveKey) return 'objective';
  if (payload.noWebsite && payload.objectiveKey === 'OUTCOME_SALES' && !payload.website) return 'shop';
  return 'ready';
}

function intakePrompt(step, english, payload) {
  if (step === 'category') {
    return card([
      header('Meta Ad Setup', say(english, 'Facebook + Instagram · 5 quick steps', 'Facebook + Instagram · 5 chhote steps')),
      fmtStep(1, 5, 'Product', say(english, 'What should the ad sell?', 'Ad kis cheez ka hai?'), 'Example: 2BHK flats in Noida, salon, coaching classes')
    ]);
  }
  if (step === 'product') return fmtStep(1, 5, 'Product', say(english, 'What product or service should the ad sell?', 'Product ya service kya hai?'));
  if (step === 'website') {
    return fmtStep(
      2, 5, 'Website',
      say(english, 'Send the website link.', 'Website link bhejo.'),
      say(english, 'Starts with https://  ·  no website? reply no website', 'https:// se shuru  ·  website nahi hai? no website likho')
    );
  }
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
  const noSite = payload?.noWebsite ? hint(say(english, 'No website is fine, the ad will use the Facebook Page.', 'Website nahi hai to theek hai, ad Facebook Page use karegi.')) : '';
  if (step === 'region' && payload?.suggestion?.cities?.length) {
    const s = payload.suggestion;
    const gender = s.gender === 'all' ? say(english, 'everyone', 'sab') : s.gender;
    return card([
      `*Step 4/5 · ${say(english, 'Audience', 'Audience')}*`,
      noSite,
      section(say(english, 'AI suggested cities', 'AI suggested cities'), numbered(s.cities)),
      section(say(english, 'AI suggested audience', 'AI suggested audience'), [field('Age', `${s.ageMin}-${s.ageMax}`), field('Gender', gender)]),
      s.why ? hint(`${say(english, 'Why', 'Kyun')}: ${s.why}`) : '',
      section(say(english, 'Reply with', 'Reply karo'), options([
        ['ok', say(english, 'use all cities', 'sab cities use karo')],
        ['1,2', say(english, 'pick by number', 'number se chuno')],
        ['Delhi, Pune', say(english, 'your own cities', 'apni cities')],
        ['all India', say(english, 'whole country', 'poora desh')]
      ]))
    ]);
  }
  if (step === 'region') {
    return card([noSite, fmtStep(4, 5, say(english, 'Cities', 'Cities'), say(english, 'Which cities should this ad target?', 'Kaunsi cities target karni hain?'), say(english, 'Separate with commas, or reply all India', 'Comma se alag likho, ya all India'))]);
  }
  if (step === 'budget') {
    return fmtStep(
      5, 5, say(english, 'Budget and goal', 'Budget aur goal'),
      card([
        say(english, 'Send the daily budget and what you want:', 'Roz ka budget aur goal bhejo:'),
        bullets(say(english, ['*leads* - enquiries with name and phone', '*appointments* - bookings or visits', '*sales* - ecommerce orders'], ['*leads* - naam aur phone wali enquiries', '*appointments* - booking ya visit', '*sales* - ecommerce orders']))
      ]),
      say(english, 'Example: 500 leads', 'Example: 500 leads')
    );
  }
  if (step === 'objective') {
    return card([
      `*${say(english, 'What is the goal?', 'Goal kya hai?')}*`,
      options([['leads', say(english, 'enquiries', 'enquiries')], ['appointments', say(english, 'bookings or visits', 'booking ya visit')], ['sales', say(english, 'ecommerce orders', 'ecommerce orders')]])
    ]);
  }
  if (step === 'shop') {
    return card([
      say(english, 'Ecommerce sales need an https shop link.', 'Ecommerce sales ke liye https shop link chahiye.'),
      options([['https://...', say(english, 'your shop link', 'aapka shop link')], ['leads', say(english, 'switch to enquiries', 'enquiries pe switch')], ['appointments', say(english, 'switch to bookings', 'booking pe switch')]])
    ]);
  }
  return card([
    `*Special ad category*`,
    options([['housing', 'real estate'], ['employment', 'jobs'], ['credit', 'loans, cards'], ['issues', 'politics, social'], ['none', say(english, 'none of these', 'inme se koi nahi')]])
  ]);
}

function rememberedSite(payload, messages) {
  if (payload.website || payload.noWebsite) return;
  const lines = (messages || []).filter((row) => row.role === 'user').map((row) => String(row.content || ''));
  if (lines.some((line) => withoutWebsite(line))) {
    payload.website = '';
    payload.noWebsite = true;
    return;
  }
  const site = lines.map((line) => httpsWebsite(line)).find(Boolean);
  if (site) {
    payload.website = site;
    payload.noWebsite = false;
  }
}

function langOf(draft, text) {
  if (draft.payload.lang === 'en' && englishOnly(text)) return true;
  if (HINGLISH.test(text)) return false;
  return draft.payload.lang === 'en';
}

async function continueDraft(organizationId, conversationId, draft, text, messages, imageBase64 = '', imageError = '') {
  const english = langOf(draft, text);
  const payload = { ...draft.payload, lang: english ? 'en' : 'hi' };
  const ask = (step, message) => saveDraft(organizationId, conversationId, step, payload, draft.campaignId).then(() => ({ text: message }));
  const goNext = async () => {
    let step = nextIntake(payload);
    if (step === 'details' && hasProfileDetails(await businessProfile(organizationId))) {
      payload.detailsDone = true;
      step = nextIntake(payload);
    }
    if (step === 'region' && !payload.suggestion) {
      const suggestion = await suggestTargeting({ organizationId, payload, profile: await businessProfile(organizationId), platform: 'meta' });
      if (suggestion) {
        payload.suggestion = suggestion;
        payload.sellingPoints = suggestion.sellingPoints;
      }
    }
    if (step === 'ready') {
      if (!payload.specialCategory) payload.specialCategory = impliedSpecial(`${payload.category} ${payload.product}`);
      return choosePage(organizationId, conversationId, payload, english);
    }
    return ask(step, intakePrompt(step, english, payload));
  };

  if (draft.step === 'details') {
    payload.details = /^(skip|no|nahi|nahin|none)\b/i.test(text) ? '' : text.slice(0, 500);
    payload.detailsDone = true;
    return goNext();
  }

  if (draft.step === 'category') {
    if (text.length < 2 || FILLER.test(text)) {
      return { text: say(english, 'Tell me what the ad should sell.', 'Ad kis cheez ka hai, woh likho.') };
    }
    payload.category = text.slice(0, 80);
    payload.product = text.slice(0, 120);
    const site = httpsWebsite(text);
    if (site) {
      payload.website = site;
      payload.noWebsite = false;
      return goNext();
    }
    return ask('website', intakePrompt('website', english, payload));
  }
  if (draft.step === 'product') {
    if (text.length < 2 || FILLER.test(text)) return { text: say(english, 'Tell me the product or service.', 'Product ya service likho.') };
    payload.product = text.slice(0, 120);
    return goNext();
  }
  if (draft.step === 'website') {
    rememberedSite(payload, messages);
    const website = httpsWebsite(text);
    if (website) {
      payload.website = website;
      payload.noWebsite = false;
    } else if (withoutWebsite(text) || payload.noWebsite) {
      payload.website = '';
      payload.noWebsite = true;
    } else {
      return { text: say(english, 'Send an https website link, or say no website.', 'https website link bhejo, ya no website likho.') };
    }
    return goNext();
  }
  if (draft.step === 'region' || draft.step === 'region_pick') {
    return pickRegion(organizationId, conversationId, payload, text, english, draft.step);
  }
  if (draft.step === 'budget') {
    const amount = budgetAmount(text);
    if (amount < 1) {
      return { text: say(english, 'Send the budget and objective, for example 500 leads.', 'Budget aur objective bhejo, jaise 500 leads.') };
    }
    if (amount < 100 && !/\$|usd|dollar/i.test(text)) {
      return { text: say(english, `₹${amount} a day is too low. Meta needs about ₹100 a day or more per ad set. Send a higher daily budget, for example 500 leads.`, `₹${amount} roz bahut kam hai. Meta ko har ad set ke liye lagbhag ₹100 roz ya zyada chahiye. Zyada daily budget bhejo, jaise 500 leads.`) };
    }
    payload.dailyBudget = amount;
    const objective = objectiveFrom(text);
    if (objective) applyObjective(payload, objective);
    return goNext();
  }
  if (draft.step === 'objective') {
    const objective = objectiveFrom(text);
    if (!objective) {
      return { text: say(english, 'Reply with leads, appointments, or ecommerce sales.', 'Leads, appointments, ya ecommerce sales likho.') };
    }
    applyObjective(payload, objective);
    return goNext();
  }
  if (draft.step === 'shop') {
    const website = httpsWebsite(text);
    if (website) {
      payload.website = website;
      payload.noWebsite = false;
      payload.objectiveKey = 'OUTCOME_SALES';
      payload.objectiveLabel = 'ecommerce sales';
      payload.conversion = 'website';
      payload.cta = 'SHOP_NOW';
    } else {
      const objective = objectiveFrom(text);
      if (!objective || objective.key === 'OUTCOME_SALES') {
        return { text: say(english, 'Send the https shop link, or reply leads or appointments.', 'https shop link bhejo, ya leads ya appointments likho.') };
      }
      payload.objectiveKey = objective.key;
      payload.objectiveLabel = objective.label;
      payload.conversion = objective.key === 'OUTCOME_LEADS' ? 'messenger' : objective.conversion;
      payload.cta = payload.conversion === 'messenger' ? 'MESSAGE_PAGE' : objective.cta;
    }
    const step = nextIntake(payload);
    if (step === 'ready') return goNext();
    return ask(step, intakePrompt(step, english, payload));
  }
  if (draft.step === 'special' || draft.step === 'audience') {
    if (draft.step === 'special') {
      const special = specialFrom(text);
      payload.specialCategory = special || impliedSpecial(text);
    }
    if (draft.step === 'audience') {
      const audience = audienceFrom(text);
      if (!audience.error) {
        if (audience.ageMin) payload.ageMin = audience.ageMin;
        if (audience.ageMax) payload.ageMax = audience.ageMax;
        if (audience.gender) payload.gender = audience.gender;
      }
    }
    if (!payload.specialCategory) payload.specialCategory = impliedSpecial(`${payload.category} ${payload.product}`);
    return choosePage(organizationId, conversationId, payload, english);
  }
  if (draft.step === 'ad') return finishAd(organizationId, conversationId, payload, text, english, imageBase64, imageError);
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
    return acceptCreative(organizationId, conversationId, payload, text, english, imageBase64, imageError);
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
    return { text: intakePrompt('budget', english, payload) };
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
    return { text: intakePrompt('budget', english, payload) };
  }
  const names = chosenNames(text, payload.suggestion?.cities || []);
  if (names.length > 1 || payload.suggestion?.cities?.length) {
    const { found, missing } = await resolveMetaCities(account.apiKey, names);
    if (!found.length) {
      return { text: say(english, 'Meta did not find those cities. Send other cities, or say all India.', 'Meta ko ye cities nahi mili. Doosri cities bhejo, ya all India likho.') };
    }
    payload.locations = found.map(({ key, name, radiusMode }) => ({ key, name, radiusMode }));
    payload.region = found.map((city) => (city.region ? `${city.name}, ${city.region}` : city.name)).join('; ');
    await saveDraft(organizationId, conversationId, 'budget', payload);
    return {
      text: card([
        section(say(english, 'Cities set', 'Cities set'), bullets(found.map((city) => (city.region ? `${city.name}, ${city.region}` : city.name)))),
        missing.length ? hint(say(english, `Not found on Meta: ${missing.join(', ')}`, `Meta pe nahi mili: ${missing.join(', ')}`)) : '',
        LINE,
        intakePrompt('budget', english, payload)
      ])
    };
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
    return { text: intakePrompt('budget', english, payload) };
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
    pages = (await listMetaPages({ apiKey: account.apiKey, accountId: account.accountId })).pages || [];
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
  const suggestion = payload.suggestion;
  let interests = suggestion?.interestSeeds?.length ? await resolveMetaInterests(account.apiKey, suggestion.interestSeeds) : [];
  if (!interests.length) {
    try {
      const found = await searchMetaAudience({ apiKey: account.apiKey, kind: 'interest', query: payload.category });
      interests = found.slice(0, 3);
    } catch {
      interests = [];
    }
  }
  payload.interests = interests;
  if (suggestion && !payload.specialCategory) {
    if (!payload.ageMin) payload.ageMin = suggestion.ageMin;
    if (!payload.ageMax) payload.ageMax = suggestion.ageMax;
    if (!payload.gender && suggestion.gender !== 'all') payload.gender = suggestion.gender;
  }
  try {
    const copy = await writeMetaCopy({
      organizationId,
      payload,
      profile: await businessProfile(organizationId),
      publicAds: payload.publicAds,
      english
    });
    payload.variants = copy.variants;
    payload.headline = copy.variants[0].headline;
    payload.message = copy.variants[0].primaryText;
    payload.headlineB = copy.variants[1]?.headline || '';
    payload.messageB = copy.variants[1]?.primaryText || '';
    payload.strategy = copy.strategy;
    await saveDraft(organizationId, conversationId, 'image', payload);
    return { text: metaPlanText(payload, english), images: designImages(payload, english) };
  } catch {
    payload.variants = [];
    payload.headlineB = '';
    payload.messageB = '';
  }
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
  payload.variants = [{ angle: '', headline: payload.headline, primaryText: payload.message }];
  await saveDraft(organizationId, conversationId, 'image', payload);
  return { text: metaPlanText(payload, english), images: designImages(payload, english) };
}

function renderDesigns(payload, photoBase64 = '') {
  try {
    return variantCreatives(payload, { photoBase64 });
  } catch (error) {
    console.error('Meta ad design skipped:', String(error?.message || 'failed').slice(0, 180));
    return [];
  }
}

function designImages(payload, english, pngs = renderDesigns(payload)) {
  const variants = payload.variants?.length ? payload.variants : [{ headline: payload.headline }];
  return pngs.map((png, index) => ({
    png,
    caption: `*${say(english, 'Design', 'Design')} ${index + 1}*${variants.length > 1 ? ` · ${say(english, 'Variant', 'Variant')} ${index + 1}` : ''}\n${variants[index]?.headline || ''}`
  }));
}

function audienceFields(payload, english) {
  if (payload.specialCategory) {
    return [
      field(say(english, 'Locations', 'Locations'), payload.region),
      hint(say(english, `Special category ${payload.specialCategory}: Meta decides age and gender.`, `Special category ${payload.specialCategory}: age aur gender Meta decide karega.`))
    ];
  }
  const gender = payload.gender === 'men' ? 'men' : payload.gender === 'women' ? 'women' : say(english, 'everyone', 'sab');
  const ageMin = Number(payload.ageMin) || 18;
  const ageMax = Number(payload.ageMax) || 65;
  const capped = ageMin > 25 || ageMax < 65;
  return [
    field(say(english, 'Locations', 'Locations'), payload.region),
    field('Age', `${Math.min(ageMin, 25)}-65`),
    field('Gender', gender),
    field('Advantage+ audience', 'on'),
    capped ? hint(say(english, `Best fit is ${ageMin}-${ageMax}. With Advantage+ on, Meta only allows a minimum age up to 25, and it finds the best age itself.`, `Best fit ${ageMin}-${ageMax} hai. Advantage+ on hone pe Meta minimum age 25 tak hi leta hai, aur sahi age khud dhoondhta hai.`)) : ''
  ];
}

function variantBlock(item, index, total, english) {
  const role = total > 1 && index === 0 ? say(english, 'main ad', 'main ad') : total > 1 && index === 1 ? say(english, 'A/B test', 'A/B test') : total > 2 ? say(english, 'backup', 'backup') : '';
  return [
    `*${say(english, 'Variant', 'Variant')} ${index + 1}*${item.angle ? ` · ${item.angle}` : ''}${role ? `  _(${role})_` : ''}`,
    `> *${item.headline}*`,
    ...String(item.primaryText).split(/\n+/).map((line) => `> ${line}`)
  ].join('\n');
}

function metaPlanText(payload, english) {
  const interests = payload.interests || [];
  const variants = payload.variants?.length ? payload.variants : [{ angle: '', headline: payload.headline, primaryText: payload.message }];
  return card([
    header('Meta Ad Plan', say(english, 'Facebook + Instagram · draft, not published', 'Facebook + Instagram · draft, abhi publish nahi')),
    section('Strategy', payload.strategy),
    section('Setup', [
      field(say(english, 'Campaign name', 'Campaign name'), campaignName({ ...payload })),
      field('Page', payload.pageName),
      field(say(english, 'Goal', 'Goal'), payload.objectiveLabel),
      field(say(english, 'Daily budget', 'Daily budget'), money(payload.dailyBudget, payload.currency)),
      field('Website', payload.website || say(english, 'none, uses the Facebook Page', 'nahi, Facebook Page use hogi'))
    ]),
    section('Audience', audienceFields(payload, english)),
    section(
      say(english, 'Interests', 'Interests'),
      interests.length
        ? [hint(say(english, 'Checked on Meta', 'Meta pe check kiye')), interests.map((item) => item.name).join(' · ')]
        : hint(say(english, 'Meta returned no matching interest, so targeting stays broad.', 'Meta ne matching interest nahi diya, isliye targeting broad rahegi.'))
    ),
    researchLines(payload.publicNote, payload.publicAds, english),
    section(say(english, 'Ad copy', 'Ad copy'), variants.map((item, index) => variantBlock(item, index, variants.length, english)).join('\n\n')),
    variants.length > 1 ? hint(say(english, 'Variants 1 and 2 run as an A/B test in the same ad set. Once there is enough data, AIRO suggests pausing the weaker one.', 'Variant 1 aur 2 same ad set mein A/B test ki tarah chalenge. Data aane pe AIRO kamzor wala pause suggest karega.')) : '',
    LINE,
    section(say(english, 'Want changes?', 'Kuch badalna hai?'), [
      variants.length > 2 ? `\`use 3\`  →  ${say(english, 'make variant 3 the main ad', 'variant 3 ko main ad banao')}` : '',
      `\`headline | ad text\`  →  ${say(english, 'write your own copy', 'apni copy likho')}`
    ]),
    imageAsk(english, true)
  ]);
}

function applyCopyLine(payload, text) {
  const swap = String(text).trim().match(/^use\s+(\d)$/i);
  if (swap && payload.variants?.[Number(swap[1]) - 1]) {
    const picked = payload.variants[Number(swap[1]) - 1];
    const others = payload.variants.filter((item) => item !== picked);
    payload.variants = [picked, ...others];
    payload.headline = picked.headline;
    payload.message = picked.primaryText;
    payload.headlineB = others[0]?.headline || '';
    payload.messageB = others[0]?.primaryText || '';
    return true;
  }
  if (!text.includes('|') || publicImageUrl(text) || /^Photo \d{6,40}$/.test(text)) return false;
  const [headline, message] = text.split('|').map((part) => part.trim());
  if (!headline || !message) return false;
  payload.headline = headline.slice(0, 40);
  payload.message = message.slice(0, 300);
  payload.headlineB = '';
  payload.messageB = '';
  payload.variants = [];
  return true;
}

async function readyImage(imageBase64, imageError, text) {
  if (imageBase64) {
    try {
      return { imageBase64: checkedImage(imageBase64) };
    } catch (error) {
      return { error: error.message };
    }
  }
  if (imageError) return { error: imageError };
  const imageUrl = publicImageUrl(text);
  if (!imageUrl) return { imageBase64: '' };
  try {
    return { imageBase64: await downloadImage(imageUrl) };
  } catch (error) {
    return { error: error.message };
  }
}

async function acceptCreative(organizationId, conversationId, payload, text, english, imageBase64 = '', imageError = '') {
  if (!imageBase64 && !imageError && /\bbudget\b/i.test(text) && budgetAmount(text) >= 1) {
    if (budgetAmount(text) < 100 && !/\$|usd|dollar/i.test(text)) {
      return { text: say(english, 'Meta needs about ₹100 a day or more per ad set. Send for example: budget 500', 'Meta ko har ad set ke liye lagbhag ₹100 roz ya zyada chahiye. Aise bhejo: budget 500') };
    }
    payload.dailyBudget = budgetAmount(text);
    await saveDraft(organizationId, conversationId, 'image', payload);
    return {
      text: card([
        header(say(english, 'Budget updated', 'Budget update ho gaya')),
        field(say(english, 'Daily budget', 'Daily budget'), money(payload.dailyBudget, payload.currency)),
        imageAsk(english, true)
      ])
    };
  }
  const copied = applyCopyLine(payload, text);
  const photo = await readyImage(imageBase64, imageError, copied ? '' : text);
  if (copied && !photo.imageBase64) {
    await saveDraft(organizationId, conversationId, 'image', payload);
    return {
      text: card([
        header(say(english, 'Copy updated', 'Copy update ho gayi')),
        `> *${payload.headline}*\n${String(payload.message).split(/\n+/).map((line) => `> ${line}`).join('\n')}`,
        payload.headlineB ? hint(say(english, `A/B test ad: ${payload.headlineB}`, `A/B test ad: ${payload.headlineB}`)) : '',
        photo.error ? hint(photo.error) : '',
        imageAsk(english, true)
      ]),
      images: designImages(payload, english)
    };
  }
  if (!photo.imageBase64 && !photo.error && RAW_PHOTO.test(text)) {
    payload.rawPhoto = true;
    await saveDraft(organizationId, conversationId, 'image', payload);
    return { text: say(english, 'OK. Send the photo now, it will be used as-is with no design.', 'Theek hai. Ab photo bhejo, woh bina design ke as-is lagegi.') };
  }
  if (!photo.imageBase64 && SKIP_IMAGE.test(text)) return saveWithoutImage(organizationId, conversationId, payload, english);
  let designs = [];
  if (photo.imageBase64) {
    designs = payload.rawPhoto ? [] : renderDesigns(payload, photo.imageBase64);
  } else if (!photo.error && USE_DESIGN.test(text) && !NOT_DESIGN.test(text)) {
    designs = renderDesigns(payload);
    if (!designs.length) {
      return { text: say(english, `The design could not be made right now. Send a photo instead.${imageAsk(true)}`, `Design abhi nahi ban paya. Iski jagah photo bhejo.${imageAsk(false)}`) };
    }
  } else {
    const reason = photo.error
      ? `${photo.error} `
      : NOT_DESIGN.test(text)
        ? say(english, 'What should change? Write your own copy as headline | ad text, or send your photo. ', 'Kya badalna hai? Apni copy headline | ad text likho, ya apni photo bhejo. ')
        : '';
    return { text: `${reason}${imageAsk(english, true)}` };
  }
  imageBase64 = designs.length ? designs[0].toString('base64') : photo.imageBase64;
  const imageBase64B = designs[1] ? designs[1].toString('base64') : '';
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  if (copied) await saveDraft(organizationId, conversationId, 'image', payload);
  try {
    const created = await createMetaAd({
      apiKey: account.apiKey,
      accountId: account.accountId,
      name: campaignName(payload),
      objective: payload.objectiveKey,
      dailyBudget: payload.dailyBudget,
      pageId: payload.pageId,
      headline: payload.headline,
      message: payload.message,
      link: adLink(payload),
      imageBase64,
      imageBase64B: payload.headlineB && imageBase64B ? imageBase64B : undefined,
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
      cta: payload.cta,
      creativeTest: Boolean(payload.headlineB),
      headlineB: payload.headlineB || undefined,
      messageB: payload.messageB || undefined
    });
    payload.campaignId = created.campaignId;
    delete payload.rawPhoto;
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
      text: card([
        header(say(english, 'Campaign saved (paused)', 'Campaign save ho gaya (paused)'), say(english, 'Not live yet · no money spent', 'Abhi live nahi · koi paisa kharch nahi')),
        section('Meta', [
          field('Campaign id', created.campaignId),
          field(say(english, 'Daily budget', 'Daily budget'), money(payload.dailyBudget, payload.currency)),
          field(say(english, 'Locations', 'Locations'), payload.region),
          field('Ads', payload.headlineB ? say(english, '2 (A/B test)', '2 (A/B test)') : '1'),
          field('Creative', designs.length
            ? say(english, `AIRO design${photo.imageBase64 ? ' on your photo' : ''}${imageBase64B ? ', one per variant' : ''}`, `AIRO design${photo.imageBase64 ? ' aapki photo pe' : ''}${imageBase64B ? ', har variant ka alag' : ''}`)
            : say(english, 'your photo as-is', 'aapki photo as-is'))
        ]),
        /\b(publish|live|chalao|chala do)\b/i.test(text) ? hint(say(english, 'You asked to publish. Publishing starts spending money, so reply haan once more to confirm.', 'Aapne publish bola. Publish se paisa kharch hona shuru hoga, isliye confirm ke liye ek baar haan likho.')) : '',
        publishOptions(english)
      ]),
      images: photo.imageBase64 && designs.length ? designImages(payload, english, designs) : []
    };
  } catch (error) {
    const reason = String(error.message || 'Meta did not save the ad.').replace(/access_token=[^&\s]+/gi, '').slice(0, 200);
    return { text: say(english, `Meta did not save the ad. ${reason}${budgetHint(reason, true)} Reply design or send the photo again, or say cancel.`, `Meta ne ad save nahi kiya. ${reason}${budgetHint(reason, false)} design likho ya photo dubara bhejo, ya cancel likho.`) };
  }
}

async function rememberAdSet(organizationId, account, campaignId, adsetId, payload) {
  await upsertObject({
    organizationId,
    connectionId: account.connectionId,
    objectType: 'adset',
    externalId: String(adsetId),
    name: `${campaignName(payload)} ad set`.slice(0, 180),
    parentExternalId: String(campaignId),
    payload: { origin: 'api', status: 'PAUSED', campaignId: String(campaignId) }
  });
}

function shellInput(account, payload, campaignId) {
  return {
    apiKey: account.apiKey,
    accountId: account.accountId,
    campaignId,
    name: campaignName(payload),
    objective: payload.objectiveKey,
    pageId: payload.pageId,
    conversion: payload.conversion,
    ageMin: payload.ageMin,
    ageMax: payload.ageMax,
    gender: payload.gender || '',
    interests: payload.interests || [],
    locations: payload.locations || [],
    advantageAudience: true
  };
}

async function attachAdSet(organizationId, conversationId, draft, english, imageBase64 = '', imageError = '') {
  const payload = { ...draft.payload };
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  try {
    const adset = await createMetaAdSet(shellInput(account, payload, draft.campaignId));
    payload.adsetId = adset.adsetId;
    payload.campaignId = draft.campaignId;
    await saveDraft(organizationId, conversationId, 'ad', payload, draft.campaignId);
    await rememberAdSet(organizationId, account, draft.campaignId, adset.adsetId, payload);
    if (imageBase64 || imageError) {
      const placed = await finishAd(organizationId, conversationId, payload, '', english, imageBase64, imageError);
      if (payload.adId) return placed;
      return {
        text: say(
          english,
          `Ad set ${adset.adsetId} is saved under campaign ${draft.campaignId}. ${placed.text}`,
          `Ad set ${adset.adsetId} campaign ${draft.campaignId} ke neeche save ho gaya. ${placed.text}`
        )
      };
    }
    return {
      text: card([
        header(say(english, 'Ad set saved (paused)', 'Ad set save ho gaya (paused)'), `Campaign ${draft.campaignId} · ad set ${adset.adsetId}`),
        imageAsk(english)
      ])
    };
  } catch (error) {
    const reason = String(error.message || 'Meta did not save the ad set.').replace(/access_token=[^&\s]+/gi, '').slice(0, 200);
    return { text: say(english, `Meta did not save the ad set. ${reason}`, `Meta ne ad set save nahi kiya. ${reason}`) };
  }
}

async function saveWithoutImage(organizationId, conversationId, payload, english) {
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  try {
    const created = await createMetaCampaign({
      apiKey: account.apiKey,
      accountId: account.accountId,
      name: campaignName(payload),
      objective: payload.objectiveKey,
      conversion: payload.conversion,
      dailyBudget: payload.dailyBudget,
      status: 'PAUSED',
      specialCategory: payload.specialCategory || ''
    });
    const adset = await createMetaAdSet(shellInput(account, payload, created.id));
    payload.campaignId = created.id;
    payload.adsetId = adset.adsetId;
    payload.skippedImage = true;
    await saveDraft(organizationId, conversationId, 'done', payload, created.id);
    await rememberCampaign(organizationId, account, { campaignId: created.id }, payload);
    await rememberAdSet(organizationId, account, created.id, adset.adsetId, payload);
    await recordAudit({ auth: null, ip: null }, {
      action: 'connection.meta_ad_created',
      resource: 'connection',
      resourceId: account.connectionId,
      organizationId,
      metadata: { channel: 'whatsapp', publish: false }
    });
    return {
      text: card([
        header(say(english, 'Saved without photo (paused)', 'Bina photo save hua (paused)'), say(english, 'Nothing is live', 'Kuch live nahi hai')),
        section('Meta', [field('Campaign id', created.id), field('Ad set id', adset.adsetId)]),
        hint(say(english, 'Send the photo in this chat later, or add it from AIRO → Connections → Meta Ads.', 'Photo baad mein isi chat mein bhejo, ya AIRO → Connections → Meta Ads se lagao.'))
      ])
    };
  } catch (error) {
    const reason = String(error.message || 'Meta did not save the campaign.').replace(/access_token=[^&\s]+/gi, '').slice(0, 200);
    return { text: `${say(english, `Meta did not save the campaign. ${reason}`, `Meta ne campaign save nahi kiya. ${reason}`)}${budgetHint(reason, english)}` };
  }
}

async function finishAd(organizationId, conversationId, payload, text, english, imageBase64 = '', imageError = '') {
  const photo = await readyImage(imageBase64, imageError, text);
  if (!photo.imageBase64 && SKIP_IMAGE.test(text)) {
    await saveDraft(organizationId, conversationId, 'done', payload, payload.campaignId);
    return {
      text: card([
        header(say(english, 'Kept paused', 'Paused rakha'), `Campaign ${payload.campaignId}`),
        hint(say(english, 'Send the photo in this chat later, or add it from AIRO → Connections → Meta Ads.', 'Photo baad mein isi chat mein bhejo, ya AIRO → Connections → Meta Ads se lagao.'))
      ])
    };
  }
  if (!photo.imageBase64) {
    const reason = photo.error ? `${photo.error} ` : '';
    return { text: say(english, `${reason}${imageAsk(true)}`, `${reason}${imageAsk(false)}`) };
  }
  imageBase64 = photo.imageBase64;
  const account = await metaAccount(organizationId);
  if (!account) return { text: connectLine(english) };
  try {
    const created = await addMetaImageAd({
      apiKey: account.apiKey,
      accountId: account.accountId,
      adsetId: payload.adsetId,
      name: campaignName(payload),
      objective: payload.objectiveKey,
      pageId: payload.pageId,
      headline: payload.headline,
      message: payload.message,
      link: adLink(payload),
      imageBase64,
      conversion: payload.conversion,
      cta: payload.cta
    });
    payload.adId = created.adId;
    await saveDraft(organizationId, conversationId, 'approval', payload, payload.campaignId);
    await upsertObject({
      organizationId,
      connectionId: account.connectionId,
      objectType: 'ad',
      externalId: String(created.adId),
      name: `${campaignName(payload)} ad`.slice(0, 180),
      parentExternalId: String(payload.adsetId),
      payload: { origin: 'api', status: 'PAUSED', campaignId: String(payload.campaignId) }
    });
    return {
      text: card([
        header(say(english, 'Ad saved (paused)', 'Ad save ho gayi (paused)'), `Ad ${created.adId}`),
        publishOptions(english)
      ])
    };
  } catch (error) {
    const reason = String(error.message || 'Meta did not save the ad.').replace(/access_token=[^&\s]+/gi, '').slice(0, 200);
    return { text: say(english, `Meta did not save the ad. ${reason}`, `Meta ne ad save nahi kiya. ${reason}`) };
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
    name: campaignName(payload),
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
    text: card([
      header(say(english, 'Campaign is live', 'Campaign live ho gaya'), `Campaign ${draft.campaignId}`),
      bullets([
        say(english, 'Meta reviews new ads first, usually within a few hours.', 'Meta pehle naye ads review karta hai, aam taur pe kuch ghanton mein.'),
        say(english, 'AIRO will watch results and suggest changes.', 'AIRO results dekhega aur changes suggest karega.')
      ])
    ])
  };
}
