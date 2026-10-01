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
        const text = message.text?.body || message.type || '';
        if (!phone || !text) continue;
        const saved = await storeInbound({
          phone,
          name: contact?.profile?.name || phone,
          body: String(text).slice(0, 2000),
          reply: Boolean(message.text?.body)
        });
        if (saved?.reply) {
          answerWithModel(saved).catch(async (error) => {
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

async function storeInbound({ phone, name, body, reply }) {
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
  const meta = await handleMetaAdChat({
    organizationId: saved.organizationId,
    conversationId: saved.conversationId,
    recognized: saved.recognized,
    messages
  });
  if (meta?.text) {
    await deliverWhatsapp({
      conversationId: saved.conversationId,
      text: String(meta.text).slice(0, 4000),
      actionTaken: 'Meta ad'
    });
    return;
  }
  const answer = await replyWhatsapp({
    organizationId: saved.organizationId,
    recognized: saved.recognized,
    businessLabel: saved.businessLabel,
    messages
  });
  if (!answer?.text) return;
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

async function deliverWhatsapp({ conversationId, text, actionTaken }) {
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
  let response;
  try {
    response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text }
      }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError(502, 'WhatsApp did not respond. Check the network and try again.', 'whatsapp_unreachable');
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.messages?.[0]?.id) {
    const message = String(payload?.error?.message || 'WhatsApp did not accept this message.')
      .replace(/access_token=[^&\s]+/gi, '')
      .slice(0, 240);
    throw new ApiError(422, message, 'whatsapp_rejected');
  }
  await repo.insertMessage({
    conversationId,
    direction: 'outbound',
    body: text,
    actionTaken
  });
  await repo.touchConversation(conversationId);
  notifyWhatsappMessage(conversationId);
  return row;
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
