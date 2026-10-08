import { insert, many, one, run } from '../db/sql.js';

const FIELDS = `id, name, website, facebook, instagram, city, notes, status, last_analyzed_at AS lastAnalyzedAt,
  competitor_type AS competitorType, confidence, source, reason, verified_at AS verifiedAt,
  created_at AS createdAt, updated_at AS updatedAt,
  (SELECT GROUP_CONCAT(co.offering_id ORDER BY co.offering_id) FROM competitor_offerings co WHERE co.competitor_id = competitors.id) AS offeringIds`;

export function list(organizationId) {
  return many(
    `SELECT ${FIELDS},
       (SELECT JSON_UNQUOTE(JSON_EXTRACT(r.analysis, '$.summary')) FROM competitor_reports r
         WHERE r.competitor_id = competitors.id AND r.status = 'ready' ORDER BY r.id DESC LIMIT 1) AS summary,
       (SELECT JSON_UNQUOTE(JSON_EXTRACT(r.analysis, '$.threat')) FROM competitor_reports r
         WHERE r.competitor_id = competitors.id AND r.status = 'ready' ORDER BY r.id DESC LIMIT 1) AS threat
     FROM competitors
     WHERE organization_id = ?
     ORDER BY status = 'archived', name`,
    [organizationId]
  );
}

export function byId(organizationId, id) {
  return one(`SELECT ${FIELDS} FROM competitors WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function byName(organizationId, name) {
  return one(`SELECT id FROM competitors WHERE organization_id = ? AND LOWER(name) = LOWER(?)`, [organizationId, name]);
}

export function create(organizationId, row) {
  return insert(
    `INSERT INTO competitors (organization_id, name, website, facebook, instagram, city, notes, competitor_type, confidence, source, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, row.name, row.website || null, row.facebook || null, row.instagram || null, row.city || null, row.notes || null,
      row.competitorType || null, row.confidence ?? null, row.source || 'manual', row.reason || null]
  );
}

export function update(organizationId, id, row) {
  return run(
    `UPDATE competitors SET name = ?, website = ?, facebook = ?, instagram = ?, city = ?, notes = ?, status = ?, competitor_type = ?
     WHERE organization_id = ? AND id = ?`,
    [row.name, row.website || null, row.facebook || null, row.instagram || null, row.city || null, row.notes || null, row.status,
      row.competitorType || null, organizationId, id]
  );
}

export function setVerified(organizationId, id, verified) {
  return run(
    `UPDATE competitors SET verified_at = ${verified ? 'UTC_TIMESTAMP()' : 'NULL'} WHERE organization_id = ? AND id = ?`,
    [organizationId, id]
  );
}

export function fillDiscovery(organizationId, id, { competitorType, confidence, source, reason }) {
  return run(
    `UPDATE competitors SET competitor_type = COALESCE(competitor_type, ?), confidence = COALESCE(confidence, ?),
       source = COALESCE(NULLIF(source, 'manual'), ?), reason = COALESCE(NULLIF(reason, ''), ?)
     WHERE organization_id = ? AND id = ?`,
    [competitorType || null, confidence ?? null, source || null, reason || null, organizationId, id]
  );
}

export function fillMissing(organizationId, id, { website, facebook, city }) {
  return run(
    `UPDATE competitors SET website = COALESCE(NULLIF(website, ''), ?), facebook = COALESCE(NULLIF(facebook, ''), ?), city = COALESCE(NULLIF(city, ''), ?)
     WHERE organization_id = ? AND id = ?`,
    [website || null, facebook || null, city || null, organizationId, id]
  );
}

export function remove(organizationId, id) {
  return run(`DELETE FROM competitors WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function markAnalyzed(organizationId, id) {
  return run(`UPDATE competitors SET last_analyzed_at = UTC_TIMESTAMP() WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function addReport(row) {
  return insert(
    `INSERT INTO competitor_reports (organization_id, competitor_id, status, website, keywords, analysis, notes, model)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.organizationId, row.competitorId, row.status,
      row.website ? JSON.stringify(row.website) : null,
      row.keywords ? JSON.stringify(row.keywords) : null,
      row.analysis ? JSON.stringify(row.analysis) : null,
      JSON.stringify(row.notes || []),
      row.model || null
    ]
  );
}

export function latestReport(organizationId, competitorId) {
  return one(
    `SELECT id, status, website, keywords, analysis, notes, model, created_at AS createdAt
     FROM competitor_reports WHERE organization_id = ? AND competitor_id = ? ORDER BY id DESC LIMIT 1`,
    [organizationId, competitorId]
  );
}

export function reportHistory(organizationId, competitorId) {
  return many(
    `SELECT id, status, model, created_at AS createdAt FROM competitor_reports
     WHERE organization_id = ? AND competitor_id = ? ORDER BY id DESC LIMIT 10`,
    [organizationId, competitorId]
  );
}

export function readyReports(organizationId, limit = 5, offeringId = 0) {
  return many(
    `SELECT c.name, c.city, r.analysis, r.created_at AS createdAt
     FROM competitors c
     JOIN competitor_reports r ON r.id = (
       SELECT MAX(x.id) FROM competitor_reports x WHERE x.competitor_id = c.id AND x.status = 'ready'
     )
     WHERE c.organization_id = ? AND c.status = 'active'
     ORDER BY EXISTS (SELECT 1 FROM competitor_offerings co WHERE co.competitor_id = c.id AND co.offering_id = ?) DESC, r.created_at DESC
     LIMIT ?`,
    [organizationId, offeringId, limit]
  );
}

export function organizationName(organizationId) {
  return one(`SELECT name FROM organizations WHERE id = ?`, [organizationId]);
}

export function knownCompetitors(organizationId) {
  return many(
    `SELECT id, name, website,
       (SELECT GROUP_CONCAT(co.offering_id) FROM competitor_offerings co WHERE co.competitor_id = competitors.id) AS offeringIds
     FROM competitors WHERE organization_id = ?`,
    [organizationId]
  );
}

export async function setOfferings(organizationId, competitorId, offeringIds) {
  await run(`DELETE FROM competitor_offerings WHERE organization_id = ? AND competitor_id = ?`, [organizationId, competitorId]);
  if (!offeringIds.length) return null;
  return run(
    `INSERT IGNORE INTO competitor_offerings (competitor_id, offering_id, organization_id)
     SELECT ?, id, organization_id FROM offerings WHERE organization_id = ? AND id IN (?)`,
    [competitorId, organizationId, offeringIds]
  );
}

export function linkOffering(organizationId, competitorId, offeringId) {
  return run(
    `INSERT IGNORE INTO competitor_offerings (competitor_id, offering_id, organization_id)
     SELECT ?, id, organization_id FROM offerings WHERE organization_id = ? AND id = ?`,
    [competitorId, organizationId, offeringId]
  );
}

export function linkedOfferings(organizationId, competitorId) {
  return many(
    `SELECT f.id, f.kind, f.name, f.details, f.usps, f.offer, f.price_text AS priceText, f.locations, f.website
     FROM competitor_offerings co JOIN offerings f ON f.id = co.offering_id
     WHERE co.organization_id = ? AND co.competitor_id = ?
     ORDER BY f.name`,
    [organizationId, competitorId]
  );
}

export function linkCounts(organizationId) {
  return many(
    `SELECT co.offering_id AS offeringId, COUNT(*) AS total
     FROM competitor_offerings co JOIN competitors c ON c.id = co.competitor_id AND c.status = 'active'
     WHERE co.organization_id = ? GROUP BY co.offering_id`,
    [organizationId]
  );
}

export function startRun(organizationId, offeringId, trigger) {
  return insert(
    `INSERT INTO competitor_discovery_runs (organization_id, offering_id, trigger_type) VALUES (?, ?, ?)`,
    [organizationId, offeringId, trigger]
  );
}

export function finishRun(id, { status, plan, counts, notes }) {
  return run(
    `UPDATE competitor_discovery_runs SET status = ?, plan = ?, counts = ?, notes = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?`,
    [status, plan ? JSON.stringify(plan) : null, counts ? JSON.stringify(counts) : null, JSON.stringify(notes || []), id]
  );
}

export function latestRun(organizationId, offeringId = 0) {
  return one(
    `SELECT id, offering_id AS offeringId, trigger_type AS triggerType, status, plan, counts, notes, started_at AS startedAt, finished_at AS finishedAt
     FROM competitor_discovery_runs WHERE organization_id = ? AND offering_id = ? ORDER BY id DESC LIMIT 1`,
    [organizationId, offeringId]
  );
}

export function closeInterruptedRuns() {
  return run(
    `UPDATE competitor_discovery_runs SET status = 'failed', notes = JSON_ARRAY('AIRO restarted while this search was running. Press Find competitors again.'), finished_at = UTC_TIMESTAMP()
     WHERE status = 'running'`
  );
}

export function closeStaleRuns() {
  return run(
    `UPDATE competitor_discovery_runs SET status = 'failed', notes = JSON_ARRAY('The search was stopped before it finished.'), finished_at = UTC_TIMESTAMP()
     WHERE status = 'running' AND started_at < UTC_TIMESTAMP() - INTERVAL 20 MINUTE`
  );
}

const RECENT_RUN = `SELECT 1 FROM competitor_discovery_runs r
  WHERE r.organization_id = o.id AND r.offering_id = %s AND r.started_at > UTC_TIMESTAMP() - INTERVAL 7 DAY`;

export function businessesDue() {
  return many(
    `SELECT o.id AS organizationId, 0 AS offeringId
     FROM organizations o
     WHERE o.status IN ('active', 'onboarding')
       AND (
         EXISTS (SELECT 1 FROM offerings f WHERE f.organization_id = o.id AND f.status = 'active')
         OR EXISTS (SELECT 1 FROM business_profiles b WHERE b.organization_id = o.id)
       )
       AND NOT EXISTS (${RECENT_RUN.replace('%s', '0')})
     ORDER BY o.id
     LIMIT 50`
  );
}

export function activeProjects() {
  return many(
    `SELECT f.organization_id AS organizationId, f.id AS offeringId,
       EXISTS (${RECENT_RUN.replace('%s', 'f.id')}) AS searchedRecently
     FROM offerings f JOIN organizations o ON o.id = f.organization_id
     WHERE f.status = 'active' AND o.status IN ('active', 'onboarding')
     ORDER BY f.organization_id, f.last_used_at IS NULL, f.last_used_at DESC, f.updated_at DESC
     LIMIT 2000`
  );
}

export function saveSuggestion(organizationId, offeringId, row) {
  return run(
    `INSERT INTO competitor_suggestions (organization_id, offering_id, match_key, name, website, facebook, city, category, sources, score, verdict, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), website = COALESCE(VALUES(website), website), facebook = COALESCE(VALUES(facebook), facebook),
       city = COALESCE(VALUES(city), city), category = COALESCE(VALUES(category), category), sources = VALUES(sources),
       score = VALUES(score), verdict = VALUES(verdict), reason = VALUES(reason), last_seen_at = UTC_TIMESTAMP()`,
    [organizationId, offeringId, row.matchKey, row.name, row.website || null, row.facebook || null, row.city || null, row.category || null,
      JSON.stringify(row.sources || []), row.score, row.verdict, row.reason || null]
  );
}

// Suggestions the owner never acted on are replaced by the latest search; added and ignored ones stay.
export function dropUnseenSuggestions(organizationId, offeringId, keepKeys) {
  return run(
    `DELETE FROM competitor_suggestions WHERE organization_id = ? AND offering_id = ? AND status = 'new'${keepKeys.length ? ' AND match_key NOT IN (?)' : ''}`,
    keepKeys.length ? [organizationId, offeringId, keepKeys] : [organizationId, offeringId]
  );
}

export function suggestions(organizationId, offeringId = 0) {
  return many(
    `SELECT id, offering_id AS offeringId, name, website, facebook, city, category, sources, score, verdict, reason, status, competitor_id AS competitorId,
       first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
     FROM competitor_suggestions
     WHERE organization_id = ? AND offering_id = ?
     ORDER BY status = 'new' DESC, verdict = 'direct' DESC, score DESC
     LIMIT 60`,
    [organizationId, offeringId]
  );
}

export function suggestionById(organizationId, id) {
  return one(
    `SELECT id, offering_id AS offeringId, name, website, facebook, city, category, status, sources, score, verdict, reason
     FROM competitor_suggestions WHERE organization_id = ? AND id = ?`,
    [organizationId, id]
  );
}

export function startAdCheck(organizationId, competitorId) {
  return insert(`INSERT INTO competitor_ad_checks (organization_id, competitor_id) VALUES (?, ?)`, [organizationId, competitorId]);
}

export function finishAdCheck(id, { status, meta, google, notes }) {
  return run(
    `UPDATE competitor_ad_checks SET status = ?, meta = ?, google = ?, notes = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?`,
    [status, meta ? JSON.stringify(meta) : null, google ? JSON.stringify(google) : null, JSON.stringify(notes || []), id]
  );
}

export function latestAdCheck(organizationId, competitorId) {
  return one(
    `SELECT id, status, meta, google, notes, started_at AS startedAt, finished_at AS finishedAt
     FROM competitor_ad_checks WHERE organization_id = ? AND competitor_id = ? ORDER BY id DESC LIMIT 1`,
    [organizationId, competitorId]
  );
}

export function closeInterruptedAdChecks() {
  return run(
    `UPDATE competitor_ad_checks SET status = 'failed', notes = JSON_ARRAY('AIRO restarted while this check was running. Press Check ads again.'), finished_at = UTC_TIMESTAMP()
     WHERE status = 'running'`
  );
}

export function ourAdTotals(organizationId, days = 30) {
  return many(
    `SELECT platform, currency, COUNT(DISTINCT CASE WHEN spend > 0 THEN external_id END) AS campaigns,
            SUM(spend) AS spend, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(leads) AS leads, SUM(conversions) AS conversions
     FROM ad_metrics_daily
     WHERE organization_id = ? AND level = 'campaign' AND metric_date >= (UTC_DATE() - INTERVAL ? DAY)
     GROUP BY platform, currency`,
    [organizationId, days]
  );
}

export function setSuggestionStatus(organizationId, id, status, competitorId = null) {
  return run(
    `UPDATE competitor_suggestions SET status = ?, competitor_id = COALESCE(?, competitor_id) WHERE organization_id = ? AND id = ?`,
    [status, competitorId, organizationId, id]
  );
}
