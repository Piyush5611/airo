import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useResource } from '../data.js';
import { label, num, when } from '../format.js';
import { Badge, Page, State, Subnav, Table, useSection } from '../ui.jsx';

const SECTIONS = ['Overview', 'Connection', 'Businesses', 'Conversations', 'Capabilities', 'Logs'];

export function PlatformWhatsapp() {
  const { data, loading, error, reload } = useResource('/api/admin/whatsapp');
  const [section, setSection] = useSection(SECTIONS);
  const [open, setOpen] = useState(null);
  const detail = useResource(open ? `/api/admin/whatsapp/conversations/${open}` : null);
  useEffect(() => {
    const first = data?.conversations?.[0]?.id;
    if (first) setOpen((current) => current || first);
  }, [data]);
  return (
    <Page eyebrow="Platform" title="WhatsApp chatbot" lede="One AIRO chatbot for every business. People do the work in the conversation. Only Super Admin and Developer/Admin manage it.">
      <Subnav items={SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            {section === 'Overview' || section === 'Conversations' ? <ChatInbox data={data} open={open} setOpen={setOpen} detail={detail} /> : null}
            {section === 'Overview' ? <Overview data={data} reload={reload} /> : null}
            {section === 'Connection' ? <ConnectPanel data={data} reload={reload} /> : null}
            {section === 'Businesses' ? <Businesses data={data} reload={reload} /> : null}
            {section === 'Logs' ? (
              <>
                <Table
                  columns={[
                    { key: 'organizationName', label: 'Business' },
                    { key: 'contactName', label: 'Person' },
                    { key: 'topic', label: 'Work', render: (row) => label(row.topic) },
                    { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
                    { key: 'lastMessageAt', label: 'Last message', render: (row) => when(row.lastMessageAt) }
                  ]}
                  rows={data.conversations}
                  onRow={(row) => setOpen(row.id)}
                />
                {detail.data ? (
                  <section className="panel">
                    <header><h2>{detail.data.conversation.contactName} · {detail.data.conversation.organizationName}</h2></header>
                    <ul className="alert-list">
                      {detail.data.messages.map((message) => (
                        <li key={message.id}>
                          <strong>{message.direction === 'inbound' ? detail.data.conversation.contactName : 'AIRO'}</strong>
                          <span>{message.body}{message.actionTaken ? ` · ${message.actionTaken}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}
            {section === 'Capabilities' ? (
              <Table
                columns={[
                  { key: 'name', label: 'Work the chat can do' },
                  { key: 'detail', label: 'Inside the business workspace' }
                ]}
                rows={data.capabilities.map((row) => ({ ...row, id: row.key }))}
              />
            ) : null}
          </div>
        ) : null}
      </State>
    </Page>
  );
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || '?';
}

function ChatInbox({ data, open, setOpen, detail }) {
  const people = data.conversations || [];
  const active = detail.data?.conversation?.id === open ? detail.data.conversation : null;
  const messages = active ? detail.data.messages || [] : [];
  return (
    <section className="wa-inbox" aria-label="WhatsApp chats">
      <div className="wa-people">
        <header>
          <h2>Chats</h2>
          <p className="quiet">{data.bot.connected ? data.bot.phoneLabel : 'Connect the chatbot to see live chats'}</p>
        </header>
        {people.length ? people.map((person) => (
          <button key={person.id} type="button" className={person.id === open ? 'wa-person is-on' : 'wa-person'} onClick={() => setOpen(person.id)}>
            <span className="wa-avatar" aria-hidden="true">{initials(person.contactName)}</span>
            <span>
              <strong>{person.contactName}</strong>
              <em>{person.organizationName} · {person.contactPhone}</em>
              <p>{person.lastDirection === 'outbound' ? 'AIRO: ' : ''}{person.lastMessage || 'No message yet'}</p>
            </span>
          </button>
        )) : <p className="quiet wa-empty">No chats yet. A message to this number will show here with the person's name.</p>}
      </div>
      <div className="wa-thread">
        {active ? (
          <>
            <header>
              <span className="wa-avatar" aria-hidden="true">{initials(active.contactName)}</span>
              <div>
                <strong>{active.contactName}</strong>
                <p className="quiet">{active.contactPhone} · {active.organizationName}</p>
              </div>
              <Badge value={active.status} />
            </header>
            <div className="wa-bubbles">
              {messages.map((message) => (
                <article key={message.id} className={message.direction === 'outbound' ? 'wa-bubble out' : 'wa-bubble in'}>
                  <b>{message.direction === 'outbound' ? 'AIRO' : active.contactName}</b>
                  <span>{message.body}</span>
                  <small>{when(message.createdAt)}{message.actionTaken ? ` · ${message.actionTaken}` : ''}</small>
                </article>
              ))}
            </div>
          </>
        ) : (
          <p className="quiet wa-empty">{detail.loading && open ? 'Opening chat…' : 'Select a person to read the chat.'}</p>
        )}
      </div>
    </section>
  );
}

function Overview({ data }) {
  return (
    <div className="metric-strip">
      <div className="metric"><span>Bot</span><strong>{label(data.bot.status)}</strong><em>{data.bot.phoneLabel}</em></div>
      <div className="metric"><span>Businesses</span><strong>{num(data.summary.enabled)}</strong><em>{num(data.summary.businesses)} enrolled</em></div>
      <div className="metric"><span>Open conversations</span><strong>{num(data.summary.openConversations)}</strong><em>Across those businesses</em></div>
    </div>
  );
}

function ConnectPanel({ data, reload }) {
  const [form, setForm] = useState({
    accessToken: '',
    apiVersion: data.bot.apiVersion || 'v21.0',
    phoneNumberId: data.bot.phoneNumberId || '',
    verifyToken: ''
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function connect(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/api/admin/whatsapp/connect', form);
      setForm({ ...form, accessToken: '', verifyToken: '' });
      setNotice('WhatsApp confirmed this phone number. The chatbot is connected.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.post('/api/admin/whatsapp/disconnect');
      setNotice('WhatsApp chatbot is disconnected.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (data.bot.connected) {
    return (
      <section className="panel connect-card">
        <div>
          <header><h2>WhatsApp chatbot</h2><Badge value="connected" /></header>
          <p>{data.bot.providerName || 'WhatsApp'}</p>
          <p className="quiet">{data.bot.phoneLabel}</p>
        </div>
        <div className="stack">
          <p className="quiet">API {data.bot.apiVersion} · phone number ID {data.bot.phoneNumberId} · token {data.bot.tokenPreview || 'saved'}.</p>
          <p className="quiet">Webhook {data.bot.webhookPath}. In Meta, set this callback and the same verify token.</p>
          <button className="btn" type="button" disabled={busy} onClick={disconnect}>Disconnect</button>
          {notice ? <p>{notice}</p> : null}
          {error ? <p className="delta-down">{error}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <form className="panel connect-card" onSubmit={connect}>
      <div>
        <header><h2>Connect WhatsApp</h2><Badge value="pending" /></header>
        <p className="quiet">These four values are checked with WhatsApp before the bot is marked connected. Every business uses this one number.</p>
      </div>
      <div className="connect-fields">
        <label className="stack-field wide">WHATSAPP_ACCESS_TOKEN
          <input type="password" value={form.accessToken} onChange={(event) => setForm({ ...form, accessToken: event.target.value })} autoComplete="off" required />
        </label>
        <label className="stack-field">WHATSAPP_API_VERSION
          <input value={form.apiVersion} onChange={(event) => setForm({ ...form, apiVersion: event.target.value })} placeholder="v21.0" required />
        </label>
        <label className="stack-field">WHATSAPP_PHONE_NUMBER_ID
          <input value={form.phoneNumberId} onChange={(event) => setForm({ ...form, phoneNumberId: event.target.value })} inputMode="numeric" required />
        </label>
        <label className="stack-field wide">WHATSAPP_VERIFY_TOKEN
          <input type="password" value={form.verifyToken} onChange={(event) => setForm({ ...form, verifyToken: event.target.value })} autoComplete="off" required />
        </label>
        <p className="quiet wide">Webhook {data.bot.webhookPath}</p>
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Checking with WhatsApp…' : 'Connect chatbot'}</button>
        {notice ? <p className="wide">{notice}</p> : null}
        {error ? <p className="delta-down wide">{error}</p> : null}
      </div>
    </form>
  );
}

function Businesses({ data, reload }) {
  return (
    <Table
      columns={[
        { key: 'organizationName', label: 'Business' },
        { key: 'city', label: 'City' },
        { key: 'conversations', label: 'Conversations' },
        { key: 'enabled', label: 'Chatbot', render: (row) => <Badge value={Number(row.enabled) === 1 ? 'active' : 'paused'} /> },
        { key: 'action', label: '', render: (row) => (
          <button className="btn-ghost" onClick={() => api.patch('/api/admin/whatsapp/businesses', {
            organizationId: row.organizationId,
            enabled: Number(row.enabled) !== 1
          }).then(reload)}>{Number(row.enabled) === 1 ? 'Pause' : 'Enable'}</button>
        ) }
      ]}
      rows={data.businesses.map((row) => ({ ...row, id: row.organizationId }))}
    />
  );
}
