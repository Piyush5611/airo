import { ApiError } from '../utils/errors.js';
import { leadScope } from '../utils/scope.js';
import * as repo from '../repositories/growthRepo.js';
import { recordAudit } from './auditService.js';

function scoped(auth) {
  return leadScope(auth);
}

export async function leads(auth, query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 1), 50);
  const scope = scoped(auth);
  const q = query.q ? `%${String(query.q).replace(/[%_]/g, '').slice(0, 80)}%` : null;
  const [rows, count] = await repo.listLeads({
    organizationId: auth.organizationId,
    scopeSql: scope.sql,
    scopeParams: scope.params,
    status: query.status || null,
    project: query.project || null,
    q,
    limit: pageSize,
    offset: (page - 1) * pageSize
  });
  return {
    items: rows,
    page,
    pageSize,
    total: count?.total || 0,
    projects: await repo.projects(auth.organizationId),
    activities: await repo.recentLeadActivities(auth.organizationId, scope.sql, scope.params)
  };
}

export async function lead(auth, id) {
  const scope = scoped(auth);
  const row = await repo.getLead(auth.organizationId, id, scope.sql, scope.params);
  if (!row) throw new ApiError(404, 'Lead not found.', 'not_found');
  const [activities, tags, scores] = await Promise.all([
    repo.leadActivities(auth.organizationId, id),
    repo.leadTags(id),
    repo.leadScores(auth.organizationId, id)
  ]);
  return { ...row, activities, tags: tags.map((tag) => tag.name), scores };
}

export async function createLead(auth, req) {
  const body = req.body;
  if (body.sourceId) {
    const source = await repo.sourceInOrg(auth.organizationId, body.sourceId);
    if (!source) throw new ApiError(422, 'Choose a source from this workspace.', 'validation_error');
  }
  const id = await repo.createLead({
    organizationId: auth.organizationId,
    workspaceId: auth.workspaceId,
    sourceId: body.sourceId || null,
    campaignId: null,
    assignedUserId: null,
    fullName: body.fullName.trim(),
    phone: body.phone.trim(),
    email: body.email || null,
    project: body.project.trim(),
    city: body.city || null,
    score: body.score ?? 40,
    intent: body.intent || 'medium',
    budgetInr: body.budgetInr ?? null,
    configuration: body.configuration || null,
    notesSummary: body.notesSummary || null
  });
  await repo.addLeadActivity({
    organizationId: auth.organizationId,
    leadId: id,
    actorUserId: auth.userId,
    activityType: 'created',
    body: 'Lead added in the workspace.'
  });
  await recordAudit(req, { action: 'lead.created', resource: 'lead', resourceId: id });
  return lead(auth, id);
}

export async function updateLead(auth, req, id) {
  const existing = await lead(auth, id);
  await repo.updateLead(auth.organizationId, id, {
    status: req.body.status,
    score: req.body.score,
    intent: req.body.intent,
    project: req.body.project,
    notesSummary: req.body.notesSummary
  });
  if (req.body.status && req.body.status !== existing.status) {
    await repo.addLeadActivity({
      organizationId: auth.organizationId,
      leadId: id,
      actorUserId: auth.userId,
      activityType: 'status',
      body: `Status moved from ${existing.status.replaceAll('_', ' ')} to ${req.body.status.replaceAll('_', ' ')}.`
    });
  }
  await recordAudit(req, { action: 'lead.updated', resource: 'lead', resourceId: id, metadata: req.body });
  return lead(auth, id);
}

export async function assignLead(auth, req, id) {
  const existing = await lead(auth, id);
  const member = await repo.memberInOrg(auth.organizationId, req.body.userId);
  if (!member) throw new ApiError(422, 'Assignee must belong to this organization.', 'validation_error');
  await repo.updateLead(auth.organizationId, id, { assignedUserId: req.body.userId });
  await repo.addAssignment({
    leadId: id,
    organizationId: auth.organizationId,
    fromUserId: existing.assignedUserId,
    toUserId: req.body.userId,
    assignedBy: auth.userId
  });
  await repo.addLeadActivity({
    organizationId: auth.organizationId,
    leadId: id,
    actorUserId: auth.userId,
    activityType: 'assignment',
    body: 'Lead assignment updated.'
  });
  await recordAudit(req, { action: 'lead.assigned', resource: 'lead', resourceId: id, metadata: { userId: req.body.userId } });
  return lead(auth, id);
}

export async function removeLead(auth, req, id) {
  await lead(auth, id);
  const { run } = await import('../db/sql.js');
  await run(`DELETE FROM leads WHERE organization_id = ? AND id = ?`, [auth.organizationId, id]);
  await recordAudit(req, { action: 'lead.deleted', resource: 'lead', resourceId: id });
  return { deleted: true };
}

export async function exportLeads(auth) {
  const scope = scoped(auth);
  const [rows] = await repo.listLeads({
    organizationId: auth.organizationId,
    scopeSql: scope.sql,
    scopeParams: scope.params,
    status: null,
    project: null,
    q: null,
    limit: 500,
    offset: 0
  });
  const header = ['Name', 'Phone', 'Email', 'Project', 'Source', 'Status', 'Score', 'Assignee'];
  const lines = rows.map((row) =>
    [row.fullName, row.phone, row.email || '', row.project, row.sourceName || '', row.status, row.score, row.assigneeName || '']
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(',')
  );
  return [header.join(','), ...lines].join('\n');
}

export function leadSources(auth) {
  return repo.sources(auth.organizationId);
}

export async function campaigns(auth) {
  const rows = await repo.listCampaigns(auth.organizationId);
  return rows.map((row) => {
    const shaped = withEfficiency(row);
    return { ...shaped, analysis: analysisFor(shaped) };
  });
}

export async function campaign(auth, id) {
  const row = await repo.getCampaign(auth.organizationId, id);
  if (!row) throw new ApiError(404, 'Campaign not found.', 'not_found');
  const scope = scoped(auth);
  const [metrics, leadsForCampaign, all] = await Promise.all([
    repo.campaignMetrics(auth.organizationId, id),
    repo.campaignLeads(auth.organizationId, id, scope.sql, scope.params),
    repo.listCampaigns(auth.organizationId)
  ]);
  const summary = all.find((item) => item.id === Number(id));
  return {
    ...withEfficiency(summary || row),
    startDate: row.startDate,
    externalId: row.externalId,
    metrics,
    leads: leadsForCampaign,
    analysis: analysisFor(withEfficiency(summary || row))
  };
}

function withEfficiency(row) {
  const spend = Number(row.spendInr || 0);
  const leads = Number(row.leads || 0);
  const qualified = Number(row.qualifiedLeads || 0);
  return {
    ...row,
    spendInr: spend,
    leads,
    qualifiedLeads: qualified,
    cpl: leads ? Math.round(spend / leads) : null,
    qualifiedRate: leads ? Math.round((qualified / leads) * 100) : null
  };
}

function analysisFor(row) {
  if (!row.leads) {
    return {
      answer: `${row.name} has spend recorded without leads in the last 14 days.`,
      evidence: `Spend is ₹${Math.round(row.spendInr).toLocaleString('en-IN')}.`,
      insight: 'A campaign with spend and no leads needs a destination or form check before more budget is added.',
      action: 'Review the connection mapping and the campaign destination.'
    };
  }
  return {
    answer: `${row.name} produced ${row.leads} leads at ₹${row.cpl.toLocaleString('en-IN')} CPL.`,
    evidence: `${row.qualifiedLeads} of those leads are qualified (${row.qualifiedRate}%). Project: ${row.project}.`,
    insight: row.qualifiedRate != null && row.qualifiedRate < 25
      ? 'Qualification is thin relative to volume. The audience or the project offer is the first place to look.'
      : 'Qualification is holding. The useful next step is follow-up speed on the high-score leads.',
    action: 'Open the leads from this campaign and clear the uncontacted high-intent names.'
  };
}
