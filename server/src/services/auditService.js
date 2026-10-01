import { insert } from '../db/sql.js';

export function recordAudit(req, { action, resource, resourceId = null, metadata = null, organizationId = undefined }) {
  const orgId = organizationId === undefined ? req.auth?.organizationId || null : organizationId;
  return insert(
    `INSERT INTO audit_logs (organization_id, actor_user_id, action, resource_name, resource_id, metadata, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      orgId,
      req.auth?.actorId || req.auth?.userId || null,
      action,
      resource,
      resourceId == null ? null : String(resourceId),
      metadata ? JSON.stringify(metadata) : null,
      req.ip || null
    ]
  );
}
