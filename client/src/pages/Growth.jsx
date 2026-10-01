import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { inr, label, num, when } from '../format.js';
import { LeadWhatsapp } from './Whatsapp.jsx';
import { Badge, LineChart, Page, State, Subnav, Table, useSection } from '../ui.jsx';

const CAMPAIGN_SECTIONS = ['All Campaigns', 'Campaign Overview', 'Campaign Performance', 'Spend', 'Leads', 'Qualified Leads', 'CPL', 'Conversion', 'Attribution', 'AI Analysis'];
const SOURCE_SECTIONS = ['Source Overview', 'Source Performance', 'Lead Volume', 'Lead Quality', 'Conversion'];
const LEAD_SECTIONS = ['All Leads', 'Lead Inbox', 'Lead Details', 'Lead Assignment', 'Lead Scoring', 'Lead Segmentation', 'Lead Activity', 'Lead Import / Export'];

export function Campaigns() {
  const { data, loading, error, reload } = useResource('/api/campaigns');
  const navigate = useNavigate();
  const [section, setSection] = useSection(CAMPAIGN_SECTIONS);
  const rows = [...(data || [])].sort((a, b) => {
    if (section === 'Spend') return Number(b.spendInr || 0) - Number(a.spendInr || 0);
    if (section === 'Leads') return Number(b.leads || 0) - Number(a.leads || 0);
    if (section === 'Qualified Leads' || section === 'Conversion') return Number(b.qualifiedRate || 0) - Number(a.qualifiedRate || 0);
    if (section === 'CPL') return Number(a.cpl || 1e12) - Number(b.cpl || 1e12);
    return 0;
  });
  const columns = campaignColumns(section);
  return (
    <Page eyebrow="Growth" title="Campaigns" lede="All campaigns, performance, spend, leads, qualified leads, CPL, conversion, attribution, and the AI read on each campaign.">
      <Subnav items={CAMPAIGN_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload} empty={!loading && data?.length === 0 ? { title: 'No campaigns yet', body: 'Connect an advertising account or portal. Campaigns land here after sync.' } : null}>
        {section === 'AI Analysis' ? (
          <div className="stack">
            {rows.map((row) => (
              <article className="panel" key={row.id}>
                <header><h2>{row.name}</h2><span className="quiet">{row.project} · {row.sourceName || 'Unlinked source'}</span></header>
                <p>{row.analysis?.answer}</p>
                <p className="quiet">{row.analysis?.evidence}</p>
                <p>{row.analysis?.insight}</p>
                <p>{row.analysis?.action}</p>
                <button className="btn" type="button" onClick={() => navigate(`/app/growth/campaigns/${row.id}`)}>Open campaign</button>
              </article>
            ))}
          </div>
        ) : (
          <Table columns={columns} rows={rows} onRow={(row) => navigate(`/app/growth/campaigns/${row.id}`)} />
        )}
      </State>
    </Page>
  );
}

function campaignColumns(section) {
  const name = { key: 'name', label: 'Campaign' };
  const project = { key: 'project', label: 'Project' };
  const source = { key: 'sourceName', label: 'Attributed source', render: (row) => row.sourceName || '—' };
  const provider = { key: 'providerKey', label: 'Provider', render: (row) => label(row.providerKey || 'direct') };
  const leads = { key: 'leads', label: 'Leads', render: (row) => num(row.leads) };
  const qualified = { key: 'qualifiedLeads', label: 'Qualified leads', render: (row) => num(row.qualifiedLeads) };
  const rate = { key: 'qualifiedRate', label: 'Conversion', render: (row) => row.qualifiedRate == null ? '—' : `${row.qualifiedRate}%` };
  const cpl = { key: 'cpl', label: 'CPL', render: (row) => row.cpl ? inr(row.cpl) : '—' };
  const spend = { key: 'spendInr', label: 'Spend', render: (row) => inr(row.spendInr) };
  const budget = { key: 'budgetInr', label: 'Budget', render: (row) => row.budgetInr ? inr(row.budgetInr) : '—' };
  if (section === 'Spend') return [name, project, source, spend, budget];
  if (section === 'Leads') return [name, project, source, leads];
  if (section === 'Qualified Leads') return [name, project, source, qualified, leads, rate];
  if (section === 'CPL') return [name, project, source, cpl, spend, leads];
  if (section === 'Conversion') return [name, project, source, rate, qualified, leads];
  if (section === 'Attribution') return [name, project, source, provider, leads, spend];
  if (section === 'Campaign Performance' || section === 'Campaign Overview') return [name, project, source, leads, qualified, rate, cpl, spend];
  return [name, project, source, { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> }, leads, rate, cpl, spend];
}

export function CampaignDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(`/api/campaigns/${id}`);
  return (
    <Page eyebrow="Growth / Campaigns" title={data?.name || 'Campaign'} lede={data ? `${data.project} · ${data.sourceName || 'Unlinked source'}` : ''}>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            <article className="brief">
              <div className="brief-index">Read</div>
              <div>
                <h2>{data.analysis.answer}</h2>
                <p className="evidence">{data.analysis.evidence}</p>
                <p>{data.analysis.insight}</p>
                <p>{data.analysis.action}</p>
              </div>
            </article>
            <section className="panel">
              <header><h2>Daily leads and spend</h2></header>
              <LineChart points={data.metrics} />
            </section>
            <section className="panel">
              <header><h2>Leads from this campaign</h2></header>
              <Table
                columns={[
                  { key: 'fullName', label: 'Lead' },
                  { key: 'project', label: 'Project' },
                  { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
                  { key: 'score', label: 'Score' }
                ]}
                rows={data.leads}
              />
            </section>
          </div>
        ) : null}
      </State>
    </Page>
  );
}

export function Sources() {
  const { data, loading, error, reload } = useResource('/api/sources');
  const [section, setSection] = useSection(SOURCE_SECTIONS);
  const rows = [...(data || [])].sort((a, b) => {
    if (section === 'Lead Quality' || section === 'Conversion') return Number(b.qualifiedCount || 0) - Number(a.qualifiedCount || 0);
    return Number(b.leadCount || 0) - Number(a.leadCount || 0);
  });
  return (
    <Page eyebrow="Growth" title="Lead sources" lede="Source overview, performance, volume, quality, and conversion. Google, Meta, and the portals stay sources.">
      <Subnav items={SOURCE_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        <Table columns={sourceColumns(section)} rows={rows} />
      </State>
    </Page>
  );
}

function leadColumns(section) {
  const lead = { key: 'fullName', label: 'Lead' };
  const project = { key: 'project', label: 'Project' };
  const source = { key: 'sourceName', label: 'Source', render: (row) => row.sourceName || '—' };
  const status = { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> };
  const score = { key: 'score', label: 'Score' };
  const intent = { key: 'intent', label: 'Intent', render: (row) => label(row.intent) };
  const owner = { key: 'assigneeName', label: 'Assigned to', render: (row) => row.assigneeName || 'Unassigned' };
  const created = { key: 'createdAt', label: 'Created', render: (row) => when(row.createdAt) };
  if (section === 'Lead Scoring') return [lead, project, score, intent, status, source];
  if (section === 'Lead Assignment') return [lead, project, owner, status, score];
  if (section === 'Lead Details') return [
    lead,
    { key: 'phone', label: 'Phone' },
    { key: 'email', label: 'Email', render: (row) => row.email || '—' },
    project,
    { key: 'configuration', label: 'Configuration', render: (row) => row.configuration || '—' },
    { key: 'budgetInr', label: 'Budget', render: (row) => row.budgetInr ? inr(row.budgetInr) : '—' },
    source,
    { key: 'notesSummary', label: 'Note', render: (row) => row.notesSummary || '—' }
  ];
  if (section === 'Lead Inbox') return [lead, project, source, status, score, created];
  return [lead, project, source, status, score, owner, created];
}

function LeadSegments({ items }) {
  const buckets = new Map();
  for (const lead of items) {
    const key = `${lead.project || 'Unspecified'} · ${lead.sourceName || 'No source'}`;
    const current = buckets.get(key) || { id: key, label: key, leads: 0, qualified: 0 };
    current.leads += 1;
    if (['qualified', 'site_visit', 'negotiation', 'booked'].includes(lead.status)) current.qualified += 1;
    buckets.set(key, current);
  }
  const rows = [...buckets.values()].sort((a, b) => b.leads - a.leads);
  return (
    <Table
      columns={[
        { key: 'label', label: 'Project and source' },
        { key: 'leads', label: 'Leads' },
        { key: 'qualified', label: 'Qualified or further' }
      ]}
      rows={rows}
    />
  );
}

function sourceColumns(section) {
  const name = { key: 'name', label: 'Source' };
  const category = { key: 'category', label: 'Category', render: (row) => label(row.category) };
  const volume = { key: 'leadCount', label: 'Lead volume', render: (row) => num(row.leadCount) };
  const quality = { key: 'qualifiedCount', label: 'Qualified', render: (row) => num(row.qualifiedCount) };
  const booked = { key: 'bookedCount', label: 'Booked', render: (row) => num(row.bookedCount) };
  const rate = { key: 'rate', label: 'Qualified rate', render: (row) => row.leadCount ? `${Math.round((row.qualifiedCount / row.leadCount) * 100)}%` : '—' };
  const bookedRate = { key: 'bookedRate', label: 'Booking rate', render: (row) => row.leadCount ? `${Math.round((row.bookedCount / row.leadCount) * 100)}%` : '—' };
  if (section === 'Lead Volume') return [name, category, volume];
  if (section === 'Lead Quality') return [name, category, quality, volume, rate];
  if (section === 'Conversion') return [name, category, booked, volume, bookedRate];
  return [name, category, volume, quality, booked, rate];
}

export function Leads() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || '';
  const q = params.get('q') || '';
  const section = LEAD_SECTIONS.includes(params.get('section')) ? params.get('section') : 'All Leads';
  function choose(name) {
    const next = new URLSearchParams(params);
    next.set('section', name);
    if (name === 'Lead Inbox') next.set('status', 'new');
    if (name === 'All Leads') next.delete('status');
    setParams(next);
  }
  const { data, loading, error, reload } = useResource(`/api/leads?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
  const navigate = useNavigate();
  const { can } = useAuth();
  return (
    <Page
      eyebrow="Growth"
      title={status === 'new' ? 'Lead inbox' : 'Leads'}
      lede="Assignment, score, and source sit on the lead. The portal that sent it does not get its own module."
      actions={can('leads.export') ? <button className="btn" onClick={() => download('/api/leads/export', 'airo-leads.csv')}>Export</button> : null}
    >
      <Subnav items={LEAD_SECTIONS} value={section} onChange={choose} />
      <div className="filters">
        <input type="search" defaultValue={q} placeholder="Search name, phone, project" aria-label="Search leads" onKeyDown={(event) => {
          if (event.key === 'Enter') {
            params.set('q', event.currentTarget.value);
            setParams(params);
          }
        }} />
        {['', 'new', 'qualified', 'site_visit', 'booked'].map((item) => (
          <button key={item || 'all'} className={`btn-ghost ${status === item ? 'btn' : ''}`} onClick={() => {
            if (item) params.set('status', item); else params.delete('status');
            setParams(params);
          }}>{item ? label(item) : 'All'}</button>
        ))}
      </div>
      <State loading={loading} error={error} onRetry={reload} empty={!loading && section !== 'Lead Segmentation' && section !== 'Lead Activity' && data?.items.length === 0 ? { title: 'No leads in this cut', body: 'Change the filter, or add a lead once you have create access.' } : null}>
        {section === 'Lead Segmentation' ? <LeadSegments items={data?.items || []} /> : null}
        {section === 'Lead Activity' ? (
          <ul className="alert-list">
            {(data?.activities || []).length === 0 ? <li className="quiet">No lead activity is on record in this scope.</li> : data.activities.map((item) => (
              <li key={item.id}><strong>{item.leadName}</strong><span>{label(item.activityType)} · {item.body} · {when(item.createdAt)}</span></li>
            ))}
          </ul>
        ) : null}
        {section === 'Lead Import / Export' ? <p className="quiet">{data ? `${data.total} leads in scope. Export downloads this cut. A new lead is created from the lead record when you have create access.` : ''}</p> : null}
        {section !== 'Lead Segmentation' && section !== 'Lead Activity' ? (
          <Table
            columns={leadColumns(section)}
            rows={section === 'Lead Scoring'
              ? [...(data?.items || [])].sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
              : section === 'Lead Assignment'
                ? [...(data?.items || [])].sort((a, b) => Number(Boolean(a.assigneeName)) - Number(Boolean(b.assigneeName)))
                : (data?.items || [])}
            onRow={(row) => navigate(`/app/growth/leads/${row.id}`)}
          />
        ) : null}
        {section !== 'Lead Activity' && section !== 'Lead Segmentation' ? <p className="quiet">{data ? `${data.total} leads in scope` : ''}</p> : null}
      </State>
    </Page>
  );
}

export function LeadDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(`/api/leads/${id}`);
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');

  async function saveStatus(event) {
    event.preventDefault();
    await api.patch(`/api/leads/${id}`, { status });
    setMessage('Status updated.');
    reload();
  }

  return (
    <Page eyebrow="Growth / Leads" title={data?.fullName || 'Lead'} lede={data ? `${data.project} · ${data.configuration || 'Configuration open'} · ${data.sourceName || 'No source'}` : ''}>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="split">
            <div className="stack">
              <section className="panel">
                <header><h2>Score {data.score}</h2><Badge value={data.intent} /></header>
                <p>{data.notesSummary || data.scores?.[0]?.reason || 'No scoring note yet.'}</p>
                <p className="quiet">{data.phone} · {data.email || 'No email'} · Budget {data.budgetInr ? inr(data.budgetInr) : 'open'}</p>
                {can('leads.update') ? (
                  <form className="filters" onSubmit={saveStatus}>
                    <select value={status || data.status} onChange={(event) => setStatus(event.target.value)} aria-label="Lead status">
                      {['new', 'contacted', 'qualified', 'site_visit', 'negotiation', 'booked', 'lost', 'unqualified'].map((item) => <option key={item} value={item}>{label(item)}</option>)}
                    </select>
                    <button className="btn-primary" type="submit">Update status</button>
                  </form>
                ) : null}
                {message ? <p>{message}</p> : null}
              </section>
              <section className="panel">
                <header><h2>Activity</h2></header>
                <ul className="alert-list">
                  {data.activities.map((item) => <li key={item.id}><strong>{label(item.activityType)}</strong><span>{item.body} · {when(item.createdAt)}</span></li>)}
                </ul>
              </section>
            </div>
            <aside className="panel">
              <header><h2>Context</h2></header>
              <p>Owner: {data.assigneeName || 'Unassigned'}</p>
              <p>Campaign: {data.campaignName ? <Link to={`/app/growth/campaigns/${data.campaignId}`}>{data.campaignName}</Link> : '—'}</p>
              <p>Tags: {data.tags.length ? data.tags.join(', ') : 'None'}</p>
            </aside>
            <LeadWhatsapp leadId={id} />
          </div>
        ) : null}
      </State>
    </Page>
  );
}
