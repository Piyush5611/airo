import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useResource } from '../data.js';
import { inr, label } from '../format.js';
import { Funnel, LineChart, Page, State, Subnav, Table, useSection } from '../ui.jsx';

const VIEWS = [
  ['Marketing Analytics', 'marketing'],
  ['Lead Analytics', 'leads'],
  ['Sales Analytics', 'sales'],
  ['Call Analytics', 'calls'],
  ['Funnel Analytics', 'funnel'],
  ['Conversion Analytics', 'conversion'],
  ['Attribution Analytics', 'attribution'],
  ['Revenue Analytics', 'revenue']
];
const REPORT_SECTIONS = ['Executive Report', 'Marketing Report', 'Sales Report', 'Lead Report', 'Call Report', 'Campaign Report', 'Team Report', 'Custom Reports'];
const REPORT_KIND = {
  'Executive Report': 'executive',
  'Marketing Report': 'marketing',
  'Sales Report': 'sales',
  'Lead Report': 'leads',
  'Call Report': 'calls',
  'Campaign Report': 'campaign',
  'Team Report': 'team'
};

export function Reports() {
  const { data, loading, error, reload } = useResource('/api/reports');
  const navigate = useNavigate();
  const [section, setSection] = useSection(REPORT_SECTIONS);
  const rows = (data?.items || []).filter((row) => {
    const custom = Number(row.isCustom) === 1;
    if (section === 'Custom Reports') return custom;
    return row.reportKind === REPORT_KIND[section] && !custom;
  });
  return (
    <Page eyebrow="Intelligence" title="Reports" lede="Executive, marketing, sales, lead, call, campaign, team, and custom reports. Each one reads this workspace.">
      <Subnav items={REPORT_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        <Table
          columns={[
            { key: 'name', label: 'Report' },
            { key: 'description', label: 'What it answers' },
            { key: 'isCustom', label: 'Type', render: (row) => row.isCustom ? 'Custom' : 'Standard' }
          ]}
          rows={rows}
          onRow={(row) => navigate(`/app/intelligence/reports/${row.slug}`)}
        />
      </State>
    </Page>
  );
}

export function ReportView() {
  const { slug } = useParams();
  const { data, loading, error, reload } = useResource(`/api/reports/${slug}`);
  return (
    <Page eyebrow="Intelligence / Reports" title={data?.report.name || 'Report'} lede={data?.report.description || ''}>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? <AnalyticsBody view={data.report.reportKind} data={data.data} /> : null}
      </State>
    </Page>
  );
}

export function Analytics() {
  const [view, setView] = useState('marketing');
  const { data, loading, error, reload } = useResource(`/api/analytics?view=${view}`);
  const current = VIEWS.find((item) => item[1] === view)?.[0] || VIEWS[0][0];
  return (
    <Page eyebrow="Intelligence" title="Analytics" lede="Marketing, leads, sales, calls, funnel, conversion, attribution, and revenue.">
      <Subnav items={VIEWS.map((item) => item[0])} value={current} onChange={(name) => setView(VIEWS.find((item) => item[0] === name)[1])} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? <AnalyticsBody view={view} data={data} /> : null}
      </State>
    </Page>
  );
}

function AnalyticsBody({ view, data }) {
  const blocks = [
    data.brief ? 'brief' : null,
    data.series ? 'series' : null,
    data.funnel ? 'funnel' : null,
    data.pipeline ? 'pipeline' : null,
    data.calls ? 'calls' : null,
    data.sources ? 'sources' : null,
    data.campaigns ? 'campaigns' : null
  ].filter(Boolean);
  if (!blocks.length) return <p className="quiet">This cut has no series yet.</p>;
  return (
    <div className="stack">
      {data.brief ? <article className="brief"><div className="brief-index">Executive</div><div><h2>{data.brief.answer}</h2><p>{data.brief.evidence}</p><p>{data.brief.action}</p></div></article> : null}
      {data.series ? <section className="panel"><header><h2>Lead volume</h2><p>{label(view)}</p></header><LineChart points={data.series} /></section> : null}
      {data.cpl ? <p className="quiet">Blended CPL this week {data.cpl.thisWeek ? inr(data.cpl.thisWeek) : '—'} · previous {data.cpl.previousWeek ? inr(data.cpl.previousWeek) : '—'}</p> : null}
      {data.leads ? <p className="quiet">Leads this week {data.leads.thisWeek ?? '—'} · previous week {data.leads.previousWeek ?? '—'}. Qualified this week {data.qualified?.thisWeek ?? '—'}.</p> : null}
      {data.funnel ? <section className="panel"><header><h2>Funnel</h2></header><Funnel rows={data.funnel} /></section> : null}
      {data.pipeline ? <section className="panel"><h2>Open pipeline {inr(data.pipeline.openValue)}</h2><p>{data.pipeline.openDeals} open deals · booked {inr(data.pipeline.wonValue)} · lost deals {data.pipeline.lostDeals}</p></section> : null}
      {data.calls ? <section className="panel"><h2>{data.calls.total} calls</h2><p>{data.calls.missed} missed · average score {data.calls.averageScore ?? '—'}</p></section> : null}
      {data.sources ? <Table columns={[
        { key: 'name', label: 'Source' },
        { key: 'leads', label: 'Leads' },
        { key: 'qualified', label: 'Qualified' },
        { key: 'booked', label: 'Booked' }
      ]} rows={data.sources} /> : null}
      {data.campaigns ? <CampaignTable rows={data.campaigns} /> : null}
    </div>
  );
}

function CampaignTable({ rows }) {
  return <Table columns={[
    { key: 'name', label: 'Campaign' },
    { key: 'leads', label: 'Leads' },
    { key: 'cpl', label: 'CPL', render: (row) => row.cpl ? inr(row.cpl) : '—' },
    { key: 'spend', label: 'Spend', render: (row) => inr(row.spend) }
  ]} rows={rows} />;
}
