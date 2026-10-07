import crypto from 'crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { privateAddress } from '../integrations/verify.js';
import * as offeringRepo from '../repositories/offeringRepo.js';
import * as adsRepo from '../repositories/adsAgentRepo.js';
import { adConnectionFor, sourceForProvider, websiteSource, workspaceId } from '../repositories/connectionRepo.js';
import { addLeadActivity, createLead } from '../repositories/growthRepo.js';
import { phoneDigits } from './adsAgent/leadImport.js';
import { randomToken } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';
import { recordAudit } from './auditService.js';
import { leadScope } from '../utils/scope.js';

const TOKEN = /^[a-f0-9]{64}$/;
const SKIP_KEY = /pass|card|cvv|cvc|otp|nonce|captcha|recaptcha|token|^_/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_content', 'utm_term', 'gclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid', 'fbclid'];
const META_SOURCES = new Set(['facebook', 'fb', 'instagram', 'ig', 'meta', 'messenger', 'audience_network', 'an']);
const GOOGLE_SOURCES = new Set(['google', 'adwords', 'googleads', 'google_ads', 'youtube']);
const PAID = /^(cpc|ppc|paid|paidsearch|paid_search|paid_social|paidsocial|sem|display|ads?|cpm|social_paid|paid-social)$/;
const CHANNEL_NAME = { google: 'Google Ads', meta: 'Meta Ads', website: 'the website' };

function text(value, max = 500) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((item) => text(item, max)).filter(Boolean).join(', ').slice(0, max);
  if (typeof value === 'object') return text(value.value ?? value.raw_value ?? '', max);
  return String(value).replace(/\s+/g, ' ').trim().slice(0, max);
}

export function flattenFields(body) {
  const out = {};
  const source = body && typeof body === 'object' ? body : {};
  const fields = source.fields && typeof source.fields === 'object' && !Array.isArray(source.fields) ? source.fields : null;
  const entries = fields
    ? [...Object.entries(fields).map(([key, value]) => [text(value?.title, 80) || key, value]), ...Object.entries(source).filter(([key]) => key !== 'fields')]
    : Object.entries(source);
  for (const [rawKey, value] of entries) {
    const key = String(rawKey).trim().slice(0, 80);
    if (!key || SKIP_KEY.test(key)) continue;
    const clean = text(value);
    if (clean && !(key in out)) out[key] = clean;
    if (Object.keys(out).length >= 60) break;
  }
  return out;
}

const norm = (key) => key.toLowerCase().replace(/[^a-z]/g, '');

export function pickContact(fields) {
  const rows = Object.entries(fields).filter(([key]) => !ATTRIBUTION_KEYS.includes(key) && !key.startsWith('airo_'));
  const find = (test) => rows.find(([key, value]) => test(norm(key), value))?.[1] || '';
  const phone = find((key, value) => /phone|mobile|tel|whatsapp|contact|number|mob/.test(key) && phoneDigits(value))
    || find((_key, value) => /^\+?[\d\s()-]{10,18}$/.test(value) && phoneDigits(value));
  const email = find((key, value) => key.includes('mail') && EMAIL.test(value)) || find((_key, value) => EMAIL.test(value));
  const first = find((key) => /^(firstname|fname|yourfirstname)$/.test(key));
  const last = find((key) => /^(lastname|lname|surname|yourlastname)$/.test(key));
  const name = find((key) => /^(name|fullname|yourname|names|customername|clientname|contactname)$/.test(key))
    || [first, last].filter(Boolean).join(' ')
    || find((key, value) => key.includes('name') && !/user|company|project|business|file/.test(key) && !EMAIL.test(value));
  const city = find((key) => /city|location|town/.test(key));
  const message = find((key) => /message|comment|query|requirement|enquiry|inquiry|note|details/.test(key));
  return {
    name: name.slice(0, 160),
    phone: phone.slice(0, 32),
    email: (email.match(EMAIL)?.[0] || '').slice(0, 255),
    city: city.slice(0, 80),
    message: message.slice(0, 400)
  };
}

function urlParams(value) {
  try {
    return new URL(String(value)).searchParams;
  } catch {
    return new URLSearchParams();
  }
}

const numericId = (value) => (/^\d{5,20}$/.test(String(value || '')) ? String(value) : '');

export function attribution(fields) {
  const fromPage = [urlParams(fields.airo_landing), urlParams(fields.airo_page)];
  const get = (key) => {
    if (fields[key]) return String(fields[key]);
    for (const params of fromPage) if (params.get(key)) return params.get(key);
    return '';
  };
  const source = get('utm_source').toLowerCase().trim();
  const medium = get('utm_medium').toLowerCase().trim();
  const campaign = get('utm_campaign');
  const google = get('gclid') || get('gbraid') || get('wbraid') || get('gad_campaignid') || get('gad_source')
    || (GOOGLE_SOURCES.has(source) && PAID.test(medium));
  const meta = !google && ((META_SOURCES.has(source) && medium !== 'organic') || (get('fbclid') && !source));
  const channel = google ? 'google' : meta ? 'meta' : 'website';
  const campaignId = channel === 'google'
    ? numericId(get('gad_campaignid')) || numericId(get('utm_id')) || numericId(campaign)
    : channel === 'meta' ? numericId(get('utm_id')) || numericId(campaign) : '';
  return {
    channel,
    campaignId,
    campaignName: campaign && !numericId(campaign) ? campaign.slice(0, 120) : '',
    detail: [source && `source ${source}`, medium && `medium ${medium}`, campaign && `campaign ${campaign.slice(0, 80)}`].filter(Boolean).join(', ')
  };
}

async function sourceFor(organizationId, channel) {
  if (channel === 'google') return sourceForProvider(organizationId, 'Google Ads', 'google_ads');
  if (channel === 'meta') return sourceForProvider(organizationId, 'Meta Ads', 'meta_ads');
  return websiteSource(organizationId);
}

async function campaignFor(organizationId, channel, campaignId) {
  if (!campaignId || channel === 'website') return null;
  const row = await adsRepo.campaignIdByExternal(organizationId, `${channel}:${campaignId}`);
  return row?.id || null;
}

export async function ingestWebsiteForm(token, body) {
  if (!TOKEN.test(String(token || ''))) throw new ApiError(404, 'Unknown form link.', 'not_found');
  const offering = await offeringRepo.byFormToken(token);
  if (!offering?.website) throw new ApiError(404, 'Unknown form link.', 'not_found');
  if (text(body?._gotcha) || text(body?.airo_hp)) return { stored: false };
  const fields = flattenFields(body);
  const contact = pickContact(fields);
  const digits = phoneDigits(contact.phone);
  if (!digits) throw new ApiError(422, 'The form needs a phone number field. Nothing was saved.', 'validation_error');
  const { organizationId } = offering;
  const ws = await workspaceId(organizationId);
  if (!ws) throw new ApiError(422, 'This business has no workspace yet.', 'validation_error');
  const attr = attribution(fields);
  const via = attr.channel === 'website' ? 'the website' : `${CHANNEL_NAME[attr.channel]}${attr.campaignName ? ` (${attr.campaignName})` : ''}`;
  const existing = await adsRepo.leadByPhone(organizationId, digits);
  let leadId;
  let outcome;
  if (existing) {
    leadId = existing.id;
    outcome = 'matched';
    await addLeadActivity({
      organizationId,
      leadId,
      actorUserId: null,
      activityType: 'website_form',
      body: `Filled the website form for ${offering.name.slice(0, 120)} again, via ${via}.${contact.message ? ` Message: ${contact.message.slice(0, 200)}` : ''}`
    });
  } else {
    leadId = await createLead({
      organizationId,
      workspaceId: ws.id,
      sourceId: await sourceFor(organizationId, attr.channel),
      campaignId: await campaignFor(organizationId, attr.channel, attr.campaignId),
      assignedUserId: null,
      fullName: contact.name || 'Website lead',
      phone: contact.phone,
      email: contact.email || null,
      project: offering.name.slice(0, 120),
      city: contact.city || null,
      score: 40,
      intent: 'medium',
      budgetInr: null,
      configuration: null,
      notesSummary: contact.message || null
    });
    outcome = 'created';
    await addLeadActivity({
      organizationId,
      leadId,
      actorUserId: null,
      activityType: 'created',
      body: `Lead came from the website form for ${offering.name.slice(0, 120)}, via ${via}.${attr.detail ? ` Link tags: ${attr.detail}.` : ''}`
    });
  }
  if (attr.channel !== 'website') {
    const providerKey = attr.channel === 'google' ? 'google_ads' : 'meta_ads';
    const connection = await adConnectionFor(organizationId, providerKey, attr.campaignId);
    if (connection) {
      await adsRepo.recordWebsiteImport({
        organizationId,
        connectionId: connection.id,
        platform: attr.channel,
        externalLeadId: `web-${crypto.randomBytes(12).toString('hex')}`,
        leadId,
        campaignExternalId: attr.campaignId,
        outcome
      });
    }
  }
  await offeringRepo.addFormEntry({ organizationId, offeringId: offering.id, leadId, channel: attr.channel, outcome, campaignName: attr.campaignName });
  await offeringRepo.markFormLead(organizationId, offering.id);
  return { stored: true, channel: attr.channel, outcome };
}

const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_SCRIPT_BYTES = 1024 * 1024;
const MAX_SCRIPTS = 8;

async function publicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host)) return privateAddress(host) ? null : url;
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length || records.some((record) => privateAddress(record.address))) return null;
  return url;
}

async function readCapped(response, cap) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8').slice(0, cap);
}

async function fetchPublic(raw, cap) {
  let target = raw;
  for (let hop = 0; hop < 4; hop += 1) {
    const url = await publicUrl(target);
    if (!url) return { blocked: true };
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AIRO-FormCheck/1.0)', Accept: 'text/html,application/javascript,*/*' },
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      return { failed: true };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      target = new URL(response.headers.get('location'), url).toString();
      continue;
    }
    if (!response.ok) return { status: response.status };
    return { url, body: await readCapped(response, cap) };
  }
  return { failed: true };
}

export function scriptSources(html, pageUrl) {
  const out = [];
  for (const match of String(html).matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, '&'), pageUrl);
      if (url.hostname === new URL(pageUrl).hostname && !out.includes(url.toString())) out.push(url.toString());
    } catch {
      // Ignore broken script links.
    }
  }
  return out.slice(0, MAX_SCRIPTS);
}

export function codeState(text, token) {
  if (String(text).includes(token)) return 'found';
  if (/\/api\/forms\/[a-f0-9]{64}/.test(String(text))) return 'old_code';
  return '';
}

const CHECK_MESSAGES = {
  found: 'The AIRO code is on the website.',
  old_code: 'The website has an older AIRO code. Paste the current code again; the old one no longer sends leads.',
  missing: 'The AIRO code was not found on this page. Paste it and save, clear any cache plugin, then check again. If the code is only on another page, put that page link in Website.',
  unreachable: 'The website could not be opened from AIRO. Check that the link works.',
  blocked: 'This link cannot be checked. Use the public https link of the website.'
};

export async function scanWebsite(website, token) {
  const page = await fetchPublic(website, MAX_PAGE_BYTES);
  if (page.blocked) return { status: 'blocked' };
  if (!page.body && page.body !== '') return { status: 'unreachable', httpStatus: page.status || null };
  const direct = codeState(page.body, token);
  if (direct) return { status: direct, where: 'page' };
  for (const src of scriptSources(page.body, page.url)) {
    const script = await fetchPublic(src, MAX_SCRIPT_BYTES);
    const state = script.body ? codeState(script.body, token) : '';
    if (state) return { status: state, where: 'script' };
  }
  return { status: 'missing' };
}

export async function checkWebsiteForm(auth, req, id) {
  const found = await offeringRepo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  if (!found.website || !found.formToken) throw new ApiError(422, 'Create the website form link first.', 'validation_error');
  const result = await scanWebsite(found.website, found.formToken);
  await offeringRepo.setFormCheck(auth.organizationId, id, result.status);
  await recordAudit(req, { action: 'offering.form_link_checked', resource: 'offering', resourceId: id, metadata: { status: result.status } });
  const http = result.httpStatus ? ` (the site answered ${result.httpStatus})` : '';
  return { status: result.status, message: `${CHECK_MESSAGES[result.status]}${http}` };
}

export async function websiteFormLeads(auth, id) {
  const found = await offeringRepo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  const scope = leadScope(auth);
  const items = await offeringRepo.formEntries({
    organizationId: auth.organizationId,
    offeringId: id,
    scopeSql: scope.sql,
    scopeParams: scope.params,
    limit: 200
  });
  return { items };
}

export async function enableWebsiteForm(auth, req, id) {
  const found = await offeringRepo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  if (!found.website) throw new ApiError(422, 'Add the website link first, then create the website form link.', 'validation_error');
  await offeringRepo.setFormToken(auth.organizationId, id, randomToken());
  await recordAudit(req, { action: found.formToken ? 'offering.form_link_renewed' : 'offering.form_link_created', resource: 'offering', resourceId: id });
}

export async function disableWebsiteForm(auth, req, id) {
  const found = await offeringRepo.byId(auth.organizationId, id);
  if (!found) throw new ApiError(404, 'Item not found.', 'not_found');
  await offeringRepo.setFormToken(auth.organizationId, id, null);
  await recordAudit(req, { action: 'offering.form_link_removed', resource: 'offering', resourceId: id });
}
