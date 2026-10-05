import { insert, many, one, run } from '../db/sql.js';

const leadSelect = `
  l.id, l.full_name AS fullName, l.phone, l.email, l.project, l.city, l.status, l.score, l.intent,
  l.budget_inr AS budgetInr, l.deal_value_inr AS dealValueInr, l.configuration, l.notes_summary AS notesSummary,
  l.created_at AS createdAt, l.updated_at AS updatedAt, l.external_id AS externalId,
  s.name AS sourceName, s.provider_key AS providerKey, c.name AS campaignName, c.id AS campaignId,
  u.full_name AS assigneeName, l.assigned_user_id AS assignedUserId
`;

export function listLeads({ organizationId, scopeSql, scopeParams, status, q, project, limit, offset }) {
  const where = ['l.organization_id = ?'];
  const params = [organizationId];
  if (status) {
    where.push('l.status = ?');
    params.push(status);
  }
  if (project) {
    where.push('l.project = ?');
    params.push(project);
  }
  if (q) {
    where.push('(l.full_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ? OR l.project LIKE ?)');
    params.push(q, q, q, q);
  }
  const sqlWhere = `WHERE ${where.join(' AND ')} ${scopeSql}`;
  return Promise.all([
    many(
      `SELECT ${leadSelect}
       FROM leads l
       LEFT JOIN lead_sources s ON s.id = l.source_id
       LEFT JOIN campaigns c ON c.id = l.campaign_id
       LEFT JOIN users u ON u.id = l.assigned_user_id
       ${sqlWhere}
       ORDER BY l.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, ...scopeParams, limit, offset]
    ),
    one(
      `SELECT COUNT(*) AS total FROM leads l ${sqlWhere}`,
      [...params, ...scopeParams]
    )
  ]);
}

export function getLead(organizationId, id, scopeSql, scopeParams) {
  return one(
    `SELECT ${leadSelect}
     FROM leads l
     LEFT JOIN lead_sources s ON s.id = l.source_id
     LEFT JOIN campaigns c ON c.id = l.campaign_id
     LEFT JOIN users u ON u.id = l.assigned_user_id
     WHERE l.organization_id = ? AND l.id = ? ${scopeSql}`,
    [organizationId, id, ...scopeParams]
  );
}

export function recentLeadActivities(organizationId, scopeSql, scopeParams) {
  return many(
    `SELECT la.id, la.activity_type AS activityType, la.body, la.created_at AS createdAt, l.full_name AS leadName, l.id AS leadId
     FROM lead_activities la
     JOIN leads l ON l.id = la.lead_id
     WHERE la.organization_id = ? ${scopeSql}
     ORDER BY la.created_at DESC
     LIMIT 40`,
    [organizationId, ...scopeParams]
  );
}

export function leadActivities(organizationId, leadId) {
  return many(
    `SELECT id, activity_type AS activityType, body, created_at AS createdAt, actor_user_id AS actorUserId
     FROM lead_activities
     WHERE organization_id = ? AND lead_id = ?
     ORDER BY created_at DESC`,
    [organizationId, leadId]
  );
}

export function leadTags(leadId) {
  return many(
    `SELECT t.name FROM lead_tag_links ltl JOIN lead_tags t ON t.id = ltl.tag_id WHERE ltl.lead_id = ?`,
    [leadId]
  );
}

export function leadScores(organizationId, leadId) {
  return many(
    `SELECT score, reason, created_at AS createdAt FROM lead_scores
     WHERE organization_id = ? AND lead_id = ? ORDER BY created_at DESC`,
    [organizationId, leadId]
  );
}

export function createLead(row) {
  return insert(
    `INSERT INTO leads (
      organization_id, workspace_id, source_id, campaign_id, assigned_user_id, full_name, phone, email,
      project, city, status, score, intent, budget_inr, configuration, notes_summary
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
    [
      row.organizationId, row.workspaceId, row.sourceId, row.campaignId, row.assignedUserId,
      row.fullName, row.phone, row.email, row.project, row.city, row.score, row.intent,
      row.budgetInr, row.configuration, row.notesSummary
    ]
  );
}

export function updateLead(organizationId, id, fields) {
  const allowed = {
    status: 'status',
    score: 'score',
    intent: 'intent',
    project: 'project',
    notesSummary: 'notes_summary',
    dealValueInr: 'deal_value_inr',
    assignedUserId: 'assigned_user_id'
  };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(allowed)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(fields[key]);
    }
  }
  if (!sets.length) return Promise.resolve(null);
  params.push(organizationId, id);
  return run(`UPDATE leads SET ${sets.join(', ')} WHERE organization_id = ? AND id = ?`, params);
}

export function addLeadActivity({ organizationId, leadId, actorUserId, activityType, body }) {
  return insert(
    `INSERT INTO lead_activities (organization_id, lead_id, actor_user_id, activity_type, body)
     VALUES (?, ?, ?, ?, ?)`,
    [organizationId, leadId, actorUserId, activityType, body]
  );
}

export function addAssignment(row) {
  return insert(
    `INSERT INTO lead_assignments (lead_id, organization_id, from_user_id, to_user_id, assigned_by)
     VALUES (?, ?, ?, ?, ?)`,
    [row.leadId, row.organizationId, row.fromUserId, row.toUserId, row.assignedBy]
  );
}

export function sources(organizationId) {
  return many(
    `SELECT s.id, s.name, s.category, s.provider_key AS providerKey,
            COUNT(l.id) AS leadCount,
            SUM(l.status IN ('qualified','site_visit','negotiation','booked')) AS qualifiedCount,
            SUM(l.status = 'booked') AS bookedCount
     FROM lead_sources s
     LEFT JOIN leads l ON l.source_id = s.id
     WHERE s.organization_id = ?
     GROUP BY s.id, s.name, s.category, s.provider_key
     ORDER BY leadCount DESC`,
    [organizationId]
  );
}

export function projects(organizationId) {
  return many(
    `SELECT DISTINCT project FROM leads WHERE organization_id = ? ORDER BY project`,
    [organizationId]
  );
}

export function listCampaigns(organizationId) {
  return many(
    `SELECT c.id, c.name, c.project, c.status, c.provider_key AS providerKey, c.budget_inr AS budgetInr,
            s.name AS sourceName,
            COALESCE(SUM(m.spend_inr), 0) AS spendInr,
            COALESCE(SUM(m.leads), 0) AS leads,
            COALESCE(SUM(m.qualified_leads), 0) AS qualifiedLeads
     FROM campaigns c
     LEFT JOIN lead_sources s ON s.id = c.source_id
     LEFT JOIN campaign_metrics m ON m.campaign_id = c.id
       AND m.metric_date >= (UTC_DATE() - INTERVAL 14 DAY)
     WHERE c.organization_id = ?
     GROUP BY c.id, c.name, c.project, c.status, c.provider_key, c.budget_inr, s.name
     ORDER BY spendInr DESC`,
    [organizationId]
  );
}

export function getCampaign(organizationId, id) {
  return one(
    `SELECT c.id, c.name, c.project, c.status, c.provider_key AS providerKey, c.budget_inr AS budgetInr,
            c.start_date AS startDate, c.external_id AS externalId, s.name AS sourceName
     FROM campaigns c
     LEFT JOIN lead_sources s ON s.id = c.source_id
     WHERE c.organization_id = ? AND c.id = ?`,
    [organizationId, id]
  );
}

export function campaignMetrics(organizationId, campaignId) {
  return many(
    `SELECT metric_date AS metricDate, impressions, clicks, spend_inr AS spendInr, leads, qualified_leads AS qualifiedLeads
     FROM campaign_metrics
     WHERE organization_id = ? AND campaign_id = ?
     ORDER BY metric_date`,
    [organizationId, campaignId]
  );
}

export function campaignLeads(organizationId, campaignId, scopeSql, scopeParams) {
  return many(
    `SELECT l.id, l.full_name AS fullName, l.status, l.score, l.project, l.created_at AS createdAt
     FROM leads l
     WHERE l.organization_id = ? AND l.campaign_id = ? ${scopeSql}
     ORDER BY l.created_at DESC
     LIMIT 20`,
    [organizationId, campaignId, ...scopeParams]
  );
}

export function memberInOrg(organizationId, userId) {
  return one(
    `SELECT user_id AS userId FROM organization_users
     WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
    [organizationId, userId]
  );
}

export function sourceInOrg(organizationId, sourceId) {
  return one(`SELECT id FROM lead_sources WHERE organization_id = ? AND id = ?`, [organizationId, sourceId]);
}
