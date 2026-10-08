import { ApiError } from '../utils/errors.js';

const BASE = 'https://api.apify.com/v2';

export const ACTORS = {
  google: 'apify~google-search-scraper',
  meta: 'apify~facebook-ads-scraper',
  maps: 'compass~crawler-google-places',
  googleAds: 'scrapesage~google-ads-transparency-scraper'
};

// Apify rejects a maxTotalChargeUsd below $0.50; maxItems keeps the real charge far lower.
const MIN_CHARGE_USD = 0.5;

// maxTotalChargeUsd caps what one run may bill on pay-per-event actors.
export async function runActor(token, actor, input, { maxItems, maxChargeUsd, timeoutSecs = 180 }) {
  const url = new URL(`${BASE}/acts/${actor}/run-sync-get-dataset-items`);
  url.searchParams.set('timeout', String(timeoutSecs));
  url.searchParams.set('format', 'json');
  url.searchParams.set('clean', 'true');
  if (maxItems) url.searchParams.set('maxItems', String(maxItems));
  if (maxChargeUsd) url.searchParams.set('maxTotalChargeUsd', String(Math.max(MIN_CHARGE_USD, maxChargeUsd)));
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((timeoutSecs + 60) * 1000)
    });
  } catch {
    throw new ApiError(502, 'Apify did not answer in time.', 'apify_unreachable');
  }
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!response.ok) {
    const reason = String(body?.error?.message || `Apify answered ${response.status}`).replace(/token=\S+/gi, '').slice(0, 200);
    if (response.status === 401 || response.status === 403) throw new ApiError(422, 'The Apify token is not accepted. A platform admin must update it in Research tools.', 'apify_auth');
    if (response.status === 402) throw new ApiError(422, 'Apify credit is used up for this month.', 'apify_credit');
    throw new ApiError(502, reason, 'apify_failed');
  }
  return Array.isArray(body) ? body : [];
}

export function googleSearch(token, queries) {
  return runActor(token, ACTORS.google, {
    queries: queries.join('\n'),
    countryCode: 'in',
    languageCode: 'en',
    maxPagesPerQuery: 1,
    focusOnPaidAds: false,
    mobileResults: false,
    saveHtml: false
  }, { maxItems: queries.length, maxChargeUsd: 0.1, timeoutSecs: 240 });
}

export function adLibraryUrl(keyword, country = 'IN') {
  const url = new URL('https://www.facebook.com/ads/library/');
  url.searchParams.set('active_status', 'active');
  url.searchParams.set('ad_type', 'all');
  url.searchParams.set('country', country);
  url.searchParams.set('q', keyword);
  url.searchParams.set('search_type', 'keyword_unordered');
  url.searchParams.set('media_type', 'all');
  return url.toString();
}

export function metaKeywordAds(token, keywords, perKeyword = 20) {
  return runActor(token, ACTORS.meta, {
    startUrls: keywords.map((keyword) => ({ url: adLibraryUrl(keyword) })),
    resultsLimit: perKeyword
  }, { maxItems: keywords.length * perKeyword, maxChargeUsd: 0.4 });
}

// Accepts a Facebook page URL or an Ad Library URL.
export function metaAdsFrom(token, url, limit = 30) {
  return runActor(token, ACTORS.meta, {
    startUrls: [{ url }],
    resultsLimit: limit
  }, { maxItems: limit, maxChargeUsd: 0.2 });
}

export function googleTransparencyAds(token, { domain = '', name = '' }, limit = 30) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  return runActor(token, ACTORS.googleAds, {
    ...(domain ? { domains: [domain] } : { queries: [name], maxAdvertisersPerQuery: 1 }),
    resultType: 'ads',
    region: 'IN',
    startDate: since,
    maxAdsPerSearch: limit,
    includeDetails: false
  }, { maxItems: limit, maxChargeUsd: 0.2, timeoutSecs: 240 });
}

export function mapsPlaces(token, searches, location, perSearch = 15) {
  return runActor(token, ACTORS.maps, {
    searchStringsArray: searches,
    locationQuery: location,
    maxCrawledPlacesPerSearch: perSearch,
    language: 'en',
    skipClosedPlaces: true,
    scrapePlaceDetailPage: false,
    scrapeContacts: false,
    maxReviews: 0,
    maxImages: 0
  }, { maxItems: searches.length * perSearch, maxChargeUsd: 0.25 });
}
