import { ApiError } from '../utils/errors.js';
import { leadScope } from '../utils/scope.js';
import * as repo from '../repositories/intelRepo.js';
import { recordAudit } from './auditService.js';

const FUNNEL = ['new', 'contacted', 'qualified', 'site_visit', 'negotiation', 'booked'];

function cpl(spend, leads) {
  const leadCount = Number(leads || 0);
  if (!leadCount) return null;
  return Math.round(Number(spend || 0) / leadCount);
}

function delta(current, previous) {
  const now = Number(current || 0);
  const then = Number(previous || 0);
  if (!then) return now ? 100 : 0;
  return Math.round(((now - then) / then) * 100);
}

export async function stats(organizationId) {
  const [qualified, leads, funnelRows, quiet, campaigns, series, sources, pipeline, calls, connections] = await Promise.all([
    repo.qualifiedWindows(organizationId),
    repo.leadWindows(organizationId),
    repo.funnel(organizationId),
    repo.uncontacted(organizationId),
    repo.campaignEfficiency(organizationId),
    repo.dailySeries(organizationId),
    repo.sourcePerformance(organizationId),
    repo.pipelineValue(organizationId),
    repo.callSummary(organizationId),
    repo.problemConnections(organizationId)
  ]);

  const spendNow = campaigns.reduce((sum, row) => sum + Number(row.spendNow || 0), 0);
  const spendPrev = campaigns.reduce((sum, row) => sum + Number(row.spendPrev || 0), 0);
  const leadsNow = campaigns.reduce((sum, row) => sum + Number(row.leadsNow || 0), 0);
  const leadsPrev = campaigns.reduce((sum, row) => sum + Number(row.leadsPrev || 0), 0);
  const rising = campaigns
    .map((row) => {
      const current = cpl(row.spendNow, row.leadsNow);
      const previous = cpl(row.spendPrev, row.leadsPrev);
      const change = current != null && previous ? Math.round(((current - previous) / previous) * 100) : null;
      return { ...row, cpl: current, previousCpl: previous, cplChange: change };
    })
    .filter((row) => row.cplChange != null && row.cplChange >= 20)
    .sort((a, b) => b.cplChange - a.cplChange);

  return {
    qualified: { thisWeek: Number(qualified?.thisWeek || 0), previousWeek: Number(qualified?.previousWeek || 0) },
    leads: { thisWeek: Number(leads?.thisWeek || 0), previousWeek: Number(leads?.previousWeek || 0) },
    funnel: FUNNEL.map((status) => ({
      status,
      total: Number(funnelRows.find((row) => row.status === status)?.total || 0)
    })),
    uncontactedHighIntent: Number(quiet?.total || 0),
    spend: { thisWeek: spendNow, previousWeek: spendPrev },
    paidLeads: { thisWeek: leadsNow, previousWeek: leadsPrev },
    cpl: { thisWeek: cpl(spendNow, leadsNow), previousWeek: cpl(spendPrev, leadsPrev) },
    campaigns: campaigns.map((row) => ({
      id: row.id,
      name: row.name,
      project: row.project,
      providerKey: row.providerKey,
      spend: Number(row.spendNow || 0),
      leads: Number(row.leadsNow || 0),
      cpl: cpl(row.spendNow, row.leadsNow)
    })),
    risingCpl: rising,
    series,
    sources,
    pipeline: {
      openValue: Number(pipeline?.openValue || 0),
      wonValue: Number(pipeline?.wonValue || 0),
      openDeals: Number(pipeline?.openDeals || 0),
      wonDeals: Number(pipeline?.wonDeals || 0),
      lostDeals: Number(pipeline?.lostDeals || 0)
    },
    calls: {
      total: Number(calls?.total || 0),
      missed: Number(calls?.missed || 0),
      averageScore: calls?.averageScore == null ? null : Math.round(Number(calls.averageScore))
    },
    connections
  };
}

function briefFrom(data) {
  const qualifiedDelta = delta(data.qualified.thisWeek, data.qualified.previousWeek);
  const topRise = data.risingCpl[0];
  const answer = qualifiedDelta < 0
    ? `Qualified leads are ${Math.abs(qualifiedDelta)}% lower than the previous week.`
    : qualifiedDelta > 0
      ? `Qualified leads are ${qualifiedDelta}% higher than the previous week.`
      : 'Qualified lead volume is flat versus the previous week.';
  const evidence = topRise
    ? `${topRise.name} CPL moved from ₹${topRise.previousCpl.toLocaleString('en-IN')} to ₹${topRise.cpl.toLocaleString('en-IN')}.`
    : `Blended CPL this week is ${data.cpl.thisWeek ? `₹${data.cpl.thisWeek.toLocaleString('en-IN')}` : 'not available yet'}.`;
  const insight = data.uncontactedHighIntent
    ? `${data.uncontactedHighIntent} high-intent leads are still untouched after a day.`
    : 'High-intent leads are being picked up. The constraint is campaign efficiency, not inbox neglect.';
  const action = data.connections.some((item) => item.status === 'error')
    ? 'Restore the expired connection before reading more performance into that source.'
    : data.uncontactedHighIntent
      ? 'Assign and call the untouched high-intent leads today.'
      : 'Review the campaign whose cost per lead moved the most.';
  return { answer, evidence, insight, action };
}

function loopStage(data) {
  if (data.connections.some((item) => item.status === 'error')) return 'Connect';
  if (data.risingCpl.length || delta(data.qualified.thisWeek, data.qualified.previousWeek) <= -10) return 'Detect';
  if (data.uncontactedHighIntent) return 'Act';
  return 'Measure';
}

export async function command(auth) {
  const data = await stats(auth.organizationId);
  const scope = leadScope(auth);
  const [insights, alerts, recommendations, hotLeads] = await Promise.all([
    repo.insights(auth.organizationId),
    repo.alerts(auth.organizationId),
    repo.recommendations(auth.organizationId, 'open'),
    repo.hotLeads(auth.organizationId, scope.sql, scope.params)
  ]);
  const brief = briefFrom(data);
  return {
    brief: {
      ...brief,
      actions: [
        data.uncontactedHighIntent ? { label: 'Open lead inbox', path: '/app/growth/leads?status=new' } : null,
        data.risingCpl[0] ? { label: 'View campaign', path: `/app/growth/campaigns/${data.risingCpl[0].id}` } : null,
        { label: 'Ask AIRO', path: '/app/ai' }
      ].filter(Boolean)
    },
    kpis: [
      { label: 'New leads', value: data.leads.thisWeek, delta: delta(data.leads.thisWeek, data.leads.previousWeek), hint: 'Created in 7 days' },
      { label: 'Qualified', value: data.qualified.thisWeek, delta: delta(data.qualified.thisWeek, data.qualified.previousWeek), hint: 'Qualified or further' },
      { label: 'Blended CPL', value: data.cpl.thisWeek, format: 'inr', delta: data.cpl.previousWeek ? delta(data.cpl.thisWeek, data.cpl.previousWeek) : null, hint: 'Spend ÷ paid leads' },
      { label: 'Open pipeline', value: data.pipeline.openValue, format: 'inr', delta: null, hint: `${data.pipeline.openDeals} open deals` }
    ],
    funnel: data.funnel,
    marketing: {
      spend: data.spend.thisWeek,
      leads: data.paidLeads.thisWeek,
      cpl: data.cpl.thisWeek
    },
    sales: data.pipeline,
    calls: data.calls,
    campaigns: data.campaigns.sort((a, b) => b.spend - a.spend).slice(0, 5),
    sources: data.sources,
    series: data.series,
    insights,
    alerts,
    recommendations,
    hotLeads,
    loop: ['Connect', 'Understand', 'Detect', 'Recommend', 'Act', 'Measure', 'Learn'],
    loopStage: loopStage(data)
  };
}

export async function refreshOrganization(organizationId) {
  const data = await stats(organizationId);
  const brief = briefFrom(data);
  const insights = [
    {
      key: 'qualified-change',
      title: 'Qualification change',
      body: brief.answer,
      evidence: brief.evidence,
      severity: delta(data.qualified.thisWeek, data.qualified.previousWeek) <= -10 ? 'watch' : 'info',
      actionLabel: 'Open command center',
      actionPath: '/app'
    }
  ];
  const alerts = [];
  const recommendations = [];

  if (data.uncontactedHighIntent) {
    alerts.push({
      key: 'uncontacted-high-intent',
      category: 'leads',
      title: `${data.uncontactedHighIntent} high-intent leads have not been contacted`,
      body: 'These leads scored 80 or above and are still new after at least a day.',
      priority: 'high',
      actionPath: '/app/growth/leads?status=new'
    });
    recommendations.push({
      key: 'contact-high-intent',
      category: 'leads',
      title: 'Call the untouched high-intent leads',
      body: `${data.uncontactedHighIntent} leads are likely to go cold if the first conversation waits another day.`,
      evidence: 'Score is 80 or above and status is still new.',
      actionLabel: 'Open inbox',
      actionPath: '/app/growth/leads?status=new'
    });
  }

  for (const connection of data.connections) {
    alerts.push({
      key: `connection-${connection.providerKey}`,
      category: 'integrations',
      title: connection.status === 'error' ? `${connection.name} authentication expired` : `${connection.name} sync is delayed`,
      body: connection.message || 'The connector needs attention before its data can be trusted.',
      priority: connection.status === 'error' ? 'high' : 'normal',
      actionPath: `/app/connections/${connection.id}`
    });
    if (connection.status === 'error') {
      recommendations.push({
        key: `restore-${connection.providerKey}`,
        category: 'campaigns',
        title: `Restore ${connection.name}`,
        body: 'Performance from this provider should not be acted on until the connection is healthy.',
        evidence: connection.message || 'Connection status is error.',
        actionLabel: 'Open connection',
        actionPath: `/app/connections/${connection.id}`
      });
    }
  }

  if (data.risingCpl[0]) {
    const row = data.risingCpl[0];
    alerts.push({
      key: `cpl-${row.id}`,
      category: 'campaigns',
      title: `${row.name} CPL increased ${row.cplChange}%`,
      body: `Cost per lead moved from ₹${row.previousCpl.toLocaleString('en-IN')} to ₹${row.cpl.toLocaleString('en-IN')}.`,
      priority: 'high',
      actionPath: `/app/growth/campaigns/${row.id}`
    });
    recommendations.push({
      key: `review-${row.id}`,
      category: 'campaigns',
      title: `Review ${row.name}`,
      body: 'The cost of a lead rose sharply against the previous week. Check audience, creative, and the project offer before adding budget.',
      evidence: `CPL ₹${row.previousCpl.toLocaleString('en-IN')} → ₹${row.cpl.toLocaleString('en-IN')}.`,
      actionLabel: 'View campaign',
      actionPath: `/app/growth/campaigns/${row.id}`
    });
  }

  if (data.calls.missed) {
    recommendations.push({
      key: 'missed-calls',
      category: 'sales',
      title: 'Return missed calls',
      body: `${data.calls.missed} calls were missed. Missed inbound calls from portal and campaign leads decay quickly.`,
      evidence: `${data.calls.total} calls are on record.`,
      actionLabel: 'Open calls',
      actionPath: '/app/sales/calls'
    });
  }

  for (const row of insights) await repo.upsertInsight({ organizationId, ...row });
  for (const row of alerts) {
    await repo.upsertAlert({ organizationId, ...row });
    await repo.notifyOwners(organizationId, row);
  }
  for (const row of recommendations) await repo.upsertRecommendation({ organizationId, ...row });
  await repo.clearStale(organizationId, 'ai_alerts', alerts.map((item) => item.key));
}

export async function refreshAll() {
  const orgs = await repo.organizationIds();
  for (const org of orgs) await refreshOrganization(org.id);
}

export async function listInsights(auth) {
  return {
    insights: await repo.insights(auth.organizationId),
    alerts: await repo.alerts(auth.organizationId)
  };
}

export async function listRecommendations(auth) {
  return { items: await repo.recommendations(auth.organizationId) };
}

export async function setRecommendation(auth, req, id) {
  await repo.setRecommendationStatus(auth.organizationId, id, req.body.status);
  await recordAudit(req, { action: 'recommendation.updated', resource: 'ai_recommendation', resourceId: id, metadata: { status: req.body.status } });
  return listRecommendations(auth);
}

export async function monitoring(auth) {
  const data = await stats(auth.organizationId);
  return {
    alerts: await repo.alerts(auth.organizationId),
    anomalies: data.risingCpl.map((row) => ({
      title: `${row.name} cost per lead`,
      body: `Up ${row.cplChange}% versus the previous week.`,
      path: `/app/growth/campaigns/${row.id}`
    })),
    connections: data.connections,
    leadQuality: {
      qualifiedDelta: delta(data.qualified.thisWeek, data.qualified.previousWeek),
      uncontactedHighIntent: data.uncontactedHighIntent
    },
    sales: data.calls
  };
}

export async function ask(auth, req) {
  const question = req.body.question.trim();
  const data = await stats(auth.organizationId);
  const brief = briefFrom(data);
  const q = question.toLowerCase();
  let payload;
  if (/call|objection|transcript|signal/.test(q)) {
    payload = {
      answer: data.calls.total
        ? `The workspace has ${data.calls.total} calls, ${data.calls.missed} missed, average score ${data.calls.averageScore ?? '—'}.`
        : 'No calls have been recorded yet.',
      evidence: 'Counts come from calls and call analysis in this organization.',
      insight: data.calls.missed ? 'Missed calls are the fastest sales leak on this desk.' : 'Call coverage is intact. Read objections on the latest scored calls.',
      action: 'Open the call list and start with anything missed or scored under 70.',
      actions: [{ label: 'Open calls', path: '/app/sales/calls' }]
    };
  } else if (/pipeline|deal|booking|revenue|sale/.test(q)) {
    payload = {
      answer: `Open pipeline is ₹${Math.round(data.pipeline.openValue).toLocaleString('en-IN')} across ${data.pipeline.openDeals} deals. Booked value on record is ₹${Math.round(data.pipeline.wonValue).toLocaleString('en-IN')}.`,
      evidence: `${data.pipeline.lostDeals} deals are marked lost.`,
      insight: 'Pipeline value only matters if site-visit and negotiation stages keep moving.',
      action: 'Review stalled negotiation deals before adding more top-of-funnel spend.',
      actions: [{ label: 'Open pipeline', path: '/app/sales/pipeline' }]
    };
  } else if (/campaign|cpl|spend|meta|google|magic|99/.test(q)) {
    const focus = data.risingCpl[0] || data.campaigns[0];
    const focusSpend = Number(focus?.spend ?? focus?.spendNow ?? 0);
    payload = {
      answer: focus
        ? `${focus.name} is at ${focus.cpl ? `₹${focus.cpl.toLocaleString('en-IN')} CPL` : 'no CPL yet'} on ₹${Math.round(focusSpend).toLocaleString('en-IN')} this week.`
        : 'No campaign metrics are available yet.',
      evidence: `Blended CPL this week is ${data.cpl.thisWeek ? `₹${data.cpl.thisWeek.toLocaleString('en-IN')}` : 'unavailable'}.`,
      insight: data.risingCpl[0] ? `${data.risingCpl[0].name} is the campaign pulling cost up.` : 'No campaign has a sharp CPL increase versus last week.',
      action: 'Open that campaign before changing budget.',
      actions: focus ? [{ label: 'View campaign', path: `/app/growth/campaigns/${focus.id}` }] : []
    };
  } else if (/lead|intent|inbox|qualif/.test(q)) {
    payload = {
      answer: `${data.leads.thisWeek} leads were created this week. ${data.qualified.thisWeek} are qualified or further. ${data.uncontactedHighIntent} high-intent leads are still new.`,
      evidence: brief.evidence,
      insight: brief.insight,
      action: brief.action,
      actions: [{ label: 'Open leads', path: '/app/growth/leads' }]
    };
  } else {
    payload = {
      answer: brief.answer,
      evidence: brief.evidence,
      insight: brief.insight,
      action: brief.action,
      actions: [{ label: 'Command center', path: '/app' }, { label: 'Connections', path: '/app/connections' }]
    };
  }

  const requested = req.body.conversationId
    ? await repo.ownConversation(req.body.conversationId, auth.organizationId, auth.userId)
    : null;
  const conversationId = requested?.id || await repo.saveConversation({
    organizationId: auth.organizationId,
    userId: auth.userId,
    title: question
  });
  await repo.saveMessage({ conversationId, role: 'user', content: question, payload: null });
  await repo.saveMessage({ conversationId, role: 'assistant', content: payload.answer, payload });
  await repo.logUsage({ organizationId: auth.organizationId, userId: auth.userId, surface: 'assistant', excerpt: question });
  return { conversationId, ...payload };
}

export async function history(auth, conversationId) {
  return {
    conversations: await repo.conversations(auth.organizationId, auth.userId),
    messages: conversationId ? await repo.messages(conversationId, auth.organizationId) : []
  };
}

export async function reportList(auth) {
  return { items: await repo.reports(auth.organizationId) };
}

export async function reportView(auth, slug) {
  const report = await repo.report(auth.organizationId, slug);
  if (!report) throw new ApiError(404, 'Report not found.', 'not_found');
  const data = await stats(auth.organizationId);
  return { report, data: sectionFor(report.reportKind, data) };
}

function sectionFor(kind, data) {
  if (kind === 'marketing' || kind === 'campaign') {
    return { series: data.series, campaigns: data.campaigns, spend: data.spend, cpl: data.cpl };
  }
  if (kind === 'sales') return { pipeline: data.pipeline, calls: data.calls };
  if (kind === 'leads' || kind === 'team') return { funnel: data.funnel, sources: data.sources, leads: data.leads, uncontactedHighIntent: data.uncontactedHighIntent };
  if (kind === 'calls') return { calls: data.calls };
  return {
    brief: briefFrom(data),
    kpis: data,
    funnel: data.funnel,
    campaigns: data.campaigns,
    pipeline: data.pipeline
  };
}

export async function analytics(auth, view) {
  const data = await stats(auth.organizationId);
  const views = {
    marketing: { series: data.series, campaigns: data.campaigns, spend: data.spend, cpl: data.cpl },
    leads: { funnel: data.funnel, sources: data.sources, leads: data.leads, qualified: data.qualified },
    sales: { pipeline: data.pipeline },
    calls: { calls: data.calls },
    funnel: { funnel: data.funnel },
    conversion: { funnel: data.funnel, sources: data.sources },
    attribution: { sources: data.sources, campaigns: data.campaigns },
    revenue: { pipeline: data.pipeline }
  };
  return { view, ...(views[view] || views.marketing) };
}

export async function search(auth, q) {
  const term = `%${String(q || '').replace(/[%_]/g, '').slice(0, 80)}%`;
  if (!q || String(q).trim().length < 2) return { groups: [] };
  const scope = leadScope(auth);
  const [leads, campaigns, calls] = await Promise.all([
    repo.searchLeads(auth.organizationId, term, scope.sql, scope.params),
    repo.searchCampaigns(auth.organizationId, term),
    repo.searchCalls(auth.organizationId, term)
  ]);
  const pathFor = {
    lead: (item) => `/app/growth/leads/${item.id}`,
    campaign: (item) => `/app/growth/campaigns/${item.id}`,
    call: (item) => `/app/sales/calls/${item.id}`
  };
  const groups = [
    { label: 'Leads', items: leads },
    { label: 'Campaigns', items: campaigns },
    { label: 'Calls', items: calls }
  ].map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({ ...item, path: pathFor[item.kind](item) }))
  })).filter((group) => group.items.length);
  return { groups };
}

export function notifications(auth) {
  return repo.notifications(auth.userId);
}

export function readNotification(auth, id) {
  return repo.markRead(auth.userId, id);
}

export function readAllNotifications(auth) {
  return repo.markAllRead(auth.userId);
}

export function clientAudit(auth) {
  return repo.audit(auth.organizationId);
}
