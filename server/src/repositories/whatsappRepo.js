import { insert, many, one, run } from '../db/sql.js';

export const CAPABILITIES = [
  { key: 'overview', name: 'Business overview', detail: 'KPI, funnel, and the weekly brief for that business.' },
  { key: 'leads', name: 'Leads', detail: 'Find, create, score, and assign leads inside the business workspace.' },
  { key: 'sources', name: 'Lead sources', detail: 'Volume and quality by source, including portals.' },
  { key: 'campaigns', name: 'Campaigns', detail: 'Spend, CPL, qualified leads, and which campaign needs attention.' },
  { key: 'sales', name: 'Sales', detail: 'Pipeline, stage, follow-ups, and lost reasons.' },
  { key: 'calls', name: 'Calls', detail: 'Missed calls, summary, buying signals, and objections.' },
  { key: 'activities', name: 'Activities', detail: 'Tasks, notes, and reminders.' },
  { key: 'reports', name: 'Reports', detail: 'Executive, marketing, sales, and team answers from that workspace.' }
];

export function bot() {
  return one(
    `SELECT id, display_name AS displayName, provider_name AS providerName, phone_label AS phoneLabel, status, mode,
            api_version AS apiVersion, phone_number_id AS phoneNumberId,
            webhook_path AS webhookPath, note, credential_ciphertext AS credentialCiphertext, connected_at AS connectedAt, updated_at AS updatedAt
     FROM whatsapp_bot WHERE id = 1`
  );
}

export function updateBot({ phoneLabel, status, note }) {
  return run(
    `UPDATE whatsapp_bot SET phone_label = ?, status = ?, note = ? WHERE id = 1`,
    [phoneLabel, status, note]
  );
}

export function connectBot({ phoneLabel, providerName, apiVersion, phoneNumberId, ciphertext }) {
  return run(
    `UPDATE whatsapp_bot
     SET phone_label = ?, provider_name = ?, api_version = ?, phone_number_id = ?, credential_ciphertext = ?,
         status = 'connected', mode = 'live', connected_at = UTC_TIMESTAMP(),
         note = 'Connected to the WhatsApp Cloud API.'
     WHERE id = 1`,
    [phoneLabel, providerName, apiVersion, phoneNumberId, ciphertext]
  );
}

export function disconnectBot() {
  return run(
    `UPDATE whatsapp_bot
     SET credential_ciphertext = NULL, status = 'pending', mode = 'development', connected_at = NULL,
         note = 'Disconnected from WhatsApp.'
     WHERE id = 1`
  );
}

export function findConversationByPhone(phone) {
  return one(
    `SELECT id, organization_id AS organizationId FROM whatsapp_conversations
     WHERE contact_phone = ? ORDER BY last_message_at DESC LIMIT 1`,
    [phone]
  );
}

export function firstEnabledBusiness() {
  return one(
    `SELECT organization_id AS organizationId, business_label AS businessLabel
     FROM whatsapp_businesses WHERE enabled = 1 ORDER BY id LIMIT 1`
  );
}

export function insertConversation({ organizationId, contactName, contactPhone, topic }) {
  return insert(
    `INSERT INTO whatsapp_conversations (organization_id, contact_name, contact_phone, topic, status, last_message_at)
     VALUES (?, ?, ?, ?, 'open', UTC_TIMESTAMP())`,
    [organizationId, contactName, contactPhone, topic]
  );
}

export function insertMessage({ conversationId, direction, body, actionTaken }) {
  return insert(
    `INSERT INTO whatsapp_messages (conversation_id, direction, body, action_taken, created_at)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP())`,
    [conversationId, direction, body, actionTaken]
  );
}

export function touchConversation(id) {
  return run(`UPDATE whatsapp_conversations SET last_message_at = UTC_TIMESTAMP(), status = 'open' WHERE id = ?`, [id]);
}

export function businesses() {
  return many(
    `SELECT b.organization_id AS organizationId, b.enabled, b.business_label AS businessLabel,
            o.name AS organizationName, o.city, o.status AS organizationStatus,
            (SELECT COUNT(*) FROM whatsapp_conversations c WHERE c.organization_id = b.organization_id) AS conversations
     FROM whatsapp_businesses b
     JOIN organizations o ON o.id = b.organization_id
     ORDER BY o.name`
  );
}

export function setBusiness(organizationId, enabled) {
  return run(`UPDATE whatsapp_businesses SET enabled = ? WHERE organization_id = ?`, [enabled ? 1 : 0, organizationId]);
}

export function conversations() {
  return many(
    `SELECT c.id, c.organization_id AS organizationId, o.name AS organizationName, c.contact_name AS contactName,
            c.contact_phone AS contactPhone, c.topic, c.status, c.last_message_at AS lastMessageAt,
            (SELECT m.body FROM whatsapp_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastMessage,
            (SELECT m.direction FROM whatsapp_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS lastDirection
     FROM whatsapp_conversations c
     JOIN organizations o ON o.id = c.organization_id
     ORDER BY c.last_message_at DESC`
  );
}

export function messages(conversationId) {
  return many(
    `SELECT id, direction, body, action_taken AS actionTaken, created_at AS createdAt
     FROM whatsapp_messages WHERE conversation_id = ? ORDER BY id`,
    [conversationId]
  );
}

export function conversation(id) {
  return one(
    `SELECT c.id, c.organization_id AS organizationId, o.name AS organizationName, c.contact_name AS contactName,
            c.contact_phone AS contactPhone, c.topic, c.status
     FROM whatsapp_conversations c
     JOIN organizations o ON o.id = c.organization_id
     WHERE c.id = ?`,
    [id]
  );
}
