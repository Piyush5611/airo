import { useEffect, useRef, useState } from 'react';
import { api, currentToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { day, label, num, when } from '../format.js';
import { Page, State } from '../ui.jsx';

const FALLBACK = {
  kinds: [{ key: 'product', label: 'Product' }, { key: 'service', label: 'Service' }, { key: 'package', label: 'Package' }, { key: 'other', label: 'Other' }],
  fields: { name: '', details: 'What it is, sizes or options, what is included', usps: 'Why people should choose it', offer: 'Discount or free extra', price: '₹999 onwards', locationLabel: 'LOCATION', location: 'Where it is or where you sell it' }
};
const SOURCE = { manual: 'Added here', whatsapp: 'From WhatsApp chat', ad_chat: 'From ad setup' };
const EMPTY = { kind: 'product', name: '', details: '', usps: '', offer: '', priceText: '', locations: '', website: '', status: 'active' };
const MAX_BYTES = 2 * 1024 * 1024;

function toForm(item, catalog) {
  if (!item) return { ...EMPTY, kind: catalog.kinds[0]?.key || 'product', websiteForm: true };
  return Object.fromEntries(Object.keys(EMPTY).map((key) => [key, item[key] || EMPTY[key]]));
}

function kindLabel(catalog, kind) {
  return catalog.kinds.find((row) => row.key === kind)?.label || label(kind);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png)$/.test(file.type)) return reject(new Error('Choose a JPG or PNG image.'));
    if (file.size > MAX_BYTES) return reject(new Error('The image must be under 2 MB.'));
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function MediaImage({ id, alt }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let url = '';
    let live = true;
    const headers = currentToken() ? { Authorization: `Bearer ${currentToken()}` } : {};
    fetch(`/api/offerings/media/${id}`, { headers, credentials: 'include' })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || !live) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return src ? <img src={src} alt={alt} /> : <span className="offer-photo-blank" aria-label={alt} />;
}

function ImageUpload({ text, onFile, disabled }) {
  return (
    <label className={`btn${disabled ? ' is-disabled' : ''}`}>
      {text}
      <input type="file" accept="image/jpeg,image/png" hidden disabled={disabled} onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (file) onFile(file);
      }} />
    </label>
  );
}

function Photos({ item, maxPhotos, canManage, onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const ids = item.photoIds || [];

  async function upload(file) {
    setBusy(true);
    setMessage('');
    try {
      const imageBase64 = await readImage(file);
      await api.post(`/api/offerings/${item.id}/photos`, { imageBase64 });
      onChange();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this photo?')) return;
    try {
      await api.del(`/api/offerings/media/${id}`);
      onChange();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <div className="offer-photos">
      {ids.map((id) => (
        <figure key={id}>
          <MediaImage id={id} alt={item.name} />
          {canManage ? <button className="offer-photo-del" type="button" onClick={() => remove(id)} aria-label="Delete photo" title="Delete photo">×</button> : null}
        </figure>
      ))}
      {canManage && ids.length < maxPhotos ? <ImageUpload text={busy ? 'Uploading…' : `+ Photo ${ids.length}/${maxPhotos}`} onFile={upload} disabled={busy} /> : null}
      {!ids.length && !canManage ? <span className="quiet">No photos</span> : null}
      {message ? <span className="quiet">{message}</span> : null}
    </div>
  );
}

function LogoPanel({ logoId, canManage, onChange }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function upload(file) {
    setBusy(true);
    setMessage('');
    try {
      await api.put('/api/offerings/logo', { imageBase64: await readImage(file) });
      onChange();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Remove the logo? New ad designs will not show it.')) return;
    try {
      await api.del(`/api/offerings/media/${logoId}`);
      onChange();
    } catch (err) {
      setMessage(err.message);
    }
  }

  return (
    <section className="panel offer-logo">
      <header>
        <h2>Business logo</h2>
        <p className="quiet">Goes on every ad design. A transparent PNG looks best.</p>
      </header>
      <div className="offer-photos">
        {logoId ? <figure><MediaImage id={logoId} alt="Business logo" /></figure> : <span className="quiet">No logo yet</span>}
        {canManage ? <ImageUpload text={busy ? 'Uploading…' : logoId ? 'Replace logo' : 'Upload logo'} onFile={upload} disabled={busy} /> : null}
        {canManage && logoId ? <button className="btn" type="button" onClick={remove}>Remove</button> : null}
        {message ? <span className="quiet">{message}</span> : null}
      </div>
    </section>
  );
}

function formEndpoint(token) {
  return `${window.location.origin}/api/forms/${token}`;
}

export function formScript(endpoint) {
  return `<!-- AIRO website form: sends every form on this page to AIRO Leads -->
<script>
(function () {
  var AIRO = '${endpoint}';
  var KEYS = ['utm_source','utm_medium','utm_campaign','utm_id','utm_content','utm_term','gclid','gbraid','wbraid','gad_source','gad_campaignid','fbclid'];
  try {
    var q = new URLSearchParams(location.search), seen = {}, hit = false;
    KEYS.forEach(function (k) { var v = q.get(k); if (v) { seen[k] = v; hit = true; } });
    if (hit) { seen.airo_landing = location.href.slice(0, 500); localStorage.setItem('airo_attr', JSON.stringify(seen)); }
  } catch (e) {}
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM' || form.querySelector('input[type=password]')) return;
    var data = new URLSearchParams();
    Array.prototype.forEach.call(form.elements, function (el) {
      if (!el.name || el.disabled || /^(password|file|submit|button|reset|image)$/i.test(el.type)) return;
      if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) return;
      data.append(el.name, String(el.value).slice(0, 500));
    });
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem('airo_attr') || '{}'); } catch (e) {}
    Object.keys(saved).forEach(function (k) { if (!data.has(k)) data.append(k, saved[k]); });
    data.append('airo_page', location.href.slice(0, 500));
    if (navigator.sendBeacon) navigator.sendBeacon(AIRO, data);
    else fetch(AIRO, { method: 'POST', body: data, mode: 'no-cors', keepalive: true });
  }, true);
})();
</script>`;
}

function CopyBlock({ value, multiline }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className={`copy-block${multiline ? ' is-code' : ''}`}>
      {multiline ? <pre>{value}</pre> : <code>{value}</code>}
      <button className="btn" type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}

const FORM_GUIDES = ['WordPress', 'HTML website', 'Form plugin webhook'];
const CHECK_TITLE = {
  found: 'Code found on the website',
  old_code: 'An old code is on the website',
  missing: 'Code not found on the website',
  unreachable: 'Website did not open',
  blocked: 'This link cannot be checked',
  error: 'Check failed'
};
const CHECK_SHORT = { found: 'Code on site', old_code: 'Old code on site', missing: 'Code not on site', unreachable: 'Site did not open', blocked: 'Cannot check' };

function WebsiteFormPanel({ item, canManage, onChange, onClose }) {
  const [guide, setGuide] = useState(FORM_GUIDES[0]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const endpoint = item.formToken ? formEndpoint(item.formToken) : '';
  const panelRef = useRef(null);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState(null);

  async function verify() {
    setChecking(true);
    setCheck(null);
    try {
      const result = await api.post(`/api/offerings/${item.id}/website-form/check`, {});
      setCheck(result.check);
      onChange();
    } catch (err) {
      setCheck({ status: 'error', message: err.message });
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => { panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, []);

  async function act(method, confirmText) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage('');
    try {
      if (method === 'delete') await api.del(`/api/offerings/${item.id}/website-form`);
      else await api.post(`/api/offerings/${item.id}/website-form`, {});
      onChange();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack" ref={panelRef}>
      <header>
        <h2>Website form for {item.name}</h2>
        <button className="btn" type="button" onClick={onClose}>Close</button>
      </header>
      {!item.formToken ? (
        <div className="stack">
          <p className="quiet">Create a link, put it on your website, and every enquiry form filled there comes into Leads with this project name.</p>
          {canManage ? <div><button className="btn-primary" type="button" disabled={busy} onClick={() => act('post')}>{busy ? 'Creating…' : 'Create website form link'}</button></div> : null}
        </div>
      ) : (
        <div className="stack">
          <div className="form-route">
            <div><strong>Google Ads</strong><span>Visitors with a Google click id or utm_source=google with a paid medium go to Leads and the Google Ads Leads tab.</span></div>
            <div><strong>Meta Ads</strong><span>utm_source=facebook or instagram (not organic), or a Facebook click id, go to Leads and the Meta Ads Leads tab.</span></div>
            <div><strong>Website</strong><span>Everyone else is saved in Leads with the source Website.</span></div>
          </div>
          <div className={`form-check is-${check?.status || item.formCheck || 'none'}`}>
            <div>
              <strong>{CHECK_TITLE[check?.status || item.formCheck] || 'Not checked yet'}</strong>
              <small>
                {check?.message || (item.formCheckedAt ? `Checked ${when(item.formCheckedAt)} on ${item.website}` : `AIRO opens ${item.website} and looks for this code.`)}
              </small>
            </div>
            <button className="btn" type="button" disabled={checking} onClick={verify}>{checking ? 'Checking…' : 'Check website'}</button>
          </div>
          <p className="quiet">{item.formLeads ? `${item.formLeads} form ${item.formLeads === 1 ? 'entry' : 'entries'} received, last ${when(item.formLastAt)}. That also proves the code works.` : 'No form entry yet.'} The form must have a phone number field. A phone number already in Leads is matched to that lead, not added again.</p>
          <div className="chip-tabs">
            {FORM_GUIDES.map((key) => <button key={key} type="button" className={guide === key ? 'is-on' : ''} onClick={() => setGuide(key)}>{key}</button>)}
          </div>
          {guide === 'WordPress' ? (
            <ol className="form-steps">
              <li>In WordPress, open Plugins, Add New, and install the free <strong>WPCode</strong> plugin (Insert Headers and Footers).</li>
              <li>Open Code Snippets, Header &amp; Footer, and paste the code below in the <strong>Footer</strong> box. To track only one project page, add it as a new snippet and set it to load on that page only.</li>
              <li>Save. Works with Contact Form 7, Elementor, WPForms, Gravity Forms and most other form plugins.</li>
              <li>Fill the form once yourself with a real phone number and check Leads.</li>
            </ol>
          ) : null}
          {guide === 'HTML website' ? (
            <ol className="form-steps">
              <li>Open the HTML file of the page that has the enquiry form.</li>
              <li>Paste the code below just before <code>&lt;/body&gt;</code>. Your form keeps working as it does today; AIRO gets a copy.</li>
              <li>Give the inputs clear names such as <code>name</code>, <code>phone</code>, <code>email</code>, <code>city</code>, <code>message</code>.</li>
              <li>Upload the file, fill the form once with a real phone number, and check Leads.</li>
            </ol>
          ) : null}
          {guide === 'Form plugin webhook' ? (
            <ol className="form-steps">
              <li>Use this when a form tool can send to a webhook URL: Elementor Pro (Actions After Submit, Webhook), WPForms, Gravity Forms, Zapier, Pabbly and others.</li>
              <li>Paste the URL below as the webhook. JSON and normal form posts both work.</li>
              <li>For the Google or Meta split, add hidden fields named <code>utm_source</code>, <code>utm_medium</code>, <code>utm_campaign</code> and <code>gclid</code>. Without them the lead is saved as Website. The script on the other tabs does this for you.</li>
            </ol>
          ) : null}
          {guide === 'Form plugin webhook' ? <CopyBlock value={endpoint} /> : <CopyBlock value={formScript(endpoint)} multiline />}
          <p className="quiet">For the split to work, your ad links need tags. Google Ads adds a click id by itself when auto-tagging is on. On Meta, add URL parameters to the ad: <code>utm_source=facebook&amp;utm_medium=paid&amp;utm_campaign={'{{campaign.name}}'}&amp;utm_id={'{{campaign.id}}'}</code></p>
          {canManage ? (
            <div className="page-actions">
              <button className="btn" type="button" disabled={busy} onClick={() => act('post', 'Make a new link? The old link and code stop working, so you must paste the new code on the website.')}>New link</button>
              <button className="btn" type="button" disabled={busy} onClick={() => act('delete', 'Turn off this website form link? Forms on the website stop sending leads to AIRO.')}>Turn off</button>
              {message ? <span className="quiet">{message}</span> : null}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function OfferingForm({ item, catalog, onDone, onCancel }) {
  const [form, setForm] = useState(toForm(item, catalog));
  const hint = catalog.fields;
  const kinds = catalog.kinds.some((row) => row.key === form.kind) ? catalog.kinds : [...catalog.kinds, { key: form.kind, label: label(form.kind) }];
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      if (item) await api.patch(`/api/offerings/${item.id}`, form);
      else await api.post('/api/offerings', form);
      onDone(!item && form.websiteForm && form.website.trim() ? form.name.trim() : '');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid offer-form" onSubmit={save}>
      <header>
        <h2>{item ? `Edit ${item.name}` : 'Add a product, project or service'}</h2>
        {catalog.sectorLabel ? <p className="quiet">Types and examples are for your sector: {catalog.sectorLabel}. Change the sector in Settings, Organization.</p> : null}
      </header>
      <label className="stack-field">TYPE
        <select value={form.kind} onChange={set('kind')}>{kinds.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}</select>
      </label>
      <label className="stack-field">NAME<input value={form.name} onChange={set('name')} required minLength={2} maxLength={160} placeholder={hint.name} /></label>
      <label className="stack-field">DETAILS<textarea value={form.details} onChange={set('details')} maxLength={2000} placeholder={hint.details} /></label>
      <label className="stack-field">SELLING POINTS (USPs)<textarea value={form.usps} onChange={set('usps')} maxLength={1000} placeholder={hint.usps} /></label>
      <label className="stack-field">OFFER<input value={form.offer} onChange={set('offer')} maxLength={300} placeholder={hint.offer} /></label>
      <label className="stack-field">PRICE<input value={form.priceText} onChange={set('priceText')} maxLength={160} placeholder={hint.price} /></label>
      <label className="stack-field">{hint.locationLabel}<input value={form.locations} onChange={set('locations')} maxLength={400} placeholder={hint.location} /></label>
      <label className="stack-field">WEBSITE OR LANDING PAGE<input type="url" value={form.website} onChange={set('website')} placeholder="https://" /></label>
      {item ? (
        <label className="stack-field">STATUS
          <select value={form.status} onChange={set('status')}>
            <option value="active">Active (offered in ad chat)</option>
            <option value="archived">Archived (hidden from ad chat)</option>
          </select>
        </label>
      ) : null}
      {!item && form.website.trim() ? (
        <label className="check-row">
          <input type="checkbox" checked={form.websiteForm} onChange={(event) => setForm((current) => ({ ...current, websiteForm: event.target.checked }))} />
          <span>
            <strong>Create a website form link (webhook)</strong>
            <small>Paste it on your WordPress or HTML website. Every form filled there comes into Leads, split by Google Ads, Meta Ads or the website.</small>
          </span>
        </label>
      ) : null}
      {!item && !form.website.trim() ? <p className="quiet">Add the website or landing page link to get a website form link (webhook) for this item.</p> : null}
      {item?.formToken && !form.website.trim() ? <p className="quiet">Removing the website link also turns off the website form link.</p> : null}
      {!item ? <p className="quiet">Save first, then add photos from the list below.</p> : null}
      <div className="page-actions">
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {message ? <span className="quiet">{message}</span> : null}
      </div>
    </form>
  );
}

function points(value) {
  return String(value || '')
    .split(/\n|,|;|•|\|/)
    .map((part) => part.replace(/^[\s\-*]+/, '').trim())
    .filter((part) => part.length > 1)
    .slice(0, 3);
}

function toneOf(name) {
  let sum = 0;
  for (const char of String(name)) sum = (sum + char.charCodeAt(0)) % 997;
  return sum % 6;
}

function initialsOf(name) {
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function OfferingCard({ item, catalog, maxPhotos, canManage, onEdit, onDelete, onForm, onChange }) {
  const cover = item.photoIds?.[0];
  const highlights = points(item.usps);
  const archived = item.status === 'archived';
  return (
    <article className={`offer-card${archived ? ' is-archived' : ''}`}>
      <div className={`offer-cover tone-${toneOf(item.name)}`}>
        {cover ? <MediaImage id={cover} alt={item.name} /> : <span className="offer-initials">{initialsOf(item.name)}</span>}
        <span className="offer-kind">{kindLabel(catalog, item.kind)}</span>
        {archived ? <span className="offer-state">Archived</span> : null}
      </div>
      <div className="offer-body">
        <div className="offer-title">
          <h3>{item.name}</h3>
          {item.locations ? <p className="offer-place">{item.locations}</p> : null}
        </div>
        {item.priceText || item.offer ? (
          <div className="offer-money">
            {item.priceText ? <strong>{item.priceText}</strong> : null}
            {item.offer ? <span className="offer-deal">{item.offer}</span> : null}
          </div>
        ) : null}
        {item.details ? <p className="offer-details">{item.details}</p> : null}
        {highlights.length ? <div className="offer-tags">{highlights.map((text) => <span key={text}>{text}</span>)}</div> : null}
        <Photos item={item} maxPhotos={maxPhotos} canManage={canManage} onChange={onChange} />
      </div>
      <div className="offer-stats">
        <div>
          <span>Used in ads</span>
          <strong>{item.timesUsed ? `${item.timesUsed}×` : 'Not yet'}</strong>
          {item.timesUsed ? <small>{day(item.lastUsedAt)}</small> : <small>{SOURCE[item.source] || label(item.source)}</small>}
        </div>
        <div>
          <span>Website form</span>
          {!item.website ? <><strong className="is-muted">Off</strong><small>Add a website link first</small></> : item.formToken
            ? <><strong>{item.formLeads ? `${item.formLeads} leads` : 'Live'}</strong><small className={`check-note is-${item.formCheck || 'none'}`}>{CHECK_SHORT[item.formCheck] || 'Code not checked'}</small></>
            : <><strong className="is-muted">Not set up</strong><small>Website added</small></>}
        </div>
      </div>
      <footer className="offer-actions">
        {item.website ? (
          <button className={item.formToken ? 'btn' : 'btn-primary'} type="button" onClick={() => onForm(item.id)} disabled={!item.formToken && !canManage}>
            {item.formToken ? 'Website form code' : 'Create website form'}
          </button>
        ) : null}
        {item.website ? <a className="btn-ghost" href={item.website} target="_blank" rel="noreferrer">Open site</a> : null}
        {canManage ? (
          <span className="offer-icons">
            <button className="edit-btn" type="button" onClick={() => onEdit(item)} aria-label={`Edit ${item.name}`} title="Edit">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            </button>
            <button className="edit-btn is-danger" type="button" onClick={() => onDelete(item)} aria-label={`Delete ${item.name}`} title="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" /></svg>
            </button>
          </span>
        ) : null}
      </footer>
    </article>
  );
}

export function Offerings() {
  const { can } = useAuth();
  const canManage = can('campaigns.update');
  const { data, loading, error, reload } = useResource('/api/offerings');
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const [formFor, setFormFor] = useState(null);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [view, setView] = useState('active');
  const items = data?.items || [];
  const kindsUsed = [...new Set(items.map((row) => row.kind))];
  const needle = query.trim().toLowerCase();
  const shown = items
    .filter((row) => (view === 'all' ? true : row.status === view))
    .filter((row) => kind === 'all' || row.kind === kind)
    .filter((row) => !needle || [row.name, row.details, row.usps, row.offer, row.locations, row.priceText].some((value) => String(value || '').toLowerCase().includes(needle)));
  const active = items.filter((row) => row.status === 'active').length;
  const withForm = items.filter((row) => row.formToken).length;
  const formLeads = items.reduce((sum, row) => sum + Number(row.formLeads || 0), 0);
  const usedInAds = items.filter((row) => row.timesUsed).length;
  const formItem = formFor ? items.find((row) => row.website && (row.id === formFor || row.name === formFor)) : null;
  const catalog = data?.catalog?.kinds?.length ? data.catalog : FALLBACK;
  const refresh = () => reload({ silent: true });

  async function remove(item) {
    if (!window.confirm(`Delete ${item.name}? AIRO will stop offering it in the ad chat.`)) return;
    setNote('');
    try {
      await api.del(`/api/offerings/${item.id}`);
      refresh();
    } catch (err) {
      setNote(err.message);
    }
  }

  const done = (openForm) => {
    setEditing(null);
    if (openForm) setFormFor(openForm);
    refresh();
  };


  return (
    <Page
      eyebrow="Growth"
      title="Products & Projects"
      lede="Everything you sell, with details, selling points, offers and photos. When you say run meta ads or run google ads on WhatsApp, AIRO lists these so you can pick one or more, or add something new. Photos and your logo are used in the ad designs."
      actions={canManage && editing === null ? <button className="btn-primary" type="button" onClick={() => setEditing(false)}>Add new</button> : null}
    >
      <State
        loading={loading}
        error={error}
        onRetry={reload}
        empty={!loading && data?.ready && !items.length && editing === null && !canManage
          ? { title: 'Nothing saved yet', body: 'Tell AIRO about a product, project or service on WhatsApp, run an ad setup, or add one here.' }
          : null}
      >
        {data && !data.ready ? <p className="quiet">{data.note}</p> : (
          <div className="stack">
            <div className="offer-top">
              <div className="metric-strip offer-metrics">
                <div className="metric"><span>Active</span><strong>{num(active)}</strong><em>{num(items.length - active)} archived</em></div>
                <div className="metric"><span>Used in ads</span><strong>{num(usedInAds)}</strong><em>Picked in an ad setup</em></div>
                <div className="metric"><span>Website forms</span><strong>{num(withForm)}</strong><em>Links that are live</em></div>
                <div className="metric"><span>Form leads</span><strong>{num(formLeads)}</strong><em>From all website forms</em></div>
              </div>
              <LogoPanel logoId={data?.logoId} canManage={canManage} onChange={refresh} />
            </div>
            {editing !== null ? <OfferingForm key={editing?.id || 'new'} item={editing || null} catalog={catalog} onDone={done} onCancel={() => setEditing(null)} /> : null}
            {formItem ? <WebsiteFormPanel key={formItem.id} item={formItem} canManage={canManage} onChange={refresh} onClose={() => setFormFor(null)} /> : null}
            {note ? <p className="quiet">{note}</p> : null}
            {items.length ? (
              <>
                <div className="offer-toolbar">
                  <div className="chip-tabs">
                    {['active', 'archived', 'all'].map((key) => (
                      <button key={key} type="button" className={view === key ? 'is-on' : ''} onClick={() => setView(key)}>
                        {key === 'all' ? `All · ${items.length}` : `${label(key)} · ${items.filter((row) => row.status === key).length}`}
                      </button>
                    ))}
                  </div>
                  {kindsUsed.length > 1 ? (
                    <div className="chip-tabs">
                      <button type="button" className={kind === 'all' ? 'is-on' : ''} onClick={() => setKind('all')}>Every type</button>
                      {kindsUsed.map((key) => <button key={key} type="button" className={kind === key ? 'is-on' : ''} onClick={() => setKind(key)}>{kindLabel(catalog, key)}</button>)}
                    </div>
                  ) : null}
                  <input className="offer-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, place, offer" aria-label="Search products and projects" />
                </div>
                {shown.length ? (
                  <div className="offer-grid">
                    {shown.map((item) => (
                      <OfferingCard
                        key={item.id}
                        item={item}
                        catalog={catalog}
                        maxPhotos={data?.maxPhotos || 5}
                        canManage={canManage}
                        onEdit={(row) => { setEditing(row); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                        onDelete={remove}
                        onForm={setFormFor}
                        onChange={refresh}
                      />
                    ))}
                  </div>
                ) : <p className="quiet">Nothing matches. Clear the search or pick another filter.</p>}
              </>
            ) : (
              <div className="offer-empty">
                <strong>Nothing saved yet</strong>
                <p className="quiet">Add your first product, project or service. You can also tell AIRO about it on WhatsApp.</p>
                {canManage && editing === null ? <button className="btn-primary" type="button" onClick={() => setEditing(false)}>Add new</button> : null}
              </div>
            )}
          </div>
        )}
      </State>
    </Page>
  );
}
