import { decryptJson } from '../utils/cryptoBox.js';
import { nexcallCallReport } from '../integrations/nexcall.js';
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
        kind: 'team'
      };
    }
    if (!theirs.length) {
      return {
        userIds: [person.id],
        label: `${person.fullName} is not on a team, so this is only their records`,
        kind: 'person'
      };
    }
    return {
      userIds: [person.id],
      label: `${person.fullName} is on more than one team, so this is only their records`,
      kind: 'person'
    };
  }
  if (asksHead && !person) {
    const named = text.match(/\bteam\s*heads?\s+([A-Za-z][A-Za-z]{2,})/i);
    const who = named && !NOT_NAMES.has(named[1].toLowerCase()) ? ` "${named[1]}"` : '';
    return { missing: `Filter: team head${who} was not found in this business. No report numbers were loaded.` };
  }
  if (person) {
    const teamNote = team ? ` in team ${team.name}` : '';
    return { userIds: [person.id], label: `employee ${person.fullName}${teamNote}`, kind: 'person' };
  }
  if (team) {
    return { userIds: team.userIds, label: `team ${team.name}`, kind: 'team' };
  }

  const named = text.match(/\b([A-Za-z][A-Za-z]{2,})\s+(?:ka|ke|ki)\s+(?:report|data|leads|calls|performance)\b/);
  if (named && !NOT_NAMES.has(named[1].toLowerCase())) {
    return { missing: `Filter: employee "${named[1]}" was not found in this business. No report numbers were loaded.` };
  }
  return { userIds: null, label: 'all employees', kind: 'all' };
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
    `AIRO records: leads ${Number(leads?.total || 0)}, qualified ${Number(leads?.qualified || 0)}, booked ${Number(leads?.booked || 0)}, high intent ${Number(leads?.highIntent || 0)}, calls ${Number(calls?.total || 0)}, missed ${Number(calls?.missed || 0)}, completed ${Number(calls?.completed || 0)}.`
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

async function nexcallLine(organizationId, window, scope, extra) {
  if (scope.kind === 'person' || scope.kind === 'team') {
    return 'Nexcall is not split by employee or team. This call report filter applies to AIRO records only.';
  }
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
    return 'Nexcall report: not connected, so no call report was loaded.';
  }
  let secret;
  try { secret = decryptJson(row.ciphertext); } catch {
    return 'Nexcall report: the saved key could not be read.';
  }
  if (!secret?.apiKey) return 'Nexcall report: no API key is saved.';
  try {
    const report = await nexcallCallReport({
      apiKey: secret.apiKey,
      baseUrl: secret.baseUrl,
      from: sqlStamp(window.from),
      to: sqlStamp(window.to),
      callType: extra.callType
    });
    const summary = report?.data?.summary;
    if (!summary) return `Nexcall call report for ${window.label}: the API returned no totals.`;
    return `Nexcall call report for ${window.label}, whole account: ${JSON.stringify(summary).slice(0, 900)}`;
  } catch (error) {
    return `Nexcall report could not be loaded: ${String(error.message || 'the API did not respond.').replace(/x-api-key[=:]\s*\S+/gi, '').slice(0, 180)}`;
  }
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
  if (scope.missing) return scope.missing;
  const window = reportWindow(text);
  const [projects, cities, sources, campaigns] = await Promise.all([
    many(`SELECT DISTINCT project AS name FROM leads WHERE organization_id = ? AND project <> '' LIMIT 80`, [organizationId]),
    many(`SELECT DISTINCT city AS name FROM leads WHERE organization_id = ? AND city IS NOT NULL AND city <> '' LIMIT 80`, [organizationId]),
    many(`SELECT id, name FROM lead_sources WHERE organization_id = ?`, [organizationId]),
    many(`SELECT id, name FROM campaigns WHERE organization_id = ? LIMIT 80`, [organizationId])
  ]);
  const extra = matchExtras(text, { projects, cities, sources, campaigns });
  const lines = [filterSentence(window, scope, extra)];
  if (!scope.userIds || scope.userIds.length) {
    lines.push(await airoCounts(organizationId, window, scope, extra));
  } else {
    lines.push('AIRO records: this team has no members, so the count is 0.');
  }
  lines.push(await nexcallLine(organizationId, window, scope, extra));
  lines.push(...extra.notes);
  return lines.join('\n');
}
