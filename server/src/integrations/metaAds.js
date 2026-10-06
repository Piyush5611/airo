import { env } from '../config/env.js';
import { ApiError } from '../utils/errors.js';

const VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const LOGIN_SCOPES = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'leads_retrieval'];
const OFFSET = { JPY: 1, KRW: 1, VND: 1, CLP: 1, ISK: 1, PYG: 1 };

const OBJECTIVES = ['OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_SALES', 'OUTCOME_ENGAGEMENT'];

// Meta does not allow OUTCOME_LEADS with destination MESSENGER; click-to-Messenger runs under Engagement.
export function campaignObjective(objective, conversion) {
  if (objective === 'OUTCOME_LEADS' && conversion === 'messenger') return 'OUTCOME_ENGAGEMENT';
  return objective;
}

function quiet() {
  return new ApiError(422, 'The API did not respond.', 'validation_error');
}

function metaError(data) {
  const error = data?.error || {};
  const detail = String(error.error_user_msg || error.error_user_title || '').trim();
  const base = String(error.message || 'Meta Ads rejected the request.').trim();
  const blame = Array.isArray(error.error_data?.blame_field_specs)
    ? error.error_data.blame_field_specs.flat().filter((item) => typeof item === 'string').slice(0, 4).join(', ')
    : '';
  const message = [detail || base, blame ? `Field: ${blame}` : '']
    .filter(Boolean)
    .join(' ')
    .replace(/access_token=[^&\s]+/gi, '')
    .replace(/EAA[A-Za-z0-9]+/g, '')
    .slice(0, 240);
  return new ApiError(422, message || 'Meta Ads rejected the request.', 'validation_error');
}

export function actId(accountId) {
  const raw = String(accountId || '').trim().replace(/^act_/i, '');
  if (!/^\d{5,20}$/.test(raw)) {
    throw new ApiError(422, 'Account id must look like act_123456789.', 'validation_error');
  }
  return raw;
}

async function graph(path, token, params = {}, method = 'GET') {
  const url = new URL(path.startsWith('https://') ? path : `${GRAPH}/${path}`);
  if (url.protocol !== 'https:' || url.hostname !== 'graph.facebook.com') throw quiet();
  const body = new URLSearchParams();
  if (method === 'GET') {
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  } else {
    for (const [key, value] of Object.entries(params)) body.set(key, String(value));
    body.set('access_token', token);
  }
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: method === 'GET'
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : body,
      redirect: 'manual',
      signal: AbortSignal.timeout(20000)
    });
  } catch {
    throw quiet();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw metaError(data);
  return data;
}

async function list(path, token, params) {
  const rows = [];
  let page = await graph(path, token, { limit: '50', ...params });
  rows.push(...(page.data || []));
  let guard = 0;
  while (page.paging?.next && rows.length < 200 && guard < 4) {
    page = await graph(page.paging.next, token);
    rows.push(...(page.data || []));
    guard += 1;
  }
  return rows;
}

function major(minor, currency) {
  if (minor == null || minor === '') return null;
  const amount = Number(minor) / (OFFSET[currency] || 100);
  if (!Number.isFinite(amount)) return null;
  return amount.toFixed(2);
}

function leads(actions) {
  if (!Array.isArray(actions)) return null;
  const hit = actions.find((item) => /lead/i.test(String(item.action_type || '')));
  if (!hit || hit.value == null) return null;
  return String(hit.value);
}

function fragmentValues(fragment) {
  if (!fragment?.values) return {};
  if (typeof fragment.values === 'object') return fragment.values;
  try {
    return JSON.parse(fragment.values);
  } catch {
    return {};
  }
}

function isCampaignFragment(fragment) {
  const type = String(fragment.ad_object_type || fragment.type || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (!type) return true;
  if (type.includes('adset') || type === 'ad' || type.endsWith('_ad')) return false;
  return type === 'campaign' || type.endsWith('_campaign') || type.includes('campaign');
}

function collectDraftNames(value, depth, found) {
  if (depth > 6 || found.length > 40 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectDraftNames(item, depth + 1, found));
    return;
  }
  const type = String(value.ad_object_type || value.object_type || value.type || '').toLowerCase();
  const name = value.ad_object_name || value.campaign_name || value.name;
  const looksLikeCampaign = type.includes('campaign') || value.objective || value.daily_budget || value.lifetime_budget;
  const blocked = type.includes('adset') || type === 'ad';
  if (!blocked && looksLikeCampaign && typeof name === 'string' && name.trim()) {
    found.push({
      id: value.ad_object_id || value.id || '',
      name: name.trim(),
      objective: value.objective || '',
      budget: value.daily_budget || value.lifetime_budget || ''
    });
  }
  for (const nested of Object.values(value)) collectDraftNames(nested, depth + 1, found);
}

function draftObject(externalId, name, currency, extra = {}) {
  return {
    type: 'campaign',
    externalId: String(externalId).slice(0, 80),
    name: String(name).slice(0, 180),
    parent: null,
    payload: {
      origin: 'api',
      status: 'DRAFT',
      delivery: 'IN_DRAFT',
      objective: extra.objective || '',
      budget: major(extra.budget, currency),
      budgetKind: extra.budget ? 'daily' : '',
      currency,
      spend: null,
      impressions: null,
      clicks: null,
      reach: null,
      leads: null
    }
  };
}

async function draftCampaigns(act, token, publishedIds, publishedNames, currency) {
  let drafts = [];
  try {
    drafts = await list(`act_${act}/addrafts`, token, { fields: 'id,name,is_active,summary' });
  } catch (error) {
    return { objects: [], note: error.message };
  }
  const seenIds = new Set(publishedIds.map(String));
  const seenNames = new Set(publishedNames.map((name) => String(name).trim().toLowerCase()));
  const objects = [];
  function add(externalId, name, extra) {
    const label = String(name || '').trim();
    const id = String(externalId || '').trim();
    if (!label || seenIds.has(id) || seenNames.has(label.toLowerCase())) return;
    seenNames.add(label.toLowerCase());
    if (id) seenIds.add(id);
    objects.push(draftObject(id || `draft-${objects.length + 1}`, label, currency, extra));
  }
  for (const draft of drafts) {
    if (draft.is_active === false) continue;
    let detail = {};
    try {
      detail = await graph(String(draft.id), token, { fields: 'id,name,state,summary' });
    } catch {
      detail = {};
    }
    const found = [];
    collectDraftNames(fragmentValues({ values: detail.state }), 0, found);
    collectDraftNames(fragmentValues({ values: detail.summary || draft.summary }), 0, found);
    let fragments = [];
    try {
      fragments = await list(`${draft.id}/addraft_fragments`, token, {
        fields: 'id,name,ad_object_id,ad_object_type,ad_object_name,values'
      });
    } catch {
      fragments = [];
    }
    for (const fragment of fragments.filter(isCampaignFragment)) {
      const values = fragmentValues(fragment);
      found.push({
        id: fragment.ad_object_id || fragment.id,
        name: fragment.ad_object_name || values.name || fragment.name,
        objective: values.objective || '',
        budget: values.daily_budget || values.lifetime_budget || ''
      });
    }
    if (found.length) {
      for (const item of found) add(item.id, item.name, item);
    } else {
      add(draft.id, detail.name || draft.name || detail.summary || draft.summary);
    }
  }
  return { objects, note: '' };
}

export function metaLoginSetup() {
  const settings = env.metaLogin;
  const redirectUri = settings.redirectUri || `${env.clientOrigin.replace(/\/$/, '')}/api/meta-ads/callback`;
  return { ready: Boolean(settings.appId && settings.appSecret), redirectUri };
}

function loginConfig() {
  const setup = metaLoginSetup();
  if (!setup.ready) throw new ApiError(422, 'Connect with Facebook is not set up on this server yet.', 'validation_error');
  return { ...env.metaLogin, redirectUri: setup.redirectUri };
}

export function metaAuthUrl(state) {
  const settings = loginConfig();
  const url = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', settings.appId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (settings.configId) url.searchParams.set('config_id', settings.configId);
  else url.searchParams.set('scope', LOGIN_SCOPES.join(','));
  return url.toString();
}

async function oauthGet(path, params) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch {
    throw quiet();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = String(data?.error?.message || '').replace(/EAA[A-Za-z0-9]+/g, '').trim().slice(0, 160);
    throw new ApiError(422, reason ? `Facebook sign-in failed. ${reason}` : 'Facebook sign-in failed.', 'validation_error');
  }
  return data;
}

async function tokenExpiry(token, settings) {
  try {
    const data = await oauthGet('debug_token', { input_token: token, access_token: `${settings.appId}|${settings.appSecret}` });
    const expires = Number(data?.data?.expires_at);
    if (data?.data?.is_valid === false) return { valid: false, expiresAt: null };
    return { valid: true, expiresAt: expires > 0 ? new Date(expires * 1000).toISOString() : null };
  } catch {
    return { valid: true, expiresAt: undefined };
  }
}

export async function exchangeMetaCode(code) {
  const settings = loginConfig();
  const first = await oauthGet('oauth/access_token', {
    client_id: settings.appId,
    client_secret: settings.appSecret,
    redirect_uri: settings.redirectUri,
    code
  });
  if (!first.access_token) throw new ApiError(422, 'Facebook did not return access.', 'validation_error');
  let token = first.access_token;
  let info = await tokenExpiry(token, settings);
  if (!info.valid) throw new ApiError(422, 'Facebook returned an invalid token. Connect again.', 'validation_error');
  if (info.expiresAt !== null) {
    try {
      const long = await oauthGet('oauth/access_token', {
        grant_type: 'fb_exchange_token',
        client_id: settings.appId,
        client_secret: settings.appSecret,
        fb_exchange_token: token
      });
      if (long.access_token) {
        token = long.access_token;
        info = await tokenExpiry(token, settings);
      }
    } catch {
      // Keep the first token; it still works until it expires.
    }
  }
  return { token, expiresAt: info.expiresAt || null };
}

async function grantedScopes(token) {
  const settings = env.metaLogin;
  if (!settings.appId || !settings.appSecret) return null;
  try {
    const data = await oauthGet('debug_token', { input_token: token, access_token: `${settings.appId}|${settings.appSecret}` });
    return Array.isArray(data?.data?.scopes) ? data.data.scopes : null;
  } catch {
    return null;
  }
}

async function missingAdScopes(token, error) {
  const scopes = await grantedScopes(token);
  if (!scopes) return error;
  const missing = ['ads_read', 'ads_management', 'business_management'].filter((scope) => !scopes.includes(scope));
  if (!missing.length) return error;
  return new ApiError(
    422,
    `Facebook did not give AIRO these permissions: ${missing.join(', ')}. Connect again, allow every permission, and pick the ad account and Page when Facebook asks.`,
    'validation_error'
  );
}

export async function listMetaAdAccounts({ apiKey }) {
  let rows;
  try {
    rows = await list('me/adaccounts', apiKey, { fields: 'id,account_id,name,currency,account_status,business{name}' });
  } catch {
    try {
      rows = await list('me/adaccounts', apiKey, { fields: 'id,account_id,name,currency,account_status' });
    } catch (error) {
      throw await missingAdScopes(apiKey, error);
    }
  }
  return rows
    .filter((row) => /^\d{5,20}$/.test(String(row.account_id || '')))
    .map((row) => ({
      id: `act_${row.account_id}`,
      name: String(row.name || `Ad account ${row.account_id}`).slice(0, 160),
      currency: row.currency || '',
      active: Number(row.account_status) === 1,
      business: String(row.business?.name || '').slice(0, 160)
    }));
}

export async function verifyMetaAccount({ apiKey, accountId }) {
  try {
    await graph(`act_${actId(accountId)}`, apiKey, { fields: 'id,name,currency' });
  } catch (error) {
    if (error.message === 'The API did not respond.') throw error;
    if (error.message.startsWith('Account id must look like')) throw error;
    const reason = String(error.message || '')
      .replace(/access_token=[^&\s]+/gi, '')
      .replace(/EAA[A-Za-z0-9]+/g, '')
      .trim()
      .slice(0, 180);
    throw new ApiError(422, reason ? `Wrong API. ${reason}` : 'Wrong API.', 'validation_error');
  }
}

const REPORT_PRESETS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS: 'last_7d',
  LAST_14_DAYS: 'last_14d',
  LAST_30_DAYS: 'last_30d',
  THIS_MONTH: 'this_month',
  LAST_MONTH: 'last_month'
};

function insightRow(row = {}) {
  return {
    spend: row.spend == null ? '0' : Number(row.spend).toFixed(2),
    impressions: String(Number(row.impressions || 0)),
    clicks: String(Number(row.clicks || 0)),
    reach: row.reach == null ? null : String(Number(row.reach || 0)),
    leads: leads(row.actions) || '0'
  };
}

export async function metaReport({ apiKey, accountId }, range) {
  const preset = REPORT_PRESETS[range];
  if (!preset) throw new ApiError(422, 'Choose a report range.', 'validation_error');
  const act = actId(accountId);
  const base = { date_preset: preset, fields: 'spend,impressions,clicks,reach,actions' };
  const queries = {
    daily: { ...base, level: 'account', time_increment: '1' },
    campaigns: { date_preset: preset, level: 'campaign', fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions' },
    platforms: { date_preset: preset, level: 'account', breakdowns: 'publisher_platform', fields: 'spend,impressions,clicks,actions' },
    audience: { date_preset: preset, level: 'account', breakdowns: 'age,gender', fields: 'spend,impressions,clicks,actions' }
  };
  const keys = Object.keys(queries);
  const [account, ...settled] = await Promise.allSettled([
    graph(`act_${act}`, apiKey, { fields: 'currency' }),
    ...keys.map((key) => list(`act_${act}/insights`, apiKey, queries[key]))
  ]);
  const result = { range, currency: account.status === 'fulfilled' ? account.value.currency || '' : '', notes: [] };
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') result.notes.push(`${keys[index]}: ${outcome.reason?.message || 'failed'}`);
  });
  const rows = (index) => (settled[index].status === 'fulfilled' ? settled[index].value : []);
  result.daily = rows(0)
    .map((row) => ({ date: row.date_start || '', ...insightRow(row) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  result.campaigns = rows(1)
    .map((row) => ({ id: String(row.campaign_id || ''), name: String(row.campaign_name || ''), ...insightRow(row) }))
    .sort((a, b) => Number(b.spend) - Number(a.spend));
  result.platforms = rows(2).map((row) => ({ name: String(row.publisher_platform || 'unknown'), ...insightRow(row) }));
  result.audience = rows(3).map((row) => ({ age: String(row.age || ''), gender: String(row.gender || ''), ...insightRow(row) }));
  return result;
}

export async function metaDailyStats({ apiKey, accountId }, range = 'LAST_7_DAYS') {
  const preset = REPORT_PRESETS[range];
  if (!preset) throw new ApiError(422, 'Choose a report range.', 'validation_error');
  const act = actId(accountId);
  const [account, rows] = await Promise.all([
    graph(`act_${act}`, apiKey, { fields: 'currency' }).catch(() => ({})),
    list(`act_${act}/insights`, apiKey, {
      date_preset: preset,
      level: 'campaign',
      time_increment: '1',
      fields: 'campaign_id,campaign_name,spend,impressions,clicks,actions'
    })
  ]);
  return {
    currency: account.currency || '',
    rows: rows
      .map((row) => ({ date: row.date_start || '', id: String(row.campaign_id || ''), name: String(row.campaign_name || ''), ...insightRow(row) }))
      .filter((row) => row.id && row.date)
  };
}

export async function metaAdDailyStats({ apiKey, accountId }, range = 'LAST_7_DAYS') {
  const preset = REPORT_PRESETS[range];
  if (!preset) throw new ApiError(422, 'Choose a report range.', 'validation_error');
  const act = actId(accountId);
  const found = [];
  let page = await graph(`act_${act}/insights`, apiKey, {
    date_preset: preset,
    level: 'ad',
    time_increment: '1',
    limit: '500',
    fields: 'ad_id,ad_name,adset_id,campaign_id,spend,impressions,clicks,actions'
  });
  found.push(...(page.data || []));
  for (let guard = 0; page.paging?.next && guard < 10; guard += 1) {
    page = await graph(page.paging.next, apiKey);
    found.push(...(page.data || []));
  }
  return found
    .map((row) => ({
      date: row.date_start || '',
      id: String(row.ad_id || ''),
      name: String(row.ad_name || ''),
      campaignId: String(row.campaign_id || ''),
      adsetId: String(row.adset_id || ''),
      ...insightRow(row)
    }))
    .filter((row) => row.id && row.date);
}

function creativeOf(creative = {}) {
  const spec = creative.object_story_spec || {};
  const link = spec.link_data || {};
  const video = spec.video_data || {};
  const cta = link.call_to_action?.type || video.call_to_action?.type || creative.call_to_action_type || '';
  return {
    editable: Boolean(spec.link_data || spec.video_data),
    leadForm: Boolean(link.call_to_action?.value?.lead_gen_form_id),
    headline: String(creative.title || link.name || video.title || '').slice(0, 200),
    text: String(creative.body || link.message || video.message || '').slice(0, 1000),
    link: String(link.link || video.call_to_action?.value?.link || '').slice(0, 500),
    image: String(creative.image_url || link.picture || creative.thumbnail_url || video.image_url || '').slice(0, 1000),
    cta: String(cta)
  };
}

function targetingOf(targeting = {}) {
  const geo = targeting.geo_locations || {};
  const places = [
    ...(geo.cities || []).map((item) => item.name),
    ...(geo.regions || []).map((item) => item.name),
    ...(geo.countries || [])
  ].filter(Boolean);
  const genders = Array.isArray(targeting.genders) && targeting.genders.length === 1 ? (targeting.genders[0] === 1 ? 'Men' : 'Women') : 'All';
  const interests = (targeting.flexible_spec || []).flatMap((item) => item.interests || []).map((item) => item.name).filter(Boolean);
  return {
    age: targeting.age_min || targeting.age_max ? `${targeting.age_min || 18}–${targeting.age_max || 65}` : '',
    gender: genders,
    places: places.slice(0, 12),
    interests: interests.slice(0, 12),
    advantage: targeting.targeting_automation?.advantage_audience === 1,
    edit: {
      ageMin: targeting.age_min || 18,
      ageMax: targeting.age_max || 65,
      gender: genders === 'Men' ? 'men' : genders === 'Women' ? 'women' : 'all',
      cities: (geo.cities || []).map((item) => ({
        key: String(item.key),
        name: String(item.name || item.key),
        radius: item.radius || 0,
        distanceUnit: item.distance_unit || 'kilometer'
      })),
      otherPlaces: [...(geo.regions || []).map((item) => item.name), ...(geo.countries || [])].filter(Boolean),
      interests: (targeting.flexible_spec || []).flatMap((item) => item.interests || []).map((item) => ({ id: String(item.id), name: String(item.name || item.id) }))
    }
  };
}

export async function metaCampaignDetail({ apiKey, accountId }, campaignId, range) {
  const preset = REPORT_PRESETS[range];
  if (!preset) throw new ApiError(422, 'Choose a report range.', 'validation_error');
  const act = actId(accountId);
  const id = String(campaignId || '').trim();
  if (!/^\d{5,25}$/.test(id)) throw new ApiError(422, 'Unknown Meta campaign.', 'validation_error');
  const campaign = await graph(id, apiKey, {
    fields: 'id,name,account_id,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,special_ad_categories'
  });
  if (String(campaign.account_id || '') !== act) throw new ApiError(404, 'This campaign is not in the connected ad account.', 'not_found');
  const account = await graph(`act_${act}`, apiKey, { fields: 'currency' }).catch(() => ({}));
  const currency = account.currency || '';
  const stats = 'spend,impressions,clicks,reach,actions';
  const parts = {
    adsets: list(`${id}/adsets`, apiKey, { fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,end_time,optimization_goal,billing_event,destination_type,targeting' }),
    ads: list(`${id}/ads`, apiKey, { fields: 'id,name,status,effective_status,adset_id,creative{id,title,body,image_url,thumbnail_url,call_to_action_type,object_story_spec}' }),
    daily: list(`${id}/insights`, apiKey, { date_preset: preset, time_increment: '1', fields: stats }),
    adsetStats: list(`${id}/insights`, apiKey, { date_preset: preset, level: 'adset', fields: `adset_id,${stats}` }),
    adStats: list(`${id}/insights`, apiKey, { date_preset: preset, level: 'ad', fields: `ad_id,${stats}` })
  };
  const keys = Object.keys(parts);
  const settled = await Promise.allSettled(Object.values(parts));
  const pick = (key) => {
    const outcome = settled[keys.indexOf(key)];
    return outcome.status === 'fulfilled' ? outcome.value : [];
  };
  const notes = settled
    .map((outcome, index) => (outcome.status === 'rejected' ? `${keys[index]}: ${outcome.reason?.message || 'failed'}` : null))
    .filter(Boolean);
  const adsetStats = new Map(pick('adsetStats').map((row) => [String(row.adset_id), row]));
  const adStats = new Map(pick('adStats').map((row) => [String(row.ad_id), row]));
  return {
    range,
    currency,
    notes,
    campaign: {
      id,
      name: String(campaign.name || ''),
      status: campaign.status || '',
      delivery: campaign.effective_status || '',
      objective: campaign.objective || '',
      budget: major(campaign.daily_budget || campaign.lifetime_budget, currency),
      budgetKind: campaign.daily_budget ? 'daily' : campaign.lifetime_budget ? 'lifetime' : '',
      startTime: campaign.start_time || campaign.created_time || '',
      stopTime: campaign.stop_time || '',
      specialCategories: Array.isArray(campaign.special_ad_categories) ? campaign.special_ad_categories : []
    },
    daily: pick('daily').map((row) => ({ date: row.date_start || '', ...insightRow(row) })).sort((a, b) => a.date.localeCompare(b.date)),
    adsets: pick('adsets').map((row) => ({
      id: String(row.id),
      name: String(row.name || ''),
      status: row.status || '',
      delivery: row.effective_status || '',
      budget: major(row.daily_budget || row.lifetime_budget, currency),
      budgetKind: row.daily_budget ? 'daily' : row.lifetime_budget ? 'lifetime' : '',
      endTime: row.end_time || '',
      goal: row.optimization_goal || '',
      destination: row.destination_type || '',
      targeting: targetingOf(row.targeting),
      ...insightRow(adsetStats.get(String(row.id)))
    })),
    ads: pick('ads').map((row) => ({
      id: String(row.id),
      adsetId: String(row.adset_id || ''),
      name: String(row.name || ''),
      status: row.status || '',
      delivery: row.effective_status || '',
      creative: creativeOf(row.creative),
      ...insightRow(adStats.get(String(row.id)))
    }))
  };
}

export async function metaCampaignList({ apiKey, accountId }) {
  const rows = await list(`act_${actId(accountId)}/campaigns`, apiKey, { fields: 'id,name,status,effective_status,objective' });
  return rows.map((row) => ({
    id: String(row.id || ''),
    name: String(row.name || 'Campaign').slice(0, 120),
    status: String(row.status || ''),
    delivery: String(row.effective_status || ''),
    objective: String(row.objective || '')
  })).filter((row) => row.status !== 'DELETED' && row.status !== 'ARCHIVED');
}

export async function pullMetaAds({ apiKey, accountId }) {
  const act = actId(accountId);
  const account = await graph(`act_${act}`, apiKey, { fields: 'id,name,currency' });
  const currency = account.currency || '';
  const [campaigns, adsets, ads] = await Promise.all([
    list(`act_${act}/campaigns`, apiKey, {
      fields: 'id,name,status,effective_status,objective,daily_budget,lifetime_budget'
    }),
    list(`act_${act}/adsets`, apiKey, {
      fields: 'id,name,status,effective_status,campaign_id,daily_budget'
    }),
    list(`act_${act}/ads`, apiKey, {
      fields: 'id,name,status,effective_status,campaign_id,adset_id'
    })
  ]);
  let insights = [];
  let insightNote = '';
  try {
    insights = await list(`act_${act}/insights`, apiKey, {
      level: 'campaign',
      date_preset: 'last_30d',
      fields: 'campaign_id,spend,impressions,clicks,reach,actions'
    });
  } catch (error) {
    insightNote = error.message;
  }
  const byCampaign = new Map(insights.map((row) => [String(row.campaign_id), row]));
  const draftResult = await draftCampaigns(
    act,
    apiKey,
    campaigns.map((row) => row.id),
    campaigns.map((row) => row.name),
    currency
  );
  const drafts = draftResult.objects;
  const objects = [
    ...campaigns.map((row) => {
      const insight = byCampaign.get(String(row.id));
      const budget = major(row.daily_budget || row.lifetime_budget, currency);
      return {
        type: 'campaign',
        externalId: String(row.id),
        name: String(row.name || 'Campaign').slice(0, 180),
        parent: null,
        payload: {
          origin: 'api',
          status: row.status || '',
          delivery: row.effective_status || '',
          objective: row.objective || '',
          budget,
          budgetKind: row.daily_budget ? 'daily' : row.lifetime_budget ? 'lifetime' : '',
          currency,
          spend: insight?.spend ?? null,
          impressions: insight?.impressions ?? null,
          clicks: insight?.clicks ?? null,
          reach: insight?.reach ?? null,
          leads: insight ? leads(insight.actions) : null
        }
      };
    }),
    ...drafts,
    ...adsets.map((row) => ({
      type: 'adset',
      externalId: String(row.id),
      name: String(row.name || 'Ad set').slice(0, 180),
      parent: row.campaign_id ? String(row.campaign_id) : null,
      payload: {
        origin: 'api',
        status: row.status || '',
        delivery: row.effective_status || '',
        budget: major(row.daily_budget, currency),
        currency
      }
    })),
    ...ads.map((row) => ({
      type: 'ad',
      externalId: String(row.id),
      name: String(row.name || 'Ad').slice(0, 180),
      parent: row.adset_id ? String(row.adset_id) : null,
      payload: {
        origin: 'api',
        status: row.status || '',
        delivery: row.effective_status || '',
        campaignId: row.campaign_id ? String(row.campaign_id) : ''
      }
    }))
  ];
  const draftNote = draftResult.note ? ` Drafts were not returned: ${draftResult.note}` : '';
  const summary = insightNote
    ? `Meta returned ${campaigns.length} campaigns and ${drafts.length} drafts. Report failed: ${insightNote}${draftNote}`
    : `Meta returned ${campaigns.length} campaigns and ${drafts.length} drafts.${draftNote}`;
  return {
    mode: 'live',
    providerKey: 'meta_ads',
    summary: summary.slice(0, 250),
    replaceTypes: ['campaign', 'adset', 'ad'],
    objects
  };
}

export async function createMetaCampaign({ apiKey, accountId, name, objective: chosen, conversion, dailyBudget, status, specialCategory }) {
  const objective = campaignObjective(chosen, conversion);
  if (!OBJECTIVES.includes(objective)) {
    throw new ApiError(422, 'Choose a Meta campaign objective.', 'validation_error');
  }
  const act = actId(accountId);
  const account = await graph(`act_${act}`, apiKey, { fields: 'currency' });
  const offset = OFFSET[account.currency] || 100;
  const budget = Math.round(Number(dailyBudget) * offset);
  if (!Number.isFinite(budget) || budget < 1) {
    throw new ApiError(422, 'Enter a daily budget.', 'validation_error');
  }
  const allowedCategory = ['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'];
  const created = await graph(`act_${act}/campaigns`, apiKey, {
    name: String(name).slice(0, 180),
    objective,
    status: status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
    special_ad_categories: JSON.stringify(allowedCategory.includes(specialCategory) ? [specialCategory] : []),
    daily_budget: String(budget),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP'
  }, 'POST');
  if (!created.id) throw new ApiError(422, 'Meta Ads did not return a campaign.', 'validation_error');
  return { id: String(created.id), currency: account.currency || '' };
}

export async function createMetaAdSet({ apiKey, accountId, campaignId, name, objective, pageId, conversion, ...input }) {
  if (!/^\d{5,20}$/.test(String(campaignId || ''))) {
    throw new ApiError(422, 'Unknown Meta campaign.', 'validation_error');
  }
  const plan = deliveryPlan(objective, conversion || '', input.pixelId || '');
  const adsetParams = {
    name: `${String(name || 'Meta ad').slice(0, 150)} ad set`.slice(0, 180),
    campaign_id: String(campaignId),
    billing_event: 'IMPRESSIONS',
    optimization_goal: plan.goal,
    destination_type: plan.destination,
    targeting: JSON.stringify(targetingFor({ ...input, advantageAudience: input.advantageAudience !== false })),
    status: 'PAUSED'
  };
  if ((plan.lead || plan.messenger) && pageId) {
    adsetParams.promoted_object = JSON.stringify({ page_id: pageId });
  }
  const adset = await graph(`act_${actId(accountId)}/adsets`, apiKey, adsetParams, 'POST');
  if (!adset.id) throw new ApiError(422, 'Meta Ads did not return an ad set.', 'validation_error');
  return { adsetId: String(adset.id) };
}

export async function addMetaImageAd({ apiKey, accountId, adsetId, name, objective, pageId, headline, message, link, imageBase64, conversion, cta }) {
  if (!/^\d{5,20}$/.test(String(adsetId || ''))) {
    throw new ApiError(422, 'Unknown Meta ad set.', 'validation_error');
  }
  const plan = deliveryPlan(objective, conversion || '', '');
  let website;
  try { website = new URL(link); } catch { throw new ApiError(422, 'Enter a valid website link.', 'validation_error'); }
  if (website.protocol !== 'https:') throw new ApiError(422, 'The website link must start with https.', 'validation_error');
  const act = actId(accountId);
  const bytes = imageBytes(imageBase64);
  const pageToken = await pageAccessToken(apiKey, pageId);
  const imageHash = await uploadImage(act, apiKey, bytes);
  const formId = plan.lead ? await createLeadForm(pageId, pageToken, name, website.toString()) : '';
  const creativeId = await makeCreative(act, apiKey, { website, pageId, name, headline, message, cta }, imageHash, formId, plan);
  const adId = await makeAd(act, apiKey, `${name} ad`, adsetId, creativeId);
  return { adId };
}

export async function setMetaCampaignStatus({ apiKey, campaignId, status }) {
  if (!/^\d{5,20}$/.test(String(campaignId || ''))) {
    throw new ApiError(422, 'Unknown Meta campaign.', 'validation_error');
  }
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    throw new ApiError(422, 'Status must be active or paused.', 'validation_error');
  }
  await graph(String(campaignId), apiKey, { status }, 'POST');
  if (status !== 'ACTIVE') return;
  const adsets = await list(`${campaignId}/adsets`, apiKey, { fields: 'id,status' });
  for (const adset of adsets) {
    if (adset.status !== 'ACTIVE') await graph(String(adset.id), apiKey, { status: 'ACTIVE' }, 'POST');
    const ads = await list(`${adset.id}/ads`, apiKey, { fields: 'id,status' });
    for (const ad of ads) {
      if (ad.status !== 'ACTIVE') await graph(String(ad.id), apiKey, { status: 'ACTIVE' }, 'POST');
    }
  }
}

async function safeList(path, apiKey, params) {
  try {
    return await list(path, apiKey, params);
  } catch {
    return [];
  }
}

async function readEdge(path, apiKey, params = {}) {
  try {
    const rows = [];
    let page = await graph(path, apiKey, params);
    rows.push(...(Array.isArray(page.data) ? page.data : []));
    let guard = 0;
    while (page.paging?.next && rows.length < 100 && guard < 3) {
      page = await graph(page.paging.next, apiKey);
      rows.push(...(page.data || []));
      guard += 1;
    }
    return { rows, error: '' };
  } catch (error) {
    return {
      rows: [],
      error: String(error.message || '').replace(/access_token=[^&\s]+/gi, '').slice(0, 200)
    };
  }
}

function rememberPages(found, rows) {
  for (const row of rows || []) {
    const id = String(row.id || '');
    if (!/^\d{5,20}$/.test(id)) continue;
    const name = String(row.name || row.global_brand_page_name || '').trim().slice(0, 180);
    const current = found.get(id);
    if (!current) found.set(id, { id, name });
    else if (name && !current.name) found.set(id, { id, name });
  }
}

async function fillPageNames(apiKey, found) {
  const missing = [...found.values()].filter((page) => !page.name);
  if (!missing.length) return;
  try {
    const data = await graph(`${GRAPH}/`, apiKey, {
      ids: missing.map((page) => page.id).join(','),
      fields: 'id,name'
    });
    for (const page of missing) {
      const name = String(data?.[page.id]?.name || '').trim().slice(0, 180);
      if (name) found.set(page.id, { id: page.id, name });
    }
  } catch {
    // The id is still enough to show the Page.
  }
  for (const page of found.values()) {
    if (!page.name) found.set(page.id, { id: page.id, name: `Page ${page.id}` });
  }
}

export async function listMetaPages({ apiKey, accountId }) {
  const act = actId(accountId);
  const found = new Map();
  const errors = [];
  function take(result) {
    rememberPages(found, result.rows);
    if (!result.rows.length && result.error) errors.push(result.error);
  }
  take(await readEdge(`act_${act}/promote_pages`, apiKey));
  if (!found.size) take(await readEdge(`act_${act}/promote_pages`, apiKey, { fields: 'id,name' }));
  try {
    const account = await graph(`act_${act}`, apiKey, { fields: 'promote_pages{id,name}' });
    rememberPages(found, account?.promote_pages?.data || []);
  } catch (error) {
    if (!found.size) errors.push(String(error.message || '').slice(0, 200));
  }
  take(await readEdge('me/accounts', apiKey, { fields: 'id,name', limit: '100' }));
  try {
    const me = await graph('me', apiKey, { fields: 'id' });
    if (me?.id) take(await readEdge(`${me.id}/assigned_pages`, apiKey, { fields: 'id,name' }));
  } catch {
    // This token has no user id for assigned Pages.
  }
  const businessIds = new Set();
  try {
    const account = await graph(`act_${act}`, apiKey, { fields: 'business' });
    if (account?.business?.id) businessIds.add(String(account.business.id));
  } catch {
    // The ad account did not name a business.
  }
  const businesses = await readEdge('me/businesses', apiKey, { fields: 'id,name', limit: '25' });
  for (const business of businesses.rows) {
    if (business.id) businessIds.add(String(business.id));
  }
  for (const businessId of businessIds) {
    take(await readEdge(`${businessId}/owned_pages`, apiKey, { fields: 'id,name', limit: '50' }));
    take(await readEdge(`${businessId}/client_pages`, apiKey, { fields: 'id,name', limit: '50' }));
  }
  await fillPageNames(apiKey, found);
  const pages = [...found.values()];
  const note = pages.length ? '' : (errors.find(Boolean) || 'Meta returned no Pages for this ad account.');
  return { pages, note };
}

export async function attachMetaPages({ apiKey, accountId }) {
  const current = await listMetaPages({ apiKey, accountId });
  if (current.pages.length) return current;
  const act = actId(accountId);
  let businessId = '';
  let userId = '';
  try {
    const account = await graph(`act_${act}`, apiKey, { fields: 'business' });
    businessId = account?.business?.id ? String(account.business.id) : '';
  } catch {
    businessId = '';
  }
  try {
    const me = await graph('me', apiKey, { fields: 'id' });
    userId = me?.id ? String(me.id) : '';
  } catch {
    userId = '';
  }
  const pageIds = new Set();
  if (businessId) {
    for (const edge of ['owned_pages', 'client_pages']) {
      const listed = await readEdge(`${businessId}/${edge}`, apiKey, { fields: 'id,name', limit: '50' });
      for (const row of listed.rows) {
        if (row.id) pageIds.add(String(row.id));
      }
    }
  }
  let assignError = '';
  if (userId && businessId) {
    for (const pageId of pageIds) {
      try {
        await graph(`${pageId}/assigned_users`, apiKey, {
          user: userId,
          business: businessId,
          tasks: JSON.stringify(['ADVERTISE', 'ANALYZE'])
        }, 'POST');
      } catch (error) {
        assignError = String(error.message || '').replace(/access_token=[^&\s]+/gi, '').slice(0, 200);
      }
    }
  }
  const again = await listMetaPages({ apiKey, accountId });
  if (!again.pages.length && assignError) again.note = assignError;
  return again;
}

export async function searchPublicAds({ apiKey, query }) {
  const term = String(query || '').trim().slice(0, 80);
  if (term.length < 2) return { ads: [], note: 'Public competitor ads were not searched.' };
  try {
    const data = await graph('ads_archive', apiKey, {
      search_terms: term,
      ad_reached_countries: JSON.stringify(['IN']),
      ad_active_status: 'ACTIVE',
      fields: 'page_name,ad_creative_bodies,ad_creative_link_titles',
      limit: '5'
    });
    const ads = (data.data || []).slice(0, 5).map((row) => ({
      page: String(row.page_name || '').slice(0, 80),
      title: String((row.ad_creative_link_titles || [])[0] || '').slice(0, 80),
      text: String((row.ad_creative_bodies || [])[0] || '').slice(0, 180)
    })).filter((row) => row.page || row.title || row.text);
    return {
      ads,
      note: ads.length ? '' : 'The public ad library returned no active ads for this search.'
    };
  } catch {
    return { ads: [], note: 'Public competitor ads could not be read.' };
  }
}

export async function adLibrarySearch({ apiKey, query, limit = 50 }) {
  const term = String(query || '').trim().slice(0, 80);
  if (term.length < 2) return { ads: [], error: 'no_term' };
  try {
    const data = await graph('ads_archive', apiKey, {
      search_terms: term,
      ad_type: 'ALL',
      ad_reached_countries: JSON.stringify(['IN']),
      ad_active_status: 'ACTIVE',
      fields: 'page_id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,publisher_platforms,ad_delivery_start_time',
      limit: String(Math.min(100, Math.max(1, limit)))
    });
    const ads = (data.data || []).map((row) => ({
      pageId: String(row.page_id || ''),
      page: String(row.page_name || '').slice(0, 80),
      title: String((row.ad_creative_link_titles || [])[0] || '').slice(0, 100),
      text: String((row.ad_creative_bodies || [])[0] || '').slice(0, 300),
      description: String((row.ad_creative_link_descriptions || [])[0] || '').slice(0, 150),
      platforms: (row.publisher_platforms || []).map((item) => String(item).toLowerCase()),
      startDate: String(row.ad_delivery_start_time || '').slice(0, 10)
    })).filter((row) => row.page || row.title || row.text);
    return { ads, error: '' };
  } catch {
    return { ads: [], error: 'library_failed' };
  }
}

export async function listAdInstagram({ apiKey, accountId }) {
  const rows = await safeList(`act_${actId(accountId)}/instagram_accounts`, apiKey, { fields: 'id,username', limit: '50' });
  return rows
    .filter((row) => row.id)
    .map((row) => ({ id: String(row.id), name: row.username ? `@${row.username}` : 'Instagram' }));
}

export async function searchMetaAudience({ apiKey, kind, query }) {
  const q = String(query || '').trim().slice(0, 40);
  if (!/^[\p{L}\p{N} .'-]{2,40}$/u.test(q)) return [];
  if (kind === 'interest') {
    const data = await graph('search', apiKey, { type: 'adinterest', q, limit: '12' });
    return (data.data || [])
      .map((row) => ({ id: String(row.id), name: String(row.name || '').slice(0, 120) }))
      .filter((row) => /^\d{1,20}$/.test(row.id) && row.name);
  }
  if (kind === 'locale') {
    const data = await graph('search', apiKey, { type: 'adlocale', q, limit: '12' });
    return (data.data || [])
      .map((row) => ({ key: Number(row.key), name: String(row.name || '').slice(0, 80) }))
      .filter((row) => Number.isInteger(row.key) && row.key > 0 && row.name);
  }
  const types = JSON.stringify(['city']);
  let data = { data: [] };
  try {
    data = await graph('search', apiKey, {
      type: 'adgeolocation',
      q,
      location_types: types,
      country_code: 'IN',
      limit: '20'
    });
  } catch {
    data = { data: [] };
  }
  if (!(data.data || []).length) {
    data = await graph('search', apiKey, {
      type: 'adgeolocation',
      q,
      location_types: types,
      limit: '20'
    });
  }
  const allowed = new Set(['city', 'subcity', 'neighborhood']);
  return (data.data || [])
    .filter((row) => allowed.has(row.type) && /^\d{1,20}$/.test(String(row.key || '')) && (!row.country_code || row.country_code === 'IN'))
    .map((row) => ({
      key: String(row.key),
      name: String(row.name || '').slice(0, 80),
      region: String(row.region || row.country_name || '').slice(0, 80)
    }));
}

export async function listMetaPixels({ apiKey, accountId }) {
  const rows = await list(`act_${actId(accountId)}/adspixels`, apiKey, { fields: 'id,name', limit: '50' });
  return rows
    .filter((row) => row.id)
    .map((row) => ({ id: String(row.id), name: String(row.name || 'Pixel').slice(0, 180) }));
}

export async function listPageInstagram({ apiKey, pageId }) {
  const token = await pageAccessToken(apiKey, pageId);
  const page = await graph(String(pageId), token, { fields: 'instagram_business_account{id,username}' });
  const profile = page.instagram_business_account;
  if (!profile?.id) return [];
  return [{ id: String(profile.id), name: profile.username ? `@${profile.username}` : 'Instagram' }];
}

function deliveryPlan(objective, conversion, pixelId) {
  if (objective === 'OUTCOME_AWARENESS') {
    return { goal: 'REACH', destination: 'WEBSITE', cta: 'LEARN_MORE', lead: false, messenger: false };
  }
  if (conversion === 'messenger') {
    return { goal: 'CONVERSATIONS', destination: 'MESSENGER', cta: 'MESSAGE_PAGE', lead: false, messenger: true };
  }
  if (conversion === 'instant_messenger' || conversion === 'website_forms') {
    return { goal: 'LEAD_GENERATION', destination: 'ON_AD', cta: 'SIGN_UP', lead: true, messenger: false };
  }
  if (conversion === 'calls' || conversion === 'website_calls') {
    return { goal: 'QUALITY_CALL', destination: 'PHONE_CALL', cta: 'CALL_NOW', lead: false, messenger: false, call: true };
  }
  if (conversion === 'website' || objective === 'OUTCOME_TRAFFIC' || objective === 'OUTCOME_SALES') {
    return {
      goal: pixelId ? 'OFFSITE_CONVERSIONS' : 'LINK_CLICKS',
      destination: 'WEBSITE',
      cta: objective === 'OUTCOME_SALES' ? 'SHOP_NOW' : 'LEARN_MORE',
      lead: false,
      messenger: false
    };
  }
  return { goal: 'LEAD_GENERATION', destination: 'ON_AD', cta: 'SIGN_UP', lead: true, messenger: false };
}

function scheduleTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() - 60000) return '';
  return String(Math.floor(date.getTime() / 1000));
}

function targetingFor(input) {
  const cities = Array.isArray(input.locations) ? input.locations : [];
  const geo = cities.length
    ? {
      cities: cities.map((city) => {
        const item = { key: String(city.key) };
        if (city.radiusMode !== 'city') {
          item.radius = Math.min(80, Math.max(17, Number(city.radius) || 25));
          item.distance_unit = 'kilometer';
        }
        return item;
      })
    }
    : { countries: ['IN'] };
  const targeting = {
    geo_locations: geo,
    targeting_automation: { advantage_audience: input.advantageAudience === false ? 0 : 1 }
  };
  const locales = (Array.isArray(input.locales) ? input.locales : [])
    .map((item) => Number(item.key))
    .filter((key) => Number.isInteger(key) && key > 0);
  if (locales.length) targeting.locales = locales;
  const ageMin = Number(input.ageMin);
  const ageMax = Number(input.ageMax);
  const advantage = input.advantageAudience !== false;
  if (Number.isInteger(ageMin)) targeting.age_min = advantage ? Math.min(ageMin, 25) : ageMin;
  if (Number.isInteger(ageMax) && !advantage) targeting.age_max = ageMax;
  if (input.gender === 'men') targeting.genders = [1];
  if (input.gender === 'women') targeting.genders = [2];
  const interests = Array.isArray(input.interests) ? input.interests : [];
  if (interests.length) {
    targeting.flexible_spec = [{ interests: interests.map((item) => ({ id: String(item.id), name: item.name })) }];
  }
  if (input.placements !== 'manual') return targeting;
  const feeds = Array.isArray(input.placementFeeds) ? input.placementFeeds : [];
  const facebook = [];
  const instagram = [];
  if (feeds.includes('facebook_feed')) facebook.push('feed');
  if (feeds.includes('facebook_story')) facebook.push('story');
  if (feeds.includes('instagram_feed')) instagram.push('stream');
  if (feeds.includes('instagram_story')) instagram.push('story');
  const platforms = [];
  if (facebook.length) platforms.push('facebook');
  if (instagram.length) platforms.push('instagram');
  if (!platforms.length) throw new ApiError(422, 'Choose at least one placement.', 'validation_error');
  targeting.publisher_platforms = platforms;
  if (facebook.length) targeting.facebook_positions = facebook;
  if (instagram.length) targeting.instagram_positions = instagram;
  return targeting;
}

function imageBytes(raw) {
  const cleaned = String(raw || '').replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+=*$/.test(cleaned)) {
    throw new ApiError(422, 'Upload a JPG or PNG image.', 'validation_error');
  }
  const bytes = Buffer.from(cleaned, 'base64');
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  if ((!jpeg && !png) || bytes.length < 100 || bytes.length > 2500000) {
    throw new ApiError(422, 'Upload a JPG or PNG image under 2 MB.', 'validation_error');
  }
  return cleaned;
}

async function pageAccessToken(apiKey, pageId) {
  const rows = await safeList('me/accounts', apiKey, { fields: 'id,access_token', limit: '50' });
  const page = rows.find((row) => String(row.id) === String(pageId));
  if (page?.access_token) return page.access_token;
  try {
    const direct = await graph(String(pageId), apiKey, { fields: 'access_token' });
    if (direct?.access_token) return direct.access_token;
  } catch {
    // This token cannot act as the Page.
  }
  throw new ApiError(422, 'This token cannot advertise for that Facebook Page. Assign the Page to this ad account in Meta, then refresh.', 'validation_error');
}

async function uploadImage(act, apiKey, bytes) {
  const created = await graph(`act_${act}/adimages`, apiKey, { bytes }, 'POST');
  const image = Object.values(created.images || {})[0];
  if (!image?.hash) throw new ApiError(422, 'Meta Ads did not accept the image.', 'validation_error');
  return image.hash;
}

async function createLeadForm(pageId, pageToken, name, link) {
  const created = await graph(`${pageId}/leadgen_forms`, pageToken, {
    name: `${name} form`.slice(0, 100),
    questions: JSON.stringify([{ type: 'FULL_NAME' }, { type: 'PHONE' }, { type: 'EMAIL' }]),
    privacy_policy: JSON.stringify({ url: link, link_text: 'Privacy Policy' }),
    follow_up_action_url: link
  }, 'POST');
  if (!created.id) throw new ApiError(422, 'Meta did not create the lead form.', 'validation_error');
  return String(created.id);
}

function storySpec(input, linkData) {
  const spec = { page_id: input.pageId, link_data: linkData };
  if (input.instagramId) spec.instagram_actor_id = input.instagramId;
  return spec;
}

async function makeCreative(act, apiKey, input, imageHash, formId, plan, variant) {
  const headline = String(variant?.headline || input.headline).slice(0, 80);
  const text = String(variant?.message || input.message).slice(0, 500);
  const website = input.website.toString();
  const cta = plan.messenger ? 'MESSAGE_PAGE' : plan.lead ? 'SIGN_UP' : plan.call ? 'CALL_NOW' : (input.cta || plan.cta);
  const useDynamic = input.dynamicCreative && !plan.lead && !plan.messenger;
  if (useDynamic) {
    const titles = [{ text: headline }];
    const bodies = [{ text }];
    if (input.headlineB) titles.push({ text: String(input.headlineB).slice(0, 80) });
    if (input.messageB) bodies.push({ text: String(input.messageB).slice(0, 500) });
    const created = await graph(`act_${act}/adcreatives`, apiKey, {
      name: `${input.name} creative`.slice(0, 180),
      object_story_spec: JSON.stringify({ page_id: input.pageId, ...(input.instagramId ? { instagram_actor_id: input.instagramId } : {}) }),
      asset_feed_spec: JSON.stringify({
        images: [{ hash: imageHash }],
        bodies,
        titles,
        link_urls: [{ website_url: website }],
        call_to_action_types: [cta],
        ad_formats: ['SINGLE_IMAGE']
      })
    }, 'POST');
    if (!created.id) throw new ApiError(422, 'Meta Ads did not return an ad creative.', 'validation_error');
    return String(created.id);
  }
  const destination = plan.lead ? 'https://fb.me/' : plan.messenger ? 'https://fb.com/messenger_doc/' : website;
  let callToAction = { type: cta, value: { link: destination } };
  if (plan.lead) callToAction = { type: 'SIGN_UP', value: { lead_gen_form_id: formId } };
  if (plan.messenger) callToAction = { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } };
  const linkData = {
    message: text,
    name: headline,
    image_hash: imageHash,
    link: destination,
    call_to_action: callToAction
  };
  const created = await graph(`act_${act}/adcreatives`, apiKey, {
    name: `${input.name} ${variant?.label || 'creative'}`.slice(0, 180),
    object_story_spec: JSON.stringify(storySpec(input, linkData))
  }, 'POST');
  if (!created.id) throw new ApiError(422, 'Meta Ads did not return an ad creative.', 'validation_error');
  return String(created.id);
}

async function makeAd(act, apiKey, name, adsetId, creativeId) {
  const created = await graph(`act_${act}/ads`, apiKey, {
    name: String(name).slice(0, 180),
    adset_id: adsetId,
    creative: JSON.stringify({ creative_id: creativeId }),
    status: 'PAUSED'
  }, 'POST');
  if (!created.id) throw new ApiError(422, 'Meta Ads did not return an ad.', 'validation_error');
  return String(created.id);
}

export async function editMetaCampaign({ apiKey, accountId, campaignId, name, dailyBudget, status }) {
  if (!/^\d{5,20}$/.test(String(campaignId || ''))) {
    throw new ApiError(422, 'Unknown Meta campaign.', 'validation_error');
  }
  const params = {};
  if (name) params.name = String(name).slice(0, 180);
  if (status === 'ACTIVE' || status === 'PAUSED') params.status = status;
  if (dailyBudget) {
    const account = await graph(`act_${actId(accountId)}`, apiKey, { fields: 'currency' });
    const budget = Math.round(Number(dailyBudget) * (OFFSET[account.currency] || 100));
    if (!Number.isFinite(budget) || budget < 1) throw new ApiError(422, 'Enter a daily budget.', 'validation_error');
    params.daily_budget = String(budget);
  }
  if (!Object.keys(params).length) throw new ApiError(422, 'Nothing to update.', 'validation_error');
  await graph(String(campaignId), apiKey, params, 'POST');
}

async function ownedMetaObject(apiKey, act, id, fields) {
  if (!/^\d{5,25}$/.test(String(id || ''))) throw new ApiError(422, 'Unknown Meta item.', 'validation_error');
  const row = await graph(String(id), apiKey, { fields: `account_id,${fields}` });
  if (String(row.account_id || '') !== act) throw new ApiError(404, 'This item is not in the connected ad account.', 'not_found');
  return row;
}

export async function metaCampaignBudgets({ apiKey, accountId }, campaignId) {
  const act = actId(accountId);
  const [row, account] = await Promise.all([
    ownedMetaObject(apiKey, act, campaignId, 'status,daily_budget,lifetime_budget'),
    graph(`act_${act}`, apiKey, { fields: 'currency' })
  ]);
  const currency = account.currency || '';
  if (row.lifetime_budget) return { status: row.status, currency, level: 'campaign', lifetime: true, items: [] };
  if (row.daily_budget) {
    return { status: row.status, currency, level: 'campaign', lifetime: false, items: [{ id: String(campaignId), daily: Number(major(row.daily_budget, currency)) }] };
  }
  const adsets = (await list(`${campaignId}/adsets`, apiKey, { fields: 'id,status,daily_budget,lifetime_budget' })).filter((item) => item.status === 'ACTIVE');
  return {
    status: row.status,
    currency,
    level: 'adset',
    lifetime: adsets.some((item) => item.lifetime_budget && !item.daily_budget),
    items: adsets.filter((item) => item.daily_budget).map((item) => ({ id: String(item.id), daily: Number(major(item.daily_budget, currency)) }))
  };
}

function leadFields(fieldData) {
  const values = {};
  for (const item of Array.isArray(fieldData) ? fieldData : []) {
    values[String(item.name || '').toLowerCase()] = String(item.values?.[0] ?? '').trim();
  }
  const name = values.full_name || [values.first_name, values.last_name].filter(Boolean).join(' ');
  return {
    name: name.slice(0, 160),
    phone: (values.phone_number || values.phone || '').slice(0, 32),
    email: (values.email || '').slice(0, 255),
    city: (values.city || '').slice(0, 80)
  };
}

// Reads lead form submissions since a unix time. Falls back to the Page token when the user token cannot read leads.
export async function metaFormLeads({ apiKey, accountId }, sinceUnix) {
  const act = actId(accountId);
  const ads = await list(`act_${act}/ads`, apiKey, { fields: 'id,campaign_id,campaign{name},creative{object_story_spec}' });
  const leadAds = ads.filter((ad) => {
    const spec = ad.creative?.object_story_spec || {};
    return Boolean((spec.link_data || spec.video_data)?.call_to_action?.value?.lead_gen_form_id);
  }).slice(0, 50);
  const pageTokens = new Map();
  const rows = [];
  const notes = [];
  const filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(sinceUnix) }]);
  for (const ad of leadAds) {
    const params = { fields: 'id,created_time,ad_id,form_id,campaign_id,field_data', filtering };
    let found;
    try {
      found = await list(`${ad.id}/leads`, apiKey, params);
    } catch {
      const pageId = ad.creative?.object_story_spec?.page_id;
      try {
        if (!pageId) throw new Error('no page');
        if (!pageTokens.has(pageId)) pageTokens.set(pageId, await pageAccessToken(apiKey, pageId));
        found = await list(`${ad.id}/leads`, pageTokens.get(pageId), params);
      } catch {
        notes.push(`Leads for ad ${ad.id} could not be read. Check leads access on the Facebook Page.`);
        continue;
      }
    }
    for (const lead of found) {
      rows.push({
        id: String(lead.id),
        createdTime: lead.created_time || null,
        adId: String(lead.ad_id || ad.id),
        formId: lead.form_id ? String(lead.form_id) : null,
        campaignId: String(lead.campaign_id || ad.campaign_id || ''),
        campaignName: String(ad.campaign?.name || ''),
        ...leadFields(lead.field_data)
      });
    }
  }
  return { rows, notes, leadAds: leadAds.length };
}

export async function setMetaDailyBudget({ apiKey, currency }, itemId, daily) {
  if (!/^\d{5,25}$/.test(String(itemId || ''))) throw new ApiError(422, 'Unknown Meta item.', 'validation_error');
  const minor = Math.round(Number(daily) * (OFFSET[currency] || 100));
  if (!Number.isFinite(minor) || minor < 1) throw new ApiError(422, 'Enter a daily budget.', 'validation_error');
  await graph(String(itemId), apiKey, { daily_budget: String(minor) }, 'POST');
}

async function budgetParams(apiKey, act, row, amount, missing) {
  if (amount == null || amount === '') return {};
  if (!row.daily_budget && !row.lifetime_budget) throw new ApiError(422, missing, 'validation_error');
  const account = await graph(`act_${act}`, apiKey, { fields: 'currency' });
  const minor = Math.round(Number(amount) * (OFFSET[account.currency] || 100));
  if (!Number.isFinite(minor) || minor < 1) throw new ApiError(422, 'Enter a budget.', 'validation_error');
  return { [row.daily_budget ? 'daily_budget' : 'lifetime_budget']: String(minor) };
}

function editedTargeting(current = {}, changes) {
  const targeting = { ...current };
  if (changes.ageMin != null) targeting.age_min = Number(changes.ageMin);
  if (changes.ageMax != null) targeting.age_max = Number(changes.ageMax);
  if (targeting.age_min && targeting.age_max && targeting.age_min > targeting.age_max) {
    throw new ApiError(422, 'Minimum age must be below maximum age.', 'validation_error');
  }
  if (changes.gender === 'men') targeting.genders = [1];
  if (changes.gender === 'women') targeting.genders = [2];
  if (changes.gender === 'all') delete targeting.genders;
  if (Array.isArray(changes.cities)) {
    const geo = { ...(targeting.geo_locations || {}) };
    const cities = changes.cities.map((city) => {
      const item = { key: String(city.key) };
      if (Number(city.radius) > 0) {
        item.radius = Math.min(80, Math.max(1, Number(city.radius)));
        item.distance_unit = city.distanceUnit === 'mile' ? 'mile' : 'kilometer';
      }
      return item;
    });
    if (cities.length) geo.cities = cities;
    else delete geo.cities;
    if (!geo.cities && !geo.regions?.length && !geo.countries?.length && !geo.custom_locations?.length && !geo.zips?.length) geo.countries = ['IN'];
    targeting.geo_locations = geo;
  }
  if (Array.isArray(changes.interests)) {
    const specs = (targeting.flexible_spec || []).map((spec) => {
      const { interests, ...rest } = spec;
      return rest;
    });
    if (changes.interests.length) {
      const first = specs[0] || {};
      specs[0] = { ...first, interests: changes.interests.map((item) => ({ id: String(item.id), name: item.name })) };
    }
    const kept = specs.filter((spec) => Object.keys(spec).length);
    if (kept.length) targeting.flexible_spec = kept;
    else delete targeting.flexible_spec;
  }
  return targeting;
}

function editedStory(spec, changes) {
  const story = JSON.parse(JSON.stringify(spec || {}));
  const link = story.link_data;
  const video = story.video_data;
  if (!link && !video) {
    throw new ApiError(422, 'This ad uses a dynamic or catalog creative. Change its text in Meta Ads Manager.', 'validation_error');
  }
  if (link) {
    if (changes.headline != null) link.name = String(changes.headline).slice(0, 255);
    if (changes.text != null) link.message = String(changes.text).slice(0, 2000);
    if (link.image_hash) delete link.picture;
    if (changes.link) {
      if (link.call_to_action?.value?.lead_gen_form_id) throw new ApiError(422, 'Lead form ads open the form, not a website link.', 'validation_error');
      link.link = changes.link;
      if (link.call_to_action?.value?.link) link.call_to_action.value.link = changes.link;
    }
    if (changes.cta && link.call_to_action) link.call_to_action.type = changes.cta;
  }
  if (video) {
    if (changes.headline != null) video.title = String(changes.headline).slice(0, 255);
    if (changes.text != null) video.message = String(changes.text).slice(0, 2000);
    if (video.image_hash) delete video.image_url;
    if (changes.link && video.call_to_action?.value) video.call_to_action.value.link = changes.link;
    if (changes.cta && video.call_to_action) video.call_to_action.type = changes.cta;
  }
  return story;
}

export async function editMetaItem({ apiKey, accountId }, kind, itemId, changes) {
  const act = actId(accountId);
  const params = {};
  if (changes.name) params.name = String(changes.name).slice(0, 180);
  if (changes.status === 'ACTIVE' || changes.status === 'PAUSED') params.status = changes.status;
  if (kind === 'campaign') {
    const row = await ownedMetaObject(apiKey, act, itemId, 'daily_budget,lifetime_budget');
    Object.assign(params, await budgetParams(apiKey, act, row, changes.budget, 'This campaign has no campaign budget. Change the budget on its ad sets.'));
  } else if (kind === 'adset') {
    const row = await ownedMetaObject(apiKey, act, itemId, 'daily_budget,lifetime_budget,end_time,targeting');
    Object.assign(params, await budgetParams(apiKey, act, row, changes.budget, 'This ad set uses the campaign budget. Change the budget on the campaign.'));
    if (changes.endDate) params.end_time = `${changes.endDate}T23:59:00+0530`;
    if (['ageMin', 'ageMax', 'gender', 'cities', 'interests'].some((key) => changes[key] != null)) {
      params.targeting = JSON.stringify(editedTargeting(row.targeting, changes));
    }
  } else if (kind === 'ad') {
    const row = await ownedMetaObject(apiKey, act, itemId, 'creative{id,name,object_story_spec}');
    if (['headline', 'text', 'link', 'cta'].some((key) => changes[key] != null)) {
      const story = editedStory(row.creative?.object_story_spec, changes);
      const created = await graph(`act_${act}/adcreatives`, apiKey, {
        name: `${String(row.creative?.name || 'Creative').slice(0, 150)} edited`,
        object_story_spec: JSON.stringify(story)
      }, 'POST');
      if (!created.id) throw new ApiError(422, 'Meta Ads did not return an ad creative.', 'validation_error');
      params.creative = JSON.stringify({ creative_id: String(created.id) });
    }
  } else {
    throw new ApiError(422, 'Unknown Meta item.', 'validation_error');
  }
  if (!Object.keys(params).length) throw new ApiError(422, 'Nothing to update.', 'validation_error');
  await graph(String(itemId), apiKey, params, 'POST');
}

export async function createMetaAd(input) {
  const {
    apiKey, accountId, name, objective, dailyBudget, pageId, headline, message, link, imageBase64, publish
  } = input;
  const pixelId = input.pixelId || '';
  const plan = deliveryPlan(objective, input.conversion, pixelId);
  let website;
  try { website = new URL(link); } catch { throw new ApiError(422, 'Enter a valid website link.', 'validation_error'); }
  if (website.protocol !== 'https:') throw new ApiError(422, 'The website link must start with https.', 'validation_error');
  if (input.budgetMode === 'lifetime' && !input.endDate) {
    throw new ApiError(422, 'A lifetime budget needs an end date.', 'validation_error');
  }
  const bytes = imageBytes(imageBase64);
  const bytesB = input.imageBase64B ? imageBytes(input.imageBase64B) : '';
  const act = actId(accountId);
  const account = await graph(`act_${act}`, apiKey, { fields: 'currency' });
  const fullBudget = Math.round(Number(dailyBudget) * (OFFSET[account.currency] || 100));
  if (!Number.isFinite(fullBudget) || fullBudget < 1) throw new ApiError(422, 'Enter a daily budget.', 'validation_error');
  const pageToken = await pageAccessToken(apiKey, pageId);
  const imageHash = await uploadImage(act, apiKey, bytes);
  const imageHashB = bytesB ? await uploadImage(act, apiKey, bytesB) : imageHash;
  const formId = plan.lead ? await createLeadForm(pageId, pageToken, name, website.toString()) : '';
  const campaignLevel = input.budgetLevel === 'campaign';
  const budgetKey = input.budgetMode === 'lifetime' ? 'lifetime_budget' : 'daily_budget';
  const allowedCategory = ['HOUSING', 'EMPLOYMENT', 'CREDIT', 'ISSUES_ELECTIONS_POLITICS'];
  const campaignParams = {
    name: String(name).slice(0, 180),
    objective: campaignObjective(objective, input.conversion),
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(allowedCategory.includes(input.specialCategory) ? [input.specialCategory] : []),
    is_adset_budget_sharing_enabled: 'false'
  };
  if (campaignLevel) {
    campaignParams[budgetKey] = String(fullBudget);
    campaignParams.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
  }
  const campaign = await graph(`act_${act}/campaigns`, apiKey, campaignParams, 'POST');
  if (!campaign.id) throw new ApiError(422, 'Meta Ads did not return a campaign.', 'validation_error');
  try {
    return await fillMetaCampaign({ input, apiKey, act, campaign, plan, pixelId, website, pageId, name, message, publish, fullBudget, campaignLevel, budgetKey, imageHash, imageHashB, formId });
  } catch (error) {
    try {
      await graph(String(campaign.id), apiKey, {}, 'DELETE');
    } catch {
      // The paused campaign stays in Meta if delete is refused.
    }
    throw error;
  }
}

async function fillMetaCampaign({ input, apiKey, act, campaign, plan, pixelId, website, pageId, name, message, publish, fullBudget, campaignLevel, budgetKey, imageHash, imageHashB = imageHash, formId }) {
  const versions = input.abTest ? [true, false] : [input.advantageAudience !== false];
  const share = Math.max(1, Math.floor(fullBudget / versions.length));
  const start = scheduleTime(input.startDate);
  const end = scheduleTime(input.endDate);
  if (input.budgetMode === 'lifetime' && !end) {
    throw new ApiError(422, 'The end date must be in the future.', 'validation_error');
  }
  const creativeInput = { ...input, website, pageId, name };
  let firstAdset = '';
  let firstAd = '';
  for (const [index, advantage] of versions.entries()) {
    const adsetParams = {
      name: `${name} ${versions.length > 1 ? `test ${index + 1}` : 'ad set'}`.slice(0, 180),
      campaign_id: campaign.id,
      billing_event: 'IMPRESSIONS',
      optimization_goal: plan.goal,
      destination_type: plan.destination,
      targeting: JSON.stringify(targetingFor({ ...input, advantageAudience: advantage })),
      status: 'PAUSED'
    };
    if (!campaignLevel) {
      adsetParams[budgetKey] = String(share);
      adsetParams.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
    }
    if (start) adsetParams.start_time = start;
    if (end) adsetParams.end_time = end;
    if (plan.lead || plan.messenger) adsetParams.promoted_object = JSON.stringify({ page_id: pageId });
    if (pixelId && plan.destination === 'WEBSITE' && plan.goal === 'OFFSITE_CONVERSIONS') {
      adsetParams.promoted_object = JSON.stringify({ pixel_id: pixelId, custom_event_type: 'LEAD' });
    }
    const adset = await graph(`act_${act}/adsets`, apiKey, adsetParams, 'POST');
    if (!adset.id) throw new ApiError(422, 'Meta Ads did not return an ad set.', 'validation_error');
    if (!firstAdset) firstAdset = String(adset.id);
    const primary = await makeCreative(act, apiKey, creativeInput, imageHash, formId, plan);
    const ad = await makeAd(act, apiKey, `${name} ad`, adset.id, primary);
    if (!firstAd) firstAd = ad;
    if (input.creativeTest && input.headlineB && !input.dynamicCreative) {
      const second = await makeCreative(act, apiKey, creativeInput, imageHashB, formId, plan, {
        headline: input.headlineB,
        message: input.messageB || message,
        label: 'test'
      });
      await makeAd(act, apiKey, `${name} ad B`, adset.id, second);
    }
  }
  if (publish) await setMetaCampaignStatus({ apiKey, campaignId: String(campaign.id), status: 'ACTIVE' });
  return { campaignId: String(campaign.id), adsetId: firstAdset, adId: firstAd };
}
