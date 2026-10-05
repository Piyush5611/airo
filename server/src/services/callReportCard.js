import { decryptJson } from '../utils/cryptoBox.js';
import { nexcallCallReport } from '../integrations/nexcall.js';
import { many, one } from '../db/sql.js';
import { reportWindow } from './whatsappReport.js';

const IST = 5.5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BAR = 10;
const NAME = 11;
const CALL_ASK = /\b(call|calls|calling|report|nexcall|yatri|performance|hisab|summary)\b/i;
const OTHER_ASK = /\b(follow[- ]?ups?|call[- ]?backs?|callbacks?|leads?|campaign|ads?|budget|spend)\b/i;
const NOT_NAMES = new Set(['call', 'calls', 'report', 'team', 'aaj', 'kal', 'today', 'yesterday', 'week', 'month', 'hafte', 'mahine', 'mera', 'sab', 'all', 'total', 'yatri', 'nexcall']);

function hasWord(text, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(text);
}

function n(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function fmt(value) {
  return Math.round(n(value)).toLocaleString('en-IN');
}

function pct(part, whole) {
  return n(whole) ? Math.round((n(part) * 100) / n(whole)) : 0;
}

function talk(seconds) {
  const total = Math.round(n(seconds));
  if (!total) return '0m';
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${mins}m`;
  return mins ? `${mins}m ${total % 60}s` : `${total}s`;
}

function bar(value, max, width = BAR) {
  if (!n(max) || !n(value)) return '░'.repeat(width);
  const filled = Math.min(width, Math.round((n(value) / n(max)) * width));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function cell(text, width = NAME) {
  const value = String(text || '—').trim();
  return value.length > width ? `${value.slice(0, width - 1)}…` : value.padEnd(width, ' ');
}

function shortName(name) {
  const parts = String(name || '—').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

function istParts(date) {
  const ist = new Date(date.getTime() + IST);
  return { y: ist.getUTCFullYear(), m: ist.getUTCMonth(), d: ist.getUTCDate(), weekday: ist.getUTCDay(), h: ist.getUTCHours(), min: ist.getUTCMinutes() };
}

function stamp(date) {
  const p = istParts(date);
  const pad = (value) => String(value).padStart(2, '0');
  const ist = new Date(date.getTime() + IST);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}:${pad(ist.getUTCSeconds())}`;
}

function clock(date) {
  const p = istParts(date);
  const hour = p.h % 12 || 12;
  return `${hour}:${String(p.min).padStart(2, '0')} ${p.h < 12 ? 'AM' : 'PM'}`;
}

function dayLabel(date) {
  const p = istParts(date);
  return `${WEEKDAYS[p.weekday]} ${p.d} ${MONTHS[p.m]}`;
}

function windowTitle(window) {
  let title = String(window.label || '').replace(/\s*\(IST\)\s*/g, '').replace(/^today /, 'Today, ').replace(/ yesterday$/, ' (yesterday)').trim();
  const trailing = title.match(/^(.*\d)\s+([a-z][a-z ]*)$/i);
  if (trailing) title = `${trailing[2]} (${trailing[1].replace(/ to /, ' – ')})`;
  if (!/\d/.test(title) && window.from && window.to) {
    const first = dayLabel(window.from);
    const last = dayLabel(new Date(Math.min(window.to.getTime(), Date.now()) - 1));
    title = `${title} (${first === last ? first : `${first} – ${last}`})`;
  }
  return title.charAt(0).toUpperCase() + title.slice(1);
}

async function callYatri(organizationId) {
  const row = await one(
    `SELECT c.id, c.mode, c.status, cred.ciphertext
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND p.provider_key = 'nexcall'
     ORDER BY c.id
     LIMIT 1`,
    [organizationId]
  );
  if (!row?.ciphertext || row.status !== 'connected' || row.mode !== 'live') return null;
  try {
    const secret = decryptJson(row.ciphertext);
    return secret?.apiKey ? { id: row.id, apiKey: secret.apiKey, baseUrl: secret.baseUrl } : null;
  } catch {
    return null;
  }
}

async function readReport(link, from, to) {
  const body = await nexcallCallReport({ apiKey: link.apiKey, baseUrl: link.baseUrl, from: stamp(from), to: stamp(to) });
  return {
    totals: body?.data?.summary?.totals || {},
    employees: (body?.data?.employees || []).map(({ employee_email: _email, ...row }) => row)
  };
}

function sumRows(rows) {
  const keys = ['total_calls', 'connected_calls', 'missed_calls', 'not_picked_calls', 'rejected_calls', 'outgoing_total_calls', 'incoming_total_calls', 'total_duration_seconds', 'connected_calls_duration_seconds'];
  return Object.fromEntries(keys.map((key) => [key, rows.reduce((total, row) => total + n(row[key]), 0)]));
}

async function teamHeads(connectionId) {
  const rows = await many(
    `SELECT h.id, h.head_employee_id AS headEmployeeId, h.head_name AS headName, m.employee_id AS employeeId
     FROM call_team_heads h
     LEFT JOIN call_team_members m ON m.team_head_id = h.id
     WHERE h.connection_id = ?`,
    [connectionId]
  ).catch(() => []);
  const heads = new Map();
  for (const row of rows) {
    const head = heads.get(row.id) || { name: String(row.headName || ''), ids: new Set([String(row.headEmployeeId)]) };
    if (row.employeeId != null) head.ids.add(String(row.employeeId));
    heads.set(row.id, head);
  }
  return [...heads.values()].filter((head) => head.name);
}

function findEmployee(text, employees) {
  const named = employees.filter((row) => row.employee_name);
  const full = [...named].sort((a, b) => b.employee_name.length - a.employee_name.length).find((row) => hasWord(text, row.employee_name));
  if (full) return full;
  const firsts = named.filter((row) => {
    const first = String(row.employee_name).trim().split(/\s+/)[0];
    return first.length >= 3 && !NOT_NAMES.has(first.toLowerCase()) && hasWord(text, first);
  });
  return firsts.length === 1 ? firsts[0] : null;
}

function findHead(text, heads) {
  if (!/\bteam\b/i.test(text)) return null;
  return heads.find((head) => hasWord(text, head.name) || hasWord(text, head.name.split(/\s+/)[0])) || null;
}

function askedName(text) {
  const match = String(text).match(/\b([A-Za-z]{3,})\s+(?:ka|ke|ki)\s+(?:report|data|calls|performance|hisab)\b/i);
  return match && !NOT_NAMES.has(match[1].toLowerCase()) ? match[1] : '';
}

function chart(rows, scale = 0) {
  const max = scale || Math.max(...rows.map((row) => n(row.value)), 1);
  const width = Math.max(...rows.map((row) => row.label.length), 4);
  return ['```', ...rows.map((row) => `${row.label.padEnd(width, ' ')} ${bar(row.value, max)} ${row.text}`), '```'];
}

function outcomeLines(totals) {
  const total = n(totals.total_calls);
  const parts = [
    ['Connected', totals.connected_calls],
    ['Missed', totals.missed_calls],
    ['Not picked', totals.not_picked_calls],
    ['Rejected', totals.rejected_calls]
  ].filter(([, value]) => n(value) > 0);
  if (!total || !parts.length) return [];
  return [
    '*🎯 Call outcome*',
    ...chart(parts.map(([label, value]) => ({ label, value: n(value), text: `${String(pct(value, total)).padStart(3, ' ')}%` })), total),
    ''
  ];
}

function directionLines(totals) {
  const out = n(totals.outgoing_total_calls);
  const inc = n(totals.incoming_total_calls);
  if (!out && !inc) return [];
  const total = out + inc;
  return [
    '*🔁 Incoming vs outgoing*',
    ...chart([
      { label: 'Outgoing', value: out, text: `${fmt(out)} · ${pct(out, total)}%` },
      { label: 'Incoming', value: inc, text: `${fmt(inc)} · ${pct(inc, total)}%` }
    ], total),
    ''
  ];
}

function trendLines(days) {
  const shown = days.filter((row) => row.totals);
  if (shown.length < 2) return [];
  const best = shown.reduce((top, row) => (n(row.totals.total_calls) > n(top.totals.total_calls) ? row : top), shown[0]);
  return [
    '*📈 Day by day*',
    ...chart(shown.map((row) => ({ label: dayLabel(row.date), value: n(row.totals.total_calls), text: fmt(row.totals.total_calls) }))),
    `Best day: *${dayLabel(best.date)}* with ${fmt(best.totals.total_calls)} calls`,
    ''
  ];
}

function summaryLines(totals, employees) {
  const total = n(totals.total_calls);
  const connected = n(totals.connected_calls);
  const active = employees.filter((row) => n(row.total_calls) > 0).length;
  const lines = [
    '*📊 Summary*',
    `📞 Total calls: *${fmt(total)}*`,
    `✅ Connected: *${fmt(connected)}* (${pct(connected, total)}%)`
  ];
  if (n(totals.missed_calls)) lines.push(`❌ Missed: *${fmt(totals.missed_calls)}*`);
  if (n(totals.not_picked_calls)) lines.push(`🔕 Not picked: *${fmt(totals.not_picked_calls)}*`);
  if (n(totals.rejected_calls)) lines.push(`⛔ Rejected: *${fmt(totals.rejected_calls)}*`);
  lines.push(`⏱️ Talk time: *${talk(totals.total_duration_seconds)}*${connected ? ` (avg ${talk(n(totals.connected_calls_duration_seconds) / connected)} per connected call)` : ''}`);
  if (n(totals.unique_clients)) lines.push(`👥 Unique clients: *${fmt(totals.unique_clients)}*`);
  if (employees.length) lines.push(`🧑‍💼 Active callers: *${active}* of ${employees.length}`);
  lines.push('');
  return lines;
}

function leaderLines(employees) {
  const ranked = [...employees].filter((row) => n(row.total_calls) > 0).sort((a, b) => n(b.total_calls) - n(a.total_calls));
  if (!ranked.length) return [];
  const top = ranked.slice(0, 8);
  const max = n(top[0].total_calls);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = [
    '*🏆 Top callers*',
    '```',
    ...top.map((row, index) => `${String(index + 1).padStart(2, ' ')} ${cell(shortName(row.employee_name))} ${bar(row.total_calls, max)} ${fmt(row.total_calls)}`),
    '```',
    ...top.slice(0, 3).map((row, index) => `${medals[index]} ${row.employee_name}: ${fmt(row.total_calls)} calls, ${pct(row.connected_calls, row.total_calls)}% connected, ${talk(row.total_duration_seconds)} talk`)
  ];
  const steady = ranked.filter((row) => n(row.total_calls) >= 10);
  const bestRate = [...steady].sort((a, b) => pct(b.connected_calls, b.total_calls) - pct(a.connected_calls, a.total_calls))[0];
  const low = steady.filter((row) => pct(row.connected_calls, row.total_calls) < 35).slice(0, 3);
  const idle = employees.filter((row) => !n(row.total_calls)).map((row) => row.employee_name).filter(Boolean);
  if (bestRate) lines.push('', `🌟 Best connect rate: *${bestRate.employee_name}* (${pct(bestRate.connected_calls, bestRate.total_calls)}%)`);
  if (low.length || idle.length) {
    lines.push('', '*⚠️ Needs attention*');
    for (const row of low) lines.push(`• ${row.employee_name}: only ${pct(row.connected_calls, row.total_calls)}% connected (${fmt(row.total_calls)} calls)`);
    if (idle.length) lines.push(`• No calls yet: ${idle.slice(0, 6).join(', ')}${idle.length > 6 ? ` +${idle.length - 6} more` : ''}`);
  }
  lines.push('');
  return lines;
}

function personLines(person, employees) {
  const ranked = [...employees].sort((a, b) => n(b.total_calls) - n(a.total_calls));
  const rank = ranked.findIndex((row) => row === person) + 1;
  const active = employees.filter((row) => n(row.total_calls) > 0);
  const average = active.length ? active.reduce((total, row) => total + n(row.total_calls), 0) / active.length : 0;
  const best = n(ranked[0]?.total_calls);
  return [
    `*👤 ${person.employee_name}*${rank ? ` · Rank #${rank} of ${employees.length}` : ''}`,
    '```',
    `${cell('You', 9)} ${bar(person.total_calls, Math.max(best, average, 1))} ${fmt(person.total_calls)}`,
    `${cell('Team avg', 9)} ${bar(average, Math.max(best, average, 1))} ${fmt(average)}`,
    `${cell('Top', 9)} ${bar(best, Math.max(best, average, 1))} ${fmt(best)}`,
    '```',
    ''
  ];
}

async function dailyRows(link, window) {
  const start = window.from.getTime();
  const end = Math.min(window.to.getTime(), Date.now());
  const count = Math.ceil((end - start) / DAY);
  if (count < 2 || count > 14) return [];
  const days = Array.from({ length: count }, (_, index) => new Date(start + index * DAY));
  const out = [];
  for (let index = 0; index < days.length; index += 4) {
    out.push(...await Promise.all(days.slice(index, index + 4).map(async (date) => {
      try {
        const report = await readReport(link, date, new Date(Math.min(date.getTime() + DAY - 1000, end)));
        return { date, totals: report.totals };
      } catch {
        return { date, totals: null };
      }
    })));
  }
  return out;
}

export function wantsCallCard(messages) {
  const users = (messages || []).filter((row) => row.role === 'user');
  const latest = String(users[users.length - 1]?.content || '').trim();
  if (!latest || !CALL_ASK.test(latest)) return '';
  if (OTHER_ASK.test(latest) && !/\bcalls?\b|\bcalling\b/i.test(latest)) return '';
  if (/\b\d{10,13}\b/.test(latest)) return '';
  return latest;
}

export async function callReportCard(organizationId, messages, businessName = '') {
  const text = wantsCallCard(messages);
  if (!text || !organizationId) return null;
  const link = await callYatri(organizationId);
  if (!link) return null;
  const window = reportWindow(text);
  const header = [
    '📞 *CALL REPORT*',
    `🗓️ ${windowTitle(window)}`,
    businessName ? `🏢 ${businessName} · Call Yatri` : '🏢 Call Yatri',
    '━━━━━━━━━━━━━━━━',
    ''
  ];
  const footer = [
    '━━━━━━━━━━━━━━━━',
    `_Live from Call Yatri · ${clock(new Date())} IST_`,
    '💬 Try: *kal ka report*, *is hafte ka report*, or *<name> ka report*'
  ];
  let report;
  try {
    report = await readReport(link, window.from, window.to);
  } catch {
    return [...header, '⚠️ Call Yatri did not send the report right now. Please try again in a few minutes.', '', ...footer].join('\n');
  }
  const employees = report.employees;
  const head = findHead(text, await teamHeads(link.id));
  const person = head ? null : findEmployee(text, employees);
  const asked = askedName(text);
  if (!head && !person && asked) {
    const names = employees.map((row) => row.employee_name).filter(Boolean);
    return [
      ...header,
      `❓ No caller named *${asked}* in Call Yatri for this period.`,
      names.length ? `\nCallers in this report:\n${names.slice(0, 15).map((name) => `• ${name}`).join('\n')}${names.length > 15 ? `\n…and ${names.length - 15} more` : ''}` : '',
      '',
      ...footer
    ].join('\n');
  }
  const lines = [...header];
  if (person) {
    lines.splice(2, 0, `👤 ${person.employee_name}`);
    lines.push(...summaryLines(person, []), ...outcomeLines(person), ...directionLines(person), ...personLines(person, employees));
  } else if (head) {
    const members = employees.filter((row) => head.ids.has(String(row.employee_id)));
    const totals = sumRows(members);
    lines.splice(2, 0, `👥 Team of ${head.name} (${members.length} callers)`);
    lines.push(...summaryLines(totals, members), ...outcomeLines(totals), ...directionLines(totals), ...leaderLines(members));
  } else {
    const days = await dailyRows(link, window);
    lines.push(...summaryLines(report.totals, employees), ...outcomeLines(report.totals), ...directionLines(report.totals), ...trendLines(days), ...leaderLines(employees));
  }
  if (!n((person || report.totals).total_calls) && !head) {
    lines.push('No calls were made in this period yet.', '');
  }
  lines.push(...footer);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 4000);
}
