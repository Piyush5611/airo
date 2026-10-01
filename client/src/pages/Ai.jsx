import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useResource } from '../data.js';
import { label } from '../format.js';
import { Badge, Page, State, Subnav, useSection } from '../ui.jsx';

const ASK_SECTIONS = ['Ask AI', 'Business Questions', 'Lead Questions', 'Campaign Questions', 'Sales Questions', 'Report Questions'];
const ASK_TEXT = {
  'Business Questions': 'What changed in the business this week?',
  'Lead Questions': 'Which high-intent leads are still untouched?',
  'Campaign Questions': 'Which campaign is pushing cost per lead up?',
  'Sales Questions': 'What is open in the pipeline?',
  'Report Questions': 'What should the executive report say this week?'
};
const REC_SECTIONS = ['Lead Recommendations', 'Campaign Recommendations', 'Sales Recommendations', 'Follow-up Recommendations'];
const WATCH_SECTIONS = ['Performance Anomalies', 'Integration Issues', 'Lead Quality Changes', 'Campaign Alerts', 'Sales Alerts'];

export function Assistant() {
  const [question, setQuestion] = useState('');
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [section, setSection] = useSection(ASK_SECTIONS);

  async function ask(text) {
    const value = (text || question).trim();
    if (!value) return;
    setBusy(true);
    setError('');
    setMessages((items) => [...items, { role: 'user', content: value }]);
    setQuestion('');
    try {
      const data = await api.post('/api/ai/ask', { question: value, conversationId: conversationId || undefined });
      setConversationId(data.conversationId);
      setMessages((items) => [...items, { role: 'assistant', ...data }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page eyebrow="AI workspace" title="Assistant" lede="Answers are calculated from this organization's leads, campaigns, calls, and pipeline. An external model is not connected.">
      <Subnav items={ASK_SECTIONS} value={section} onChange={(name) => { setSection(name); if (ASK_TEXT[name]) ask(ASK_TEXT[name]); }} />
      <div className="stack">
        {messages.map((message, index) => message.role === 'user' ? (
          <p key={index}><strong>You. </strong>{message.content}</p>
        ) : (
          <article className="brief" key={index}>
            <div className="brief-index">Answer</div>
            <div>
              <h2>{message.answer}</h2>
              <p className="evidence">Evidence. {message.evidence}</p>
              <p>Insight. {message.insight}</p>
              <p>Next. {message.action}</p>
              <div className="page-actions">{message.actions?.map((action) => <Link className="btn" key={action.path} to={action.path}>{action.label}</Link>)}</div>
            </div>
          </article>
        ))}
        {busy ? <div className="skeleton-block" aria-label="Working from workspace data" /> : null}
        {error ? <p className="delta-down">{error}</p> : null}
        <form className="filters" onSubmit={(event) => { event.preventDefault(); ask(); }}>
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about leads, campaigns, sales, or calls" aria-label="Question" />
          <button className="btn-primary" type="submit" disabled={busy}>Ask</button>
        </form>
      </div>
    </Page>
  );
}

export function Recommendations() {
  const { data, loading, error, reload } = useResource('/api/ai/recommendations');
  async function setStatus(id, status) {
    await api.patch(`/api/ai/recommendations/${id}`, { status });
    reload();
  }
  const [section, setSection] = useSection(REC_SECTIONS);
  const categoryFor = {
    'Lead Recommendations': 'leads',
    'Campaign Recommendations': 'campaigns',
    'Sales Recommendations': 'sales',
    'Follow-up Recommendations': 'follow'
  };
  const wanted = categoryFor[section];
  const items = (data?.items || []).filter((item) => {
    if (wanted === 'follow') return /follow|call|untouched|inbox/i.test(`${item.title} ${item.body} ${item.actionPath}`);
    return item.category === wanted;
  });
  return (
    <Page eyebrow="AI workspace" title="Recommendations" lede="Lead, campaign, sales, and follow-up recommendations, each tied to evidence.">
      <Subnav items={REC_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        <div className="stack">
          {items.length === 0 ? <p className="quiet">No open {section.toLowerCase()} yet.</p> : null}
          {items.map((item) => (
            <article className="panel" key={item.id}>
              <header><h2>{item.title}</h2><Badge value={item.status} /></header>
              <p className="quiet">{label(item.category)}</p>
              <p>{item.body}</p>
              <p className="quiet">{item.evidence}</p>
              <div className="page-actions">
                {item.actionPath ? <Link className="btn" to={item.actionPath}>{item.actionLabel || 'Open'}</Link> : null}
                {item.status === 'open' ? <button className="btn-ghost" onClick={() => setStatus(item.id, 'dismissed')}>Dismiss</button> : null}
              </div>
            </article>
          ))}
        </div>
      </State>
    </Page>
  );
}

export function Monitoring() {
  const { data, loading, error, reload } = useResource('/api/ai/monitoring');
  const [section, setSection] = useSection(WATCH_SECTIONS);
  const show = (name) => section === name;
  return (
    <Page eyebrow="AI workspace" title="Monitoring" lede="Performance anomalies, integration issues, lead quality, campaign alerts, and sales alerts.">
      <Subnav items={WATCH_SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="split">
            {show('Performance Anomalies') || show('Campaign Alerts') ? <section className="panel">
              <header><h2>{section}</h2></header>
              <ul className="alert-list">
                {data.anomalies.length === 0 ? <li>No sharp cost movement this week.</li> : data.anomalies.map((item) => <li key={item.title}><Link to={item.path}><strong>{item.title}</strong><span>{item.body}</span></Link></li>)}
              </ul>
            </section> : null}
            {show('Lead Quality Changes') ? <section className="panel"><h2>Lead quality</h2><p>Qualified leads {data.leadQuality.qualifiedDelta}% versus the previous week. Untouched high-intent: {data.leadQuality.uncontactedHighIntent}.</p></section> : null}
            {show('Integration Issues') ? <section className="panel">
              <header><h2>Integration issues</h2></header>
              <ul className="alert-list">
                {data.connections.length === 0 ? <li>No degraded connections.</li> : data.connections.map((item) => <li key={item.id}><Link to={`/app/connections/${item.id}`}><strong>{item.name}</strong><span>{item.message || item.status}</span></Link></li>)}
              </ul>
            </section> : null}
            {show('Sales Alerts') ? <section className="panel"><h2>Sales alerts</h2><p>{data.sales.missed} missed calls of {data.sales.total}.</p></section> : null}
          </div>
        ) : null}
      </State>
    </Page>
  );
}
