import { many, one, run } from '../db/sql.js';

const count = (value) => Math.max(0, Math.min(4000000000, Math.round(Number(value) || 0)));

export function addUsage(row) {
  return run(
    `INSERT INTO paid_usage (tool, provider, model, purpose, feature, organization_id, status, input_tokens, output_tokens, items, max_charge_usd, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [
      row.tool,
      String(row.provider || '').slice(0, 40),
      row.model ? String(row.model).slice(0, 160) : null,
      row.purpose ? String(row.purpose).slice(0, 40) : null,
      row.feature ? String(row.feature).slice(0, 60) : null,
      row.organizationId || null,
      row.status === 'failed' ? 'failed' : 'ok',
      count(row.inputTokens),
      count(row.outputTokens),
      count(row.items),
      row.maxChargeUsd == null ? null : Number(row.maxChargeUsd),
      count(row.durationMs)
    ]
  );
}

const SUMS = `COUNT(*) AS calls, SUM(status = 'failed') AS failed, SUM(input_tokens) AS inputTokens,
  SUM(output_tokens) AS outputTokens, SUM(items) AS items, SUM(COALESCE(max_charge_usd, 0)) AS maxChargeUsd`;

export function totals(tool, days) {
  return one(`SELECT ${SUMS}, MIN(created_at) AS firstAt FROM paid_usage WHERE tool = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY`, [tool, days]);
}

export function daily(tool, days) {
  return many(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, ${SUMS}
     FROM paid_usage WHERE tool = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
     GROUP BY day ORDER BY day`,
    [tool, days]
  );
}

const GROUPS = { model: 'provider, model', feature: 'feature', purpose: 'purpose' };

export function grouped(tool, by, days) {
  const columns = GROUPS[by];
  return many(
    `SELECT ${columns}, ${SUMS} FROM paid_usage
     WHERE tool = ? AND created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
     GROUP BY ${columns} ORDER BY calls DESC LIMIT 30`,
    [tool, days]
  );
}

export function byOrganization(tool, days) {
  return many(
    `SELECT u.organization_id AS organizationId, o.name, COUNT(*) AS calls, SUM(u.status = 'failed') AS failed,
       SUM(u.input_tokens) AS inputTokens, SUM(u.output_tokens) AS outputTokens, SUM(u.items) AS items,
       SUM(COALESCE(u.max_charge_usd, 0)) AS maxChargeUsd
     FROM paid_usage u LEFT JOIN organizations o ON o.id = u.organization_id
     WHERE u.tool = ? AND u.created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
     GROUP BY u.organization_id, o.name ORDER BY calls DESC LIMIT 30`,
    [tool, days]
  );
}

export function whatsappDaily(days) {
  return many(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, SUM(direction = 'outbound') AS sent, SUM(direction = 'inbound') AS received
     FROM whatsapp_messages WHERE created_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
     GROUP BY day ORDER BY day`,
    [days]
  );
}
