import { useState } from 'react';
import { useResource } from '../data.js';
import { num, when } from '../format.js';
import { Page, State, Table } from '../ui.jsx';

const RANGE_LABEL = { 7: '7 days', 30: '30 days', 90: '90 days' };
const PURPOSE = { assistant: 'Workspace assistant', whatsapp: 'WhatsApp replies', leads: 'Lead follow-up', ads: 'Ad writing', calls: 'Call summary', competitors: 'Competitor research' };

const usd = (value) => (value == null ? '—' : `$${Number(value).toFixed(Number(value) < 1 ? 3 : 2)}`);
const short = (value) => {
  const n = Number(value) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
};
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// Vertical bars per day; stacked when two series are given.
function DayBars({ rows, series, format = short, empty = 'Nothing recorded in this period.' }) {
  const totals = rows.map((row) => series.reduce((sum, item) => sum + (Number(row[item.key]) || 0), 0));
  const max = Math.max(...totals, 0);
  if (!max) return <p className="quiet usage-empty">{empty}</p>;
  const every = Math.ceil(rows.length / 10);
  return (
    <div className="usage-chart">
      <div className="usage-legend">
        {series.map((item) => <span key={item.key}><i className={`usage-swatch ${item.tone}`} />{item.label}</span>)}
        <span className="quiet">Peak {format(max)}</span>
      </div>
      <div className="usage-bars" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
        {rows.map((row, index) => (
          <div className="usage-col" key={row.day} title={`${dayLabel(row.day)}: ${series.map((item) => `${item.label} ${format(row[item.key])}`).join(', ')}`}>
            <div className="usage-stack" style={{ height: `${(totals[index] / max) * 100}%` }}>
              {series.map((item) => {
                const value = Number(row[item.key]) || 0;
                return value ? <span key={item.key} className={item.tone} style={{ flexGrow: value }} /> : null;
              })}
            </div>
            <small>{index % every === 0 || index === rows.length - 1 ? dayLabel(row.day) : ''}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Share({ rows, field, labelOf, format = short }) {
  const total = rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
  if (!total) return <p className="quiet">Nothing recorded in this period.</p>;
  return (
    <div className="usage-share">
      {rows.slice(0, 8).map((row) => {
        const value = Number(row[field]) || 0;
        const pct = Math.round((value / total) * 100);
        return (
          <div className="usage-share-row" key={labelOf(row)}>
            <span title={labelOf(row)}>{labelOf(row)}</span>
            <div><i style={{ width: `${Math.max(2, pct)}%` }} /></div>
            <strong>{format(value)} <em>{pct}%</em></strong>
          </div>
        );
      })}
    </div>
  );
}

function Card({ label, value, hint, tone }) {
  return (
    <div className={`metric ${tone || ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{hint}</em>
    </div>
  );
}

function ApifyAccount({ account }) {
  if (!account?.connected) return <p className="quiet">Apify is not connected. Connect it in Research Tools to see its bill here.</p>;
  if (account.error) return <p className="error-box">Apify did not give its usage: {account.error}</p>;
  const pct = account.limitUsd ? Math.min(100, Math.round((account.usedUsd / account.limitUsd) * 100)) : null;
  const left = account.limitUsd != null && account.usedUsd != null ? Math.max(0, account.limitUsd - account.usedUsd) : null;
  return (
    <div className="stack">
      <div className="usage-meter">
        <div className="usage-meter-head">
          <strong>{usd(account.usedUsd)} used</strong>
          <span>{account.limitUsd != null ? `of ${usd(account.limitUsd)} monthly limit · ${usd(left)} left` : 'No monthly limit set'}</span>
        </div>
        {pct != null ? <div className={`usage-meter-track ${pct >= 90 ? 'is-bad' : pct >= 70 ? 'is-warn' : ''}`}><i style={{ width: `${Math.max(1, pct)}%` }} /></div> : null}
        <small className="quiet">Billing cycle {account.cycleStart ? dayLabel(account.cycleStart.slice(0, 10)) : '—'} to {account.cycleEnd ? dayLabel(account.cycleEnd.slice(0, 10)) : '—'}. Read live from your Apify account.</small>
      </div>
      <h3>Apify spend per day (this cycle)</h3>
      <DayBars rows={account.daily || []} series={[{ key: 'usd', label: 'USD', tone: 'warm' }]} format={usd} empty="No Apify spend in this cycle yet." />
      {account.services?.length ? (
        <>
          <h3>What the money went on</h3>
          <Share rows={account.services} field="usd" labelOf={(row) => row.key.replace(/_/g, ' ').toLowerCase()} format={usd} />
        </>
      ) : null}
    </div>
  );
}

export function PlatformUsage() {
  const [days, setDays] = useState(30);
  const { data, loading, error, reload } = useResource(`/api/admin/usage?days=${days}`);
  const llm = data?.llm;
  const apify = data?.apify;
  const sent = (data?.whatsapp?.daily || []).reduce((sum, row) => sum + row.sent, 0);
  const tokenCols = [
    { key: 'calls', label: 'Calls', render: (row) => num(row.calls) },
    { key: 'inputTokens', label: 'Input tokens', render: (row) => num(row.inputTokens) },
    { key: 'outputTokens', label: 'Output tokens', render: (row) => num(row.outputTokens) },
    { key: 'failed', label: 'Failed', render: (row) => (row.failed ? num(row.failed) : '—') }
  ];
  const runCols = [
    { key: 'calls', label: 'Runs', render: (row) => num(row.calls) },
    { key: 'items', label: 'Results', render: (row) => num(row.items) },
    { key: 'maxChargeUsd', label: 'Max charge allowed', render: (row) => usd(row.maxChargeUsd) },
    { key: 'failed', label: 'Failed', render: (row) => (row.failed ? num(row.failed) : '—') }
  ];
  return (
    <Page
      eyebrow="Platform"
      title="Usage & costs"
      lede="How much of the paid tools AIRO has used: AI models, Apify and WhatsApp. Every number comes from the provider or from AIRO's own log of each call."
      actions={(
        <div className="tabs" role="tablist" aria-label="Period">
          {[7, 30, 90].map((value) => <button key={value} type="button" className={days === value ? 'is-on' : ''} onClick={() => setDays(value)}>{RANGE_LABEL[value]}</button>)}
        </div>
      )}
    >
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            {!data.ready ? <p className="error-box">{data.note}</p> : null}
            <div className="metric-strip">
              <Card label="AI calls" value={num(llm?.totals.calls)} hint={llm?.totals.failed ? `${num(llm.totals.failed)} failed` : `last ${RANGE_LABEL[days]}`} />
              <Card label="AI tokens" value={short((llm?.totals.inputTokens || 0) + (llm?.totals.outputTokens || 0))} hint={`${short(llm?.totals.inputTokens)} in · ${short(llm?.totals.outputTokens)} out`} />
              <Card label="Apify spent" value={usd(apify?.account?.usedUsd)} hint={apify?.account?.limitUsd != null ? `of ${usd(apify.account.limitUsd)} this cycle` : 'this billing cycle'} />
              <Card label="Apify runs" value={num(apify?.totals?.calls)} hint={`${num(apify?.totals?.items)} results`} />
              <Card label="WhatsApp sent" value={num(sent)} hint={`messages, last ${RANGE_LABEL[days]}`} />
            </div>

            <section className="panel stack">
              <header>
                <h2>AI models</h2>
                <p className="quiet">
                  Tokens exactly as OpenAI, Anthropic or Gemini report them on each reply. Money is not shown, because the providers do not give the price through their API; multiply by your plan's price per million tokens.
                  {llm?.totals.firstAt ? ` Recording since ${when(llm.totals.firstAt)}.` : ' Recording starts with the next AI call.'}
                </p>
              </header>
              {data.connected?.length ? (
                <div className="usage-models">
                  {data.connected.map((row) => (
                    <div key={row.purpose}><span>{PURPOSE[row.purpose] || row.purpose}</span><strong>{row.model}</strong><small>{row.providerName}</small></div>
                  ))}
                </div>
              ) : <p className="quiet">No AI model is connected on Platform AI.</p>}
              <h3>Tokens per day</h3>
              <DayBars rows={llm?.daily || []} series={[{ key: 'inputTokens', label: 'Input', tone: 'cool' }, { key: 'outputTokens', label: 'Output', tone: 'accent' }]} />
              <h3>Calls per day</h3>
              <DayBars rows={llm?.daily || []} series={[{ key: 'calls', label: 'Calls', tone: 'accent' }]} />
              <div className="usage-two">
                <div>
                  <h3>Which work uses the most tokens</h3>
                  <Share rows={(llm?.features || []).map((row) => ({ ...row, tokens: row.inputTokens + row.outputTokens })).sort((a, b) => b.tokens - a.tokens)} field="tokens" labelOf={(row) => row.label} />
                </div>
                <div>
                  <h3>Which business uses the most</h3>
                  <Share rows={(llm?.organizations || []).map((row) => ({ ...row, tokens: row.inputTokens + row.outputTokens })).sort((a, b) => b.tokens - a.tokens)} field="tokens" labelOf={(row) => row.name} />
                </div>
              </div>
              <h3>By model</h3>
              <Table columns={[{ key: 'model', label: 'Model', render: (row) => <><strong>{row.model}</strong><br /><small className="quiet">{row.providerName}</small></> }, ...tokenCols]} rows={(llm?.models || []).map((row) => ({ ...row, id: `${row.provider}-${row.model}` }))} />
              <h3>By work</h3>
              <Table columns={[{ key: 'label', label: 'Work' }, ...tokenCols]} rows={(llm?.features || []).map((row) => ({ ...row, id: row.key }))} />
            </section>

            <section className="panel stack">
              <header>
                <h2>Apify (competitor research)</h2>
                <p className="quiet">The bill is read live from the Apify account. Runs below are AIRO's own log of each search; "max charge allowed" is the cap AIRO set per run, not the bill.</p>
              </header>
              <ApifyAccount account={apify?.account} />
              <h3>Runs per day</h3>
              <DayBars rows={apify?.daily || []} series={[{ key: 'calls', label: 'Runs', tone: 'warm' }]} />
              <div className="usage-two">
                <div>
                  <h3>Runs by source</h3>
                  <Share rows={apify?.features || []} field="calls" labelOf={(row) => row.label} />
                </div>
                <div>
                  <h3>Runs by business</h3>
                  <Share rows={apify?.organizations || []} field="calls" labelOf={(row) => row.name} />
                </div>
              </div>
              <Table columns={[{ key: 'label', label: 'Source' }, ...runCols]} rows={(apify?.features || []).map((row) => ({ ...row, id: row.key }))} />
            </section>

            <section className="panel stack">
              <header>
                <h2>WhatsApp</h2>
                <p className="quiet">Messages through the shared chatbot, from AIRO's own message log. Meta bills WhatsApp per conversation, so this is the volume, not the bill.</p>
              </header>
              <DayBars rows={data.whatsapp?.daily || []} series={[{ key: 'sent', label: 'Sent by AIRO', tone: 'accent' }, { key: 'received', label: 'Received', tone: 'cool' }]} />
            </section>
          </div>
        ) : null}
      </State>
    </Page>
  );
}
