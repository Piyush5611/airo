import { useState } from 'react';
import { api } from '../api.js';
import { useResource } from '../data.js';
import { ago, num } from '../format.js';
import { Badge, State, Table } from '../ui.jsx';

function money(value, currency) {
  if (value == null) return '—';
  const amount = Number(value);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency || ''} ${amount.toFixed(2)}`.trim();
  }
}

const VERDICT = {
  winner: ['Winner found', 'good'],
  no_winner_yet: ['No clear winner yet', 'warn'],
  learning: ['Still learning', 'info']
};
const ROLE = { winner: 'Winner', loser: 'Weaker', tie: 'Close', learning: 'Needs more data' };

const GRADE = {
  strong: ['Strong', 'good'],
  average: ['Average', 'info'],
  weak: ['Weak', 'bad'],
  alone: ['Nothing to compare', 'warn'],
  learning: ['Needs more data', 'warn']
};
const PLATFORM = { meta: 'Meta', google: 'Google' };

export function AnalysisPanel({ connectionId }) {
  const [days, setDays] = useState(14);
  const { data, loading, error, reload } = useResource(`/api/ads-agent/analysis?days=${days}`);
  const items = forConnection(data?.items, connectionId);
  const counted = (verdict) => items.filter((row) => row.verdict === verdict).length;
  const counts = data ? (connectionId ? { total: items.length, strong: counted('strong'), average: counted('average'), weak: counted('weak'), learning: counted('learning') + counted('alone') } : data.counts) : null;
  return (
    <div className="stack">
      <section className="panel">
        <header>
          <h2>Ad analysis</h2>
          <div className="filters">
            {[7, 14, 30].map((value) => (
              <button key={value} type="button" className={value === days ? 'btn-primary' : 'btn'} onClick={() => setDays(value)}>{value} days</button>
            ))}
          </div>
        </header>
        <p className="quiet">
          Every ad (Meta) and campaign (Google) with spend in the period, ranked against others of the same kind on the same platform and currency.
          Ads in campaigns that get leads or conversions are judged on cost per result (65%) and click rate (35%); the rest on click rate and cost per click.
          A score of 50 is typical for your account. An ad needs at least 1,000 impressions and half the minimum decision spend before it is judged.
          Numbers come from the last Meta and Google sync{data?.lastSyncedAt ? ` (${ago(data.lastSyncedAt)})` : ''}, not today.
        </p>
        {counts ? (
          <p>
            <strong>{counts.total}</strong> analysed · <Badge value={`${counts.strong} strong`} tone="good" /> <Badge value={`${counts.average} average`} tone="info" /> <Badge value={`${counts.weak} weak`} tone="bad" /> <Badge value={`${counts.learning} need data`} tone="warn" />
          </p>
        ) : null}
        {data?.notes?.map((note) => <p className="quiet" key={note}>{note}</p>)}
      </section>
      <State loading={loading} error={error} onRetry={reload} empty={data && !items.length ? { title: 'No ad data yet', body: 'Connect Meta Ads or Google Ads and press Sync now on the Performance tab.' } : null}>
        {items.length ? (
          <Table
            columns={[
              {
                key: 'name',
                label: 'Ad',
                render: (row) => (
                  <>
                    <strong>{row.name}</strong>
                    <small>{PLATFORM[row.platform]} {row.level}{row.campaignName ? ` · ${row.campaignName}` : ''}{row.madeByAiro ? ' · made by AIRO' : ''}{row.status ? ` · ${String(row.status).toLowerCase()}` : ''}</small>
                  </>
                )
              },
              { key: 'score', label: 'Score', render: (row) => <><strong>{row.score ?? '—'}</strong> <Badge value={GRADE[row.verdict][0]} tone={GRADE[row.verdict][1]} /></> },
              { key: 'spend', label: 'Spend', render: (row) => money(row.spend, row.currency) },
              { key: 'results', label: 'Results', render: (row) => (row.results ? `${num(row.results)} ${row.resultLabel}` : '—') },
              { key: 'costPerResult', label: 'Cost / result', render: (row) => <>{money(row.costPerResult, row.currency)}{row.benchmark.costPerResult ? <small>typical {money(row.benchmark.costPerResult, row.currency)}</small> : null}</> },
              { key: 'ctr', label: 'Click rate', render: (row) => <>{row.ctr == null ? '—' : `${row.ctr}%`}{row.benchmark.ctr ? <small>typical {row.benchmark.ctr}%</small> : null}</> },
              { key: 'cpc', label: 'Cost / click', render: (row) => money(row.cpc, row.currency) },
              { key: 'reasons', label: 'Why', render: (row) => row.reasons.join(' ') }
            ]}
            rows={items.map((row) => ({ ...row, id: row.key }))}
          />
        ) : null}
      </State>
    </div>
  );
}

export function ExperimentsPanel({ connectionId }) {
  const { data, loading, error, reload } = useResource('/api/ads-agent/experiments');
  const items = forConnection(data?.items, connectionId);
  return (
    <div className="stack">
      <section className="panel">
        <header><h2>A/B tests</h2></header>
        <p className="quiet">
          Ads running side by side in the same Meta ad set over the last 14 days. They are compared on leads per impression when there are at least 10 leads, otherwise on click rate.
          A winner needs at least 1,000 impressions and 3 days per ad, 20% better results and 95% confidence. The weaker ad then shows up as a recommendation in the Decision log.
        </p>
      </section>
      <State loading={loading} error={error} onRetry={reload} empty={data && !items.length ? { title: 'No A/B tests running', body: data.adsSynced ? 'No ad set has two or more ads spending right now.' : 'Ad-level data comes in with the next Meta sync.' } : null}>
        {items.map((group) => (
          <section className="panel" key={group.key}>
            <header>
              <h2>{group.campaignName || `Campaign ${group.campaignId}`}</h2>
              <Badge value={VERDICT[group.verdict][0]} tone={VERDICT[group.verdict][1]} />
            </header>
            <p className="quiet">Ad set {group.adsetId} · compared on {group.metric === 'leads' ? 'leads per impression' : 'click rate'}</p>
            <Table
              columns={[
                { key: 'name', label: 'Ad', render: (row) => <>{row.name}<br /><span className="quiet">{ROLE[row.role]}</span></> },
                { key: 'spend', label: 'Spend', render: (row) => money(row.spend, group.currency) },
                { key: 'impressions', label: 'Impressions', render: (row) => num(row.impressions) },
                { key: 'clicks', label: 'Clicks', render: (row) => num(row.clicks) },
                { key: 'leads', label: 'Leads', render: (row) => (row.leads == null ? '—' : num(row.leads)) },
                { key: 'ratePct', label: group.metric === 'leads' ? 'Leads / impression' : 'Click rate', render: (row) => `${row.ratePct}%` },
                { key: 'costPerResult', label: 'Cost / result', render: (row) => money(row.costPerResult, group.currency) },
                { key: 'confidence', label: 'vs best', render: (row) => (row.confidence == null ? '—' : `${row.liftPct == null ? '' : `-${row.liftPct}% · `}${row.confidence}% sure`) }
              ]}
              rows={group.ads}
            />
          </section>
        ))}
      </State>
    </div>
  );
}

function forConnection(items, connectionId) {
  if (!connectionId) return items || [];
  return (items || []).filter((row) => String(row.connectionId) === String(connectionId));
}

function qualityTotals(items) {
  const sum = (key) => items.reduce((total, row) => total + Number(row[key] || 0), 0);
  return {
    crmLeads: sum('crmLeads'),
    qualified: sum('qualified'),
    booked: sum('booked'),
    revenue: items.some((row) => row.revenue != null) ? sum('revenue') : null,
    bookedWithoutValue: sum('bookedWithoutValue')
  };
}

export function QualityPanel({ canManage, connectionId }) {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useResource(`/api/ads-agent/quality?days=${days}`);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  async function importNow() {
    setBusy(true);
    setNote('');
    try {
      const result = await api.post('/api/ads-agent/leads/import', {});
      setNote([
        result.connections ? `${result.created} new leads, ${result.matched} matched to existing leads.` : 'No Meta Ads account is connected.',
        result.skipped ? `${result.skipped} had no phone number.` : '',
        ...result.notes
      ].filter(Boolean).join(' '));
      reload();
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  const items = forConnection(data?.items, connectionId);
  const totals = data ? (connectionId ? qualityTotals(items) : data.totals) : null;
  return (
    <div className="stack">
      <section className="panel">
        <header>
          <h2>Lead quality</h2>
          <div className="page-actions">
            <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Range">
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            {canManage ? <button className="btn" onClick={importNow} disabled={busy}>{busy ? 'Importing…' : 'Import leads now'}</button> : null}
          </div>
        </header>
        <p className="quiet">
          Meta lead form leads come into Leads every 30 minutes{data?.lastImport?.finishedAt ? ` (last run ${ago(data.lastImport.finishedAt)})` : ''}. Each lead counts for the campaign whose form created it.
          Qualified means the lead reached qualified, site visit, negotiation or booked. Revenue is the deal value entered on booked leads.
          Google Ads leads are not linked yet.
        </p>
        {note ? <p className="quiet">{note}</p> : null}
      </section>
      <State loading={loading} error={error} onRetry={reload} empty={data && !items.length ? { title: 'No ad leads yet', body: 'Connect Meta Ads and run lead form ads. Leads appear here once they are imported and synced.' } : null}>
        {totals ? (
          <div className="metric-strip">
            <div className="metric"><span>Leads from ads</span><strong>{num(totals.crmLeads)}</strong><em>in Leads</em></div>
            <div className="metric"><span>Qualified</span><strong>{num(totals.qualified)}</strong><em>{totals.crmLeads ? `${Math.round((totals.qualified / totals.crmLeads) * 100)}% of leads` : '—'}</em></div>
            <div className="metric"><span>Booked</span><strong>{num(totals.booked)}</strong><em>{totals.bookedWithoutValue ? `${totals.bookedWithoutValue} without deal value` : 'with deal value'}</em></div>
            <div className="metric"><span>Revenue</span><strong>{money(totals.revenue, 'INR')}</strong><em>from booked leads</em></div>
          </div>
        ) : null}
        {items.length ? (
          <Table
            columns={[
              { key: 'name', label: 'Campaign', render: (row) => row.name || `Meta campaign ${row.externalId}` },
              { key: 'spend', label: 'Spend', render: (row) => money(row.spend, row.currency) },
              { key: 'crmLeads', label: 'Leads', render: (row) => <>{num(row.crmLeads)}{row.platformLeads != null ? <><br /><span className="quiet">Meta: {num(row.platformLeads)}</span></> : null}</> },
              { key: 'qualified', label: 'Qualified', render: (row) => `${num(row.qualified)}${row.qualifiedRate == null ? '' : ` (${row.qualifiedRate}%)`}` },
              { key: 'booked', label: 'Booked', render: (row) => num(row.booked) },
              { key: 'costPerLead', label: 'Cost / lead', render: (row) => money(row.costPerLead, row.currency) },
              { key: 'costPerQualifiedLead', label: 'Cost / qualified', render: (row) => money(row.costPerQualifiedLead, row.currency) },
              { key: 'revenue', label: 'Revenue', render: (row) => money(row.revenue, 'INR') },
              { key: 'roas', label: 'ROAS', render: (row) => (row.roas == null ? '—' : `${row.roas}x`) }
            ]}
            rows={items.map((row) => ({ ...row, id: row.externalId }))}
          />
        ) : null}
      </State>
    </div>
  );
}
