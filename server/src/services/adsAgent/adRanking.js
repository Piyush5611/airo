const MIN_IMPRESSIONS = 1000;

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const round = (value, digits = 2) => (value == null ? null : Number(value.toFixed(digits)));
const part = (ratio) => Math.min(Math.max(ratio, 0), 2) / 2;

export function adNumbers(row) {
  const spend = Number(row.spend) || 0;
  const impressions = Number(row.impressions) || 0;
  const clicks = Number(row.clicks) || 0;
  const results = Number(row.results) || 0;
  return {
    spend,
    impressions,
    clicks,
    results,
    ctr: impressions ? (clicks / impressions) * 100 : null,
    cpc: clicks ? spend / clicks : null,
    costPerResult: results ? spend / results : null
  };
}

function verdictOf(score) {
  if (score >= 65) return 'strong';
  if (score >= 40) return 'average';
  return 'weak';
}

// rows: { key, platform, level, name, currency, spend, impressions, clicks, results, metric: 'results'|'clicks', resultLabel }
export function rankAds(rows, { minSpend = 500 } = {}) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.platform}|${row.currency}|${row.metric}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...row, ...adNumbers(row) });
  }
  const items = [];
  const benchmarks = [];
  for (const [key, members] of groups) {
    const [platform, currency, metric] = key.split('|');
    const eligible = members.filter((row) => row.impressions >= MIN_IMPRESSIONS && row.spend >= minSpend / 2);
    const bench = {
      platform,
      currency,
      metric,
      resultLabel: members[0].resultLabel,
      compared: eligible.length,
      ctr: median(eligible.map((row) => row.ctr)),
      cpc: median(eligible.map((row) => row.cpc)),
      costPerResult: median(eligible.map((row) => row.costPerResult))
    };
    benchmarks.push({ ...bench, ctr: round(bench.ctr), cpc: round(bench.cpc), costPerResult: round(bench.costPerResult) });
    for (const row of members) {
      const base = {
        ...row,
        ctr: round(row.ctr),
        cpc: round(row.cpc),
        costPerResult: round(row.costPerResult),
        benchmark: { ctr: round(bench.ctr), cpc: round(bench.cpc), costPerResult: round(bench.costPerResult) }
      };
      if (!eligible.includes(row)) {
        items.push({ ...base, score: null, verdict: 'learning', reasons: [`Needs at least ${MIN_IMPRESSIONS} impressions and ${minSpend / 2} ${currency} spend to judge.`] });
        continue;
      }
      if (eligible.length < 2) {
        items.push({ ...base, score: null, verdict: 'alone', reasons: ['No other ad of the same kind with enough data to compare against.'] });
        continue;
      }
      const ctrPart = bench.ctr && row.ctr != null ? part(row.ctr / bench.ctr) : 0;
      let score;
      const reasons = [];
      if (metric === 'results' && bench.costPerResult) {
        const costPart = row.costPerResult ? part(bench.costPerResult / row.costPerResult) : 0;
        score = Math.round(100 * (0.65 * costPart + 0.35 * ctrPart));
        reasons.push(row.costPerResult
          ? `Cost per ${row.resultLabel.replace(/s$/, '')} ${round(row.costPerResult)} vs typical ${round(bench.costPerResult)} ${currency}.`
          : `${round(row.spend)} ${currency} spent with no ${row.resultLabel}.`);
      } else {
        const cpcPart = bench.cpc && row.cpc ? part(bench.cpc / row.cpc) : 0;
        score = Math.round(100 * (0.5 * ctrPart + 0.5 * cpcPart));
        reasons.push(row.cpc ? `Cost per click ${round(row.cpc)} vs typical ${round(bench.cpc)} ${currency}.` : 'No clicks yet.');
      }
      if (row.ctr != null && bench.ctr) reasons.push(`Click rate ${round(row.ctr)}% vs typical ${round(bench.ctr)}%.`);
      let verdict = verdictOf(score);
      if (metric === 'results' && !row.results && row.spend >= minSpend) verdict = 'weak';
      items.push({ ...base, score, verdict, reasons });
    }
  }
  const order = { strong: 0, average: 1, weak: 2, alone: 3, learning: 4 };
  items.sort((a, b) => (a.score == null) - (b.score == null) || (b.score ?? 0) - (a.score ?? 0) || order[a.verdict] - order[b.verdict] || b.spend - a.spend);
  return { items, benchmarks };
}

export function campaignMetric(rows, campaignKey) {
  const withResults = new Set();
  for (const row of rows) if (Number(row.results) > 0) withResults.add(campaignKey(row));
  return (row) => (withResults.has(campaignKey(row)) ? 'results' : 'clicks');
}
