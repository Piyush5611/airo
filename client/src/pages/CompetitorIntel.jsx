import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useResource } from '../data.js';
import { num, when } from '../format.js';
import { MetricStrip, State } from '../ui.jsx';

export const TYPE = { direct: ['bad', 'Direct'], indirect: ['warn', 'Indirect'], market: ['info', 'Market'], emerging: ['info', 'Emerging'] };
const CONFIDENCE = { high: ['good', 'High confidence'], medium: ['warn', 'Medium confidence'], low: ['', 'Low confidence'] };
const PLATFORM = { meta: 'Meta', google: 'Google' };
const CHANGE = { new: 'First seen', changed: 'Copy changed', stopped: 'Stopped', restarted: 'Running again' };
const NOT_AVAILABLE = 'NOT_AVAILABLE';

const OPTIONS = {
  platform: [['meta', 'Meta'], ['google', 'Google']],
  format: [['static', 'Static'], ['video', 'Video'], ['carousel', 'Carousel'], ['reel', 'Reel'], ['text', 'Text'], ['other', 'Other']],
  status: [['active', 'Active'], ['inactive', 'Stopped']],
  cta: [['learn_more', 'Learn more'], ['contact_us', 'Contact us'], ['whatsapp', 'WhatsApp'], ['book_now', 'Book now'], ['book_visit', 'Book visit'], ['enquire_now', 'Enquire now'], ['call_now', 'Call now'], ['buy_now', 'Buy now'], ['sign_up', 'Sign up'], ['download', 'Download'], ['other', 'Other']],
  offer: [['discount', 'Discount'], ['price', 'Price'], ['emi', 'EMI'], ['free_trial', 'Free trial'], ['consultation', 'Consultation'], ['site_visit', 'Site visit'], ['limited_time', 'Limited-time'], ['bundle', 'Bundle'], ['guarantee', 'Guarantee'], ['none', 'No offer']],
  theme: [['price', 'Price'], ['offer', 'Offer'], ['location', 'Location'], ['quality', 'Quality'], ['features', 'Features'], ['trust', 'Trust'], ['testimonial', 'Testimonial'], ['social_proof', 'Social proof'], ['convenience', 'Convenience'], ['urgency', 'Urgency'], ['payment_plan', 'Payment plan'], ['brand', 'Brand'], ['lifestyle', 'Lifestyle'], ['investment', 'Investment'], ['service', 'Service']],
  style: [['product', 'Product-focused'], ['lifestyle', 'Lifestyle'], ['ugc', 'UGC'], ['testimonial', 'Testimonial'], ['educational', 'Educational'], ['founder_led', 'Founder-led'], ['offer', 'Offer'], ['before_after', 'Before/After'], ['social_proof', 'Social proof'], ['announcement', 'Announcement'], ['comparison', 'Comparison']],
  confidence: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']],
  competitorType: [['direct', 'Direct'], ['indirect', 'Indirect'], ['market', 'Market'], ['emerging', 'Emerging']]
};
const FILTER_LABEL = { competitorId: 'Competitor', platform: 'Platform', format: 'Format', status: 'Status', cta: 'Button', offer: 'Offer', theme: 'Theme', style: 'Creative style', confidence: 'Confidence', competitorType: 'Type' };
const optionLabel = (field, key) => (OPTIONS[field] || []).find(([value]) => value === key)?.[1] || String(key || '').replace(/_/g, ' ');

export function TypeBadge({ value }) {
  if (!value || !TYPE[value]) return null;
  const [tone, text] = TYPE[value];
  return <span className={`badge ${tone}`}>{text}</span>;
}

function ConfidenceBadge({ value }) {
  const [tone, text] = CONFIDENCE[value] || CONFIDENCE.low;
  return <span className={`badge ${tone}`}>{text}</span>;
}

function ShareBars({ title, rows, empty = 'Nothing observed yet.' }) {
  return (
    <div className="comp-block intel-bars">
      <h3>{title}</h3>
      {rows?.length ? rows.slice(0, 6).map((row) => (
        <div className="intel-bar" key={row.key}>
          <span>{row.label}</span>
          <div><i style={{ width: `${Math.max(3, row.share)}%` }} /></div>
          <strong>{row.share}%</strong>
        </div>
      )) : <p className="quiet">{empty}</p>}
    </div>
  );
}

function usePoll(active, reload, ms = 6000) {
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => reload({ silent: true }), ms);
    return () => clearInterval(timer);
  }, [active, reload, ms]);
}

function Strategy({ path, insight, canManage, onDone, empty }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const data = insight?.payload;

  async function generate() {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post(path, {});
      setMessage(result.reused ? 'Nothing changed since the last strategy, so the saved one is shown.' : '');
      onDone();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="comp-block intel-strategy">
      <header className="comp-head">
        <div>
          <h3>How to stand apart</h3>
          <p className="quiet">
            AI reads the observed ads and your business profile. It suggests what to do differently; it never copies their wording, creatives, trademarks or claims.
            {insight?.createdAt ? ` Made ${when(insight.createdAt)}${insight.model ? ` by ${insight.model}` : ''}.` : ''}
          </p>
        </div>
        {canManage ? <button className="btn-primary" type="button" onClick={generate} disabled={busy}>{busy ? 'Thinking...' : data ? 'Update strategy' : 'Make strategy'}</button> : null}
      </header>
      {message ? <p className="quiet">{message}</p> : null}
      {insight && insight.current === false ? <p className="quiet comp-note">New ads were seen after this strategy was made. Press Update strategy to refresh it.</p> : null}
      {data ? (
        <div className="stack">
          <div className="comp-chips"><ConfidenceBadge value={data.confidence} /></div>
          <div className="comp-facts">
            <div><span>What they advertise</span><strong>{data.advertising}</strong></div>
            {data.positioning ? <div><span>Their positioning (observed)</span><strong>{data.positioning}</strong></div> : null}
            {data.changes ? <div><span>What changed</span><strong>{data.changes}</strong></div> : null}
          </div>
          <div className="comp-two">
            <Bullets title="Their main offers" items={data.mainOffers} />
            <Bullets title="Their main messages" items={data.mainMessages} />
          </div>
          <div className="comp-two">
            <Bullets title="Whitespace for you" items={data.whitespace} />
            <Bullets title="Hooks you can try" items={data.hooks} />
          </div>
          <div className="comp-two">
            <Bullets title="Offers you can test" items={data.offers} />
            <Bullets title="Formats you can test" items={data.formats} />
          </div>
          <Bullets title="Positioning ideas" items={data.positioningIdeas} />
        </div>
      ) : <p className="quiet">{empty}</p>}
    </div>
  );
}

function Bullets({ title, items }) {
  if (!items?.length) return null;
  return (
    <div className="comp-block">
      <h3>{title}</h3>
      <ul className="comp-list">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    </div>
  );
}

function AnalysisChips({ analysis }) {
  if (!analysis) return <span className="badge">Not analysed yet</span>;
  if (!analysis.copyAvailable) return <span className="badge">No ad text to analyse</span>;
  return (
    <div className="comp-chips">
      {(analysis.styles || []).map((key) => <span key={`s-${key}`} className="channel-pill">{optionLabel('style', key)}</span>)}
      {(analysis.themes || []).slice(0, 3).map((key) => <span key={`t-${key}`} className="channel-pill">{optionLabel('theme', key)}</span>)}
      {(analysis.offers || []).filter((key) => key !== 'none').map((key) => <span key={`o-${key}`} className="badge info">{optionLabel('offer', key)}</span>)}
    </div>
  );
}

function AdTile({ ad, onOpen }) {
  const [broken, setBroken] = useState(false);
  return (
    <article className="rival-card rival-tile" onClick={() => onOpen(ad.id)} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(ad.id); }} tabIndex={0}>
      {ad.imageUrl && !broken ? <img src={ad.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : <div className="rival-noimage">{ad.format || 'ad'}</div>}
      <div className="rival-body">
        <div className="comp-chips">
          <span className="channel-pill">{PLATFORM[ad.platform] || ad.platform}</span>
          {ad.status === 'active' ? <span className="badge good">Active</span> : <span className="badge">Stopped</span>}
          {ad.format ? <span className="channel-pill">{ad.format}</span> : null}
        </div>
        <small className="quiet">{ad.competitor}{ad.firstShown ? ` · since ${ad.firstShown}` : ''}</small>
        {ad.headline ? <strong>{ad.headline}</strong> : null}
        {ad.body ? <p>{ad.body}</p> : null}
        {ad.analysis?.hook ? <small><b>Hook:</b> {ad.analysis.hook}</small> : null}
        <AnalysisChips analysis={ad.analysis} />
      </div>
    </article>
  );
}

const PLACEMENT = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', audience_network: 'Audience Network', threads: 'Threads' };

function PublicSignals({ signals }) {
  const running = signals.days == null ? '—' : `${num(signals.days)} ${signals.days === 1 ? 'day' : 'days'}`;
  return (
    <div className="comp-block">
      <h3>Public signals</h3>
      <div className="rival-stats">
        <div><span>Status</span><strong>{signals.status === 'active' ? 'Running' : 'Stopped'}</strong></div>
        <div><span>{signals.status === 'active' ? 'Running for' : 'Ran for'}</span><strong>{running}</strong></div>
        <div><span>Versions</span><strong>{num(signals.versions)}</strong></div>
        <div><span>Same copy in</span><strong>{`${num(signals.sameCopyAds)} ${signals.sameCopyAds === 1 ? 'ad' : 'ads'}`}</strong></div>
      </div>
      <div className="comp-facts">
        <div><span>First shown</span><strong>{signals.firstShown || 'Not given by the source'}</strong></div>
        <div><span>Last shown</span><strong>{signals.status === 'active' ? 'Still running' : signals.lastShown || 'Not given by the source'}</strong></div>
        <div><span>Shown on</span><strong>{signals.placements.length ? signals.placements.map((key) => PLACEMENT[key] || key).join(', ') : 'Not given by the source'}</strong></div>
        <div><span>Sends people to</span><strong>{signals.landing || 'Not given by the source'}</strong></div>
        {signals.cta ? <div><span>Button</span><strong>{signals.cta}</strong></div> : null}
      </div>
      <p className="quiet comp-note">
        {signals.longRunning
          ? 'This ad has run for 30 days or more. Businesses usually keep paying only for ads that bring them results, so this is likely one that works for them.'
          : 'An ad that keeps running for 30 days or more is usually one that works for its owner.'}
        {signals.sameCopyAds > 1 ? ` The same text runs in ${num(signals.sameCopyAds)} ads (${num(signals.sameCopyActive)} live), often a sign they are scaling it.` : ''}
      </p>
    </div>
  );
}

export function AdDetail({ id, onClose }) {
  const { data, loading, error, reload } = useResource(`/api/competitors/creatives/${id}`);
  const analysis = data?.analysis;
  const field = (value) => (value && value !== NOT_AVAILABLE ? value : 'Not shown in the ad');
  return (
    <section className="panel intel-detail">
      <header className="comp-head">
        <div>
          <h2>{data ? `${data.competitor} · ${PLATFORM[data.platform] || data.platform} ad` : 'Ad'}</h2>
          {data ? <p className="quiet">{[data.advertiser, data.format, data.firstShown ? `first shown ${data.firstShown}` : '', data.lastShown ? `last shown ${data.lastShown}` : '', `seen by AIRO ${when(data.firstObservedAt)}`].filter(Boolean).join(' · ')}</p> : null}
        </div>
        <div className="page-actions">
          {data?.sourceUrl ? <a className="btn" href={data.sourceUrl} target="_blank" rel="noreferrer">{data.platform === 'google' ? 'Open in Google Transparency' : 'Open in Meta Ad Library'}</a> : null}
          <button className="btn" type="button" onClick={onClose}>Close</button>
        </div>
      </header>
      <State loading={loading} error={error} onRetry={reload}>
        {data ? (
          <div className="stack">
            <div className="comp-two">
              <div className="comp-block">
                <h3>The ad</h3>
                {data.imageUrl ? <img className="intel-image" src={data.imageUrl} alt="" referrerPolicy="no-referrer" /> : null}
                {data.headline ? <p><strong>{data.headline}</strong></p> : null}
                {data.body ? <p className="intel-copy">{data.body}</p> : <p className="quiet">The public source gave no ad text.</p>}
                <p className="quiet">{[data.cta ? `Button: ${data.cta}` : '', data.link ? `Goes to: ${data.link}` : '', (data.placements || []).length ? `Shown on: ${data.placements.join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="comp-block">
                <h3>AI reading of the copy</h3>
                {!analysis ? <p className="quiet">Not analysed yet. AIRO analyses new ads every hour, or press Analyse ads now on the Overview tab.</p> : !analysis.copyAvailable ? (
                  <p className="quiet">This ad has no readable text in the public source, so only its format is known. AIRO cannot see images or videos.</p>
                ) : (
                  <div className="stack">
                    <div className="comp-chips"><ConfidenceBadge value={analysis.confidence} /></div>
                    <div className="comp-facts">
                      <div><span>Hook</span><strong>{field(analysis.hook)}</strong></div>
                      <div><span>Main message</span><strong>{field(analysis.message)}</strong></div>
                      <div><span>Value proposition</span><strong>{field(analysis.valueProp)}</strong></div>
                      <div><span>Pain point</span><strong>{field(analysis.painPoint)}</strong></div>
                      <div><span>Benefit</span><strong>{field(analysis.benefit)}</strong></div>
                      <div><span>USP</span><strong>{field(analysis.usp)}</strong></div>
                      <div><span>Offer</span><strong>{field(analysis.offerText)}</strong></div>
                      <div><span>Trust signal</span><strong>{field(analysis.trustSignal)}</strong></div>
                      <div><span>Tone · intent</span><strong>{[optionLabel('tone', analysis.tone), analysis.intent].filter((value) => value && value !== NOT_AVAILABLE).join(' · ') || 'Not clear'}</strong></div>
                      <div><span>Emotion</span><strong>{field(analysis.emotion)}</strong></div>
                    </div>
                    <AnalysisChips analysis={analysis} />
                    <p className="quiet">{[analysis.urgency ? 'Uses urgency' : '', analysis.scarcity ? 'Uses scarcity' : '', analysis.socialProof ? 'Uses social proof' : ''].filter(Boolean).join(' · ') || 'No urgency, scarcity or social proof found.'}</p>
                    <p className="quiet comp-note">Read from the ad text only{data.analysisModel ? ` by ${data.analysisModel}` : ''}. AIRO cannot see the image or video.</p>
                  </div>
                )}
              </div>
            </div>
            {data.signals ? <PublicSignals signals={data.signals} /> : null}
            <div className="comp-block">
              <h3>Not available</h3>
              <div className="comp-chips">{(data.notAvailable || []).map((key) => <span key={key} className="badge">{key}</span>)}</div>
              <p className="quiet comp-note">{data.note}</p>
            </div>
            <div className="comp-block">
              <h3>History</h3>
              {data.snapshots?.length ? (
                <ul className="comp-list">
                  {data.snapshots.map((row) => <li key={row.id}>{CHANGE[row.changeType] || row.changeType} · {when(row.observedAt)}{row.changeType === 'changed' && row.payload?.headline ? ` · new headline: ${row.payload.headline}` : ''}</li>)}
                </ul>
              ) : <p className="quiet">No changes recorded yet.</p>}
            </div>
          </div>
        ) : null}
      </State>
    </section>
  );
}

export function IntelOverview({ canManage, onOpenCompetitor }) {
  const { data, loading, error, reload } = useResource('/api/competitors/intelligence');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [checking, setChecking] = useState(0);
  usePoll(Boolean(data?.analysing), reload);

  async function checkAds(event, row) {
    event.stopPropagation();
    setChecking(row.id);
    setMessage('');
    try {
      await api.post(`/api/competitors/${row.id}/watch/check`, {});
      setMessage(`Reading ${row.name}'s Meta and Google ads. This takes one to three minutes; open the competitor to see the result.`);
    } catch (err) {
      setMessage(`${row.name}: ${err.message}`);
    } finally {
      setChecking(0);
    }
  }

  async function analyse() {
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post('/api/competitors/intelligence/analyze', {});
      setMessage(result.started ? 'AIRO is reading the new ads now. This page refreshes by itself.' : 'An analysis is already running.');
      reload({ silent: true });
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <State loading={loading} error={error} onRetry={reload}>
      {data && !data.ready ? <p className="quiet">{data.note}</p> : data ? (
        <div className="stack">
          <MetricStrip items={[
            { label: 'Tracked competitors', value: data.tracked, hint: 'Active in your list' },
            { label: 'Advertising now', value: data.activeAdvertisers, hint: 'Have live public ads' },
            { label: 'Live ads observed', value: data.market.ads, hint: 'Meta and Google' },
            { label: 'Ads analysed', value: data.market.analysedAds, hint: 'With readable text' }
          ]} />
          <div className="comp-running">
            {data.analysing ? <span className="comp-spinner" aria-hidden="true" /> : null}
            <div>
              <strong>
                {data.analysing ? `Analysing ads... ${num(data.pendingAnalysis)} left.` : data.pendingAnalysis ? `${num(data.pendingAnalysis)} ads wait for AI analysis.` : data.market.ads ? 'All stored ads are analysed.' : 'No competitor ads stored yet.'}
              </strong>
              <p className="quiet">AIRO analyses new ads every hour and after each ad check. Ads with the same text are analysed once; ads without text are not sent to AI.</p>
            </div>
            {canManage ? <button className="btn" type="button" onClick={analyse} disabled={busy || data.analysing || !data.pendingAnalysis}>Analyse ads now</button> : null}
          </div>
          {message ? <p className="quiet">{message}</p> : null}
          <div className="comp-block">
            <h3>Competitors</h3>
            <div className="table-wrap">
              <table className="responsive">
                <thead><tr><th>Competitor</th><th>Type</th><th>Live ads</th><th>Platforms</th><th>Main themes</th><th>Ads checked</th>{canManage ? <th>Ads</th> : null}</tr></thead>
                <tbody>
                  {data.competitors.length ? data.competitors.map((row) => (
                    <tr key={row.id} className="is-clickable" onClick={() => onOpenCompetitor(row.id)} tabIndex={0} onKeyDown={(event) => { if (event.key === 'Enter') onOpenCompetitor(row.id); }}>
                      <td data-label="Competitor"><strong>{row.name}</strong>{row.domain ? <small className="quiet"> · {row.domain}</small> : null}{row.verifiedAt ? <span className="badge good intel-verified">Verified</span> : null}</td>
                      <td data-label="Type"><TypeBadge value={row.competitorType} />{!row.competitorType ? '—' : null}</td>
                      <td data-label="Live ads">{num(row.activeAds)}</td>
                      <td data-label="Platforms">{row.platforms.map((key) => PLATFORM[key] || key).join(', ') || '—'}</td>
                      <td data-label="Main themes">{row.topThemes.join(', ') || '—'}</td>
                      <td data-label="Ads checked">{row.adsCheckedAt ? when(row.adsCheckedAt) : 'Never'}</td>
                      {canManage ? (
                        <td data-label="Ads">
                          <button className="btn" type="button" onClick={(event) => checkAds(event, row)} disabled={checking !== 0}>
                            {checking === row.id ? 'Starting...' : row.adsCheckedAt ? 'Check again' : 'Check ads'}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  )) : <tr><td colSpan={canManage ? 7 : 6}>No active competitors yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="quiet comp-note">Ads are read only when you press Check ads on a competitor. Each check uses a little Apify credit.</p>
          </div>
          {data.market.ads ? (
            <>
              <div className="comp-chips"><ConfidenceBadge value={data.market.confidence} /><span className="quiet">{`Based on ${num(data.market.analysedAds)} analysed ads from ${num(data.market.analysedCompetitors)} competitors.`}</span></div>
              <div className="intel-grid">
                <ShareBars title="Platforms" rows={data.market.distributions.platforms} />
                <ShareBars title="Formats" rows={data.market.distributions.formats} />
                <ShareBars title="Themes" rows={data.market.distributions.themes} />
                <ShareBars title="Offers" rows={data.market.distributions.offers} />
                <ShareBars title="Buttons" rows={data.market.distributions.ctas} />
                <ShareBars title="Creative styles" rows={data.market.distributions.styles} />
              </div>
              <p className="quiet comp-note">{data.market.note}</p>
            </>
          ) : <p className="quiet">No competitor ads stored yet. Open a competitor and press Check ads.</p>}
        </div>
      ) : null}
    </State>
  );
}

export function MarketGaps({ canManage }) {
  const { data, loading, error, reload } = useResource('/api/competitors/intelligence');
  return (
    <State loading={loading} error={error} onRetry={reload}>
      {data && !data.ready ? <p className="quiet">{data.note}</p> : data ? (
        <div className="stack">
          <div className="comp-block">
            <h3>What competitors are not doing</h3>
            {data.market.gaps.length ? (
              <ul className="intel-gaps">
                {data.market.gaps.map((gap) => <li key={`${gap.type}-${gap.key}`}><span>{gap.text}</span><ConfidenceBadge value={gap.confidence} /></li>)}
              </ul>
            ) : <p className="quiet">{data.market.analysedCompetitors < 2 ? 'Gaps need analysed ads from at least two competitors. Check ads on more competitors first.' : 'No clear gap found in the observed ads.'}</p>}
            <p className="quiet comp-note">{data.market.note}</p>
          </div>
          <Strategy
            path="/api/competitors/intelligence/strategy"
            insight={data.strategy}
            canManage={canManage}
            onDone={() => reload({ silent: true })}
            empty={data.market.analysedAds ? 'No market strategy yet. Press Make strategy.' : 'Check competitor ads first; the strategy is made from analysed ads.'}
          />
        </div>
      ) : null}
    </State>
  );
}

export function AdLibrary({ competitors }) {
  const [filters, setFilters] = useState({});
  const [openId, setOpenId] = useState(0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
  const { data, loading, error, reload } = useResource(`/api/competitors/intelligence/creatives${query ? `?${query}` : ''}`);
  const set = (key) => (event) => setFilters((current) => ({ ...current, [key]: event.target.value }));
  const items = data?.items || [];

  return (
    <div className="stack">
      <div className="intel-filters">
        <label className="stack-field">{FILTER_LABEL.competitorId.toUpperCase()}
          <select value={filters.competitorId || ''} onChange={set('competitorId')}>
            <option value="">All</option>
            {competitors.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </label>
        {Object.entries(OPTIONS).map(([key, values]) => (
          <label className="stack-field" key={key}>{FILTER_LABEL[key].toUpperCase()}
            <select value={filters[key] || ''} onChange={set(key)}>
              <option value="">All</option>
              {values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
          </label>
        ))}
        <label className="stack-field">FIRST SHOWN FROM<input type="date" value={filters.from || ''} onChange={set('from')} /></label>
        <label className="stack-field">TO<input type="date" value={filters.to || ''} onChange={set('to')} /></label>
        {query ? <button className="btn-ghost" type="button" onClick={() => setFilters({})}>Clear filters</button> : null}
      </div>
      {openId ? <AdDetail key={openId} id={openId} onClose={() => setOpenId(0)} /> : null}
      <State loading={loading} error={error} onRetry={reload}>
        {data && !data.ready ? <p className="quiet">Run the migration to set up competitor ads.</p> : (
          <>
            <p className="quiet">{num(items.length)} ads{items.length >= 300 ? ' (first 300)' : ''}. Active ads first, longest running first.</p>
            {items.length ? <div className="rival-grid-wide">{items.map((ad) => <AdTile key={ad.id} ad={ad} onOpen={setOpenId} />)}</div> : <p className="quiet">No ads match. Ads appear here after you press Check ads on a competitor.</p>}
          </>
        )}
      </State>
    </div>
  );
}

const INSIGHT_TABS = [['messaging', 'Messaging'], ['offers', 'Offers'], ['creatives', 'Creatives'], ['timeline', 'Timeline'], ['insights', 'Insights']];

export function CompetitorInsights({ id, canManage }) {
  const { data, loading, error, reload } = useResource(`/api/competitors/${id}/insights`);
  const [tab, setTab] = useState('messaging');
  if (loading || error || !data?.ready) return null;
  const { summary, timeline } = data;
  if (!summary.ads) return null;
  return (
    <section className="rival-panel">
      <header className="comp-head">
        <div>
          <h3>What their ads say</h3>
          <p className="quiet">{`${num(summary.active)} live ads stored, ${num(summary.analysed)} with readable text analysed by AI.`}</p>
        </div>
        <ConfidenceBadge value={summary.confidence} />
      </header>
      <div className="chip-tabs comp-tabs">
        {INSIGHT_TABS.map(([key, text]) => <button key={key} type="button" className={tab === key ? 'is-on' : ''} onClick={() => setTab(key)}>{text}</button>)}
      </div>
      {tab === 'messaging' ? (
        <div className="stack">
          <Bullets title="Main messages" items={summary.messages} />
          <div className="intel-grid">
            <ShareBars title="Themes" rows={summary.themes} />
            <ShareBars title="Buttons" rows={summary.ctas} />
            <ShareBars title="Landing pages" rows={summary.landing} />
          </div>
        </div>
      ) : null}
      {tab === 'offers' ? (
        <div className="stack">
          <Bullets title="Offers as written in their ads" items={summary.offerTexts} />
          <ShareBars title="Offer types" rows={summary.offers} empty="No offer found in their ad text." />
        </div>
      ) : null}
      {tab === 'creatives' ? (
        <div className="intel-grid">
          <ShareBars title="Formats" rows={summary.formats} />
          <ShareBars title="Creative styles (from text)" rows={summary.styles} />
          <ShareBars title="Platforms" rows={summary.platforms} />
        </div>
      ) : null}
      {tab === 'timeline' ? (
        <div className="stack">
          {timeline.months.length ? (
            <ol className="intel-timeline">
              {timeline.months.map((row) => (
                <li key={row.month}>
                  <strong>{row.month}</strong>
                  <span>{`${num(row.ads)} ads started · ${[...row.formats, ...row.platforms.map((key) => PLATFORM[key] || key)].join(', ')}`}</span>
                  {row.changes.length ? <span className="quiet">{row.changes.join(' · ')}</span> : null}
                </li>
              ))}
            </ol>
          ) : <p className="quiet">No start dates in the public data yet.</p>}
          {timeline.events.length ? <Bullets title="Changes seen between checks" items={timeline.events.map((row) => `${PLATFORM[row.platform] || row.platform} ad ${CHANGE[row.change] || row.change} · ${when(row.at)}`)} /> : null}
        </div>
      ) : null}
      {tab === 'insights' ? (
        <Strategy
          path={`/api/competitors/${id}/strategy`}
          insight={data.strategy}
          canManage={canManage}
          onDone={() => reload({ silent: true })}
          empty={summary.analysed ? 'No strategy yet. Press Make strategy.' : 'Their ads are not analysed yet. AIRO analyses new ads every hour.'}
        />
      ) : null}
    </section>
  );
}
