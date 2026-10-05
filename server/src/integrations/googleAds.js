import { env } from '../config/env.js';
import { hashToken } from '../utils/cryptoBox.js';
import { ApiError } from '../utils/errors.js';

const SCOPE = 'https://www.googleapis.com/auth/adwords';
const INDIA = '2356';
const tokens = new Map();

export const GOOGLE_RANGES = ['LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];

function quiet() {
  return new ApiError(422, 'The API did not respond.', 'validation_error');
}

function clean(text) {
  return String(text || '')
    .replace(/ya29\.[A-Za-z0-9._-]+/g, '')
    .replace(/1\/\/[A-Za-z0-9._-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function googleSetup() {
  const settings = env.googleAds;
  const redirectUri = settings.redirectUri || `${env.clientOrigin.replace(/\/$/, '')}/api/google-ads/callback`;
  return { ready: Boolean(settings.developerToken && settings.clientId && settings.clientSecret), redirectUri };
}

function config() {
  const setup = googleSetup();
  if (!setup.ready) throw new ApiError(422, 'Google Ads is not set up on this server yet.', 'validation_error');
  const version = /^v\d{2}$/.test(env.googleAds.version) ? env.googleAds.version : 'v25';
  return { ...env.googleAds, version, redirectUri: setup.redirectUri };
}

export function customerId(value) {
  const raw = String(value || '').replace(/-/g, '').trim();
  if (!/^\d{10}$/.test(raw)) throw new ApiError(422, 'Customer id must look like 123-456-7890.', 'validation_error');
  return raw;
}

function entityId(value, label) {
  const raw = String(value || '').trim();
  if (!/^\d{1,20}$/.test(raw)) throw new ApiError(422, `Unknown Google Ads ${label}.`, 'validation_error');
  return raw;
}

export function googleAuthUrl(state) {
  const settings = config();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', state);
  return url.toString();
}

async function oauth(params) {
  const settings = config();
  const body = new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, ...params });
  let response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw quiet();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = clean(data.error_description || data.error).slice(0, 160);
    throw new ApiError(422, reason ? `Google sign-in failed. ${reason}` : 'Google sign-in failed.', 'validation_error');
  }
  return data;
}

export async function exchangeGoogleCode(code) {
  const settings = config();
  const data = await oauth({ code, grant_type: 'authorization_code', redirect_uri: settings.redirectUri });
  if (!String(data.scope || '').split(' ').includes(SCOPE)) {
    throw new ApiError(422, 'Google Ads access was not allowed. Connect again and allow Google Ads.', 'validation_error');
  }
  if (!data.refresh_token) {
    throw new ApiError(422, 'Google did not return offline access. Remove AIRO from your Google account permissions, then connect again.', 'validation_error');
  }
  return data.refresh_token;
}

async function accessToken(refreshToken) {
  const key = hashToken(refreshToken);
  const cached = tokens.get(key);
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const data = await oauth({ refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (!data.access_token) throw new ApiError(422, 'Google sign-in expired. Connect Google Ads again.', 'validation_error');
  tokens.set(key, { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3000) * 1000 });
  if (tokens.size > 500) tokens.delete(tokens.keys().next().value);
  return data.access_token;
}

function googleError(data) {
  const error = data?.error || {};
  const messages = [];
  for (const detail of Array.isArray(error.details) ? error.details : []) {
    for (const item of Array.isArray(detail.errors) ? detail.errors : []) {
      const field = (item.location?.fieldPathElements || []).map((part) => part.fieldName).filter(Boolean).slice(-2).join('.');
      const text = clean(item.message);
      if (text) messages.push(field ? `${text} (${field})` : text);
    }
  }
  const message = clean([...new Set(messages)].slice(0, 3).join(' ') || error.message || 'Google Ads rejected the request.').slice(0, 240);
  return new ApiError(422, message || 'Google Ads rejected the request.', 'validation_error');
}

async function call(path, { refreshToken, loginCustomerId, body, method = 'POST' }) {
  const settings = config();
  const token = await accessToken(refreshToken);
  const headers = { Accept: 'application/json', Authorization: `Bearer ${token}`, 'developer-token': settings.developerToken };
  if (loginCustomerId) headers['login-customer-id'] = String(loginCustomerId);
  if (body) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(`https://googleads.googleapis.com/${settings.version}/${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw quiet();
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw googleError(data);
  return data;
}

async function search(ctx, query, maxPages = 3) {
  const rows = [];
  let pageToken = '';
  for (let page = 0; page < maxPages; page += 1) {
    const data = await call(`customers/${ctx.customerId}/googleAds:search`, {
      ...ctx,
      body: pageToken ? { query, pageToken } : { query }
    });
    rows.push(...(data.results || []));
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return rows;
}

function context({ refreshToken, accountId, loginCustomerId }) {
  return {
    refreshToken,
    customerId: customerId(accountId),
    loginCustomerId: loginCustomerId ? customerId(loginCustomerId) : ''
  };
}

function major(micros) {
  if (micros == null || micros === '') return null;
  const amount = Number(micros) / 1000000;
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

function count(value) {
  if (value == null || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? String(Math.round(amount * 100) / 100) : null;
}

function micros(amount) {
  const value = Math.round(Number(amount) * 1000000);
  if (!Number.isFinite(value) || value < 10000) throw new ApiError(422, 'Enter a daily budget.', 'validation_error');
  return String(value);
}

function accountRow(customer, managerId, managerName) {
  const id = String(customer.id);
  return {
    id,
    name: String(customer.descriptiveName || `Account ${id}`).slice(0, 160),
    currency: customer.currencyCode || '',
    test: Boolean(customer.testAccount),
    loginCustomerId: managerId || '',
    manager: managerName || ''
  };
}

export async function listGoogleAccounts({ refreshToken }) {
  const data = await call('customers:listAccessibleCustomers', { refreshToken, method: 'GET' });
  const ids = (data.resourceNames || [])
    .map((name) => String(name).split('/')[1])
    .filter((id) => /^\d{10}$/.test(id))
    .slice(0, 20);
  const found = new Map();
  const errors = [];
  for (const id of ids) {
    const ctx = { refreshToken, customerId: id, loginCustomerId: id };
    let customer;
    try {
      const [row] = await search(ctx, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account, customer.status FROM customer LIMIT 1', 1);
      customer = row?.customer;
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    if (!customer) continue;
    if (!customer.manager) {
      if (!customer.status || customer.status === 'ENABLED') found.set(id, accountRow(customer, '', ''));
      continue;
    }
    try {
      const children = await search(ctx, "SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.test_account, customer_client.status FROM customer_client WHERE customer_client.manager = false AND customer_client.status = 'ENABLED' LIMIT 200", 1);
      for (const child of children) {
        const client = child.customerClient;
        if (client?.id && !found.has(String(client.id))) found.set(String(client.id), accountRow(client, id, customer.descriptiveName));
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  const accounts = [...found.values()];
  return { accounts, note: accounts.length ? '' : (errors[0] || 'Google returned no ad accounts for this login.') };
}

export async function verifyGoogleAccount(input) {
  const ctx = context(input);
  const [row] = await search(ctx, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1', 1);
  const customer = row?.customer;
  if (!customer) throw new ApiError(422, 'Google Ads did not return this account.', 'validation_error');
  if (customer.manager) throw new ApiError(422, 'Choose an ad account, not a manager account.', 'validation_error');
  return {
    name: String(customer.descriptiveName || `Account ${ctx.customerId}`).slice(0, 160),
    currency: customer.currencyCode || '',
    timeZone: customer.timeZone || ''
  };
}

export async function pullGoogleAds(input) {
  const ctx = context(input);
  const currency = input.currency || '';
  const [campaigns, adGroups, ads, keywords] = await Promise.all([
    search(ctx, "SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign_budget.amount_micros FROM campaign WHERE campaign.status != 'REMOVED' LIMIT 500"),
    search(ctx, "SELECT ad_group.id, ad_group.name, ad_group.status, campaign.id FROM ad_group WHERE ad_group.status != 'REMOVED' LIMIT 1000"),
    search(ctx, "SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group_ad.ad.responsive_search_ad.headlines, ad_group.id FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' LIMIT 1000"),
    search(ctx, "SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.id FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = false AND ad_group_criterion.status != 'REMOVED' LIMIT 1000")
  ]);
  let metrics = [];
  let reportNote = '';
  try {
    metrics = await search(ctx, "SELECT campaign.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING LAST_30_DAYS");
  } catch (error) {
    reportNote = error.message;
  }
  const byCampaign = new Map(metrics.map((row) => [String(row.campaign?.id), row.metrics || {}]));
  const objects = [
    ...campaigns.map((row) => {
      const stats = byCampaign.get(String(row.campaign.id));
      return {
        type: 'campaign',
        externalId: String(row.campaign.id),
        name: String(row.campaign.name || 'Campaign').slice(0, 180),
        parent: null,
        payload: {
          origin: 'api',
          status: row.campaign.status || '',
          delivery: row.campaign.primaryStatus || '',
          channel: row.campaign.advertisingChannelType || '',
          bidding: row.campaign.biddingStrategyType || '',
          budget: major(row.campaignBudget?.amountMicros),
          budgetKind: 'daily',
          currency,
          spend: stats ? major(stats.costMicros || 0) : null,
          impressions: stats ? count(stats.impressions || 0) : null,
          clicks: stats ? count(stats.clicks || 0) : null,
          conversions: stats ? count(stats.conversions || 0) : null
        }
      };
    }),
    ...adGroups.map((row) => ({
      type: 'ad_group',
      externalId: String(row.adGroup.id),
      name: String(row.adGroup.name || 'Ad group').slice(0, 180),
      parent: row.campaign?.id ? String(row.campaign.id) : null,
      payload: { origin: 'api', status: row.adGroup.status || '' }
    })),
    ...ads.map((row) => {
      const ad = row.adGroupAd?.ad || {};
      const headline = ad.responsiveSearchAd?.headlines?.[0]?.text || '';
      return {
        type: 'ad',
        externalId: `${row.adGroup?.id}~${ad.id}`.slice(0, 80),
        name: String(ad.name || headline || 'Ad').slice(0, 180),
        parent: row.adGroup?.id ? String(row.adGroup.id) : null,
        payload: {
          origin: 'api',
          status: row.adGroupAd?.status || '',
          adType: ad.type || '',
          approval: row.adGroupAd?.policySummary?.approvalStatus || ''
        }
      };
    }),
    ...keywords.map((row) => ({
      type: 'keyword',
      externalId: `${row.adGroup?.id}~${row.adGroupCriterion?.criterionId}`.slice(0, 80),
      name: String(row.adGroupCriterion?.keyword?.text || 'Keyword').slice(0, 180),
      parent: row.adGroup?.id ? String(row.adGroup.id) : null,
      payload: {
        origin: 'api',
        status: row.adGroupCriterion?.status || '',
        matchType: row.adGroupCriterion?.keyword?.matchType || ''
      }
    }))
  ];
  const base = `Google returned ${campaigns.length} campaigns, ${adGroups.length} ad groups, and ${keywords.length} keywords.`;
  return {
    mode: 'live',
    providerKey: 'google_ads',
    summary: (reportNote ? `${base} Report failed: ${reportNote}` : base).slice(0, 250),
    replaceTypes: ['campaign', 'ad_group', 'ad', 'keyword'],
    objects
  };
}

function reportRow(metrics = {}) {
  return {
    spend: major(metrics.costMicros || 0),
    impressions: count(metrics.impressions || 0),
    clicks: count(metrics.clicks || 0),
    conversions: count(metrics.conversions || 0)
  };
}

export async function googleReport(input, range) {
  if (!GOOGLE_RANGES.includes(range)) throw new ApiError(422, 'Choose a report range.', 'validation_error');
  const ctx = context(input);
  const queries = {
    daily: `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date DURING ${range} ORDER BY segments.date`,
    campaigns: `SELECT campaign.id, campaign.name, campaign.status, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.cost_per_conversion FROM campaign WHERE campaign.status != 'REMOVED' AND segments.date DURING ${range} ORDER BY metrics.cost_micros DESC LIMIT 100`,
    keywords: `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM keyword_view WHERE segments.date DURING ${range} ORDER BY metrics.cost_micros DESC LIMIT 50`,
    searchTerms: `SELECT search_term_view.search_term, campaign.name, ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM search_term_view WHERE segments.date DURING ${range} ORDER BY metrics.clicks DESC LIMIT 50`,
    devices: `SELECT segments.device, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM customer WHERE segments.date DURING ${range}`
  };
  const keys = Object.keys(queries);
  const settled = await Promise.allSettled(keys.map((key) => search(ctx, queries[key], 1)));
  const result = { range, currency: input.currency || '', notes: [] };
  settled.forEach((outcome, index) => {
    if (outcome.status === 'rejected') result.notes.push(`${keys[index]}: ${outcome.reason?.message || 'failed'}`);
  });
  const rows = (index) => (settled[index].status === 'fulfilled' ? settled[index].value : []);
  result.daily = rows(0).map((row) => ({ date: row.segments?.date || '', ...reportRow(row.metrics) }));
  result.campaigns = rows(1).map((row) => ({
    id: String(row.campaign?.id || ''),
    name: String(row.campaign?.name || ''),
    status: row.campaign?.status || '',
    ...reportRow(row.metrics),
    ctr: row.metrics?.ctr == null ? null : (Number(row.metrics.ctr) * 100).toFixed(2),
    cpc: major(row.metrics?.averageCpc),
    costPerConversion: major(row.metrics?.costPerConversion)
  }));
  result.keywords = rows(2).map((row) => ({
    id: `${row.adGroup?.id}~${row.adGroupCriterion?.criterionId}`,
    text: String(row.adGroupCriterion?.keyword?.text || ''),
    matchType: row.adGroupCriterion?.keyword?.matchType || '',
    campaign: String(row.campaign?.name || ''),
    ...reportRow(row.metrics)
  }));
  result.searchTerms = rows(3).map((row, index) => ({
    id: `${row.adGroup?.id}-${index}`,
    term: String(row.searchTermView?.searchTerm || ''),
    campaign: String(row.campaign?.name || ''),
    ...reportRow(row.metrics)
  }));
  result.devices = rows(4).map((row) => ({ name: String(row.segments?.device || 'UNKNOWN'), ...reportRow(row.metrics) }));
  return result;
}

export async function googleCampaignDetail(input, campaignId, range) {
  if (!GOOGLE_RANGES.includes(range)) throw new ApiError(422, 'Choose a report range.', 'validation_error');
  const ctx = context(input);
  const id = entityId(campaignId, 'campaign');
  const during = `campaign.id = ${id} AND segments.date DURING ${range}`;
  const queries = {
    campaign: `SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.start_date, campaign.end_date, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${id}`,
    daily: `SELECT segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE ${during} ORDER BY segments.date`,
    groups: `SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros FROM ad_group WHERE campaign.id = ${id} AND ad_group.status != 'REMOVED'`,
    groupStats: `SELECT ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group WHERE ${during}`,
    ads: `SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2, ad_group_ad.status, ad_group_ad.policy_summary.approval_status, ad_group.id FROM ad_group_ad WHERE campaign.id = ${id} AND ad_group_ad.status != 'REMOVED'`,
    adStats: `SELECT ad_group_ad.ad.id, ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad WHERE ${during}`,
    keywords: `SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group.id, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM keyword_view WHERE ${during} ORDER BY metrics.cost_micros DESC LIMIT 100`
  };
  const keys = Object.keys(queries);
  const settled = await Promise.allSettled(keys.map((key) => search(ctx, queries[key], 2)));
  const pick = (key) => {
    const outcome = settled[keys.indexOf(key)];
    return outcome.status === 'fulfilled' ? outcome.value : [];
  };
  if (settled[0].status === 'rejected') throw settled[0].reason;
  const campaignRow = pick('campaign')[0];
  if (!campaignRow?.campaign) throw new ApiError(404, 'Google Ads did not return this campaign.', 'not_found');
  const notes = settled
    .map((outcome, index) => (outcome.status === 'rejected' ? `${keys[index]}: ${outcome.reason?.message || 'failed'}` : null))
    .filter(Boolean);
  const groupStats = new Map(pick('groupStats').map((row) => [String(row.adGroup?.id), row.metrics]));
  const adStats = new Map(pick('adStats').map((row) => [`${row.adGroup?.id}~${row.adGroupAd?.ad?.id}`, row.metrics]));
  const campaign = campaignRow.campaign;
  return {
    range,
    currency: input.currency || '',
    notes,
    campaign: {
      id: String(campaign.id),
      name: String(campaign.name || ''),
      status: campaign.status || '',
      delivery: campaign.primaryStatus || '',
      channel: campaign.advertisingChannelType || '',
      bidding: campaign.biddingStrategyType || '',
      startDate: campaign.startDate || '',
      endDate: campaign.endDate || '',
      budget: major(campaignRow.campaignBudget?.amountMicros)
    },
    daily: pick('daily').map((row) => ({ date: row.segments?.date || '', ...reportRow(row.metrics) })),
    groups: pick('groups').map((row) => ({
      id: String(row.adGroup?.id || ''),
      name: String(row.adGroup?.name || ''),
      status: row.adGroup?.status || '',
      cpcBid: major(row.adGroup?.cpcBidMicros),
      ...reportRow(groupStats.get(String(row.adGroup?.id)))
    })),
    ads: pick('ads').map((row) => {
      const ad = row.adGroupAd?.ad || {};
      const rsa = ad.responsiveSearchAd || {};
      return {
        id: `${row.adGroup?.id}~${ad.id}`,
        groupId: String(row.adGroup?.id || ''),
        name: String(ad.name || ''),
        type: ad.type || '',
        status: row.adGroupAd?.status || '',
        approval: row.adGroupAd?.policySummary?.approvalStatus || '',
        finalUrl: (ad.finalUrls || [])[0] || '',
        path1: rsa.path1 || '',
        path2: rsa.path2 || '',
        headlines: (rsa.headlines || []).map((item) => item.text).filter(Boolean),
        descriptions: (rsa.descriptions || []).map((item) => item.text).filter(Boolean),
        ...reportRow(adStats.get(`${row.adGroup?.id}~${ad.id}`))
      };
    }),
    keywords: pick('keywords').map((row) => ({
      id: `${row.adGroup?.id}~${row.adGroupCriterion?.criterionId}`,
      groupId: String(row.adGroup?.id || ''),
      text: String(row.adGroupCriterion?.keyword?.text || ''),
      matchType: row.adGroupCriterion?.keyword?.matchType || '',
      status: row.adGroupCriterion?.status || '',
      ...reportRow(row.metrics)
    }))
  };
}

export async function suggestGoogleLocations({ refreshToken, query }) {
  const q = String(query || '').trim().slice(0, 60);
  if (!/^[\p{L}\p{N} .,'-]{2,60}$/u.test(q)) return [];
  const data = await call('geoTargetConstants:suggest', {
    refreshToken,
    body: { locale: 'en', countryCode: 'IN', locationNames: { names: [q] } }
  });
  return (data.geoTargetConstantSuggestions || [])
    .map((item) => item.geoTargetConstant || {})
    .filter((item) => /^\d{1,20}$/.test(String(item.id || '')) && (!item.status || item.status === 'ENABLED'))
    .slice(0, 12)
    .map((item) => ({
      id: String(item.id),
      name: String(item.canonicalName || item.name || '').slice(0, 120),
      type: String(item.targetType || '').slice(0, 40)
    }));
}

export async function searchGoogleLanguages(input, query) {
  const q = String(query || '').trim();
  if (!/^[A-Za-z ]{2,30}$/.test(q)) return [];
  const rows = await search(context(input), `SELECT language_constant.id, language_constant.name FROM language_constant WHERE language_constant.targetable = TRUE AND language_constant.name LIKE '%${q}%' LIMIT 10`, 1);
  return rows
    .map((row) => ({ id: String(row.languageConstant?.id || ''), name: String(row.languageConstant?.name || '').slice(0, 80) }))
    .filter((row) => /^\d{1,10}$/.test(row.id) && row.name);
}

export async function googleKeywordIdeas(input, { seeds, url, locations, languageId }) {
  const ctx = context(input);
  const keywords = (seeds || []).map((item) => String(item).trim()).filter(Boolean).slice(0, 10);
  const page = String(url || '').trim();
  if (!keywords.length && !page) throw new ApiError(422, 'Enter a few words or a website to get keyword ideas.', 'validation_error');
  const body = {
    geoTargetConstants: (locations?.length ? locations : [INDIA]).map((id) => `geoTargetConstants/${entityId(id, 'location')}`),
    includeAdultKeywords: false,
    keywordPlanNetwork: 'GOOGLE_SEARCH',
    pageSize: 30
  };
  if (languageId) body.language = `languageConstants/${entityId(languageId, 'language')}`;
  if (keywords.length && page) body.keywordAndUrlSeed = { keywords, url: page };
  else if (keywords.length) body.keywordSeed = { keywords };
  else body.urlSeed = { url: page };
  const data = await call(`customers/${ctx.customerId}:generateKeywordIdeas`, { ...ctx, body });
  return (data.results || []).slice(0, 30).map((row) => ({
    text: String(row.text || '').slice(0, 80),
    searches: row.keywordIdeaMetrics?.avgMonthlySearches == null ? null : String(row.keywordIdeaMetrics.avgMonthlySearches),
    competition: row.keywordIdeaMetrics?.competition || '',
    lowBid: major(row.keywordIdeaMetrics?.lowTopOfPageBidMicros),
    highBid: major(row.keywordIdeaMetrics?.highTopOfPageBidMicros)
  })).filter((row) => row.text);
}

function dateTime(value, endOfDay) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return `${text} ${endOfDay ? '23:59:59' : '00:00:00'}`;
}

function biddingFields(bidding) {
  if (bidding === 'MAXIMIZE_CONVERSIONS') return { maximizeConversions: {} };
  if (bidding === 'MANUAL_CPC') return { manualCpc: { enhancedCpcEnabled: false } };
  return { targetSpend: {} };
}

export async function createGoogleSearchCampaign(input) {
  const ctx = context(input);
  const cid = ctx.customerId;
  let finalUrl;
  try { finalUrl = new URL(input.finalUrl); } catch { throw new ApiError(422, 'Enter a valid website link.', 'validation_error'); }
  if (finalUrl.protocol !== 'https:' && finalUrl.protocol !== 'http:') throw new ApiError(422, 'Enter a valid website link.', 'validation_error');
  if (input.bidding === 'MANUAL_CPC' && !(Number(input.cpcBid) > 0)) throw new ApiError(422, 'Manual CPC needs a max CPC bid.', 'validation_error');
  const budget = `customers/${cid}/campaignBudgets/-1`;
  const campaign = `customers/${cid}/campaigns/-2`;
  const adGroup = `customers/${cid}/adGroups/-3`;
  const today = new Date().toISOString().slice(0, 10);
  const start = input.startDate && input.startDate > today ? dateTime(input.startDate, false) : '';
  const end = dateTime(input.endDate, true);
  if (end && input.endDate < (input.startDate || today)) throw new ApiError(422, 'The end date must be after the start date.', 'validation_error');
  const campaignFields = {
    resourceName: campaign,
    name: String(input.name).slice(0, 180),
    status: 'PAUSED',
    advertisingChannelType: 'SEARCH',
    campaignBudget: budget,
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: Boolean(input.searchPartners),
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false
    },
    geoTargetTypeSetting: { positiveGeoTargetType: input.presenceOnly ? 'PRESENCE' : 'PRESENCE_OR_INTEREST' },
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    ...biddingFields(input.bidding)
  };
  if (start) campaignFields.startDateTime = start;
  if (end) campaignFields.endDateTime = end;
  const locations = [...new Set((input.locations?.length ? input.locations.map((item) => item.id) : [INDIA]).map((id) => entityId(id, 'location')))];
  const languages = [...new Set((input.languages || []).map((item) => entityId(item.id, 'language')))];
  const keywords = [...new Map(input.keywords.map((item) => [`${String(item.text).trim().toLowerCase()}|${item.matchType}`, item])).values()];
  const negatives = [...new Set((input.negatives || []).map((text) => String(text).trim().toLowerCase()).filter(Boolean))];
  const adGroupFields = {
    resourceName: adGroup,
    name: `${String(input.name).slice(0, 160)} ad group`,
    campaign,
    status: 'ENABLED',
    type: 'SEARCH_STANDARD'
  };
  if (input.bidding === 'MANUAL_CPC') adGroupFields.cpcBidMicros = micros(input.cpcBid);
  const responsiveSearchAd = {
    headlines: input.headlines.map((text) => ({ text: String(text).trim() })),
    descriptions: input.descriptions.map((text) => ({ text: String(text).trim() }))
  };
  if (input.path1) responsiveSearchAd.path1 = String(input.path1).trim();
  if (input.path1 && input.path2) responsiveSearchAd.path2 = String(input.path2).trim();
  const mutateOperations = [
    { campaignBudgetOperation: { create: { resourceName: budget, name: `${String(input.name).slice(0, 150)} budget ${Date.now()}`, amountMicros: micros(input.dailyBudget), deliveryMethod: 'STANDARD', explicitlyShared: false } } },
    { campaignOperation: { create: campaignFields } },
    ...locations.map((id) => ({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: `geoTargetConstants/${id}` } } } })),
    ...languages.map((id) => ({ campaignCriterionOperation: { create: { campaign, language: { languageConstant: `languageConstants/${id}` } } } })),
    ...negatives.map((text) => ({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text, matchType: 'BROAD' } } } })),
    { adGroupOperation: { create: adGroupFields } },
    ...keywords.map((item) => ({ adGroupCriterionOperation: { create: { adGroup, status: 'ENABLED', keyword: { text: String(item.text).trim(), matchType: item.matchType } } } })),
    { adGroupAdOperation: { create: { adGroup, status: 'ENABLED', ad: { finalUrls: [finalUrl.toString()], responsiveSearchAd } } } }
  ];
  const data = await call(`customers/${cid}/googleAds:mutate`, { ...ctx, body: { mutateOperations } });
  const created = (data.mutateOperationResponses || []).find((item) => item.campaignResult)?.campaignResult?.resourceName || '';
  const campaignId = String(created).split('/').pop();
  if (!/^\d{1,20}$/.test(campaignId)) throw new ApiError(422, 'Google Ads did not return a campaign.', 'validation_error');
  if (input.publish) await setGoogleCampaignStatus({ ...input, campaignId, status: 'ENABLED' });
  return { campaignId };
}

export async function setGoogleCampaignStatus(input) {
  const ctx = context(input);
  const id = entityId(input.campaignId, 'campaign');
  if (input.status !== 'ENABLED' && input.status !== 'PAUSED') {
    throw new ApiError(422, 'Status must be enabled or paused.', 'validation_error');
  }
  await call(`customers/${ctx.customerId}/campaigns:mutate`, {
    ...ctx,
    body: { operations: [{ update: { resourceName: `customers/${ctx.customerId}/campaigns/${id}`, status: input.status }, updateMask: 'status' }] }
  });
}

export async function editGoogleCampaign(input) {
  const ctx = context(input);
  const id = entityId(input.campaignId, 'campaign');
  if (input.dailyBudget) {
    const [row] = await search(ctx, `SELECT campaign.campaign_budget, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${id} LIMIT 1`, 1);
    const budget = row?.campaign?.campaignBudget;
    if (!budget) throw new ApiError(422, 'Google Ads did not return the campaign budget.', 'validation_error');
    if (row.campaignBudget?.explicitlyShared) throw new ApiError(422, 'This campaign uses a shared budget. Change it in Google Ads.', 'validation_error');
    await call(`customers/${ctx.customerId}/campaignBudgets:mutate`, {
      ...ctx,
      body: { operations: [{ update: { resourceName: budget, amountMicros: micros(input.dailyBudget) }, updateMask: 'amount_micros' }] }
    });
  }
  const update = { resourceName: `customers/${ctx.customerId}/campaigns/${id}` };
  const mask = [];
  if (input.name) { update.name = String(input.name).slice(0, 180); mask.push('name'); }
  if (input.status === 'ENABLED' || input.status === 'PAUSED') { update.status = input.status; mask.push('status'); }
  if (!mask.length && !input.dailyBudget) throw new ApiError(422, 'Nothing to update.', 'validation_error');
  if (mask.length) {
    await call(`customers/${ctx.customerId}/campaigns:mutate`, {
      ...ctx,
      body: { operations: [{ update, updateMask: mask.join(',') }] }
    });
  }
}
