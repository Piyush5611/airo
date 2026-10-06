import { insert, many, one, run } from '../db/sql.js';

const FIELDS = `id, kind, name, details, usps, offer, price_text AS priceText, locations, website, source, status,
  times_used AS timesUsed, last_used_at AS lastUsedAt, created_at AS createdAt, updated_at AS updatedAt`;

export function list(organizationId, { status = 'active', limit = 200 } = {}) {
  return many(
    `SELECT ${FIELDS},
       (SELECT COUNT(*) FROM offering_media m WHERE m.offering_id = offerings.id AND m.kind = 'photo') AS photoCount
     FROM offerings
     WHERE organization_id = ? AND (? = 'all' OR status = ?)
     ORDER BY last_used_at IS NULL, last_used_at DESC, updated_at DESC
     LIMIT ?`,
    [organizationId, status, status, limit]
  );
}

export function byId(organizationId, id) {
  return one(`SELECT ${FIELDS} FROM offerings WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function byName(organizationId, name) {
  return one(`SELECT ${FIELDS} FROM offerings WHERE organization_id = ? AND LOWER(name) = LOWER(?)`, [organizationId, name]);
}

export function create(organizationId, item) {
  return insert(
    `INSERT INTO offerings (organization_id, kind, name, details, usps, offer, price_text, locations, website, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [organizationId, item.kind, item.name, item.details || null, item.usps || null, item.offer || null, item.priceText || null, item.locations || null, item.website || null, item.source]
  );
}

export function update(organizationId, id, item) {
  return run(
    `UPDATE offerings SET kind = ?, name = ?, details = ?, usps = ?, offer = ?, price_text = ?, locations = ?, website = ?, status = ?
     WHERE organization_id = ? AND id = ?`,
    [item.kind, item.name, item.details || null, item.usps || null, item.offer || null, item.priceText || null, item.locations || null, item.website || null, item.status, organizationId, id]
  );
}

export function remove(organizationId, id) {
  return run(`DELETE FROM offerings WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function markUsed(organizationId, ids) {
  if (!ids.length) return null;
  return run(
    `UPDATE offerings SET times_used = times_used + 1, last_used_at = NOW() WHERE organization_id = ? AND id IN (?)`,
    [organizationId, ids]
  );
}

export function photos(organizationId, offeringId) {
  return many(
    `SELECT id, mime, byte_size AS byteSize, created_at AS createdAt FROM offering_media
     WHERE organization_id = ? AND offering_id = ? AND kind = 'photo' ORDER BY id`,
    [organizationId, offeringId]
  );
}

export function photoIds(organizationId) {
  return many(
    `SELECT id, offering_id AS offeringId FROM offering_media WHERE organization_id = ? AND kind = 'photo' ORDER BY id`,
    [organizationId]
  );
}

export function addMedia(organizationId, offeringId, kind, mime, bytes) {
  return insert(
    `INSERT INTO offering_media (organization_id, offering_id, kind, mime, byte_size, bytes) VALUES (?, ?, ?, ?, ?, ?)`,
    [organizationId, offeringId, kind, mime, bytes.length, bytes]
  );
}

export function mediaById(organizationId, id) {
  return one(
    `SELECT id, offering_id AS offeringId, kind, mime, bytes FROM offering_media WHERE organization_id = ? AND id = ?`,
    [organizationId, id]
  );
}

export function removeMedia(organizationId, id) {
  return run(`DELETE FROM offering_media WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function logo(organizationId) {
  return one(
    `SELECT id, mime, bytes FROM offering_media WHERE organization_id = ? AND kind = 'logo' ORDER BY id DESC LIMIT 1`,
    [organizationId]
  );
}

export function removeLogos(organizationId) {
  return run(`DELETE FROM offering_media WHERE organization_id = ? AND kind = 'logo'`, [organizationId]);
}

export function firstPhotos(organizationId, offeringIds) {
  if (!offeringIds.length) return Promise.resolve([]);
  return many(
    `SELECT m.offering_id AS offeringId, m.bytes FROM offering_media m
     JOIN (SELECT offering_id, MIN(id) AS id FROM offering_media
           WHERE organization_id = ? AND kind = 'photo' AND offering_id IN (?) GROUP BY offering_id) f ON f.id = m.id`,
    [organizationId, offeringIds]
  );
}
