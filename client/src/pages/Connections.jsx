import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { label, when } from '../format.js';
import { Badge, Page, State, Subnav, Table, useSection } from '../ui.jsx';

const CONNECTION_SECTIONS = ['Advertising', 'Real Estate Portals', 'Communication', 'Calling', 'CRM', 'Analytics', 'Developer / API'];
const CATEGORY_KEY = {
  Advertising: 'advertising',
  'Real Estate Portals': 'portals',
  Communication: 'communication',
  Calling: 'calling',
  CRM: 'crm',
  Analytics: 'analytics',
  'Developer / API': 'developer'
};
export function Connections() {
  const { data, loading, error, reload } = useResource('/api/connections');
  const { can } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState('');
  const [form, setForm] = useState(null);
  const [section, setSection] = useSection(CONNECTION_SECTIONS);

  return (
    <Page eyebrow="Connections" title="Connections" lede="Open a tool to see only the records its API or webhook has sent. Sample rows are not shown.">
      <Subnav items={CONNECTION_SECTIONS} value={section} onChange={(next) => { setSection(next); setForm(null); }} />
      <State loading={loading} error={error} onRetry={reload}>
        {message ? <p>{message}</p> : null}
        <div className="stack">
          {data?.categories.filter((category) => category.key === CATEGORY_KEY[section]).map((category) => (
            <section className="panel" key={category.key}>
              <header>
                <h2>{category.name}</h2>
                <p>{category.purpose}</p>
              </header>
              <Table
                columns={[
                  { key: 'name', label: 'Provider', render: (row) => row.connection?.linked ? <Link to={`/app/connections/${row.connection.id}`}>{row.name}</Link> : row.name },
                  { key: 'description', label: 'Becomes' },
                  { key: 'state', label: 'Status', render: (row) => <Badge value={row.connection?.linked ? 'connected' : 'not_connected'} /> },
                  { key: 'api', label: 'API', render: (row) => row.providerKey === 'whatsapp' ? 'Platform bot' : row.connection?.linked ? `Live ${row.connection.apiKeyPreview}` : 'Not saved' },
                  { key: 'action', label: '', render: (row) => can('connections.manage') ? <button className="btn" onClick={() => { setForm(row); setMessage(''); }}>{row.providerKey === 'whatsapp' ? 'API' : row.connection?.linked ? 'Update API' : 'Connect API'}</button> : null }
                ]}
                rows={category.providers}
              />
              {form && category.providers.some((row) => row.providerKey === form.providerKey) ? (
                <ProviderApiForm provider={form} onDone={(notice, connectionId) => { setMessage(notice); setForm(null); window.dispatchEvent(new Event('airo:connections')); if (connectionId) navigate(`/app/connections/${connectionId}`); else reload(); }} />
              ) : null}
            </section>
          ))}
        </div>
      </State>
    </Page>
  );
}

function ProviderApiForm({ provider, onDone }) {
  const [apiKey, setApiKey] = useState('');
  const [accountId, setAccountId] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nexcall = provider.providerKey === 'nexcall';

  if (provider.providerKey === 'whatsapp') {
    return (
      <section className="panel">
        <h2>WhatsApp API</h2>
        <p>This workspace uses the shared AIRO chatbot. Super Admin or Developer/Admin connects that API on the platform. A business does not store its own WhatsApp key here.</p>
      </section>
    );
  }

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api.post('/api/connections/api', {
        providerKey: provider.providerKey,
        accountLabel: provider.name,
        apiKey,
        accountId: nexcall ? undefined : accountId,
        baseUrl: baseUrl || undefined
      });
      setApiKey('');
      onDone(saved.notice, saved.linked ? saved.id : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-grid panel" onSubmit={save}>
      <h2>{provider.connection?.linked ? 'Update' : 'Connect'} {provider.name} API</h2>
      <p className="quiet">The key is checked with the provider before it is saved. A wrong key shows Wrong API and does not connect.</p>
      <label className="stack-field">{nexcall ? 'x-api-key' : 'API key or access token'}
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required minLength={8} />
      </label>
      {nexcall ? null : (
        <label className="stack-field">Account id
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder="Optional account or customer id" />
        </label>
      )}
      <label className="stack-field">Base URL
        <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={nexcall ? 'Blank uses the W-Caller default' : 'Optional'} />
      </label>
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Checking' : 'Save API key'}</button>
      {error ? <p className="delta-down">{error}</p> : null}
    </form>
  );
}

export function ConnectionDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(id ? `/api/connections/${id}` : null);
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const records = data?.records || [];
  const fieldKeys = [...new Set(records.flatMap((row) => Object.keys(row.fields || {})))].slice(0, 6);

  async function act(path) {
    setBusy(true);
    try {
      await api.post(path);
      window.dispatchEvent(new Event('airo:connections'));
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page
      eyebrow={data ? `Connections / ${label(data.category)}` : 'Connections'}
      title={data?.name || 'Connection'}
      lede="Only records returned by this tool's API or posted to its webhook."
      actions={can('connections.manage') && data ? (
        <>
          <button className="btn" disabled={busy} onClick={() => act(`/api/connections/${id}/sync`)}>Sync</button>
          <button className="btn-ghost" disabled={busy} onClick={() => act(`/api/connections/${id}/disconnect`)}>Disconnect</button>
        </>
      ) : null}
    >
      <State loading={loading} error={error} onRetry={reload}>
        {data && !data.linked ? <Navigate to="/app/connections" replace /> : null}
        {data?.linked ? (
          <div className="stack">
            <p><Badge value={data.status} /> <span className="quiet">Last sync {when(data.lastSyncAt)}.</span></p>
            {data.webhookPath ? (
              <section className="panel">
                <h2>Webhook</h2>
                <p className="quiet">POST JSON here. Each object from the webhook is listed below.</p>
                <p><code>{`${window.location.origin}${data.webhookPath}`}</code></p>
              </section>
            ) : null}
            {records.length ? (
              <Table columns={[
                { key: 'origin', label: 'Source', render: (row) => label(row.origin) },
                { key: 'type', label: 'Type', render: (row) => label(row.type) },
                { key: 'name', label: 'Name' },
                ...fieldKeys.map((key) => ({ key, label: label(key), render: (row) => row.fields?.[key] || '—' }))
              ]} rows={records} />
            ) : (
              <div className="empty">
                <strong>No API or webhook records.</strong>
                <p className="quiet">This page stays empty until {data.name} returns data. Sample campaigns, leads, and spend are not listed here.</p>
              </div>
            )}
          </div>
        ) : null}
      </State>
    </Page>
  );
}
