import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { day, indianDate, inr, label, num, parseIst, when } from '../format.js';
import { providerLogo } from '../providerLogos.js';
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
      next.delete('connection');
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
            key={`${oauthProvider}-${params.get('connection') || ''}`}
            provider={oauthProvider}
            connectionId={params.get('connection') || ''}
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
                  {
                    key: 'name',
                    label: 'Provider',
                    render: (row) => {
                      const logo = providerLogo(row.providerKey);
                      const multi = row.multiAccount && row.accounts?.length;
                      const name = row.connection?.linked && !multi ? <Link to={`/app/connections/${row.connection.id}`}>{row.name}</Link> : row.name;
                      const title = logo ? <span className="provider-name"><img src={logo} alt="" />{name}</span> : name;
                      if (!multi) return title;
                      return (
                        <div className="provider-accounts">
                          {title}
                          <ul>
                            {row.accounts.map((account) => (
                              <li key={account.id}><Link to={`/app/connections/${account.id}`}>{account.accountLabel || row.name}</Link>{account.accountId ? <small>{account.accountId}</small> : null}</li>
                            ))}
                          </ul>
                        </div>
                      );
                    }
                  },
                  { key: 'description', label: 'Becomes' },
                  { key: 'state', label: 'Status', render: (row) => row.multiAccount && row.accounts?.length > 1
                    ? <Badge value={`${row.accounts.length} accounts connected`} tone="good" />
                    : <Badge value={row.connection?.linked ? 'connected' : 'not_connected'} /> },
                  { key: 'api', label: 'API', render: (row) => row.providerKey === 'whatsapp' ? 'Platform bot' : row.connection?.linked ? `Live ${row.connection.apiKeyPreview}` : 'Not saved' },
                  { key: 'action', label: '', render: (row) => can('connections.manage') ? (
                    <button className="btn" onClick={() => { setForm(row); setMessage(''); }}>
                      {row.providerKey === 'whatsapp' ? 'API' : row.multiAccount && row.accounts?.length ? '+ Add account' : row.connection?.linked ? 'Update API' : 'Connect API'}
                    </button>
                  ) : null }
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

  const adding = Boolean(provider.multiAccount && provider.accounts?.length);

  if (provider.providerKey === 'google_ads') {
    return <OAuthConnect provider="google" adding={adding} />;
  }

  if (meta && !manual) {
    return (
      <div className="stack">
        <OAuthConnect provider="meta" adding={adding} />
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
      <h2>{adding ? `Add a ${provider.name} account` : provider.connection?.linked ? `Update ${provider.name} API` : `Connect ${provider.name} API`}</h2>
      <p className="quiet">{meta ? `Paste the Meta access token and the ad account id, like act_123456789. Meta checks both before the account connects.${adding ? ' An account id that is already connected is updated; a new one is added as another account.' : ''}` : 'The key is checked with the provider before it is saved. A wrong key shows Wrong API and does not connect.'}</p>
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
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder={nexcall ? 'Blank uses the Call Yatri default' : 'Optional'} />
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

function useOAuthStart(provider) {
  const setup = OAUTH_PROVIDERS[provider];
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function start(target) {
    setBusy(true);
    setError('');
    try {
      const result = await api.post(setup.start, target ? { target } : {});
      window.location.assign(result.url);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return { setup, start, busy, error };
}

function OAuthConnect({ provider, adding }) {
  const { setup, start, busy, error } = useOAuthStart(provider);

  return (
    <section className="panel form-grid">
      <h2>{adding ? `Add another ${setup.product} account` : `Connect ${setup.product}`}</h2>
      <p className="quiet">{setup.help}</p>
      {adding ? <p className="quiet">Each ad account is added as its own connection. Accounts that are already connected stay as they are.</p> : null}
      <button className="btn-primary" type="button" disabled={busy} onClick={() => start(adding ? 'new' : null)}>{busy ? `Opening ${setup.brand}` : `Connect with ${setup.brand}`}</button>
      {error ? <p className="delta-down">{error}</p> : null}
    </section>
  );
}

function AdAccountBar({ provider, current, accounts, canManage }) {
  const { setup, start, busy, error } = useOAuthStart(provider);
  const linked = accounts.filter((account) => account.linked);
  return (
    <section className="panel account-bar">
      <div className="account-bar-main">
        <span className="quiet">{linked.length > 1 ? `${linked.length} ${setup.product} accounts` : `${setup.product} account`}</span>
        <div className="account-tabs" role="tablist">
          {linked.map((account) => (
            <Link
              key={account.id}
              role="tab"
              aria-selected={String(account.id) === String(current)}
              className={String(account.id) === String(current) ? 'is-on' : ''}
              to={`/app/connections/${account.id}`}
            >
              <strong>{account.accountLabel || setup.product}</strong>
              {account.accountId ? <small>{provider === 'google' ? customerLabel(account.accountId) : account.accountId}</small> : null}
            </Link>
          ))}
        </div>
      </div>
      {canManage ? (
        <div className="page-actions">
          <button className="btn" type="button" disabled={busy} onClick={() => start(current)}>Change this account</button>
          <button className="btn-primary" type="button" disabled={busy} onClick={() => start('new')}>{busy ? `Opening ${setup.brand}` : '+ Add account'}</button>
        </div>
      ) : null}
      {error ? <p className="delta-down">{error}</p> : null}
    </section>
  );
}

function OAuthAccountPicker({ provider, connectionId, onDone, onCancel }) {
  const setup = OAUTH_PROVIDERS[provider];
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.get(connectionId ? `${setup.accounts}?connection=${encodeURIComponent(connectionId)}` : setup.accounts)
      .then((result) => {
        if (!active) return;
        const rows = result?.accounts || [];
        setAccounts(rows);
        setNote(result?.note || '');
        setChoice((rows.find((account) => !account.taken) || {}).id || '');
      })
      .catch((err) => { if (active) setNote(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [setup.accounts, connectionId]);

  const open = accounts.filter((account) => !account.taken);

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await api.post(setup.save, { [setup.field]: choice, ...(connectionId ? { connectionId: Number(connectionId) } : {}) });
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
            {accounts.map((account) => (
              <option key={account.id} value={account.id} disabled={account.taken}>
                {setup.option(account)}{account.taken ? ' · already connected' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {!loading && accounts.length && !open.length ? <p className="quiet">Every ad account this login can open is already connected in AIRO.</p> : null}
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

function ratio(part, whole) {
  if (part == null || !Number(whole)) return null;
  return Number(part) / Number(whole);
}

function pct(value) {
  return value == null ? '—' : `${(value * 100).toFixed(2)}%`;
}

function AdsHeader({ brand, title, account, job, counts, canManage, creating, onCreate, createLabel }) {
  const failed = job?.status === 'failed';
  return (
    <section className={`panel ads-hero is-${brand}`}>
      <div className="ads-hero-main">
        <span className={`ads-mark is-${brand}`} aria-hidden="true">{brand === 'google' ? 'G' : 'M'}</span>
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{account || title}</h2>
          <p className={failed ? 'delta-down' : 'quiet'}>
            {job ? `${failed ? 'Last sync failed: ' : 'Last sync: '}${job.summary || '—'} · ${when(job.startedAt)}` : 'No sync has run yet. Press Sync to read this account.'}
          </p>
        </div>
      </div>
      <div className="ads-hero-side">
        <div className="ads-counts">
          {counts.map(([text, value, tone]) => (
            <span key={text} className={tone ? `is-${tone}` : ''}><b>{num(value)}</b>{text}</span>
          ))}
        </div>
        {canManage ? (
          <button className={creating ? 'btn' : 'btn-primary'} type="button" onClick={onCreate}>{creating ? 'Close' : createLabel}</button>
        ) : null}
      </div>
    </section>
  );
}

function AdsAlerts({ notice, error }) {
  if (!notice && !error) return null;
  return (
    <>
      {notice ? <p className="ads-alert is-good">{notice}</p> : null}
      {error ? <p className="ads-alert is-bad">{error}</p> : null}
    </>
  );
}

function SpendBars({ rows, currency, resultKey, resultLabel, onPick }) {
  const ranked = rows
    .map((row) => ({ id: row.id, name: row.name, spend: Number(row.fields?.spend || 0), clicks: row.fields?.clicks, result: row.fields?.[resultKey] }))
    .filter((row) => row.spend > 0)
    .sort((a, b) => b.spend - a.spend)
    .slice(0, 6);
  const max = Math.max(...ranked.map((row) => row.spend), 1);
  if (!ranked.length) return <p className="quiet">No campaign has spend in this range.</p>;
  return (
    <div className="spend-bars">
      {ranked.map((row) => (
        <div className="spend-row" key={row.id}>
          {onPick ? (
            <button type="button" className="spend-name is-link" title={`Open ${row.name}`} onClick={() => onPick(row)}>{row.name}</button>
          ) : <span className="spend-name" title={row.name}>{row.name}</span>}
          <span className="spend-track"><span style={{ width: `${(row.spend / max) * 100}%` }} /></span>
          <strong>{money(row.spend, currency)}</strong>
          <em>{row.result == null || row.result === '' ? `${countCell(row.clicks)} clicks` : `${countCell(row.result)} ${resultLabel}`}</em>
        </div>
      ))}
    </div>
  );
}

function StatusMix({ rows, active }) {
  const on = rows.filter((row) => row.fields?.status === active).length;
  const paused = rows.filter((row) => row.fields?.status === 'PAUSED').length;
  const other = Math.max(rows.length - on - paused, 0);
  return (
    <SplitBar parts={[
      { label: 'Active', value: on, tone: 'good' },
      { label: 'Paused', value: paused, tone: 'warn' },
      { label: 'Other', value: other, tone: 'muted' }
    ]} />
  );
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CHART_COLORS = ['#5b4dff', '#12b76a', '#f79009', '#36bffa', '#ee46bc', '#98a2b3'];

function shortDate(iso) {
  const parsed = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return String(iso || '');
  return `${parsed.getUTCDate()} ${MONTHS_SHORT[parsed.getUTCMonth()]}`;
}

function sumOf(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
}

function niceMax(value) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((item) => item * power >= value) || 10;
  return step * power;
}

function useAdsReport(id, brand, range) {
  const [state, setState] = useState({ report: null, busy: true, error: '' });
  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, busy: true, error: '' }));
    api.get(`/api/connections/${id}/${brand}/report?range=${range}`)
      .then((report) => { if (active) setState({ report, busy: false, error: '' }); })
      .catch((err) => { if (active) setState({ report: null, busy: false, error: err.message }); });
    return () => { active = false; };
  }, [id, brand, range]);
  return state;
}

function Sparkline({ values }) {
  if (values.length < 2) return <span className="spark is-empty" />;
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${28 - (value / max) * 26}`).join(' ');
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polygon points={`0,30 ${points} 100,30`} />
      <polyline points={points} />
    </svg>
  );
}

function KpiCards({ items }) {
  return (
    <div className="kpi-cards">
      {items.map((item) => (
        <div className={`kpi-card${item.tone ? ` is-${item.tone}` : ''}`} key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.spark ? <Sparkline values={item.spark} /> : null}
          <em>{item.hint}</em>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ points, field, format, tooltip }) {
  const [hover, setHover] = useState(null);
  const W = 640;
  const H = 240;
  const left = 54;
  const right = 12;
  const top = 12;
  const bottom = 28;
  const values = points.map((point) => Number(point[field] || 0));
  const max = niceMax(Math.max(...values, 0));
  const span = W - left - right;
  const x = (index) => left + (points.length > 1 ? (index * span) / (points.length - 1) : span / 2);
  const y = (value) => top + (H - top - bottom) * (1 - value / max);
  const line = values.map((value, index) => `${x(index)},${y(value)}`).join(' ');
  const every = Math.max(1, Math.ceil(points.length / 7));
  const hovered = hover == null ? null : points[hover];
  return (
    <div className="trend-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label(field)} by day`}>
        <defs>
          <linearGradient id={`fill-${field}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5b4dff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#5b4dff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <g key={step}>
            <line className="grid" x1={left} x2={W - right} y1={y(max * step)} y2={y(max * step)} />
            <text className="axis" x={left - 8} y={y(max * step) + 4} textAnchor="end">{format(max * step, true)}</text>
          </g>
        ))}
        {points.map((point, index) => (index % every === 0 || index === points.length - 1 ? (
          <text key={point.date} className="axis" x={x(index)} y={H - 8} textAnchor="middle">{shortDate(point.date)}</text>
        ) : null))}
        <polygon points={`${x(0)},${y(0)} ${line} ${x(points.length - 1)},${y(0)}`} fill={`url(#fill-${field})`} />
        <polyline className="trend-line" points={line} />
        {hovered ? (
          <>
            <line className="cursor" x1={x(hover)} x2={x(hover)} y1={top} y2={H - bottom} />
            <circle className="trend-dot" cx={x(hover)} cy={y(values[hover])} r="5" />
          </>
        ) : null}
        {points.map((point, index) => (
          <rect key={`hit-${point.date}`} className="hit" x={x(index) - span / Math.max(points.length - 1, 1) / 2} y={top} width={span / Math.max(points.length - 1, 1)} height={H - top - bottom} onMouseEnter={() => setHover(index)} />
        ))}
      </svg>
      {hovered ? (
        <div className="trend-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{day(hovered.date)}</b>
          {tooltip(hovered).map(([name, value]) => <span key={name}>{name}<strong>{value}</strong></span>)}
        </div>
      ) : null}
    </div>
  );
}

function Donut({ parts, center, sub, format }) {
  const totalValue = parts.reduce((sum, part) => sum + part.value, 0);
  const radius = 42;
  const length = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} className="donut-bg" />
        {totalValue > 0 ? parts.map((part, index) => {
          const size = (part.value / totalValue) * length;
          const segment = (
            <circle key={part.label} cx="60" cy="60" r={radius} stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeDasharray={`${size} ${length - size}`} strokeDashoffset={-offset} />
          );
          offset += size;
          return segment;
        }) : null}
        <text x="60" y="58" textAnchor="middle" className="donut-center">{center}</text>
        <text x="60" y="74" textAnchor="middle" className="donut-sub">{sub}</text>
      </svg>
      <ul className="donut-legend">
        {parts.map((part, index) => (
          <li key={part.label}>
            <i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
            <span>{part.label}</span>
            <strong>{format(part.value)}</strong>
            <em>{totalValue ? `${Math.round((part.value / totalValue) * 100)}%` : '—'}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FunnelSteps({ steps }) {
  return (
    <div className="ads-funnel">
      {steps.map((item, index) => {
        const previous = steps[index - 1];
        const rate = previous && Number(previous.value) ? (Number(item.value) / Number(previous.value)) * 100 : null;
        return (
          <div key={item.label} className="ads-funnel-step">
            {rate != null ? <span className="ads-funnel-rate">{rate.toFixed(rate < 1 ? 2 : 1)}% {item.rateLabel}</span> : null}
            <div className="ads-funnel-bar" style={{ width: `${100 - index * (60 / Math.max(steps.length - 1, 1))}%` }}>
              <span>{item.label}</span>
              <strong>{num(item.value)}</strong>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AudienceBars({ rows, metric, format }) {
  const ages = [...new Set(rows.map((row) => row.age))].filter(Boolean).sort();
  const byAge = ages.map((age) => {
    const group = rows.filter((row) => row.age === age);
    const pick = (gender) => sumOf(group.filter((row) => row.gender === gender), metric);
    return { age, male: pick('male'), female: pick('female'), other: sumOf(group.filter((row) => row.gender !== 'male' && row.gender !== 'female'), metric) };
  });
  const max = Math.max(...byAge.map((row) => row.male + row.female + row.other), 1);
  if (!byAge.length) return <p className="quiet">Meta returned no age and gender split for this range.</p>;
  return (
    <div className="audience-bars">
      {byAge.map((row) => {
        const sum = row.male + row.female + row.other;
        return (
          <div className="audience-row" key={row.age}>
            <span>{row.age}</span>
            <span className="audience-track" style={{ width: `${(sum / max) * 100}%` }}>
              <i className="is-male" style={{ flex: row.male }} />
              <i className="is-female" style={{ flex: row.female }} />
              <i className="is-other" style={{ flex: row.other }} />
            </span>
            <strong>{format(sum)}</strong>
          </div>
        );
      })}
    </div>
  );
}

function AdsPerformance({ brand, report, busy, error, range, onRange, fallbackCurrency, resultKey, resultLabel }) {
  const [field, setField] = useState('spend');
  const currency = report?.currency || fallbackCurrency;
  const daily = report?.daily || [];
  const spend = sumOf(daily, 'spend');
  const impressions = sumOf(daily, 'impressions');
  const clicks = sumOf(daily, 'clicks');
  const results = sumOf(daily, resultKey);
  const reach = brand === 'meta' ? sumOf(daily, 'reach') : null;
  const fmt = {
    spend: (value, short) => (short ? `${currency === 'INR' || !currency ? '₹' : ''}${compact(Math.round(value))}` : money(value, currency)),
    impressions: (value, short) => (short ? compact(Math.round(value)) : num(value)),
    clicks: (value, short) => (short ? compact(Math.round(value)) : num(value)),
    [resultKey]: (value, short) => (short ? compact(Math.round(value)) : num(value))
  };
  const metrics = [['spend', 'Spend'], ['impressions', 'Impressions'], ['clicks', 'Clicks'], [resultKey, label(resultLabel)]];
  const series = (key) => daily.map((row) => Number(row[key] || 0));
  const dailyRatio = (a, b) => daily.map((row) => (Number(row[b]) ? Number(row[a]) / Number(row[b]) : 0));
  const cards = [
    { label: 'Spend', value: money(spend, currency), spark: series('spend'), hint: `${money(ratio(spend, daily.length), currency)} a day` },
    { label: 'Impressions', value: num(impressions), spark: series('impressions'), hint: reach ? `${num(reach)} reach (daily sum)` : `${money(ratio(spend * 1000, impressions), currency)} CPM` },
    { label: 'Clicks', value: num(clicks), spark: series('clicks'), hint: `${money(ratio(spend, clicks), currency)} per click` },
    { label: 'CTR', value: pct(ratio(clicks, impressions)), spark: dailyRatio('clicks', 'impressions'), hint: 'Clicks ÷ impressions', tone: 'info' },
    { label: label(resultLabel), value: num(results), spark: series(resultKey), hint: `${pct(ratio(results, clicks))} of clicks`, tone: 'good' },
    { label: `Cost per ${resultKey === 'leads' ? 'lead' : 'conversion'}`, value: money(ratio(spend, results), currency), spark: dailyRatio('spend', resultKey), hint: results ? `${num(results)} ${resultLabel}` : `No ${resultLabel} yet`, tone: 'warn' }
  ];

  return (
    <section className="panel ads-performance">
      <header>
        <div>
          <h2>Performance</h2>
          <p>{daily.length ? `${day(daily[0].date)} to ${day(daily[daily.length - 1].date)} · live from ${brand === 'meta' ? 'Meta' : 'Google Ads'}` : `Live from ${brand === 'meta' ? 'Meta' : 'Google Ads'}`}</p>
        </div>
        <div className="tabs ads-range">
          {GOOGLE_RANGES.map(([key, text]) => (
            <button key={key} type="button" className={range === key ? 'is-on' : ''} onClick={() => onRange(key)}>{text}</button>
          ))}
        </div>
      </header>
      {error ? <p className="ads-alert is-bad">The report could not be loaded: {error}</p> : null}
      {report?.notes?.length ? <p className="quiet">Some parts did not load: {report.notes.join(' · ')}</p> : null}
      {busy && !report ? <div className="skeleton-block" aria-busy="true" /> : null}
      {report ? (
        <div className={busy ? 'is-loading' : ''}>
          <KpiCards items={cards} />
          <div className="trend-head">
            <h3>Daily trend</h3>
            <div className="chip-tabs">
              {metrics.map(([key, text]) => (
                <button key={key} type="button" className={field === key ? 'is-on' : ''} onClick={() => setField(key)}>{text}</button>
              ))}
            </div>
          </div>
          {daily.length > 1 ? (
            <TrendChart
              points={daily}
              field={field}
              format={(value, short) => fmt[field](value, short)}
              tooltip={(row) => [
                ['Spend', money(row.spend, currency)],
                ['Impressions', num(row.impressions)],
                ['Clicks', num(row.clicks)],
                [label(resultLabel), num(row[resultKey])]
              ]}
            />
          ) : <p className="quiet">Not enough daily rows in this range to draw a trend.</p>}
        </div>
      ) : null}
    </section>
  );
}

function CampaignName({ name }) {
  return (
    <span className="campaign-name">
      <strong>{name || '—'}</strong>
      <em>View details →</em>
    </span>
  );
}

function resultCards(rows, resultKey, resultLabel, currency) {
  const spend = sumOf(rows, 'spend');
  const impressions = sumOf(rows, 'impressions');
  const clicks = sumOf(rows, 'clicks');
  const results = sumOf(rows, resultKey);
  const series = (key) => rows.map((row) => Number(row[key] || 0));
  return [
    { label: 'Spend', value: money(spend, currency), spark: series('spend'), hint: `${money(ratio(spend, rows.length), currency)} a day` },
    { label: 'Impressions', value: num(impressions), spark: series('impressions'), hint: `${money(ratio(spend * 1000, impressions), currency)} CPM` },
    { label: 'Clicks', value: num(clicks), spark: series('clicks'), hint: `${money(ratio(spend, clicks), currency)} per click` },
    { label: 'CTR', value: pct(ratio(clicks, impressions)), spark: rows.map((row) => (Number(row.impressions) ? Number(row.clicks) / Number(row.impressions) : 0)), hint: 'Clicks ÷ impressions', tone: 'info' },
    { label: label(resultLabel), value: num(results), spark: series(resultKey), hint: `${pct(ratio(results, clicks))} of clicks`, tone: 'good' },
    { label: `Cost per ${resultKey === 'leads' ? 'lead' : 'conversion'}`, value: money(ratio(spend, results), currency), hint: results ? `${num(results)} ${resultLabel}` : `No ${resultLabel} yet`, tone: 'warn' }
  ];
}

function StatLine({ row, currency, resultKey, resultLabel }) {
  return (
    <dl className="stat-line">
      <div><dt>Spend</dt><dd>{money(row.spend, currency)}</dd></div>
      <div><dt>Impr.</dt><dd>{countCell(row.impressions)}</dd></div>
      <div><dt>Clicks</dt><dd>{countCell(row.clicks)}</dd></div>
      <div><dt>CTR</dt><dd>{pct(ratio(row.clicks, row.impressions))}</dd></div>
      <div><dt>{label(resultLabel)}</dt><dd>{countCell(row[resultKey])}</dd></div>
      <div><dt>Cost / {resultKey === 'leads' ? 'lead' : 'conv.'}</dt><dd>{money(ratio(row.spend, row[resultKey]), currency)}</dd></div>
    </dl>
  );
}

function MetaAdCard({ ad, adsetName, currency, actions }) {
  const creative = ad.creative || {};
  let host = '';
  try { host = creative.link ? new URL(creative.link).hostname.replace(/^www\./, '') : ''; } catch { host = ''; }
  return (
    <article className="ad-card">
      <div className="ad-card-head">
        <div>
          <strong>{ad.name || 'Ad'}</strong>
          <em>{adsetName || 'Ad set'}</em>
        </div>
        <Badge value={String(ad.delivery || ad.status || '').toLowerCase().replace(/_/g, ' ')} />
      </div>
      <div className="fb-post">
        {creative.text ? <p className="fb-text">{creative.text}</p> : null}
        {creative.image ? <img src={creative.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="ad-preview-empty">No image returned</div>}
        <div className="fb-foot">
          <div>
            {host ? <small>{host}</small> : null}
            <b>{creative.headline || 'No headline returned'}</b>
          </div>
          {creative.cta ? <span className="fb-cta">{label(creative.cta.toLowerCase())}</span> : null}
        </div>
      </div>
      <StatLine row={ad} currency={currency} resultKey="leads" resultLabel="leads" />
      {actions}
    </article>
  );
}

function GoogleAdCard({ ad, groupName, currency, actions }) {
  let host = 'your-site.com';
  try { if (ad.finalUrl) host = new URL(ad.finalUrl).hostname.replace(/^www\./, ''); } catch { host = 'your-site.com'; }
  const path = [host, ad.path1, ad.path1 ? ad.path2 : ''].filter(Boolean).join('/');
  return (
    <article className="ad-card">
      <div className="ad-card-head">
        <div>
          <strong>{ad.name || label(String(ad.type || 'ad').toLowerCase())}</strong>
          <em>{groupName || 'Ad group'}</em>
        </div>
        <span className="ad-card-badges">
          {ad.approval ? <Badge value={String(ad.approval).toLowerCase().replace(/_/g, ' ')} /> : null}
          <Badge value={googleStatus(ad.status)} />
        </span>
      </div>
      <div className="search-preview">
        <small>Sponsored · {path}</small>
        <b>{ad.headlines.slice(0, 3).join(' | ') || 'No headlines returned'}</b>
        <span>{ad.descriptions.slice(0, 2).join(' ')}</span>
      </div>
      {ad.headlines.length > 3 || ad.descriptions.length > 2 ? (
        <details className="ad-assets">
          <summary>All {ad.headlines.length} headlines and {ad.descriptions.length} descriptions</summary>
          <div className="cy-chips">{ad.headlines.map((text) => <span key={`h-${text}`} className="chip">{text}</span>)}</div>
          <ul>{ad.descriptions.map((text) => <li key={`d-${text}`}>{text}</li>)}</ul>
        </details>
      ) : null}
      <StatLine row={ad} currency={currency} resultKey="conversions" resultLabel="conversions" />
      {actions}
    </article>
  );
}

const META_CTAS = ['LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'CALL_NOW', 'GET_QUOTE', 'APPLY_NOW', 'BOOK_NOW', 'GET_OFFER', 'SUBSCRIBE', 'DOWNLOAD', 'SHOP_NOW', 'MESSAGE_PAGE', 'WHATSAPP_MESSAGE'];
const AGES = Array.from({ length: 53 }, (_, index) => String(index + 13));

function editValue(field, value) {
  if (field.type === 'lines') return String(value || '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (field.type === 'number') return value === '' || value == null ? null : Number(value);
  return value ?? '';
}

function SearchPicker({ search, value, onChange, idKey, placeholder }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState([]);
  const [note, setNote] = useState('');
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      setNote('');
      return undefined;
    }
    let active = true;
    const timer = setTimeout(() => {
      setNote('Searching…');
      api.get(searchRef.current(text))
        .then((result) => {
          if (!active) return;
          const rows = result?.results || [];
          setHits(rows);
          setNote(rows.length ? '' : (result?.note || 'Nothing found.'));
        })
        .catch((err) => { if (active) { setHits([]); setNote(err.message); } });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  const chosen = new Set(value.map((item) => String(item[idKey])));
  return (
    <div className="search-picker">
      {value.length ? (
        <div className="cy-chips">
          {value.map((item) => (
            <span key={item[idKey]} className="chip">
              {item.name}
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => onChange(value.filter((other) => String(other[idKey]) !== String(item[idKey])))}>×</button>
            </span>
          ))}
        </div>
      ) : <p className="quiet">None chosen.</p>}
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} />
      {note ? <p className="quiet">{note}</p> : null}
      {hits.length ? (
        <ul className="search-hits">
          {hits.filter((hit) => !chosen.has(String(hit[idKey]))).map((hit) => (
            <li key={hit[idKey]}>
              <button type="button" onClick={() => { onChange([...value, { [idKey]: String(hit[idKey]), name: hit.name }]); setQuery(''); setHits([]); }}>
                {hit.name}{hit.region ? <small>{hit.region}</small> : hit.type ? <small>{label(String(hit.type).toLowerCase())}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function EditForm({ editing, busy, error, onSave, onCancel }) {
  const { title, fields, initial, note } = editing;
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.key, field.type === 'lines' ? (initial[field.key] || []).join('\n') : initial[field.key] ?? ''])));
  const set = (key, value) => setValues((current) => ({ ...current, [key]: value }));

  function submit(event) {
    event.preventDefault();
    const changes = {};
    for (const field of fields) {
      const next = editValue(field, values[field.key]);
      const before = editValue(field, field.type === 'lines' ? (initial[field.key] || []).join('\n') : initial[field.key]);
      if (field.type === 'number' && next == null) continue;
      if (JSON.stringify(next) !== JSON.stringify(before)) changes[field.key] = field.toPayload ? field.toPayload(next) : next;
    }
    onSave(changes, values);
  }

  return (
    <form className="drawer-section drawer-edit" onSubmit={submit}>
      <header className="drawer-edit-head">
        <h3>{title}</h3>
        <button type="button" className="drawer-close" onClick={onCancel} aria-label="Cancel">×</button>
      </header>
      {note ? <p className="quiet">{note}</p> : null}
      <div className="drawer-edit-grid">
        {fields.map((field) => {
          const value = values[field.key];
          let input;
          if (field.type === 'select') {
            input = (
              <select value={value} onChange={(event) => set(field.key, event.target.value)}>
                {field.options.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
              </select>
            );
          } else if (field.type === 'textarea' || field.type === 'lines') {
            input = <textarea rows={field.rows || 4} value={value} onChange={(event) => set(field.key, event.target.value)} maxLength={field.max ? field.max * 20 : undefined} />;
          } else if (field.type === 'picker') {
            input = <SearchPicker search={field.search} idKey={field.idKey} placeholder={field.placeholder} value={value || []} onChange={(next) => set(field.key, next)} />;
          } else {
            input = (
              <input
                type={field.type || 'text'}
                value={value}
                min={field.min}
                step={field.step}
                maxLength={field.type === 'text' || !field.type ? field.max : undefined}
                onChange={(event) => set(field.key, event.target.value)}
              />
            );
          }
          const lines = field.type === 'lines' ? editValue(field, value) : null;
          const tooLong = lines && field.max ? lines.filter((line) => line.length > field.max).length : 0;
          return (
            <label key={field.key} className={`stack-field${field.wide || ['textarea', 'lines', 'picker'].includes(field.type) ? ' wide' : ''}`}>
              {field.label}
              {input}
              {lines ? <em className={tooLong ? 'delta-down' : 'quiet'}>{lines.length} lines{field.max ? ` · max ${field.max} characters each` : ''}{tooLong ? ` · ${tooLong} too long` : ''}</em> : null}
              {field.hint ? <em className="quiet">{field.hint}</em> : null}
            </label>
          );
        })}
      </div>
      {error ? <p className="delta-down">{error}</p> : null}
      <div className="page-actions">
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving' : 'Save changes'}</button>
      </div>
    </form>
  );
}

function CampaignDrawer({ brand, connectionId, campaign, initialRange, onClose, canManage, onChanged }) {
  const [range, setRange] = useState(initialRange || 'LAST_30_DAYS');
  const [tab, setTab] = useState('Ads');
  const [field, setField] = useState('spend');
  const { data, loading, error, reload } = useResource(`/api/connections/${connectionId}/${brand}/campaigns/${campaign.id}?range=${range}`);
  const meta = brand === 'meta';
  const resultKey = meta ? 'leads' : 'conversions';
  const resultLabel = meta ? 'leads' : 'conversions';
  const currency = data?.currency || campaign.currency || 'INR';
  const info = data?.campaign;
  const daily = data?.daily || [];
  const groups = meta ? data?.adsets || [] : data?.groups || [];
  const groupName = new Map(groups.map((row) => [row.id, row.name]));
  const ads = data?.ads || [];
  const keywords = data?.keywords || [];
  const tabs = meta ? ['Ads', 'Ad sets'] : ['Ads', 'Ad groups', 'Keywords'];
  const counts = { Ads: ads.length, 'Ad sets': groups.length, 'Ad groups': groups.length, Keywords: keywords.length };

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState('');
  const [editError, setEditError] = useState('');
  const [notice, setNotice] = useState('');
  const bodyRef = useRef(null);
  const statusOn = meta ? 'ACTIVE' : 'ENABLED';
  const statusOptions = meta ? [['ACTIVE', 'Active'], ['PAUSED', 'Paused']] : [['ENABLED', 'Enabled'], ['PAUSED', 'Paused']];
  const audienceUrl = `/api/connections/${connectionId}/meta/audience`;

  async function saveItem(kind, itemId, changes, key = `${kind}:${itemId}`) {
    if (!Object.keys(changes).length) {
      setEditing(null);
      return;
    }
    setSaving(key);
    setEditError('');
    setNotice('');
    try {
      const result = await api.post(`/api/connections/${connectionId}/${brand}/items/${kind}/${encodeURIComponent(itemId)}`, changes);
      setNotice(result?.notice || 'Saved.');
      setEditing(null);
      reload();
      onChanged?.();
    } catch (err) {
      setEditError(err.message);
    } finally {
      setSaving('');
    }
  }

  function openEdit(config) {
    setEditError('');
    setNotice('');
    setEditing({ ...config, token: Date.now() });
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function toggleStatus(kind, itemId, status, name) {
    const next = status === statusOn ? 'PAUSED' : statusOn;
    if (next === statusOn && !window.confirm(`Turn on "${name}"? It can start spending.`)) return;
    saveItem(kind, itemId, { status: next });
  }

  function statusButton(kind, itemId, status, name) {
    if (status !== statusOn && status !== 'PAUSED') return null;
    return (
      <button className="btn" type="button" disabled={Boolean(saving)} onClick={() => toggleStatus(kind, itemId, status, name)}>
        {saving === `${kind}:${itemId}` ? 'Saving' : status === statusOn ? 'Pause' : 'Turn on'}
      </button>
    );
  }

  function editCampaign() {
    if (!info) return;
    const fields = [
      { key: 'name', label: 'Campaign name', max: 180, wide: true },
      { key: 'status', label: 'Status', type: 'select', options: statusOptions }
    ];
    if (info.budget) fields.push({ key: 'budget', label: `${meta && info.budgetKind === 'lifetime' ? 'Lifetime' : 'Daily'} budget (${currency})`, type: 'number', min: 1, step: '1' });
    if (!meta) {
      const current = ['TARGET_SPEND', 'MAXIMIZE_CONVERSIONS', 'MANUAL_CPC'].includes(info.bidding) ? (info.bidding === 'TARGET_SPEND' ? 'MAXIMIZE_CLICKS' : info.bidding) : '';
      fields.push(
        { key: 'endDate', label: 'End date', type: 'date', hint: 'Leave blank for no end date.' },
        { key: 'bidding', label: 'Bidding', type: 'select', options: [...(current ? [] : [['', `Keep current (${label(String(info.bidding || 'unknown').toLowerCase())})`]]), ['MAXIMIZE_CLICKS', 'Maximize clicks'], ['MAXIMIZE_CONVERSIONS', 'Maximize conversions'], ['MANUAL_CPC', 'Manual CPC']] },
        { key: 'locations', label: 'Locations', type: 'picker', idKey: 'id', placeholder: 'Search a city, state, or country', search: (q) => `/api/connections/${connectionId}/google/locations?q=${encodeURIComponent(q)}`, toPayload: (items) => items.map((item) => item.id), hint: 'Ads show only to people in these places. Remove all to keep the current list.' }
      );
      openEdit({
        title: 'Edit campaign',
        fields,
        initial: { name: info.name, status: info.status, budget: info.budget || '', endDate: info.endDate && !info.endDate.startsWith('2037') ? info.endDate : '', bidding: current, locations: info.locations || [] },
        submit: (changes) => {
          if (changes.bidding === '') delete changes.bidding;
          if (Array.isArray(changes.locations) && !changes.locations.length) delete changes.locations;
          return saveItem('campaign', info.id, changes);
        }
      });
      return;
    }
    openEdit({
      title: 'Edit campaign',
      fields,
      note: info.budget ? '' : 'This campaign has no campaign budget. Its budget is set on each ad set.',
      initial: { name: info.name, status: info.status, budget: info.budget || '' },
      submit: (changes) => saveItem('campaign', info.id, changes)
    });
  }

  const autoEdited = useRef(false);
  useEffect(() => {
    if (!campaign.edit || !canManage || !info || autoEdited.current) return;
    autoEdited.current = true;
    editCampaign();
  }, [info, campaign.edit, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  function editAdset(set) {
    const edit = set.targeting.edit || {};
    const fields = [
      { key: 'name', label: 'Ad set name', max: 180, wide: true },
      { key: 'status', label: 'Status', type: 'select', options: statusOptions }
    ];
    if (set.budget) fields.push({ key: 'budget', label: `${set.budgetKind === 'lifetime' ? 'Lifetime' : 'Daily'} budget (${currency})`, type: 'number', min: 1, step: '1' });
    fields.push(
      { key: 'endDate', label: 'End date', type: 'date', hint: set.budgetKind === 'lifetime' ? 'A lifetime budget needs an end date.' : 'Leave as is to keep the current end.' },
      { key: 'ageMin', label: 'Minimum age', type: 'select', options: AGES.map((age) => [age, age]) },
      { key: 'ageMax', label: 'Maximum age', type: 'select', options: AGES.map((age) => [age, age === '65' ? '65+' : age]) },
      { key: 'gender', label: 'Gender', type: 'select', options: [['all', 'All'], ['men', 'Men'], ['women', 'Women']] },
      { key: 'cities', label: 'Cities', type: 'picker', idKey: 'key', placeholder: 'Search a city', search: (q) => `${audienceUrl}?kind=city&q=${encodeURIComponent(q)}`, hint: edit.otherPlaces?.length ? `Also targeted and kept as is: ${edit.otherPlaces.join(', ')}.` : 'With no city, the ad set targets India.' },
      { key: 'interests', label: 'Interests', type: 'picker', idKey: 'id', placeholder: 'Search an interest', search: (q) => `${audienceUrl}?kind=interest&q=${encodeURIComponent(q)}` }
    );
    openEdit({
      title: `Edit ad set · ${set.name}`,
      fields,
      note: set.targeting.advantage ? 'Advantage+ audience is on, so Meta may show ads beyond these age and interest choices.' : '',
      initial: {
        name: set.name,
        status: set.status,
        budget: set.budget || '',
        endDate: set.endTime ? String(set.endTime).slice(0, 10) : '',
        ageMin: String(edit.ageMin || 18),
        ageMax: String(edit.ageMax || 65),
        gender: edit.gender || 'all',
        cities: edit.cities || [],
        interests: edit.interests || []
      },
      submit: (changes) => {
        if (changes.ageMin != null) changes.ageMin = Number(changes.ageMin);
        if (changes.ageMax != null) changes.ageMax = Number(changes.ageMax);
        if (changes.endDate === '') delete changes.endDate;
        return saveItem('adset', set.id, changes);
      }
    });
  }

  function editMetaAd(ad) {
    const creative = ad.creative || {};
    const fields = [
      { key: 'name', label: 'Ad name', max: 180, wide: true },
      { key: 'status', label: 'Status', type: 'select', options: statusOptions }
    ];
    if (creative.editable) {
      const ctas = META_CTAS.includes(creative.cta) || !creative.cta ? META_CTAS : [creative.cta, ...META_CTAS];
      fields.push(
        { key: 'headline', label: 'Headline', max: 255, wide: true },
        { key: 'text', label: 'Primary text', type: 'textarea', rows: 5 },
        ...(creative.leadForm ? [] : [{ key: 'link', label: 'Website link', type: 'url', wide: true }]),
        ...(creative.cta ? [{ key: 'cta', label: 'Button', type: 'select', options: ctas.map((key) => [key, label(key.toLowerCase())]) }] : [])
      );
    }
    openEdit({
      title: `Edit ad · ${ad.name}`,
      fields,
      note: creative.editable
        ? 'Changing the headline, text, link, or button makes a new creative with the same image or video. Meta reviews the ad again.'
        : 'This ad uses a dynamic or catalog creative, so only the name and status can be changed here.',
      initial: { name: ad.name, status: ad.status, headline: creative.headline, text: creative.text, link: creative.link, cta: creative.cta },
      submit: (changes) => saveItem('ad', ad.id, changes)
    });
  }

  function editGoogleAd(ad) {
    const rsa = ad.type === 'RESPONSIVE_SEARCH_AD';
    const fields = [{ key: 'status', label: 'Status', type: 'select', options: statusOptions }];
    if (rsa) {
      fields.push(
        { key: 'headlines', label: 'Headlines (one per line, 3 to 15)', type: 'lines', max: 30, rows: 8 },
        { key: 'descriptions', label: 'Descriptions (one per line, 2 to 4)', type: 'lines', max: 90, rows: 4 },
        { key: 'finalUrl', label: 'Final URL', type: 'url', wide: true },
        { key: 'path1', label: 'Display path 1', max: 15 },
        { key: 'path2', label: 'Display path 2', max: 15 }
      );
    }
    openEdit({
      title: `Edit ad${ad.name ? ` · ${ad.name}` : ''}`,
      fields,
      note: rsa ? 'Google reviews the ad again after text changes.' : 'Only responsive search ads can have their text changed here.',
      initial: { status: ad.status, headlines: ad.headlines, descriptions: ad.descriptions, finalUrl: ad.finalUrl, path1: ad.path1, path2: ad.path2 },
      submit: (changes) => saveItem('ad', ad.id, changes)
    });
  }

  function editGroup(group) {
    openEdit({
      title: `Edit ad group · ${group.name}`,
      fields: [
        { key: 'name', label: 'Ad group name', max: 255, wide: true },
        { key: 'status', label: 'Status', type: 'select', options: statusOptions },
        { key: 'cpcBid', label: `Max CPC bid (${currency})`, type: 'number', min: 0.01, step: '0.01', hint: 'Used with Manual CPC bidding.' }
      ],
      initial: { name: group.name, status: group.status, cpcBid: group.cpcBid || '' },
      submit: (changes) => saveItem('ad_group', group.id, changes)
    });
  }

  function addKeywords() {
    if (!groups.length) return;
    openEdit({
      title: 'Add keywords',
      fields: [
        { key: 'group', label: 'Ad group', type: 'select', options: groups.map((group) => [group.id, group.name]) },
        { key: 'matchType', label: 'Match type', type: 'select', options: [['PHRASE', 'Phrase'], ['EXACT', 'Exact'], ['BROAD', 'Broad']] },
        { key: 'keywords', label: 'Keywords (one per line)', type: 'lines', max: 80, rows: 6 }
      ],
      initial: { group: groups[0].id, matchType: 'PHRASE', keywords: [] },
      submit: (_changes, values) => {
        const list = editValue({ type: 'lines' }, values.keywords);
        if (!list.length) {
          setEditError('Add at least one keyword.');
          return undefined;
        }
        return saveItem('keywords', values.group, { keywords: list.map((text) => ({ text, matchType: values.matchType })) });
      }
    });
  }

  function removeKeyword(row) {
    if (!window.confirm(`Remove the keyword "${row.text}"? This cannot be undone.`)) return;
    saveItem('keyword', row.id, { status: 'REMOVED' });
  }

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('has-drawer');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-drawer');
    };
  }, []);

  const facts = info ? [
    ['Status', <Badge key="s" value={meta ? String(info.delivery || info.status).toLowerCase().replace(/_/g, ' ') : googleStatus(info.status)} />],
    [meta ? 'Objective' : 'Type', label(String((meta ? info.objective : info.channel) || '').replace('OUTCOME_', '').toLowerCase()) || '—'],
    ['Budget', info.budget ? `${money(info.budget, currency)}${info.budgetKind ? ` · ${info.budgetKind}` : ''}` : '—'],
    [meta ? 'Schedule' : 'Bidding', meta
      ? `${info.startTime ? day(info.startTime) : '—'}${info.stopTime ? ` to ${day(info.stopTime)}` : ' · no end date'}`
      : label(String(info.bidding || '').toLowerCase()) || '—'],
    ...(meta ? [] : [['Schedule', `${info.startDate ? day(info.startDate) : '—'}${info.endDate && !info.endDate.startsWith('2037') ? ` to ${day(info.endDate)}` : ' · no end date'}`]])
  ] : [];

  return (
    <div className="drawer-layer" role="dialog" aria-modal="true" aria-label={`${campaign.name} details`}>
      <button type="button" className="drawer-scrim" aria-label="Close" onClick={onClose} />
      <aside className={`campaign-drawer is-${brand}`}>
        <header className="drawer-head">
          <span className={`ads-mark is-${brand}`} aria-hidden="true">{meta ? 'M' : 'G'}</span>
          <div>
            <p className="eyebrow">{meta ? 'Meta campaign' : 'Google Ads campaign'}</p>
            <h2>{info?.name || campaign.name}</h2>
          </div>
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="drawer-body" ref={bodyRef}>
          {notice ? <p className="ads-alert is-good">{notice}</p> : null}
          {editError && !editing ? <p className="ads-alert is-bad">{editError}</p> : null}
          {editing ? (
            <EditForm
              key={editing.token}
              editing={editing}
              busy={Boolean(saving)}
              error={editError}
              onCancel={() => { setEditing(null); setEditError(''); }}
              onSave={(changes, values) => editing.submit(changes, values)}
            />
          ) : null}
          {facts.length ? (
            <dl className="drawer-facts">
              {facts.map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
            </dl>
          ) : null}
          {canManage && info ? (
            <div className="page-actions drawer-actions">
              <button className="btn-primary" type="button" onClick={editCampaign}>Edit campaign</button>
              {statusButton('campaign', info.id, info.status, info.name)}
              {!meta && groups.length ? <button className="btn" type="button" onClick={addKeywords}>+ Add keywords</button> : null}
            </div>
          ) : null}
          {!meta && info?.locations?.length ? (
            <div className="cy-chips">{info.locations.map((place) => <span key={place.id} className="chip is-soft">{place.name}</span>)}</div>
          ) : null}
          <div className="tabs ads-range">
            {GOOGLE_RANGES.map(([key, text]) => (
              <button key={key} type="button" className={range === key ? 'is-on' : ''} onClick={() => setRange(key)}>{text}</button>
            ))}
          </div>
          {error ? (
            <div className="error-box">
              <strong>The campaign could not be loaded.</strong>
              <p className="quiet">{error}</p>
              <button className="btn" type="button" onClick={() => reload()}>Try again</button>
            </div>
          ) : null}
          {!data && loading ? <div className="skeleton-block" aria-busy="true" /> : null}
          {data?.notes?.length ? <p className="quiet">Some parts did not load: {data.notes.join(' · ')}</p> : null}
          {data ? (
            <div className={loading ? 'is-loading stack' : 'stack'}>
              <KpiCards items={resultCards(daily, resultKey, resultLabel, currency)} />
              <section className="drawer-section">
                <div className="trend-head">
                  <h3>Daily trend</h3>
                  <div className="chip-tabs">
                    {[['spend', 'Spend'], ['impressions', 'Impressions'], ['clicks', 'Clicks'], [resultKey, label(resultLabel)]].map(([key, text]) => (
                      <button key={key} type="button" className={field === key ? 'is-on' : ''} onClick={() => setField(key)}>{text}</button>
                    ))}
                  </div>
                </div>
                {daily.length > 1 ? (
                  <TrendChart
                    points={daily}
                    field={field}
                    format={(value, short) => (field === 'spend' ? (short ? `₹${compact(Math.round(value))}` : money(value, currency)) : (short ? compact(Math.round(value)) : num(value)))}
                    tooltip={(row) => [['Spend', money(row.spend, currency)], ['Impressions', num(row.impressions)], ['Clicks', num(row.clicks)], [label(resultLabel), num(row[resultKey])]]}
                  />
                ) : <p className="quiet">No daily delivery in this range.</p>}
              </section>
              <div className="tabs" role="tablist">
                {tabs.map((item) => (
                  <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'is-on' : ''} onClick={() => setTab(item)}>
                    {item} · {num(counts[item])}
                  </button>
                ))}
              </div>
              {tab === 'Ads' ? (
                ads.length ? (
                  <div className="ad-cards">
                    {ads.map((ad) => {
                      const actions = canManage ? (
                        <div className="page-actions ad-card-actions">
                          <button className="btn" type="button" onClick={() => (meta ? editMetaAd(ad) : editGoogleAd(ad))}>Edit</button>
                          {statusButton('ad', ad.id, ad.status, ad.name || 'this ad')}
                        </div>
                      ) : null;
                      return meta
                        ? <MetaAdCard key={ad.id} ad={ad} adsetName={groupName.get(ad.adsetId)} currency={currency} actions={actions} />
                        : <GoogleAdCard key={ad.id} ad={ad} groupName={groupName.get(ad.groupId)} currency={currency} actions={actions} />;
                    })}
                  </div>
                ) : <p className="quiet">This campaign has no ads.</p>
              ) : null}
              {tab === 'Ad sets' ? (
                groups.length ? (
                  <div className="ad-cards">
                    {groups.map((set) => (
                      <article key={set.id} className="ad-card">
                        <div className="ad-card-head">
                          <div>
                            <strong>{set.name}</strong>
                            <em>{set.budget ? `${money(set.budget, currency)} ${set.budgetKind}` : 'Uses campaign budget'}{set.goal ? ` · ${label(set.goal.toLowerCase())}` : ''}</em>
                          </div>
                          <Badge value={String(set.delivery || set.status).toLowerCase().replace(/_/g, ' ')} />
                        </div>
                        <dl className="drawer-facts is-compact">
                          <div><dt>Age</dt><dd>{set.targeting.age || '—'}</dd></div>
                          <div><dt>Gender</dt><dd>{set.targeting.gender}</dd></div>
                          <div><dt>Advantage+ audience</dt><dd>{set.targeting.advantage ? 'On' : 'Off'}</dd></div>
                          <div><dt>Destination</dt><dd>{label(String(set.destination || '').toLowerCase()) || '—'}</dd></div>
                        </dl>
                        {set.targeting.places.length ? <div className="cy-chips">{set.targeting.places.map((place) => <span key={place} className="chip">{place}</span>)}</div> : null}
                        {set.targeting.interests.length ? <div className="cy-chips">{set.targeting.interests.map((item) => <span key={item} className="chip is-soft">{item}</span>)}</div> : null}
                        <StatLine row={set} currency={currency} resultKey="leads" resultLabel="leads" />
                        {canManage ? (
                          <div className="page-actions ad-card-actions">
                            <button className="btn" type="button" onClick={() => editAdset(set)}>Edit</button>
                            {statusButton('adset', set.id, set.status, set.name)}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : <p className="quiet">This campaign has no ad sets.</p>
              ) : null}
              {tab === 'Ad groups' ? (
                <Table columns={[
                  { key: 'name', label: 'Ad group' },
                  { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.status)} /> },
                  { key: 'bid', label: 'Max CPC', render: (row) => money(row.cpcBid, currency) },
                  { key: 'spend', label: 'Spend', render: (row) => money(row.spend, currency) },
                  { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.clicks) },
                  { key: 'ctr', label: 'CTR', render: (row) => pct(ratio(row.clicks, row.impressions)) },
                  { key: 'conversions', label: 'Conv.', render: (row) => countCell(row.conversions) },
                  ...(canManage ? [{ key: 'action', label: '', render: (row) => (
                    <span className="page-actions">
                      <button className="btn" type="button" onClick={() => editGroup(row)}>Edit</button>
                      {statusButton('ad_group', row.id, row.status, row.name)}
                    </span>
                  ) }] : [])
                ]} rows={groups} />
              ) : null}
              {tab === 'Keywords' ? (
                <Table columns={[
                  { key: 'text', label: 'Keyword' },
                  { key: 'match', label: 'Match', render: (row) => label(String(row.matchType || '').toLowerCase()) || '—' },
                  { key: 'group', label: 'Ad group', render: (row) => groupName.get(row.groupId) || '—' },
                  { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.status)} /> },
                  { key: 'spend', label: 'Spend', render: (row) => money(row.spend, currency) },
                  { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.clicks) },
                  { key: 'ctr', label: 'CTR', render: (row) => pct(ratio(row.clicks, row.impressions)) },
                  { key: 'conversions', label: 'Conv.', render: (row) => countCell(row.conversions) },
                  ...(canManage ? [{ key: 'action', label: '', render: (row) => (
                    <span className="page-actions">
                      {statusButton('keyword', row.id, row.status, row.text)}
                      <button className="btn-ghost" type="button" disabled={Boolean(saving)} onClick={() => removeKeyword(row)}>Remove</button>
                    </span>
                  ) }] : [])
                ]} rows={keywords} />
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function AdsTableHead({ tabs, view, onView, counts, query, onQuery, found }) {
  return (
    <div className="cy-tab-head">
      <div className="tabs" role="tablist">
        {tabs.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={view === item} className={view === item ? 'is-on' : ''} onClick={() => onView(item)}>
            {item}{counts[item] != null ? ` · ${num(counts[item])}` : ''}
          </button>
        ))}
      </div>
      {onQuery ? <SearchBox value={query} onChange={onQuery} placeholder={`Search ${view.toLowerCase()}`} count={found} /> : null}
    </div>
  );
}

function MetaAdsManager({ id, data, canManage, reload }) {
  const campaigns = (data.records || []).filter((row) => row.type === 'campaign' && row.origin === 'api');
  const adsets = (data.records || []).filter((row) => row.type === 'adset' && row.origin === 'api');
  const ads = (data.records || []).filter((row) => row.type === 'ad' && row.origin === 'api');
  const currency = campaigns.find((row) => row.fields?.currency)?.fields.currency || 'INR';
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
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [range, setRange] = useState('LAST_30_DAYS');
  const [audienceMetric, setAudienceMetric] = useState('spend');
  const [opened, setOpened] = useState(null);
  const { report, busy: reportBusy, error: reportError } = useAdsReport(id, 'meta', range);
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
      setCreating(false);
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
  const rangeRows = (report?.campaigns || []).map((row) => ({ id: row.id, name: row.name, fields: row }));
  const allRows = view === 'Ad sets' ? adsets : view === 'Ads' ? ads : view === 'Report' ? rangeRows : campaigns;
  const rows = allRows.filter((row) => matches(query, row.name, row.fields?.status, row.fields?.objective));
  const spend = total(campaigns, 'spend');
  const impressions = total(campaigns, 'impressions');
  const clicks = total(campaigns, 'clicks');
  const leads = total(campaigns, 'leads');
  const cpc = ratio(spend, clicks);
  const cpl = ratio(spend, leads);
  const reportCurrency = report?.currency || currency;
  const reportDaily = report?.daily || [];
  const platformNames = { facebook: 'Facebook', instagram: 'Instagram', audience_network: 'Audience Network', messenger: 'Messenger', threads: 'Threads' };
  const platforms = (report?.platforms || [])
    .map((row) => ({ label: platformNames[row.name] || label(row.name), value: Number(row.spend || 0), clicks: Number(row.clicks || 0) }))
    .sort((a, b) => b.value - a.value);
  const rangeCampaigns = rangeRows;
  const campaignTitle = new Map(campaigns.map((row) => [row.externalId, row.name]));
  const adsetCampaign = new Map(adsets.map((row) => [row.externalId, row.parent]));
  function openCampaign(row) {
    const campaignId = view === 'Report' ? row.id
      : view === 'Ad sets' ? row.parent
        : view === 'Ads' ? row.fields?.campaignId || adsetCampaign.get(row.parent)
          : row.externalId;
    if (!/^\d+$/.test(String(campaignId || ''))) return;
    setOpened({ id: String(campaignId), name: campaignTitle.get(String(campaignId)) || row.name, currency });
  }
  const audienceFormat = audienceMetric === 'spend' ? (value) => money(value, reportCurrency) : (value) => num(value);

  return (
    <div className="stack">
      <AdsHeader
        brand="meta"
        title="Meta Ads"
        account={data.accountLabel}
        job={data.jobs?.[0]}
        counts={[
          ['campaigns', campaigns.length],
          ['active', campaigns.filter((row) => row.fields?.status === 'ACTIVE').length, 'good'],
          ['ads', ads.length]
        ]}
        canManage={canManage}
        creating={creating}
        onCreate={() => { setCreating((current) => !current); setError(''); }}
        createLabel="Create ad"
      />
      <AdsAlerts notice={notice} error={error} />
      {reportError ? (
        <Tiles items={[
          { label: 'Spend · 30 days', value: money(spend, currency), hint: cpc == null ? 'No clicks yet' : `${money(cpc, currency)} per click` },
          { label: 'Impressions', value: impressions == null ? '—' : num(impressions), hint: `Across ${num(campaigns.length)} campaigns` },
          { label: 'Clicks', value: clicks == null ? '—' : num(clicks), hint: `CTR ${pct(ratio(clicks, impressions))}` },
          { label: 'Leads', value: leads == null ? '—' : num(leads), hint: cpl == null ? 'No leads yet' : `${money(cpl, currency)} per lead` }
        ]} />
      ) : null}
      {canManage && creating ? (
        <form className="form-grid panel ads-wizard" onSubmit={createAd}>
          <header>
            <div>
              <h2>Create ad</h2>
              <p>Step {step + 1} of {steps.length} · Ads are saved paused unless you press Publish.</p>
            </div>
          </header>
          <div className="ad-steps" aria-label="Ad steps">
            {steps.map((item, index) => (
              <span key={item} className={index === step ? 'is-on' : index < step ? 'is-done' : ''}>
                <b>{index + 1}</b>{item}
              </span>
            ))}
          </div>
          {step === 0 ? (
            <div className="ads-step">
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
            </div>
          ) : null}
          {step === 1 ? (
            <div className="ads-step">
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
            </div>
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
            <div className="ad-studio">
              <div className="stack">
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
              </div>
              <aside className="ad-preview">
                <p>Preview</p>
                <strong>{pageName}</strong>
                <em>{instagramName}</em>
                {imageBase64 ? <img src={imageBase64} alt="" /> : <div className="ad-preview-empty">Image</div>}
                <span>{message}</span>
                <b>{headline}</b>
                <small>{label(cta.toLowerCase())}</small>
              </aside>
            </div>
          ) : null}
          <div className="page-actions ads-actions">
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
      <AdsPerformance
        brand="meta"
        report={report}
        busy={reportBusy}
        error={reportError}
        range={range}
        onRange={setRange}
        fallbackCurrency={currency}
        resultKey="leads"
        resultLabel="leads"
      />
      {report ? (
        <>
          <div className="split is-even">
            <section className="panel">
              <header>
                <h2>Funnel</h2>
                <p>{GOOGLE_RANGES.find(([key]) => key === range)?.[1]}</p>
              </header>
              <FunnelSteps steps={[
                { label: 'Impressions', value: sumOf(reportDaily, 'impressions') },
                { label: 'Clicks', value: sumOf(reportDaily, 'clicks'), rateLabel: 'CTR' },
                { label: 'Leads', value: sumOf(reportDaily, 'leads'), rateLabel: 'of clicks' }
              ]} />
            </section>
            <section className="panel">
              <header>
                <h2>Spend by platform</h2>
                <p>Facebook, Instagram, and more</p>
              </header>
              {platforms.length ? (
                <Donut parts={platforms} center={money(sumOf(platforms, 'value'), reportCurrency)} sub="spend" format={(value) => money(value, reportCurrency)} />
              ) : <p className="quiet">Meta returned no platform split for this range.</p>}
            </section>
          </div>
          <div className="split is-even">
            <section className="panel">
              <header>
                <h2>Audience by age</h2>
                <div className="chip-tabs">
                  {[['spend', 'Spend'], ['clicks', 'Clicks'], ['leads', 'Leads']].map(([key, text]) => (
                    <button key={key} type="button" className={audienceMetric === key ? 'is-on' : ''} onClick={() => setAudienceMetric(key)}>{text}</button>
                  ))}
                </div>
              </header>
              <p className="chart-legend audience-legend"><span className="dot is-male" />Men <span className="dot is-female" />Women <span className="dot muted" />Unknown</p>
              <AudienceBars rows={report.audience || []} metric={audienceMetric} format={audienceFormat} />
            </section>
            <section className="panel">
              <header>
                <h2>Top campaigns by spend</h2>
                <p>{num(campaigns.filter((row) => row.fields?.status === 'ACTIVE').length)} of {num(campaigns.length)} active</p>
              </header>
              <SpendBars rows={rangeCampaigns} currency={reportCurrency} resultKey="leads" resultLabel="leads" onPick={(row) => setOpened({ id: String(row.id), name: row.name, currency: reportCurrency })} />
              <div className="status-mini">
                <StatusMix rows={campaigns} active="ACTIVE" />
              </div>
            </section>
          </div>
        </>
      ) : null}
      <section className="panel">
      <AdsTableHead
        tabs={['Campaigns', 'Ad sets', 'Ads', 'Report']}
        view={view}
        onView={setView}
        counts={{ Campaigns: campaigns.length, 'Ad sets': adsets.length, Ads: ads.length }}
        query={query}
        onQuery={setQuery}
        found={rows.length}
      />
      {view === 'Report' ? (
        <p className="quiet cy-note">Campaign results for {String(GOOGLE_RANGES.find(([key]) => key === range)?.[1] || '').toLowerCase()}, live from Meta. Change the range in Performance above.</p>
      ) : null}
      {rows.length && view === 'Report' ? (
        <Table onRow={openCampaign} columns={[
          { key: 'name', label: 'Campaign', render: (row) => <CampaignName name={row.name} /> },
          { key: 'spend', label: 'Spend', render: (row) => money(row.fields.spend, reportCurrency) },
          { key: 'impressions', label: 'Impr.', render: (row) => countCell(row.fields.impressions) },
          { key: 'reach', label: 'Reach', render: (row) => countCell(row.fields.reach) },
          { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.fields.clicks) },
          { key: 'ctr', label: 'CTR', render: (row) => pct(ratio(row.fields.clicks, row.fields.impressions)) },
          { key: 'cpc', label: 'CPC', render: (row) => money(ratio(row.fields.spend, row.fields.clicks), reportCurrency) },
          { key: 'leads', label: 'Leads', render: (row) => countCell(row.fields.leads) },
          { key: 'cpl', label: 'Cost / lead', render: (row) => money(ratio(row.fields.spend, row.fields.leads), reportCurrency) }
        ]} rows={rows} />
      ) : rows.length ? (
        <Table onRow={openCampaign} columns={view === 'Campaigns' ? [
          { key: 'name', label: 'Campaign', render: (row) => <CampaignName name={row.name} /> },
          { key: 'status', label: 'Status', render: (row) => <Badge value={String(row.fields?.status || '').toLowerCase()} /> },
          { key: 'objective', label: 'Objective', render: (row) => label(String(row.fields?.objective || '').replace('OUTCOME_', '').toLowerCase()) },
          { key: 'budget', label: 'Budget', render: (row) => money(row.fields?.budget, row.fields?.currency) },
          { key: 'spend', label: 'Spend', render: (row) => money(row.fields?.spend, row.fields?.currency) },
          { key: 'clicks', label: 'Clicks', render: (row) => row.fields?.clicks == null || row.fields?.clicks === '' ? '—' : num(row.fields.clicks) },
          { key: 'leads', label: 'Leads', render: (row) => row.fields?.leads == null || row.fields?.leads === '' ? '—' : num(row.fields.leads) },
          { key: 'action', label: '', render: (row) => canManage && (row.fields?.status === 'ACTIVE' || row.fields?.status === 'PAUSED') ? (
            <span className="page-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <button className="btn" type="button" disabled={busy} onClick={() => setOpened({ id: String(row.externalId), name: row.name, currency, edit: true })}>Edit</button>
              <button className="btn" type="button" disabled={busy} onClick={() => setCampaignStatus(row.externalId, row.fields.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}>
                {row.fields.status === 'ACTIVE' ? 'Pause' : 'Turn on'}
              </button>
            </span>
          ) : null }
        ] : [
          { key: 'name', label: view === 'Ads' ? 'Ad' : 'Ad set', render: (row) => <CampaignName name={row.name} /> },
          { key: 'campaign', label: 'Campaign', render: (row) => campaignTitle.get(view === 'Ad sets' ? row.parent : row.fields?.campaignId || adsetCampaign.get(row.parent)) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={String(row.fields?.delivery || row.fields?.status || '').toLowerCase().replace(/_/g, ' ')} /> },
          ...(view === 'Ad sets' ? [{ key: 'budget', label: 'Budget', render: (row) => money(row.fields?.budget, row.fields?.currency) }] : [])
        ]} rows={rows} />
      ) : (
        <div className="empty">
          <strong>{query ? `No ${view.toLowerCase()} match "${query}".` : `No ${view.toLowerCase()} from Meta.`}</strong>
          <p className="quiet">{query ? 'Clear the search to see all of them.' : 'Sync reads this account from Meta. Sample campaigns are not listed here.'}</p>
        </div>
      )}
      </section>
      {opened ? <CampaignDrawer brand="meta" connectionId={id} campaign={opened} initialRange={range} onClose={() => setOpened(null)} canManage={canManage} onChanged={reload} /> : null}
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [range, setRange] = useState('LAST_30_DAYS');
  const { report, busy: reportBusy, error: reportError } = useAdsReport(id, 'google', range);
  const [opened, setOpened] = useState(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
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
      setCreating(false);
      setNotice(saved?.notice || 'Campaign saved on Google Ads.');
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
  const tabs = ['Campaigns', 'Ad groups', 'Keywords', 'Ads', 'Report'];
  const spend = total(campaigns, 'spend');
  const impressions = total(campaigns, 'impressions');
  const clicks = total(campaigns, 'clicks');
  const conversions = total(campaigns, 'conversions');
  const cpc = ratio(spend, clicks);
  const cpa = ratio(spend, conversions);
  const listed = {
    Campaigns: campaigns.filter((row) => matches(query, row.name, row.fields?.status, row.fields?.channel)),
    'Ad groups': adGroups.filter((row) => matches(query, row.name, campaignName.get(row.parent), row.fields?.status)),
    Keywords: keywordRows.filter((row) => matches(query, row.name, row.fields?.matchType, groupName.get(row.parent), groupCampaign.get(row.parent))),
    Ads: ads.filter((row) => matches(query, row.name, row.fields?.adType, groupName.get(row.parent), row.fields?.approval))
  };
  const reportCurrency = report?.currency || currency;
  const deviceNames = { MOBILE: 'Mobile', DESKTOP: 'Desktop', TABLET: 'Tablet', CONNECTED_TV: 'TV screens', OTHER: 'Other' };
  const devices = (report?.devices || [])
    .map((row) => ({ label: deviceNames[row.name] || label(String(row.name).toLowerCase()), value: Number(row.spend || 0) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const rangeCampaigns = (report?.campaigns || []).map((row) => ({ id: row.id, name: row.name, fields: row }));
  const groupParent = new Map(adGroups.map((row) => [row.externalId, row.parent]));
  function openCampaign(campaignId, name) {
    if (!/^\d+$/.test(String(campaignId || ''))) return;
    setOpened({ id: String(campaignId), name: name || campaignName.get(String(campaignId)) || 'Campaign', currency });
  }

  return (
    <div className="stack">
      <AdsHeader
        brand="google"
        title="Google Ads"
        account={data.accountLabel}
        job={data.jobs?.[0]}
        counts={[
          ['campaigns', campaigns.length],
          ['enabled', campaigns.filter((row) => row.fields?.status === 'ENABLED').length, 'good'],
          ['keywords', keywordRows.length]
        ]}
        canManage={canManage}
        creating={creating}
        onCreate={() => { setCreating((current) => !current); setError(''); }}
        createLabel="Create campaign"
      />
      <AdsAlerts notice={notice} error={error} />
      {reportError ? (
        <Tiles items={[
          { label: 'Spend · 30 days', value: money(spend, currency), hint: cpc == null ? 'No clicks yet' : `${money(cpc, currency)} avg. CPC` },
          { label: 'Impressions', value: countCell(impressions), hint: `Across ${num(campaigns.length)} campaigns` },
          { label: 'Clicks', value: countCell(clicks), hint: `CTR ${pct(ratio(clicks, impressions))}` },
          { label: 'Conversions', value: countCell(conversions), hint: cpa == null ? 'No conversions yet' : `${money(cpa, currency)} per conversion` }
        ]} />
      ) : null}
      {canManage && creating ? (
        <form className="form-grid panel ads-wizard" onSubmit={createCampaign}>
          <header>
            <div>
              <h2>Create Search campaign</h2>
              <p>Step {step + 1} of {steps.length} · Campaigns are saved paused unless you press Publish.</p>
            </div>
          </header>
          <div className="ad-steps" aria-label="Campaign steps">
            {steps.map((item, index) => (
              <span key={item} className={index === step ? 'is-on' : index < step ? 'is-done' : ''}>
                <b>{index + 1}</b>{item}
              </span>
            ))}
          </div>
          {step === 0 ? (
            <div className="ads-step">
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
            </div>
          ) : null}
          {step === 1 ? (
            <div className="ads-step">
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
            </div>
          ) : null}
          {step === 2 ? (
            <div className="ads-step">
              <label className="stack-field wide">Keywords, one per line
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
              <label className="stack-field wide">Negative keywords, one per line
                <textarea rows={3} value={negativeText} onChange={(event) => setNegativeText(event.target.value)} placeholder={'free\nrent\njobs'} />
              </label>
            </div>
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
            <div className="ad-studio">
              <div className="stack">
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
              <p className="quiet">Save paused creates everything in Google Ads without spending. Publish turns the campaign on. Google reviews the ad before it shows.</p>
              </div>
              {preview}
            </div>
          ) : null}
          <div className="page-actions ads-actions">
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
      <AdsPerformance
        brand="google"
        report={report}
        busy={reportBusy}
        error={reportError}
        range={range}
        onRange={setRange}
        fallbackCurrency={currency}
        resultKey="conversions"
        resultLabel="conversions"
      />
      {report ? (
        <>
          <div className="split is-even">
            <section className="panel">
              <header>
                <h2>Funnel</h2>
                <p>{GOOGLE_RANGES.find(([key]) => key === range)?.[1]}</p>
              </header>
              <FunnelSteps steps={[
                { label: 'Impressions', value: sumOf(daily, 'impressions') },
                { label: 'Clicks', value: sumOf(daily, 'clicks'), rateLabel: 'CTR' },
                { label: 'Conversions', value: sumOf(daily, 'conversions'), rateLabel: 'conv. rate' }
              ]} />
            </section>
            <section className="panel">
              <header>
                <h2>Spend by device</h2>
                <p>Mobile, desktop, and tablet</p>
              </header>
              {devices.length ? (
                <Donut parts={devices} center={money(sumOf(devices, 'value'), reportCurrency)} sub="spend" format={(value) => money(value, reportCurrency)} />
              ) : <p className="quiet">Google returned no device split for this range.</p>}
            </section>
          </div>
          <div className="split is-even">
            <section className="panel">
              <header>
                <h2>Top campaigns by spend</h2>
                <p>{GOOGLE_RANGES.find(([key]) => key === range)?.[1]}</p>
              </header>
              <SpendBars rows={rangeCampaigns} currency={reportCurrency} resultKey="conversions" resultLabel="conv." onPick={(row) => openCampaign(row.id)} />
            </section>
            <section className="panel">
              <header>
                <h2>Campaign status</h2>
                <p>{num(campaigns.length)} campaigns</p>
              </header>
              <StatusMix rows={campaigns} active="ENABLED" />
              <ul className="split-legend top-terms">
                {(report.searchTerms || []).slice(0, 5).map((row) => (
                  <li key={row.id}><span>{row.term}</span><strong>{countCell(row.clicks)}</strong><em>clicks</em></li>
                ))}
              </ul>
              {(report.searchTerms || []).length ? <p className="quiet">Top search terms by clicks</p> : null}
            </section>
          </div>
        </>
      ) : null}
      <section className="panel">
      <AdsTableHead
        tabs={tabs}
        view={view}
        onView={setView}
        counts={{ Campaigns: campaigns.length, 'Ad groups': adGroups.length, Keywords: keywordRows.length, Ads: ads.length }}
        query={query}
        onQuery={view === 'Report' ? null : setQuery}
        found={listed[view]?.length}
      />
      {view === 'Campaigns' ? (
        listed.Campaigns.length ? (
          <Table onRow={(row) => openCampaign(row.externalId, row.name)} columns={[
            { key: 'name', label: 'Campaign', render: (row) => <CampaignName name={row.name} /> },
            { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> },
            { key: 'channel', label: 'Type', render: (row) => label(String(row.fields?.channel || '').toLowerCase()) || '—' },
            { key: 'budget', label: 'Daily budget', render: (row) => money(row.fields?.budget, row.fields?.currency) },
            { key: 'spend', label: 'Spend', render: (row) => money(row.fields?.spend, row.fields?.currency) },
            { key: 'clicks', label: 'Clicks', render: (row) => countCell(row.fields?.clicks) },
            { key: 'conversions', label: 'Conversions', render: (row) => countCell(row.fields?.conversions) },
            { key: 'action', label: '', render: (row) => canManage && (row.fields?.status === 'ENABLED' || row.fields?.status === 'PAUSED') ? (
              <span className="page-actions" onClick={(event) => event.stopPropagation()}>
                <button className="btn" type="button" disabled={busy} onClick={() => setOpened({ id: String(row.externalId), name: row.name, currency, edit: true })}>Edit</button>
                <button className="btn" type="button" disabled={busy} onClick={() => setCampaignStatus(row.externalId, row.fields.status === 'ENABLED' ? 'PAUSED' : 'ENABLED')}>
                  {row.fields.status === 'ENABLED' ? 'Pause' : 'Turn on'}
                </button>
              </span>
            ) : null }
          ]} rows={listed.Campaigns} />
        ) : (
          <div className="empty">
            <strong>{query ? `No campaigns match "${query}".` : 'No campaigns from Google Ads.'}</strong>
            <p className="quiet">{query ? 'Clear the search to see all of them.' : 'Sync reads this account from Google. Sample campaigns are not listed here.'}</p>
          </div>
        )
      ) : null}
      {view === 'Ad groups' ? (
        <Table onRow={(row) => openCampaign(row.parent)} columns={[
          { key: 'name', label: 'Ad group', render: (row) => <CampaignName name={row.name} /> },
          { key: 'campaign', label: 'Campaign', render: (row) => campaignName.get(row.parent) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> }
        ]} rows={listed['Ad groups']} />
      ) : null}
      {view === 'Keywords' ? (
        <Table onRow={(row) => openCampaign(groupParent.get(row.parent))} columns={[
          { key: 'name', label: 'Keyword', render: (row) => <CampaignName name={row.name} /> },
          { key: 'match', label: 'Match', render: (row) => label(String(row.fields?.matchType || '').toLowerCase()) || '—' },
          { key: 'group', label: 'Ad group', render: (row) => groupName.get(row.parent) || '—' },
          { key: 'campaign', label: 'Campaign', render: (row) => groupCampaign.get(row.parent) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> }
        ]} rows={listed.Keywords} />
      ) : null}
      {view === 'Ads' ? (
        <Table onRow={(row) => openCampaign(groupParent.get(row.parent))} columns={[
          { key: 'name', label: 'Ad', render: (row) => <CampaignName name={row.name} /> },
          { key: 'type', label: 'Type', render: (row) => label(String(row.fields?.adType || '').toLowerCase()) || '—' },
          { key: 'group', label: 'Ad group', render: (row) => groupName.get(row.parent) || '—' },
          { key: 'campaign', label: 'Campaign', render: (row) => groupCampaign.get(row.parent) || '—' },
          { key: 'approval', label: 'Review', render: (row) => label(String(row.fields?.approval || '').toLowerCase()) || '—' },
          { key: 'status', label: 'Status', render: (row) => <Badge value={googleStatus(row.fields?.status)} /> }
        ]} rows={listed.Ads} />
      ) : null}
      {view === 'Report' ? (
        <div className="stack">
          <p className="quiet cy-note">Results for {String(GOOGLE_RANGES.find(([key]) => key === range)?.[1] || '').toLowerCase()}, live from Google Ads. Change the range in Performance above.</p>
          {reportBusy ? <p className="quiet">Reading the report from Google Ads…</p> : null}
          {reportError ? <p className="ads-alert is-bad">{reportError}</p> : null}
          {report && !reportBusy ? (
            <>
              <h3>Campaigns</h3>
              <Table onRow={(row) => openCampaign(row.id, row.name)} columns={[
                { key: 'name', label: 'Campaign', render: (row) => <CampaignName name={row.name} /> },
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
      </section>
      {opened ? <CampaignDrawer brand="google" connectionId={id} campaign={opened} initialRange={range} onClose={() => setOpened(null)} canManage={canManage} onChanged={reload} /> : null}
    </div>
  );
}

function localTime(value) {
  if (!value) return '—';
  const date = parseIst(value);
  return Number.isNaN(date.getTime()) ? String(value) : indianDate(date);
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function fieldText(value) {
  if (value == null || value === '') return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (!DATE_TEXT.test(text)) return text;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? day(text) : localTime(text);
}

function talkTime(seconds) {
  const total = Math.round(Number(seconds || 0));
  if (!total) return '0m';
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${mins}m`;
  return mins ? `${mins}m ${total % 60}s` : `${total}s`;
}

function percent(part, whole) {
  return Number(whole) ? Math.round((Number(part || 0) / Number(whole)) * 100) : 0;
}

function callTone(status) {
  const text = String(status || '').toLowerCase();
  if (/miss|reject|fail|busy/.test(text)) return 'bad';
  if (/not answer|not picked|no answer|pending|cold/.test(text)) return 'warn';
  if (/connect|answer|complete|done|hot|interested/.test(text)) return 'good';
  return 'info';
}

function CallStatus({ value }) {
  if (!value) return '—';
  return <span className={`badge ${callTone(value)}`}>{value}</span>;
}

function Tiles({ items }) {
  return (
    <div className="metric-strip">
      {items.map((item) => (
        <div className="metric" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <em>{item.hint}</em>
        </div>
      ))}
    </div>
  );
}

function compact(value) {
  const amount = Number(value || 0);
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  return String(amount);
}

function dayLabel(date, long = false) {
  const parsed = parseIst(date);
  if (Number.isNaN(parsed.getTime())) return String(date || '—');
  if (!long) return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', timeZone: 'Asia/Kolkata' }).format(parsed);
  const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(parsed);
  return `${weekday}, ${day(date)}`;
}

function hourLabel(hour) {
  const suffix = hour < 12 ? 'am' : 'pm';
  return `${hour % 12 || 12}${suffix}`;
}

function sumTotals(list) {
  const out = {};
  for (const totals of list) {
    for (const [key, value] of Object.entries(totals || {})) {
      if (typeof value === 'number') out[key] = (out[key] || 0) + value;
    }
  }
  return out;
}

function mergeEmployees(days) {
  const byId = new Map();
  for (const row of days.flatMap((item) => item.employees || [])) {
    const key = row.employee_id ?? row.employee_name;
    const current = byId.get(key) || { employee_id: row.employee_id, employee_name: row.employee_name };
    for (const [field, value] of Object.entries(row)) {
      if (typeof value === 'number' && field !== 'employee_id' && field !== 'sno') current[field] = (current[field] || 0) + value;
    }
    byId.set(key, current);
  }
  return [...byId.values()].map((row) => ({
    ...row,
    connected_calls_avg_duration_seconds: Number(row.connected_calls_duration_seconds || 0) / Math.max(Number(row.connected_calls || 0), 1)
  }));
}

function ColumnChart({ items, selected, onPick, dense = false }) {
  const max = Math.max(...items.map((item) => item.total), 1);
  return (
    <div className={`col-chart ${dense ? 'is-dense' : ''}`}>
      {items.map((item, index) => {
        const height = (item.total / max) * 100;
        const fill = item.total ? (item.connected / item.total) * 100 : 0;
        return (
          <button
            type="button"
            key={item.key}
            className={`col ${selected === item.key ? 'is-on' : ''}`}
            onClick={onPick ? () => onPick(item.key) : undefined}
            disabled={!onPick}
            title={`${item.title || item.label}: ${num(item.total)} calls, ${num(item.connected)} connected`}
          >
            {dense ? null : <span className="col-value">{compact(item.total)}</span>}
            <span className="col-track">
              <span className="col-bar" style={{ height: `${Math.max(height, item.total ? 2 : 0)}%` }}>
                <span className="col-fill" style={{ height: `${fill}%` }} />
              </span>
            </span>
            <span className="col-label">{!dense || index % 3 === 0 ? item.label : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

function SplitBar({ parts }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  return (
    <div className="split-bar">
      <div className="split-track">
        {parts.filter((part) => part.value > 0).map((part) => (
          <span key={part.label} className={`seg ${part.tone}`} style={{ width: `${(part.value / total) * 100}%` }} title={`${part.label}: ${num(part.value)}`} />
        ))}
      </div>
      <ul className="split-legend">
        {parts.map((part) => (
          <li key={part.label}>
            <span className={`dot ${part.tone}`} />
            <span>{part.label}</span>
            <strong>{num(part.value)}</strong>
            <em>{percent(part.value, total)}%</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

function matches(query, ...values) {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  return values.some((value) => String(value ?? '').toLowerCase().includes(text));
}

function SearchBox({ value, onChange, placeholder = 'Search', count }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const type = (text) => {
    setDraft(text);
    if (!text) onChange('');
  };
  return (
    <span className="search-box">
      <input
        type="search"
        value={draft}
        onChange={(event) => type(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); onChange(draft); } }}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      <button className="btn" type="button" onClick={() => onChange(draft)}>Search</button>
      {value && count != null ? <em>{num(count)} found</em> : null}
    </span>
  );
}

function TeamBars({ rows }) {
  const [all, setAll] = useState(false);
  const max = Math.max(...rows.map((row) => Number(row.total_calls || 0)), 1);
  const shown = all ? rows : rows.slice(0, 12);
  return (
    <div className="team-bars">
      {shown.map((row) => {
        const total = Number(row.total_calls || 0);
        const connected = Number(row.connected_calls || 0);
        return (
          <div className="team-row" key={row.employee_id ?? row.employee_name}>
            <span className="team-name" title={row.employee_name}>{row.employee_name || '—'}</span>
            <span className="team-track">
              <span className="team-total" style={{ width: `${(total / max) * 100}%` }}>
                <span className="team-conn" style={{ width: `${total ? (connected / total) * 100 : 0}%` }} />
              </span>
            </span>
            <strong>{num(total)}</strong>
            <em>{percent(connected, total)}%</em>
          </div>
        );
      })}
      {rows.length > 12 ? (
        <button type="button" className="btn-ghost" onClick={() => setAll((value) => !value)}>{all ? 'Show top 12' : `Show all ${rows.length}`}</button>
      ) : null}
    </div>
  );
}

function headGroups(heads, employees) {
  const owner = new Map();
  for (const head of heads) {
    for (const member of head.members) owner.set(String(member.employeeId), head.id);
  }
  const groups = heads.map((head) => ({ id: head.id, name: head.headName, size: head.members.length, rows: [] }));
  const unassigned = { id: 'unassigned', name: 'Not in a team', size: 0, rows: [] };
  for (const row of employees) {
    const headId = owner.get(String(row.employee_id));
    const group = groups.find((item) => item.id === headId) || unassigned;
    group.rows.push(row);
  }
  unassigned.size = unassigned.rows.length;
  const all = unassigned.rows.length ? [...groups, unassigned] : groups;
  return all.map((group) => ({ ...group, totals: sumTotals(group.rows) }))
    .sort((a, b) => (a.id === 'unassigned') - (b.id === 'unassigned') || Number(b.totals.total_calls || 0) - Number(a.totals.total_calls || 0));
}

function TeamHeadReport({ heads, employees, canManage, onEdit }) {
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState('');
  if (!heads.length) {
    return (
      <section className="panel">
        <header>
          <h2>Team head-wise</h2>
        </header>
        <div className="empty">
          <strong>No team heads set yet.</strong>
          <p className="quiet">Call Yatri's API does not send team heads or teams, so AIRO cannot group calls by head on its own. Pick each head and their members once; the report groups by them after that.</p>
          {canManage ? <button className="btn-primary" type="button" onClick={onEdit}>Set up team heads</button> : <p className="quiet">Ask an owner or manager to set up team heads.</p>}
        </div>
      </section>
    );
  }
  const groups = headGroups(heads, employees)
    .filter((group) => matches(query, group.name, ...group.rows.map((row) => row.employee_name)));
  const opened = groups.find((group) => group.id === open);
  const openedRows = !opened ? [] : matches(query, opened.name) ? opened.rows : opened.rows.filter((row) => matches(query, row.employee_name));
  return (
    <section className="panel">
      <header>
        <h2>Team head-wise</h2>
        <div className="row-actions">
          <SearchBox value={query} onChange={setQuery} placeholder="Search team head or member" count={groups.length} />
          {canManage ? <button className="btn" type="button" onClick={onEdit}>Edit team heads</button> : null}
        </div>
      </header>
      <p className="quiet cy-note">Head's own calls count in their team. Teams are set in AIRO.</p>
      <TeamBars rows={groups.map((group) => ({
        employee_id: group.id,
        employee_name: group.id === 'unassigned' ? `${group.name} (${group.size})` : `${group.name} · ${group.size}`,
        total_calls: group.totals.total_calls || 0,
        connected_calls: group.totals.connected_calls || 0
      }))} />
      <Table
        columns={[
          { key: 'name', label: 'Team head', render: (row) => <strong>{row.name}</strong> },
          { key: 'size', label: 'Members', render: (row) => num(row.size) },
          { key: 'calls', label: 'Calls', render: (row) => num(row.totals.total_calls) },
          { key: 'connected', label: 'Connected', render: (row) => `${num(row.totals.connected_calls)} (${percent(row.totals.connected_calls, row.totals.total_calls)}%)` },
          { key: 'missed', label: 'Missed', render: (row) => num(row.totals.missed_calls) },
          { key: 'notPicked', label: 'Not picked', render: (row) => num(row.totals.not_picked_calls) },
          { key: 'talk', label: 'Talk time', render: (row) => talkTime(row.totals.total_duration_seconds) },
          { key: 'per', label: 'Calls / member', render: (row) => num(Math.round(Number(row.totals.total_calls || 0) / Math.max(row.size, 1))) }
        ]}
        rows={groups}
        onRow={(row) => setOpen((current) => (current === row.id ? null : row.id))}
      />
      <p className="quiet">Click a team head to see their members.</p>
      {opened ? (
        <div className="cy-members">
          <h3>{opened.name} · members</h3>
          <Table
            columns={[
              { key: 'employee_name', label: 'Employee', render: (row) => row.employee_name || '—' },
              { key: 'total_calls', label: 'Calls', render: (row) => num(row.total_calls) },
              { key: 'connected_calls', label: 'Connected', render: (row) => `${num(row.connected_calls)} (${percent(row.connected_calls, row.total_calls)}%)` },
              { key: 'missed_calls', label: 'Missed', render: (row) => num(row.missed_calls) },
              { key: 'talk', label: 'Talk time', render: (row) => talkTime(row.total_duration_seconds) }
            ]}
            rows={[...openedRows].sort((a, b) => Number(b.total_calls || 0) - Number(a.total_calls || 0)).map((row) => ({ ...row, id: row.employee_id ?? row.employee_name }))}
          />
        </div>
      ) : null}
    </section>
  );
}

function TeamHeadEditor({ id, heads, people, onDone, onCancel }) {
  const [draft, setDraft] = useState(() => heads.map((head) => ({
    headEmployeeId: String(head.headEmployeeId),
    headName: head.headName,
    members: head.members.filter((member) => String(member.employeeId) !== String(head.headEmployeeId))
      .map((member) => ({ employeeId: String(member.employeeId), employeeName: member.employeeName }))
  })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const known = new Map(people.map((person) => [String(person.employeeId), person.employeeName]));
  for (const head of heads) {
    for (const member of head.members) if (!known.has(String(member.employeeId))) known.set(String(member.employeeId), member.employeeName);
  }
  const options = [...known.entries()].map(([employeeId, employeeName]) => ({ employeeId, employeeName }))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName));
  const used = new Set(draft.flatMap((head) => [head.headEmployeeId, ...head.members.map((member) => member.employeeId)]));
  const free = options.filter((option) => !used.has(option.employeeId));
  const freeShown = free.filter((option) => matches(query, option.employeeName));

  function addHead(employeeId) {
    const person = options.find((option) => option.employeeId === employeeId);
    if (!person) return;
    setDraft((current) => [...current, { headEmployeeId: person.employeeId, headName: person.employeeName, members: [] }]);
  }

  function addMember(headId, employeeId) {
    const person = options.find((option) => option.employeeId === employeeId);
    if (!person) return;
    setDraft((current) => current.map((head) => (head.headEmployeeId === headId ? { ...head, members: [...head.members, person] } : head)));
  }

  function removeMember(headId, employeeId) {
    setDraft((current) => current.map((head) => (head.headEmployeeId === headId ? { ...head, members: head.members.filter((member) => member.employeeId !== employeeId) } : head)));
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.put(`/api/connections/${id}/call-yatri/teams`, { heads: draft });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel cy-editor">
      <header>
        <h2>Set up team heads</h2>
        <p>{free.length} employees not in a team</p>
      </header>
      <p className="quiet">Pick a head from the Call Yatri employees, then add their members. One employee can be in one team only. The head's own calls count in their team.</p>
      <SearchBox value={query} onChange={setQuery} placeholder="Search employee to add" count={freeShown.length} />
      <label className="stack-field">Add a team head
        <select value="" onChange={(event) => addHead(event.target.value)}>
          <option value="">{query ? `Choose from ${freeShown.length} matching…` : 'Choose an employee…'}</option>
          {freeShown.map((option) => <option key={option.employeeId} value={option.employeeId}>{option.employeeName}</option>)}
        </select>
      </label>
      <div className="cy-heads">
        {draft.map((head) => (
          <article className="cy-head" key={head.headEmployeeId}>
            <header>
              <strong>{head.headName}</strong>
              <span className="quiet">{head.members.length + 1} in team</span>
              <button type="button" className="btn-ghost" onClick={() => setDraft((current) => current.filter((item) => item.headEmployeeId !== head.headEmployeeId))}>Remove head</button>
            </header>
            <div className="cy-chips">
              <span className="chip is-head">{head.headName} (head)</span>
              {head.members.map((member) => (
                <span className="chip" key={member.employeeId}>
                  {member.employeeName}
                  <button type="button" aria-label={`Remove ${member.employeeName}`} onClick={() => removeMember(head.headEmployeeId, member.employeeId)}>×</button>
                </span>
              ))}
            </div>
            <select value="" onChange={(event) => addMember(head.headEmployeeId, event.target.value)}>
              <option value="">{query ? `Add from ${freeShown.length} matching…` : 'Add a member…'}</option>
              {freeShown.map((option) => <option key={option.employeeId} value={option.employeeId}>{option.employeeName}</option>)}
            </select>
          </article>
        ))}
      </div>
      {error ? <p className="delta-down">{error}</p> : null}
      <div className="row-actions">
        <button className="btn-primary" type="button" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save team heads'}</button>
        <button className="btn-ghost" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function CallYatriReport({ id, canManage, onScope }) {
  const [day, setDay] = useState('');
  const [picked, setPicked] = useState(null);
  const [editing, setEditing] = useState(false);
  const [teamQuery, setTeamQuery] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const { data, loading, error, reload } = useResource(`/api/connections/${id}/call-yatri/stats${day ? `?day=${day}` : ''}`);
  const teams = useResource(`/api/connections/${id}/call-yatri/teams`);

  if (!data) {
    if (error) {
      return (
        <div className="error-box">
          <strong>The call report could not be loaded from Call Yatri.</strong>
          <p className="quiet">{error}</p>
          <button className="btn" onClick={() => reload()}>Try again</button>
        </div>
      );
    }
    return (
      <section className="panel">
        <p className="quiet">Loading the call report from Call Yatri. The first load takes a few seconds; it is cached for 10 minutes after that.</p>
        <div className="skeleton-block" aria-busy="true" />
      </section>
    );
  }

  const days = data.days || [];
  const today = days[days.length - 1]?.date || data.day;
  const scope = picked || today;
  const scoped = scope === 'week' ? days : days.filter((item) => item.date === scope);
  const totals = sumTotals(scoped.map((item) => item.totals));
  const employees = mergeEmployees(scoped).sort((a, b) => Number(b.total_calls || 0) - Number(a.total_calls || 0));
  const topCalls = Math.max(...employees.map((row) => Number(row.total_calls || 0)), 1);
  const connected = Number(totals.connected_calls || 0);
  const missed = Number(totals.missed_calls || 0);
  const rejected = Number(totals.rejected_calls || 0);
  const notPicked = Number(totals.not_picked_calls || 0);
  const other = Math.max(Number(totals.total_calls || 0) - connected - missed - rejected - notPicked, 0);
  const outgoing = Number(totals.outgoing_total_calls || 0);
  const incoming = Number(totals.incoming_total_calls || 0);
  const busiest = [...(data.hours || [])].sort((a, b) => Number(b.totals?.total_calls || 0) - Number(a.totals?.total_calls || 0))[0];
  const scopeLabel = scope === 'week'
    ? `Last 7 days · ${dayLabel(days[0]?.date || data.day)} to ${dayLabel(today)}`
    : `${scope === today ? 'Today · ' : ''}${dayLabel(scope, true)}`;
  const teamRows = employees.filter((row) => matches(teamQuery, row.employee_name));
  const tableRows = employees.filter((row) => matches(tableQuery, row.employee_name));

  function pickDay(date) {
    setPicked(date);
    if (date !== 'week') setDay(date === today ? '' : date);
    onScope?.(date === today ? '' : date);
  }

  return (
    <>
      <div className="cy-report-head">
        <div>
          <p className="eyebrow">Call report</p>
          <h2>{scopeLabel}</h2>
        </div>
        <div className="tabs">
          {[...days].reverse().map((item) => (
            <button type="button" key={item.date} className={scope === item.date ? 'is-on' : ''} onClick={() => pickDay(item.date)}>
              {item.date === today ? 'Today' : dayLabel(item.date)}
            </button>
          ))}
          <button type="button" className={scope === 'week' ? 'is-on' : ''} onClick={() => pickDay('week')}>Last 7 days</button>
        </div>
      </div>
      {data.failed?.length ? <p className="delta-down">Some report windows did not load: {data.failed.join('; ')}</p> : null}

      <Tiles items={[
        { label: 'Total calls', value: num(totals.total_calls), hint: `${num(totals.unique_clients)} unique clients` },
        { label: 'Connected', value: num(connected), hint: `${percent(connected, totals.total_calls)}% connect rate` },
        { label: 'Talk time', value: talkTime(totals.total_duration_seconds), hint: `Avg ${talkTime(Number(totals.connected_calls_duration_seconds || 0) / Math.max(connected, 1))} per connected call` },
        { label: 'Active team', value: num(employees.filter((row) => Number(row.total_calls || 0) > 0).length), hint: `${num(Math.round(Number(totals.total_calls || 0) / Math.max(employees.length, 1)))} calls per person` }
      ]} />

      <div className="split">
        <section className="panel">
          <header>
            <h2>Day-wise calls</h2>
            <p className="chart-legend"><span className="dot total" />Total <span className="dot good" />Connected</p>
          </header>
          <ColumnChart
            items={days.map((item) => ({
              key: item.date,
              label: dayLabel(item.date),
              title: dayLabel(item.date, true),
              total: Number(item.totals?.total_calls || 0),
              connected: Number(item.totals?.connected_calls || 0)
            }))}
            selected={scope}
            onPick={pickDay}
          />
          <p className="quiet">Click a day to see its status, team, and hourly split.</p>
        </section>
        <section className="panel">
          <header>
            <h2>Status-wise</h2>
            <p>{num(totals.total_calls)} calls</p>
          </header>
          <SplitBar parts={[
            { label: 'Connected', value: connected, tone: 'good' },
            { label: 'Not picked', value: notPicked, tone: 'warn' },
            { label: 'Missed', value: missed, tone: 'bad' },
            { label: 'Rejected', value: rejected, tone: 'dark' },
            { label: 'Other', value: other, tone: 'muted' }
          ]} />
        </section>
      </div>

      <div className="split">
        <section className="panel">
          <header>
            <h2>Hour-wise · {dayLabel(data.day, true)}</h2>
            <p>{busiest?.totals?.total_calls ? `Busiest ${hourLabel(busiest.hour)} (${num(busiest.totals.total_calls)})` : (loading ? 'Loading…' : 'No calls')}</p>
          </header>
          <ColumnChart
            dense
            items={(data.hours || []).map((item) => ({
              key: item.hour,
              label: hourLabel(item.hour),
              total: Number(item.totals?.total_calls || 0),
              connected: Number(item.totals?.connected_calls || 0)
            }))}
          />
          {scope === 'week' ? <p className="quiet">Pick a day above to change the hourly view.</p> : null}
        </section>
        <section className="panel">
          <header>
            <h2>Direction</h2>
            <p>Outgoing vs incoming</p>
          </header>
          <SplitBar parts={[
            { label: 'Outgoing', value: outgoing, tone: 'accent' },
            { label: 'Incoming', value: incoming, tone: 'info' }
          ]} />
          <ul className="split-legend cy-direction">
            <li><span>Outgoing connected</span><strong>{num(totals.outgoing_connected_calls)}</strong><em>{percent(totals.outgoing_connected_calls, outgoing)}%</em></li>
            <li><span>Incoming connected</span><strong>{num(totals.incoming_connected_calls)}</strong><em>{percent(totals.incoming_connected_calls, incoming)}%</em></li>
          </ul>
        </section>
      </div>

      {editing ? (
        <TeamHeadEditor
          id={id}
          heads={teams.data?.heads || []}
          people={mergeEmployees(days).map((row) => ({ employeeId: String(row.employee_id ?? row.employee_name), employeeName: row.employee_name || `Employee ${row.employee_id}` }))}
          onCancel={() => setEditing(false)}
          onDone={() => { setEditing(false); teams.reload(); }}
        />
      ) : (
        <TeamHeadReport heads={teams.data?.heads || []} employees={employees} canManage={canManage} onEdit={() => setEditing(true)} />
      )}

      <section className="panel">
        <header>
          <div>
            <h2>Team-wise calls</h2>
            <p className="chart-legend"><span className="dot total" />Total <span className="dot good" />Connected · % is connect rate</p>
          </div>
          <SearchBox value={teamQuery} onChange={setTeamQuery} placeholder="Search employee" count={teamRows.length} />
        </header>
        <TeamBars rows={teamRows} />
      </section>

      <section className="panel">
        <header>
          <div>
            <h2>Team performance</h2>
            <p>Sorted by calls</p>
          </div>
          <SearchBox value={tableQuery} onChange={setTableQuery} placeholder="Search employee" count={tableRows.length} />
        </header>
        <Table
          columns={[
            { key: 'employee_name', label: 'Employee', render: (row) => row.employee_name || '—' },
            {
              key: 'total_calls',
              label: 'Calls',
              render: (row) => (
                <span className="cy-bar-cell">
                  <span className="cy-bar"><span style={{ width: `${(Number(row.total_calls || 0) / topCalls) * 100}%` }} /></span>
                  {num(row.total_calls)}
                </span>
              )
            },
            { key: 'connected_calls', label: 'Connected', render: (row) => `${num(row.connected_calls)} (${percent(row.connected_calls, row.total_calls)}%)` },
            { key: 'missed_calls', label: 'Missed', render: (row) => num(row.missed_calls) },
            { key: 'not_picked_calls', label: 'Not picked', render: (row) => num(row.not_picked_calls) },
            { key: 'talk', label: 'Talk time', render: (row) => talkTime(row.total_duration_seconds) },
            { key: 'avg', label: 'Avg connected', render: (row) => talkTime(row.connected_calls_avg_duration_seconds) }
          ]}
          rows={tableRows.map((row) => ({ ...row, id: row.employee_id ?? row.employee_name }))}
        />
      </section>
    </>
  );
}

const CALL_YATRI_TABS = ['Calls', 'Follow-ups', 'Leads'];

const CALL_YATRI_KINDS = { Calls: 'calls', 'Follow-ups': 'followups', Leads: 'leads' };

function leadName(row) {
  return row.name || row.full_name || row.customer_name || row.lead_name || row.phone || row.mobile || '—';
}

function CallYatriView({ data, canManage }) {
  const [tab, setTab] = useState(CALL_YATRI_TABS[0]);
  const [scope, setScope] = useState('');
  const [queries, setQueries] = useState({});
  const query = queries[tab] || '';
  const setQuery = (value) => setQueries((current) => ({ ...current, [tab]: value }));
  const live = useResource(`/api/connections/${data.id}/call-yatri/records?kind=${CALL_YATRI_KINDS[tab]}${scope ? `&day=${scope}` : ''}`);
  const rows = (live.data?.kind === CALL_YATRI_KINDS[tab] ? live.data.rows : [])
    .map((row, index) => ({ ...row, id: `${tab}-${row.id ?? row.followup_id ?? index}` }));
  const shownRows = tab === 'Calls'
    ? rows
      .sort((a, b) => String(b.call_start_time || '').localeCompare(String(a.call_start_time || '')))
      .filter((row) => matches(query, row.employee_name, row.lead_name, row.phone, row.call_status, row.call_direction, row.remarks, localTime(row.call_start_time)))
    : tab === 'Follow-ups'
      ? rows
        .sort((a, b) => String(a.followup_date || '').localeCompare(String(b.followup_date || '')))
        .filter((row) => matches(query, row.lead_name, row.lead_phone, row.employee_name, row.type, row.status, row.call_status, row.notes, localTime(row.followup_date)))
      : rows.filter((row) => matches(query, leadName(row), ...Object.values(row).map(fieldText)));
  const leadKeys = tab === 'Leads'
    ? [...new Set(rows.flatMap((row) => Object.keys(row)))]
      .filter((key) => !['id', 'name', 'full_name', 'customer_name', 'lead_name'].includes(key)).slice(0, 5)
    : [];
  const ready = !live.error && !live.loading && live.data?.kind === CALL_YATRI_KINDS[tab];
  const total = ready ? live.data.total : null;
  const scopeText = scope === 'week' ? 'last 7 days' : scope ? dayLabel(scope, true) : 'today';
  const lastJob = data.jobs?.[0];
  const warnings = (data.logs || []).filter((row) => lastJob && row.jobId === lastJob.id && row.level === 'warning');
  const hints = { Calls: 'Search employee, contact, phone, status, remarks', 'Follow-ups': 'Search lead, phone, employee, status, notes', Leads: 'Search leads' };

  return (
    <div className="stack">
      <section className="panel cy-status">
        <header>
          <div className="cy-brand">
            <img src={providerLogo('nexcall')} alt="Call Yatri" />
            <div>
              <h2>Sync status</h2>
              <p>{data.credentialPreview}</p>
            </div>
          </div>
          {lastJob ? <Badge value={lastJob.status} /> : <Badge value="pending" tone="warn" />}
        </header>
        {lastJob ? (
          <p className={lastJob.status === 'failed' ? 'delta-down' : 'quiet'}>
            {lastJob.status === 'failed' ? 'Last sync failed: ' : 'Last sync: '}{lastJob.summary || '—'} · {when(lastJob.startedAt)}
          </p>
        ) : <p className="quiet">Data on this page is read live from Call Yatri. Press Sync to check the API and refresh the report.</p>}
        {warnings.length ? (
          <ul className="cy-warnings">
            {warnings.map((row) => <li key={`${row.jobId}-${row.message}`}>{row.message}</li>)}
          </ul>
        ) : null}
      </section>

      <CallYatriReport id={data.id} canManage={canManage} onScope={setScope} />

      <section className="panel">
        <div className="cy-tab-head">
          <div className="tabs" role="tablist">
            {CALL_YATRI_TABS.map((item) => (
              <button key={item} type="button" role="tab" aria-selected={tab === item} className={tab === item ? 'is-on' : ''} onClick={() => setTab(item)}>
                {item}{tab === item && total != null ? ` · ${num(total)}` : ''}
              </button>
            ))}
          </div>
          <SearchBox value={query} onChange={setQuery} placeholder={hints[tab]} count={shownRows.length} />
        </div>
        <p className="quiet cy-note">
          Live from Call Yatri for {scopeText}. Nothing here is saved in AIRO.
          {total != null && total > rows.length ? ` Showing the first ${num(rows.length)} of ${num(total)}.` : ''}
        </p>
        {live.error ? (
          <div className="error-box">
            <strong>{tab} could not be loaded from Call Yatri.</strong>
            <p className="quiet">{live.error}</p>
            <button className="btn" type="button" onClick={() => live.reload()}>Try again</button>
          </div>
        ) : null}
        {!live.error && !ready ? <p className="quiet">Loading {tab.toLowerCase()} from Call Yatri…</p> : null}
        {ready && tab === 'Calls' ? (
          <Table
            columns={[
              { key: 'time', label: 'Time', render: (row) => localTime(row.call_start_time || row.created_at) },
              { key: 'employee', label: 'Employee', render: (row) => row.employee_name || '—' },
              { key: 'contact', label: 'Contact', render: (row) => row.lead_name || row.phone || '—' },
              { key: 'direction', label: 'Direction', render: (row) => label(row.call_direction) || '—' },
              { key: 'status', label: 'Status', render: (row) => <CallStatus value={row.call_status} /> },
              { key: 'duration', label: 'Duration', render: (row) => talkTime(row.call_duration) },
              { key: 'remarks', label: 'Remarks', render: (row) => row.remarks || '—' }
            ]}
            rows={shownRows}
          />
        ) : null}
        {ready && tab === 'Follow-ups' ? (
          <Table
            columns={[
              { key: 'due', label: 'Due', render: (row) => localTime(row.followup_date) },
              { key: 'lead', label: 'Lead', render: (row) => row.lead_name || row.lead_phone || '—' },
              { key: 'employee', label: 'Employee', render: (row) => row.employee_name || '—' },
              { key: 'type', label: 'Type', render: (row) => label(row.type) || '—' },
              { key: 'status', label: 'Status', render: (row) => <CallStatus value={row.status || row.call_status} /> },
              { key: 'notes', label: 'Notes', render: (row) => row.notes || '—' }
            ]}
            rows={shownRows}
          />
        ) : null}
        {ready && tab === 'Leads' ? (
          <Table
            columns={[
              { key: 'name', label: 'Name', render: (row) => leadName(row) },
              ...leadKeys.map((key) => ({ key, label: label(key), render: (row) => fieldText(row[key]) }))
            ]}
            rows={shownRows}
          />
        ) : null}
      </section>
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
  const callYatri = data?.providerKey === 'nexcall';
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
      title={meta && data?.accountLabel && data.accountLabel !== data.name ? `${data.name} · ${data.accountLabel}` : data?.name || 'Connection'}
      lede={google
        ? 'Create Search campaigns, manage them, and read reports for the connected Google Ads account.'
        : metaOnly ? 'Create the campaign, ad set, and ad here, then publish them to the connected Meta account.'
          : callYatri ? 'Calls, follow-ups, leads, and the team call report, read live from Call Yatri. Nothing is saved in AIRO.' : 'Only records returned by this tool\'s API or posted to its webhook.'}
      actions={can('connections.manage') && data ? (
        <>
          <button className="btn" disabled={busy} onClick={() => act(`/api/connections/${id}/sync`)}>{busy ? 'Syncing…' : 'Sync'}</button>
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
                The Facebook login expires on {day(data.tokenExpiresAt)}. Use Connect with Facebook again before then.
              </p>
            ) : null}
            {callYatri ? <CallYatriView key={data.lastSyncAt || 'never'} data={data} canManage={can('connections.manage')} /> : null}
            {meta ? <AdAccountBar provider={google ? 'google' : 'meta'} current={id} accounts={data.accounts || []} canManage={can('connections.manage')} /> : null}
            {metaOnly ? <MetaAdsManager key={id} id={id} data={data} canManage={can('connections.manage')} reload={reload} /> : null}
            {google ? <GoogleAdsManager key={id} id={id} data={data} canManage={can('connections.manage')} reload={reload} /> : null}
            {!meta && !callYatri && data.webhookPath ? (
              <section className="panel">
                <h2>Webhook</h2>
                <p className="quiet">POST JSON here. Each object from the webhook is listed below.</p>
                <p><code>{`${window.location.origin}${data.webhookPath}`}</code></p>
              </section>
            ) : null}
            {!meta && !callYatri && records.length ? (
              <Table columns={[
                { key: 'origin', label: 'Source', render: (row) => label(row.origin) },
                { key: 'type', label: 'Type', render: (row) => label(row.type) },
                { key: 'name', label: 'Name' },
                ...fieldKeys.map((key) => ({ key, label: label(key), render: (row) => fieldText(row.fields?.[key]) }))
              ]} rows={records} />
            ) : null}
            {!meta && !callYatri && !records.length ? (
              <div className="empty">
                <strong>No API or webhook records.</strong>
                <p className="quiet">{`This page stays empty until ${data.name} returns data. Sample campaigns, leads, and spend are not listed here.`}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </State>
    </Page>
  );
}
