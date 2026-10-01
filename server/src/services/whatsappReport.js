import { decryptJson } from '../utils/cryptoBox.js';
import { nexcallCalls, nexcallFollowups, nexcallLeads } from '../integrations/nexcall.js';
import { many, one } from '../db/sql.js';

const IST = 5.5 * 60 * 60 * 1000;
const NOT_NAMES = new Set([
  'nexcall', 'meta', 'whatsapp', 'airo', 'aaj', 'kal', 'today', 'yesterday', 'week', 'hafte',
  'mahine', 'month', 'this', 'last', 'pichle', 'pichhle', 'overall', 'total', 'sab', 'all',
  'mera', 'mere', 'apna', 'business', 'call', 'calls', 'lead', 'leads', 'report', 'data',
  'qualified', 'booked', 'missed', 'contacted', 'inbound', 'outbound', 'team', 'employee'
]);

const LEAD_STATUSES = [
  ['site visit', 'site_visit'],
  ['site_visit', 'site_visit'],
  ['unqualified', 'unqualified'],
  ['negotiation', 'negotiation'],
  ['contacted', 'contacted'],
  ['qualified', 'qualified'],
  ['booking', 'booked'],
  ['booked', 'booked'],
  ['lost', 'lost']
];

function sqlStamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function istStamp(date) {
  const ist = new Date(date.getTime() + IST);
  const part = (value) => String(value).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${part(ist.getUTCMonth() + 1)}-${part(ist.getUTCDate())} ${part(ist.getUTCHours())}:${part(ist.getUTCMinutes())}:${part(ist.getUTCSeconds())}`;
}

function istParts(date) {
  const ist = new Date(date.getTime() + IST);
  return {
    y: ist.getUTCFullYear(),
    m: ist.getUTCMonth(),
    d: ist.getUTCDate(),
    weekday: ist.getUTCDay()
  };
}

function istDate(y, m, d) {
  return new Date(Date.UTC(y, m, d) - IST);
}

function istLabel(date) {
  const ist = new Date(date.getTime() + IST);
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${month}-${day}`;
}

function hasWord(text, value) {
  const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(text);
}

function extractDates(text, year) {
  const months = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11
  };
  const found = [];
  const re = /\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+|[-/])(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?|\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/gi;
  let match;
  while ((match = re.exec(text))) {
    let day;
    let month;
    let y;
    if (match[1]) {
      day = Number(match[1]);
      month = months[match[2].toLowerCase()];
      y = match[3] ? Number(match[3]) : year;
    } else if (match[4]) {
      month = months[match[4].toLowerCase()];
      day = Number(match[5]);
      y = match[6] ? Number(match[6]) : year;
    } else {
      const left = Number(match[7]);
      const right = Number(match[8]);
      y = match[9] ? Number(match[9]) : year;
      if (y < 100) y += 2000;
      if (left > 31 || right > 31 || left < 1 || right < 1) continue;
      if (left > 12) {
        day = left;
        month = right - 1;
      } else if (right > 12) {
        day = right;
        month = left - 1;
      } else {
        day = left;
        month = right - 1;
      }
    }
    if (month == null || day < 1 || day > 31) continue;
    const date = istDate(y, month, day);
    if (Number.isNaN(date.getTime())) continue;
    found.push(date);
  }
  return found;
}

export function reportWindow(text, now = new Date()) {
  const { y, m, d, weekday } = istParts(now);
  const today = istDate(y, m, d);
  const dates = extractDates(text, y);
  const open = (from, label) => ({ from, to: now, label });
  const closed = (from, untilDay, label) => ({
    from,
    to: new Date(untilDay.getTime() + 24 * 60 * 60 * 1000),
    label
  });

  if (dates.length >= 2) {
    const ordered = [...dates].sort((a, b) => a - b);
    const from = ordered[0];
    const until = ordered[ordered.length - 1];
    return closed(from, until, `${istLabel(from)} to ${istLabel(until)} (IST)`);
  }
  if (dates.length === 1 && /\b(se|to|till|tak)\b/i.test(text) && /\b(aaj|today|abhi)\b/i.test(text)) {
    return open(dates[0], `${istLabel(dates[0])} to today (IST)`);
  }
  if (dates.length === 1) {
    const from = dates[0];
    const next = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    if (from.getTime() === today.getTime()) return { from, to: now, label: `${istLabel(from)} (IST)` };
    return { from, to: next, label: `${istLabel(from)} (IST)` };
  }
  if (/\b(kal|yesterday)\b/i.test(text)) {
    const from = istDate(y, m, d - 1);
    return closed(from, from, `${istLabel(from)} yesterday (IST)`);
  }
  if (/\b(pichle|pichhle|last)\s+(hafte|week)\b/i.test(text)) {
    const monday = istDate(y, m, d - ((weekday + 6) % 7) - 7);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    return closed(monday, sunday, `${istLabel(monday)} to ${istLabel(sunday)} last week (IST)`);
  }
  if (/\b(is hafte|this week)\b/i.test(text)) {
    return open(istDate(y, m, d - ((weekday + 6) % 7)), 'this week (IST)');
  }
  if (/\b(pichle|pichhle|last|previous)\s+(mahine|month)\b/i.test(text)) {
    const from = istDate(y, m - 1, 1);
    const until = istDate(y, m, 0);
    return closed(from, until, `${istLabel(from)} to ${istLabel(until)} last month (IST)`);
  }
  if (/\b(is mahine|this month)\b/i.test(text)) {
    return open(istDate(y, m, 1), 'this month (IST)');
  }
  const lastN = text.match(/\b(?:last|pichle|pichhle)\s+(\d{1,3})\s*(?:din|days)\b/i);
  if (lastN) {
    const days = Math.min(366, Math.max(1, Number(lastN[1])));
    return open(istDate(y, m, d - (days - 1)), `last ${days} days (IST)`);
  }
  return open(today, `today ${istLabel(today)} (IST)`);
}

export function matchScope(text, people, teams) {
  const team = [...teams]
    .filter((row) => row.name && row.name.length >= 3)
    .sort((a, b) => b.name.length - a.name.length)
    .find((row) => hasWord(text, row.name));
  let person = [...people]
    .filter((row) => row.fullName)
    .sort((a, b) => b.fullName.length - a.fullName.length)
    .find((row) => hasWord(text, row.fullName));
  if (!person) {
    const hits = people.filter((row) => row.first.length >= 4 && hasWord(text, row.first));
    const names = [...new Set(hits.map((row) => row.first.toLowerCase()))];
    if (names.length === 1) person = hits[0];
  }

  const asksHead = /\bteam\s*heads?\b|\bteam\s*leads?\b/i.test(text);
  if (asksHead && person) {
    const theirs = teams.filter((row) => row.userIds.includes(person.id));
    if (theirs.length === 1) {
      return {
        userIds: theirs[0].userIds,
        label: `team head ${person.fullName}, team ${theirs[0].name}`,
        kind: 'team',
        personName: ''
      };
    }
    if (!theirs.length) {
      return {
        userIds: [person.id],
        label: `${person.fullName} is not on a team, so this is only their records`,
        kind: 'person',
        personName: person.fullName
      };
    }
    return {
      userIds: [person.id],
      label: `${person.fullName} is on more than one team, so this is only their records`,
      kind: 'person',
      personName: person.fullName
    };
  }
  if (asksHead && !person) {
    const named = text.match(/\bteam\s*heads?\s+([A-Za-z][A-Za-z]{2,})/i);
    const who = named && !NOT_NAMES.has(named[1].toLowerCase()) ? ` "${named[1]}"` : '';
    return {
      missing: `Filter: team head${who} was not found in this business. No report numbers were loaded.`,
      askedName: named && !NOT_NAMES.has(named[1].toLowerCase()) ? named[1] : ''
    };
  }
  if (person) {
    const teamNote = team ? ` in team ${team.name}` : '';
    return { userIds: [person.id], label: `employee ${person.fullName}${teamNote}`, kind: 'person', personName: person.fullName };
  }
  if (team) {
    return { userIds: team.userIds, label: `team ${team.name}`, kind: 'team', personName: '' };
  }

  const named = text.match(/\b([A-Za-z][A-Za-z]{2,})\s+(?:ka|ke|ki)\s+(?:report|data|leads|calls|performance)\b/);
  if (named && !NOT_NAMES.has(named[1].toLowerCase())) {
    return {
      missing: `Filter: employee "${named[1]}" was not found in this business. No report numbers were loaded.`,
      askedName: named[1]
    };
  }
  return { userIds: null, label: 'all employees', kind: 'all', personName: '' };
}

function matchExtras(text, catalog) {
  const extra = { notes: [] };
  const status = LEAD_STATUSES.find(([word]) => hasWord(text, word));
  if (status) extra.leadStatus = status[1];
  if (hasWord(text, 'missed')) extra.callStatus = 'missed';
  else if (hasWord(text, 'voicemail')) extra.callStatus = 'voicemail';
  else if (hasWord(text, 'completed')) extra.callStatus = 'completed';
  if (/\bhigh[\s-]*intent\b/i.test(text)) extra.intent = 'high';
  if (/\binbound\b/i.test(text) && !/\boutbound\b/i.test(text)) extra.callType = 'inbound';
  if (/\boutbound\b/i.test(text) && !/\binbound\b/i.test(text)) extra.callType = 'outbound';

  const pick = (rows) => [...rows]
    .filter((row) => row.name && String(row.name).length >= 3)
    .sort((a, b) => String(b.name).length - String(a.name).length)
    .find((row) => hasWord(text, row.name));
  const project = pick(catalog.projects);
  const city = pick(catalog.cities);
  const source = pick(catalog.sources);
  const campaign = pick(catalog.campaigns);
  if (project) extra.project = project.name;
  if (city) extra.city = city.name;
  if (source) extra.sourceId = source.id;
  if (source) extra.sourceName = source.name;
  if (campaign) extra.campaignId = campaign.id;
  if (campaign) extra.campaignName = campaign.name;
  if (/\b(budget|spend|cpl|revenue)\b/i.test(text)) {
    extra.notes.push('Money, budget, and ad spend are not included in this report.');
  }
  return extra;
}

function filterSentence(window, scope, extra) {
  const parts = [window.label, scope.label];
  if (extra.leadStatus) parts.push(`lead status ${extra.leadStatus}`);
  if (extra.callStatus) parts.push(`call status ${extra.callStatus}`);
  if (extra.intent) parts.push('high intent');
  if (extra.project) parts.push(`project ${extra.project}`);
  if (extra.city) parts.push(`city ${extra.city}`);
  if (extra.sourceName) parts.push(`source ${extra.sourceName}`);
  if (extra.campaignName) parts.push(`campaign ${extra.campaignName}`);
  if (extra.callType) parts.push(`${extra.callType} calls`);
  return `Report filter: ${parts.join(', ')}.`;
}

function peopleClause(column, ids) {
  if (!ids) return { sql: '', params: [] };
  if (!ids.length) return { sql: ' AND 1 = 0', params: [] };
  return { sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`, params: ids };
}

function leadFilters(extra, alias = '') {
  const column = (name) => `${alias}${name}`;
  const sql = [];
  const params = [];
  if (extra.leadStatus) {
    sql.push(` AND ${column('status')} = ?`);
    params.push(extra.leadStatus);
  }
  if (extra.intent) {
    sql.push(` AND ${column('intent')} = ?`);
    params.push(extra.intent);
  }
  if (extra.project) {
    sql.push(` AND ${column('project')} = ?`);
    params.push(extra.project);
  }
  if (extra.city) {
    sql.push(` AND ${column('city')} = ?`);
    params.push(extra.city);
  }
  if (extra.sourceId) {
    sql.push(` AND ${column('source_id')} = ?`);
    params.push(extra.sourceId);
  }
  if (extra.campaignId) {
    sql.push(` AND ${column('campaign_id')} = ?`);
    params.push(extra.campaignId);
  }
  return { sql: sql.join(''), params };
}

async function airoCounts(organizationId, window, scope, extra) {
  const from = sqlStamp(window.from);
  const to = sqlStamp(window.to);
  const leadIds = peopleClause('assigned_user_id', scope.userIds);
  const callIds = peopleClause('agent_user_id', scope.userIds);
  const leadWhere = leadFilters(extra);
  const leadParams = [organizationId, from, to, ...leadIds.params, ...leadWhere.params];
  const callParams = [organizationId, from, to, ...callIds.params];
  if (extra.callStatus) callParams.push(extra.callStatus);

  const leads = await one(
    `SELECT COUNT(*) AS total,
            SUM(status = 'qualified') AS qualified,
            SUM(status = 'booked') AS booked,
            SUM(intent = 'high') AS highIntent
     FROM leads
     WHERE organization_id = ? AND created_at >= ? AND created_at < ?${leadIds.sql}${leadWhere.sql}`,
    leadParams
  );
  const calls = await one(
    `SELECT COUNT(*) AS total,
            SUM(status = 'missed') AS missed,
            SUM(status = 'completed') AS completed
     FROM calls
     WHERE organization_id = ? AND started_at >= ? AND started_at < ?${callIds.sql}${extra.callStatus ? ' AND status = ?' : ''}`,
    callParams
  );
  const lines = [
    `AIRO workspace records, separate from Nexcall: leads ${Number(leads?.total || 0)}, qualified ${Number(leads?.qualified || 0)}, booked ${Number(leads?.booked || 0)}, high intent ${Number(leads?.highIntent || 0)}, calls ${Number(calls?.total || 0)}, missed ${Number(calls?.missed || 0)}, completed ${Number(calls?.completed || 0)}.`
  ];
  if (scope.kind !== 'person') {
    const groupedIds = peopleClause('l.assigned_user_id', scope.userIds);
    const groupedWhere = leadFilters(extra, 'l.');
    const people = await many(
      `SELECT COALESCE(u.full_name, 'Unassigned') AS name, COUNT(*) AS total
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_user_id
       WHERE l.organization_id = ? AND l.created_at >= ? AND l.created_at < ?${groupedIds.sql}${groupedWhere.sql}
       GROUP BY l.assigned_user_id, u.full_name
       ORDER BY total DESC
       LIMIT 8`,
      [organizationId, from, to, ...groupedIds.params, ...groupedWhere.params]
    );
    if (people.length) {
      lines.push(`Leads by employee: ${people.map((row) => `${row.name} ${Number(row.total)}`).join(', ')}.`);
    }
  }
  return lines.join(' ');
}

function asObject(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return {}; }
  }
  if (Buffer.isBuffer(value)) {
    try { return JSON.parse(value.toString('utf8')); } catch { return {}; }
  }
  return typeof value === 'object' ? value : {};
}

function employeeOf(row) {
  return String(row?.employee_name || row?.employee || row?.user_name || row?.agent_name || '').trim();
}

function nameHits(row, name) {
  const employee = employeeOf(row);
  const wanted = String(name || '').trim();
  if (!wanted) return true;
  if (!employee) return false;
  return hasWord(employee, wanted) || hasWord(wanted, employee);
}

function nexcallKind(text) {
  const raw = String(text || '');
  if (/\bfollow[- ]?ups?\b|\bcall[- ]?backs?\b|\bcallbacks?\b/i.test(raw)) return 'followups';
  if (/\bleads?\b/i.test(raw) && !/\bcalls?\b/i.test(raw)) return 'leads';
  if (/\b\d{10,13}\b/.test(raw) || /\bcall list\b|\blist of calls\b/i.test(raw)) return 'calls';
  return 'report';
}

function callTypeOf(text) {
  const incoming = /\bincoming\b|\binbound\b/i.test(text);
  const outgoing = /\boutgoing\b|\boutbound\b/i.test(text);
  if (incoming && !outgoing) return 'INCOMING';
  if (outgoing && !incoming) return 'OUTGOING';
  return '';
}

function reportParts(body) {
  const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
  const summary = data.summary && typeof data.summary === 'object' && !Array.isArray(data.summary) ? data.summary : data;
  return {
    totals: summary.totals || summary.by_type?.TOTAL || null,
    byType: summary.by_type || null,
    byUser: summary.by_user || summary.users || null
  };
}

function figureText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value)
    .filter(([key, item]) => !/phone|sim|mobile|email|name/i.test(key) && (
      typeof item === 'number' || (typeof item === 'string' && /^-?\d+(\.\d+)?$/.test(item))
    ))
    .map(([key, item]) => `${key} ${item}`)
    .join(', ');
}

function userRows(byUser) {
  if (!byUser) return [];
  if (Array.isArray(byUser)) return byUser.filter((row) => row && typeof row === 'object');
  return Object.entries(byUser).map(([id, value]) => (
    value && typeof value === 'object' ? { user_id: value.user_id ?? id, ...value } : { user_id: id, total: value }
  ));
}

function userLabel(row) {
  return String(row.employee_name || row.name || row.user_name || row.full_name || (row.user_id != null ? `user ${row.user_id}` : 'Unknown')).trim();
}

function formatReport(window, parts, employeeName, alreadyFiltered) {
  const rows = userRows(parts.byUser);
  const chosen = employeeName ? rows.filter((row) => hasWord(userLabel(row), employeeName) || hasWord(employeeName, userLabel(row))) : rows;
  const who = employeeName ? `${employeeName}, ` : '';
  const lines = [`Nexcall call report for ${who}${window.label}.`];
  const totals = figureText(parts.totals);
  const types = figureText(parts.byType);
  if ((!employeeName || alreadyFiltered) && totals) lines.push(`Totals: ${totals}.`);
  if ((!employeeName || alreadyFiltered) && types) lines.push(`By type: ${types}.`);
  if (employeeName && !chosen.length && !(alreadyFiltered && (totals || types))) {
    const names = rows.map(userLabel).filter(Boolean).slice(0, 12);
    return {
      matched: false,
      names,
      text: `Nexcall call report has no employee named ${employeeName}.${names.length ? ` Employees in this report: ${names.join(', ')}.` : ''}`
    };
  }
  const shown = (employeeName ? chosen : rows).slice(0, 8);
  if (shown.length) {
    lines.push(`By employee: ${shown.map((row) => `${userLabel(row)} (${figureText(row) || 'listed'})`).join('; ')}.`);
  }
  if (!totals && !types && !shown.length) {
    return { matched: !employeeName, names: [], text: `Nexcall call report for ${window.label}: the report API returned no totals.` };
  }
  return { matched: true, names: rows.map(userLabel).filter(Boolean).slice(0, 12), text: lines.join(' ') };
}

async function storedCalls(organizationId) {
  const rows = await many(
    `SELECT o.payload
     FROM integration_objects o
     JOIN integration_connections c ON c.id = o.connection_id
     JOIN integration_providers p ON p.id = c.provider_id
     WHERE o.organization_id = ? AND p.provider_key = 'nexcall' AND o.object_type = 'call'
     ORDER BY o.id DESC
     LIMIT 200`,
    [organizationId]
  );
  return rows.map((row) => asObject(row.payload));
}

async function readNexcallSecret(organizationId) {
  const row = await one(
    `SELECT c.mode, c.status, cred.ciphertext
     FROM integration_connections c
     JOIN integration_providers p ON p.id = c.provider_id
     LEFT JOIN integration_credentials cred ON cred.connection_id = c.id
     WHERE c.organization_id = ? AND p.provider_key = 'nexcall'
     LIMIT 1`,
    [organizationId]
  );
  if (!row?.ciphertext || row.status !== 'connected' || row.mode !== 'live') {
    return { error: 'Nexcall report: not connected, so the live call API was not called.' };
  }
  try {
    const secret = decryptJson(row.ciphertext);
    if (!secret?.apiKey) return { error: 'Nexcall report: no API key is saved.' };
    return { secret };
  } catch {
    return { error: 'Nexcall report: the saved key could not be read.' };
  }
}

function tally(rows, pick) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(pick(row) || '').trim();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, total]) => `${name} ${total}`)
    .join(', ');
}

function summarizeCallList(window, body, employeeName, direction) {
  const rows = Array.isArray(body?.data) ? body.data : [];
  const wanted = String(direction || '').toLowerCase();
  const directed = wanted ? rows.filter((row) => String(row.call_direction || '').toLowerCase() === wanted) : rows;
  const chosen = employeeName
    ? directed.filter((row) => hasWord(employeeOf(row), employeeName) || hasWord(employeeName, employeeOf(row)))
    : directed;
  const names = [...new Set(directed.map(employeeOf).filter(Boolean))].slice(0, 12);
  if (employeeName && !chosen.length) {
    return {
      matched: false,
      names,
      text: `Nexcall calls have no employee named ${employeeName}.${names.length ? ` Employees in this list: ${names.join(', ')}.` : ''}`
    };
  }
  const total = employeeName || wanted ? chosen.length : Number(body?.count ?? chosen.length);
  const who = employeeName ? `${employeeName}, ` : '';
  const lines = [`Nexcall calls for ${who}${window.label}: ${total}.`];
  const status = tally(chosen, (row) => row.call_status);
  const way = tally(chosen, (row) => row.call_direction);
  const people = tally(chosen, employeeOf);
  if (status) lines.push(`By status: ${status}.`);
  if (way) lines.push(`By direction: ${way}.`);
  if (!employeeName && people) lines.push(`By employee: ${people}.`);
  if (!employeeName && !wanted && Number(body?.count) > rows.length) lines.push(`Showing ${rows.length} of ${body.count}.`);
  return { matched: true, names, text: lines.join(' ') };
}

function cleanError(error) {
  return String(error?.message || 'the API did not respond.').replace(/x-api-key[=:]\s*\S+/gi, '').slice(0, 160);
}

async function nexcallSummary(organizationId, window, employeeName, text) {
  const loaded = await readNexcallSecret(organizationId);
  if (!loaded.secret) return { matched: false, names: [], text: loaded.error || 'Nexcall report: not connected.' };
  const from = istStamp(window.from);
  const to = istStamp(window.to);
  const kind = nexcallKind(text);
  const stored = employeeName ? await storedCalls(organizationId) : [];
  const knownUser = stored.find((row) => nameHits(row, employeeName) && row.user_id != null);
  try {
    if (kind === 'followups') {
      const body = await nexcallFollowups({ apiKey: loaded.secret.apiKey, baseUrl: loaded.secret.baseUrl, from, to });
      const count = body?.count ?? (Array.isArray(body?.data) ? body.data.length : 0);
      return { matched: true, names: [], text: `Nexcall follow-ups for ${window.label}: ${Number(count || 0)}.` };
    }
    if (kind === 'leads') {
      const phone = String(text || '').match(/\b\d{10,13}\b/)?.[0] || '';
      const body = await nexcallLeads({ apiKey: loaded.secret.apiKey, baseUrl: loaded.secret.baseUrl, from, to, phone });
      const count = body?.count ?? (Array.isArray(body?.data) ? body.data.length : 0);
      return { matched: true, names: [], text: `Nexcall leads for ${window.label}: ${Number(count || 0)}.` };
    }
    const phone = kind === 'calls' ? (String(text || '').match(/\b\d{10,13}\b/)?.[0] || '') : '';
    const body = await nexcallCalls({
      apiKey: loaded.secret.apiKey,
      baseUrl: loaded.secret.baseUrl,
      from,
      to,
      phone,
      userId: knownUser?.user_id,
      limit: 100
    });
    return summarizeCallList(window, body, knownUser ? '' : employeeName, callTypeOf(text));
  } catch (error) {
    return { matched: false, names: [], text: `Nexcall report could not be loaded: ${cleanError(error)}` };
  }
}

async function nexcallLine(organizationId, window, scope, text) {
  const summary = await nexcallSummary(organizationId, window, scope.personName || '', text);
  if (scope.kind === 'team') {
    return `${summary.text}\nThe Nexcall call report is for the connected account. It is not limited to that AIRO team unless an employee name matches the report.`;
  }
  return summary.text;
}

async function roster(organizationId) {
  const [people, membership] = await Promise.all([
    many(
      `SELECT u.id, u.full_name AS fullName
       FROM organization_users ou
       JOIN users u ON u.id = ou.user_id
       WHERE ou.organization_id = ? AND ou.status = 'active'`,
      [organizationId]
    ),
    many(
      `SELECT t.id, t.name, u.id AS userId
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       LEFT JOIN users u ON u.id = tm.user_id
       WHERE t.organization_id = ?`,
      [organizationId]
    )
  ]);
  const teams = [];
  for (const row of membership) {
    let team = teams.find((item) => item.id === row.id);
    if (!team) {
      team = { id: row.id, name: row.name, userIds: [] };
      teams.push(team);
    }
    if (row.userId) team.userIds.push(Number(row.userId));
  }
  return {
    people: people.map((row) => ({
      id: Number(row.id),
      fullName: row.fullName,
      first: String(row.fullName || '').trim().split(/\s+/)[0] || ''
    })),
    teams
  };
}

export async function reportFacts(organizationId, messages) {
  const last = [...(messages || [])].reverse().find((row) => row.role === 'user');
  const text = String(last?.content || '');
  const { people, teams } = await roster(organizationId);
  const scope = matchScope(text, people, teams);
  const window = reportWindow(text);
  if (scope.missing) {
    const nex = await nexcallSummary(organizationId, window, scope.askedName || '', text);
    if (scope.askedName && nex.matched) {
      return `Report filter: ${window.label}, Nexcall employee ${scope.askedName}.\n${nex.text}`;
    }
    if (nex.names?.length) {
      return scope.missing.replace(
        'No report numbers were loaded.',
        `Nexcall employees on the connection page: ${nex.names.join(', ')}. No report numbers were loaded.`
      );
    }
    return scope.missing;
  }
  const [projects, cities, sources, campaigns] = await Promise.all([
    many(`SELECT DISTINCT project AS name FROM leads WHERE organization_id = ? AND project <> '' LIMIT 80`, [organizationId]),
    many(`SELECT DISTINCT city AS name FROM leads WHERE organization_id = ? AND city IS NOT NULL AND city <> '' LIMIT 80`, [organizationId]),
    many(`SELECT id, name FROM lead_sources WHERE organization_id = ?`, [organizationId]),
    many(`SELECT id, name FROM campaigns WHERE organization_id = ? LIMIT 80`, [organizationId])
  ]);
  const extra = matchExtras(text, { projects, cities, sources, campaigns });
  const lines = [filterSentence(window, scope, extra)];
  lines.push(await nexcallLine(organizationId, window, scope, text));
  if (!scope.userIds || scope.userIds.length) {
    lines.push(await airoCounts(organizationId, window, scope, extra));
  } else {
    lines.push('AIRO workspace records: this team has no members, so the count is 0.');
  }
  lines.push(...extra.notes);
  return lines.join('\n');
}
