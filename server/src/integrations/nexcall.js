/**
 * Call Yatri (provider key `nexcall`) is the W-Caller external CRM pull API.
 * Read-only. Auth is x-api-key. Data stays scoped to that key's business.
 */
import https from 'node:https';

export const NEXCALL_BASE = 'https://w-caller.workians.com/api/external';

export const NEXCALL_DESCRIPTION = 'Read-only pull of Call Yatri leads, calls, the call report, and follow-ups. Authenticate with x-api-key.';

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

export function nexcallBase(value) {
  const fallback = NEXCALL_BASE.replace(/\/$/, '');
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (url.hostname.toLowerCase() === 'w-caller.workians.com') return fallback;
  } catch {
    return fallback;
  }
  return raw.replace(/\/$/, '');
}

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

function pull(baseUrl, path, apiKey, timeoutMs = 15000) {
  const url = new URL(`${baseUrl}${path}`);
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    const finish = (error, body) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(body);
    };
    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        Accept: 'application/json',
        Connection: 'close'
      },
      ALPNProtocols: ['http/1.1'],
      servername: url.hostname,
      family: 4,
      autoSelectFamily: false,
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let body = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
        const status = response.statusCode || 0;
        if (status < 200 || status >= 300 || body.success === false) {
          const error = new Error(body.message || body.error || 'Call Yatri rejected the request.');
          error.code = 'nexcall_rejected';
          error.status = status;
          finish(error);
          return;
        }
        finish(null, body);
      });
    });
    req.on('timeout', () => {
      timedOut = true;
      req.destroy();
      const error = new Error(`Call Yatri did not respond on ${url.pathname}.`);
      error.code = 'nexcall_unreachable';
      const cause = new Error('timeout');
      cause.name = 'TimeoutError';
      cause.code = 23;
      error.cause = cause;
      finish(error);
    });
    req.on('error', (cause) => {
      if (timedOut) return;
      const error = new Error('Call Yatri did not respond.');
      error.code = 'nexcall_unreachable';
      error.cause = cause;
      finish(error);
    });
    req.end();
  });
}

export async function nexcallLeads({ apiKey, baseUrl = NEXCALL_BASE, from, to, phone, search, page, limit }) {
  const base = nexcallBase(baseUrl);
  return pull(base, `/leads?${qs({ from, to, phone, search, page, limit })}`, apiKey, 60000);
}

export async function nexcallFollowups({ apiKey, baseUrl = NEXCALL_BASE, from, to, page, limit }) {
  const base = nexcallBase(baseUrl);
  return pull(base, `/followups?${qs({ from, to, page, limit })}`, apiKey, 60000);
}

function qs(entries) {
  return Object.entries(entries)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join('&');
}

export async function nexcallCalls({ apiKey, baseUrl = NEXCALL_BASE, from, to, userId, callStatus, phone, page, limit }) {
  const base = nexcallBase(baseUrl);
  return pull(base, `/calls?${qs({ from, to, user_id: userId, call_status: callStatus, phone, page, limit })}`, apiKey, 60000);
}

export async function nexcallCallReport({ apiKey, baseUrl = NEXCALL_BASE, from, to, userId, callType }) {
  const base = nexcallBase(baseUrl);
  return pull(base, `/reports/calls?${qs({ from, to, user_id: userId, call_type: callType })}`, apiKey, 60000);
}

function istDay() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day = String(ist.getUTCDate()).padStart(2, '0');
  return `${ist.getUTCFullYear()}-${month}-${day}`;
}

export async function verifyNexcall({ apiKey, baseUrl = NEXCALL_BASE }) {
  const base = nexcallBase(baseUrl);
  const day = istDay();
  await pull(base, `/calls?${qs({ from: `${day} 00:00:00`, to: `${day} 23:59:59`, page: 1, limit: 1 })}`, cleanNexcallKey(apiKey));
}

export async function pullNexcall({ apiKey, baseUrl = NEXCALL_BASE }) {
  const base = String(baseUrl || NEXCALL_BASE).replace(/\/$/, '');
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const report = await pull(base, `/reports/calls?${qs({ from: stamp(start), to: stamp(end) })}`, apiKey, 60000);
  const summary = report.data?.summary;
  const totals = summary?.totals || summary?.by_type?.TOTAL;
  const headline = totals
    ? `Call Yatri is reachable. Last 7 days: ${totals.total_calls ?? 0} calls, ${totals.connected_calls ?? 0} connected.`
    : 'Call Yatri is reachable. The call report returned no totals.';
  return {
    mode: 'live',
    providerKey: 'nexcall',
    summary: `${headline} Call data is read live and not stored in AIRO.`,
    warnings: [],
    replaceTypes: ['lead', 'call', 'followup', 'report'],
    objects: []
  };
}
