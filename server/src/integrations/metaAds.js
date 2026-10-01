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

export async function listMetaPages({ apiKey }) {
  const rows = await list('me/accounts', apiKey, { fields: 'id,name', limit: '50' });
  return rows
    .filter((row) => row.id && row.name)
    .map((row) => ({ id: String(row.id), name: String(row.name).slice(0, 180) }));
}

const AD_PLANS = {
  OUTCOME_TRAFFIC: { goal: 'LINK_CLICKS', destination: 'WEBSITE', cta: 'LEARN_MORE', lead: false },
  OUTCOME_AWARENESS: { goal: 'REACH', destination: 'WEBSITE', cta: 'LEARN_MORE', lead: false },
  OUTCOME_LEADS: { goal: 'LEAD_GENERATION', destination: 'ON_AD', cta: 'SIGN_UP', lead: true },
  OUTCOME_SALES: { goal: 'LINK_CLICKS', destination: 'WEBSITE', cta: 'SHOP_NOW', lead: false }
};

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
  const rows = await list('me/accounts', apiKey, { fields: 'id,access_token', limit: '50' });
  const page = rows.find((row) => String(row.id) === String(pageId));
  if (!page?.access_token) {
    throw new ApiError(422, 'This token cannot advertise for that Facebook Page.', 'validation_error');
  }
  return page.access_token;
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

export async function createMetaAd({ apiKey, accountId, name, objective, dailyBudget, pageId, headline, message, link, imageBase64, country, publish }) {
  const plan = AD_PLANS[objective];
  if (!plan) throw new ApiError(422, 'Choose a Meta campaign objective.', 'validation_error');
  const website = new URL(link);
  if (website.protocol !== 'https:') throw new ApiError(422, 'The website link must start with https.', 'validation_error');
  const bytes = imageBytes(imageBase64);
  const act = actId(accountId);
  const account = await graph(`act_${act}`, apiKey, { fields: 'currency' });
  const budget = Math.round(Number(dailyBudget) * (OFFSET[account.currency] || 100));
  if (!Number.isFinite(budget) || budget < 1) throw new ApiError(422, 'Enter a daily budget.', 'validation_error');
  const pageToken = await pageAccessToken(apiKey, pageId);
  const imageHash = await uploadImage(act, apiKey, bytes);
  const formId = plan.lead ? await createLeadForm(pageId, pageToken, name, website.toString()) : '';
  const campaign = await graph(`act_${act}/campaigns`, apiKey, {
    name: String(name).slice(0, 180),
    objective,
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(['HOUSING']),
    is_adset_budget_sharing_enabled: 'false'
  }, 'POST');
  if (!campaign.id) throw new ApiError(422, 'Meta Ads did not return a campaign.', 'validation_error');
  const adsetParams = {
    name: `${name} ad set`.slice(0, 180),
    campaign_id: campaign.id,
    daily_budget: String(budget),
    billing_event: 'IMPRESSIONS',
    optimization_goal: plan.goal,
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: plan.destination,
    targeting: JSON.stringify({
      geo_locations: { countries: [country || 'IN'] },
      targeting_automation: { advantage_audience: 0 }
    }),
    status: 'PAUSED'
  };
  if (plan.lead) adsetParams.promoted_object = JSON.stringify({ page_id: pageId });
  const adset = await graph(`act_${act}/adsets`, apiKey, adsetParams, 'POST');
  if (!adset.id) throw new ApiError(422, 'Meta Ads did not return an ad set.', 'validation_error');
  const linkData = {
    message: String(message).slice(0, 500),
    name: String(headline).slice(0, 80),
    image_hash: imageHash,
    link: plan.lead ? 'https://fb.me/' : website.toString(),
    call_to_action: plan.lead
      ? { type: plan.cta, value: { lead_gen_form_id: formId } }
      : { type: plan.cta, value: { link: website.toString() } }
  };
  const creative = await graph(`act_${act}/adcreatives`, apiKey, {
    name: `${name} creative`.slice(0, 180),
    object_story_spec: JSON.stringify({ page_id: pageId, link_data: linkData })
  }, 'POST');
  if (!creative.id) throw new ApiError(422, 'Meta Ads did not return an ad creative.', 'validation_error');
  const ad = await graph(`act_${act}/ads`, apiKey, {
    name: `${name} ad`.slice(0, 180),
    adset_id: adset.id,
    creative: JSON.stringify({ creative_id: creative.id }),
    status: 'PAUSED'
  }, 'POST');
  if (!ad.id) throw new ApiError(422, 'Meta Ads did not return an ad.', 'validation_error');
  if (publish) {
    await setMetaCampaignStatus({ apiKey, campaignId: String(campaign.id), status: 'ACTIVE' });
  }
  return { campaignId: String(campaign.id), adsetId: String(adset.id), adId: String(ad.id) };
}
