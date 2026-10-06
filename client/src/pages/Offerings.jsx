import { useEffect, useState } from 'react';
import { api, currentToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { day, label } from '../format.js';
import { Badge, Page, State, Table } from '../ui.jsx';

const KINDS = ['product', 'project', 'service', 'course', 'package', 'other'];
const SOURCE = { manual: 'Added here', whatsapp: 'From WhatsApp chat', ad_chat: 'From ad setup' };
const EMPTY = { kind: 'product', name: '', details: '', usps: '', offer: '', priceText: '', locations: '', website: '', status: 'active' };
const MAX_BYTES = 2 * 1024 * 1024;

function toForm(item) {
  if (!item) return { ...EMPTY };
  return Object.fromEntries(Object.keys(EMPTY).map((key) => [key, item[key] || EMPTY[key]]));
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
          {canManage ? <button className="btn" type="button" onClick={() => remove(id)}>Delete</button> : null}
        </figure>
      ))}
      {canManage && ids.length < maxPhotos ? <ImageUpload text={busy ? 'Uploading…' : 'Add photo'} onFile={upload} disabled={busy} /> : null}
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
        <p className="quiet">AIRO puts this logo on the ad designs it makes. PNG with a transparent background looks best.</p>
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

function OfferingForm({ item, onDone, onCancel }) {
  const [form, setForm] = useState(toForm(item));
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
      onDone();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid" onSubmit={save}>
      <header><h2>{item ? `Edit ${item.name}` : 'Add a product, project or service'}</h2></header>
      <label className="stack-field">TYPE
        <select value={form.kind} onChange={set('kind')}>{KINDS.map((kind) => <option key={kind} value={kind}>{label(kind)}</option>)}</select>
      </label>
      <label className="stack-field">NAME<input value={form.name} onChange={set('name')} required minLength={2} maxLength={160} /></label>
      <label className="stack-field">DETAILS<textarea value={form.details} onChange={set('details')} maxLength={2000} placeholder="What it is: sizes, configuration, duration, what is included" /></label>
      <label className="stack-field">SELLING POINTS (USPs)<textarea value={form.usps} onChange={set('usps')} maxLength={1000} placeholder="Why people should choose it, for example near metro, 10 years experience, free trial" /></label>
      <label className="stack-field">OFFER<input value={form.offer} onChange={set('offer')} maxLength={300} placeholder="For example 10% off till 31 Oct, free site visit" /></label>
      <label className="stack-field">PRICE<input value={form.priceText} onChange={set('priceText')} maxLength={160} placeholder="For example 45 lakh onwards" /></label>
      <label className="stack-field">LOCATION<input value={form.locations} onChange={set('locations')} maxLength={400} placeholder="Where it is or where you sell it" /></label>
      <label className="stack-field">WEBSITE OR LANDING PAGE<input type="url" value={form.website} onChange={set('website')} placeholder="https://" /></label>
      {item ? (
        <label className="stack-field">STATUS
          <select value={form.status} onChange={set('status')}>
            <option value="active">Active (offered in ad chat)</option>
            <option value="archived">Archived (hidden from ad chat)</option>
          </select>
        </label>
      ) : null}
      {!item ? <p className="quiet">Save first, then add photos from the list below.</p> : null}
      <div className="page-actions">
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        {message ? <span className="quiet">{message}</span> : null}
      </div>
    </form>
  );
}

export function Offerings() {
  const { can } = useAuth();
  const canManage = can('campaigns.update');
  const { data, loading, error, reload } = useResource('/api/offerings');
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const items = data?.items || [];
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

  const done = () => {
    setEditing(null);
    refresh();
  };

  const columns = [
    { key: 'name', label: 'Name', render: (row) => <><strong>{row.name}</strong><small>{label(row.kind)}</small></> },
    {
      key: 'details',
      label: 'Details',
      render: (row) => (
        <>
          {row.details ? <span>{String(row.details).slice(0, 140)}</span> : null}
          {row.usps ? <small>USPs: {String(row.usps).slice(0, 120)}</small> : null}
          {row.offer ? <small>Offer: {row.offer}</small> : null}
          {!row.details && !row.usps && !row.offer ? '—' : null}
        </>
      )
    },
    { key: 'priceText', label: 'Price', render: (row) => row.priceText || '—' },
    { key: 'locations', label: 'Location', render: (row) => row.locations || '—' },
    { key: 'photos', label: 'Photos', render: (row) => <Photos item={row} maxPhotos={data?.maxPhotos || 5} canManage={canManage} onChange={refresh} /> },
    { key: 'source', label: 'Saved from', render: (row) => SOURCE[row.source] || label(row.source) },
    { key: 'status', label: 'Status', render: (row) => <Badge value={row.status} /> },
    { key: 'timesUsed', label: 'Used in ads', render: (row) => row.timesUsed ? `${row.timesUsed}× · ${day(row.lastUsedAt)}` : 'Not yet' },
    ...(canManage ? [{
      key: 'actions',
      label: '',
      render: (row) => (
        <div className="filters">
          <button className="btn" type="button" onClick={() => setEditing(row)}>Edit</button>
          <button className="btn" type="button" onClick={() => remove(row)}>Delete</button>
        </div>
      )
    }] : [])
  ];

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
            <LogoPanel logoId={data?.logoId} canManage={canManage} onChange={refresh} />
            {editing !== null ? <OfferingForm key={editing?.id || 'new'} item={editing || null} onDone={done} onCancel={() => setEditing(null)} /> : null}
            {note ? <p className="quiet">{note}</p> : null}
            {items.length ? <Table columns={columns} rows={items} /> : (
              <p className="quiet">Nothing saved yet. Press Add new, or tell AIRO about a product, project or service on WhatsApp.</p>
            )}
          </div>
        )}
      </State>
    </Page>
  );
}
