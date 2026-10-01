import crypto from 'crypto';
import { ApiError } from '../utils/errors.js';
import { decryptJson, encryptJson } from '../utils/cryptoBox.js';
import { recordAudit } from './auditService.js';
import * as repo from '../repositories/whatsappRepo.js';

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
  if (!secret || !sameSecret(secret.verifyToken, token)) return null;
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
        await storeInbound({
          phone,
          name: contact?.profile?.name || phone,
          body: String(text).slice(0, 2000)
        });
      }
    }
  }
}

async function storeInbound({ phone, name, body }) {
  const existing = await repo.findConversationByPhone(phone);
  let conversationId = existing?.id;
  if (!conversationId) {
    const business = await repo.firstEnabledBusiness();
    if (!business) return;
    conversationId = await repo.insertConversation({
      organizationId: business.organizationId,
      contactName: name,
      contactPhone: phone,
      topic: 'inbox'
    });
  } else {
    await repo.touchConversation(conversationId);
  }
  await repo.insertMessage({
    conversationId,
    direction: 'inbound',
    body,
    actionTaken: 'Received from WhatsApp'
  });
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
