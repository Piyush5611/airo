import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';

const SKIP_KEY = 'airo_setup_later';

function blankForm(organization) {
  return {
    name: organization?.name || '',
    legalName: organization?.legalName || '',
    city: organization?.city || '',
    sector: organization?.sector || ''
  };
}

export function SectorPlaybook({ sector }) {
  if (!sector) return null;
  return (
    <section className="panel sector-playbook">
      <header>
        <h3>{sector.label} playbook</h3>
        <p>General guidance AIRO uses when it plans ads for this sector.</p>
      </header>
      <dl className="sector-facts">
        <div><dt>Usual goal</dt><dd>{sector.goal}</dd></div>
        <div><dt>Lead path</dt><dd>{sector.leadPath}</dd></div>
        {sector.special ? <div><dt>Meta special category</dt><dd>{sector.special} may apply. AIRO suggests it, you decide.</dd></div> : null}
        <div><dt>Ad angles</dt><dd>{sector.angles.join(' · ')}</dd></div>
        <div><dt>Creative ideas</dt><dd>{sector.creatives.join(' · ')}</dd></div>
        <div><dt>KPIs to watch</dt><dd>{sector.kpis.join(' · ')}</dd></div>
      </dl>
      {sector.tips.length ? <ul className="sector-tips">{sector.tips.map((tip) => <li key={tip}>{tip}</li>)}</ul> : null}
    </section>
  );
}

export function OrganizationForm({ data, canEdit, onSaved, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => blankForm(data.organization));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setForm(blankForm(data.organization)), [data.organization]);

  const chosen = data.sectors.find((item) => item.key === form.sector) || null;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!form.sector) {
      setError('Choose the business sector.');
      return;
    }
    setBusy(true);
    try {
      const next = await api.patch('/api/organization', form);
      setMessage('Organization details saved.');
      onSaved?.(next);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="org-setup">
      <form className="form-grid panel" onSubmit={save}>
        <fieldset className="form-grid" disabled={!canEdit || busy}>
          <label className="stack-field">Business sector
            <select value={form.sector} onChange={set('sector')} required>
              <option value="">Choose your sector</option>
              {data.sectors.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </label>
          <label className="stack-field">Business name
            <input value={form.name} onChange={set('name')} minLength={2} maxLength={160} required />
          </label>
          <label className="stack-field">Legal name
            <input value={form.legalName} onChange={set('legalName')} maxLength={180} placeholder="Optional" />
          </label>
          <label className="stack-field">City
            <input value={form.city} onChange={set('city')} maxLength={80} placeholder="Optional" />
          </label>
        </fieldset>
        {canEdit
          ? <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button>
          : <p className="quiet">You can view these details. Editing needs settings management.</p>}
        {error ? <p className="error-box">{error}</p> : null}
        {message ? <p>{message}</p> : null}
      </form>
      <SectorPlaybook sector={chosen} />
    </div>
  );
}

export function AccountSetup() {
  const { user, can, refreshUser } = useAuth();
  const [data, setData] = useState(null);
  const [later, setLater] = useState(() => sessionStorage.getItem(SKIP_KEY) === '1');
  const needed = user?.realm === 'client' && !user.supportAccess && !user.organization?.sector && can('settings.manage');

  useEffect(() => {
    if (!needed || later || data) return;
    api.get('/api/settings').then(setData).catch(() => setData(null));
  }, [needed, later, data]);

  if (!needed || later || !data) return null;

  function skip() {
    sessionStorage.setItem(SKIP_KEY, '1');
    setLater(true);
  }

  return (
    <div className="overlay">
      <div className="modal account-setup" role="dialog" aria-label="Set up your account">
        <header>
          <h2>Set up your account</h2>
          <p className="quiet">Choose your business sector once. AIRO uses it to plan ads, targeting, copy and reports for your kind of business, so it does not need to ask every time. You can change it later in Settings, Organization.</p>
        </header>
        <OrganizationForm data={data} canEdit submitLabel="Save and continue" onSaved={() => refreshUser()} />
        <div className="row-actions">
          <button className="btn-ghost" type="button" onClick={skip}>Do it later</button>
        </div>
      </div>
    </div>
  );
}
