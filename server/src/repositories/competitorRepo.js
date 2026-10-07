import { insert, many, one, run } from '../db/sql.js';

const FIELDS = `id, name, website, facebook, instagram, city, notes, status, last_analyzed_at AS lastAnalyzedAt,
  created_at AS createdAt, updated_at AS updatedAt`;

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
    `INSERT INTO competitors (organization_id, name, website, facebook, instagram, city, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, row.name, row.website || null, row.facebook || null, row.instagram || null, row.city || null, row.notes || null]
  );
}

export function update(organizationId, id, row) {
  return run(
    `UPDATE competitors SET name = ?, website = ?, facebook = ?, instagram = ?, city = ?, notes = ?, status = ?
     WHERE organization_id = ? AND id = ?`,
    [row.name, row.website || null, row.facebook || null, row.instagram || null, row.city || null, row.notes || null, row.status, organizationId, id]
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

export function readyReports(organizationId, limit = 5) {
  return many(
    `SELECT c.name, c.city, r.analysis, r.created_at AS createdAt
     FROM competitors c
     JOIN competitor_reports r ON r.id = (
       SELECT MAX(x.id) FROM competitor_reports x WHERE x.competitor_id = c.id AND x.status = 'ready'
     )
     WHERE c.organization_id = ? AND c.status = 'active'
     ORDER BY r.created_at DESC
     LIMIT ?`,
    [organizationId, limit]
  );
}

export function organizationName(organizationId) {
  return one(`SELECT name FROM organizations WHERE id = ?`, [organizationId]);
}

export function knownCompetitors(organizationId) {
  return many(`SELECT id, name, website FROM competitors WHERE organization_id = ?`, [organizationId]);
}

export function startRun(organizationId, trigger) {
  return insert(`INSERT INTO competitor_discovery_runs (organization_id, trigger_type) VALUES (?, ?)`, [organizationId, trigger]);
}

export function finishRun(id, { status, plan, counts, notes }) {
  return run(
    `UPDATE competitor_discovery_runs SET status = ?, plan = ?, counts = ?, notes = ?, finished_at = UTC_TIMESTAMP() WHERE id = ?`,
    [status, plan ? JSON.stringify(plan) : null, counts ? JSON.stringify(counts) : null, JSON.stringify(notes || []), id]
  );
}

export function latestRun(organizationId) {
  return one(
    `SELECT id, trigger_type AS triggerType, status, plan, counts, notes, started_at AS startedAt, finished_at AS finishedAt
     FROM competitor_discovery_runs WHERE organization_id = ? ORDER BY id DESC LIMIT 1`,
    [organizationId]
  );
}

export function closeStaleRuns() {
  return run(
    `UPDATE competitor_discovery_runs SET status = 'failed', notes = JSON_ARRAY('The search was stopped before it finished.'), finished_at = UTC_TIMESTAMP()
     WHERE status = 'running' AND started_at < UTC_TIMESTAMP() - INTERVAL 20 MINUTE`
  );
}

export function dueForDiscovery(limit = 3) {
  return many(
    `SELECT o.id AS organizationId
     FROM organizations o
     WHERE o.status IN ('active', 'onboarding')
       AND (
         EXISTS (SELECT 1 FROM offerings f WHERE f.organization_id = o.id AND f.status = 'active')
         OR EXISTS (SELECT 1 FROM business_profiles b WHERE b.organization_id = o.id)
       )
       AND NOT EXISTS (
         SELECT 1 FROM competitor_discovery_runs r
         WHERE r.organization_id = o.id AND r.started_at > UTC_TIMESTAMP() - INTERVAL 7 DAY
       )
     ORDER BY o.id
     LIMIT ?`,
    [limit]
  );
}

export function suggestionByKey(organizationId, matchKey) {
  return one(`SELECT id, status FROM competitor_suggestions WHERE organization_id = ? AND match_key = ?`, [organizationId, matchKey]);
}

export function saveSuggestion(organizationId, row) {
  return run(
    `INSERT INTO competitor_suggestions (organization_id, match_key, name, website, facebook, city, category, sources, score, verdict, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), website = COALESCE(VALUES(website), website), facebook = COALESCE(VALUES(facebook), facebook),
       city = COALESCE(VALUES(city), city), category = COALESCE(VALUES(category), category), sources = VALUES(sources),
       score = VALUES(score), verdict = VALUES(verdict), reason = VALUES(reason), last_seen_at = UTC_TIMESTAMP()`,
    [organizationId, row.matchKey, row.name, row.website || null, row.facebook || null, row.city || null, row.category || null,
      JSON.stringify(row.sources || []), row.score, row.verdict, row.reason || null]
  );
}

export function suggestions(organizationId) {
  return many(
    `SELECT id, name, website, facebook, city, category, sources, score, verdict, reason, status, competitor_id AS competitorId,
       first_seen_at AS firstSeenAt, last_seen_at AS lastSeenAt
     FROM competitor_suggestions
     WHERE organization_id = ?
     ORDER BY status = 'new' DESC, verdict = 'direct' DESC, score DESC
     LIMIT 60`,
    [organizationId]
  );
}

export function suggestionById(organizationId, id) {
  return one(
    `SELECT id, name, website, facebook, city, category, status FROM competitor_suggestions WHERE organization_id = ? AND id = ?`,
    [organizationId, id]
  );
}

export function setSuggestionStatus(organizationId, id, status, competitorId = null) {
  return run(
    `UPDATE competitor_suggestions SET status = ?, competitor_id = COALESCE(?, competitor_id) WHERE organization_id = ? AND id = ?`,
    [status, competitorId, organizationId, id]
  );
}
