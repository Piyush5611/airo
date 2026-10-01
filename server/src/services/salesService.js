import { ApiError } from '../utils/errors.js';
import * as repo from '../repositories/salesRepo.js';
import { recordAudit } from './auditService.js';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function pipeline(auth) {
  const [stages, deals, reasons] = await Promise.all([
    repo.pipeline(auth.organizationId),
    repo.opportunities(auth.organizationId),
    repo.lostReasons(auth.organizationId)
  ]);
  const open = deals.filter((deal) => deal.status === 'open');
  const won = deals.filter((deal) => deal.status === 'won');
  return {
    stages,
    opportunities: deals,
    lostReasons: reasons,
    summary: {
      openDeals: open.length,
      openValue: open.reduce((sum, deal) => sum + Number(deal.valueInr || 0), 0),
      wonValue: won.reduce((sum, deal) => sum + Number(deal.valueInr || 0), 0)
    }
  };
}

export async function opportunity(auth, id) {
  const row = await repo.getOpportunity(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Opportunity not found.', 'not_found');
  const activity = await repo.opportunityActivity(auth.organizationId, id);
  return { ...row, activity };
}

export async function moveOpportunity(auth, req, id) {
  const existing = await repo.getOpportunity(auth.organizationId, id);
  if (!existing) throw new ApiError(404, 'Opportunity not found.', 'not_found');
  const stage = await repo.stageInOrg(auth.organizationId, req.body.stageId);
  if (!stage) throw new ApiError(422, 'Choose a stage from this pipeline.', 'validation_error');
  const status = stage.stageKey === 'booked' ? 'won' : stage.stageKey === 'lost' ? 'lost' : 'open';
  const lostReason = status === 'lost' ? (req.body.lostReason || 'Not recorded') : null;
  await repo.moveOpportunity(auth.organizationId, id, { stageId: stage.id, status, lostReason });
  await repo.addOpportunityActivity({
    organizationId: auth.organizationId,
    opportunityId: id,
    actorUserId: auth.userId,
    body: `Moved to ${stage.name}.`
  });
  await recordAudit(req, { action: 'opportunity.updated', resource: 'opportunity', resourceId: id });
  return opportunity(auth, id);
}

export async function calls(auth) {
  const rows = (await repo.calls(auth.organizationId)).map((row) => ({
    ...row,
    buyingSignals: parseJson(row.buyingSignals, []),
    objections: parseJson(row.objections, [])
  }));
  const completed = rows.filter((row) => row.status === 'completed');
  const scored = completed.filter((row) => row.score != null);
  return {
    items: rows,
    summary: {
      total: rows.length,
      missed: rows.filter((row) => row.status === 'missed').length,
      averageScore: scored.length
        ? Math.round(scored.reduce((sum, row) => sum + Number(row.score), 0) / scored.length)
        : null
    }
  };
}

export async function call(auth, id) {
  const row = await repo.getCall(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Call not found.', 'not_found');
  const [recording, transcript, analysis] = await Promise.all([
    repo.recording(id),
    repo.transcript(id),
    repo.analysis(id)
  ]);
  return {
    ...row,
    recording,
    transcript: transcript?.body || null,
    analysis: analysis
      ? {
          ...analysis,
          buyingSignals: parseJson(analysis.buyingSignals, []),
          objections: parseJson(analysis.objections, [])
        }
      : null
  };
}

export async function activities(auth) {
  const [tasks, notes, reminders, timeline] = await Promise.all([
    repo.tasks(auth.organizationId),
    repo.notes(auth.organizationId),
    repo.reminders(auth.organizationId),
    repo.timeline(auth.organizationId)
  ]);
  return { tasks, notes, reminders, timeline };
}

export async function createTask(auth, req) {
  const id = await repo.createTask({
    organizationId: auth.organizationId,
    assigneeUserId: auth.userId,
    title: req.body.title.trim(),
    dueAt: req.body.dueAt || null,
    relatedType: req.body.relatedType || null,
    relatedId: req.body.relatedId || null
  });
  await recordAudit(req, { action: 'task.created', resource: 'task', resourceId: id });
  return activities(auth);
}

export async function completeTask(auth, req, id) {
  await repo.completeTask(auth.organizationId, id);
  await recordAudit(req, { action: 'task.completed', resource: 'task', resourceId: id });
  return activities(auth);
}
