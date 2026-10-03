import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { inr, label, num, when } from '../format.js';
import { Badge, LineChart, Page, State, Subnav, Table, useSection } from '../ui.jsx';

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
  const [params, setParams] = useSearchParams();
  const oauthProvider = params.get('google') ? 'google' : params.get('meta') ? 'meta' : '';
  const oauthStep = oauthProvider ? params.get(oauthProvider) : '';
  const oauthReason = params.get('reason');

  function clearOAuth() {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('google');
      next.delete('meta');
      next.delete('reason');
      return next;
    }, { replace: true });
  }

  return (
    <Page eyebrow="Connections" title="Connections" lede="Open a tool to see only the records its API or webhook has sent. Sample rows are not shown.">
      <Subnav items={CONNECTION_SECTIONS} value={section} onChange={(next) => { setSection(next); setForm(null); }} />
      <State loading={loading} error={error} onRetry={reload}>
        {message ? <p>{message}</p> : null}
        {oauthStep === 'error' ? <p className="delta-down">{oauthReason || 'Sign-in failed.'}</p> : null}
        {oauthStep === 'pick' && can('connections.manage') ? (
          <OAuthAccountPicker
            key={oauthProvider}
            provider={oauthProvider}
            onCancel={clearOAuth}
            onDone={(notice, connectionId) => {
              clearOAuth();
              setMessage(notice);
              window.dispatchEvent(new Event('airo:connections'));
              if (connectionId) navigate(`/app/connections/${connectionId}`); else reload();
            }}
          />
        ) : null}
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
  const [manual, setManual] = useState(false);
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

  if (provider.providerKey === 'google_ads') {
    return <OAuthConnect provider="google" linked={Boolean(provider.connection?.linked)} />;
  }

  if (meta && !manual) {
    return (
      <div className="stack">
        <OAuthConnect provider="meta" linked={Boolean(provider.connection?.linked)} />
        <button className="btn-ghost" type="button" onClick={() => setManual(true)}>Paste an access token instead</button>
      </div>
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

function customerLabel(id) {
  const raw = String(id || '');
  return raw.length === 10 ? `${raw.slice(0, 3)}-${raw.slice(3, 6)}-${raw.slice(6)}` : raw;
}

const OAUTH_PROVIDERS = {
  google: {
    brand: 'Google',
    product: 'Google Ads',
    start: '/api/connections/google/start',
    accounts: '/api/connections/google/accounts',
    save: '/api/connections/google/account',
    field: 'customerId',
    help: 'Sign in with the Google account that can open your Google Ads account. Google asks you to allow AIRO, then you pick the ad account here.',
    option: (account) => `${account.name} · ${customerLabel(account.id)}${account.currency ? ` · ${account.currency}` : ''}${account.manager ? ` · via ${account.manager}` : ''}${account.test ? ' · test' : ''}`
  },
  meta: {
    brand: 'Facebook',
    product: 'Meta Ads',
    start: '/api/connections/meta/start',
    accounts: '/api/connections/meta/accounts',
    save: '/api/connections/meta/account',
    field: 'accountId',
    help: 'Sign in with the Facebook account that manages your ad account and Page. Facebook asks you to allow AIRO, then you pick the ad account here.',
    option: (account) => `${account.name} · ${account.id}${account.currency ? ` · ${account.currency}` : ''}${account.business ? ` · ${account.business}` : ''}${account.active ? '' : ' · not active'}`
  }
};

function OAuthConnect({ provider, linked }) {
  const setup = OAUTH_PROVIDERS[provider];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError('');
    try {
      const result = await api.post(setup.start, {});
      window.location.assign(result.url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <section className="panel form-grid">
      <h2>{linked ? `Change ${setup.product} account` : `Connect ${setup.product}`}</h2>
      <p className="quiet">{setup.help}</p>
      <button className="btn-primary" type="button" disabled={busy} onClick={start}>{busy ? `Opening ${setup.brand}` : `Connect with ${setup.brand}`}</button>
      {error ? <p className="delta-down">{error}</p> : null}
    </section>
  );
}

function OAuthAccountPicker({ provider, onDone, onCancel }) {
  const setup = OAUTH_PROVIDERS[provider];
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get(setup.accounts)
      .then((result) => {
        if (!active) return;
        const rows = result?.accounts || [];
        setAccounts(rows);
        setNote(result?.note || '');
        setChoice(rows[0]?.id || '');
      })
      .catch((err) => { if (active) setNote(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [setup.accounts]);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api.post(setup.save, { [setup.field]: choice });
      onDone(saved.notice, saved.linked ? saved.id : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={save}>
      <h2>Choose the {setup.product} account</h2>
      {loading ? <p className="quiet">Reading the accounts this {setup.brand} login can open…</p> : null}
      {!loading && accounts.length ? (
        <label className="stack-field">Ad account
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            {accounts.map((account) => <option key={account.id} value={account.id}>{setup.option(account)}</option>)}
          </select>
        </label>
      ) : null}
      {!loading && !accounts.length ? <p className="delta-down">{note || `${setup.brand} returned no ad accounts for this login.`}</p> : null}
      <div className="page-actions">
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={busy || !choice}>{busy ? 'Checking' : 'Connect this account'}</button>
      </div>
      {error ? <p className="delta-down">{error}</p> : null}
    </form>
  );
}

function Switch({ checked, onChange, label: text, hint }) {
  return (
    <div className="switch-row">
      <span><strong>{text}</strong>{hint ? <em>{hint}</em> : null}</span>
      <button type="button" className={checked ? 'toggle is-on' : 'toggle'} aria-pressed={checked} onClick={() => onChange(!checked)}>{checked ? 'On' : 'Off'}</button>
    </div>
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
  const [pageNote, setPageNote] = useState('');
  const [headline, setHeadline] = useState('');
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [imageBase64, setImageBase64] = useState('');
  const [imageName, setImageName] = useState('');
  const [budgetLevel, setBudgetLevel] = useState('campaign');
  const [budgetMode, setBudgetMode] = useState('daily');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [advantageAudience, setAdvantageAudience] = useState(true);
  const [specialCategory, setSpecialCategory] = useState('none');
  const [ageMin, setAgeMin] = useState('18');
  const [ageMax, setAgeMax] = useState('65');
  const [gender, setGender] = useState('all');
  const [interests, setInterests] = useState([]);
  const [interestQuery, setInterestQuery] = useState('');
  const [interestHits, setInterestHits] = useState([]);
  const [locationMode, setLocationMode] = useState('india');
  const [cities, setCities] = useState([]);
  const [cityQuery, setCityQuery] = useState('');
  const [cityHits, setCityHits] = useState([]);
  const [cityNote, setCityNote] = useState('');
  const [locales, setLocales] = useState([]);
  const [localeQuery, setLocaleQuery] = useState('');
  const [localeHits, setLocaleHits] = useState([]);
  const [placements, setPlacements] = useState('advantage');
  const [feeds, setFeeds] = useState(['facebook_feed', 'instagram_feed', 'facebook_story', 'instagram_story']);
  const [conversion, setConversion] = useState('instant_form');
  const [pixels, setPixels] = useState([]);
  const [pixelId, setPixelId] = useState('');
  const [profiles, setProfiles] = useState([]);
  const [instagramId, setInstagramId] = useState('');
  const [dynamicCreative, setDynamicCreative] = useState(false);
  const [abTest, setAbTest] = useState(false);
  const [creativeTest, setCreativeTest] = useState(false);
  const [headlineB, setHeadlineB] = useState('');
  const [messageB, setMessageB] = useState('');
  const [cta, setCta] = useState('LEARN_MORE');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(null);
  const publishMode = useRef(false);
  const steps = ['Campaign', 'Ad set', 'Ad', 'Review'];

  function loadIdentity() {
    api.get(`/api/connections/${id}/meta/pages`)
      .then((result) => {
        const next = result?.pages || [];
        setPages(next);
        setPageNote(result?.note || '');
        setPageId((current) => current || next[0]?.id || '');
      })
      .catch((err) => setError(err.message));
    api.get(`/api/connections/${id}/meta/instagram`)
      .then((result) => {
        const next = result?.profiles || [];
        setProfiles(next);
        setInstagramId((current) => current || next[0]?.id || '');
      })
      .catch(() => setProfiles([]));
    api.get(`/api/connections/${id}/meta/pixels`)
      .then((result) => setPixels(result?.pixels || []))
      .catch(() => setPixels([]));
  }

  async function connectPages() {
    setBusy(true);
    setError('');
    try {
      const result = await api.post(`/api/connections/${id}/meta/pages`, {});
      const next = result?.pages || [];
      setPages(next);
      setPageNote(result?.note || '');
      setPageId((current) => current || next[0]?.id || '');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!canManage) return undefined;
    loadIdentity();
    return undefined;
  }, [id, canManage]);

  useEffect(() => {
    if (!canManage || cityQuery.trim().length < 2) {
      setCityHits([]);
      setCityNote('');
      return undefined;
    }
    const timer = setTimeout(() => {
      setCityNote('Searching…');
      api.get(`/api/connections/${id}/meta/audience?kind=city&q=${encodeURIComponent(cityQuery.trim())}`)
        .then((result) => {
          const rows = result?.results || [];
          setCityHits(rows);
          setCityNote(rows.length ? '' : (result?.note || 'No city found.'));
        })
        .catch((err) => {
          setCityHits([]);
          setCityNote(err.message);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [id, canManage, cityQuery]);

  useEffect(() => {
    if (!canManage || interestQuery.trim().length < 2) {
      setInterestHits([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.get(`/api/connections/${id}/meta/audience?kind=interest&q=${encodeURIComponent(interestQuery.trim())}`)
        .then((result) => setInterestHits(result?.results || []))
        .catch(() => setInterestHits([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [id, canManage, interestQuery]);

  useEffect(() => {
    if (!canManage || localeQuery.trim().length < 2) {
      setLocaleHits([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.get(`/api/connections/${id}/meta/audience?kind=locale&q=${encodeURIComponent(localeQuery.trim())}`)
        .then((result) => setLocaleHits(result?.results || []))
        .catch(() => setLocaleHits([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [id, canManage, localeQuery]);

  useEffect(() => {
    if (!canManage || !pageId) return undefined;
    let active = true;
    api.get(`/api/connections/${id}/meta/instagram?pageId=${pageId}`)
      .then((result) => {
        if (!active) return;
        const next = result?.profiles || [];
        if (!next.length) return;
        setProfiles(next);
        setInstagramId((current) => current || next[0].id);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [id, canManage, pageId]);

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
    if (step === 1 && budgetMode === 'lifetime' && !endDate) {
      setError('A lifetime budget needs an end date.');
      return;
    }
    if (step === 1 && placements === 'manual' && !feeds.length) {
      setError('Choose at least one placement.');
      return;
    }
    if (step === 1 && locationMode === 'cities' && !cities.length) {
      setError('Add at least one city, or choose all of India.');
      return;
    }
    if (step === 1 && !(Number(ageMin) >= 13 && Number(ageMax) <= 65 && Number(ageMin) <= Number(ageMax))) {
      setError('Set an age range from 13 to 65.');
      return;
    }
    if (step === 2) {
      if (!pageId) { setError('Choose a Facebook Page.'); return; }
      if (headline.trim().length < 2) { setError('Enter a headline.'); return; }
      if (message.trim().length < 2) { setError('Enter the ad text.'); return; }
      if (!/^https:\/\//i.test(link.trim())) { setError('The website link must start with https.'); return; }
      if (!imageBase64) { setError('Upload a JPG or PNG image.'); return; }
      if (creativeTest && headlineB.trim().length < 2) { setError('Enter the second headline for the test.'); return; }
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
        publish: publishMode.current,
        budgetLevel,
        budgetMode,
        startDate,
        endDate,
        advantageAudience,
        specialCategory,
        ageMin: Number(ageMin),
        ageMax: Number(ageMax),
        gender,
        interests,
        locations: locationMode === 'cities' ? cities : [],
        locales,
        placements,
        placementFeeds: feeds,
        conversion: objective === 'OUTCOME_LEADS' ? conversion : 'website',
        pixelId,
        instagramId,
        dynamicCreative,
        abTest,
        creativeTest,
        headlineB,
        messageB,
        cta
      });
      setName('');
      setHeadline('');
      setMessage('');
      setLink('');
      setDailyBudget('');
      setImageBase64('');
      setImageName('');
      setHeadlineB('');
      setMessageB('');
      setStep(0);
      setNotice(saved?.notice || (publishMode.current ? 'Ad published on Meta.' : 'Ad saved on Meta as paused.'));
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.post(`/api/connections/${id}/meta/edit`, {
        campaignId: editing.id,
        name: editing.name,
        dailyBudget: Number(editing.budget) >= 1 ? Number(editing.budget) : undefined,
        status: editing.status
      });
      setEditing(null);
      setNotice(saved?.notice || 'Campaign updated in Meta.');
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

  const pageName = pages.find((page) => page.id === pageId)?.name || '—';
  const instagramName = profiles.find((profile) => profile.id === instagramId)?.name || 'Not connected';
  const setup = [
    ['Campaign', name.trim().length > 1],
    ['Budget and schedule', Number(dailyBudget) >= 1],
    ['Audience', true],
    ['Identity', Boolean(pageId)],
    ['Ad creative', Boolean(imageBase64 && headline.trim() && message.trim())],
    ['Website', /^https:\/\//i.test(link.trim())]
  ];
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
              <label className="stack-field">Campaign name
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={180} />
              </label>
              <label className="stack-field">Objective
                <select value={objective} onChange={(event) => setObjective(event.target.value)}>
                  <option value="OUTCOME_LEADS">Leads</option>
                  <option value="OUTCOME_TRAFFIC">Traffic</option>
                  <option value="OUTCOME_AWARENESS">Awareness</option>
                  <option value="OUTCOME_SALES">Sales</option>
                </select>
              </label>
              <label className="stack-field">Special ad category
                <select value={specialCategory} onChange={(event) => setSpecialCategory(event.target.value)}>
                  <option value="none">None</option>
                  <option value="HOUSING">Housing</option>
                  <option value="EMPLOYMENT">Employment</option>
                  <option value="CREDIT">Credit</option>
                  <option value="ISSUES_ELECTIONS_POLITICS">Social issues, elections or politics</option>
                </select>
              </label>
              <Switch checked={abTest} onChange={setAbTest} label="A/B test" hint="Creates two ad sets and splits the budget. One uses Advantage+ audience, the other does not." />
            </>
          ) : null}
          {step === 1 ? (
            <>
              {objective === 'OUTCOME_LEADS' ? (
                <label className="stack-field">Conversion
                  <select value={conversion} onChange={(event) => setConversion(event.target.value)}>
                    <option value="instant_messenger">Instant forms and Messenger</option>
                    <option value="website_forms">Website and instant forms</option>
                    <option value="website_calls">Website and calls</option>
                    <option value="instant_form">Instant form</option>
                    <option value="website">Website</option>
                    <option value="messenger">Messenger</option>
                    <option value="calls">Calls</option>
                  </select>
                </label>
              ) : <p className="quiet">Conversion location follows the objective. Traffic and sales go to the website. Awareness is for reach.</p>}
              <h3>Budget and schedule</h3>
              <label className="stack-field">Budget belongs to
                <select value={budgetLevel} onChange={(event) => setBudgetLevel(event.target.value)}>
                  <option value="campaign">Advantage+ campaign budget</option>
                  <option value="adset">Ad set budget</option>
                </select>
              </label>
              <label className="stack-field">Budget type
                <select value={budgetMode} onChange={(event) => setBudgetMode(event.target.value)}>
                  <option value="daily">Daily</option>
                  <option value="lifetime">Lifetime</option>
                </select>
              </label>
              <label className="stack-field">{budgetMode === 'lifetime' ? 'Lifetime budget' : 'Daily budget'}
                <input type="number" min="1" step="1" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} />
              </label>
              <label className="stack-field">Start
                <input type="datetime-local" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label className="stack-field">End
                <input type="datetime-local" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <h3>Audience</h3>
              <Switch checked={advantageAudience} onChange={setAdvantageAudience} label="Advantage+ audience" hint="On lets Meta reach people beyond the cities you pick. Off keeps only those cities." />
              <label className="stack-field">Location
                <select value={locationMode} onChange={(event) => setLocationMode(event.target.value)}>
                  <option value="india">All of India</option>
                  <option value="cities">Specific cities</option>
                </select>
              </label>
              {locationMode === 'cities' ? (
                <>
                  <label className="stack-field">Search city
                    <input value={cityQuery} onChange={(event) => setCityQuery(event.target.value)} placeholder="Mumbai, Pune, Jaipur" />
                  </label>
                  {cityHits.length ? (
                    <ul className="pick-results">
                      {cityHits.map((hit) => (
                        <li key={hit.key}>
                          <button type="button" className="btn" onClick={() => {
                            setCities((current) => current.some((item) => item.key === hit.key) ? current : [...current, { ...hit, radiusMode: 'radius', radius: 25 }]);
                            setCityQuery('');
                            setCityHits([]);
                            setCityNote('');
                          }}>{hit.name}{hit.region ? `, ${hit.region}` : ''}</button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {cityNote ? <p className="quiet">{cityNote}</p> : null}
                  {cities.map((city) => (
                    <div key={city.key} className="city-card">
                      <div className="pick-chip">
                        <span>{city.name}{city.region ? `, ${city.region}` : ''}{city.radiusMode === 'city' ? '' : ` + ${city.radius} km`}</span>
                        <button type="button" className="btn" onClick={() => setCities((current) => current.filter((item) => item.key !== city.key))}>Remove</button>
                      </div>
                      <label className="stack-field">Area
                        <select value={city.radiusMode || 'radius'} onChange={(event) => setCities((current) => current.map((item) => item.key === city.key ? { ...item, radiusMode: event.target.value, radius: item.radius || 25 } : item))}>
                          <option value="city">Current city only</option>
                          <option value="radius">Cities within radius</option>
                        </select>
                      </label>
                      {city.radiusMode !== 'city' ? (
                        <label className="radius-row">
                          <input className="radius-slider" type="range" min="17" max="80" value={city.radius || 25} onChange={(event) => setCities((current) => current.map((item) => item.key === city.key ? { ...item, radius: Number(event.target.value) } : item))} aria-label={`${city.name} radius`} />
                          <input type="number" min="17" max="80" value={city.radius || 25} onChange={(event) => setCities((current) => current.map((item) => item.key === city.key ? { ...item, radius: Math.min(80, Math.max(17, Number(event.target.value) || 17)) } : item))} />
                          <span>km</span>
                        </label>
                      ) : null}
                    </div>
                  ))}
                </>
              ) : null}
              <label className="stack-field">Age from
                <input type="number" min="13" max="65" value={ageMin} onChange={(event) => setAgeMin(event.target.value)} />
              </label>
              <label className="stack-field">Age to
                <input type="number" min="13" max="65" value={ageMax} onChange={(event) => setAgeMax(event.target.value)} />
              </label>
              <label className="stack-field">Gender
                <select value={gender} onChange={(event) => setGender(event.target.value)}>
                  <option value="all">All</option>
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                </select>
              </label>
              <label className="stack-field">Detailed targeting
                <input value={interestQuery} onChange={(event) => setInterestQuery(event.target.value)} placeholder="Search an interest" />
              </label>
              {interestHits.length ? (
                <ul className="pick-results">
                  {interestHits.map((hit) => (
                    <li key={hit.id}>
                      <button type="button" className="btn" onClick={() => {
                        setInterests((current) => current.some((item) => item.id === hit.id) ? current : [...current, hit]);
                        setInterestQuery('');
                        setInterestHits([]);
                      }}>{hit.name}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {interests.length ? (
                <div className="choice-grid">
                  {interests.map((item) => (
                    <div key={item.id} className="pick-chip">
                      <span>{item.name}</span>
                      <button type="button" className="btn" onClick={() => setInterests((current) => current.filter((row) => row.id !== item.id))}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : null}
              <label className="stack-field">Languages
                <input value={localeQuery} onChange={(event) => setLocaleQuery(event.target.value)} placeholder="Leave empty for all languages, or search Hindi, English" />
              </label>
              {localeHits.length ? (
                <ul className="pick-results">
                  {localeHits.map((hit) => (
                    <li key={hit.key}>
                      <button type="button" className="btn" onClick={() => {
                        setLocales((current) => current.some((item) => item.key === hit.key) ? current : [...current, hit]);
                        setLocaleQuery('');
                        setLocaleHits([]);
                      }}>{hit.name}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {locales.length ? (
                <div className="choice-grid">
                  {locales.map((item) => (
                    <div key={item.key} className="pick-chip">
                      <span>{item.name}</span>
                      <button type="button" className="btn" onClick={() => setLocales((current) => current.filter((row) => row.key !== item.key))}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : <p className="quiet">No language selected, so Meta includes all languages.</p>}
              <h3>Placements</h3>
              <label className="stack-field">Placement
                <select value={placements} onChange={(event) => setPlacements(event.target.value)}>
                  <option value="advantage">Advantage+ placements</option>
                  <option value="manual">Choose placements</option>
                </select>
              </label>
              {placements === 'manual' ? (
                <div className="choice-grid">
                  {[
                    ['facebook_feed', 'Facebook Feed'],
                    ['facebook_story', 'Facebook Stories'],
                    ['instagram_feed', 'Instagram Feed'],
                    ['instagram_story', 'Instagram Stories']
                  ].map(([key, text]) => (
                    <label key={key} className="switch-row">
                      <span>{text}</span>
                      <input type="checkbox" checked={feeds.includes(key)} onChange={() => setFeeds((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key])} />
                    </label>
                  ))}
                </div>
              ) : null}
              <h3>Tracking</h3>
              <label className="stack-field">Facebook pixel
                <select value={pixelId} onChange={(event) => setPixelId(event.target.value)}>
                  <option value="">No pixel</option>
                  {pixels.map((pixel) => <option key={pixel.id} value={pixel.id}>{pixel.name}</option>)}
                </select>
              </label>
              <p className="quiet">{pixels.length ? 'A selected pixel is sent when the ad goes to the website.' : 'Meta did not return a pixel for this ad account.'}</p>
            </>
          ) : null}
          {step === 2 ? (
            <div className="ad-studio">
              <div className="stack">
                <h3>Identity</h3>
                {pages.length ? (
                  <label className="stack-field">Facebook Page
                    <select value={pageId} onChange={(event) => setPageId(event.target.value)}>
                      {pages.map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="connect-missing">
                    <strong>Facebook Page is not connected</strong>
                    <p className="quiet">{pageNote || 'Meta returned no Page for this ad account.'}</p>
                    <div className="page-actions">
                      <button className="btn" type="button" disabled={busy} onClick={connectPages}>Connect Page</button>
                      <button className="btn" type="button" onClick={loadIdentity}>Refresh</button>
                    </div>
                  </div>
                )}
                {profiles.length ? (
                  <label className="stack-field">Instagram
                    <select value={instagramId} onChange={(event) => setInstagramId(event.target.value)}>
                      {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                    </select>
                  </label>
                ) : (
                  <div className="connect-missing">
                    <strong>Instagram is not connected</strong>
                    <p className="quiet">Connect the Instagram profile to the Facebook Page in Meta, then refresh.</p>
                    <div className="page-actions">
                      <a className="btn" href="https://business.facebook.com/latest/settings/instagram_accounts" target="_blank" rel="noreferrer">Connect Instagram</a>
                      <button className="btn" type="button" onClick={loadIdentity}>Refresh</button>
                    </div>
                  </div>
                )}
                <h3>Ad setup</h3>
                <p className="quiet">Single image. Carousel and multi-advertiser units stay in Meta Ads Manager.</p>
                <h3>Ad creative</h3>
                <label className="stack-field">Image
                  <input type="file" accept="image/jpeg,image/png" onChange={onImage} />
                </label>
                <label className="stack-field">Headline
                  <input value={headline} onChange={(event) => setHeadline(event.target.value)} maxLength={80} />
                </label>
                <label className="stack-field">Primary text
                  <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={500} />
                </label>
                <label className="stack-field">Website
                  <input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://" />
                </label>
                <label className="stack-field">Button
                  <select value={cta} onChange={(event) => setCta(event.target.value)}>
                    <option value="LEARN_MORE">Learn more</option>
                    <option value="SIGN_UP">Sign up</option>
                    <option value="CONTACT_US">Contact us</option>
                    <option value="SHOP_NOW">Shop now</option>
                    <option value="MESSAGE_PAGE">Send message</option>
                  </select>
                </label>
                <Switch checked={dynamicCreative} onChange={setDynamicCreative} label="Dynamic creative" hint="Meta mixes the extra headline and text. Instant forms and Messenger use one creative." />
                {(dynamicCreative || creativeTest) ? (
                  <>
                    <label className="stack-field">Second headline
                      <input value={headlineB} onChange={(event) => setHeadlineB(event.target.value)} maxLength={80} />
                    </label>
                    <label className="stack-field">Second text
                      <input value={messageB} onChange={(event) => setMessageB(event.target.value)} maxLength={500} />
                    </label>
                  </>
                ) : null}
                <Switch checked={creativeTest} onChange={setCreativeTest} label="Creative testing" hint="Publishes a second ad with the second headline so you can compare them." />
              </div>
              <aside className="ad-preview">
                <p>Preview</p>
                <strong>{pageName}</strong>
                <em>{instagramName}</em>
                {imageBase64 ? <img src={imageBase64} alt="" /> : <div className="ad-preview-empty">Image</div>}
                <span>{message || 'Primary text'}</span>
                <b>{headline || 'Headline'}</b>
                <small>{label(cta.toLowerCase())}</small>
              </aside>
            </div>
          ) : null}
          {step === 3 ? (
            <>
              <p className="quiet">Setup check is what you filled in. Meta calculates the campaign score in Ads Manager after the ad is published.</p>
              <ul className="check-list">
                {setup.map(([item, done]) => <li key={item} className={done ? 'is-done' : ''}>{done ? 'Ready' : 'Missing'} · {item}</li>)}
              </ul>
              <p className="quiet">{setup.filter((item) => item[1]).length} of {setup.length} sections ready.</p>
              <dl className="review-list">
                <div><dt>Campaign</dt><dd>{name}</dd></div>
                <div><dt>Objective</dt><dd>{label(objective.replace('OUTCOME_', '').toLowerCase())}</dd></div>
                <div><dt>A/B test</dt><dd>{abTest ? 'Two ad sets' : 'Off'}</dd></div>
                <div><dt>Conversion</dt><dd>{objective === 'OUTCOME_LEADS' ? label(conversion) : 'Website or reach'}</dd></div>
                <div><dt>Budget</dt><dd>{money(dailyBudget, currency)} · {budgetLevel === 'campaign' ? 'Campaign' : 'Ad set'} · {budgetMode}</dd></div>
                <div><dt>Schedule</dt><dd>{startDate || 'Starts when published'}{endDate ? ` to ${endDate}` : ''}</dd></div>
                <div><dt>Audience</dt><dd>{advantageAudience ? 'Advantage+ on' : 'Advantage+ off'} · {gender} · {ageMin}–{ageMax} · {locationMode === 'cities' && cities.length ? cities.map((city) => city.name).join(', ') : 'India'} · {interests.length ? interests.map((item) => item.name).join(', ') : 'No interests'} · {locales.length ? locales.map((item) => item.name).join(', ') : 'All languages'}</dd></div>
                <div><dt>Placements</dt><dd>{placements === 'advantage' ? 'Advantage+ placements' : `${feeds.length} selected`}</dd></div>
                <div><dt>Pixel</dt><dd>{pixels.find((pixel) => pixel.id === pixelId)?.name || 'Not selected'}</dd></div>
                <div><dt>Identity</dt><dd>{pageName} · {instagramName}</dd></div>
                <div><dt>Creative</dt><dd>{headline}{dynamicCreative ? ' · Dynamic creative' : ''}{creativeTest ? ' · Creative test' : ''}</dd></div>
              </dl>
              <aside className="ad-preview">
                <p>Preview</p>
                <strong>{pageName}</strong>
                {imageBase64 ? <img src={imageBase64} alt="" /> : null}
                <span>{message}</span>
                <b>{headline}</b>
              </aside>
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
      {editing ? (
        <form className="form-grid panel" onSubmit={saveEdit}>
          <h2>Edit campaign</h2>
          <label className="stack-field">Name
            <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required minLength={2} />
          </label>
          <label className="stack-field">Daily budget
            <input type="number" min="1" step="1" value={editing.budget} onChange={(event) => setEditing({ ...editing, budget: event.target.value })} />
          </label>
          <label className="stack-field">Status
            <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}>
              <option value="PAUSED">Paused</option>
              <option value="ACTIVE">Active</option>
            </select>
          </label>
          <div className="page-actions">
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
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
            <span className="page-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => setEditing({ id: row.externalId, name: row.name, budget: row.fields?.budget || '', status: row.fields?.status || 'PAUSED' })}>Edit</button>
              <button className="btn" type="button" disabled={busy} onClick={() => setCampaignStatus(row.externalId, row.fields.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}>
                {row.fields.status === 'ACTIVE' ? 'Pause' : 'Turn on'}
              </button>
            </span>
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

const GOOGLE_RANGES = [
  ['LAST_7_DAYS', 'Last 7 days'],
  ['LAST_14_DAYS', 'Last 14 days'],
  ['LAST_30_DAYS', 'Last 30 days'],
  ['THIS_MONTH', 'This month'],
  ['LAST_MONTH', 'Last month']
];

function lines(text) {
  return String(text || '').split('\n').map((item) => item.trim()).filter(Boolean);
}

function countCell(value) {
  return value == null || value === '' ? '—' : num(value);
}

function googleStatus(value) {
  const status = String(value || '').toLowerCase();
  return status === 'enabled' ? 'active' : status;
}

function GoogleAdsManager({ id, data, canManage, reload }) {
  const records = (data.records || []).filter((row) => row.origin === 'api');
  const campaigns = records.filter((row) => row.type === 'campaign');
  const adGroups = records.filter((row) => row.type === 'ad_group');
  const ads = records.filter((row) => row.type === 'ad');
  const keywordRows = records.filter((row) => row.type === 'keyword');
  const currency = campaigns.find((row) => row.fields?.currency)?.fields.currency || 'INR';
  const failed = data.jobs?.[0]?.status === 'failed' ? data.jobs[0].summary : '';
  const campaignName = new Map(campaigns.map((row) => [row.externalId, row.name]));
  const groupCampaign = new Map(adGroups.map((row) => [row.externalId, campaignName.get(row.parent) || '—']));
  const groupName = new Map(adGroups.map((row) => [row.externalId, row.name]));
  const steps = ['Campaign', 'Targeting', 'Keywords', 'Ad', 'Review'];
  const [view, setView] = useState('Campaigns');
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [bidding, setBidding] = useState('MAXIMIZE_CLICKS');
  const [cpcBid, setCpcBid] = useState('');
  const [dailyBudget, setDailyBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [searchPartners, setSearchPartners] = useState(false);
  const [presenceOnly, setPresenceOnly] = useState(false);
  const [locations, setLocations] = useState([]);
  const [locationQuery, setLocationQuery] = useState('');
  const [locationHits, setLocationHits] = useState([]);
  const [locationNote, setLocationNote] = useState('');
  const [languages, setLanguages] = useState([]);
  const [languageQuery, setLanguageQuery] = useState('');
  const [languageHits, setLanguageHits] = useState([]);
  const [keywordText, setKeywordText] = useState('');
  const [matchType, setMatchType] = useState('BROAD');
  const [negativeText, setNegativeText] = useState('');
  const [ideas, setIdeas] = useState([]);
  const [ideaNote, setIdeaNote] = useState('');
  const [finalUrl, setFinalUrl] = useState('');
  const [headlines, setHeadlines] = useState(['', '', '', '', '']);
  const [descriptions, setDescriptions] = useState(['', '']);
  const [path1, setPath1] = useState('');
  const [path2, setPath2] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('LAST_30_DAYS');
  const [report, setReport] = useState(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState('');
  const [chartField, setChartField] = useState('spend');
  const publishMode = useRef(false);

  const keywordList = lines(keywordText);
  const negativeList = lines(negativeText);
  const filledHeadlines = headlines.map((item) => item.trim()).filter(Boolean);
  const filledDescriptions = descriptions.map((item) => item.trim()).filter(Boolean);

  useEffect(() => {
    if (!canManage || locationQuery.trim().length < 2) {
      setLocationHits([]);
      setLocationNote('');
      return undefined;
    }
    const timer = setTimeout(() => {
      setLocationNote('Searching…');
      api.get(`/api/connections/${id}/google/locations?q=${encodeURIComponent(locationQuery.trim())}`)
        .then((result) => {
          const rows = result?.results || [];
          setLocationHits(rows);
          setLocationNote(rows.length ? '' : (result?.note || 'No location found.'));
        })
        .catch((err) => { setLocationHits([]); setLocationNote(err.message); });
    }, 350);
    return () => clearTimeout(timer);
  }, [id, canManage, locationQuery]);

  useEffect(() => {
    if (!canManage || languageQuery.trim().length < 2) {
      setLanguageHits([]);
      return undefined;
    }
    const timer = setTimeout(() => {
      api.get(`/api/connections/${id}/google/languages?q=${encodeURIComponent(languageQuery.trim())}`)
        .then((result) => setLanguageHits(result?.results || []))
        .catch(() => setLanguageHits([]));
    }, 350);
    return () => clearTimeout(timer);
  }, [id, canManage, languageQuery]);

  useEffect(() => {
    if (view !== 'Report') return undefined;
    let active = true;
    setReportBusy(true);
    setReportError('');
    api.get(`/api/connections/${id}/google/report?range=${range}`)
      .then((result) => { if (active) setReport(result); })
      .catch((err) => { if (active) { setReport(null); setReportError(err.message); } })
      .finally(() => { if (active) setReportBusy(false); });
    return () => { active = false; };
  }, [id, view, range]);

  async function loadIdeas() {
    setIdeaNote('Asking Google…');
    setIdeas([]);
    try {
      const seeds = keywordList.length ? keywordList.slice(0, 10) : lines(name.replace(/[^\p{L}\p{N} ]/gu, ' ')).slice(0, 1);
      const result = await api.post(`/api/connections/${id}/google/ideas`, {
        seeds,
        url: /^https?:\/\//i.test(finalUrl.trim()) ? finalUrl.trim() : '',
        locations: locations.map((item) => item.id),
        languageId: languages[0]?.id || ''
      });
      const rows = result?.ideas || [];
      setIdeas(rows);
      setIdeaNote(rows.length ? '' : 'Google returned no keyword ideas.');
    } catch (err) {
      setIdeaNote(err.message);
    }
  }

  function addKeyword(text) {
    if (keywordList.some((item) => item.toLowerCase() === text.toLowerCase())) return;
    setKeywordText((current) => (current.trim() ? `${current.trim()}\n${text}` : text));
  }

  function check(target) {
    if (target >= 1) {
      if (name.trim().length < 2) return 'Enter a campaign name.';
      if (!(Number(dailyBudget) >= 1)) return 'Enter a daily budget.';
      if (bidding === 'MANUAL_CPC' && !(Number(cpcBid) > 0)) return 'Manual CPC needs a max CPC bid.';
      if (startDate && endDate && endDate < startDate) return 'The end date must be after the start date.';
    }
    if (target >= 3) {
      if (!keywordList.length) return 'Add at least one keyword.';
      if (keywordList.length > 50) return 'Use 50 keywords or fewer.';
      if (keywordList.some((item) => item.length > 80)) return 'Each keyword must be 80 characters or fewer.';
    }
    if (target >= 4) {
      if (!/^https?:\/\//i.test(finalUrl.trim())) return 'Enter the website link, starting with https.';
      if (filledHeadlines.length < 3) return 'Write at least 3 headlines.';
      if (filledDescriptions.length < 2) return 'Write at least 2 descriptions.';
    }
    return '';
  }

  function nextStep() {
    const problem = check(step + 1);
    if (problem) { setError(problem); return; }
    setError('');
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function createCampaign(event) {
    event.preventDefault();
    if (step < steps.length - 1) { nextStep(); return; }
    const problem = check(steps.length - 1);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.post(`/api/connections/${id}/google/campaigns`, {
        name: name.trim(),
        dailyBudget: Number(dailyBudget),
        bidding,
        cpcBid: bidding === 'MANUAL_CPC' ? Number(cpcBid) : undefined,
        searchPartners,
        presenceOnly,
        locations,
        languages,
        keywords: keywordList.map((text) => ({ text, matchType })),
        negatives: negativeList,
        finalUrl: finalUrl.trim(),
        headlines: filledHeadlines,
        descriptions: filledDescriptions,
        path1: path1.trim() || undefined,
        path2: path2.trim() || undefined,
        startDate,
        endDate,
        publish: publishMode.current
      });
      setName('');
      setDailyBudget('');
      setCpcBid('');
      setKeywordText('');
      setNegativeText('');
      setIdeas([]);
      setFinalUrl('');
      setHeadlines(['', '', '', '', '']);
      setDescriptions(['', '']);
      setPath1('');
      setPath2('');
      setStep(0);
      setNotice(saved?.notice || 'Campaign saved on Google Ads.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.post(`/api/connections/${id}/google/edit`, {
        campaignId: editing.id,
        name: editing.name,
        dailyBudget: Number(editing.budget) >= 1 ? Number(editing.budget) : undefined,
        status: editing.status
      });
      setEditing(null);
      setNotice(saved?.notice || 'Campaign updated in Google Ads.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function setCampaignStatus(campaignId, status) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api.post(`/api/connections/${id}/google/status`, { campaignId, status });
      setNotice(saved?.notice || 'Campaign updated in Google Ads.');
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  let host = 'your-site.com';
  try { if (finalUrl.trim()) host = new URL(finalUrl.trim()).hostname.replace(/^www\./, ''); } catch { host = 'your-site.com'; }
  const displayPath = [host, path1.trim(), path1.trim() ? path2.trim() : ''].filter(Boolean).join('/');
  const preview = (
    <aside className="search-preview">
      <p>Preview</p>
      <small>Sponsored · {displayPath}</small>
      <b>{filledHeadlines.slice(0, 3).join(' | ') || 'Headline 1 | Headline 2 | Headline 3'}</b>
      <span>{filledDescriptions.slice(0, 2).join(' ') || 'Description 1. Description 2.'}</span>
    </aside>
  );
  const biddingName = { MAXIMIZE_CLICKS: 'Maximize clicks', MAXIMIZE_CONVERSIONS: 'Maximize conversions', MANUAL_CPC: 'Manual CPC' };
  const daily = report?.daily || [];
  const reportTotal = (key) => (daily.length ? daily.reduce((sum, row) => sum + Number(row[key] || 0), 0) : null);
  const tabs = ['Campaigns', 'Ad groups', 'Keywords', 'Ads', 'Report'];

  return (
    <div className="stack">
      {failed ? <p className="delta-down">{failed}</p> : data.jobs?.[0]?.summary ? <p className="quiet">{data.jobs[0].summary}</p> : null}
      {notice ? <p>{notice}</p> : null}
      {error ? <p className="delta-down">{error}</p> : null}
      <div className="metric-strip">
        <div className="metric"><span>Spend, 30 days</span><strong>{money(total(campaigns, 'spend'), currency)}</strong></div>
        <div className="metric"><span>Impressions</span><strong>{total(campaigns, 'impressions') == null ? '—' : num(total(campaigns, 'impressions'))}</strong></div>
        <div className="metric"><span>Clicks</span><strong>{total(campaigns, 'clicks') == null ? '—' : num(total(campaigns, 'clicks'))}</strong></div>
        <div className="metric"><span>Conversions</span><strong>{total(campaigns, 'conversions') == null ? '—' : num(total(campaigns, 'conversions'))}</strong></div>
      </div>
      {canManage ? (
        <form className="form-grid panel" onSubmit={createCampaign}>
          <h2>Create Search campaign</h2>
          <div className="ad-steps" aria-label="Campaign steps">
            {steps.map((item, index) => (
              <span key={item} className={index === step ? 'is-on' : index < step ? 'is-done' : ''}>
                <b>{index + 1}</b>{item}
              </span>
            ))}
          </div>
          {step === 0 ? (
            <>
              <label className="stack-field">Campaign name
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={180} />
              </label>
              <label className="stack-field">Daily budget ({currency})
                <input type="number" min="1" step="1" value={dailyBudget} onChange={(event) => setDailyBudget(event.target.value)} />
              </label>
              <label className="stack-field">Bidding
                <select value={bidding} onChange={(event) => setBidding(event.target.value)}>
                  <option value="MAXIMIZE_CLICKS">Maximize clicks</option>
                  <option value="MAXIMIZE_CONVERSIONS">Maximize conversions (needs conversion tracking)</option>
                  <option value="MANUAL_CPC">Manual CPC</option>
                </select>
              </label>
              {bidding === 'MANUAL_CPC' ? (
                <label className="stack-field">Max CPC bid ({currency})
                  <input type="number" min="0.01" step="0.01" value={cpcBid} onChange={(event) => setCpcBid(event.target.value)} />
                </label>
              ) : null}
              <label className="stack-field">Start date
                <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </label>
              <label className="stack-field">End date
                <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </label>
              <Switch checked={searchPartners} onChange={setSearchPartners} label="Google search partners" hint="Also show ads on partner search sites." />
            </>
          ) : null}
          {step === 1 ? (
            <>
              <label className="stack-field">Locations
                <input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Search a city or area, e.g. Pune, Noida" />
              </label>
              {locationHits.length ? (
                <ul className="pick-results">
                  {locationHits.map((hit) => (
                    <li key={hit.id}>
                      <button type="button" className="btn" onClick={() => {
                        setLocations((current) => current.some((item) => item.id === hit.id) ? current : [...current, { id: hit.id, name: hit.name }]);
                        setLocationQuery('');
                        setLocationHits([]);
                      }}>{hit.name}{hit.type ? ` · ${label(hit.type.toLowerCase())}` : ''}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {locationNote ? <p className="quiet">{locationNote}</p> : null}
              {locations.length ? (
                <div className="choice-grid">
                  {locations.map((item) => (
                    <div key={item.id} className="pick-chip">
                      <span>{item.name}</span>
                      <button type="button" className="btn" onClick={() => setLocations((current) => current.filter((row) => row.id !== item.id))}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : <p className="quiet">No location added, so the campaign targets all of India.</p>}
              <Switch checked={presenceOnly} onChange={setPresenceOnly} label="Only people in these locations" hint="Off also reaches people searching about these locations from elsewhere, which is Google's default." />
              <label className="stack-field">Languages
                <input value={languageQuery} onChange={(event) => setLanguageQuery(event.target.value)} placeholder="Leave empty for all languages, or search English, Hindi" />
              </label>
              {languageHits.length ? (
                <ul className="pick-results">
                  {languageHits.map((hit) => (
                    <li key={hit.id}>
                      <button type="button" className="btn" onClick={() => {
                        setLanguages((current) => current.some((item) => item.id === hit.id) ? current : [...current, hit]);
                        setLanguageQuery('');
                        setLanguageHits([]);
                      }}>{hit.name}</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {languages.length ? (
                <div className="choice-grid">
                  {languages.map((item) => (
                    <div key={item.id} className="pick-chip">
                      <span>{item.name}</span>
                      <button type="button" className="btn" onClick={() => setLanguages((current) => current.filter((row) => row.id !== item.id))}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : <p className="quiet">No language selected, so Google includes all languages.</p>}
            </>
          ) : null}
          {step === 2 ? (
            <>
              <label className="stack-field">Keywords, one per line
                <textarea rows={6} value={keywordText} onChange={(event) => setKeywordText(event.target.value)} placeholder={'3 bhk flats in pune\nready to move flats pune'} />
              </label>
              <label className="stack-field">Match type
                <select value={matchType} onChange={(event) => setMatchType(event.target.value)}>
                  <option value="BROAD">Broad</option>
                  <option value="PHRASE">Phrase</option>
                  <option value="EXACT">Exact</option>
                </select>
              </label>
              <p className="quiet">{keywordList.length} of 50 keywords.</p>
              <div className="page-actions">
                <button className="btn" type="button" onClick={loadIdeas}>Get keyword ideas from Google</button>
              </div>
              {ideaNote ? <p className="quiet">{ideaNote}</p> : null}
              {ideas.length ? (
                <Table columns={[
                  { key: 'text', label: 'Keyword' },
                  { key: 'searches', label: 'Monthly searches', render: (row) => countCell(row.searches) },
                  { key: 'competition', label: 'Competition', render: (row) => row.competition ? label(row.competition.toLowerCase()) : '—' },
                  { key: 'bid', label: 'Top of page bid', render: (row) => row.lowBid || row.highBid ? `${money(row.lowBid, currency)} – ${money(row.highBid, currency)}` : '—' },
                  { key: 'add', label: '', render: (row) => <button type="button" className="btn" disabled={keywordList.some((item) => item.toLowerCase() === row.text.toLowerCase())} onClick={() => addKeyword(row.text)}>Add</button> }
                ]} rows={ideas.map((row) => ({ ...row, id: row.text }))} />
              ) : null}
              <label className="stack-field">Negative keywords, one per line
                <textarea rows={3} value={negativeText} onChange={(event) => setNegativeText(event.target.value)} placeholder={'free\nrent\njobs'} />
              </label>
            </>
          ) : null}
          {step === 3 ? (
            <div className="ad-studio">
              <div className="stack">
                <label className="stack-field">Final URL
                  <input type="url" value={finalUrl} onChange={(event) => setFinalUrl(event.target.value)} placeholder="https://" />
                </label>
                <label className="stack-field">Display path 1
                  <input value={path1} onChange={(event) => setPath1(event.target.value)} maxLength={15} />
                </label>
                <label className="stack-field">Display path 2
                  <input value={path2} onChange={(event) => setPath2(event.target.value)} maxLength={15} disabled={!path1.trim()} />
                </label>
                <h3>Headlines ({filledHeadlines.length}/15, at least 3)</h3>
                {headlines.map((value, index) => (
                  <label key={`h${index}`} className="stack-field">Headline {index + 1} · {value.length}/30
                    <input value={value} maxLength={30} onChange={(event) => setHeadlines((current) => current.map((item, at) => at === index ? event.target.value : item))} />
                  </label>
                ))}
                {headlines.length < 15 ? <button type="button" className="btn" onClick={() => setHeadlines((current) => [...current, ''])}>Add headline</button> : null}
                <h3>Descriptions ({filledDescriptions.length}/4, at least 2)</h3>
                {descriptions.map((value, index) => (
                  <label key={`d${index}`} className="stack-field">Description {index + 1} · {value.length}/90
                    <input value={value} maxLength={90} onChange={(event) => setDescriptions((current) => current.map((item, at) => at === index ? event.target.value : item))} />
                  </label>
                ))}
                {descriptions.length < 4 ? <button type="button" className="btn" onClick={() => setDescriptions((current) => [...current, ''])}>Add description</button> : null}
              </div>
              {preview}
            </div>
          ) : null}
          {step === 4 ? (
            <>
              <dl className="review-list">
                <div><dt>Campaign</dt><dd>{name}</dd></div>
                <div><dt>Budget</dt><dd>{money(dailyBudget, currency)} per day</dd></div>
                <div><dt>Bidding</dt><dd>{biddingName[bidding]}{bidding === 'MANUAL_CPC' ? ` · max ${money(cpcBid, currency)}` : ''}</dd></div>
                <div><dt>Schedule</dt><dd>{startDate || 'Starts when published'}{endDate ? ` to ${endDate}` : ''}</dd></div>
                <div><dt>Networks</dt><dd>Google Search{searchPartners ? ' + search partners' : ''}</dd></div>
                <div><dt>Locations</dt><dd>{locations.length ? locations.map((item) => item.name).join(', ') : 'India'} · {presenceOnly ? 'people in these locations' : 'people in or interested in these locations'}</dd></div>
                <div><dt>Languages</dt><dd>{languages.length ? languages.map((item) => item.name).join(', ') : 'All languages'}</dd></div>
                <div><dt>Keywords</dt><dd>{keywordList.length} · {label(matchType.toLowerCase())} match{negativeList.length ? ` · ${negativeList.length} negative` : ''}</dd></div>
                <div><dt>Ad</dt><dd>{filledHeadlines.length} headlines · {filledDescriptions.length} descriptions · {finalUrl}</dd></div>
              </dl>
              {preview}
              <p className="quiet">Save paused creates everything in Google Ads without spending. Publish turns the campaign on. Google reviews the ad before it shows.</p>
            </>
          ) : null}
          <div className="page-actions">
            {step > 0 ? <button className="btn" type="button" disabled={busy} onClick={() => { setError(''); setStep((current) => current - 1); }}>Back</button> : null}
            {step < steps.length - 1 ? <button className="btn-primary" type="button" onClick={nextStep}>Next</button> : null}
            {step === steps.length - 1 ? (
              <>
                <button className="btn" type="submit" disabled={busy} onClick={() => { publishMode.current = false; }}>Save paused</button>
                <button className="btn-primary" type="submit" disabled={busy} onClick={() => { publishMode.current = true; }}>{busy ? 'Saving' : 'Publish'}</button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
      {editing ? (
        <form className="form-grid panel" onSubmit={saveEdit}>
          <h2>Edit campaign</h2>
          <label className="stack-field">Name
            <input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} required minLength={2} />
          </label>
          <label className="stack-field">Daily budget ({currency})
            <input type="number" min="1" step="1" value={editing.budget} onChange={(event) => setEditing({ ...editing, budget: event.target.value })} />
          </label>
          <label className="stack-field">Status
            <select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value })}>
              <option value="PAUSED">Paused</option>
              <option value="ENABLED">Enabled</option>
            </select>
          </label>
          <div className="page-actions">
            <button className="btn" type="button" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving' : 'Save'}</button>
          </div>
        </form>
      ) : null}
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item} type="button" className={view === item ? 'is-on' : ''} onClick={() => setView(item)}>{item}</button>
        ))}
      </div>
      {view === 'Campaigns' ? (
        campaigns.length ? (
          <Table columns={[
            { key: 'name', label: 'Campaign' },
            { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> },
            { key: 'channel', label: 'Type', render: (row) => label(String(row.fields?.channel || '').toLowerCase()) || '—' },
            { key: 'budget', label: 'Daily budget', render: (row) => money(row.fields?.budget, row.fields?.currency) },
            { key: 'spend', label: 'Spend', render: (row) => money(row.fields?.spend, row.fields?.currency) },
            { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.fields?.clicks) },
            { key: 'conversions', label: 'Conversions', render: (row) => countCell(row.fields?.conversions) },
            { key: 'action', label: '', render: (row) => canManage && (row.fields?.status === 'ENABLED' || row.fields?.status === 'PAUSED') ? (
              <span className="page-actions">
                <button className="btn" type="button" disabled={busy} onClick={() => setEditing({ id: row.externalId, name: row.name, budget: row.fields?.budget || '', status: row.fields?.status || 'PAUSED' })}>Edit</button>
                <button className="btn" type="button" disabled={busy} onClick={() => setCampaignStatus(row.externalId, row.fields.status === 'ENABLED' ? 'PAUSED' : 'ENABLED')}>
                  {row.fields.status === 'ENABLED' ? 'Pause' : 'Turn on'}
                </button>
              </span>
            ) : null }
          ]} rows={campaigns} />
        ) : (
          <div className="empty">
            <strong>No campaigns from Google Ads.</strong>
            <p className="quiet">Sync reads this account from Google. Sample campaigns are not listed here.</p>
          </div>
        )
      ) : null}
      {view === 'Ad groups' ? (
        <Table columns={[
          { key: 'name', label: 'Ad group' },
          { key: 'campaign', label: 'Campaign', render: (row) => campaignName.get(row.parent) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> }
        ]} rows={adGroups} />
      ) : null}
      {view === 'Keywords' ? (
        <Table columns={[
          { key: 'name', label: 'Keyword' },
          { key: 'match', label: 'Match', render: (row) => label(String(row.fields?.matchType || '').toLowerCase()) || '—' },
          { key: 'group', label: 'Ad group', render: (row) => groupName.get(row.parent) || '—' },
          { key: 'campaign', label: 'Campaign', render: (row) => groupCampaign.get(row.parent) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> }
        ]} rows={keywordRows} />
      ) : null}
      {view === 'Ads' ? (
        <Table columns={[
          { key: 'name', label: 'Ad' },
          { key: 'type', label: 'Type', render: (row) => label(String(row.fields?.adType || '').toLowerCase()) || '—' },
          { key: 'group', label: 'Ad group', render: (row) => groupName.get(row.parent) || '—' },
          { key: 'approval', label: 'Review', render: (row) => label(String(row.fields?.approval || '').toLowerCase()) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> }
        ]} rows={ads} />
      ) : null}
      {view === 'Report' ? (
        <div className="stack">
          <div className="page-actions">
            <select value={range} onChange={(event) => setRange(event.target.value)} aria-label="Report range">
              {GOOGLE_RANGES.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
            </select>
            <select value={chartField} onChange={(event) => setChartField(event.target.value)} aria-label="Chart metric">
              <option value="spend">Spend</option>
              <option value="clicks">Clicks</option>
              <option value="impressions">Impressions</option>
              <option value="conversions">Conversions</option>
            </select>
          </div>
          {reportBusy ? <p className="quiet">Reading the report from Google Ads…</p> : null}
          {reportError ? <p className="delta-down">{reportError}</p> : null}
          {report?.notes?.length ? <p className="quiet">{report.notes.join(' ')}</p> : null}
          {report && !reportBusy ? (
            <>
              <div className="metric-strip">
                <div className="metric"><span>Spend</span><strong>{money(reportTotal('spend'), report.currency || currency)}</strong></div>
                <div className="metric"><span>Impressions</span><strong>{countCell(reportTotal('impressions'))}</strong></div>
                <div className="metric"><span>Clicks</span><strong>{countCell(reportTotal('clicks'))}</strong></div>
                <div className="metric"><span>Conversions</span><strong>{countCell(reportTotal('conversions'))}</strong></div>
              </div>
              {daily.length > 1 ? (
                <section className="panel">
                  <h3>{label(chartField)} by day</h3>
                  <LineChart points={daily} field={chartField} />
                  <p className="quiet">{daily[0].date} to {daily[daily.length - 1].date}</p>
                </section>
              ) : <p className="quiet">Google returned no daily rows for this range.</p>}
              <h3>Campaigns</h3>
              <Table columns={[
                { key: 'name', label: 'Campaign' },
                { key: 'spend', label: 'Spend', render: (row) => money(row.spend, report.currency || currency) },
                { key: 'impressions', label: 'Impr.', render: (row) => countCell(row.impressions) },
                { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.clicks) },
                { key: 'ctr', label: 'CTR', render: (row) => row.ctr == null ? '—' : `${row.ctr}%` },
                { key: 'cpc', label: 'Avg. CPC', render: (row) => money(row.cpc, report.currency || currency) },
                { key: 'conversions', label: 'Conv.', render: (row) => countCell(row.conversions) },
                { key: 'cpa', label: 'Cost / conv.', render: (row) => money(row.costPerConversion, report.currency || currency) }
              ]} rows={report.campaigns || []} />
              <h3>Top keywords</h3>
              <Table columns={[
                { key: 'text', label: 'Keyword' },
                { key: 'match', label: 'Match', render: (row) => label(String(row.matchType || '').toLowerCase()) || '—' },
                { key: 'campaign', label: 'Campaign' },
                { key: 'spend', label: 'Spend', render: (row) => money(row.spend, report.currency || currency) },
                { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.clicks) },
                { key: 'conversions', label: 'Conv.', render: (row) => countCell(row.conversions) }
              ]} rows={report.keywords || []} />
              <h3>Search terms</h3>
              <Table columns={[
                { key: 'term', label: 'Search term' },
                { key: 'campaign', label: 'Campaign' },
                { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.clicks) },
                { key: 'spend', label: 'Spend', render: (row) => money(row.spend, report.currency || currency) },
                { key: 'conversions', label: 'Conv.', render: (row) => countCell(row.conversions) }
              ]} rows={report.searchTerms || []} />
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ConnectionDetail() {
  const { id } = useParams();
  const { data, loading, error, reload } = useResource(id ? `/api/connections/${id}` : null);
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const metaOnly = data?.providerKey === 'meta_ads';
  const google = data?.providerKey === 'google_ads';
  const meta = metaOnly || google;
  const records = metaOnly
    ? (data?.records || []).filter((row) => row.type !== 'campaign' && row.type !== 'adset' && row.type !== 'ad')
    : google
      ? (data?.records || []).filter((row) => !['campaign', 'ad_group', 'ad', 'keyword'].includes(row.type))
      : (data?.records || []);
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
      lede={google
        ? 'Create Search campaigns, manage them, and read reports for the connected Google Ads account.'
        : metaOnly ? 'Create the campaign, ad set, and ad here, then publish them to the connected Meta account.' : 'Only records returned by this tool\'s API or posted to its webhook.'}
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
            {data.tokenExpiresAt ? (
              <p className={new Date(data.tokenExpiresAt).getTime() - Date.now() < 10 * 86400000 ? 'delta-down' : 'quiet'}>
                The Facebook login expires on {data.tokenExpiresAt.slice(0, 10)}. Use Connect with Facebook again before then.
              </p>
            ) : null}
            {data.providerKey === 'nexcall' ? (
              <section className="panel">
                <h2>Connected</h2>
                <p>W-Caller verified this key. It is saved for this business.</p>
                <p className="quiet">{data.credentialPreview}</p>
              </section>
            ) : null}
            {metaOnly ? <MetaAdsManager id={id} data={data} canManage={can('connections.manage')} reload={reload} /> : null}
            {google ? <GoogleAdsManager id={id} data={data} canManage={can('connections.manage')} reload={reload} /> : null}
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
                <strong>{data.providerKey === 'nexcall' ? 'No call records yet.' : 'No API or webhook records.'}</strong>
                <p className="quiet">{data.providerKey === 'nexcall' ? 'The API key is already saved. Press Sync when you want the calls from W-Caller.' : `This page stays empty until ${data.name} returns data. Sample campaigns, leads, and spend are not listed here.`}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </State>
    </Page>
  );
}
