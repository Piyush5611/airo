import { many, one, run } from '../db/sql.js';

const COLUMNS = `id, purpose, provider, model_name AS modelName, base_url AS baseUrl, status,
  credential_ciphertext AS credentialCiphertext, key_preview AS keyPreview,
  connected_at AS connectedAt, note`;

export function connections() {
  return many(
    `SELECT ${COLUMNS} FROM llm_connection WHERE status = 'connected' ORDER BY purpose, id`
  );
}

export function connectionByPurpose(purpose) {
  return one(
    `SELECT ${COLUMNS} FROM llm_connection WHERE purpose = ? AND status = 'connected' LIMIT 1`,
    [purpose]
  );
}

export function connectionById(id) {
  return one(`SELECT ${COLUMNS} FROM llm_connection WHERE id = ?`, [id]);
}

export function connectionForProvider(provider) {
  return one(
    `SELECT ${COLUMNS}
     FROM llm_connection
     WHERE provider = ? AND status = 'connected' AND credential_ciphertext IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
    [provider]
  );
}

export function saveConnection({ purpose, provider, modelName, baseUrl, ciphertext, keyPreview, note }) {
  return run(
    `INSERT INTO llm_connection (purpose, provider, model_name, base_url, status, credential_ciphertext, key_preview, connected_at, note)
     VALUES (?, ?, ?, ?, 'connected', ?, ?, UTC_TIMESTAMP(), ?)
     ON DUPLICATE KEY UPDATE
       provider = VALUES(provider), model_name = VALUES(model_name), base_url = VALUES(base_url),
       status = 'connected', credential_ciphertext = VALUES(credential_ciphertext),
       key_preview = VALUES(key_preview), connected_at = UTC_TIMESTAMP(), note = VALUES(note)`,
    [purpose, provider, modelName, baseUrl || null, ciphertext, keyPreview, note]
  );
}

export function clearConnection(id) {
  return run(`DELETE FROM llm_connection WHERE id = ?`, [id]);
}
