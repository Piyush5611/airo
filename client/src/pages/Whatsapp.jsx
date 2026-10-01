import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, currentToken } from '../api.js';
import { useAuth } from '../auth.jsx';
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
  useEffect(() => {
    let stopped = false;
    let controller = new AbortController();
    async function listen() {
      while (!stopped) {
        controller = new AbortController();
        try {
          const headers = { Accept: 'text/event-stream' };
          const token = currentToken();
          if (token) headers.Authorization = `Bearer ${token}`;
          const response = await fetch('/api/admin/whatsapp/live', { headers, credentials: 'include', signal: controller.signal });
          if (!response.ok || !response.body) throw new Error('closed');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              const line = part.split('\n').find((row) => row.startsWith('data: '));
              if (!line) continue;
              const payload = JSON.parse(line.slice(6));
              if (payload.type !== 'message') continue;
              reload({ silent: true });
              detail.reload({ silent: true });
            }
          }
        } catch {
          if (stopped) return;
        }
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    listen();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [reload, detail.reload]);
  return (
    <Page eyebrow="Platform" title="WhatsApp chatbot" lede="One AIRO chatbot for every business. People do the work in the conversation. Only Super Admin and Developer/Admin manage it.">
      <Subnav items={SECTIONS} value={section} onChange={setSection} />
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            {section === 'Overview' || section === 'Conversations' ? <ChatInbox data={data} open={open} setOpen={setOpen} detail={detail} onSent={() => { reload({ silent: true }); detail.reload({ silent: true }); }} /> : null}
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

function ChatInbox({ data, open, setOpen, detail, onSent }) {
  const people = data.conversations || [];
  const active = detail.data?.conversation?.id === open ? detail.data.conversation : null;
  const messages = active ? detail.data.messages || [] : [];
  const endRef = useRef(null);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, open]);
  useEffect(() => {
    setDraft('');
    setSendError('');
  }, [open]);
  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!open || !text) return;
    setSending(true);
    setSendError('');
    try {
      await api.post(`/api/admin/whatsapp/conversations/${open}/messages`, { body: text });
      setDraft('');
      onSent();
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  }
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
              <div ref={endRef} />
            </div>
            {data.bot.connected ? (
              <form className="wa-compose" onSubmit={send}>
                <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4096} placeholder={`Message ${active.contactName}`} rows={1} />
                <button className="btn-primary" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : 'Send'}</button>
                {sendError ? <p className="delta-down">{sendError}</p> : <p className="quiet">WhatsApp delivers this within 24 hours of their last message.</p>}
              </form>
            ) : <p className="quiet wa-empty">Connect the chatbot before sending.</p>}
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

function useWhatsappLive(onMessage, streamPath) {
  useEffect(() => {
    let stopped = false;
    let controller = new AbortController();
    async function listen() {
      while (!stopped) {
        controller = new AbortController();
        try {
          const headers = { Accept: 'text/event-stream' };
          const token = currentToken();
          if (token) headers.Authorization = `Bearer ${token}`;
          const response = await fetch(streamPath, { headers, credentials: 'include', signal: controller.signal });
          if (!response.ok || !response.body) throw new Error('closed');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!stopped) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (const part of parts) {
              const line = part.split('\n').find((row) => row.startsWith('data: '));
              if (!line) continue;
              const payload = JSON.parse(line.slice(6));
              if (payload.type === 'message') onMessage({ silent: true });
            }
          }
        } catch {
          if (stopped) return;
        }
        if (!stopped) await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    listen();
    return () => {
      stopped = true;
      controller.abort();
    };
  }, [onMessage, streamPath]);
}

export function WorkspaceWhatsapp() {
  const { data, loading, error, reload } = useResource('/api/whatsapp');
  const [open, setOpen] = useState(null);
  const detail = useResource(open ? `/api/whatsapp/conversations/${open}` : null);
  const refresh = useCallback(() => {
    reload({ silent: true });
    detail.reload({ silent: true });
  }, [reload, detail.reload]);
  useEffect(() => {
    const first = data?.conversations?.[0]?.id;
    if (first) setOpen((current) => current || first);
  }, [data]);
  useWhatsappLive(refresh, '/api/whatsapp/live');
  const people = data?.conversations || [];
  const active = detail.data?.conversation?.id === open ? detail.data.conversation : null;
  const messages = active ? detail.data.messages || [] : [];
  return (
    <Page eyebrow="Workspace" title="WhatsApp" lede="Add this business's WhatsApp numbers. A chat from one of those numbers is recognized as this workspace.">
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            {data.notice ? <p className="error-box">{data.notice}</p> : <BusinessNumbers numbers={data.numbers || []} reload={reload} />}
            <section className="wa-inbox" aria-label="Customer WhatsApp chats">
              <div className="wa-people">
                <header>
                  <h2>Chats</h2>
                  <p className="quiet">Business numbers and lead numbers</p>
                </header>
                {people.length ? people.map((person) => (
                  <button key={person.id} type="button" className={person.id === open ? 'wa-person is-on' : 'wa-person'} onClick={() => setOpen(person.id)}>
                    <span className="wa-avatar" aria-hidden="true">{initials(chatTitle(person))}</span>
                    <span>
                      <strong>{chatTitle(person)}</strong>
                      <em>{person.businessNumber ? `${person.contactPhone} · Business number` : person.contactPhone}</em>
                      <p>{person.lastDirection === 'outbound' ? 'AIRO: ' : ''}{person.lastMessage || 'No message yet'}</p>
                    </span>
                  </button>
                )) : <p className="quiet wa-empty">No chat yet. Add a number, then message the chatbot from that number.</p>}
              </div>
              <CustomerThread active={active} messages={messages} loading={detail.loading && Boolean(open)} />
            </section>
          </div>
        ) : null}
      </State>
    </Page>
  );
}

function chatTitle(person) {
  return person.leadName || person.numberLabel || person.contactName;
}

const COUNTRY_CODES = [
  ['91', 'India +91'],
  ['1', 'United States / Canada +1'],
  ['44', 'United Kingdom +44'],
  ['971', 'United Arab Emirates +971'],
  ['966', 'Saudi Arabia +966'],
  ['974', 'Qatar +974'],
  ['965', 'Kuwait +965'],
  ['968', 'Oman +968'],
  ['973', 'Bahrain +973'],
  ['65', 'Singapore +65'],
  ['60', 'Malaysia +60'],
  ['61', 'Australia +61'],
  ['64', 'New Zealand +64'],
  ['27', 'South Africa +27'],
  ['977', 'Nepal +977'],
  ['880', 'Bangladesh +880'],
  ['94', 'Sri Lanka +94'],
  ['92', 'Pakistan +92'],
  ['49', 'Germany +49'],
  ['33', 'France +33'],
  ['39', 'Italy +39'],
  ['34', 'Spain +34'],
  ['31', 'Netherlands +31'],
  ['353', 'Ireland +353'],
  ['41', 'Switzerland +41'],
  ['852', 'Hong Kong +852'],
  ['86', 'China +86'],
  ['81', 'Japan +81'],
  ['82', 'South Korea +82'],
  ['62', 'Indonesia +62'],
  ['66', 'Thailand +66'],
  ['63', 'Philippines +63'],
  ['84', 'Vietnam +84'],
  ['234', 'Nigeria +234'],
  ['254', 'Kenya +254'],
  ['55', 'Brazil +55'],
  ['52', 'Mexico +52']
];

function withCountryCode(code, raw) {
  let digits = String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  const pastedCode = String(raw || '').trim().startsWith('+') || digits.length > 10;
  if (pastedCode && digits.startsWith(code)) digits = digits.slice(code.length).replace(/^0+/, '');
  return `${code}${digits}`;
}

function showPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? `+${digits}` : phone;
}

function BusinessNumbers({ numbers, reload }) {
  const { can } = useAuth();
  const manage = can('settings.manage');
  const [code, setCode] = useState('91');
  const [phone, setPhone] = useState('');
  const [label, setLabel] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const localDigits = phone.replace(/\D/g, '').replace(/^0+/, '');
  async function add(event) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api.post('/api/whatsapp/numbers', { phone: withCountryCode(code, phone), label: label.trim() });
      setPhone('');
      setLabel('');
      setMessage('Number added. A chat from this number is this business.');
      reload();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(id) {
    setMessage('');
    try {
      await api.del(`/api/whatsapp/numbers/${id}`);
      setMessage('Number removed.');
      reload();
    } catch (err) {
      setMessage(err.message);
    }
  }
  return (
    <section className="panel">
      <header><h2>Business numbers</h2></header>
      <p className="quiet">Add more than one. When that WhatsApp messages the chatbot, AIRO marks it as this business.</p>
      {numbers.length ? (
        <ul className="wa-numbers">
          {numbers.map((number) => (
            <li key={number.id}>
              <span><strong>{number.label || 'WhatsApp'}</strong><em>{showPhone(number.phone)}</em></span>
              {manage ? <button type="button" className="btn" onClick={() => remove(number.id)}>Remove</button> : null}
            </li>
          ))}
        </ul>
      ) : <p>No number added yet.</p>}
      {manage ? (
        <form className="filters" onSubmit={add}>
          <div className="phone-row">
            <select value={code} onChange={(event) => setCode(event.target.value)} aria-label="Country code">
              {COUNTRY_CODES.map(([value, name]) => <option key={value} value={value}>{name}</option>)}
            </select>
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="98765 43210" inputMode="tel" aria-label="WhatsApp number" required />
          </div>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Label, optional" aria-label="Number label" maxLength={80} />
          <button className="btn-primary" type="submit" disabled={saving || localDigits.length < 6}>{saving ? 'Adding…' : 'Add number'}</button>
        </form>
      ) : <p className="quiet">An Owner or Admin adds the numbers.</p>}
      {message ? <p>{message}</p> : null}
    </section>
  );
}

function CustomerThread({ active, messages, loading }) {
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, active?.id]);
  return (
    <div className="wa-thread">
      {active ? (
        <>
          <header>
            <span className="wa-avatar" aria-hidden="true">{initials(chatTitle(active))}</span>
            <div>
              <strong>{chatTitle(active)}</strong>
              <p className="quiet">{active.contactPhone}{active.businessNumber ? ' · Business number' : ''}{active.contactName && chatTitle(active) !== active.contactName ? ` · WhatsApp name ${active.contactName}` : ''}</p>
            </div>
            {active.leadId ? <Link className="btn" to={`/app/growth/leads/${active.leadId}`}>Open lead</Link> : <Badge value={active.status} />}
          </header>
          <MessageList messages={messages} name={active.contactName} endRef={endRef} />
        </>
      ) : (
        <p className="quiet wa-empty">{loading ? 'Opening chat…' : 'Select a person to read the chat.'}</p>
      )}
    </div>
  );
}

function MessageList({ messages, name, endRef }) {
  return (
    <div className="wa-bubbles">
      {messages.map((message) => (
        <article key={message.id} className={message.direction === 'outbound' ? 'wa-bubble out' : 'wa-bubble in'}>
          <b>{message.direction === 'outbound' ? 'AIRO' : name}</b>
          <span>{message.body}</span>
          <small>{when(message.createdAt)}</small>
        </article>
      ))}
      <div ref={endRef} />
    </div>
  );
}

export function LeadWhatsapp({ leadId }) {
  const { data, loading, error, reload } = useResource(leadId ? `/api/whatsapp/leads/${leadId}` : null);
  useWhatsappLive(reload, '/api/whatsapp/live');
  const threads = data?.threads || [];
  return (
    <section className="panel wa-span">
      <header><h2>WhatsApp</h2></header>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          threads.length ? (
            <div className="stack">
              {threads.map((thread) => (
                <div key={thread.conversation.id}>
                  <p className="quiet">{thread.conversation.contactPhone} · {thread.conversation.contactName}</p>
                  <div className="wa-embed">
                    <MessageList messages={thread.messages} name={thread.conversation.contactName} />
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="quiet">No WhatsApp conversation on {data.phone} yet.</p>
        ) : null}
      </State>
    </section>
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
