import * as repo from '../../repositories/adsAgentRepo.js';
import { ApiError } from '../../utils/errors.js';
import { recordAudit } from '../auditService.js';
import { importOrganization } from './leadImport.js';
import { normalizeSettings } from './guardrails.js';
import { experimentGroups, mergeQuality } from './monitorRules.js';

export async function quality(auth, query) {
  const days = [7, 14, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30;
  const [campaigns, rows, job] = await Promise.all([
    repo.campaignTotals(auth.organizationId, days),
    repo.leadQuality(auth.organizationId, days),
    repo.jobState('ads.lead_import')
  ]);
  const items = mergeQuality(campaigns, rows).filter((row) => row.spend > 0 || row.crmLeads > 0);
  const sum = (key) => items.reduce((total, row) => total + Number(row[key] || 0), 0);
  return {
    days,
    lastImport: job ? { status: job.status, finishedAt: job.finishedAt } : null,
    totals: {
      crmLeads: sum('crmLeads'),
      qualified: sum('qualified'),
      booked: sum('booked'),
      revenue: items.some((row) => row.revenue != null) ? sum('revenue') : null,
      bookedWithoutValue: sum('bookedWithoutValue')
    },
    items
  };
}

export async function experiments(auth) {
  const [settingsRow, ads, campaigns] = await Promise.all([
    repo.settings(auth.organizationId),
    repo.adWindow(auth.organizationId, 14),
    repo.campaignTotals(auth.organizationId, 14)
  ]);
  const names = new Map(campaigns.map((row) => [String(row.externalId), row.name]));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const groups = experimentGroups(ads, { today, minSpend: normalizeSettings(settingsRow).minSpendForDecision });
  return {
    adsSynced: ads.length,
    items: groups
      .map((group) => ({ ...group, campaignName: names.get(String(group.campaignId)) || null }))
      .sort((a, b) => ['winner', 'no_winner_yet', 'learning'].indexOf(a.verdict) - ['winner', 'no_winner_yet', 'learning'].indexOf(b.verdict))
  };
}

export async function importNow(auth, req) {
  if (!(await repo.claimJob(`ads.lead_import.org.${auth.organizationId}`, 5))) {
    throw new ApiError(429, 'Leads were imported in the last 5 minutes. Try again shortly.', 'rate_limited');
  }
  const result = await importOrganization(auth.organizationId);
  await recordAudit(req, {
    action: 'ads_agent.leads_imported',
    resource: 'ad_lead_imports',
    metadata: { connections: result.connections, created: result.created, matched: result.matched, skipped: result.skipped, failed: result.failed }
  });
  return result;
}
