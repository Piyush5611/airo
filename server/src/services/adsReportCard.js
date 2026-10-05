import { metaReport } from '../integrations/metaAds.js';
import { googleReport } from '../integrations/googleAds.js';
import { metaAccount } from './metaAdChat.js';
import { googleAccount } from './googleAdChat.js';
import { header, tiles, barLineChart, donut, table, callout, footer, renderReport } from './reportImage.js';

const ADS_ASK = /\b(ads?|campaigns?|meta|facebook|fb|instagram|insta|google|spend|cpl|ad\s*spend|cost per lead)\b/i;
const START_ASK = /\b(run|start|launch|create|chalao|chala|chalana|banao|bana|banana|lagao|lagana)\b/i;
const IST = 5.5 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RANGE_TITLES = {
  TODAY: 'Today',
  YESTERDAY: 'Yesterday',
  LAST_7_DAYS: 'Last 7 days',
  LAST_14_DAYS: 'Last 14 days',
  LAST_30_DAYS: 'Last 30 days',
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month'
};
const COMPARE = {
  TODAY: ['YESTERDAY', 1],
  YESTERDAY: ['LAST_7_DAYS', 1],
  LAST_7_DAYS: ['LAST_14_DAYS', 7],
  LAST_14_DAYS: ['LAST_30_DAYS', 14]
};

function n(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function istDay(offset = 0) {
  return new Date(Date.now() + IST - offset * DAY).toISOString().slice(0, 10);
}

function shortDate(iso) {
  const [, m, d] = String(iso).split('-').map(Number);
  return m && d ? `${d} ${MONTHS[m - 1]}` : String(iso);
}

function clock() {
  const ist = new Date(Date.now() + IST);
  const hour = ist.getUTCHours();
  return `${hour % 12 || 12}:${String(ist.getUTCMinutes()).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

function money(value, currency, short = false) {
  const amount = n(value);
  const sign = currency === 'INR' || !currency ? '₹' : `${currency} `;
  if (short) return `${sign}${compact(amount)}`;
  return `${sign}${amount.toLocaleString('en-IN', { maximumFractionDigits: amount >= 100 ? 0 : 2 })}`;
}

function compact(value) {
  const amount = n(value);
  if (amount >= 1e7) return `${(amount / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (amount >= 1e5) return `${(amount / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (amount >= 1e3) return `${(amount / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return String(Math.round(amount * 100) / 100);
}

function count(value) {
  return Math.round(n(value)).toLocaleString('en-IN');
}

function change(now, before) {
  if (before == null || !n(before)) return null;
  return Math.round(((n(now) - n(before)) / n(before)) * 100);
}

export function wantsAdsCard(messages) {
  const users = (messages || []).filter((row) => row.role === 'user');
  const latest = String(users[users.length - 1]?.content || '').trim();
  if (!latest || !ADS_ASK.test(latest)) return '';
  if (START_ASK.test(latest) && !/\b(report|chart|graph|performance|summary)\b/i.test(latest)) return '';
  if (/\bcalls?\b|\bcalling\b/i.test(latest) && !/\bads?\b/i.test(latest)) return '';
  if (/\b\d{10,13}\b/.test(latest)) return '';
  return latest;
}

function kindOf(text) {
  if (/campaign\s*(wise|report|performance|ka|ki|ke)|\bcampaigns\b|har campaign|campaign-wise/i.test(text)) return 'campaigns';
  if (/\b(chart|graph|trend|day by day|din ka|daily|performance)\b/i.test(text)) return 'trend';
  return 'summary';
}

function rangeOf(text, kind) {
  let range = 'LAST_7_DAYS';
  if (/\b(aaj|today)\b/i.test(text)) range = 'TODAY';
  else if (/\b(kal|yesterday)\b/i.test(text)) range = 'YESTERDAY';
  else if (/\b(pichle|pichhle|last|previous)\s+(mahine|month)\b/i.test(text)) range = 'LAST_MONTH';
  else if (/\b(is|this)\s+(mahine|month)\b/i.test(text)) range = 'THIS_MONTH';
  else if (/\b30\b|\bmonth\b|\bmahine\b/i.test(text)) range = 'LAST_30_DAYS';
  else if (/\b14\b/.test(text)) range = 'LAST_14_DAYS';
  if (kind === 'trend' && (range === 'TODAY' || range === 'YESTERDAY')) range = 'LAST_7_DAYS';
  return range;
}

function currentDays(range) {
  if (range === 'TODAY') return [istDay(0)];
  if (range === 'YESTERDAY') return [istDay(1)];
  if (range === 'LAST_7_DAYS') return Array.from({ length: 7 }, (_, index) => istDay(7 - index));
  if (range === 'LAST_14_DAYS') return Array.from({ length: 14 }, (_, index) => istDay(14 - index));
  return [];
}

function normalize(source, report) {
  const leadsKey = source === 'Meta' ? 'leads' : 'conversions';
  return {
    source,
    currency: report.currency || 'INR',
    notes: report.notes || [],
    daily: (report.daily || []).map((row) => ({ date: row.date, spend: n(row.spend), impressions: n(row.impressions), clicks: n(row.clicks), leads: n(row[leadsKey]) })),
    campaigns: (report.campaigns || []).map((row) => ({ id: row.id, name: row.name, source, spend: n(row.spend), impressions: n(row.impressions), clicks: n(row.clicks), leads: n(row[leadsKey]) }))
  };
}

function sum(rows) {
  return rows.reduce((total, row) => ({
    spend: total.spend + row.spend,
    impressions: total.impressions + row.impressions,
    clicks: total.clicks + row.clicks,
    leads: total.leads + row.leads
  }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });
}

async function loadAds(organizationId, range) {
  const [meta, google] = await Promise.all([metaAccount(organizationId), googleAccount(organizationId)]);
  if (!meta && !google) return null;
  const [compareRange, span] = COMPARE[range] || [];
  const jobs = [];
  if (meta) {
    jobs.push(metaReport({ apiKey: meta.apiKey, accountId: meta.accountId }, range).then((report) => normalize('Meta', report)));
    jobs.push(compareRange ? metaReport({ apiKey: meta.apiKey, accountId: meta.accountId }, compareRange).then((report) => normalize('Meta', report)) : Promise.resolve(null));
  }
  if (google) {
    jobs.push(googleReport(google.input, range).then((report) => normalize('Google', report)));
    jobs.push(compareRange ? googleReport(google.input, compareRange).then((report) => normalize('Google', report)) : Promise.resolve(null));
  }
  const settled = await Promise.allSettled(jobs);
  const sources = [];
  const failed = [];
  const names = [...(meta ? ['Meta Ads'] : []), ...(google ? ['Google Ads'] : [])];
  for (let index = 0; index < settled.length; index += 2) {
    const current = settled[index];
    const previous = settled[index + 1];
    if (current.status !== 'fulfilled') {
      failed.push(names[index / 2]);
      continue;
    }
    sources.push({ ...current.value, previous: previous.status === 'fulfilled' ? previous.value : null });
  }
  if (!sources.length) return { failed, names, sources: [] };

  const days = currentDays(range);
  const merged = new Map();
  for (const source of sources) {
    for (const row of source.daily) {
      const day = merged.get(row.date) || { date: row.date, spend: 0, impressions: 0, clicks: 0, leads: 0 };
      day.spend += row.spend;
      day.impressions += row.impressions;
      day.clicks += row.clicks;
      day.leads += row.leads;
      merged.set(row.date, day);
    }
  }
  if (days.length > 1) for (const date of days) if (!merged.has(date)) merged.set(date, { date, spend: 0, impressions: 0, clicks: 0, leads: 0 });
  const daily = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
  const totals = sum(sources.flatMap((source) => source.campaigns).length ? sources.flatMap((source) => source.campaigns) : daily);

  let previous = null;
  if (compareRange && days.length && sources.every((source) => source.previous)) {
    const first = days[0];
    const before = Array.from({ length: span }, (_, index) => new Date(new Date(`${first}T00:00:00Z`).getTime() - (span - index) * DAY).toISOString().slice(0, 10));
    const wanted = new Set(before);
    previous = sum(sources.flatMap((source) => source.previous.daily.filter((row) => wanted.has(row.date))));
  }
  const campaigns = sources.flatMap((source) => source.campaigns).filter((row) => row.spend > 0 || row.leads > 0 || row.clicks > 0);
  return {
    range,
    currency: sources[0].currency,
    names: sources.map((source) => `${source.source} Ads`),
    failed,
    daily,
    totals,
    previous,
    campaigns,
    sourceCount: sources.length
  };
}

function bestCampaign(campaigns) {
  const withLeads = campaigns.filter((row) => row.leads > 0);
  if (withLeads.length) return [...withLeads].sort((a, b) => b.leads - a.leads || (a.spend / a.leads) - (b.spend / b.leads))[0];
  return [...campaigns].sort((a, b) => b.clicks - a.clicks)[0] || null;
}

function insights(data) {
  const { totals, previous, currency } = data;
  const cpl = totals.leads ? totals.spend / totals.leads : null;
  const lines = [];
  const periodWord = data.range === 'TODAY' ? 'yesterday' : data.range === 'YESTERDAY' ? 'the day before' : `the previous ${data.range === 'LAST_14_DAYS' ? 14 : 7} days`;
  if (!totals.spend && !totals.leads) {
    lines.push('No ad spend in this period. Your campaigns may be paused or not delivering.');
    return lines;
  }
  if (totals.spend && !totals.leads) lines.push(`${money(totals.spend, currency)} was spent with no leads yet. Check the lead form, landing page, or targeting.`);
  if (previous) {
    const leadChange = change(totals.leads, previous.leads);
    const prevCpl = previous.leads ? previous.spend / previous.leads : null;
    const cplChange = cpl != null && prevCpl ? change(cpl, prevCpl) : null;
    if (leadChange != null) lines.push(`Leads ${leadChange >= 0 ? 'went up' : 'went down'} ${Math.abs(leadChange)}% compared with ${periodWord}.`);
    if (cplChange != null) {
      lines.push(cplChange > 0
        ? `Cost per lead went up ${cplChange}% compared with ${periodWord}. Consider refreshing the audience or creative.`
        : `Cost per lead went down ${Math.abs(cplChange)}% compared with ${periodWord}. Good efficiency.`);
    }
  }
  const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : 0;
  if (!lines.length && totals.impressions) lines.push(`Click-through rate is ${ctr.toFixed(2)}%. ${ctr < 1 ? 'A stronger headline or image may get more clicks.' : 'People are engaging with your ads.'}`);
  return lines.slice(0, 3);
}

function kpiTiles(data, full) {
  const { totals, previous, currency } = data;
  const cpl = totals.leads ? totals.spend / totals.leads : null;
  const prevCpl = previous?.leads ? previous.spend / previous.leads : null;
  const ctr = totals.impressions ? (totals.clicks / totals.impressions) * 100 : null;
  const items = [
    { label: 'Total spend', value: money(totals.spend, currency), icon: 'rupee', color: '#22C55E', delta: change(totals.spend, previous?.spend), deltaNote: 'vs before' },
    { label: 'Total leads', value: count(totals.leads), icon: 'users', color: '#2563EB', delta: change(totals.leads, previous?.leads), deltaNote: 'vs before' },
    { label: 'Cost per lead', value: cpl == null ? '—' : money(cpl, currency), icon: 'target', color: '#EF4444', delta: cpl != null && prevCpl ? change(cpl, prevCpl) : null, goodWhenUp: false, deltaNote: 'vs before', note: cpl == null ? 'No leads yet' : '' },
    { label: 'Clicks', value: count(totals.clicks), icon: 'pointer', color: '#8B5CF6', delta: change(totals.clicks, previous?.clicks), deltaNote: 'vs before' }
  ];
  if (full) {
    items.splice(3, 0, { label: 'Impressions', value: compact(totals.impressions), icon: 'eye', color: '#06B6D4', delta: change(totals.impressions, previous?.impressions), deltaNote: 'vs before' });
    items.push({ label: 'Click rate (CTR)', value: ctr == null ? '—' : `${ctr.toFixed(2)}%`, icon: 'percent', color: '#F59E0B', note: 'Clicks ÷ impressions' });
  }
  return items;
}

function titleFor(kind, range) {
  if (kind === 'campaigns') return 'Campaign Performance';
  if (kind === 'trend') return `${RANGE_TITLES[range]} Performance`;
  return range === 'TODAY' || range === 'YESTERDAY' ? 'Daily Ads Report' : 'Ads Report';
}

function subtitleFor(data) {
  const days = currentDays(data.range);
  if (days.length === 1) return `${RANGE_TITLES[data.range]}, ${shortDate(days[0])}`;
  if (days.length > 1) return `${RANGE_TITLES[data.range]} (${shortDate(days[0])} – ${shortDate(days[days.length - 1])})`;
  return RANGE_TITLES[data.range];
}

function caption(kind, data) {
  const { totals, currency } = data;
  const cpl = totals.leads ? money(totals.spend / totals.leads, currency) : '—';
  const best = bestCampaign(data.campaigns);
  const lines = [
    `📊 *${titleFor(kind, data.range)}* · ${subtitleFor(data)}`,
    `💰 Spend: *${money(totals.spend, currency)}*  👥 Leads: *${count(totals.leads)}*  🎯 CPL: *${cpl}*`,
    `👆 Clicks: *${count(totals.clicks)}*  👀 Impressions: *${count(totals.impressions)}*`
  ];
  if (kind === 'campaigns') {
    for (const row of [...data.campaigns].sort((a, b) => b.leads - a.leads || b.spend - a.spend).slice(0, 5)) {
      lines.push(`• ${row.name}: ${count(row.leads)} leads · ${money(row.spend, currency)}`);
    }
  } else if (best) {
    lines.push(`🏆 Best: *${best.name}* (${best.leads ? `${count(best.leads)} leads` : `${count(best.clicks)} clicks`})`);
  }
  const notes = insights(data);
  if (notes[0]) lines.push(`💡 ${notes[0]}`);
  if (data.failed.length) lines.push(`⚠️ ${data.failed.join(' and ')} did not load right now.`);
  lines.push(`_Live from ${data.names.join(' + ')} · ${clock()} IST_`);
  return lines.join('\n').slice(0, 1000);
}

function summaryBlocks(data, business) {
  const best = bestCampaign(data.campaigns);
  const blocks = [
    header({ theme: 'ads', title: titleFor('summary', data.range), subtitle: subtitleFor(data), business: [business, data.names.join(' + ')].filter(Boolean).join(' · ') }),
    tiles(kpiTiles(data, true))
  ];
  if (best) {
    const cpl = best.leads ? money(best.spend / best.leads, data.currency) : '—';
    blocks.push(callout({
      title: 'Best performing campaign',
      iconName: 'award',
      color: '#E11D48',
      lines: [`${best.name}${data.sourceCount > 1 ? ` (${best.source})` : ''}`, `Leads: ${count(best.leads)}  ·  CPL: ${cpl}  ·  Spend: ${money(best.spend, data.currency)}  ·  Clicks: ${count(best.clicks)}`]
    }));
  }
  const notes = insights(data);
  if (notes.length) blocks.push(callout({ title: 'Key insight', iconName: 'alert', color: '#F59E0B', lines: notes }));
  if (data.daily.length > 1) blocks.push(trendBlock(data));
  return blocks;
}

function trendBlock(data) {
  return barLineChart({
    title: 'Leads & Spend',
    labels: data.daily.map((row) => shortDate(row.date)),
    bars: data.daily.map((row) => row.leads),
    line: data.daily.map((row) => row.spend),
    barLabel: 'Leads',
    lineLabel: 'Spend',
    barFormat: (value) => compact(value),
    lineFormat: (value) => money(value, data.currency, true)
  });
}

function trendBlocks(data, business) {
  const notes = insights(data);
  return [
    header({ theme: 'ads', title: titleFor('trend', data.range), subtitle: subtitleFor(data), business: [business, data.names.join(' + ')].filter(Boolean).join(' · ') }),
    data.daily.length ? trendBlock(data) : null,
    tiles(kpiTiles(data, false)),
    notes.length ? callout({ title: 'Summary', iconName: 'trend', color: '#4F46E5', lines: notes }) : null
  ];
}

function campaignBlocks(data, business) {
  const rows = [...data.campaigns].sort((a, b) => b.leads - a.leads || b.spend - a.spend);
  const top = rows.slice(0, 8);
  const byLeads = data.totals.leads > 0;
  const shareRows = rows.slice(0, 5).map((row) => ({ label: row.name, value: byLeads ? row.leads : row.spend }));
  const rest = rows.slice(5).reduce((total, row) => total + (byLeads ? row.leads : row.spend), 0);
  if (rest > 0) shareRows.push({ label: 'Others', value: rest });
  return [
    header({ theme: 'ads', title: 'Campaign Performance', subtitle: subtitleFor(data), business: [business, data.names.join(' + ')].filter(Boolean).join(' · ') }),
    top.length ? table({
      title: 'Campaigns',
      columns: [
        { key: 'name', label: 'Campaign', weight: 4.2 },
        ...(data.sourceCount > 1 ? [{ key: 'source', label: 'Source', weight: 1.4 }] : []),
        { key: 'leads', label: 'Leads', weight: 1.3, align: 'right' },
        { key: 'cpl', label: 'CPL', weight: 1.7, align: 'right' },
        { key: 'spend', label: 'Spend', weight: 1.9, align: 'right' }
      ],
      rows: top.map((row) => ({
        name: row.name,
        source: row.source,
        leads: count(row.leads),
        cpl: row.leads ? money(row.spend / row.leads, data.currency) : '—',
        spend: money(row.spend, data.currency)
      }))
    }) : callout({ title: 'No campaign delivery', iconName: 'alert', lines: ['No campaign spent money or got leads in this period.'] }),
    shareRows.length ? donut({
      title: byLeads ? 'Leads by campaign' : 'Spend by campaign',
      items: shareRows,
      centerValue: byLeads ? count(data.totals.leads) : money(data.totals.spend, data.currency, true),
      centerLabel: byLeads ? 'Total leads' : 'Total spend',
      format: (value) => (byLeads ? count(value) : money(value, data.currency, true))
    }) : null
  ];
}

export function renderAdsReport(kind, data, businessName = '') {
  const blocks = kind === 'campaigns' ? campaignBlocks(data, businessName) : kind === 'trend' ? trendBlocks(data, businessName) : summaryBlocks(data, businessName);
  return renderReport([...blocks, footer(`Live from ${data.names.join(' + ')} · ${clock()} IST · AIRO`)]);
}

export async function adsReportCard(organizationId, messages, businessName = '') {
  const text = wantsAdsCard(messages);
  if (!text || !organizationId) return null;
  const kind = kindOf(text);
  const range = rangeOf(text, kind);
  const data = await loadAds(organizationId, range);
  if (!data) return null;
  if (!data.daily) {
    return { text: `⚠️ ${data.failed.join(' and ')} did not send the report right now. Please try again in a few minutes.`, image: null, model: 'Ads report card' };
  }
  const textCaption = caption(kind, data);
  let png = null;
  try {
    png = renderAdsReport(kind, data, businessName);
  } catch (error) {
    console.error('Ads report image failed:', String(error?.message || error).slice(0, 160));
  }
  const buttons = kind === 'campaigns'
    ? ['Ads report', 'Ads 7 day chart']
    : kind === 'trend' ? ['Ads report', 'Campaign wise'] : ['Campaign wise', 'Ads 7 day chart'];
  return {
    text: textCaption,
    image: png ? { png, caption: textCaption, buttons, title: titleFor(kind, range) } : null,
    model: 'Ads report card'
  };
}
