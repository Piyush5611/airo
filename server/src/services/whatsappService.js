import crypto from 'crypto';
import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';
import { decryptJson, encryptJson } from '../utils/cryptoBox.js';
import { recordAudit } from './auditService.js';
import { leadScope } from '../utils/scope.js';
import * as growthRepo from '../repositories/growthRepo.js';
import * as repo from '../repositories/whatsappRepo.js';
import { notifyWhatsappMessage, streamWhatsapp } from './whatsappLive.js';
import { replyWhatsapp } from './llmService.js';
import { handleMetaAdChat } from './metaAdChat.js';
import { handleGoogleAdChat } from './googleAdChat.js';
import { competitorReply, wantsCompetitorInfo } from './adsAgent/competitorResearch.js';
import { campaignCountReply, wantsCampaignCount } from './adsAgent/campaignCount.js';
import { classifyMessage, withLatest } from './whatsappIntent.js';

function publicBot(row) {
  if (!row) return null;
  let preview = null;
  if (row.credentialCiphertext) {
    try {
      const secret = decryptJson(row.credentialCiphertext);
      const token = String(secret.accessToken || '');
      preview = token ? `••••${token.slice(-4)}` : null;
    } catch {
      preview = null;
    }
  }
  return {
    id: row.id,
    displayName: row.displayName,
    providerName: row.providerName,
    phoneLabel: row.phoneLabel,
    apiVersion: row.apiVersion,
    phoneNumberId: row.phoneNumberId,
    status: row.status === 'connected' && row.credentialCiphertext ? 'connected' : 'pending',
    mode: row.mode,
    webhookPath: row.webhookPath,
    note: row.note,
    connected: row.status === 'connected' && Boolean(row.credentialCiphertext),
    tokenPreview: preview,
    connectedAt: row.connectedAt,
    updatedAt: row.updatedAt
  };
}

export async function overview() {
  const [bot, businesses, conversations] = await Promise.all([
    repo.bot(),
    repo.businesses(),
    repo.conversations()
  ]);
  if (!bot) throw new ApiError(404, 'WhatsApp chatbot is not configured.', 'not_found');
  return {
    bot: publicBot(bot),
    businesses,
    conversations,
    capabilities: repo.CAPABILITIES,
    summary: {
      businesses: businesses.length,
      enabled: businesses.filter((row) => Number(row.enabled) === 1).length,
      openConversations: conversations.filter((row) => row.status !== 'closed').length
    }
  };
}

function sameSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function savedSecret() {
  const row = await repo.bot();
  if (!row?.credentialCiphertext || row.status !== 'connected') return null;
  try {
    return decryptJson(row.credentialCiphertext);
  } catch {
    return null;
  }
}

async function lookupPhone({ apiVersion, phoneNumberId, accessToken }) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}?fields=id,display_phone_number,verified_name`;
  let response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError(502, 'WhatsApp did not respond. Check the network and try again.', 'whatsapp_unreachable');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || 'WhatsApp rejected these credentials.';
    throw new ApiError(422, message, 'whatsapp_rejected');
  }
  if (!payload?.id) throw new ApiError(422, 'WhatsApp did not return this phone number.', 'whatsapp_rejected');
  return payload;
}

export async function connectBot(req) {
  const current = await repo.bot();
  if (!current) throw new ApiError(404, 'WhatsApp chatbot is not configured.', 'not_found');
  const accessToken = req.body.accessToken.trim();
  const verifyToken = req.body.verifyToken.trim();
  const apiVersion = req.body.apiVersion.trim();
  const phoneNumberId = req.body.phoneNumberId.trim();
  const phone = await lookupPhone({ apiVersion, phoneNumberId, accessToken });
  await repo.connectBot({
    phoneLabel: phone.display_phone_number || phoneNumberId,
    providerName: phone.verified_name || 'WhatsApp',
    apiVersion,
    phoneNumberId,
    ciphertext: encryptJson({ accessToken, verifyToken })
  });
  await recordAudit(req, {
    action: 'whatsapp_bot.connected',
    resource: 'whatsapp_bot',
    resourceId: 1,
    organizationId: null,
    metadata: { apiVersion, phoneNumberId, verifiedName: phone.verified_name || null }
  });
  return overview();
}

export async function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || !token || !challenge) return null;
  const secret = await savedSecret();
  const saved = secret?.verifyToken && sameSecret(secret.verifyToken, token);
  const fromEnv = env.whatsappVerifyToken && sameSecret(env.whatsappVerifyToken, token);
  if (!saved && !fromEnv) return null;
  return String(challenge);
}

export async function receiveWebhook(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const messages = Array.isArray(value.messages) ? value.messages : [];
      const contact = value.contacts?.[0];
      for (const message of messages) {
        const phone = String(message.from || '');
        const image = inboundMedia(message);
        const tapped = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || message.button?.text || '';
        const text = message.text?.body || tapped || image?.caption || (image ? `Photo ${image.mediaId}` : message.type || '');
        if (!phone || !text) continue;
        const saved = await storeInbound({
          phone,
          name: contact?.profile?.name || phone,
          body: String(text).slice(0, 2000),
          reply: Boolean(message.text?.body || tapped || image),
          mediaId: image?.mediaId || ''
        });
        if (saved?.reply) {
          const forwarded = Boolean(message.context?.forwarded || message.context?.frequently_forwarded);
          const tapId = String(message.interactive?.list_reply?.id || message.interactive?.button_reply?.id || '');
          answerWithModel({ ...saved, forwarded, tapId }).catch(async (error) => {
            const reason = String(error?.message || 'The model did not reply.').slice(0, 180);
            console.error('WhatsApp model reply skipped:', reason);
            try {
              await repo.insertMessage({
                conversationId: saved.conversationId,
                direction: 'outbound',
                body: 'Reply was not sent.',
                actionTaken: `Not sent · ${reason}`
              });
              notifyWhatsappMessage(saved.conversationId);
            } catch {
              // The inbound message is already saved.
            }
          });
        }
      }
    }
  }
}

function inboundMedia(message) {
  const image = message?.type === 'image' ? message.image : null;
  const sticker = message?.type === 'sticker' ? message.sticker : null;
  const document = message?.type === 'document' ? message.document : null;
  const file = image || sticker || (document && /^image\/(jpeg|png|webp)$/i.test(String(document.mime_type || '')) ? document : null);
  const mediaId = String(file?.id || '');
  if (!/^\d{6,40}$/.test(mediaId)) return null;
  return { mediaId, caption: String(file.caption || '').trim().slice(0, 1000) };
}

function metaMediaUrl(value, base) {
  let parsed;
  try { parsed = base ? new URL(value, base) : new URL(value); } catch { return ''; }
  if (parsed.protocol !== 'https:') return '';
  const host = parsed.hostname.toLowerCase();
  if (!/(^|\.)(fbsbx\.com|fbcdn\.net|whatsapp\.net)$/.test(host)) return '';
  return parsed.toString();
}

async function readLimited(response, max) {
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > max) throw new ApiError(422, 'Send a JPG or PNG photo under 2 MB.', 'validation_error');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new ApiError(422, 'Send a JPG or PNG photo under 2 MB.', 'validation_error');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

async function downloadWhatsappImage(mediaId) {
  if (!/^\d{6,40}$/.test(String(mediaId || ''))) {
    throw new ApiError(422, 'WhatsApp did not send a usable photo.', 'validation_error');
  }
  const bot = await repo.bot();
  const secret = await savedSecret();
  const version = String(bot?.apiVersion || '');
  if (!secret?.accessToken || !/^v\d+\.\d+$/.test(version)) {
    throw new ApiError(422, 'Connect the WhatsApp chatbot before using a chat photo.', 'validation_error');
  }
  let meta;
  try {
    meta = await fetch(`https://graph.facebook.com/${version}/${mediaId}`, {
      headers: { Authorization: `Bearer ${secret.accessToken}` },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError(422, 'WhatsApp did not send the photo.', 'validation_error');
  }
  const info = await meta.json().catch(() => ({}));
  const fileUrl = meta.ok ? metaMediaUrl(info.url) : '';
  if (!fileUrl) {
    const reason = String(info?.error?.message || '')
      .replace(/access_token=[^&\s]+/gi, '')
      .replace(/EAA[A-Za-z0-9]+/g, '')
      .trim()
      .slice(0, 140);
    throw new ApiError(422, reason ? `WhatsApp did not send the photo. ${reason}` : 'WhatsApp did not send the photo.', 'validation_error');
  }
  let current = fileUrl;
  for (let hop = 0; hop < 2; hop += 1) {
    let response;
    try {
      response = await fetch(current, {
        headers: { Authorization: `Bearer ${secret.accessToken}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(20000)
      });
    } catch {
      throw new ApiError(422, 'WhatsApp did not send the photo.', 'validation_error');
    }
    if (response.status >= 300 && response.status < 400) {
      const next = metaMediaUrl(response.headers.get('location'), current);
      if (!next) throw new ApiError(422, 'WhatsApp did not send the photo.', 'validation_error');
      current = next;
      continue;
    }
    if (!response.ok) throw new ApiError(422, 'WhatsApp did not send the photo.', 'validation_error');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > 2500000) throw new ApiError(422, 'Send a JPG or PNG photo under 2 MB.', 'validation_error');
    const bytes = await readLimited(response, 2500000);
    if (bytes.length < 100) throw new ApiError(422, 'WhatsApp did not send the photo.', 'validation_error');
    return bytes.toString('base64');
  }
  throw new ApiError(422, 'WhatsApp did not send the photo.', 'validation_error');
}

async function storeInbound({ phone, name, body, reply, mediaId }) {
  const key = phoneKey(phone);
  let owner = null;
  if (key) {
    try {
      owner = await repo.findNumberByKey(key);
    } catch (error) {
      if (!missingNumbersTable(error)) throw error;
    }
  }
  const existing = key ? await repo.findConversationByKey(key) : await repo.findConversationByPhone(phone);
  let conversationId = existing?.id;
  let organizationId = owner?.organizationId || existing?.organizationId;
  if (!conversationId) {
    const fallback = owner ? null : await repo.firstEnabledBusiness();
    organizationId = owner?.organizationId || fallback?.organizationId;
    if (!organizationId) return null;
    conversationId = await repo.insertConversation({
      organizationId,
      contactName: name,
      contactPhone: phone,
      topic: owner ? 'business' : 'inbox'
    });
  } else {
    if (owner && Number(existing.organizationId) !== Number(owner.organizationId)) {
      await repo.assignConversationOrganization(conversationId, owner.organizationId);
      organizationId = owner.organizationId;
    }
    const duplicate = reply ? await repo.recentSameInbound(conversationId, body) : null;
    if (duplicate) {
      const sent = await repo.replyAfter(conversationId, duplicate.id);
      if (sent) return null;
      return {
        conversationId,
        organizationId,
        recognized: Boolean(owner),
        businessLabel: owner?.label || '',
        mediaId: mediaId || '',
        reply: true
      };
    }
    await repo.touchConversation(conversationId);
  }
  await repo.insertMessage({
    conversationId,
    direction: 'inbound',
    body,
    actionTaken: owner ? `Business number · ${owner.label || owner.phone}` : 'Received from WhatsApp'
  });
  notifyWhatsappMessage(conversationId);
  return {
    conversationId,
    organizationId,
    recognized: Boolean(owner),
    businessLabel: owner?.label || '',
    mediaId: mediaId || '',
    reply: Boolean(reply)
  };
}

async function answerWithModel(saved) {
  const history = await repo.messages(saved.conversationId);
  const messages = history
    .filter((row) => !String(row.actionTaken || '').startsWith('Not sent'))
    .slice(-12)
    .map((row) => ({
      role: row.direction === 'outbound' ? 'assistant' : 'user',
      content: row.body
    }));
  while (messages[0]?.role === 'assistant') messages.shift();
  let imageBase64 = '';
  let imageError = '';
  if (saved.mediaId) {
    try {
      imageBase64 = await downloadWhatsappImage(saved.mediaId);
    } catch (error) {
      imageError = String(error?.message || 'WhatsApp did not send the photo.')
        .replace(/access_token=[^&\s]+/gi, '')
        .replace(/EAA[A-Za-z0-9]+/g, '')
        .slice(0, 180);
    }
  }
  const lastText = String([...messages].reverse().find((row) => row.role === 'user')?.content || '');
  if (/^(city|radius|offer)_/.test(String(saved.tapId || '')) && saved.recognized && saved.organizationId) {
    if (await sendAdChat(saved, messages, { force: true })) return;
  }
  const route = saved.recognized && saved.organizationId && lastText && !imageBase64 && !imageError
    ? await classifyMessage({ organizationId: saved.organizationId, conversationId: saved.conversationId, messages })
    : null;
  if (route && await routeByIntent(saved, messages, route, lastText)) return;
  if (!route && saved.recognized && saved.organizationId && wantsCompetitorInfo(lastText)) {
    const report = await competitorReply({ organizationId: saved.organizationId, conversationId: saved.conversationId, text: lastText }).catch(() => '');
    if (report) {
      await deliverWhatsapp({ conversationId: saved.conversationId, text: report, actionTaken: 'Competitor research' });
      return;
    }
  }
  if (!route && saved.recognized && saved.organizationId && wantsCampaignCount(lastText)) {
    const list = await campaignCountReply({ organizationId: saved.organizationId, text: lastText }).catch(() => '');
    if (list) {
      await deliverWhatsapp({ conversationId: saved.conversationId, text: list, actionTaken: 'Campaign list' });
      return;
    }
  }
  const google = await handleGoogleAdChat({
    organizationId: saved.organizationId,
    conversationId: saved.conversationId,
    recognized: saved.recognized,
    messages
  });
  if (google?.text) {
    await deliverAdChat(saved.conversationId, google, 'Google ad');
    return;
  }
  const meta = await handleMetaAdChat({
    organizationId: saved.organizationId,
    conversationId: saved.conversationId,
    recognized: saved.recognized,
    messages,
    imageBase64,
    imageError,
    forwarded: Boolean(saved.forwarded)
  });
  if (meta?.text) {
    await deliverAdChat(saved.conversationId, meta, 'Meta ad');
    return;
  }
  await sendAnswer(saved, messages, '');
}

async function deliverAdChat(conversationId, reply, actionTaken) {
  for (const image of reply.images || []) {
    try {
      await deliverWhatsappImage({ conversationId, png: image.png, caption: image.caption, actionTaken: `${actionTaken} design`, tag: 'Ad design' });
    } catch (error) {
      console.error('WhatsApp ad design skipped:', String(error?.message || 'failed').slice(0, 180));
      break;
    }
  }
  for (const part of messageParts(String(reply.text))) {
    await deliverWhatsapp({ conversationId, text: part, actionTaken });
  }
  if (reply.menu?.rows?.length) {
    try {
      await deliverWhatsappMenu({ conversationId, menu: reply.menu, actionTaken: `${actionTaken} options` });
    } catch (error) {
      console.error('WhatsApp ad options skipped:', String(error?.message || 'failed').slice(0, 180));
    }
  }
}

export function menuMessage(menu) {
  return {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: String(menu.body || 'Choose an option').slice(0, 1024) },
      action: {
        button: String(menu.button || 'Choose').slice(0, 20),
        sections: [{
          title: String(menu.title || 'Options').slice(0, 24),
          rows: menu.rows.slice(0, 10).map((row) => ({
            id: String(row.id).slice(0, 200),
            title: String(row.title).slice(0, 24),
            ...(row.description ? { description: String(row.description).slice(0, 72) } : {})
          }))
        }]
      }
    }
  };
}

async function deliverWhatsappMenu({ conversationId, menu, actionTaken }) {
  const target = await whatsappTarget(conversationId);
  await postWhatsapp(target, menuMessage(menu));
  await saveOutbound(conversationId, `${menu.body}\n\n[${menu.rows.map((row) => row.title).join(' | ')}]`, actionTaken);
}

export function messageParts(text, limit = 3800) {
  const parts = [];
  let current = '';
  for (const block of text.split('\n\n')) {
    const piece = block.length > limit ? block.slice(0, limit) : block;
    if (current && current.length + piece.length + 2 > limit) {
      parts.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts.slice(0, 4);
}

async function sendAdChat(saved, messages, { force = false, only = '' } = {}) {
  const google = only === 'meta' ? null : await handleGoogleAdChat({
    organizationId: saved.organizationId,
    conversationId: saved.conversationId,
    recognized: saved.recognized,
    messages,
    force
  });
  if (google?.text) {
    await deliverAdChat(saved.conversationId, google, 'Google ad');
    return true;
  }
  const meta = only === 'google' ? null : await handleMetaAdChat({
    organizationId: saved.organizationId,
    conversationId: saved.conversationId,
    recognized: saved.recognized,
    messages,
    force
  });
  if (meta?.text) {
    await deliverAdChat(saved.conversationId, meta, 'Meta ad');
    return true;
  }
  return false;
}

async function routeByIntent(saved, messages, route, lastText) {
  const { intent } = route;
  const orgId = saved.organizationId;
  if (intent === 'ad_setup_answer') return sendAdChat(saved, messages, { force: true });
  if (intent === 'start_google_ad') return sendAdChat(saved, withLatest(messages, `run google ads ${lastText}`), { only: 'google' });
  if (intent === 'start_meta_ad') return sendAdChat(saved, withLatest(messages, `run meta ads ${lastText}`), { only: 'meta' });
  if (intent === 'cancel_ad_setup') {
    if (await sendAdChat(saved, withLatest(messages, 'cancel'), { force: true })) return true;
    await sendAnswer(saved, messages, 'other');
    return true;
  }
  if (intent === 'competitors') {
    const report = await competitorReply({ organizationId: orgId, conversationId: saved.conversationId, text: lastText, topic: route.topic }).catch(() => '');
    if (!report) return false;
    await deliverWhatsapp({ conversationId: saved.conversationId, text: report, actionTaken: 'Competitor research' });
    return true;
  }
  if (intent === 'campaign_list') {
    const platformWord = route.platform === 'google' ? ' google' : route.platform === 'meta' ? ' meta' : '';
    const list = await campaignCountReply({ organizationId: orgId, text: `${lastText}${platformWord}` }).catch(() => '');
    if (!list) return false;
    await deliverWhatsapp({ conversationId: saved.conversationId, text: list, actionTaken: 'Campaign list' });
    return true;
  }
  if (intent === 'greeting') {
    if (await sendAdChat(saved, messages)) return true;
    await sendAnswer(saved, messages, 'greeting');
    return true;
  }
  const reportIntent = ['ads_report', 'call_report', 'crm_report'].includes(intent);
  const asked = reportIntent && route.request ? withLatest(messages, `${route.request} | ${lastText}`) : messages;
  await sendAnswer(saved, asked, intent);
  return true;
}

async function sendAnswer(saved, messages, intent) {
  const answer = await replyWhatsapp({
    organizationId: saved.organizationId,
    recognized: saved.recognized,
    businessLabel: saved.businessLabel,
    messages,
    intent
  });
  if (!answer?.text) return;
  if (answer.image?.png) {
    try {
      await deliverWhatsappImage({
        conversationId: saved.conversationId,
        png: answer.image.png,
        caption: answer.image.caption,
        buttons: answer.image.buttons,
        actionTaken: `Report image · ${answer.image.title || answer.model}`
      });
      return;
    } catch (error) {
      console.error('WhatsApp report image skipped:', String(error?.message || 'failed').slice(0, 180));
    }
  }
  await deliverWhatsapp({
    conversationId: saved.conversationId,
    text: answer.text,
    actionTaken: `Model · ${answer.model}`
  });
}

export function streamLive(req, res) {
  streamWhatsapp(req, res);
}

export function streamClientLive(req, res) {
  streamWhatsapp(req, res, { includeId: false });
}

function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : '';
}

function missingNumbersTable(error) {
  return error?.cause?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_NO_SUCH_TABLE';
}

const NUMBERS_SETUP = 'WhatsApp numbers are not ready on this server yet. Run npm run migrate once, then open this page again.';

async function businessNumbers(organizationId) {
  try {
    return await repo.numbersForOrg(organizationId);
  } catch (error) {
    if (missingNumbersTable(error)) return null;
    throw error;
  }
}

async function customerPhones(auth) {
  const scope = leadScope(auth);
  const [leads, numbers] = await Promise.all([
    repo.leadPhones(auth.organizationId, scope.sql, scope.params),
    businessNumbers(auth.organizationId)
  ]);
  const byKey = new Map();
  for (const lead of leads) {
    const key = phoneKey(lead.phone);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, { leadId: lead.id, leadName: lead.fullName });
  }
  if (!numbers) return { byKey, ready: false };
  for (const number of numbers) {
    const key = phoneKey(number.phone);
    if (!key) continue;
    const current = byKey.get(key) || {};
    byKey.set(key, {
      ...current,
      businessNumber: true,
      numberId: number.id,
      numberLabel: number.label || null,
      leadName: current.leadName || number.label || null
    });
  }
  return { byKey, ready: true };
}

function customerConversation(row, byKey) {
  const match = byKey.get(phoneKey(row.contactPhone)) || {};
  return {
    id: row.id,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    topic: row.topic,
    status: row.status,
    lastMessageAt: row.lastMessageAt,
    lastMessage: row.lastMessage,
    lastDirection: row.lastDirection,
    leadId: match.leadId || null,
    leadName: match.leadName || null,
    businessNumber: Boolean(match.businessNumber),
    numberLabel: match.numberLabel || null
  };
}

function publicNumber(row) {
  return { id: row.id, phone: row.phone, label: row.label || '', createdAt: row.createdAt };
}

export async function clientInbox(auth) {
  const loaded = await customerPhones(auth);
  const rows = await repo.conversationsByPhoneKeys([...loaded.byKey.keys()]);
  const numbers = loaded.ready ? await repo.numbersForOrg(auth.organizationId) : [];
  return {
    numbers: numbers.map(publicNumber),
    conversations: rows.map((row) => customerConversation(row, loaded.byKey)),
    notice: loaded.ready ? '' : NUMBERS_SETUP
  };
}

export async function addBusinessNumber(req) {
  const digits = String(req.body.phone || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new ApiError(422, 'Enter a 10-digit mobile number, or include the country code.', 'validation_error');
  }
  const key = phoneKey(digits);
  const label = String(req.body.label || '').trim().slice(0, 80) || null;
  const organizationId = req.auth.organizationId;
  const [count, existing] = await Promise.all([
    repo.countNumbers(organizationId),
    repo.findNumberByKey(key)
  ]);
  if (Number(count?.total || 0) >= 20) {
    throw new ApiError(422, 'This workspace already has 20 WhatsApp numbers.', 'validation_error');
  }
  if (existing) {
    throw new ApiError(422, Number(existing.organizationId) === Number(organizationId)
      ? 'This number is already added.'
      : 'This number is already linked to a business.', 'validation_error');
  }
  let id;
  try {
    id = await repo.insertNumber({ organizationId, phone: digits, phoneKey: key, label });
  } catch (error) {
    if (error?.cause?.code === 'ER_DUP_ENTRY') {
      throw new ApiError(422, 'This number is already linked to a business.', 'validation_error');
    }
    if (missingNumbersTable(error)) {
      throw new ApiError(422, NUMBERS_SETUP, 'schema_missing');
    }
    throw error;
  }
  const open = await repo.findConversationByKey(key);
  if (open && Number(open.organizationId) !== Number(organizationId)) {
    await repo.assignConversationOrganization(open.id, organizationId);
  }
  await recordAudit(req, {
    action: 'whatsapp_number.added',
    resource: 'whatsapp_business_number',
    resourceId: id,
    organizationId,
    metadata: { phoneKey: key, label }
  });
  return clientInbox(req.auth);
}

export async function updateBusinessNumber(req, id) {
  const current = await repo.findNumber(id, req.auth.organizationId);
  if (!current) throw new ApiError(404, 'That number is not on this workspace.', 'not_found');
  const digits = String(req.body.phone || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) {
    throw new ApiError(422, 'Enter a 10-digit mobile number, or include the country code.', 'validation_error');
  }
  const key = phoneKey(digits);
  const label = String(req.body.label || '').trim().slice(0, 80) || null;
  const existing = await repo.findNumberByKey(key);
  if (existing && Number(existing.id) !== Number(id)) {
    throw new ApiError(422, Number(existing.organizationId) === Number(req.auth.organizationId)
      ? 'This number is already added.'
      : 'This number is already linked to a business.', 'validation_error');
  }
  try {
    await repo.updateNumber({ id, organizationId: req.auth.organizationId, phone: digits, phoneKey: key, label });
  } catch (error) {
    if (error?.cause?.code === 'ER_DUP_ENTRY') {
      throw new ApiError(422, 'This number is already linked to a business.', 'validation_error');
    }
    if (missingNumbersTable(error)) throw new ApiError(422, NUMBERS_SETUP, 'schema_missing');
    throw error;
  }
  const open = await repo.findConversationByKey(key);
  if (open && Number(open.organizationId) !== Number(req.auth.organizationId)) {
    await repo.assignConversationOrganization(open.id, req.auth.organizationId);
  }
  await recordAudit(req, {
    action: 'whatsapp_number.updated',
    resource: 'whatsapp_business_number',
    resourceId: id,
    organizationId: req.auth.organizationId,
    metadata: { phoneKey: key, label }
  });
  return clientInbox(req.auth);
}

export async function removeBusinessNumber(req, id) {
  const row = await repo.findNumber(id, req.auth.organizationId);
  if (!row) throw new ApiError(404, 'That number is not on this workspace.', 'not_found');
  await repo.deleteNumber(id, req.auth.organizationId);
  await recordAudit(req, {
    action: 'whatsapp_number.removed',
    resource: 'whatsapp_business_number',
    resourceId: id,
    organizationId: req.auth.organizationId,
    metadata: { phoneKey: phoneKey(row.phone) }
  });
  return clientInbox(req.auth);
}

export async function clientConversation(auth, id) {
  const loaded = await customerPhones(auth);
  const row = await repo.conversation(id);
  if (!row || !loaded.byKey.has(phoneKey(row.contactPhone))) {
    throw new ApiError(404, 'Conversation not found.', 'not_found');
  }
  return {
    conversation: customerConversation(row, loaded.byKey),
    messages: await repo.messages(id)
  };
}

export async function clientLeadChats(auth, leadId) {
  const scope = leadScope(auth);
  const lead = await growthRepo.getLead(auth.organizationId, leadId, scope.sql, scope.params);
  if (!lead) throw new ApiError(404, 'Lead not found.', 'not_found');
  const key = phoneKey(lead.phone);
  const rows = key ? await repo.conversationsByPhoneKeys([key]) : [];
  const threads = [];
  for (const row of rows) {
    threads.push({
      conversation: customerConversation(row, new Map([[key, { leadId: lead.id, leadName: lead.fullName }]])),
      messages: await repo.messages(row.id)
    });
  }
  return { phone: lead.phone, threads };
}

async function whatsappTarget(conversationId) {
  const row = await repo.conversation(conversationId);
  if (!row) throw new ApiError(404, 'Conversation not found.', 'not_found');
  const bot = await repo.bot();
  const secret = await savedSecret();
  const version = String(bot?.apiVersion || '');
  const phoneNumberId = String(bot?.phoneNumberId || '');
  if (!secret?.accessToken || !/^v\d+\.\d+$/.test(version) || !/^\d{6,32}$/.test(phoneNumberId)) {
    throw new ApiError(422, 'Connect the WhatsApp chatbot before sending.', 'validation_error');
  }
  const windowOpen = await repo.recentInbound(conversationId);
  if (!windowOpen) {
    throw new ApiError(422, 'WhatsApp accepts a reply only within 24 hours of this person\'s last message.', 'validation_error');
  }
  const to = String(row.contactPhone || '').replace(/\D/g, '');
  if (to.length < 8 || to.length > 15) throw new ApiError(422, 'This chat has no WhatsApp number.', 'validation_error');
  return { row, to, token: secret.accessToken, base: `https://graph.facebook.com/${version}/${phoneNumberId}` };
}

function whatsappError(payload, fallback) {
  return String(payload?.error?.message || fallback)
    .replace(/access_token=[^&\s]+/gi, '')
    .replace(/EAA[A-Za-z0-9]+/g, '')
    .slice(0, 240);
}

async function postWhatsapp(target, message) {
  let response;
  try {
    response = await fetch(`${target.base}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: target.to, ...message }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError(502, 'WhatsApp did not respond. Check the network and try again.', 'whatsapp_unreachable');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.messages?.[0]?.id) {
    throw new ApiError(422, whatsappError(payload, 'WhatsApp did not accept this message.'), 'whatsapp_rejected');
  }
}

async function uploadWhatsappImage(target, png) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([png], { type: 'image/png' }), 'report.png');
  let response;
  try {
    response = await fetch(`${target.base}/media`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${target.token}` },
      body: form,
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new ApiError(502, 'WhatsApp did not respond to the image upload.', 'whatsapp_unreachable');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new ApiError(422, whatsappError(payload, 'WhatsApp did not accept the image.'), 'whatsapp_rejected');
  }
  return payload.id;
}

async function saveOutbound(conversationId, body, actionTaken) {
  await repo.insertMessage({ conversationId, direction: 'outbound', body, actionTaken });
  await repo.touchConversation(conversationId);
  notifyWhatsappMessage(conversationId);
}

async function deliverWhatsapp({ conversationId, text, actionTaken }) {
  const target = await whatsappTarget(conversationId);
  await postWhatsapp(target, { type: 'text', text: { preview_url: false, body: text } });
  await saveOutbound(conversationId, text, actionTaken);
  return target.row;
}

async function deliverWhatsappImage({ conversationId, png, caption, buttons = [], actionTaken, tag = 'Report image' }) {
  const target = await whatsappTarget(conversationId);
  const mediaId = await uploadWhatsappImage(target, png);
  const body = String(caption || 'Report').slice(0, 1024);
  const options = buttons.filter(Boolean).slice(0, 10);
  const replies = options.length <= 3 ? options.map((title, index) => ({
    type: 'reply',
    reply: { id: `report_${index + 1}`, title: String(title).slice(0, 20) }
  })) : [];
  if (options.length > 3) {
    await postWhatsapp(target, { type: 'image', image: { id: mediaId, caption: body } });
    await saveOutbound(conversationId, `${body}\n\n[Report image]`, actionTaken);
    try {
      await postWhatsapp(target, {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: 'Choose another report 👇' },
          action: {
            button: 'More reports',
            sections: [{ title: 'Reports', rows: options.map((title, index) => ({ id: `report_${index + 1}`, title: String(title).slice(0, 24) })) }]
          }
        }
      });
    } catch (error) {
      console.error('WhatsApp report menu skipped:', String(error?.message || 'failed').slice(0, 180));
    }
    return target.row;
  }
  if (replies.length) {
    await postWhatsapp(target, {
      type: 'interactive',
      interactive: {
        type: 'button',
        header: { type: 'image', image: { id: mediaId } },
        body: { text: body },
        action: { buttons: replies }
      }
    });
  } else {
    await postWhatsapp(target, { type: 'image', image: { id: mediaId, caption: body } });
  }
  await saveOutbound(conversationId, `${body}\n\n[${tag}]`, actionTaken);
  return target.row;
}

export async function sendMessage(req, conversationId) {
  const text = req.body.body.trim();
  const row = await deliverWhatsapp({ conversationId, text, actionTaken: 'Sent from AIRO' });
  await recordAudit(req, {
    action: 'whatsapp_message.sent',
    resource: 'whatsapp_conversation',
    resourceId: conversationId,
    organizationId: row.organizationId
  });
  return conversation(conversationId);
}

export async function disconnectBot(req) {
  const current = await repo.bot();
  if (!current) throw new ApiError(404, 'WhatsApp chatbot is not configured.', 'not_found');
  await repo.disconnectBot();
  await recordAudit(req, {
    action: 'whatsapp_bot.disconnected',
    resource: 'whatsapp_bot',
    resourceId: 1,
    organizationId: null
  });
  return overview();
}

export async function updateBot(req) {
  const current = await repo.bot();
  if (!current) throw new ApiError(404, 'WhatsApp chatbot is not configured.', 'not_found');
  await repo.updateBot({
    phoneLabel: req.body.phoneLabel.trim(),
    status: req.body.status,
    note: req.body.note?.trim() || current.note
  });
  await recordAudit(req, {
    action: 'whatsapp_bot.updated',
    resource: 'whatsapp_bot',
    resourceId: 1,
    organizationId: null,
    metadata: { status: req.body.status }
  });
  return overview();
}

export async function setBusiness(req) {
  const rows = await repo.businesses();
  const match = rows.find((row) => Number(row.organizationId) === Number(req.body.organizationId));
  if (!match) throw new ApiError(404, 'That business is not on the chatbot.', 'not_found');
  await repo.setBusiness(req.body.organizationId, req.body.enabled);
  await recordAudit(req, {
    action: req.body.enabled ? 'whatsapp_business.enabled' : 'whatsapp_business.paused',
    resource: 'whatsapp_business',
    resourceId: req.body.organizationId,
    organizationId: req.body.organizationId
  });
  return overview();
}

export async function conversation(id) {
  const row = await repo.conversation(id);
  if (!row) throw new ApiError(404, 'Conversation not found.', 'not_found');
  return { conversation: row, messages: await repo.messages(id) };
}
