import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { inr, label, minutes, when } from '../format.js';
import { Badge, Page, State, Subnav, Table, useSection } from '../ui.jsx';

const PIPELINE_SECTIONS = ['Pipeline Overview', 'Opportunities', 'Stages', 'Deal Details', 'Conversion', 'Stage Analytics', 'Lost Reasons'];
const CALL_SECTIONS = ['All Calls', 'Call Details', 'Recordings', 'Transcripts', 'AI Summary', 'Buying Signals', 'Objections', 'Call Score', 'Call Analytics'];

export function Pipeline() {
  const { data, loading, error, reload } = useResource('/api/pipeline');
  const navigate = useNavigate();
  const [section, setSection] = useSection(PIPELINE_SECTIONS);
  const show = (name) => section === 'Pipeline Overview' || section === name;
  return (
    <Page eyebrow="Sales" title="Pipeline" lede="Overview, opportunities, stages, deal details, conversion, stage analytics, and lost reasons.">
      <Subnav items={PIPELINE_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            {show('Conversion') ? <div className="metric-strip">
              <div className="metric"><span>Open</span><strong>{inr(data.summary.openValue)}</strong><em>{data.summary.openDeals} deals</em></div>
              <div className="metric"><span>Booked</span><strong>{inr(data.summary.wonValue)}</strong><em>Won on record</em></div>
            </div> : null}
            {show('Stages') || show('Stage Analytics') ? <section className="panel">
              <header><h2>Stages</h2></header>
              {data.stages.map((stage) => (
                <div className="funnel-row" key={stage.id}><span>{stage.name}</span><div className="funnel-track"><span style={{ width: `${Math.min(100, stage.deals * 20)}%` }} /></div><strong>{stage.deals}</strong></div>
              ))}
            </section> : null}
            {show('Opportunities') || show('Deal Details') ? <Table
              columns={[
                { key: 'title', label: 'Opportunity' },
                { key: 'stageName', label: 'Stage' },
                { key: 'valueInr', label: 'Value', render: (row) => inr(row.valueInr) },
                { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
                { key: 'ownerName', label: 'Owner' }
              ]}
              rows={data.opportunities}
              onRow={(row) => navigate(`/app/sales/pipeline/${row.id}`)}
            /> : null}
            {show('Deal Details') ? <p className="quiet">Open an opportunity for the lead, stage move, and activity.</p> : null}
            {show('Lost Reasons') ? (
              <section className="panel">
                <header><h2>Lost reasons</h2></header>
                <Table columns={[
                  { key: 'reason', label: 'Reason' },
                  { key: 'total', label: 'Deals' }
                ]} rows={data.lostReasons.map((item) => ({ ...item, id: item.reason }))} />
              </section>
            ) : null}
            {show('Stage Analytics') ? (
              <section className="panel">
                <header><h2>Stage value</h2></header>
                <Table columns={[
                  { key: 'name', label: 'Stage' },
                  { key: 'deals', label: 'Deals' },
                  { key: 'value', label: 'Value', render: (row) => inr(row.value) }
                ]} rows={data.stages.map((stage) => ({
                  ...stage,
                  value: data.opportunities.filter((deal) => deal.stageName === stage.name).reduce((sum, deal) => sum + Number(deal.valueInr || 0), 0)
                }))} />
              </section>
            ) : null}
          </div>
        ) : null}
      </State>
    </Page>
  );
}

export function Opportunity() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(`/api/pipeline/${id}`);
  const stages = useResource('/api/pipeline');
  const { can } = useAuth();
  const [stageId, setStageId] = useState('');
  async function move(event) {
    event.preventDefault();
    await api.patch(`/api/pipeline/${id}`, { stageId: Number(stageId) });
    reload();
  }
  return (
    <Page eyebrow="Sales / Pipeline" title={data?.title || 'Opportunity'} lede={data ? `${data.project} · ${inr(data.valueInr)}` : ''}>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            <section className="panel">
              <header><h2>{data.stageName}</h2><Badge value={data.status} /></header>
              <p>Lead: {data.leadId ? <Link to={`/app/growth/leads/${data.leadId}`}>{data.leadName}</Link> : '—'}</p>
              {data.lostReason ? <p>Lost reason: {data.lostReason}</p> : null}
              {can('pipeline.update') && stages.data ? (
                <form className="filters" onSubmit={move}>
                  <select value={stageId} onChange={(event) => setStageId(event.target.value)} required aria-label="Stage">
                    <option value="">Move to</option>
                    {stages.data.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
                  </select>
                  <button className="btn-primary" type="submit">Move</button>
                </form>
              ) : null}
            </section>
            <ul className="alert-list">{data.activity.map((item, index) => <li key={index}><strong>{item.body}</strong><span>{when(item.createdAt)}</span></li>)}</ul>
          </div>
        ) : null}
      </State>
    </Page>
  );
}

export function Calls() {
  const { data, loading, error, reload } = useResource('/api/calls');
  const navigate = useNavigate();
  const [section, setSection] = useSection(CALL_SECTIONS);
  return (
    <Page eyebrow="Sales" title="Calls" lede="All calls, then the recording, transcript, summary, buying signals, objections, and score on the call you open.">
      <Subnav items={CALL_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <>
            {section === 'Call Analytics' ? (
              <div className="metric-strip">
                <div className="metric"><span>Calls</span><strong>{data.summary.total}</strong></div>
                <div className="metric"><span>Missed</span><strong>{data.summary.missed}</strong></div>
                <div className="metric"><span>Average score</span><strong>{data.summary.averageScore ?? '—'}</strong></div>
                <div className="metric"><span>With a transcript</span><strong>{data.items.filter((row) => row.transcriptExcerpt).length}</strong></div>
              </div>
            ) : (
              <p className="quiet">{data.summary.total} calls · {data.summary.missed} missed · average score {data.summary.averageScore ?? '—'}</p>
            )}
            <Table columns={callColumns(section)} rows={data.items} onRow={(row) => navigate(`/app/sales/calls/${row.id}`)} />
          </>
        ) : null}
      </State>
    </Page>
  );
}

function callColumns(section) {
  const lead = { key: 'leadName', label: 'Lead', render: (row) => row.leadName || 'Unknown' };
  const project = { key: 'project', label: 'Project' };
  const status = { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> };
  const whenCol = { key: 'startedAt', label: 'When', render: (row) => when(row.startedAt) };
  const score = { key: 'score', label: 'Call score', render: (row) => row.score ?? '—' };
  if (section === 'Recordings') return [lead, project, { key: 'recordingNote', label: 'Recording', render: (row) => row.recordingNote || (row.recordingAvailable ? 'Available' : 'No recording') }, whenCol];
  if (section === 'Transcripts') return [lead, { key: 'transcriptExcerpt', label: 'Transcript', render: (row) => row.transcriptExcerpt || 'No transcript stored' }, whenCol];
  if (section === 'AI Summary') return [lead, score, { key: 'summary', label: 'Summary', render: (row) => row.summary || '—' }, whenCol];
  if (section === 'Buying Signals') return [lead, { key: 'buyingSignals', label: 'Buying signals', render: (row) => row.buyingSignals?.length ? row.buyingSignals.join(' · ') : '—' }, score];
  if (section === 'Objections') return [lead, { key: 'objections', label: 'Objections', render: (row) => row.objections?.length ? row.objections.join(' · ') : '—' }, score];
  if (section === 'Call Score') return [lead, project, score, { key: 'outcome', label: 'Outcome', render: (row) => row.outcome || '—' }, status];
  if (section === 'Call Analytics') return [lead, status, score, { key: 'outcome', label: 'Outcome', render: (row) => row.outcome || '—' }, whenCol];
  return [lead, project, status, { key: 'outcome', label: 'Outcome', render: (row) => row.outcome || '—' }, score, whenCol];
}

export function CallDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(`/api/calls/${id}`);
  return (
    <Page eyebrow="Sales / Calls" title={data?.leadName || 'Call'} lede={data ? `${label(data.direction)} · ${minutes(data.durationSeconds)} · ${data.outcome || ''}` : ''}>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            {data.analysis ? (
              <article className="brief">
                <div className="brief-index">Score {data.analysis.score}</div>
                <div>
                  <h2>{data.analysis.summary}</h2>
                  <p>Buying signals: {data.analysis.buyingSignals.join(' · ')}</p>
                  <p>Objections: {data.analysis.objections.join(' · ')}</p>
                </div>
              </article>
            ) : null}
            <section className="panel">
              <header><h2>Transcript</h2></header>
              <p style={{ whiteSpace: 'pre-wrap' }}>{data.transcript || 'No transcript stored.'}</p>
            </section>
            <section className="panel">
              <header><h2>Recording</h2></header>
              <p>{data.recording?.note || 'No recording reference.'}</p>
            </section>
          </div>
        ) : null}
      </State>
    </Page>
  );
}

export function Activities() {
  const { data, loading, error, reload } = useResource('/api/activities');
  const { can } = useAuth();
  const [title, setTitle] = useState('');
  const [tab, setTab] = useState('Tasks');
  async function addTask(event) {
    event.preventDefault();
    await api.post('/api/activities/tasks', { title });
    setTitle('');
    reload();
  }
  return (
    <Page eyebrow="Sales" title="Activities" lede="Tasks, notes, reminders, and the timeline of what the desk actually did.">
      <div className="tabs">
        {['Tasks', 'Follow-ups', 'Notes', 'Reminders', 'Activity Timeline'].map((item) => (
          <button key={item} className={tab === item ? 'is-on' : ''} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      <State loading={loading} error={error} onRetry={reload}>
        {data && (tab === 'Tasks' || tab === 'Follow-ups') ? (
          <div className="stack">
            {can('activities.create') ? (
              <form className="filters" onSubmit={addTask}>
                <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="New task" aria-label="Task title" required />
                <button className="btn-primary" type="submit">Add task</button>
              </form>
            ) : null}
            <ul className="alert-list">
              {(tab === 'Follow-ups' ? data.tasks.filter((task) => task.dueAt) : data.tasks).map((task) => (
                <li key={task.id}>
                  <strong>{task.title}</strong>
                  <span>{label(task.status)} · {task.assigneeName || 'Unassigned'} · {when(task.dueAt)}</span>
                  {can('activities.update') && task.status === 'open' ? <button className="btn-ghost" onClick={() => api.post(`/api/activities/tasks/${task.id}/complete`).then(reload)}>Done</button> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {data && tab === 'Notes' ? <ul className="alert-list">{data.notes.map((note) => <li key={note.id}><strong>{note.authorName}</strong><span>{note.body}</span></li>)}</ul> : null}
        {data && tab === 'Reminders' ? <ul className="alert-list">{data.reminders.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{when(item.remindAt)} · {item.ownerName}</span></li>)}</ul> : null}
        {data && tab === 'Activity Timeline' ? <ul className="alert-list">{data.timeline.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.body} · {when(item.occurredAt)}</span></li>)}</ul> : null}
      </State>
    </Page>
  );
}
