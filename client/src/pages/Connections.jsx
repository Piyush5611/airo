import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { inr, label, num, when } from '../format.js';
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
  const meta = provider.providerKey === 'meta_ads';

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
      <p className="quiet">{meta ? 'Paste the Meta access token and the ad account id, like act_123456789. Meta checks both before the account connects.' : 'The key is checked with the provider before it is saved. A wrong key shows Wrong API and does not connect.'}</p>
      <label className="stack-field">{nexcall ? 'x-api-key' : 'API key or access token'}
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" required minLength={8} />
      </label>
      {nexcall ? null : (
        <label className="stack-field">Account id
          <input value={accountId} onChange={(event) => setAccountId(event.target.value)} placeholder={meta ? 'act_123456789' : 'Optional account or customer id'} required={meta} />
        </label>
      )}
      {meta ? null : (
        <label className="stack-field">Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={nexcall ? 'Blank uses the W-Caller default' : 'Optional'} />
        </label>
      )}
      <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Checking' : 'Save API key'}</button>
      {error ? <p className="delta-down">{error}</p> : null}
    </form>
  );
}

function money(value, currency) {
  if (value == null || value === '') return '—';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  if (!currency || currency === 'INR') return inr(amount);
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${num(amount)}`;
  }
}

function total(rows, key) {
  const values = rows.map((row) => row.fields?.[key]).filter((value) => value != null && value !== '');
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

function MetaAdsManager({ id, data, canManage, reload }) {
  const campaigns = (data.records || []).filter((row) => row.type === 'campaign' && row.origin === 'api');
  const adsets = (data.records || []).filter((row) => row.type === 'adset' && row.origin === 'api');
  const ads = (data.records || []).filter((row) => row.type === 'ad' && row.origin === 'api');
  const currency = campaigns.find((row) => row.fields?.currency)?.fields.currency || 'INR';
  const failed = data.jobs?.[0]?.status === 'failed' ? data.jobs[0].summary : '';
  const [view, setView] = useState('Campaigns');
  const [name, setName] = useState('');
  const [objective, setObjective] = useState('OUTCOME_LEADS');
  const [dailyBudget, setDailyBudget] = useState('');
  const [pageId, setPageId] = useState('');
  const [pages, setPages] = useState([]);
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imageName, setImageName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const publishMode = useRef(false);
  const steps = ['Campaign', 'Ad set', 'Ad', 'Review'];

  useEffect(() => {
    if (!canManage) return undefined;
    let active = true;
    api.get(`/api/connections/${id}/meta/pages`)
      .then((result) => {
        if (!active) return;
        const next = result?.pages || [];
        setPages(next);
        setPageId(next[0]?.id || '');
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [id, canManage]);

  function onImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 2000000) {
      setError('Upload a JPG or PNG under 2 MB.');
      setImageBase64('');
      setImageName('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImageBase64(String(reader.result || ''));
      setImageName(file.name);
      setError('');
    };
    reader.readAsDataURL(file);
  }

  function nextStep() {
    if (step === 0 && name.trim().length < 2) {
      setError('Enter a campaign name.');
      return;
    }
    if (step === 1 && !(Number(dailyBudget) >= 1)) {
      setError('Enter a daily budget.');
      return;
    }
    if (step === 2) {
      if (!pageId) { setError('Choose a Facebook Page.'); return; }
      if (headline.trim().length < 2) { setError('Enter a headline.'); return; }
      if (message.trim().length < 2) { setError('Enter the ad text.'); return; }
      if (!/^https:\/\//i.test(link.trim())) { setError('The website link must start with https.'); return; }
      if (!imageBase64) { setError('Upload a JPG or PNG image.'); return; }
    }
    setError('');
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function createAd(event) {
    event.preventDefault();
    if (step < steps.length - 1) {
      nextStep();
      return;
    }
    if (!imageBase64) {
      setError('Upload a JPG or PNG image.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.post(`/api/connections/${id}/meta/ads`, {
        name,
        objective,
        dailyBudget: Number(dailyBudget),
        pageId,
        headline,
        message,
        link,
        imageBase64,
        country: 'IN',
        publish: publishMode.current
      });
      setName('');
      setHeadline('');
      setMessage('');
      setLink('');
      setDailyBudget('');
      setImageBase64('');
      setImageName('');
      setStep(0);
      setNotice(saved?.notice || (publishMode.current ? 'Ad published on Meta.' : 'Ad saved on Meta as paused.'));
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setCampaignStatus(campaignId, next) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.post(`/api/connections/${id}/meta/status`, { campaignId, status: next });
      setNotice(saved?.notice || 'Campaign updated in Meta Ads.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const rows = view === 'Ad sets' ? adsets : view === 'Ads' ? ads : campaigns;

  return (
    <div className="stack">
      {failed ? <p className="delta-down">{failed}</p> : data.jobs?.[0]?.summary ? <p className="quiet">{data.jobs[0].summary}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {error ? <p className="delta-down">{error}</p> : null}
      <div className="metric-strip">
        <div className="metric"><span>Spend, 30 days</span><strong>{money(total(campaigns, 'spend'), currency)}</strong></div>
        <div className="metric"><span>Impressions</span><strong>{total(campaigns, 'impressions') == null ? '—' : num(total(campaigns, 'impressions'))}</strong></div>
        <div className="metric"><span>Clicks</span><strong>{total(campaigns, 'clicks') == null ? '—' : num(total(campaigns, 'clicks'))}</strong></div>
        <div className="metric"><span>Leads</span><strong>{total(campaigns, 'leads') == null ? '—' : num(total(campaigns, 'leads'))}</strong></div>
      </div>
      {canManage ? (
        <form className="form-grid panel" onSubmit={createAd}>
          <h2>Create ad</h2>
          <div className="ad-steps" aria-label="Ad steps">
            {steps.map((item, index) => (
              <span key={item} className={index === step ? 'is-on' : index < step ? 'is-done' : ''}>
                <b>{index + 1}</b>{item}
              </span>
            ))}
          </div>
          {step === 0 ? (
            <>
              <p className="quiet">Choose the goal. This is created as a housing campaign, the same category Meta uses for real estate.</p>
              <label className="stack-field">Campaign name
                <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={180} />
              </label>
              <label className="stack-field">Objective
                <select value={objective} onChange={(event) => setObjective(event.target.value)}>
                  <option value="OUTCOME_LEADS">Leads</option>
                  <option value="OUTCOME_TRAFFIC">Traffic</option>
                  <option value="OUTCOME_AWARENESS">Awareness</option>
                  <option value="OUTCOME_SALES">Sales</option>
                </select>
              </label>
            </>
          ) : null}
          {step === 1 ? (
            <>
              <p className="quiet">Set the daily budget and location. Housing ads target the country, not age or interests.</p>
              <label className="stack-field">Daily budget
                <input type="number" min="1" step="1" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} />
              </label>
              <label className="stack-field">Location
                <input value="India" readOnly />
              </label>
            </>
          ) : null}
          {step === 2 ? (
            <>
              <p className="quiet">Add the Facebook Page, image, and text. For Leads, the website link is the privacy policy on the lead form.</p>
              <label className="stack-field">Facebook Page
                <select value={pageId} onChange={(event) => setPageId(event.target.value)}>
                  {pages.length ? null : <option value="">No page returned</option>}
                  {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
                </select>
              </label>
              <label className="stack-field">Headline
                <input value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={80} />
              </label>
              <label className="stack-field">Ad text
                <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} />
              </label>
              <label className="stack-field">Website
                <input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" />
              </label>
              <label className="stack-field">Image
                <input type="file" accept="image/jpeg,image/png" onChange={onImage} />
              </label>
              {imageName ? <p className="quiet">{imageName}</p> : null}
            </>
          ) : null}
          {step === 3 ? (
            <>
              <p className="quiet">Check the ad, then save it paused or publish it on Meta.</p>
              <dl className="review-list">
                <div><dt>Campaign</dt><dd>{name}</dd></div>
                <div><dt>Objective</dt><dd>{label(objective.replace('OUTCOME_', '').toLowerCase())}</dd></div>
                <div><dt>Daily budget</dt><dd>{money(dailyBudget, currency)}</dd></div>
                <div><dt>Location</dt><dd>India</dd></div>
                <div><dt>Page</dt><dd>{pages.find((page) => page.id === pageId)?.name || '—'}</dd></div>
                <div><dt>Headline</dt><dd>{headline}</dd></div>
                <div><dt>Text</dt><dd>{message}</dd></div>
                <div><dt>Website</dt><dd>{link}</dd></div>
                <div><dt>Image</dt><dd>{imageName || '—'}</dd></div>
              </dl>
            </>
          ) : null}
          <div className="page-actions">
            {step > 0 ? <button className="btn" type="button" disabled={busy} onClick={() => { setError(''); setStep((current) => current - 1); }}>Back</button> : null}
            {step < steps.length - 1 ? <button className="btn-primary" type="button" onClick={nextStep}>Next</button> : null}
            {step === steps.length - 1 ? (
              <>
                <button className="btn" type="submit" disabled={busy || !pageId} onClick={() => { publishMode.current = false; }}>Save paused</button>
                <button className="btn-primary" type="submit" disabled={busy || !pageId} onClick={() => { publishMode.current = true; }}>{busy ? 'Saving' : 'Publish'}</button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
      <div className="tabs" role="tablist">
        {['Campaigns', 'Ad sets', 'Ads'].map((item) => (
          <button key={item} type="button" className={view === item ? 'is-on' : ''} onClick={() => setView(item)}>{item}</button>
        ))}
      </div>
      {rows.length ? (
        <Table columns={view === 'Campaigns' ? [
          { key: 'name', label: 'Campaign' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={String(row.fields?.status || '').toLowerCase()} /> },
          { key: 'objective', label: 'Objective', render: (row) => label(String(row.fields?.objective || '').replace('OUTCOME_', '').toLowerCase()) },
          { key: 'budget', label: 'Budget', render: (row) => money(row.fields?.budget, row.fields?.currency) },
          { key: 'spend', label: 'Spend', render: (row) => money(row.fields?.spend, row.fields?.currency) },
          { key: 'clicks', label: 'Clicks', render: (row) => row.fields?.clicks == null || row.fields?.clicks === '' ? '—' : num(row.fields.clicks) },
          { key: 'leads', label: 'Leads', render: (row) => row.fields?.leads == null || row.fields?.leads === '' ? '—' : num(row.fields.leads) },
          { key: 'action', label: '', render: (row) => canManage && (row.fields?.status === 'ACTIVE' || row.fields?.status === 'PAUSED') ? (
            <button className="btn" type="button" disabled={busy} onClick={() => setCampaignStatus(row.externalId, row.fields.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}>
              {row.fields.status === 'ACTIVE' ? 'Pause' : 'Turn on'}
            </button>
          ) : null }
        ] : [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={String(row.fields?.status || '').toLowerCase()} /> },
          ...(view === 'Ad sets' ? [{ key: 'budget', label: 'Budget', render: (row) => money(row.fields?.budget, row.fields?.currency) }] : [])
        ]} rows={rows} />
      ) : (
        <div className="empty">
          <strong>No {view.toLowerCase()} from Meta.</strong>
          <p className="quiet">Sync reads this account from Meta. Sample campaigns are not listed here.</p>
        </div>
      )}
    </div>
  );
}

export function ConnectionDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(id ? `/api/connections/${id}` : null);
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const meta = data?.providerKey === 'meta_ads';
  const records = meta ? (data?.records || []).filter((row) => row.type !== 'campaign' && row.type !== 'adset' && row.type !== 'ad') : (data?.records || []);
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
      lede={meta ? 'Create the campaign, ad set, and ad here, then publish them to the connected Meta account.' : 'Only records returned by this tool\'s API or posted to its webhook.'}
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
            {meta ? <MetaAdsManager id={id} data={data} canManage={can('connections.manage')} reload={reload} /> : null}
            {!meta && data.webhookPath ? (
              <section className="panel">
                <h2>Webhook</h2>
                <p className="quiet">POST JSON here. Each object from the webhook is listed below.</p>
                <p><code>{`${window.location.origin}${data.webhookPath}`}</code></p>
              </section>
            ) : null}
            {!meta && records.length ? (
              <Table columns={[
                { key: 'origin', label: 'Source', render: (row) => label(row.origin) },
                { key: 'type', label: 'Type', render: (row) => label(row.type) },
                { key: 'name', label: 'Name' },
                ...fieldKeys.map((key) => ({ key, label: label(key), render: (row) => row.fields?.[key] || '—' }))
              ]} rows={records} />
            ) : null}
            {!meta && !records.length ? (
              <div className="empty">
                <strong>No API or webhook records.</strong>
                <p className="quiet">This page stays empty until {data.name} returns data. Sample campaigns, leads, and spend are not listed here.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </State>
    </Page>
  );
}
