import { insert, many, one, run } from '../db/sql.js';

const AD_FIELDS = `a.id, a.competitor_id AS competitorId, a.platform, a.external_id AS externalId, a.advertiser, a.format, a.headline, a.body, a.cta,
  a.link, a.image_url AS imageUrl, a.placements, a.versions, a.status, DATE_FORMAT(a.first_shown, '%Y-%m-%d') AS firstShown,
  DATE_FORMAT(a.last_shown, '%Y-%m-%d') AS lastShown, a.source, a.source_url AS sourceUrl, a.content_hash AS contentHash,
  a.first_observed_at AS firstObservedAt, a.last_observed_at AS lastObservedAt, a.analysis, a.analysis_model AS analysisModel,
  a.analysis_version AS analysisVersion, a.analyzed_at AS analyzedAt`;

export function adsByExternalIds(organizationId, competitorId, platform, externalIds) {
  if (!externalIds.length) return Promise.resolve([]);
  return many(
    `SELECT id, external_id AS externalId, content_hash AS contentHash, status FROM competitor_ads
     WHERE organization_id = ? AND competitor_id = ? AND platform = ? AND external_id IN (?)`,
    [organizationId, competitorId, platform, externalIds]
  );
}

export function insertAd(row) {
  return insert(
    `INSERT INTO competitor_ads (organization_id, competitor_id, platform, external_id, advertiser, format, headline, body, cta, link, image_url,
       placements, versions, status, first_shown, last_shown, source, source_url, content_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.organizationId, row.competitorId, row.platform, row.externalId, row.advertiser || null, row.format || null, row.headline || null,
      row.body || null, row.cta || null, row.link || null, row.imageUrl || null, JSON.stringify(row.placements || []), row.versions || 1,
      row.status, row.firstShown || null, row.lastShown || null, row.source, row.sourceUrl || null, row.contentHash]
  );
}

export function updateAd(organizationId, id, row) {
  return run(
    `UPDATE competitor_ads SET advertiser = ?, format = ?, headline = ?, body = ?, cta = ?, link = ?, image_url = COALESCE(?, image_url),
       placements = ?, versions = ?, status = ?, first_shown = COALESCE(first_shown, ?), last_shown = COALESCE(?, last_shown),
       source_url = ?, content_hash = ?, last_observed_at = UTC_TIMESTAMP()
     WHERE organization_id = ? AND id = ?`,
    [row.advertiser || null, row.format || null, row.headline || null, row.body || null, row.cta || null, row.link || null, row.imageUrl || null,
      JSON.stringify(row.placements || []), row.versions || 1, row.status, row.firstShown || null, row.lastShown || null, row.sourceUrl || null,
      row.contentHash, organizationId, id]
  );
}

export function activeAdsNotIn(organizationId, competitorId, platform, keepIds) {
  return many(
    `SELECT id, content_hash AS contentHash, headline, body, cta, link, format FROM competitor_ads
     WHERE organization_id = ? AND competitor_id = ? AND platform = ? AND status = 'active'${keepIds.length ? ' AND id NOT IN (?)' : ''}`,
    keepIds.length ? [organizationId, competitorId, platform, keepIds] : [organizationId, competitorId, platform]
  );
}

export function setAdsInactive(organizationId, ids) {
  if (!ids.length) return Promise.resolve(null);
  return run(`UPDATE competitor_ads SET status = 'inactive' WHERE organization_id = ? AND id IN (?)`, [organizationId, ids]);
}

export function addSnapshot(organizationId, { adId, checkId, change, contentHash, status, payload }) {
  return insert(
    `INSERT INTO competitor_ad_snapshots (organization_id, ad_id, check_id, change_type, content_hash, status, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, adId, checkId || null, change, contentHash, status, JSON.stringify(payload)]
  );
}

export function pendingAnalysis(organizationId, version, limit) {
  return many(
    `SELECT a.id, a.competitor_id AS competitorId, a.platform, a.format, a.headline, a.body, a.cta, a.link, a.content_hash AS contentHash, c.name AS competitor
     FROM competitor_ads a JOIN competitors c ON c.id = a.competitor_id AND c.organization_id = a.organization_id
     WHERE a.organization_id = ? AND (a.analysis_hash IS NULL OR a.analysis_hash <> a.content_hash OR a.analysis_version < ?)
     ORDER BY a.status = 'active' DESC, a.id DESC
     LIMIT ?`,
    [organizationId, version, limit]
  );
}

export function analysisByHashes(organizationId, hashes, version) {
  if (!hashes.length) return Promise.resolve([]);
  return many(
    `SELECT analysis_hash AS hash, analysis, analysis_model AS model FROM competitor_ads
     WHERE organization_id = ? AND analysis_hash IN (?) AND analysis_hash = content_hash AND analysis_version >= ? AND analysis IS NOT NULL`,
    [organizationId, hashes, version]
  );
}

export function saveAnalysis(organizationId, id, { analysis, hash, model, version }) {
  return run(
    `UPDATE competitor_ads SET analysis = ?, analysis_hash = ?, analysis_model = ?, analysis_version = ?, analyzed_at = UTC_TIMESTAMP()
     WHERE organization_id = ? AND id = ?`,
    [JSON.stringify(analysis), hash, model || null, version, organizationId, id]
  );
}

export function organizationsWithPending(version, limit) {
  return many(
    `SELECT DISTINCT organization_id AS organizationId FROM competitor_ads
     WHERE analysis_hash IS NULL OR analysis_hash <> content_hash OR analysis_version < ?
     LIMIT ?`,
    [version, limit]
  );
}

const FILTERS = {
  competitorId: ['a.competitor_id = ?', Number],
  platform: ['a.platform = ?', String],
  format: ['a.format = ?', String],
  status: ['a.status = ?', String],
  from: ['COALESCE(a.first_shown, DATE(a.first_observed_at)) >= ?', String],
  to: ['COALESCE(a.first_shown, DATE(a.first_observed_at)) <= ?', String],
  cta: [`JSON_UNQUOTE(JSON_EXTRACT(a.analysis, '$.cta')) = ?`, String],
  offer: [`JSON_CONTAINS(JSON_EXTRACT(a.analysis, '$.offers'), JSON_QUOTE(?))`, String],
  theme: [`JSON_CONTAINS(JSON_EXTRACT(a.analysis, '$.themes'), JSON_QUOTE(?))`, String],
  style: [`JSON_CONTAINS(JSON_EXTRACT(a.analysis, '$.styles'), JSON_QUOTE(?))`, String],
  confidence: [`JSON_UNQUOTE(JSON_EXTRACT(a.analysis, '$.confidence')) = ?`, String],
  competitorType: ['c.competitor_type = ?', String],
  city: ['c.city = ?', String]
};

export function listAds(organizationId, filters = {}, limit = 200) {
  const where = ['a.organization_id = ?'];
  const params = [organizationId];
  for (const [key, [clause, cast]] of Object.entries(FILTERS)) {
    if (filters[key] === undefined || filters[key] === '' || filters[key] === null) continue;
    where.push(clause);
    params.push(cast(filters[key]));
  }
  params.push(limit);
  return many(
    `SELECT ${AD_FIELDS}, c.name AS competitor, c.competitor_type AS competitorType, c.city
     FROM competitor_ads a JOIN competitors c ON c.id = a.competitor_id AND c.organization_id = a.organization_id
     WHERE ${where.join(' AND ')}
     ORDER BY a.status = 'active' DESC, COALESCE(a.first_shown, DATE(a.first_observed_at)) ASC, a.id DESC
     LIMIT ?`,
    params
  );
}

export function adById(organizationId, id) {
  return one(
    `SELECT ${AD_FIELDS}, c.name AS competitor, c.competitor_type AS competitorType
     FROM competitor_ads a JOIN competitors c ON c.id = a.competitor_id AND c.organization_id = a.organization_id
     WHERE a.organization_id = ? AND a.id = ?`,
    [organizationId, id]
  );
}

export async function sameCopyCount(organizationId, competitorId, contentHash) {
  const row = await one(
    `SELECT COUNT(*) AS total, SUM(status = 'active') AS active FROM competitor_ads
     WHERE organization_id = ? AND competitor_id = ? AND content_hash = ?`,
    [organizationId, competitorId, contentHash]
  );
  return { total: Number(row?.total || 0), active: Number(row?.active || 0) };
}

export function adSnapshots(organizationId, adId) {
  return many(
    `SELECT id, change_type AS changeType, content_hash AS contentHash, status, payload, observed_at AS observedAt
     FROM competitor_ad_snapshots WHERE organization_id = ? AND ad_id = ? ORDER BY id DESC LIMIT 30`,
    [organizationId, adId]
  );
}

export function competitorSnapshots(organizationId, competitorId) {
  return many(
    `SELECT s.id, s.ad_id AS adId, s.change_type AS changeType, s.status, s.payload, s.observed_at AS observedAt, a.platform
     FROM competitor_ad_snapshots s JOIN competitor_ads a ON a.id = s.ad_id AND a.organization_id = s.organization_id
     WHERE s.organization_id = ? AND a.competitor_id = ? ORDER BY s.id DESC LIMIT 300`,
    [organizationId, competitorId]
  );
}

export function marketAds(organizationId) {
  return many(
    `SELECT a.id, a.competitor_id AS competitorId, a.platform, a.format, a.status, a.analysis, a.link,
       DATE_FORMAT(a.first_shown, '%Y-%m-%d') AS firstShown, c.name AS competitor, c.competitor_type AS competitorType
     FROM competitor_ads a JOIN competitors c ON c.id = a.competitor_id AND c.organization_id = a.organization_id
     WHERE a.organization_id = ? AND c.status = 'active'
     ORDER BY a.id DESC
     LIMIT 2000`,
    [organizationId]
  );
}

export function competitorRows(organizationId) {
  return many(
    `SELECT c.id, c.name, c.website, c.city, c.competitor_type AS competitorType, c.confidence, c.verified_at AS verifiedAt,
       c.last_analyzed_at AS lastAnalyzedAt,
       (SELECT MAX(x.finished_at) FROM competitor_ad_checks x WHERE x.competitor_id = c.id AND x.organization_id = c.organization_id AND x.status = 'ready') AS adsCheckedAt
     FROM competitors c WHERE c.organization_id = ? AND c.status = 'active' ORDER BY c.name`,
    [organizationId]
  );
}

export function latestInsight(organizationId, competitorId, kind) {
  return one(
    `SELECT id, input_hash AS inputHash, payload, model, version, created_at AS createdAt FROM competitor_insights
     WHERE organization_id = ? AND competitor_id = ? AND kind = ? ORDER BY id DESC LIMIT 1`,
    [organizationId, competitorId, kind]
  );
}

export function addInsight(organizationId, { competitorId, kind, inputHash, payload, model, version }) {
  return insert(
    `INSERT INTO competitor_insights (organization_id, competitor_id, kind, input_hash, payload, model, version) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, competitorId, kind, inputHash, JSON.stringify(payload), model || null, version]
  );
}
