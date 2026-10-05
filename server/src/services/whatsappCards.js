import { adsReportCard } from './adsReportCard.js';
import { callReportCard, fmt, pct, talk, hourName, hourStats, hourSpan } from './callReportCard.js';
import { header, tiles, barLineChart, donut, hbars, callout, footer, renderReport, statRows, table } from './reportImage.js';

const CALL_BUTTONS = {
  'calls-summary': ['Detailed call report', 'Agent wise report', 'Missed calls', 'Weekly call report'],
  calls: ['Agent wise report', 'Missed calls', 'Weekly call report'],
  'calls-agents': ['Call report', 'Missed calls', 'Best call time'],
  'calls-missed': ['Call report', 'Agent wise report', 'Best call time'],
  hours: ['Call report', 'Agent wise report', 'Weekly call report']
};
const CALL_TITLES = {
  'calls-summary': 'Call report',
  calls: 'Detailed call report',
  'calls-agents': 'Agent wise report',
  'calls-missed': 'Missed calls',
  hours: 'Best time to call'
};

function change(now, before) {
  if (before == null || !n(before)) return null;
  return Math.round(((n(now) - n(before)) / n(before)) * 100);
}

function avgTalk(totals) {
  const connected = n(totals?.connected_calls);
  return connected ? n(totals.connected_calls_duration_seconds || totals.total_duration_seconds) / connected : 0;
}

function headerFor(visual, title) {
  return header({ theme: 'calls', title, subtitle: visual.label, business: [visual.business, 'Call Yatri'].filter(Boolean).join(' · ') });
}

function summaryInsights(visual) {
  const t = visual.totals;
  const p = visual.previous;
  const lines = [];
  const rate = pct(t.connected_calls, t.total_calls);
  if (p && n(p.total_calls)) {
    const volume = change(t.total_calls, p.total_calls);
    const pRate = pct(p.connected_calls, p.total_calls);
    lines.push(`Call volume ${volume >= 0 ? 'increased' : 'decreased'} by ${Math.abs(volume)}% compared with ${visual.previousLabel}.`);
    lines.push(`Answer rate is ${rate}%, ${rate === pRate ? 'the same as' : `${Math.abs(rate - pRate)} points ${rate > pRate ? 'higher' : 'lower'} than`} ${visual.previousLabel}.`);
  } else {
    lines.push(`Answer rate is ${rate}% (${fmt(t.connected_calls)} of ${fmt(t.total_calls)} calls connected).`);
  }
  const unanswered = n(t.missed_calls) + n(t.not_picked_calls);
  if (unanswered && pct(unanswered, t.total_calls) >= 40) lines.push(`${pct(unanswered, t.total_calls)}% of calls were not answered. Try calling back at the best time slots.`);
  return lines.slice(0, 3);
}

function summaryBlocks(visual) {
  const t = visual.totals;
  const p = visual.previous;
  const total = n(t.total_calls);
  const rate = pct(t.connected_calls, total);
  const avg = avgTalk(t);
  return [
    headerFor(visual, visual.multiDay ? 'Call Report' : 'Daily Call Report'),
    statRows([
      { label: 'Total calls', value: fmt(total), icon: 'phone', color: '#2563EB', delta: change(total, p?.total_calls), note: p ? `${visual.previousLabel.replace(/^the previous \d+ days$/, 'before').replace(' same time', '')}: ${fmt(p.total_calls)}` : `${fmt(t.outgoing_total_calls)} out · ${fmt(t.incoming_total_calls)} in` },
      { label: 'Answered calls', value: fmt(t.connected_calls), icon: 'check', color: '#16A34A', delta: change(t.connected_calls, p?.connected_calls), note: `${rate}% answer rate` },
      { label: 'Not picked', value: fmt(t.not_picked_calls), icon: 'phone', color: '#F59E0B', delta: change(t.not_picked_calls, p?.not_picked_calls), goodWhenUp: false, note: `${pct(t.not_picked_calls, total)}% of calls` },
      { label: 'Missed calls', value: fmt(t.missed_calls), icon: 'phone', color: '#EF4444', delta: change(t.missed_calls, p?.missed_calls), goodWhenUp: false, note: `${pct(t.missed_calls, total)}% missed rate` },
      { label: 'Avg. call time', value: talk(avg), icon: 'clock', color: '#8B5CF6', delta: p ? change(avg, avgTalk(p)) : null, note: '(answered calls)' }
    ]),
    callout({ title: 'Key insight', iconName: 'award', color: '#16A34A', tint: '#F0FDF4', lines: summaryInsights(visual) }),
    footer(`Live from Call Yatri · ${visual.time} IST · AIRO`)
  ];
}

function agentBlocks(visual) {
  const active = [...(visual.employees || [])].filter((row) => n(row.total_calls) > 0).sort((a, b) => n(b.total_calls) - n(a.total_calls));
  const idle = (visual.employees || []).length - active.length;
  const top = active.slice(0, 15);
  return [
    headerFor(visual, 'Agent Wise Report'),
    tiles([
      { label: 'Active agents', value: `${active.length}`, icon: 'users', color: '#2563EB', note: idle ? `${idle} made no calls` : 'Everyone made calls' },
      { label: 'Calls per agent', value: active.length ? fmt(n(visual.totals.total_calls) / active.length) : '0', icon: 'phone', color: '#16A34A', note: `${fmt(visual.totals.total_calls)} calls in total` }
    ]),
    table({
      title: active.length > 15 ? `Top 15 of ${active.length} agents` : 'All agents',
      iconName: 'users',
      columns: [
        { key: 'name', label: 'Agent', weight: 3.4 },
        { key: 'calls', label: 'Calls', weight: 1.3, align: 'right' },
        { key: 'connected', label: 'Answered', weight: 1.6, align: 'right' },
        { key: 'rate', label: 'Rate', weight: 1.2, align: 'right' },
        { key: 'talk', label: 'Talk time', weight: 1.8, align: 'right' }
      ],
      rows: top.map((row) => ({
        name: row.employee_name,
        calls: fmt(row.total_calls),
        connected: fmt(row.connected_calls),
        rate: `${pct(row.connected_calls, row.total_calls)}%`,
        talk: talk(row.total_duration_seconds)
      }))
    }),
    footer(`Live from Call Yatri · ${visual.time} IST · AIRO`)
  ];
}

function missedBlocks(visual) {
  const t = visual.totals;
  const p = visual.previous;
  const unanswered = (row) => n(row.missed_calls) + n(row.not_picked_calls) + n(row.rejected_calls);
  const ranked = [...(visual.employees || [])].filter((row) => unanswered(row) > 0).sort((a, b) => unanswered(b) - unanswered(a)).slice(0, 10);
  const total = n(t.total_calls);
  return [
    headerFor(visual, 'Missed Calls'),
    statRows([
      { label: 'Missed calls', value: fmt(t.missed_calls), icon: 'phone', color: '#EF4444', delta: change(t.missed_calls, p?.missed_calls), goodWhenUp: false, note: `${pct(t.missed_calls, total)}% of all calls` },
      { label: 'Not picked', value: fmt(t.not_picked_calls), icon: 'phone', color: '#F59E0B', delta: change(t.not_picked_calls, p?.not_picked_calls), goodWhenUp: false, note: `${pct(t.not_picked_calls, total)}% of all calls` },
      { label: 'Rejected', value: fmt(t.rejected_calls), icon: 'alert', color: '#64748B', delta: change(t.rejected_calls, p?.rejected_calls), goodWhenUp: false, note: `${pct(t.rejected_calls, total)}% of all calls` }
    ]),
    ranked.length ? hbars({
      title: 'Most unanswered by agent',
      iconName: 'users',
      format: fmt,
      rows: ranked.map((row, index) => ({
        rank: index + 1,
        label: shortName(row.employee_name),
        value: unanswered(row),
        color: '#EF4444',
        sub: `${pct(unanswered(row), row.total_calls)}% of calls`,
        subColor: pct(unanswered(row), row.total_calls) >= 60 ? '#DC2626' : '#64748B'
      }))
    }) : null,
    callout({ title: 'What to do', iconName: 'bulb', color: '#F59E0B', lines: ['Call back missed and not-picked numbers first.', 'Ask "best call time" to see when people pick up the most.'] }),
    footer(`Live from Call Yatri · ${visual.time} IST · AIRO`)
  ];
}

function n(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount : 0;
}

function shortName(name) {
  const parts = String(name || '—').trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

function callBlocks(visual) {
  const t = visual.totals;
  const total = n(t.total_calls);
  const connected = n(t.connected_calls);
  const employees = visual.employees || [];
  const active = employees.filter((row) => n(row.total_calls) > 0);
  const blocks = [
    header({
      theme: 'calls',
      title: visual.scope === 'All callers' ? 'Call Report' : `Call Report · ${visual.scope}`,
      subtitle: visual.label,
      business: [visual.business, 'Call Yatri'].filter(Boolean).join(' · ')
    }),
    tiles([
      { label: 'Total calls', value: fmt(total), icon: 'phone', color: '#2563EB', note: `${fmt(t.outgoing_total_calls)} out · ${fmt(t.incoming_total_calls)} in` },
      { label: 'Connected', value: fmt(connected), icon: 'check', color: '#16A34A', note: `${pct(connected, total)}% of all calls` },
      { label: 'Talk time', value: talk(t.total_duration_seconds), icon: 'clock', color: '#F59E0B', note: connected ? `avg ${talk(n(t.connected_calls_duration_seconds || t.total_duration_seconds) / connected)} per call` : 'No connected calls' },
      visual.person
        ? { label: 'Rank', value: `#${visual.person.rank}`, icon: 'award', color: '#8B5CF6', note: `of ${visual.person.of} callers` }
        : n(t.unique_clients)
          ? { label: 'Unique clients', value: fmt(t.unique_clients), icon: 'users', color: '#8B5CF6', note: `${active.length} active callers` }
          : { label: 'Active callers', value: fmt(active.length), icon: 'users', color: '#8B5CF6', note: `of ${employees.length}` }
    ]),
    donut({
      title: 'Call outcome',
      items: [
        { label: 'Connected', value: connected, color: '#22C55E' },
        { label: 'Not picked', value: n(t.not_picked_calls), color: '#F59E0B' },
        { label: 'Missed', value: n(t.missed_calls), color: '#EF4444' },
        { label: 'Rejected', value: n(t.rejected_calls), color: '#64748B' }
      ],
      centerValue: fmt(total),
      centerLabel: 'Total calls',
      format: fmt
    })
  ];
  if (visual.days?.length >= 2) {
    blocks.push(barLineChart({
      title: 'Day by day',
      iconName: 'calendar',
      labels: visual.days.map((row) => row.label.replace(/^\w+ /, '')),
      bars: visual.days.map((row) => row.value),
      line: visual.days.map((row) => row.connected),
      barLabel: 'Calls',
      lineLabel: 'Connected',
      barFormat: (value) => (value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(value))),
      lineFormat: (value) => (value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(value)))
    }));
  }
  if (visual.person) {
    const max = Math.max(n(t.total_calls), visual.person.average, visual.person.top, 1);
    blocks.push(hbars({
      title: 'Compared with the team',
      iconName: 'users',
      maxValue: max,
      format: fmt,
      rows: [
        { label: 'This caller', value: n(t.total_calls), color: '#2563EB' },
        { label: 'Team average', value: Math.round(visual.person.average), color: '#94A3B8' },
        { label: 'Top caller', value: visual.person.top, color: '#22C55E' }
      ]
    }));
  } else if (active.length) {
    const ranked = [...active].sort((a, b) => n(b.total_calls) - n(a.total_calls)).slice(0, 8);
    blocks.push(hbars({
      title: 'Top callers',
      format: fmt,
      rows: ranked.map((row, index) => {
        const rate = pct(row.connected_calls, row.total_calls);
        return { rank: index + 1, label: shortName(row.employee_name), value: n(row.total_calls), sub: `${rate}% conn.`, subColor: rate >= 50 ? '#16A34A' : rate < 35 ? '#DC2626' : '#64748B' };
      })
    }));
    const steady = active.filter((row) => n(row.total_calls) >= 10);
    const bestRate = [...steady].sort((a, b) => pct(b.connected_calls, b.total_calls) - pct(a.connected_calls, a.total_calls))[0];
    const low = steady.filter((row) => pct(row.connected_calls, row.total_calls) < 35).slice(0, 3);
    const idle = employees.length - active.length;
    const notes = [];
    if (bestRate) notes.push(`Best connect rate: ${bestRate.employee_name} (${pct(bestRate.connected_calls, bestRate.total_calls)}%).`);
    if (low.length) notes.push(`Needs attention: ${low.map((row) => `${row.employee_name} (${pct(row.connected_calls, row.total_calls)}%)`).join(', ')} connected under 35%.`);
    if (idle > 0) notes.push(`${idle} caller${idle > 1 ? 's' : ''} made no calls in this period.`);
    if (notes.length) blocks.push(callout({ title: 'Key insights', iconName: 'bulb', color: '#F59E0B', lines: notes }));
  }
  blocks.push(footer(`Live from Call Yatri · ${visual.time} IST · AIRO`));
  return blocks;
}

function hourBlocks(visual) {
  const stats = hourStats(visual.sums);
  if (!stats) return null;
  const { rows, allConnected, most, bestRate, worstRate, peak } = stats;
  const items = [
    { label: 'Most connected', value: hourSpan(most.hour), icon: 'award', color: '#2563EB', note: `${fmt(most.connected)} connected · ${pct(most.connected, most.total)}%` }
  ];
  if (bestRate) items.push({ label: 'Best pick-up rate', value: hourSpan(bestRate.hour), icon: 'target', color: '#16A34A', note: `${pct(bestRate.connected, bestRate.total)}% picked up` });
  if (peak) items.push({ label: 'Peak 3 hours', value: hourSpan(peak.from, 3), icon: 'trend', color: '#8B5CF6', note: `${pct(peak.connected, allConnected)}% of connected calls` });
  if (worstRate) items.push({ label: 'Lowest pick-up', value: hourSpan(worstRate.hour), icon: 'alert', color: '#EF4444', note: `${pct(worstRate.connected, worstRate.total)}% picked up` });
  const slots = bestRate ? [...new Set([most.hour, bestRate.hour])].map((hour) => hourSpan(hour)) : [hourSpan(most.hour)];
  return [
    header({ theme: 'hours', title: 'Best Time to Call', subtitle: visual.label, business: [visual.business, 'Call Yatri'].filter(Boolean).join(' · ') }),
    barLineChart({
      title: 'Connected calls by hour',
      iconName: 'clock',
      labels: rows.map((row) => hourName(row.hour).replace(' ', '')),
      bars: rows.map((row) => row.connected),
      line: rows.map((row) => pct(row.connected, row.total)),
      barLabel: 'Connected',
      lineLabel: 'Pick-up %',
      barColor: '#0EA5E9',
      lineColor: '#F59E0B',
      barFormat: (value) => (value >= 1000 ? `${(value / 1000).toFixed(1).replace(/\.0$/, '')}K` : String(Math.round(value))),
      lineFormat: (value) => `${Math.round(value)}%`,
      note: rows.length < 24 ? 'Quiet hours with very few calls are hidden.' : ''
    }),
    tiles(items, 2),
    callout({ title: 'Tip', iconName: 'bulb', color: '#0D9488', lines: [`Plan important calls in the ${slots.join(' and ')} slot${slots.length > 1 ? 's' : ''}.`, ...(visual.failed ? [`${visual.failed} hour(s) could not be loaded, so numbers may be a little low.`] : [])] }),
    footer(`Live from Call Yatri · ${visual.time} IST · AIRO`)
  ];
}

function callCaption(visual) {
  if (visual.type === 'hours') {
    const stats = hourStats(visual.sums);
    if (!stats) return '';
    const lines = [`⏰ *Best time to call* · ${visual.label}`, `🏆 Most connected: *${hourSpan(stats.most.hour)}*`];
    if (stats.bestRate) lines.push(`🎯 Best pick-up rate: *${hourSpan(stats.bestRate.hour)}* (${pct(stats.bestRate.connected, stats.bestRate.total)}%)`);
    if (stats.peak) lines.push(`🔥 Peak 3 hours: *${hourSpan(stats.peak.from, 3)}*`);
    lines.push(`_Live from Call Yatri · ${visual.time} IST_`);
    return lines.join('\n');
  }
  const t = visual.totals;
  if (visual.type === 'calls-summary') {
    const delta = change(t.total_calls, visual.previous?.total_calls);
    return [
      `📞 *${visual.multiDay ? 'Call report' : 'Daily call report'}* · ${visual.label}`,
      `📞 Total: *${fmt(t.total_calls)}*${delta != null ? ` (${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}% vs ${visual.previousLabel})` : ''}`,
      `✅ Answered: *${fmt(t.connected_calls)}* (${pct(t.connected_calls, t.total_calls)}%)  🔕 Not picked: *${fmt(t.not_picked_calls)}*  ❌ Missed: *${fmt(t.missed_calls)}*`,
      `⏱️ Avg. call: *${talk(avgTalk(t))}*`,
      `_Live from Call Yatri · ${visual.time} IST_`
    ].join('\n');
  }
  if (visual.type === 'calls-missed') {
    return [
      `❌ *Missed calls* · ${visual.label}`,
      `❌ Missed: *${fmt(t.missed_calls)}*  🔕 Not picked: *${fmt(t.not_picked_calls)}*  ⛔ Rejected: *${fmt(t.rejected_calls)}*`,
      `_Live from Call Yatri · ${visual.time} IST_`
    ].join('\n');
  }
  const lines = [
    `📞 *${visual.type === 'calls-agents' ? 'Agent wise report' : 'Call report'}* · ${visual.label}${visual.scope && visual.scope !== 'All callers' ? ` · ${visual.scope}` : ''}`,
    `📞 Calls: *${fmt(t.total_calls)}*  ✅ Connected: *${fmt(t.connected_calls)}* (${pct(t.connected_calls, t.total_calls)}%)`,
    `⏱️ Talk time: *${talk(t.total_duration_seconds)}*`
  ];
  const top = [...(visual.employees || [])].sort((a, b) => n(b.total_calls) - n(a.total_calls))[0];
  if (top && n(top.total_calls)) lines.push(`🥇 Top caller: *${top.employee_name}* (${fmt(top.total_calls)} calls)`);
  lines.push(`_Live from Call Yatri · ${visual.time} IST_`);
  return lines.join('\n');
}

export async function whatsappReportCard(organizationId, messages, businessName = '') {
  const ads = await adsReportCard(organizationId, messages, businessName);
  if (ads) return ads;
  const call = await callReportCard(organizationId, messages, businessName);
  if (!call) return null;
  let image = null;
  if (call.visual) {
    try {
      const type = call.visual.type;
      const blocks = type === 'hours' ? hourBlocks(call.visual)
        : type === 'calls-summary' ? summaryBlocks(call.visual)
          : type === 'calls-agents' ? agentBlocks(call.visual)
            : type === 'calls-missed' ? missedBlocks(call.visual)
              : callBlocks(call.visual);
      if (blocks) {
        image = {
          png: renderReport(blocks),
          caption: callCaption(call.visual),
          buttons: (CALL_BUTTONS[type] || CALL_BUTTONS.calls).map((title) => (title === 'Weekly call report' && call.visual.multiDay ? 'Today call report' : title)),
          title: CALL_TITLES[type] || 'Call report'
        };
      }
    } catch (error) {
      console.error('Call report image failed:', String(error?.message || error).slice(0, 160));
    }
  }
  return { text: call.text, image, model: 'Call report card' };
}
