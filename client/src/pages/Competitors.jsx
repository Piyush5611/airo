import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useResource } from '../data.js';
import { inr, num, when } from '../format.js';
import { Page, State } from '../ui.jsx';
import { AdIdeas, AdInsights, AdLibrary, AdSnapshot, CompetitorStrategy, IntelOverview, MarketGaps, StepGuide, TypeBadge } from './CompetitorIntel.jsx';

const EMPTY = { name: '', website: '', facebook: '', instagram: '', city: '', notes: '', status: 'active', competitorType: '' };
const VIEWS = [['list', 'Competitors'], ['ads', 'Their ads'], ['overview', 'Market overview'], ['gaps', 'Opportunities'], ['ideas', 'Ads for you']];
const THREAT = { high: ['bad', 'High threat'], medium: ['warn', 'Medium threat'], low: ['good', 'Low threat'], unknown: ['', 'Threat unclear'] };
const VERDICT = { we_lead: ['good', 'We lead'], they_lead: ['bad', 'They lead'], even: ['info', 'Even'], unclear: ['', 'Unclear'] };
const TABS = [['summary', 'Summary'], ['website', 'Website & offers'], ['compare', 'Compare with us'], ['ads', 'Their ads'], ['say', 'What their ads say'], ['strategy', 'How to stand apart'], ['ideas', 'Ads against them'], ['more', 'Search & sources']];
const TAB_HINT = {
  summary: 'The short version: their ads, what their website pushes, and what you can do.',
  website: 'What they sell, prices and offers, read from their public website.',
  compare: 'Their products and prices next to yours, item by item.',
  ads: 'Their live ads on Meta and Google, from the public ad libraries. Press Check ads to read them again.',
  say: 'AI reads the text of each ad: message, topics, offers, buttons and how it changed over time.',
  strategy: 'AI ideas to stand apart from them. It never copies their wording, creatives or claims.',
  ideas: 'Ready ads and moves AIRO thinks are right against this competitor, from their website and their ads.',
  more: 'Monthly Google searches linked to them, and the website pages AIRO read.'
};
const VIEW_HINT = {
  list: 'Everyone you track. Open one to see their website, their ads and ideas against them.',
  ads: 'Every ad of every competitor in one place. Filter, then open an ad to see the AI reading and public signals.',
  overview: 'The whole market at a glance: who advertises, where, and which topics, offers and buttons are common.',
  gaps: 'What competitors are not doing, and an AI strategy to stand apart. Observations, not predictions.',
  ideas: 'Ready Meta and Google ads, plus the moves AIRO thinks are right, written against all your competitors at once.'
};

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

function ProjectChips({ ids, projects }) {
  const names = (ids || []).map((id) => projects.find((row) => row.id === id)?.name).filter(Boolean);
  if (!names.length) return null;
  return <div className="comp-chips">{names.map((name) => <span key={name} className="channel-pill">{name}</span>)}</div>;
}

function CompetitorForm({ item, projects, scope, onDone, onCancel }) {
  const [form, setForm] = useState(() => ({
    ...(item ? Object.fromEntries(Object.keys(EMPTY).map((key) => [key, item[key] || EMPTY[key]])) : EMPTY),
    offeringIds: item ? item.offeringIds || [] : scope ? [scope] : []
  }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggle = (id) => setForm((current) => ({
    ...current,
    offeringIds: current.offeringIds.includes(id) ? current.offeringIds.filter((value) => value !== id) : [...current.offeringIds, id]
  }));
  const choices = projects.filter((row) => row.status !== 'archived' || form.offeringIds.includes(row.id));

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
      <label className="stack-field">TYPE
        <select value={form.competitorType} onChange={set('competitorType')}>
          <option value="">Not set</option>
          <option value="direct">Direct (same thing, same buyers)</option>
          <option value="indirect">Indirect (different thing, same need)</option>
          <option value="market">Market (portal or big player in your market)</option>
          <option value="emerging">Emerging (new or growing fast)</option>
        </select>
      </label>
      {item ? (
        <label className="stack-field">STATUS
          <select value={form.status} onChange={set('status')}>
            <option value="active">Active (tracked)</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      ) : null}
      <label className="stack-field comp-notes">WHAT YOU KNOW ABOUT THEM<textarea value={form.notes} onChange={set('notes')} maxLength={1000} placeholder="Optional. For example: they run discount ads every month, their sales team calls fast." /></label>
      {choices.length ? (
        <fieldset className="stack-field comp-notes comp-projects">
          <legend>WHICH OF YOUR PRODUCTS OR PROJECTS DO THEY COMPETE WITH?</legend>
          <div className="comp-project-picks">
            {choices.map((row) => (
              <label key={row.id} className="check-row">
                <input type="checkbox" checked={form.offeringIds.includes(row.id)} onChange={() => toggle(row.id)} />
                <span><strong>{row.name}</strong>{row.locations || row.priceText ? <small>{[row.locations, row.priceText].filter(Boolean).join(' · ')}</small> : null}</span>
              </label>
            ))}
          </div>
          <small className="quiet">Leave all empty if they compete with your whole business. AIRO compares them only with the ones you tick.</small>
        </fieldset>
      ) : null}
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

const PLATFORM_LABEL = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads' };
const AD_PREVIEW = 6;

function money(value, currency) {
  if (value == null) return '—';
  if (!currency || currency === 'INR') return inr(value);
  return `${currency} ${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function days(value) {
  if (value == null) return '';
  return value === 1 ? '1 day' : `${num(value)} days`;
}

function AdStats({ stats, versions }) {
  return (
    <div className="rival-stats">
      <div><span>Live now</span><strong>{num(stats.live)}</strong></div>
      <div><span>Running 30+ days</span><strong>{num(stats.longRunning)}</strong></div>
      <div><span>New this week</span><strong>{num(stats.newThisWeek)}</strong></div>
      <div><span>Average age</span><strong>{stats.averageDays == null ? '—' : days(stats.averageDays)}</strong></div>
      {versions ? <div><span>With several versions</span><strong>{num(stats.withVersions)}</strong></div> : null}
    </div>
  );
}

function AdCard({ ad, google }) {
  const [broken, setBroken] = useState(false);
  return (
    <article className="rival-card">
      {ad.image && !broken ? <img src={ad.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <div className="rival-noimage">{ad.format || 'ad'}</div>}
      <div className="rival-body">
        <div className="comp-chips">
          {ad.active ? <span className={`badge ${ad.days >= 30 ? 'good' : 'info'}`}>{google ? 'Shown for' : 'Running'} {days(ad.days) || '—'}</span> : <span className="badge">Stopped</span>}
          {ad.format ? <span className="channel-pill">{ad.format}</span> : null}
          {ad.versions > 1 ? <span className="channel-pill">{ad.versions} versions</span> : null}
        </div>
        {ad.title ? <strong>{ad.title}</strong> : null}
        {ad.text ? <p>{ad.text}</p> : null}
        {google && !ad.text ? <p className="quiet">{ad.advertiser}{ad.lastShown ? ` · last shown ${when(ad.lastShown)}` : ''}</p> : null}
        <small className="quiet">
          {[ad.cta, ad.link ? host(ad.link) : '', (ad.platforms || []).map((name) => PLATFORM_LABEL[name] || name).join(', ')].filter(Boolean).join(' · ')}
        </small>
        {ad.url ? <a className="comp-source" href={ad.url} target="_blank" rel="noreferrer">{google ? 'View on Google Ads Transparency' : 'View in Meta Ad Library'}</a> : null}
      </div>
    </article>
  );
}

function AdColumn({ title, data, google }) {
  const [all, setAll] = useState(false);
  if (!data) return <div className="rival-column"><h3>{title}</h3><p className="quiet">Could not be read this time.</p></div>;
  const ads = all ? data.ads : data.ads.slice(0, AD_PREVIEW);
  const chips = [...(data.stats.platforms || []).map((row) => `${PLATFORM_LABEL[row.key] || row.key} ${row.total}`), ...(data.stats.formats || []).map((row) => `${row.key} ${row.total}`)];
  return (
    <div className="rival-column">
      <h3>{title}</h3>
      {google && data.advertisers?.length ? <p className="quiet">Advertiser: {data.advertisers.join(', ')}</p> : null}
      {!google && data.page ? <p className="quiet">Page: {data.page}</p> : null}
      {data.stats.total ? (
        <>
          <AdStats stats={data.stats} versions={!google} />
          {chips.length ? <div className="comp-chips">{chips.map((text) => <span key={text} className="channel-pill">{text}</span>)}</div> : null}
          {data.stats.ctas?.length ? <p className="quiet">Buttons used: {data.stats.ctas.map((row) => `${row.key} (${row.total})`).join(', ')}</p> : null}
          {data.stats.landing?.length ? <p className="quiet">Ads send people to: {data.stats.landing.map((row) => row.key).join(', ')}</p> : null}
          <div className="rival-grid">{ads.map((ad) => <AdCard key={ad.id} ad={ad} google={google} />)}</div>
          {data.ads.length > AD_PREVIEW ? <button className="btn" type="button" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${data.ads.length}`}</button> : null}
        </>
      ) : <p className="quiet">{google ? 'No Google ads found in India in the last 90 days.' : 'No active Meta ads found.'}</p>}
    </div>
  );
}

function Versus({ ours, check }) {
  const rows = [['meta', 'Meta', check?.meta], ['google', 'Google', check?.google]];
  return (
    <div className="comp-block">
      <h3>You vs them</h3>
      <div className="table-wrap">
        <table className="responsive">
          <thead><tr><th>Platform</th><th>Your campaigns (30 days)</th><th>Your spend</th><th>Your leads</th><th>Your cost per lead</th><th>Their live ads</th><th>Theirs running 30+ days</th></tr></thead>
          <tbody>
            {rows.map(([key, name, theirs]) => {
              const mine = ours.filter((row) => row.platform === key);
              const row = mine[0];
              return (
                <tr key={key}>
                  <td data-label="Platform">{name}</td>
                  <td data-label="Your campaigns (30 days)">{row ? num(mine.reduce((sum, item) => sum + item.campaigns, 0)) : 'No data'}</td>
                  <td data-label="Your spend">{mine.length ? mine.map((item) => money(item.spend, item.currency)).join(' + ') : '—'}</td>
                  <td data-label="Your leads">{row ? num(mine.reduce((sum, item) => sum + item.leads, 0)) : '—'}</td>
                  <td data-label="Your cost per lead">{mine.length === 1 && row.cpl != null ? money(row.cpl, row.currency) : '—'}</td>
                  <td data-label="Their live ads">{theirs ? num(theirs.stats.live) : '—'}</td>
                  <td data-label="Theirs running 30+ days">{theirs ? num(theirs.stats.longRunning) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="quiet comp-note">Your numbers come from your connected ad accounts. Meta and Google do not make another business's spend, clicks or leads public, so for them AIRO shows what is public: how many ads are live and how long each has run. An ad that keeps running for a month or more is usually one that works for them.</p>
    </div>
  );
}

function AdsPanel({ id, canManage }) {
  const { data, error, reload } = useResource(`/api/competitors/${id}/watch`);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const running = Boolean(data?.running);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => reload({ silent: true }), 5000);
    return () => clearInterval(timer);
  }, [running, reload]);

  async function check() {
    setBusy(true);
    setMessage('');
    try {
      await api.post(`/api/competitors/${id}/watch/check`, {});
      reload({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="quiet">Their ads could not be loaded: {error}</p>;
  if (!data) return null;
  const latest = data.check;
  return (
    <section className="rival-panel">
      <header className="comp-head">
        <div>
          <h3>Their ads on Meta and Google</h3>
          <p className="quiet">
            From the public Meta Ad Library and Google Ads Transparency Center.
            {latest?.finishedAt && latest.status === 'ready' ? ` Checked ${when(latest.finishedAt)}.` : ''}
          </p>
        </div>
        {canManage ? (
          <button className="btn-primary" type="button" onClick={check} disabled={busy || running || !data.ready}>
            {running ? 'Checking...' : latest ? 'Check again' : 'Check ads'}
          </button>
        ) : null}
      </header>
      {!data.ready ? <p className="quiet">Ad checks are not turned on yet. The AIRO team connects Apify on the platform.</p> : null}
      {message ? <p className="quiet">{message}</p> : null}
      {running ? (
        <div className="comp-running">
          <span className="comp-spinner" aria-hidden="true" />
          <div>
            <strong>Reading their Meta and Google ads...</strong>
            <p className="quiet">This takes one to three minutes. You can leave this page; the result is saved.</p>
          </div>
        </div>
      ) : null}
      {!running && latest?.status === 'failed' ? (
        <div className="comp-failed">
          <strong>The last ad check did not finish.</strong>
          <ul className="comp-list">{(latest.notes || []).map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      ) : null}
      {!running && !latest && data.ready ? <p className="quiet">Not checked yet. Press Check ads to see what they are running. Each check uses a little Apify credit.</p> : null}
      {latest?.status === 'ready' ? (
        <>
          <div className="comp-two">
            <AdColumn title="Meta (Facebook and Instagram)" data={latest.meta} />
            <AdColumn title="Google (Search, YouTube, Display)" data={latest.google} google />
          </div>
          {latest.notes?.length ? <p className="quiet comp-note">{latest.notes.join(' ')}</p> : null}
        </>
      ) : null}
      <Versus ours={data.ours || []} check={latest?.status === 'ready' ? latest : null} />
    </section>
  );
}

const FIT = { direct: ['bad', 'Direct competitor'], indirect: ['warn', 'Indirect'], unclear: ['', 'Check yourself'] };
const SOURCE = { google_ad: 'Google ad', google_search: 'Google search', meta_ad: 'Meta ads', maps: 'Google Maps', discovery: 'AIRO search' };

function Suggestions({ canManage, project, onAdded }) {
  const scope = project?.id || 0;
  const { data, loading, error, reload } = useResource(`/api/competitors/suggestions${scope ? `?offeringId=${scope}` : ''}`);
  const [busy, setBusy] = useState(0);
  const [message, setMessage] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const running = Boolean(data?.running);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => reload({ silent: true }), 5000);
    return () => clearInterval(timer);
  }, [running, reload]);

  async function act(path, id = -1, payload = {}) {
    setBusy(id);
    setMessage('');
    try {
      const result = await api.post(path, payload);
      if (result.competitorId) {
        const start = result.linked ? `Linked to ${project?.name || 'this project'}.` : 'Added to your competitors.';
        const next = result.analysing
          ? ' AIRO is reading their website and comparing it with this project now.'
          : result.findingWebsite ? ' AIRO is looking for their website on Google. If it finds one, the report starts by itself in about a minute.' : '';
        setMessage(`${start}${next}`);
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
          <h2>{project ? `Suggested for ${project.name}` : 'Suggested by AIRO'}</h2>
          <p className="quiet">
            {project
              ? `AIRO searches Google, Meta ads and Google Maps for what competes with ${project.name}: the same kind of thing${project.locations ? ` in ${project.locations}` : ''}${project.priceText ? ` around ${project.priceText}` : ''}. It removes portals and directories, reads each website and asks AI whether they really compete with this project. Every week, and whenever you press Find competitors.`
              : 'AIRO searches Google, Meta ads and Google Maps for what you sell, removes portals and directories, reads each website and asks AI whether they really compete with you. Every week, and whenever you press Find competitors.'}
          </p>
        </div>
        {canManage && data.apify ? (
          <button className="btn-primary" type="button" onClick={() => act('/api/competitors/discover', -1, { offeringId: scope })} disabled={running || busy !== 0}>
            {running ? 'Searching...' : project ? 'Find competitors for this project' : 'Find competitors'}
          </button>
        ) : null}
      </header>
      {!data.apify ? (
        <div className="comp-failed">
          <strong>Competitor search is not turned on yet.</strong>
          <span>The AIRO team turns it on for everyone. Until then, add competitors yourself with Add competitor.</span>
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
      {!running && run?.plan?.by === 'rules' ? (
        <div className="comp-failed">
          <strong>No AI model was connected for this search.</strong>
          <span>AIRO used only the project type and city, and could not check whether each business really competes with you, so some results may be unrelated. A platform admin can connect a model for Competitor research in Platform AI, then search again.</span>
        </div>
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
                {row.trackedId ? <p className="quiet">Already in your competitors, not yet linked to this project.</p> : null}
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
                    {row.status === 'new' ? <button className="btn-primary" type="button" disabled={busy !== 0} onClick={() => act(`/api/competitors/suggestions/${row.id}/add`, row.id)}>{busy === row.id ? 'Adding...' : row.trackedId ? 'Link to this project' : 'Add'}</button> : null}
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

function Detail({ id, canManage, projects, onChanged, onEdit }) {
  const { data, loading, error, reload } = useResource(`/api/competitors/${id}`);
  const [tab, setTab] = useState('summary');
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

  async function findWebsite() {
    setBusy(true);
    setMessage('Looking for their website on Google. This takes up to a minute...');
    try {
      const result = await api.post(`/api/competitors/${id}/find-website`, {});
      setMessage(`Found ${host(result.website)}.${result.analysing ? ' AIRO is reading it now.' : ''}`);
      reload({ silent: true });
      onChanged();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setMessage('');
    try {
      await api.post(`/api/competitors/${id}/verify`, { verified: !data.verifiedAt });
      reload({ silent: true });
      onChanged();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

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

  const report = data?.report?.status === 'ready' && data.report.analysis ? data.report : null;
  const websiteStatus = data ? <WebsiteStatus data={data} running={running} canManage={canManage} busy={busy} onFind={findWebsite} /> : null;

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
              {data.offeringIds?.length ? <ProjectChips ids={data.offeringIds} projects={projects} /> : <p className="quiet">Competes with your whole business.</p>}
              {data.source && data.source !== 'manual' ? (
                <p className="quiet comp-note">
                  Found by AIRO ({data.source.split(',').map((key) => SOURCE[key] || key).join(', ')}){data.confidence ? `, match confidence ${data.confidence}%` : ''}.{data.reason ? ` ${data.reason}` : ''}
                </p>
              ) : null}
            </div>
            <div className="page-actions">
              <TypeBadge value={data.competitorType} />
              {data.verifiedAt ? <span className="badge good">Verified</span> : null}
              <ThreatBadge value={data.report?.status === 'ready' ? data.report.analysis?.threat : null} />
              {canManage ? <button className="btn" type="button" onClick={verify} disabled={busy}>{data.verifiedAt ? 'Unverify' : 'Verify'}</button> : null}
              {data.website ? <a className="btn" href={data.website} target="_blank" rel="noreferrer">Open website</a> : null}
              {canManage ? <button className="btn" type="button" onClick={() => onEdit(data)}>Edit</button> : null}
              {canManage ? (
                <button className="btn-primary" type="button" onClick={analyze} disabled={busy || running || !data.website}>
                  {running ? 'Reading website...' : data.report ? 'Analyse website again' : 'Analyse website'}
                </button>
              ) : null}
            </div>
          </header>
          {message ? <p className="quiet">{message}</p> : null}
          <div className="chip-tabs comp-tabs" role="tablist">
            {TABS.map(([key, text]) => <button key={key} type="button" className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>{text}</button>)}
          </div>
          <p className="quiet comp-note">{TAB_HINT[tab]}</p>
          {tab === 'summary' ? (
            <div className="stack">
              <AdSnapshot id={data.id} onOpenAds={() => setTab('ads')} onOpenInsights={() => setTab('say')} />
              {report ? <Overview analysis={report.analysis} /> : websiteStatus}
            </div>
          ) : null}
          {tab === 'website' ? (report ? <Offers analysis={report.analysis} website={report.website} /> : websiteStatus) : null}
          {tab === 'compare' ? (report ? <Compare analysis={report.analysis} /> : websiteStatus) : null}
          {tab === 'ads' ? <AdsPanel key={data.id} id={data.id} canManage={canManage} /> : null}
          {tab === 'say' ? <AdInsights id={data.id} onOpenAds={() => setTab('ads')} /> : null}
          {tab === 'strategy' ? <CompetitorStrategy id={data.id} canManage={canManage} onOpenAds={() => setTab('ads')} /> : null}
          {tab === 'ideas' ? <AdIdeas key={data.id} competitorId={data.id} canManage={canManage} /> : null}
          {tab === 'more' ? (report ? (
            <div className="stack">
              <h3>Search demand</h3>
              <Keywords keywords={report.keywords} notes={report.notes || []} />
              <h3>Pages AIRO read</h3>
              <Sources report={report} />
            </div>
          ) : websiteStatus) : null}
          {report?.notes?.length && ['summary', 'website', 'compare'].includes(tab) ? <p className="quiet comp-note">{report.notes.join(' ')}</p> : null}
        </section>
      ) : null}
    </State>
  );
}

function WebsiteStatus({ data, running, canManage, busy, onFind }) {
  return (
    <>
          {!data.website ? (
            <div className="comp-failed">
              <strong>No website yet.</strong>
              <span>AIRO needs their website to make a report. It can look for it on Google by their name{data.city ? ` and ${data.city}` : ''}, or you can add it with Edit.</span>
              {canManage ? <div><button className="btn-primary" type="button" onClick={onFind} disabled={busy}>{busy ? 'Looking...' : 'Find website'}</button></div> : null}
            </div>
          ) : null}
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
          {!running && !data.report && data.website ? (
            <div className="offer-empty">
              <strong>Their website is not read yet</strong>
              <p className="quiet">Press Analyse website at the top. AIRO reads their public pages, finds what they sell, prices and offers, and compares them with yours.</p>
            </div>
          ) : null}
    </>
  );
}

export function Competitors() {
  const { can } = useAuth();
  const canManage = can('campaigns.update');
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { data, loading, error, reload } = useResource('/api/competitors');
  const { data: catalog, reload: reloadCatalog } = useResource('/api/offerings');
  const [editing, setEditing] = useState(null);
  const [note, setNote] = useState('');
  const [version, setVersion] = useState(0);
  const projects = catalog?.items || [];
  const activeProjects = projects.filter((row) => row.status !== 'archived');
  const scope = Number(params.get('project')) || 0;
  const view = VIEWS.some(([key]) => key === params.get('view')) ? params.get('view') : 'list';
  const show = (value) => {
    const next = new URLSearchParams(params);
    if (value === 'list') next.delete('view');
    else next.set('view', value);
    setParams(next, { replace: true });
  };
  const project = scope ? projects.find((row) => row.id === scope) || null : null;
  const all = data?.items || [];
  const items = project ? all.filter((row) => row.offeringIds?.includes(project.id)) : all;
  const selected = id ? Number(id) : null;
  const query = project ? `?project=${project.id}` : '';
  const choose = (value) => {
    const next = new URLSearchParams(params);
    if (value) next.set('project', String(value));
    else next.delete('project');
    setParams(next, { replace: true });
  };
  const analysed = items.filter((row) => row.summary).length;
  const high = items.filter((row) => row.threat === 'high').length;
  const refresh = () => {
    reload({ silent: true });
    reloadCatalog({ silent: true });
  };

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
      if (selected === item.id) navigate(`/app/growth/competitors${query}`);
      refresh();
    } catch (err) {
      setNote(err.message);
    }
  }

  function done(saved) {
    setEditing(null);
    setVersion((value) => value + 1);
    refresh();
    if (saved?.id) navigate(`/app/growth/competitors/${saved.id}${saved.offeringIds?.includes(scope) ? query : ''}`);
  }

  const open = (competitorId) => navigate(`/app/growth/competitors/${competitorId}${query}`);

  return (
    <Page
      eyebrow="Growth"
      title="Competitors"
      lede="Know who you compete with, what they sell, what their ads say, and how to stand apart. Follow the four steps below. On WhatsApp, send: competitors."
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
            <StepGuide onGo={show} />
            <div className="chip-tabs intel-views" role="tablist" aria-label="Competitor views">
              {VIEWS.map(([key, text]) => <button key={key} type="button" className={view === key ? 'is-on' : ''} onClick={() => show(key)}>{text}</button>)}
            </div>
            <p className="quiet comp-note">{VIEW_HINT[view]}</p>
            {view === 'overview' ? <IntelOverview canManage={canManage} onOpenCompetitor={(competitorId) => navigate(`/app/growth/competitors/${competitorId}`)} /> : null}
            {view === 'ads' ? <AdLibrary competitors={all.filter((row) => row.status === 'active')} /> : null}
            {view === 'gaps' ? <MarketGaps canManage={canManage} /> : null}
            {view === 'ideas' ? <AdIdeas canManage={canManage} /> : null}
            {view !== 'list' ? null : (<>
            {activeProjects.length || project ? (
              <div className="chip-tabs comp-scope" role="tablist" aria-label="Competitors for">
                <button type="button" className={!project ? 'is-on' : ''} onClick={() => choose(0)}>Whole business</button>
                {(project && project.status === 'archived' ? [...activeProjects, project] : activeProjects).map((row) => (
                  <button key={row.id} type="button" className={project?.id === row.id ? 'is-on' : ''} onClick={() => choose(row.id)}>
                    {row.name}{row.competitorCount ? ` (${row.competitorCount})` : ''}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="metric-strip offer-metrics">
              <div className="metric"><span>Tracked</span><strong>{num(items.filter((row) => row.status === 'active').length)}</strong><em>{project ? `For ${project.name}` : `${num(items.length)} saved`}</em></div>
              <div className="metric"><span>Website read</span><strong>{num(analysed)}</strong><em>Have a website report</em></div>
              <div className="metric"><span>High threat</span><strong>{num(high)}</strong><em>Same market, similar or better deal</em></div>
            </div>
            {editing !== null ? <CompetitorForm key={editing?.id || `new-${scope}`} item={editing || null} projects={projects} scope={scope} onDone={done} onCancel={() => setEditing(null)} /> : null}
            {note ? <p className="quiet">{note}</p> : null}
            {items.length ? (
              <div className="comp-layout">
                <div className="comp-cards">
                  {items.map((item) => (
                    <article
                      key={item.id}
                      className={`comp-card${selected === item.id ? ' is-on' : ''}${item.status === 'archived' ? ' is-archived' : ''}`}
                      onClick={() => open(item.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter') open(item.id); }}
                      tabIndex={0}
                    >
                      <header>
                        <strong>{item.name}</strong>
                        <span className="comp-chips"><TypeBadge value={item.competitorType} /><ThreatBadge value={item.threat} /></span>
                      </header>
                      <p className="quiet">{[item.city, item.website ? host(item.website) : 'No website', item.status === 'archived' ? 'archived' : ''].filter(Boolean).join(' · ')}</p>
                      {!project ? <ProjectChips ids={item.offeringIds} projects={projects} /> : null}
                      {item.summary ? <p className="comp-card-summary">{item.summary}</p> : null}
                      <footer>
                        <small>{item.running ? 'Reading website...' : item.lastAnalyzedAt ? `Website read ${when(item.lastAnalyzedAt)}` : 'Website not read yet'}</small>
                        {canManage ? <button type="button" className="comp-remove" onClick={(event) => { event.stopPropagation(); remove(item); }}>Remove</button> : null}
                      </footer>
                    </article>
                  ))}
                </div>
                <div>
                  {selected ? (
                    <Detail key={`${selected}-${version}`} id={selected} canManage={canManage} projects={projects} onChanged={refresh} onEdit={(row) => { setEditing(row); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
                  ) : (
                    <div className="offer-empty"><strong>Pick a competitor</strong><p className="quiet">Open one to see a summary, their website, their ads, and ideas to stand apart.</p></div>
                  )}
                </div>
              </div>
            ) : (
              <div className="offer-empty">
                <strong>{project ? `No competitors linked to ${project.name} yet` : 'No competitors yet'}</strong>
                <p className="quiet">
                  {project
                    ? 'Add one from the suggestions below, or add a competitor and tick this project.'
                    : 'Add a competitor with their website. AIRO reads it and compares it with your products and projects. No paid tool is needed.'}
                </p>
                {canManage && editing === null ? <button className="btn-primary" type="button" onClick={() => setEditing(false)}>Add competitor</button> : null}
              </div>
            )}
            <Suggestions key={scope} canManage={canManage} project={project} onAdded={(competitorId) => {
              refresh();
              open(competitorId);
              setTimeout(() => document.querySelector('.comp-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600);
            }} />
            </>)}
          </div>
        )}
      </State>
    </Page>
  );
}
