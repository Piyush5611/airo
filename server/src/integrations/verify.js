import dns from 'node:dns/promises';
import net from 'node:net';
import { ApiError } from '../utils/errors.js';

const WRONG = () => new ApiError(422, 'Wrong API.', 'validation_error');
const SILENT = () => new ApiError(422, 'The API did not respond.', 'validation_error');

export function privateAddress(ip) {
  if (net.isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  const value = ip.toLowerCase();
  if (value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80')) return true;
  if (value.startsWith('::ffff:')) return privateAddress(value.slice(7));
  return false;
}

async function publicHttps(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw WRONG();
  }
  if (url.protocol !== 'https:') throw WRONG();
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw WRONG();
  if (net.isIP(host) && privateAddress(host)) throw WRONG();
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length || records.some((record) => privateAddress(record.address))) throw WRONG();
  return url.toString();
}

async function request(url, headers = {}) {
  try {
    return await fetch(url, {
      headers: { Accept: 'application/json', ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw SILENT();
  }
}

async function googleToken(apiKey) {
  const url = new URL('https://oauth2.googleapis.com/tokeninfo');
  url.searchParams.set('access_token', apiKey);
  const response = await request(url);
  if (!response.ok) throw WRONG();
}

async function metaToken(apiKey) {
  const url = new URL('https://graph.facebook.com/v21.0/me');
  url.searchParams.set('fields', 'id');
  url.searchParams.set('access_token', apiKey);
  const response = await request(url);
  if (!response.ok) throw WRONG();
}

async function bearerCheck(url, apiKey) {
  const response = await request(url, { Authorization: `Bearer ${apiKey}` });
  if (response.status === 401 || response.status === 403) throw WRONG();
  if (!response.ok) throw WRONG();
}

async function suppliedEndpoint(baseUrl, apiKey) {
  const url = await publicHttps(baseUrl);
  const open = await request(url);
  const locked = open.status === 401 || open.status === 403;
  const withBearer = await request(url, { Authorization: `Bearer ${apiKey}` });
  if (withBearer.ok && locked) return;
  const withHeader = await request(url, { 'x-api-key': apiKey });
  if (withHeader.ok && locked) return;
  throw WRONG();
}

const CHECKS = {
  google_ads: googleToken,
  google_analytics: googleToken,
  google_tag_manager: googleToken,
  meta_ads: metaToken,
  linkedin_ads: (apiKey) => bearerCheck('https://api.linkedin.com/v2/userinfo', apiKey),
  hubspot: (apiKey) => bearerCheck('https://api.hubapi.com/account-info/v3/details', apiKey),
  salesforce: (apiKey) => bearerCheck('https://login.salesforce.com/services/oauth2/userinfo', apiKey)
};

export async function verifyProviderKey({ providerKey, apiKey, baseUrl }) {
  if (CHECKS[providerKey]) {
    await CHECKS[providerKey](apiKey);
    return;
  }
  if (!baseUrl) throw WRONG();
  await suppliedEndpoint(baseUrl, apiKey);
}
