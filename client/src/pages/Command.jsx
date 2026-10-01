import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { ago, inr, label, num } from '../format.js';
import { Page, State, Subnav, useSection, useTitle } from '../ui.jsx';

const OVERVIEW_SECTIONS = ['Business Overview', 'AI Business Brief', 'KPI Summary', 'Funnel Summary', 'Marketing Performance', 'Sales Performance', 'Lead Performance', 'AI Alerts'];
const INSIGHT_SECTIONS = ['Business Insights', 'Performance Changes', 'Anomalies', 'Recommendations', 'Opportunities', 'Risks', 'AI Actions'];

const PROMPTS = [
  ['Why did CPL increase?', 'Which campaign is pushing cost per lead up?'],
  ['Which leads need follow-up?', 'Which high-intent leads are still untouched?'],
  ['What changed this week?', 'What changed in the business this week?'],
  ['Which campaign needs attention?', 'Which campaign should the desk look at first?']
];

function firstName(name) {
  return String(name || 'there').split(' ')[0];
}

function hello(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${firstName(name)}`;
}

function weekLabel() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 6);
  const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const year = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: 'Asia/Kolkata' }).format(end);
  return `${fmt.format(start)} – ${fmt.format(end)}, ${year}`;
}

function funnelCount(funnel, status) {
  return Number(funnel.find((row) => row.status === status)?.total || 0);
}

function Spark({ values, tone = '#5b4dff' }) {
  const series = values.length ? values : [0, 0];
  const max = Math.max(...series, 1);
  const step = series.length > 1 ? 100 / (series.length - 1) : 100;
  const coords = series.map((value, index) => `${index * step},${28 - (value / max) * 22}`);
  return (
    <svg className="spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={coords.join(' ')} stroke={tone} />
    </svg>
  );
}

function Trend({ points }) {
  const leads = points.map((point) => Number(point.leads || 0));
  const qualified = points.map((point) => Number(point.qualifiedLeads || 0));
  const max = Math.max(...leads, ...qualified, 1);
  const line = (values) => values.map((value, index) => {
    const x = values.length > 1 ? (index / (values.length - 1)) * 100 : 0;
    const y = 92 - (value / max) * 74;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg className="trend" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Lead trend">
      <polyline className="trend-a" points={line(leads)} />
      <polyline className="trend-b" points={line(qualified)} />
    </svg>
  );
}

function initials(name) {
  return String(name || 'A').split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function CommandCenter() {
  const { user, can } = useAuth();
  const { data, loading, error, reload } = useResource('/api/command');
  const [panel, setPanel] = useState(true);
  const [question, setQuestion] = useState('');
  const [reply, setReply] = useState(null);
  const [busy, setBusy] = useState(false);
  const [askError, setAskError] = useState('');
  const [section, setSection] = useSection(OVERVIEW_SECTIONS);
  const show = (name) => section === 'Business Overview' || section === name;
  useTitle('Overview');

  async function ask(text) {
    const value = (text || question).trim();
    if (!value) return;
    setBusy(true);
    setAskError('');
    setQuestion('');
    try {
      setReply(await api.post('/api/ai/ask', { question: value }));
    } catch (err) {
      setAskError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <State loading={loading} error={error} onRetry={reload}>
      {data ? (
        <div className={`desk ${panel ? 'has-panel' : ''}`}>
          <div className="desk-main">
            <Subnav items={OVERVIEW_SECTIONS} value={section} onChange={setSection} />
            <header className="hello-row">
              <div>
                <h1>{hello(user?.name)} <span aria-hidden="true">👋</span></h1>
                <p>Here is what is happening across {user?.organization?.name || 'this workspace'}.</p>
              </div>
              <div className="hello-actions">
                <span className="date-chip">{weekLabel()}</span>
                {can('leads.export') ? <button className="btn" onClick={() => download('/api/leads/export', 'airo-leads.csv')}>Export</button> : null}
              </div>
            </header>
            {show('KPI Summary') ? <Kpis data={data} /> : null}
            {show('AI Business Brief') ? <Brief data={data} /> : null}
            {show('Sales Performance') ? (
              <section className="panel">
                <header><h2>Sales performance</h2><p>{num(data.sales.openDeals)} open deals</p></header>
                <p>Open pipeline {inr(data.sales.openValue)}. Booked on record {inr(data.sales.wonValue)}. Lost deals {num(data.sales.lostDeals)}.</p>
              </section>
            ) : null}
            <div className="split">
              {show('Marketing Performance') ? <section className="panel">
                <header>
                  <h2>Performance overview</h2>
                  <p>Last 14 days</p>
                </header>
                <div className="legend">
                  <span><i className="swatch a" /> Leads</span>
                  <span><i className="swatch b" /> Qualified</span>
                </div>
                <Trend points={data.series} />
              </section> : null}
              {show('Funnel Summary') || show('Lead Performance') ? <section className="panel">
                <header><h2>Conversion funnel</h2><p>Current lead status</p></header>
                <VFunnel rows={data.funnel} />
              </section> : null}
            </div>
            <div className="triple">
              {show('Marketing Performance') ? <section className="panel">
                <header><h2>Campaign intelligence</h2><Link to="/app/growth/campaigns">View all</Link></header>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr><th>Campaign</th><th>Spend</th><th>Leads</th><th>CPL</th></tr>
                    </thead>
                    <tbody>
                      {data.campaigns.map((row) => (
                        <tr key={row.id}>
                          <td><Link to={`/app/growth/campaigns/${row.id}`}>{row.name}</Link><small>{row.project}</small></td>
                          <td>{inr(row.spend)}</td>
                          <td>{num(row.leads)}</td>
                          <td>{row.cpl ? inr(row.cpl) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section> : null}
              {show('Lead Performance') ? <section className="panel">
                <header><h2>High-intent leads</h2><Link to="/app/growth/leads">View all</Link></header>
                <ul className="people">
                  {data.hotLeads.length === 0 ? <li className="quiet">No lead is scored 80 or above.</li> : data.hotLeads.map((lead) => (
                    <li key={lead.id}>
                      <Link to={`/app/growth/leads/${lead.id}`}>
                        <span className="avatar">{initials(lead.fullName)}</span>
                        <span>
                          <strong>{lead.fullName}</strong>
                          <em>{lead.sourceName || 'Direct'} · {lead.project}</em>
                        </span>
                        <b className={Number(lead.score) >= 90 ? 'hot' : 'warm'}>{lead.score}</b>
                      </Link>
                      <small>{ago(lead.createdAt)}</small>
                    </li>
                  ))}
                </ul>
              </section> : null}
              {show('AI Alerts') ? <section className="panel">
                <header><h2>Recent activity</h2></header>
                <ul className="feed">
                  {data.alerts.length === 0 ? <li className="quiet">Nothing new is waiting.</li> : data.alerts.slice(0, 5).map((alert) => (
                    <li key={alert.alertKey}>
                      <Link to={alert.actionPath || '/app'}>
                        <strong>{alert.title}</strong>
                        <span>{alert.body}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section> : null}
            </div>
          </div>
          {panel ? (
            <aside className="intel-panel">
              <header>
                <strong>AIRO Intelligence</strong>
                <button type="button" aria-label="Close assistant" onClick={() => setPanel(false)}>×</button>
              </header>
              <p className="quiet">What would you like to know?</p>
              <form onSubmit={(event) => { event.preventDefault(); ask(); }}>
                <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask AI about your business..." aria-label="Ask AIRO" />
                <button className="send" type="submit" disabled={busy} aria-label="Send">↑</button>
              </form>
              <p className="suggest-label">Suggested</p>
              <div className="suggest-list">
                {PROMPTS.map(([name, text]) => (
                  <button key={name} type="button" onClick={() => ask(text)}>{name}</button>
                ))}
              </div>
              {busy ? <div className="skeleton-block" aria-label="Working from workspace data" /> : null}
              {askError ? <p className="delta-down">{askError}</p> : null}
              {reply ? (
                <article className="ai-reply">
                  <p className="pill">AI response</p>
                  <h3>{reply.answer}</h3>
                  <p><b>Evidence</b>{reply.evidence}</p>
                  {reply.insight ? <p><b>Insight</b>{reply.insight}</p> : null}
                  {reply.action ? <p><b>Recommendation</b>{reply.action}</p> : null}
                  <div className="page-actions">
                    {reply.actions?.map((action) => <Link className="btn" key={action.path} to={action.path}>{action.label}</Link>)}
                  </div>
                </article>
              ) : null}
            </aside>
          ) : (
            <button className="panel-toggle" type="button" onClick={() => setPanel(true)}>Ask AI</button>
          )}
        </div>
      ) : null}
    </State>
  );
}

function Kpis({ data }) {
  const total = data.funnel.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const qualified = ['qualified', 'site_visit', 'negotiation', 'booked'].reduce((sum, status) => sum + funnelCount(data.funnel, status), 0);
  const leads = data.series.map((point) => Number(point.leads || 0));
  const qualifiedSeries = data.series.map((point) => Number(point.qualifiedLeads || 0));
  const week = data.kpis.find((item) => item.label === 'New leads');
  const qualifiedWeek = data.kpis.find((item) => item.label === 'Qualified');
  const cards = [
    { label: 'Total leads', value: num(total), delta: week?.delta, series: leads, tone: '#5b4dff' },
    { label: 'Qualified leads', value: num(qualified), delta: qualifiedWeek?.delta, series: qualifiedSeries, tone: '#12b76a' },
    { label: 'Site visits', value: num(funnelCount(data.funnel, 'site_visit')), series: [], tone: '#f79009' },
    { label: 'Bookings', value: num(funnelCount(data.funnel, 'booked')), series: [], tone: '#7a5cff' },
    { label: 'Open pipeline', value: inr(data.sales.openValue), hint: `${num(data.sales.openDeals)} open deals`, series: [], tone: '#12b76a' }
  ];
  return (
    <div className="kpi-grid">
      {cards.map((card) => (
        <article className="kpi" key={card.label}>
          <span>{card.label}</span>
          <strong>{card.value}</strong>
          <em>
            {card.delta == null ? (card.hint || 'In this workspace') : (
              <b className={card.delta >= 0 ? 'delta-up' : 'delta-down'}>{card.delta > 0 ? '+' : ''}{card.delta}% vs previous week</b>
            )}
          </em>
          {card.series.length > 1 ? <Spark values={card.series} tone={card.tone} /> : null}
        </article>
      ))}
    </div>
  );
}

function Brief({ data }) {
  const primary = data.campaigns[0];
  return (
    <section className="brief-card">
      <div>
        <p className="pill">AI business brief</p>
        <h2>{data.brief.answer}</h2>
        <p>{data.brief.insight}</p>
        <p className="fine">{data.brief.evidence}</p>
        {primary ? <p className="fine">Primary signal: {primary.name}</p> : null}
        <div className="page-actions">
          {data.brief.actions.map((action) => <Link className="btn light" key={action.path} to={action.path}>{action.label}</Link>)}
        </div>
      </div>
      <div className="brief-side">
        <svg className="skyline" viewBox="0 0 280 160" aria-hidden="true">
          <rect x="20" y="70" width="46" height="90" rx="4" />
          <rect x="74" y="40" width="58" height="120" rx="4" />
          <rect x="140" y="58" width="40" height="102" rx="4" />
          <rect x="188" y="28" width="70" height="132" rx="6" />
          <rect x="206" y="46" width="14" height="10" />
          <rect x="226" y="46" width="14" height="10" />
          <rect x="206" y="64" width="14" height="10" />
          <rect x="226" y="64" width="14" height="10" />
        </svg>
        <article>
          <p>Suggested action</p>
          <strong>{data.brief.action}</strong>
        </article>
      </div>
    </section>
  );
}

function VFunnel({ rows }) {
  const total = rows.reduce((sum, row) => sum + Number(row.total || 0), 0) || 1;
  const colors = ['#5b4dff', '#7c6bff', '#9b8cff', '#c4b5fd', '#86efac', '#22c55e'];
  let worst = null;
  for (let index = 0; index < rows.length - 1; index += 1) {
    const from = Number(rows[index].total || 0);
    const to = Number(rows[index + 1].total || 0);
    if (!from || to >= from) continue;
    const drop = (from - to) / from;
    if (!worst || drop > worst.drop) worst = { drop, from: rows[index].status, to: rows[index + 1].status };
  }
  return (
    <>
      <div className="vfunnel">
        {rows.map((row, index) => (
          <div className="vfunnel-row" key={row.status} style={{ width: `${100 - index * 8}%` }}>
            <span style={{ background: colors[index] }} />
            <em>{label(row.status)}</em>
            <strong>{num(row.total)}</strong>
            <small>{Math.round((Number(row.total) / total) * 100)}%</small>
          </div>
        ))}
      </div>
      {worst ? <p className="drop-note">Largest drop: {label(worst.from)} to {label(worst.to)}, {Math.round(worst.drop * 100)}%.</p> : null}
    </>
  );
}

export function Insights() {
  const { data, loading, error, reload } = useResource('/api/ai/insights');
  const recs = useResource('/api/ai/recommendations');
  const [section, setSection] = useSection(INSIGHT_SECTIONS);
  const insights = data?.insights || [];
  const watch = insights.filter((item) => item.severity === 'watch' || item.severity === 'critical');
  const slice = section === 'Performance Changes' || section === 'Anomalies' || section === 'Risks'
    ? watch
    : section === 'AI Actions'
      ? insights.filter((item) => item.actionPath)
      : section === 'Opportunities'
        ? insights.filter((item) => item.severity === 'info')
        : insights;
  const shown = slice.length ? slice : insights;
  const recItems = (recs.data?.items || []).filter((item) => {
    if (section === 'Recommendations') return true;
    if (section !== 'Opportunities') return false;
    return /lead|campaign|sales|follow/i.test(`${item.category} ${item.title}`);
  });
  return (
    <Page eyebrow="Command center" title="AI insights" lede="Business insights, changes, anomalies, recommendations, opportunities, risks, and the action each one points to.">
      <Subnav items={INSIGHT_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        <div className="stack">
          {!loading && section !== 'Recommendations' && slice.length === 0 ? <p className="quiet">No separate {section.toLowerCase()} record yet. Showing the business insights on file.</p> : null}
          {section === 'Recommendations' || section === 'Opportunities' ? recItems.map((item) => (
            <article className="panel" key={item.id}>
              <header><h2>{item.title}</h2><span className="badge">{label(item.category)}</span></header>
              <p>{item.body}</p>
              <p className="quiet">{item.evidence}</p>
              {item.actionPath ? <Link className="btn" to={item.actionPath}>{item.actionLabel || 'Open'}</Link> : null}
            </article>
          )) : null}
          {section !== 'Recommendations' ? shown.map((item) => (
            <article className="panel" key={item.insightKey}>
              <header><h2>{item.title}</h2><span className="badge">{label(item.severity)}</span></header>
              <p>{item.body}</p>
              <p className="quiet">{item.evidence}</p>
              {item.actionPath ? <Link className="btn" to={item.actionPath}>{item.actionLabel || 'Open'}</Link> : null}
            </article>
          )) : null}
        </div>
      </State>
    </Page>
  );
}
