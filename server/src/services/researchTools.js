import { one, run } from '../db/sql.js';
import { decryptJson, encryptJson } from '../utils/cryptoBox.js';
import { recordAudit } from './auditService.js';
import { ApiError } from '../utils/errors.js';

const preview = (value) => (value ? `••••${String(value).slice(-4)}` : '');

function toolRow(key) {
  return one(
    `SELECT tool_key AS toolKey, ciphertext, key_preview AS keyPreview, account_label AS accountLabel, checked_at AS checkedAt, updated_at AS updatedAt
     FROM platform_tools WHERE tool_key = ?`,
    [key]
  ).catch((error) => {
    if (error?.cause?.code === 'ER_NO_SUCH_TABLE' || error?.code === 'ER_NO_SUCH_TABLE') return null;
    throw error;
  });
}

function secretOf(row) {
  if (!row?.ciphertext) return null;
  try {
    return decryptJson(row.ciphertext);
  } catch {
    return null;
  }
}

export async function apifyToken() {
  const secret = secretOf(await toolRow('apify'));
  return secret?.verified === true && secret.apiKey ? secret.apiKey : null;
}

async function apifyAccount(apiKey) {
  let response;
  try {
    response = await fetch('https://api.apify.com/v2/users/me', {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new ApiError(422, 'The API did not respond.', 'validation_error');
  }
  if (!response.ok) throw new ApiError(422, 'Wrong API.', 'validation_error');
  const body = await response.json().catch(() => ({}));
  const user = body?.data || {};
  const plan = user.plan?.id || user.plan?.description || '';
  return [user.username, plan ? `${plan} plan` : ''].filter(Boolean).join(' · ').slice(0, 160) || 'Apify account';
}

export async function researchTools() {
  const row = await toolRow('apify');
  const secret = secretOf(row);
  const connected = Boolean(secret?.verified && secret.apiKey);
  return {
    apify: {
      connected,
      keyPreview: connected ? row.keyPreview || preview(secret.apiKey) : '',
      accountLabel: connected ? row.accountLabel || '' : '',
      checkedAt: connected ? row.checkedAt : null
    }
  };
}

export async function connectApify(req) {
  const apiKey = String(req.body.apiKey || '').trim();
  if (apiKey.length < 8) throw new ApiError(422, 'Wrong API.', 'validation_error');
  const accountLabel = await apifyAccount(apiKey);
  await run(
    `INSERT INTO platform_tools (tool_key, ciphertext, key_preview, account_label, checked_at) VALUES ('apify', ?, ?, ?, UTC_TIMESTAMP())
     ON DUPLICATE KEY UPDATE ciphertext = VALUES(ciphertext), key_preview = VALUES(key_preview), account_label = VALUES(account_label), checked_at = UTC_TIMESTAMP()`,
    [encryptJson({ provider: 'apify', apiKey, verified: true }), preview(apiKey), accountLabel]
  );
  await recordAudit(req, { action: 'research_tool.connected', resource: 'platform_tool', organizationId: null, metadata: { tool: 'apify' } });
  return researchTools();
}

export async function disconnectApify(req) {
  await run(`DELETE FROM platform_tools WHERE tool_key = 'apify'`);
  await recordAudit(req, { action: 'research_tool.disconnected', resource: 'platform_tool', organizationId: null, metadata: { tool: 'apify' } });
  return researchTools();
}
