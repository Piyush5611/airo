import { ApiError } from '../utils/errors.js';

const VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${VERSION}`;
const OFFSET = { JPY: 1, KRW: 1, VND: 1, CLP: 1, ISK: 1, PYG: 1 };

const OBJECTIVES = ['OUTCOME_LEADS', 'OUTCOME_TRAFFIC', 'OUTCOME_AWARENESS', 'OUTCOME_SALES'];

function quiet() {
  return new ApiError(422, 'The API did not respond.', 'validation_error');
}

function metaError(data) {
  const message = String(data?.error?.message || 'Meta Ads rejected the request.')
    .replace(/access_token=[^&\s]+/gi, '')
    .slice(0, 240);
  return new ApiError(422, message, 'validation_error');
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
  const type = String(fragment.ad_object_type || '').toLowerCase().replace(/[\s-]+/g, '_');
  return type === 'campaign' || type.endsWith('_campaign');
}

async function draftCampaigns(act, token, publishedIds, currency) {
  let drafts = [];
  try {
    drafts = await list(`act_${act}/addrafts`, token, { fields: 'id,name,ad_object_id' });
  } catch {
    return [];
  }
  const seen = new Set(publishedIds.map(String));
  const objects = [];
  for (const draft of drafts) {
    let fragments = [];
    try {
      fragments = await list(`${draft.id}/addraft_fragments`, token, {
        fields: 'id,name,ad_object_id,ad_object_type,ad_object_name,budget,values'
      });
    } catch {
      fragments = [];
    }
    const rows = fragments.filter(isCampaignFragment);
    const source = rows.length ? rows : (!fragments.length && draft.name ? [draft] : []);
    for (const fragment of source) {
      const values = fragmentValues(fragment);
      const externalId = String(fragment.ad_object_id || fragment.id || '').slice(0, 80);
      if (!externalId || seen.has(externalId)) continue;
      seen.add(externalId);
      objects.push({
        type: 'campaign',
        externalId,
        name: String(fragment.ad_object_name || values.name || fragment.name || draft.name || 'Draft campaign').slice(0, 180),
        parent: null,
        payload: {
          origin: 'api',
          status: 'DRAFT',
          delivery: 'IN_DRAFT',
          objective: values.objective || '',
          budget: major(values.daily_budget || values.lifetime_budget || fragment.budget, currency),
          budgetKind: values.daily_budget ? 'daily' : '',
          currency,
          spend: null,
          impressions: null,
          clicks: null,
          reach: null,
          leads: null
        }
      });
    }
  }
  return objects;
}

export async function verifyMetaAccount({ apiKey, accountId }) {
  try {
    await graph(`act_${actId(accountId)}`, apiKey, { fields: 'id,name,currency' });
  } catch (error) {
    if (error.message === 'The API did not respond.') throw error;
    if (error.message.startsWith('Account id must look like')) throw error;
    throw new ApiError(422, 'Wrong API.', 'validation_error');
  }
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
  const drafts = await draftCampaigns(act, apiKey, campaigns.map((row) => row.id), currency);
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
  const summary = insightNote
    ? `Meta returned ${campaigns.length} campaigns and ${drafts.length} drafts. Report failed: ${insightNote}`
    : `Meta returned ${campaigns.length} campaigns and ${drafts.length} drafts for the last 30 days.`;
  return {
    mode: 'live',
    providerKey: 'meta_ads',
    summary: summary.slice(0, 250),
    replaceTypes: ['campaign', 'adset', 'ad'],
    objects
  };
}

export async function createMetaCampaign({ apiKey, accountId, name, objective, dailyBudget, status }) {
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
  const created = await graph(`act_${act}/campaigns`, apiKey, {
    name: String(name).slice(0, 180),
    objective,
    status: status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
    special_ad_categories: JSON.stringify(['HOUSING']),
    daily_budget: String(budget),
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP'
  }, 'POST');
  if (!created.id) throw new ApiError(422, 'Meta Ads did not return a campaign.', 'validation_error');
  return { id: String(created.id), currency: account.currency || '' };
}

export async function setMetaCampaignStatus({ apiKey, campaignId, status }) {
  if (!/^\d{5,20}$/.test(String(campaignId || ''))) {
    throw new ApiError(422, 'Unknown Meta campaign.', 'validation_error');
  }
  if (status !== 'ACTIVE' && status !== 'PAUSED') {
    throw new ApiError(422, 'Status must be active or paused.', 'validation_error');
  }
  await graph(String(campaignId), apiKey, { status }, 'POST');
}
