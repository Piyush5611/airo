import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useResource } from '../data.js';
import { day } from '../format.js';
import { Badge, State } from '../ui.jsx';

const GOALS = [
  { key: 'leads', label: 'Leads (enquiries)' },
  { key: 'sales', label: 'Online sales' },
  { key: 'traffic', label: 'Website visits' },
  { key: 'awareness', label: 'Awareness' }
];
const PLATFORM = { meta: 'Meta Ads', google: 'Google Ads' };
const STATUS_TONE = { approved: 'good', draft: 'info', archived: '' };
const EMPTY = {
  businessName: '', category: '', offering: '', locations: [], audience: '', usps: [], website: '', languages: [],
  competitors: [], goal: 'leads', platforms: ['meta'], currency: 'INR', priceMin: null, priceMax: null,
  avgLeadValue: null, targetCpl: null, monthlyBudget: null, notes: ''
};
const LISTS = ['locations', 'usps', 'languages', 'competitors'];
const NUMBERS = ['priceMin', 'priceMax', 'avgLeadValue', 'targetCpl', 'monthlyBudget'];

function toForm(profile) {
  const value = { ...EMPTY, ...(profile || {}) };
  for (const key of LISTS) value[key] = (value[key] || []).join('\n');
  for (const key of NUMBERS) value[key] = value[key] == null ? '' : String(value[key]);
  return value;
}

function fromForm(form) {
  const value = { ...form };
  for (const key of LISTS) value[key] = String(form[key] || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  for (const key of NUMBERS) value[key] = form[key] === '' ? null : Number(form[key]);
  value.currency = String(form.currency || 'INR').trim().toUpperCase();
  return value;
}

export function ProfileForm({ canManage }) {
  const { data, loading, error, reload } = useResource('/api/ads-agent/profile');
  const [form, setForm] = useState(toForm(null));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!data?.ready) return;
    const next = toForm(data.profile);
    if (!data.profile && data.sector) {
      next.category = data.sector.label;
      if (GOALS.some((goal) => goal.key === data.sector.goal)) next.goal = data.sector.goal;
    }
    setForm(next);
  }, [data]);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const togglePlatform = (key) => setForm((current) => ({
    ...current,
    platforms: current.platforms.includes(key) ? current.platforms.filter((item) => item !== key) : [...current.platforms, key]
  }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api.put('/api/ads-agent/profile', fromForm(form));
      setMessage('Profile saved.');
      reload({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <State loading={loading} error={error} onRetry={reload}>
      {data && !data.ready ? <p className="quiet">{data.note}</p> : (
        <form className="panel form-grid" onSubmit={save}>
          <header><h2>Business profile</h2>{data?.updatedAt ? <span className="quiet">Updated {day(data.updatedAt)}</span> : null}</header>
          <p className="quiet">The strategy uses only what you write here and your synced ad results. Leave a field blank if you do not know it.</p>
          <p className="quiet">{data?.sector
            ? `Business sector: ${data.sector.label}. AIRO adds this sector's playbook to the plan. Change it in Settings, Organization.`
            : 'No business sector set yet. Choose it in Settings, Organization so AIRO can plan for your kind of business.'}</p>
          <fieldset disabled={!canManage} className="form-grid">
            <label className="stack-field">BUSINESS NAME<input value={form.businessName} onChange={set('businessName')} required /></label>
            <label className="stack-field">CATEGORY (e.g. Real estate, Clinic, Coaching)<input value={form.category} onChange={set('category')} required /></label>
            <label className="stack-field">WHAT YOU SELL<textarea value={form.offering} onChange={set('offering')} required placeholder="Products or services, sizes, key details" /></label>
            <label className="stack-field">LOCATIONS TO TARGET (one per line)<textarea value={form.locations} onChange={set('locations')} required /></label>
            <label className="stack-field">WHO BUYS FROM YOU<textarea value={form.audience} onChange={set('audience')} /></label>
            <label className="stack-field">WHY CUSTOMERS CHOOSE YOU (one per line)<textarea value={form.usps} onChange={set('usps')} /></label>
            <label className="stack-field">WEBSITE<input type="url" value={form.website} onChange={set('website')} placeholder="https://" /></label>
            <label className="stack-field">AD LANGUAGES (one per line)<input value={form.languages} onChange={set('languages')} placeholder="English, Hindi" /></label>
            <label className="stack-field">COMPETITORS (one per line)<textarea value={form.competitors} onChange={set('competitors')} /></label>
            <label className="stack-field">MAIN GOAL
              <select value={form.goal} onChange={set('goal')}>{GOALS.map((goal) => <option key={goal.key} value={goal.key}>{goal.label}</option>)}</select>
            </label>
            <div className="stack-field">PLATFORMS
              <div className="filters">
                {Object.entries(PLATFORM).map(([key, name]) => (
                  <button key={key} type="button" className={`toggle ${form.platforms.includes(key) ? 'is-on' : ''}`} onClick={() => togglePlatform(key)}>{name}</button>
                ))}
              </div>
            </div>
            <label className="stack-field">CURRENCY<input value={form.currency} onChange={set('currency')} maxLength={3} /></label>
            <label className="stack-field">LOWEST PRICE<input type="number" min="0" value={form.priceMin} onChange={set('priceMin')} /></label>
            <label className="stack-field">HIGHEST PRICE<input type="number" min="0" value={form.priceMax} onChange={set('priceMax')} /></label>
            <label className="stack-field">VALUE OF ONE GOOD LEAD OR SALE<input type="number" min="0" value={form.avgLeadValue} onChange={set('avgLeadValue')} /></label>
            <label className="stack-field">TARGET COST PER LEAD<input type="number" min="0" value={form.targetCpl} onChange={set('targetCpl')} /></label>
            <label className="stack-field">MONTHLY AD BUDGET<input type="number" min="0" value={form.monthlyBudget} onChange={set('monthlyBudget')} /></label>
            <label className="stack-field">ANYTHING ELSE<textarea value={form.notes} onChange={set('notes')} /></label>
          </fieldset>
          {canManage ? (
            <div className="page-actions">
              <button className="btn-primary" type="submit" disabled={busy || !form.platforms.length}>{busy ? 'Saving…' : 'Save profile'}</button>
              {message ? <span className="quiet">{message}</span> : null}
            </div>
          ) : null}
        </form>
      )}
    </State>
  );
}

function List({ title, items, render }) {
  if (!items?.length) return null;
  return (
    <section className="panel">
      <header><h2>{title}</h2></header>
      <ul className="alert-list">{items.map((item, index) => <li key={index}>{render ? render(item) : item}</li>)}</ul>
    </section>
  );
}

function StrategyDetail({ item, canManage, onChange }) {
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const { strategy, budget } = item;
  const budgetFor = (platform) => budget?.platforms.find((row) => row.platform === platform);

  async function act(action) {
    setBusy(action);
    setMessage('');
    try {
      await api.post(`/api/ads-agent/strategies/${item.id}/${action}`);
      onChange();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="stack">
      <article className="panel">
        <header>
          <h2>Strategy v{item.version}</h2>
          <Badge value={item.status} tone={STATUS_TONE[item.status]} />
        </header>
        <p>{strategy.summary}</p>
        <p className="quiet">
          {day(item.createdAt)} · {item.model || 'model'} · {item.usedPastResults ? 'used synced ad results' : 'no past results were available'}
        </p>
        {canManage && item.status !== 'archived' ? (
          <div className="page-actions">
            {item.status === 'draft' ? <button className="btn-primary" disabled={Boolean(busy)} onClick={() => act('approve')}>{busy === 'approve' ? 'Approving…' : 'Approve strategy'}</button> : null}
            <button className="btn-ghost" disabled={Boolean(busy)} onClick={() => act('archive')}>Archive</button>
            {message ? <span className="quiet">{message}</span> : null}
          </div>
        ) : null}
      </article>
      <List
        title="Platforms and budget split"
        items={strategy.platforms}
        render={(row) => {
          const money = budgetFor(row.platform);
          return (
            <>
              <strong>{PLATFORM[row.platform]} · {row.budgetSharePct}% · {row.objective}</strong>
              <p>{row.why}</p>
              {money ? <p className="quiet">{budget.currency} {money.monthly.toLocaleString('en-IN')} a month (about {money.daily.toLocaleString('en-IN')} a day)</p> : <p className="quiet">Add a monthly budget to the profile to see amounts.</p>}
            </>
          );
        }}
      />
      <List
        title="Audiences"
        items={strategy.audiences}
        render={(row) => (
          <>
            <strong>{row.name} · {PLATFORM[row.platform]}</strong>
            <p>{row.description}</p>
            <p className="quiet">
              {[row.locations?.join(', '), row.ageMin || row.ageMax ? `Age ${row.ageMin || 18}–${row.ageMax || 65}` : '', row.interests?.length ? `Interests: ${row.interests.join(', ')}` : ''].filter(Boolean).join(' · ')}
            </p>
          </>
        )}
      />
      <List title="Google keywords" items={strategy.keywords} render={(row) => <>{row.text} <span className="quiet">({row.matchType.toLowerCase()})</span></>} />
      <List title="Negative keywords" items={strategy.negativeKeywords} />
      <List title="Message angles" items={strategy.angles} render={(row) => <><strong>{row.name}</strong><p>{row.message}</p></>} />
      <List title="Headlines" items={strategy.headlines} />
      <List title="Primary texts" items={strategy.primaryTexts} />
      <List title="Tests to run" items={strategy.tests} render={(row) => <><strong>{row.hypothesis}</strong><p>A: {row.variantA} · B: {row.variantB}</p><p className="quiet">Measure: {row.metric.replaceAll('_', ' ')}</p></>} />
      <List title="Risks" items={strategy.risks} />
    </div>
  );
}

export function StrategyPanel({ canManage }) {
  const { data, loading, error, reload } = useResource('/api/ads-agent/strategies');
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const items = data?.items || [];
  const current = items.find((item) => item.id === selected) || items.find((item) => item.status === 'approved') || items[0];

  async function generate() {
    setBusy(true);
    setMessage('');
    try {
      const created = await api.post('/api/ads-agent/strategies');
      setSelected(created.id);
      reload({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-actions">
        {canManage ? <button className="btn-primary" onClick={generate} disabled={busy}>{busy ? 'Writing strategy… (up to a minute)' : 'Generate strategy'}</button> : null}
        {items.length > 1 ? (
          <select value={current?.id || ''} onChange={(event) => setSelected(Number(event.target.value))} aria-label="Version">
            {items.map((item) => <option key={item.id} value={item.id}>v{item.version} · {item.status}</option>)}
          </select>
        ) : null}
        {message ? <span className="quiet">{message}</span> : null}
      </div>
      <p className="quiet">A strategy is only a plan. Nothing is created or changed on your ad accounts until you approve ads in a later step.</p>
      <State loading={loading} error={error} onRetry={reload} empty={!items.length ? { title: 'No strategy yet', body: 'Save the business profile, then press Generate strategy.' } : null}>
        {current ? <StrategyDetail item={current} canManage={canManage} onChange={() => reload({ silent: true })} /> : null}
      </State>
    </div>
  );
}
