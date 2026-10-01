import crypto from 'crypto';
import { env } from '../config/env.js';
import { decryptJson } from '../utils/cryptoBox.js';
import * as repo from '../repositories/connectionRepo.js';

function sameSecret(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function verifyWebhook(query) {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || !token || !challenge) return null;
  if (!env.metaVerifyToken || !sameSecret(env.metaVerifyToken, token)) return null;
  return String(challenge);
}

function accountKey(value) {
  return String(value || '').replace(/^act_/, '');
}

export async function receiveWebhook(body) {
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  if (!entries.length) return;
  const rows = await repo.liveConnections('meta_ads');
  const connections = rows.flatMap((row) => {
    try {
      const secret = decryptJson(row.ciphertext);
      if (!secret?.verified) return [];
      return [{ id: row.id, organizationId: row.organizationId, accountId: secret.accountId || '' }];
    } catch {
      return [];
    }
  });
  for (const entry of entries) {
    const account = accountKey(entry.id);
    const match = connections.find((item) => account && accountKey(item.accountId) === account);
    if (!match) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const field = String(change.field || 'event').replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'event';
      await repo.upsertObject({
        organizationId: match.organizationId,
        connectionId: match.id,
        objectType: field,
        externalId: `${entry.id || 'account'}-${entry.time || Date.now()}`.slice(0, 80),
        name: field,
        parentExternalId: null,
        payload: { origin: 'webhook', ...change, accountId: entry.id }
      });
    }
  }
}
