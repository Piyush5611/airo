/**
 * Nexcall is the W-Caller external CRM pull API.
 * Read-only. Auth is x-api-key. Data stays scoped to that key's business.
 */
export const NEXCALL_BASE = 'https://w-caller.workians.com/api/external';

export const NEXCALL_DESCRIPTION = 'Read-only pull of W-Caller leads, calls, the call report, and follow-ups. Authenticate with x-api-key.';

export const NEXCALL_ENDPOINTS = [
  { id: 'leads', name: 'Leads', method: 'GET', path: '/leads', filters: 'search, phone, from, to, page, limit' },
  { id: 'lead', name: 'Lead detail', method: 'GET', path: '/leads/:id', filters: 'Lead plus recent calls, follow-ups, and call-backs' },
  { id: 'calls', name: 'Calls', method: 'GET', path: '/calls', filters: 'user_id, phone, call_status, from, to' },
  { id: 'report', name: 'Call report', method: 'GET', path: '/reports/calls', filters: 'from and to are required. Optional user_id, call_type, page, limit' },
  { id: 'followups', name: 'Follow-ups', method: 'GET', path: '/followups', filters: 'from, to. Pending follow-ups and call-backs' }
];

export const NEXCALL_MAPPING = {
  leads: 'leads',
  calls: 'calls',
  callReport: 'call analytics',
  followups: 'activities'
};

export function cleanNexcallKey(value) {
  return String(value || '')
    .trim()
    .replace(/^(?:bearer|x-api-key)\s*[:=]\s*/i, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

function stamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function nameOf(row, fallback) {
  return row.name || row.full_name || row.customer_name || row.lead_name || row.phone || row.mobile || fallback;
}

async function pull(baseUrl, path, apiKey) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
  } catch (cause) {
    const error = new Error('Nexcall did not respond.');
    error.code = 'nexcall_unreachable';
    error.cause = cause;
    throw error;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    const error = new Error(body.message || body.error || 'Nexcall rejected the request.');
    error.code = 'nexcall_rejected';
    error.status = response.status;
    throw error;
  }
  return body;
}

export async function nexcallLeads({ apiKey, baseUrl = NEXCALL_BASE, from, to, phone, search, page = 1, limit = 50 }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (phone) params.set('phone', phone);
  if (search) params.set('search', search);
  return pull(base, `/leads?${params}`, apiKey);
}

export async function nexcallFollowups({ apiKey, baseUrl = NEXCALL_BASE, from, to, page = 1, limit = 50 }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return pull(base, `/followups?${params}`, apiKey);
}

function qs(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export async function nexcallCalls({ apiKey, baseUrl = NEXCALL_BASE, from, to, userId, callStatus, phone, page = 1, limit = 100 }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  return pull(base, `/calls?${qs({ from, to, user_id: userId, call_status: callStatus, phone, page, limit })}`, apiKey);
}

export async function nexcallCallReport({ apiKey, baseUrl = NEXCALL_BASE, from, to, userId, callType }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  const params = new URLSearchParams({ from, to, page: '1', limit: '20' });
  if (userId) params.set('user_id', String(userId));
  if (callType) params.set('call_type', callType);
  return pull(base, `/reports/calls?${params}`, apiKey);
}

export async function verifyNexcall({ apiKey, baseUrl = NEXCALL_BASE }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const query = qs({ from: stamp(start), to: stamp(end), page: 1, limit: 1 });
  await pull(base, `/calls?${query}`, cleanNexcallKey(apiKey));
}

export async function pullNexcall({ apiKey, baseUrl = NEXCALL_BASE }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const from = encodeURIComponent(stamp(start));
  const to = encodeURIComponent(stamp(end));
  const [leads, calls, followups, report] = await Promise.all([
    pull(base, '/leads?page=1&limit=50', apiKey),
    pull(base, `/calls?page=1&limit=50&from=${from}&to=${to}`, apiKey),
    pull(base, '/followups?page=1&limit=50', apiKey),
    pull(base, `/reports/calls?from=${from}&to=${to}&page=1&limit=50`, apiKey)
  ]);
  const objects = [];
  for (const row of leads.data || []) {
    if (row?.id == null) continue;
    objects.push({ type: 'lead', externalId: String(row.id), name: nameOf(row, 'Lead'), payload: { origin: 'api', ...row } });
  }
  for (const row of calls.data || []) {
    if (row?.id == null) continue;
    objects.push({ type: 'call', externalId: String(row.id), name: nameOf(row, 'Call'), payload: { origin: 'api', ...row } });
  }
  for (const row of followups.data || []) {
    const id = row?.id ?? row?.followup_id;
    if (id == null) continue;
    objects.push({ type: 'followup', externalId: String(id), name: nameOf(row, 'Follow-up'), payload: { origin: 'api', ...row } });
  }
  const summary = report.data?.summary;
  const totals = summary?.totals || summary?.by_type?.TOTAL;
  const headline = totals
    ? `Nexcall pull: ${leads.count ?? (leads.data || []).length} leads, ${calls.count ?? (calls.data || []).length} calls. Report totals ${JSON.stringify(totals)}.`
    : `Nexcall pull: ${(leads.data || []).length} leads, ${(calls.data || []).length} calls, ${(followups.data || []).length} follow-ups.`;
  return {
    mode: 'live',
    providerKey: 'nexcall',
    summary: headline.slice(0, 500),
    objects
  };
}
