import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { day } from '../format.js';
import { Badge, State } from '../ui.jsx';

const PLATFORM = { meta: 'Meta Ads', google: 'Google Ads' };
const STATUS_TONE = { draft: 'info', created: 'warn', published: 'good', cancelled: '' };
const STATUS_TEXT = { draft: 'draft', created: 'paused on platform', published: 'live', cancelled: 'cancelled' };
const SPECIAL = [
  { key: 'none', label: 'None' },
  { key: 'HOUSING', label: 'Housing (property sale or rent)' },
  { key: 'EMPLOYMENT', label: 'Employment' },
  { key: 'CREDIT', label: 'Credit or loans' },
  { key: 'ISSUES_ELECTIONS_POLITICS', label: 'Social issues, elections or politics' }
];
const MISSING_TEXT = { dailyBudget: 'daily budget', pageId: 'Facebook Page', link: 'website link', keywords: 'keywords' };

const lines = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);

function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

function MetaPreview({ variant, image, settings }) {
  return (
    <div className="panel" style={{ maxWidth: 380 }}>
      <p className="quiet">Sponsored</p>
      <p>{variant.primaryText}</p>
      {image ? <img src={image} alt="Ad" style={{ width: '100%', borderRadius: 8 }} /> : <div className="empty"><p className="quiet">Image preview appears after you choose a file.</p></div>}
      <p><strong>{variant.headline}</strong></p>
      <p className="quiet">{settings.conversion === 'instant_form' ? 'Sign up · Instant form' : 'Learn more'}</p>
    </div>
  );
}

function GooglePreview({ creative, link }) {
  let host = 'your-website.com';
  try { host = new URL(link).host; } catch { /* keep placeholder */ }
  const path = [creative.path1, creative.path2].filter(Boolean).join('/');
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <p className="quiet">Sponsored · {host}{path ? `/${path}` : ''}</p>
      <p><strong>{creative.headlines.slice(0, 3).join(' | ')}</strong></p>
      <p>{creative.descriptions.slice(0, 2).join(' ')}</p>
    </div>
  );
}

function LaunchCard({ item, canManage, canLaunch, onChange }) {
  const { settings, creative } = item;
  const draft = item.status === 'draft';
  const [form, setForm] = useState(null);
  const [image, setImage] = useState('');
  const [pages, setPages] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setForm({
      dailyBudget: settings.dailyBudget ?? '',
      link: settings.link || '',
      pageId: settings.pageId || '',
      specialCategory: settings.specialCategory || 'none',
      variants: creative.variants ? creative.variants.map((row) => ({ ...row })) : null,
      headlines: (creative.headlines || []).join('\n'),
      descriptions: (creative.descriptions || []).join('\n'),
      keywords: (settings.keywords || []).map((row) => `${row.text} | ${row.matchType}`).join('\n'),
      negatives: (settings.negatives || []).join('\n')
    });
  }, [item.updatedAt]);

  useEffect(() => {
    if (item.platform !== 'meta' || !draft || !canLaunch || pages) return;
    api.get(`/api/connections/${item.connectionId}/meta/pages`)
      .then((data) => setPages(data))
      .catch((error) => setPages({ pages: [], note: error.message }));
  }, [item.id]);

  if (!form) return null;
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setVariant = (index, key) => (event) => setForm((current) => ({
    ...current,
    variants: current.variants.map((row, at) => (at === index ? { ...row, [key]: event.target.value } : row))
  }));

  function editBody() {
    const body = { dailyBudget: Number(form.dailyBudget) || undefined, link: form.link };
    if (item.platform === 'meta') {
      body.pageId = form.pageId;
      body.specialCategory = form.specialCategory;
      body.metaVariants = form.variants;
    } else {
      body.googleHeadlines = lines(form.headlines);
      body.googleDescriptions = lines(form.descriptions);
      body.keywords = lines(form.keywords).map((row) => {
        const [text, match] = row.split('|').map((part) => part.trim());
        return { text, matchType: ['EXACT', 'PHRASE', 'BROAD'].includes(String(match).toUpperCase()) ? String(match).toUpperCase() : 'PHRASE' };
      });
      body.negatives = lines(form.negatives);
    }
    return body;
  }

  async function run(action, fn) {
    setBusy(action);
    setMessage('');
    try {
      await fn();
      onChange();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  const save = () => run('save', () => api.patch(`/api/ads-agent/launches/${item.id}`, editBody()));
  const create = () => run('create', async () => {
    await api.patch(`/api/ads-agent/launches/${item.id}`, editBody());
    await api.post(`/api/ads-agent/launches/${item.id}/create`, item.platform === 'meta' ? { imageBase64: image } : {});
  });
  const publish = () => {
    if (!window.confirm(`Publish on ${PLATFORM[item.platform]}? The campaign starts spending up to ${settings.dailyBudget} ${settings.currency || ''} a day.`)) return;
    run('publish', () => api.post(`/api/ads-agent/launches/${item.id}/publish`));
  };
  const cancel = () => run('cancel', () => api.post(`/api/ads-agent/launches/${item.id}/cancel`));

  return (
    <article className="panel stack">
      <header>
        <h2>{PLATFORM[item.platform]} · {settings.name}</h2>
        <Badge value={STATUS_TEXT[item.status]} tone={STATUS_TONE[item.status]} />
      </header>
      <p className="quiet">
        Drafted {day(item.createdAt)} · {item.model || 'model'}
        {item.externalCampaignId ? ` · campaign id ${item.externalCampaignId}` : ''}
      </p>
      {item.error ? <p className="delta-down">{item.error}</p> : null}
      {settings.notes?.length ? <ul className="alert-list">{settings.notes.map((note) => <li key={note}><span>{note}</span></li>)}</ul> : null}

      <div className="split">
        <div className="stack">
          {item.platform === 'meta'
            ? (form.variants || []).map((variant, index) => <MetaPreview key={index} variant={variant} image={image} settings={settings} />)
            : <GooglePreview creative={{ ...creative, headlines: lines(form.headlines), descriptions: lines(form.descriptions) }} link={form.link} />}
        </div>
        <div className="form-grid">
          <p className="quiet">
            Targeting: {settings.locations?.length ? settings.locations.map((row) => row.name).join(', ') : 'India'}
            {settings.interests?.length ? ` · Interests: ${settings.interests.map((row) => row.name).join(', ')}` : ''}
            {settings.ageMin || settings.ageMax ? ` · Age ${settings.ageMin || 18}–${settings.ageMax || 65}` : ''}
          </p>
          <fieldset className="form-grid" disabled={!draft || !canManage}>
            <label className="stack-field">DAILY BUDGET ({settings.currency || 'account currency'})<input type="number" min="1" value={form.dailyBudget} onChange={set('dailyBudget')} /></label>
            <label className="stack-field">{item.platform === 'meta' ? 'WEBSITE LINK (https, also used as the privacy policy on lead forms)' : 'LANDING PAGE'}<input type="url" value={form.link} onChange={set('link')} placeholder="https://" /></label>
            {item.platform === 'meta' ? (
              <>
                <label className="stack-field">FACEBOOK PAGE
                  <select value={form.pageId} onChange={set('pageId')}>
                    <option value="">Choose a Page</option>
                    {(pages?.pages || []).map((page) => <option key={page.id} value={page.id}>{page.name}</option>)}
                  </select>
                  {pages?.note ? <span className="quiet">{pages.note}</span> : null}
                </label>
                <label className="stack-field">SPECIAL AD CATEGORY
                  <select value={form.specialCategory} onChange={set('specialCategory')}>
                    {SPECIAL.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
                  </select>
                  <span className="quiet">Meta requires this for property, jobs, loans and political ads. With a category, age and interest targeting are removed.</span>
                </label>
                {form.variants.map((variant, index) => (
                  <div key={index} className="form-grid">
                    <label className="stack-field">VARIANT {index + 1} HEADLINE ({variant.headline.length}/40)<input value={variant.headline} maxLength={40} onChange={setVariant(index, 'headline')} /></label>
                    <label className="stack-field">VARIANT {index + 1} TEXT ({variant.primaryText.length}/300)<textarea value={variant.primaryText} maxLength={300} onChange={setVariant(index, 'primaryText')} /></label>
                  </div>
                ))}
                {draft && canLaunch ? (
                  <label className="stack-field">AD IMAGE (JPG or PNG under 2 MB)
                    <input type="file" accept="image/png,image/jpeg" onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (file.size > 2000000) { setMessage('Image must be under 2 MB.'); return; }
                      setImage(await readImage(file));
                    }} />
                  </label>
                ) : null}
              </>
            ) : (
              <>
                <label className="stack-field">HEADLINES (one per line, 30 characters max)<textarea value={form.headlines} onChange={set('headlines')} rows={8} /></label>
                <label className="stack-field">DESCRIPTIONS (one per line, 90 characters max)<textarea value={form.descriptions} onChange={set('descriptions')} /></label>
                <label className="stack-field">KEYWORDS (one per line: text | EXACT, PHRASE or BROAD)<textarea value={form.keywords} onChange={set('keywords')} rows={6} /></label>
                <label className="stack-field">NEGATIVE KEYWORDS (one per line)<textarea value={form.negatives} onChange={set('negatives')} /></label>
              </>
            )}
          </fieldset>
        </div>
      </div>

      {canManage ? (
        <div className="page-actions">
          {draft ? <button className="btn" onClick={save} disabled={Boolean(busy)}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button> : null}
          {draft && canLaunch ? (
            <button className="btn-primary" onClick={create} disabled={Boolean(busy) || (item.platform === 'meta' && !image)}>
              {busy === 'create' ? 'Creating…' : 'Create as paused campaign'}
            </button>
          ) : null}
          {item.status === 'created' && canLaunch ? <button className="btn-primary" onClick={publish} disabled={Boolean(busy)}>{busy === 'publish' ? 'Publishing…' : 'Publish (starts spending)'}</button> : null}
          {draft ? <button className="btn-ghost" onClick={cancel} disabled={Boolean(busy)}>Cancel draft</button> : null}
          {message ? <span className="delta-down">{message}</span> : null}
        </div>
      ) : null}
      {draft && item.missing.length ? <p className="quiet">Still needed before creating: {item.missing.map((key) => MISSING_TEXT[key] || key).join(', ')}{item.platform === 'meta' ? ', ad image' : ''}.</p> : null}
    </article>
  );
}

export function LaunchPanel({ canManage }) {
  const { can } = useAuth();
  const canLaunch = canManage && can('connections.manage');
  const launches = useResource('/api/ads-agent/launches');
  const strategies = useResource('/api/ads-agent/strategies');
  const [account, setAccount] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const approved = (strategies.data?.items || []).find((item) => item.status === 'approved');
  const accounts = launches.data?.accounts || [];
  const items = launches.data?.items || [];

  async function draft(platform) {
    setBusy(platform);
    setMessage('');
    try {
      await api.post('/api/ads-agent/launches', { strategyId: approved.id, platform, connectionId: account[platform] ? Number(account[platform]) : undefined });
      launches.reload({ silent: true });
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="stack">
      <p className="quiet">Ads are written from the approved strategy. You review them here, they are created on the ad account as PAUSED, and nothing spends until you press Publish.</p>
      <State loading={launches.loading || strategies.loading} error={launches.error || strategies.error} onRetry={launches.reload}>
        {!approved ? <div className="empty"><strong>No approved strategy</strong><p className="quiet">Approve a strategy in the Strategy tab first.</p></div> : (
          canManage ? (
            <div className="page-actions">
              {approved.strategy.platforms.map(({ platform }) => {
                const options = accounts.filter((row) => row.platform === platform);
                return (
                  <span key={platform} className="filters">
                    {options.length > 1 ? (
                      <select value={account[platform] || ''} onChange={(event) => setAccount((current) => ({ ...current, [platform]: event.target.value }))} aria-label={`${PLATFORM[platform]} account`}>
                        {options.map((row) => <option key={row.id} value={row.id}>{PLATFORM[platform]} {row.accountId}</option>)}
                      </select>
                    ) : null}
                    <button className="btn" onClick={() => draft(platform)} disabled={Boolean(busy) || !options.length}>
                      {busy === platform ? 'Writing ads…' : options.length ? `Write ${PLATFORM[platform]} from strategy v${approved.version}` : `${PLATFORM[platform]} not connected`}
                    </button>
                  </span>
                );
              })}
              {message ? <span className="delta-down">{message}</span> : null}
            </div>
          ) : null
        )}
        {items.filter((item) => item.status !== 'cancelled').map((item) => (
          <LaunchCard key={item.id} item={item} canManage={canManage} canLaunch={canLaunch} onChange={() => launches.reload({ silent: true })} />
        ))}
      </State>
    </div>
  );
}
