import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { ago, day, num } from '../format.js';
import { Badge, LineChart, Page, State, Subnav, Table, useSection } from '../ui.jsx';
import { ProfileForm, StrategyPanel } from './AdsStrategy.jsx';
import { LaunchPanel } from './AdsLaunch.jsx';
import { ExperimentsPanel, QualityPanel } from './AdsQuality.jsx';

const SECTIONS = ['Performance', 'Lead quality', 'A/B tests', 'Business profile', 'Strategy', 'Launch'];

const MODES = [
  { key: 'off', label: 'Off', note: 'The agent does nothing.' },
  { key: 'recommend', label: 'Recommend', note: 'Suggestions only. Nothing changes on the ad account.' },
  { key: 'approve', label: 'Approve', note: 'A pause or budget change runs only after someone who manages the ad accounts approves it.' },
  { key: 'auto', label: 'Auto', note: 'Pauses and budget changes inside the guardrails run on their own. Raising budgets also needs a spend cap. Owner only.' }
];
const PLATFORM = { meta: 'Meta Ads', google: 'Google Ads' };
const TYPE_LABEL = {
  pause: 'Pause suggestion',
  no_results: 'No results recorded',
  low_quality: 'Low lead quality',
  scale_winner: 'Scale a winner',
  experiment_winner: 'A/B test result',
  budget_decrease: 'Lower budget',
  budget_increase: 'Raise budget',
  refresh_creative: 'Refresh ads',
  above_target: 'Above target cost',
  pacing_over: 'Overspending pace',
  pacing_under: 'Underspending pace',
  campaign_create: 'Campaign created',
  campaign_publish: 'Campaign published'
};
const APPLICABLE = ['pause', 'budget_decrease', 'budget_increase', 'scale_winner', 'experiment_winner'];

function outcomeText(item) {
  const outcome = item.outcome;
  if (!outcome) return '';
  if (outcome.status === 'PAUSED') return outcome.level === 'ad' ? 'Ad paused on the ad account.' : 'Campaign paused on the ad account.';
  if (Array.isArray(outcome.before) && Array.isArray(outcome.after)) {
    const total = (rows) => rows.reduce((sum, row) => sum + Number(row.daily || 0), 0).toFixed(2);
    const verb = item.status === 'applied' ? 'Daily budget changed' : 'Daily budget would change';
    return `${verb}: ${total(outcome.before)} → ${total(outcome.after)} ${outcome.currency || ''}`.trim();
  }
  return '';
}

const STATUS_TONE = { applied: 'good', approved: 'info', proposed: 'warn', blocked: 'bad', rejected: 'bad', failed: 'bad' };

function money(value, currency) {
  if (value == null) return '—';
  const amount = Number(value);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency || ''} ${amount.toFixed(2)}`.trim();
  }
}

function dailySpend(rows) {
  const currencies = [...new Set(rows.map((row) => row.currency))];
  if (rows.length < 2 || currencies.length !== 1) return null;
  const byDate = new Map();
  for (const row of rows) byDate.set(row.date, (byDate.get(row.date) || 0) + Number(row.spend || 0));
  return { currency: currencies[0], points: [...byDate].map(([date, spend]) => ({ date, spend })) };
}

function TotalsStrip({ totals }) {
  return (
    <div className="stack">
      {totals.map((row) => (
        <div key={`${row.platform}-${row.currency}`}>
          <p className="eyebrow">{PLATFORM[row.platform]}{row.currency ? ` · ${row.currency}` : ''}</p>
          <div className="metric-strip">
            <div className="metric"><span>Spend</span><strong>{money(row.spend, row.currency)}</strong><em>{num(row.impressions)} impressions</em></div>
            <div className="metric"><span>Clicks</span><strong>{num(row.clicks)}</strong><em>CTR {row.ctr == null ? '—' : `${row.ctr}%`}</em></div>
            <div className="metric"><span>{row.resultLabel === 'leads' ? 'Leads' : 'Conversions'}</span><strong>{row.results == null ? '—' : num(row.results)}</strong><em>CPC {money(row.cpc, row.currency)}</em></div>
            <div className="metric"><span>{row.resultLabel === 'leads' ? 'Cost per lead' : 'Cost per conversion'}</span><strong>{money(row.costPerResult, row.currency)}</strong><em>from synced data</em></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SettingsForm({ settings, isOwner, onSaved }) {
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => setForm(settings), [settings]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const blankToNull = (value) => (value === '' || value == null ? null : Number(value));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.put('/api/ads-agent/settings', {
        mode: form.mode,
        dailySpendCap: blankToNull(form.dailySpendCap),
        monthlySpendCap: blankToNull(form.monthlySpendCap),
        maxBudgetChangePct: Number(form.maxBudgetChangePct),
        maxActionsPerDay: Number(form.maxActionsPerDay),
        minSpendForDecision: Number(form.minSpendForDecision),
        killSwitch: Boolean(form.killSwitch)
      });
      setMessage('Saved.');
      onSaved();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={save}>
      <header><h2>Autopilot and guardrails</h2></header>
      <div className="filters" role="radiogroup" aria-label="Agent mode">
        {MODES.map((mode) => (
          <button
            key={mode.key}
            type="button"
            className={`toggle ${form.mode === mode.key ? 'is-on' : ''}`}
            disabled={mode.key === 'auto' && !isOwner}
            onClick={() => setForm((current) => ({ ...current, mode: mode.key }))}
          >{mode.label}</button>
        ))}
      </div>
      <p className="quiet">{MODES.find((mode) => mode.key === form.mode)?.note}</p>
      <label className="stack-field">DAILY SPEND CAP (blank = no cap)
        <input type="number" min="0" step="1" value={form.dailySpendCap ?? ''} onChange={set('dailySpendCap')} />
      </label>
      <label className="stack-field">MONTHLY SPEND CAP (blank = no cap)
        <input type="number" min="0" step="1" value={form.monthlySpendCap ?? ''} onChange={set('monthlySpendCap')} />
      </label>
      <label className="stack-field">MAX BUDGET CHANGE PER ACTION (%)
        <input type="number" min="1" max="100" value={form.maxBudgetChangePct} onChange={set('maxBudgetChangePct')} />
      </label>
      <label className="stack-field">MAX ACTIONS PER DAY
        <input type="number" min="0" max="50" value={form.maxActionsPerDay} onChange={set('maxActionsPerDay')} />
      </label>
      <label className="stack-field">MIN SPEND BEFORE THE AGENT JUDGES A CAMPAIGN
        <input type="number" min="0" value={form.minSpendForDecision} onChange={set('minSpendForDecision')} />
      </label>
      <label className="stack-field">
        <span><input type="checkbox" checked={Boolean(form.killSwitch)} onChange={(event) => setForm((current) => ({ ...current, killSwitch: event.target.checked }))} /> KILL SWITCH. Stop every agent action.</span>
      </label>
      <div className="page-actions">
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save guardrails'}</button>
        {message ? <span className="quiet">{message}</span> : null}
      </div>
    </form>
  );
}

export function AdsAgent() {
  const { can, user } = useAuth();
  const [days, setDays] = useState(7);
  const { data, loading, error, reload } = useResource(`/api/ads-agent?days=${days}`);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState('');
  const canManage = can('campaigns.update');
  const canApply = canManage && can('connections.manage') && ['approve', 'auto'].includes(data?.settings?.mode);
  const [section, setSection] = useSection(SECTIONS);

  async function sync() {
    setSyncing(true);
    setSyncNote('');
    try {
      const result = await api.post('/api/ads-agent/sync', {});
      setSyncNote([`${result.rows} daily rows saved from ${result.connections} ad accounts.`, ...result.notes].join(' '));
      reload();
    } catch (err) {
      setSyncNote(err.message);
    } finally {
      setSyncing(false);
    }
  }

  async function check() {
    setChecking(true);
    setCheckNote('');
    try {
      const result = await api.post('/api/ads-agent/monitor', {});
      setCheckNote(result.skipped || `${result.created} new recommendations.`);
      reload();
    } catch (err) {
      setCheckNote(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function apply(item) {
    const what = item.type === 'experiment_winner' ? `pause the ad "${item.targetName}"`
      : item.type === 'pause' ? `pause "${item.targetName}"` : `change the daily budget of "${item.targetName}" by ${item.proposedChange?.changePct}%`;
    if (!window.confirm(`This will ${what} on the live ad account. Continue?`)) return;
    setChecking(true);
    setCheckNote('');
    try {
      const result = await api.post(`/api/ads-agent/decisions/${item.id}/apply`, {});
      setCheckNote(result.status === 'applied' ? 'Applied on the ad account.' : `Blocked: ${(result.reasons || []).join(' ')}`);
      reload();
    } catch (err) {
      setCheckNote(err.message);
      reload();
    } finally {
      setChecking(false);
    }
  }

  async function dismiss(id) {
    setChecking(true);
    try {
      await api.post(`/api/ads-agent/decisions/${id}/dismiss`, {});
      reload();
    } catch (err) {
      setCheckNote(err.message);
    } finally {
      setChecking(false);
    }
  }

  const chart = dailySpend(data?.daily || []);
  const empty = data?.ready && !data.totals.length
    ? { title: 'No synced ad data yet', body: 'Connect Meta Ads or Google Ads under Connections, then press Sync now. Data refreshes every 3 hours.' }
    : null;

  return (
    <Page
      eyebrow="Growth"
      title="AI Ads Agent"
      lede={data?.lastSyncedAt ? `Real numbers from your ad accounts. Last synced ${ago(data.lastSyncedAt)}.` : 'Real numbers from your ad accounts, synced every 3 hours.'}
      actions={section !== 'Performance' ? null : (
        <>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Range">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
          {canManage ? <button className="btn" onClick={sync} disabled={syncing}>{syncing ? 'Syncing…' : 'Sync now'}</button> : null}
        </>
      )}
    >
      <Subnav items={SECTIONS} value={section} onChange={setSection} />
      {section === 'Lead quality' ? <QualityPanel canManage={canManage} /> : null}
      {section === 'A/B tests' ? <ExperimentsPanel /> : null}
      {section === 'Business profile' ? <ProfileForm canManage={canManage} /> : null}
      {section === 'Strategy' ? <StrategyPanel canManage={canManage} /> : null}
      {section === 'Launch' ? <LaunchPanel canManage={canManage} /> : null}
      {section === 'Performance' && syncNote ? <p className="quiet">{syncNote}</p> : null}
      {section === 'Performance' ? <State loading={loading} error={error} onRetry={reload}>
        {data && !data.ready ? <div className="empty"><strong>Ads agent is not set up</strong><p className="quiet">{data.note}</p></div> : null}
        {data?.ready ? (
          <div className="stack">
            <State empty={empty}>
              <TotalsStrip totals={data.totals} />
              {chart ? (
                <section className="panel">
                  <header><h2>Daily spend</h2><span className="quiet">{chart.currency}</span></header>
                  <LineChart points={chart.points} field="spend" />
                </section>
              ) : null}
              <Table
                columns={[
                  { key: 'name', label: 'Campaign', render: (row) => <>{row.name}<br /><span className="quiet">{PLATFORM[row.platform]}</span></> },
                  { key: 'spend', label: 'Spend', render: (row) => money(row.spend, row.currency) },
                  { key: 'clicks', label: 'Clicks', render: (row) => num(row.clicks) },
                  { key: 'ctr', label: 'CTR', render: (row) => (row.ctr == null ? '—' : `${row.ctr}%`) },
                  { key: 'results', label: 'Results', render: (row) => (row.results == null ? '—' : `${num(row.results)} ${row.resultLabel}`) },
                  { key: 'costPerResult', label: 'Cost / result', render: (row) => money(row.costPerResult, row.currency) }
                ]}
                rows={data.campaigns.map((row) => ({ ...row, id: `${row.connectionId}-${row.externalId}` }))}
              />
            </State>
            <div className="split">
              {canManage ? <SettingsForm settings={data.settings} isOwner={user?.role === 'owner'} onSaved={reload} /> : null}
              <section className="panel">
                <header>
                  <h2>Decision log</h2>
                  {canManage ? <button className="btn" onClick={check} disabled={checking}>{checking ? 'Checking…' : 'Check now'}</button> : null}
                </header>
                {checkNote ? <p className="quiet">{checkNote}</p> : null}
                {data.decisions.length === 0 ? <p className="quiet">No recommendations yet. The agent checks synced data every 6 hours. Nothing is changed in your ad accounts.</p> : (
                  <ul className="alert-list">
                    {data.decisions.map((item) => (
                      <li key={item.id}>
                        <strong>{item.targetName || item.type}</strong>
                        <Badge value={item.status} tone={STATUS_TONE[item.status]} />
                        <p>{TYPE_LABEL[item.type] ? <strong>{TYPE_LABEL[item.type]}: </strong> : null}{item.reason}</p>
                        {item.guardrail?.reasons?.length ? <p className="quiet">{item.guardrail.reasons.join(' ')}</p> : null}
                        <p className="quiet">{day(item.createdAt)} · {item.mode}</p>
                        {outcomeText(item) ? <p className="quiet">{outcomeText(item)}</p> : null}
                        {item.error ? <p className="quiet">{item.error}</p> : null}
                        {canManage && ['proposed', 'blocked'].includes(item.status) ? (
                          <p className="page-actions">
                            {canApply && APPLICABLE.includes(item.type) ? (
                              <button className="btn-primary" onClick={() => apply(item)} disabled={checking}>Approve &amp; apply</button>
                            ) : null}
                            <button className="btn" onClick={() => dismiss(item.id)} disabled={checking}>Dismiss</button>
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </State> : null}
    </Page>
  );
}
