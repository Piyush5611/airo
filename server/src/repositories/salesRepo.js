import { insert, many, one, run } from '../db/sql.js';

export function pipeline(organizationId) {
  return many(
    `SELECT s.id, s.name, s.stage_key AS stageKey, s.sort_order AS sortOrder,
            COUNT(o.id) AS deals,
            COALESCE(SUM(o.value_inr), 0) AS valueInr
     FROM pipeline_stages s
     LEFT JOIN opportunities o ON o.stage_id = s.id AND o.status = 'open'
     WHERE s.organization_id = ?
     GROUP BY s.id, s.name, s.stage_key, s.sort_order
     ORDER BY s.sort_order`,
    [organizationId]
  );
}

export function opportunities(organizationId) {
  return many(
    `SELECT o.id, o.title, o.project, o.value_inr AS valueInr, o.status, o.lost_reason AS lostReason,
            o.expected_on AS expectedOn, o.created_at AS createdAt, o.lead_id AS leadId,
            s.name AS stageName, s.stage_key AS stageKey, u.full_name AS ownerName
     FROM opportunities o
     JOIN pipeline_stages s ON s.id = o.stage_id
     LEFT JOIN users u ON u.id = o.owner_user_id
     WHERE o.organization_id = ?
     ORDER BY o.value_inr DESC`,
    [organizationId]
  );
}

export function getOpportunity(organizationId, id) {
  return one(
    `SELECT o.id, o.title, o.project, o.value_inr AS valueInr, o.status, o.lost_reason AS lostReason,
            o.expected_on AS expectedOn, o.lead_id AS leadId, s.name AS stageName, s.stage_key AS stageKey,
            u.full_name AS ownerName, l.full_name AS leadName
     FROM opportunities o
     JOIN pipeline_stages s ON s.id = o.stage_id
     LEFT JOIN users u ON u.id = o.owner_user_id
     LEFT JOIN leads l ON l.id = o.lead_id
     WHERE o.organization_id = ? AND o.id = ?`,
    [organizationId, id]
  );
}

export function opportunityActivity(organizationId, id) {
  return many(
    `SELECT body, created_at AS createdAt FROM opportunity_activities
     WHERE organization_id = ? AND opportunity_id = ? ORDER BY created_at DESC`,
    [organizationId, id]
  );
}

export function stageInOrg(organizationId, stageId) {
  return one(
    `SELECT id, stage_key AS stageKey, name FROM pipeline_stages WHERE organization_id = ? AND id = ?`,
    [organizationId, stageId]
  );
}

export function moveOpportunity(organizationId, id, { stageId, status, lostReason }) {
  return run(
    `UPDATE opportunities SET stage_id = ?, status = ?, lost_reason = ? WHERE organization_id = ? AND id = ?`,
    [stageId, status, lostReason, organizationId, id]
  );
}

export function addOpportunityActivity({ organizationId, opportunityId, actorUserId, body }) {
  return insert(
    `INSERT INTO opportunity_activities (organization_id, opportunity_id, actor_user_id, body) VALUES (?, ?, ?, ?)`,
    [organizationId, opportunityId, actorUserId, body]
  );
}

export function calls(organizationId) {
  return many(
    `SELECT c.id, c.direction, c.status, c.started_at AS startedAt, c.duration_seconds AS durationSeconds,
            c.outcome, c.provider_key AS providerKey, l.full_name AS leadName, l.project, l.id AS leadId,
            u.full_name AS agentName, a.score, a.summary, a.buying_signals AS buyingSignals, a.objections,
            LEFT(t.body, 280) AS transcriptExcerpt, r.note AS recordingNote, r.available AS recordingAvailable
     FROM calls c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = c.agent_user_id
     LEFT JOIN call_analysis a ON a.call_id = c.id
     LEFT JOIN call_transcripts t ON t.call_id = c.id
     LEFT JOIN call_recordings r ON r.call_id = c.id
     WHERE c.organization_id = ?
     ORDER BY c.started_at DESC`,
    [organizationId]
  );
}

export function getCall(organizationId, id) {
  return one(
    `SELECT c.id, c.direction, c.status, c.started_at AS startedAt, c.duration_seconds AS durationSeconds,
            c.outcome, c.provider_key AS providerKey, l.full_name AS leadName, l.project, l.id AS leadId,
            u.full_name AS agentName
     FROM calls c
     LEFT JOIN leads l ON l.id = c.lead_id
     LEFT JOIN users u ON u.id = c.agent_user_id
     WHERE c.organization_id = ? AND c.id = ?`,
    [organizationId, id]
  );
}

export function recording(callId) {
  return one(
    `SELECT storage_key AS storageKey, duration_seconds AS durationSeconds, available, note
     FROM call_recordings WHERE call_id = ?`,
    [callId]
  );
}

export function transcript(callId) {
  return one(`SELECT body FROM call_transcripts WHERE call_id = ?`, [callId]);
}

export function analysis(callId) {
  return one(
    `SELECT summary, buying_signals AS buyingSignals, objections, score FROM call_analysis WHERE call_id = ?`,
    [callId]
  );
}

export function tasks(organizationId) {
  return many(
    `SELECT t.id, t.title, t.status, t.due_at AS dueAt, t.related_type AS relatedType, t.related_id AS relatedId,
            u.full_name AS assigneeName
     FROM tasks t
     LEFT JOIN users u ON u.id = t.assignee_user_id
     WHERE t.organization_id = ?
     ORDER BY t.status, t.due_at`,
    [organizationId]
  );
}

export function notes(organizationId) {
  return many(
    `SELECT n.id, n.subject_type AS subjectType, n.subject_id AS subjectId, n.body, n.created_at AS createdAt,
            u.full_name AS authorName
     FROM notes n
     LEFT JOIN users u ON u.id = n.author_user_id
     WHERE n.organization_id = ?
     ORDER BY n.created_at DESC
     LIMIT 40`,
    [organizationId]
  );
}

export function reminders(organizationId) {
  return many(
    `SELECT r.id, r.title, r.remind_at AS remindAt, u.full_name AS ownerName
     FROM reminders r
     JOIN users u ON u.id = r.user_id
     WHERE r.organization_id = ?
     ORDER BY r.remind_at`,
    [organizationId]
  );
}

export function timeline(organizationId) {
  return many(
    `SELECT id, activity_type AS activityType, title, body, subject_type AS subjectType, subject_id AS subjectId,
            occurred_at AS occurredAt
     FROM activities
     WHERE organization_id = ?
     ORDER BY occurred_at DESC
     LIMIT 40`,
    [organizationId]
  );
}

export function createTask(row) {
  return insert(
    `INSERT INTO tasks (organization_id, assignee_user_id, title, due_at, related_type, related_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [row.organizationId, row.assigneeUserId, row.title, row.dueAt, row.relatedType, row.relatedId]
  );
}

export function completeTask(organizationId, id) {
  return run(`UPDATE tasks SET status = 'done' WHERE organization_id = ? AND id = ?`, [organizationId, id]);
}

export function lostReasons(organizationId) {
  return many(
    `SELECT lost_reason AS reason, COUNT(*) AS total
     FROM opportunities
     WHERE organization_id = ? AND status = 'lost' AND lost_reason IS NOT NULL
     GROUP BY lost_reason
     ORDER BY total DESC`,
    [organizationId]
  );
}
