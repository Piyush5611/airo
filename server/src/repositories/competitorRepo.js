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
