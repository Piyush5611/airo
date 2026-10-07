import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { num, when } from '../format.js';
import { Page, State } from '../ui.jsx';

const EMPTY = { name: '', website: '', facebook: '', instagram: '', city: '', notes: '', status: 'active' };
const THREAT = { high: ['bad', 'High threat'], medium: ['warn', 'Medium threat'], low: ['good', 'Low threat'], unknown: ['', 'Threat unclear'] };
const VERDICT = { we_lead: ['good', 'We lead'], they_lead: ['bad', 'They lead'], even: ['info', 'Even'], unclear: ['', 'Unclear'] };
const TABS = [['overview', 'Overview'], ['offers', 'Website & offers'], ['compare', 'Compare with us'], ['keywords', 'Search demand'], ['sources', 'Sources']];

function host(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function pageName(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

function ThreatBadge({ value }) {
  if (!value) return <span className="badge">Not analysed</span>;
  const [tone, text] = THREAT[value] || THREAT.unknown;
  return <span className={`badge ${tone}`}>{text}</span>;
}

function CompetitorForm({ item, onDone, onCancel }) {
  const [form, setForm] = useState(item ? Object.fromEntries(Object.keys(EMPTY).map((key) => [key, item[key] || EMPTY[key]])) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const saved = item ? await api.patch(`/api/competitors/${item.id}`, form) : await api.post('/api/competitors', form);
      onDone(saved);
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel form-grid offer-form" onSubmit={save}>
      <header>
        <h2>{item ? `Edit ${item.name}` : 'Add a competitor'}</h2>
        <p className="quiet">AIRO reads their public website to find what they sell, their prices and offers, and compares it with your saved products and projects.</p>
      </header>
      <label className="stack-field">NAME<input value={form.name} onChange={set('name')} required minLength={2} maxLength={160} placeholder="Business or brand name" /></label>
      <label className="stack-field">WEBSITE<input value={form.website} onChange={set('website')} maxLength={500} placeholder="example.com" /></label>
      <label className="stack-field">CITY OR AREA<input value={form.city} onChange={set('city')} maxLength={120} placeholder="Where they compete with you" /></label>
      <label className="stack-field">FACEBOOK PAGE<input value={form.facebook} onChange={set('facebook')} maxLength={300} placeholder="facebook.com/their-page (optional)" /></label>
      <label className="stack-field">INSTAGRAM<input value={form.instagram} onChange={set('instagram')} maxLength={120} placeholder="@handle (optional)" /></label>
      {item ? (
        <label className="stack-field">STATUS
          <select value={form.status} onChange={set('status')}>
            <option value="active">Active (tracked)</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      ) : null}
      <label className="stack-field comp-notes">WHAT YOU KNOW ABOUT THEM<textarea value={form.notes} onChange={set('notes')} maxLength={1000} placeholder="Optional. For example: they run discount ads every month, their sales team calls fast." /></label>
      <div className="page-actions">
        <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
        <button className="btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
      {message ? <p className="quiet">{message}</p> : null}
    </form>
  );
}

function List({ title, items, empty }) {
  if (!items?.length) return empty ? <div className="comp-block"><h3>{title}</h3><p className="quiet">{empty}</p></div> : null;
  return (
    <div className="comp-block">
      <h3>{title}</h3>
      <ul className="comp-list">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    </div>
  );
}

function Overview({ analysis }) {
  return (
    <div className="stack">
      <div className="comp-summary">
        <p>{analysis.summary}</p>
        {analysis.threatWhy ? <p className="quiet">{analysis.threatWhy}</p> : null}
      </div>
      <div className="comp-facts">
        {analysis.positioning ? <div><span>Positioning</span><strong>{analysis.positioning}</strong></div> : null}
        {analysis.audience ? <div><span>Who they target</span><strong>{analysis.audience}</strong></div> : null}
        {analysis.priceRange ? <div><span>Prices seen</span><strong>{analysis.priceRange}</strong></div> : null}
      </div>
      {analysis.actions?.length ? (
        <div className="comp-block">
          <h3>What you can do</h3>
          <ol className="comp-actions">
            {analysis.actions.map((action, index) => <li key={`${index}-${action.title}`}><strong>{action.title}</strong><span>{action.detail}</span></li>)}
          </ol>
        </div>
      ) : null}
      <div className="comp-two">
        <List title="Their strengths" items={analysis.strengths} />
        <List title="Their weak spots" items={analysis.weaknesses} />
      </div>
      <div className="comp-two">
        <List title="What their website pushes" items={analysis.messaging} />
        <List title="How they collect enquiries" items={analysis.leadCapture} />
      </div>
      <List title="Not found on their website" items={analysis.gaps} />
    </div>
  );
}

function Offers({ analysis, website }) {
  const offers = analysis.offerings || [];
  return (
    <div className="stack">
      {offers.length ? (
        <div className="comp-offers">
          {offers.map((item, index) => (
            <article className="comp-offer" key={`${index}-${item.name}`}>
              <header>
                <strong>{item.name}</strong>
                {item.type ? <span className="badge info">{item.type}</span> : null}
              </header>
              {item.location ? <p className="quiet">{item.location}</p> : null}
              {item.price ? <p className="comp-price">{item.price}</p> : null}
              {item.offer ? <p className="comp-deal">{item.offer}</p> : null}
              {item.highlights?.length ? <ul className="comp-list">{item.highlights.map((text, i) => <li key={`${i}-${text}`}>{text}</li>)}</ul> : null}
              {item.source ? <a className="comp-source" href={item.source} target="_blank" rel="noreferrer">Seen on {pageName(item.source)}</a> : null}
            </article>
          ))}
        </div>
      ) : <p className="quiet">No product, project or service was clearly listed on the pages AIRO read.</p>}
      {website?.pages?.some((page) => page.prices?.length) ? (
        <div className="comp-block">
          <h3>Prices written on their pages</h3>
          <div className="comp-chips">{[...new Set(website.pages.flatMap((page) => page.prices || []))].slice(0, 20).map((price) => <span key={price} className="channel-pill">{price}</span>)}</div>
        </div>
      ) : null}
    </div>
  );
}

function Compare({ analysis }) {
  const rows = analysis.comparison || [];
  if (!rows.length) {
    return (
      <p className="quiet">
        Nothing to compare yet. Add your own items in <Link to="/app/growth/offerings">Products &amp; Projects</Link> with price, offer and location, then analyse again.
      </p>
    );
  }
  return (
    <div className="comp-compare">
      {rows.map((row, index) => {
        const [tone, text] = VERDICT[row.verdict] || VERDICT.unclear;
        return (
          <div className="comp-row" key={`${index}-${row.ours}`}>
            <div><span>Ours</span><strong>{row.ours || '—'}</strong></div>
            <div><span>Theirs</span><strong>{row.theirs || '—'}</strong></div>
            <span className={`badge ${tone}`}>{text}</span>
            {row.note ? <p className="quiet">{row.note}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

function Keywords({ keywords, notes }) {
  const rows = keywords?.rows || [];
  if (!rows.length) {
    const note = notes.find((line) => /google/i.test(line));
    return <p className="quiet">{note || 'Google Keyword Planner returned no search data for this competitor.'}</p>;
  }
  const money = (value) => (value == null ? '—' : `${keywords.currency || ''} ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`.trim());
  return (
    <div className="stack">
      <p className="quiet">Monthly Google searches in India for words linked to this competitor and their website. From your Google Ads Keyword Planner.</p>
      <div className="table-wrap">
        <table className="responsive">
          <thead><tr><th>Search words</th><th>Searches / month</th><th>Competition</th><th>Top of page bid</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.text}>
                <td data-label="Search words">{row.text}</td>
                <td data-label="Searches / month">{num(Number(row.searches))}</td>
                <td data-label="Competition">{row.competition ? row.competition.toLowerCase() : '—'}</td>
                <td data-label="Top of page bid">{row.lowBid == null && row.highBid == null ? '—' : `${money(row.lowBid)} to ${money(row.highBid)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Sources({ report }) {
  const pages = report.website?.pages || [];
  return (
    <div className="stack">
      {pages.length ? (
        <ul className="comp-pages">
          {pages.map((page) => (
            <li key={page.url}>
              <a href={page.url} target="_blank" rel="noreferrer">{page.title || page.url}</a>
              <small>{page.url}</small>
              {page.description ? <p className="quiet">{page.description}</p> : null}
            </li>
          ))}
        </ul>
      ) : <p className="quiet">No page could be read.</p>}
      <p className="quiet">
        AIRO only reads public pages and does not run JavaScript, so content that loads later may be missed.
        {report.model ? ` Analysis by ${report.model}.` : ''} {when(report.createdAt)}
      </p>
    </div>
  );
}

const FIT = { direct: ['bad', 'Direct competitor'], indirect: ['warn', 'Indirect'], unclear: ['', 'Check yourself'] };
const SOURCE = { google_ad: 'Google ad', google_search: 'Google search', meta_ad: 'Meta ads', maps: 'Google Maps' };

function Suggestions({ canManage, onAdded }) {
  const { data, loading, error, reload } = useResource('/api/competitors/suggestions');
  const [busy, setBusy] = useState(0);
  const [message, setMessage] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const running = Boolean(data?.running);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => reload({ silent: true }), 5000);
    return () => clearInterval(timer);
  }, [running, reload]);

  async function act(path, id = -1) {
    setBusy(id);
    setMessage('');
    try {
      const result = await api.post(path, {});
      if (result.competitorId) {
        setMessage(result.analysing ? 'Added. AIRO is reading their website now.' : 'Added to your competitors.');
        onAdded(result.competitorId);
      }
      reload({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(0);
    }
  }

  if (loading || error || !data?.ready) return null;
  const items = data.items || [];
  const fresh = items.filter((row) => row.status === 'new');
  const ignored = items.filter((row) => row.status === 'ignored');
  const shown = showIgnored ? ignored : fresh;
  const run = data.run;

  return (
    <section className="panel comp-suggest">
      <header className="comp-head">
        <div>
          <h2>Suggested by AIRO</h2>
          <p className="quiet">
            AIRO searches Google, Meta ads and Google Maps for what you sell, removes portals and directories, reads each website and asks AI whether they really compete with you. Every week, and whenever you press Find competitors.
          </p>
        </div>
        {canManage && data.apify ? (
          <button className="btn-primary" type="button" onClick={() => act('/api/competitors/discover')} disabled={running || busy !== 0}>
            {running ? 'Searching...' : 'Find competitors'}
          </button>
        ) : null}
      </header>
      {!data.apify ? (
        <div className="comp-failed">
          <strong>Connect Apify to let AIRO find competitors.</strong>
          <span>Open <Link to="/app/connections?section=Research">Connections, Research</Link> and save your Apify token. The free Apify plan gives $5 credit a month; one search uses about $0.50 at most.</span>
        </div>
      ) : null}
      {running ? (
        <div className="comp-running">
          <span className="comp-spinner" aria-hidden="true" />
          <div>
            <strong>Searching Google, Meta ads and Google Maps...</strong>
            <p className="quiet">This takes 2 to 4 minutes. You can leave this page.</p>
          </div>
        </div>
      ) : null}
      {!running && run ? (
        <p className="quiet comp-note">
          Last search {when(run.finishedAt || run.startedAt)}{run.triggerType === 'weekly' ? ' (weekly)' : ''}
          {run.status === 'failed' ? ' did not finish. ' : '. '}
          {run.counts ? `Checked ${num(run.counts.candidates)} businesses, suggested ${num(run.counts.suggested)}, left out ${num(run.counts.dropped)} that were not a match. ` : ''}
          {run.plan?.searches?.length ? `Searched: ${run.plan.searches.join(', ')}. ` : ''}
          {(run.notes || []).join(' ')}
        </p>
      ) : null}
      {message ? <p className="quiet">{message}</p> : null}
      {shown.length ? (
        <div className="comp-suggest-grid">
          {shown.map((row) => {
            const [tone, text] = FIT[row.verdict] || FIT.unclear;
            return (
              <article className="comp-offer" key={row.id}>
                <header>
                  <strong>{row.name}</strong>
                  <span className={`badge ${tone}`}>{text}</span>
                </header>
                <p className="quiet">{[row.website ? host(row.website) : '', row.city, row.category].filter(Boolean).join(' · ') || 'No website found'}</p>
                {row.reason ? <p>{row.reason}</p> : null}
                <div className="comp-chips">
                  {row.sources.slice(0, 5).map((source, index) => (
                    <span key={`${index}-${source.type}`} className="channel-pill" title={source.note}>
                      {SOURCE[source.type] || source.type}{source.query ? `: ${source.query}` : ''}
                    </span>
                  ))}
                </div>
                {canManage ? (
                  <div className="page-actions">
                    {row.status === 'new' ? <button className="btn-primary" type="button" disabled={busy !== 0} onClick={() => act(`/api/competitors/suggestions/${row.id}/add`, row.id)}>{busy === row.id ? 'Adding...' : 'Add'}</button> : null}
                    <button className="btn" type="button" disabled={busy !== 0} onClick={() => act(`/api/competitors/suggestions/${row.id}/ignore`, row.id)}>{row.status === 'ignored' ? 'Bring back' : 'Ignore'}</button>
                    {row.website ? <a className="btn-ghost" href={row.website} target="_blank" rel="noreferrer">Website</a> : row.facebook ? <a className="btn-ghost" href={row.facebook} target="_blank" rel="noreferrer">Facebook</a> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : data.apify && !running ? <p className="quiet">{showIgnored ? 'Nothing ignored.' : run ? 'No new suggestions. AIRO searches again next week.' : 'Press Find competitors to start.'}</p> : null}
      {ignored.length ? (
        <button className="btn-ghost" type="button" onClick={() => setShowIgnored((value) => !value)}>
          {showIgnored ? 'Back to suggestions' : `Ignored (${ignored.length})`}
        </button>
      ) : null}
    </section>
  );
}

function Detail({ id, canManage, onChanged, onEdit }) {
  const { data, loading, error, reload } = useResource(`/api/competitors/${id}`);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const running = Boolean(data?.running);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => reload({ silent: true }), 4000);
    return () => clearInterval(timer);
  }, [running, reload]);

  useEffect(() => {
    if (data && !running) onChanged();
  }, [data?.report?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps

  async function analyze() {
    setBusy(true);
    setMessage('');
    try {
      await api.post(`/api/competitors/${id}/analyze`, {});
      reload({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <State loading={loading} error={error} onRetry={reload}>
      {data ? (
        <section className="panel comp-detail">
          <header className="comp-head">
            <div>
              <h2>{data.name}</h2>
              <p className="quiet">
                {[data.city, data.website ? host(data.website) : 'No website'].filter(Boolean).join(' · ')}
                {data.lastAnalyzedAt ? ` · analysed ${when(data.lastAnalyzedAt)}` : ''}
              </p>
            </div>
            <div className="page-actions">
              <ThreatBadge value={data.report?.status === 'ready' ? data.report.analysis?.threat : null} />
              {data.website ? <a className="btn" href={data.website} target="_blank" rel="noreferrer">Open website</a> : null}
              {canManage ? <button className="btn" type="button" onClick={() => onEdit(data)}>Edit</button> : null}
              {canManage ? (
                <button className="btn-primary" type="button" onClick={analyze} disabled={busy || running || !data.website}>
                  {running ? 'Analysing...' : data.report ? 'Analyse again' : 'Analyse now'}
                </button>
              ) : null}
            </div>
          </header>
          {message ? <p className="quiet">{message}</p> : null}
          {!data.website ? <p className="quiet">Add their website so AIRO can read it.</p> : null}
          {running ? (
            <div className="comp-running">
              <span className="comp-spinner" aria-hidden="true" />
              <div>
                <strong>Reading their website and comparing with your products...</strong>
                <p className="quiet">This takes about a minute. You can leave this page; the result is saved.</p>
              </div>
            </div>
          ) : null}
          {!running && data.report?.status === 'failed' ? (
            <div className="comp-failed">
              <strong>The last analysis did not finish.</strong>
              <ul className="comp-list">{(data.report.notes || []).map((note) => <li key={note}>{note}</li>)}</ul>
            </div>
          ) : null}
          {!running && !data.report && data.website ? <p className="quiet">Not analysed yet. Press Analyse now.</p> : null}
          {data.report?.status === 'ready' && data.report.analysis ? (
            <>
              <div className="chip-tabs comp-tabs">
                {TABS.map(([key, text]) => <button key={key} type="button" className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>{text}</button>)}
              </div>
              {tab === 'overview' ? <Overview analysis={data.report.analysis} /> : null}
              {tab === 'offers' ? <Offers analysis={data.report.analysis} website={data.report.website} /> : null}
              {tab === 'compare' ? <Compare analysis={data.report.analysis} /> : null}
              {tab === 'keywords' ? <Keywords keywords={data.report.keywords} notes={data.report.notes || []} /> : null}
              {tab === 'sources' ? <Sources report={data.report} /> : null}
              {data.report.notes?.length && tab !== 'keywords' ? <p className="quiet comp-note">{data.report.notes.join(' ')}</p> : null}
            </>
          ) : null}
        </section>
      ) : null}
    </State>
  );
}

export function Competitors() {
  const { can } = useAuth();
  const canManage = can('campaigns.update');
  const navigate = useNavigate();
  const { id } = useParams();
  const { data, loading, error, reload } = useResource('/api/competitors');
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const [version, setVersion] = useState(0);
  const items = data?.items || [];
  const selected = id ? Number(id) : null;
  const analysed = items.filter((row) => row.summary).length;
  const high = items.filter((row) => row.threat === 'high').length;
  const refresh = () => reload({ silent: true });

  async function importProfile() {
    setNote('');
    try {
      const result = await api.post('/api/competitors/import-profile', {});
      setNote(result.added ? `Added ${result.added} from your business profile.` : result.found ? 'Everyone in your business profile is already here.' : 'Your business profile has no competitors listed.');
      refresh();
    } catch (err) {
      setNote(err.message);
    }
  }

  async function remove(item) {
    if (!window.confirm(`Remove ${item.name} and all its analysis?`)) return;
    try {
      await api.del(`/api/competitors/${item.id}`);
      if (selected === item.id) navigate('/app/growth/competitors');
      refresh();
    } catch (err) {
      setNote(err.message);
    }
  }

  function done(saved) {
    setEditing(null);
    setVersion((value) => value + 1);
    refresh();
    if (saved?.id) navigate(`/app/growth/competitors/${saved.id}`);
  }

  return (
    <Page
      eyebrow="Growth"
      title="Competitors"
      lede="AIRO finds who you compete with, reads their website, finds what they sell, their prices and offers, compares them with your products and projects, and suggests what to do. Ask for it on WhatsApp too: send competitors."
      actions={canManage && editing === null ? (
        <>
          <button className="btn" type="button" onClick={importProfile}>Import from profile</button>
          <button className="btn-primary" type="button" onClick={() => setEditing(false)}>Add competitor</button>
        </>
      ) : null}
    >
      <State loading={loading} error={error} onRetry={reload}>
        {data && !data.ready ? <p className="quiet">{data.note}</p> : (
          <div className="stack">
            <div className="metric-strip offer-metrics">
              <div className="metric"><span>Tracked</span><strong>{num(items.filter((row) => row.status === 'active').length)}</strong><em>{num(items.length)} saved</em></div>
              <div className="metric"><span>Analysed</span><strong>{num(analysed)}</strong><em>Have a report</em></div>
              <div className="metric"><span>High threat</span><strong>{num(high)}</strong><em>Same market, similar or better deal</em></div>
            </div>
            {editing !== null ? <CompetitorForm key={editing?.id || 'new'} item={editing || null} onDone={done} onCancel={() => setEditing(null)} /> : null}
            <Suggestions canManage={canManage} onAdded={(competitorId) => { refresh(); navigate(`/app/growth/competitors/${competitorId}`); }} />
            {note ? <p className="quiet">{note}</p> : null}
            {items.length ? (
              <div className="comp-layout">
                <div className="comp-cards">
                  {items.map((item) => (
                    <article
                      key={item.id}
                      className={`comp-card${selected === item.id ? ' is-on' : ''}${item.status === 'archived' ? ' is-archived' : ''}`}
                      onClick={() => navigate(`/app/growth/competitors/${item.id}`)}
                      onKeyDown={(event) => { if (event.key === 'Enter') navigate(`/app/growth/competitors/${item.id}`); }}
                      tabIndex={0}
                    >
                      <header>
                        <strong>{item.name}</strong>
                        <ThreatBadge value={item.threat} />
                      </header>
                      <p className="quiet">{[item.city, item.website ? host(item.website) : 'No website', item.status === 'archived' ? 'archived' : ''].filter(Boolean).join(' · ')}</p>
                      {item.summary ? <p className="comp-card-summary">{item.summary}</p> : null}
                      <footer>
                        <small>{item.running ? 'Analysing...' : item.lastAnalyzedAt ? `Analysed ${when(item.lastAnalyzedAt)}` : 'Not analysed yet'}</small>
                        {canManage ? <button type="button" className="comp-remove" onClick={(event) => { event.stopPropagation(); remove(item); }}>Remove</button> : null}
                      </footer>
                    </article>
                  ))}
                </div>
                <div>
                  {selected ? (
                    <Detail key={`${selected}-${version}`} id={selected} canManage={canManage} onChanged={refresh} onEdit={(row) => { setEditing(row); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
                  ) : (
                    <div className="offer-empty"><strong>Pick a competitor</strong><p className="quiet">Open one to see the analysis, or press Analyse now.</p></div>
                  )}
                </div>
              </div>
            ) : (
              <div className="offer-empty">
                <strong>No competitors yet</strong>
                <p className="quiet">Add a competitor with their website. AIRO reads it and compares it with your products and projects. No paid tool is needed.</p>
                {canManage && editing === null ? <button className="btn-primary" type="button" onClick={() => setEditing(false)}>Add competitor</button> : null}
              </div>
            )}
          </div>
        )}
      </State>
    </Page>
  );
}
