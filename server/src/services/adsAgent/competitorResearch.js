import { one } from '../../db/sql.js';
import { adLibrarySearch } from '../../integrations/metaAds.js';
import { googleKeywordIdeas } from '../../integrations/googleAds.js';
import { googleAccount } from '../googleAdChat.js';
import { metaAccount } from '../metaAdChat.js';
import { businessProfile } from './chatPlanner.js';
import { LINE, bullets, card, header, hint, money, section } from './waFormat.js';

const TRIGGER = /\b(competitors?|competition|competitive|rivals?|ad ?library|transparency)\b/i;
const FILLER = /\b(what|which|who|how|many|much|are|is|do|does|doing|did|the|on|of|for|in|my|our|me|show|tell|about|please|ads?|running|run|competitors?|competition|competitive|rivals?|kya|kaun|kaunse|kitne|kitna|log|kar|kr|rahe|rhe|raha|rha|hai|hain|chala|chla|chal|mere|mera|hamare|btao|batao|bata|bta|aur|ke|ka|ki|ko|me|mein|project|pe|par|se|ad ?library|transparency)\b/gi;
const HINGLISH = /\b(kya|kaun|kitne|kitna|hai|hain|kar|kr|rahe|rhe|batao|btao|bta|chala|chla|mere|kaise)\b/i;
const PLATFORM_NAMES = { facebook: 'Facebook', instagram: 'Instagram', messenger: 'Messenger', audience_network: 'Audience Network' };

export function wantsCompetitorInfo(text) {
  return TRIGGER.test(String(text || ''));
}

export function competitorTopic(text) {
  return String(text || '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function libraryStats(ads) {
  const pages = new Map();
  const platforms = { facebook: 0, instagram: 0, messenger: 0, audience_network: 0 };
  for (const ad of ads) {
    const key = ad.pageId || ad.page;
    const row = pages.get(key) || { page: ad.page, count: 0, firstStart: ad.startDate };
    row.count += 1;
    if (ad.startDate && (!row.firstStart || ad.startDate < row.firstStart)) row.firstStart = ad.startDate;
    pages.set(key, row);
    for (const name of ad.platforms) if (name in platforms) platforms[name] += 1;
  }
  return {
    ads: ads.length,
    advertisers: [...pages.values()].sort((a, b) => b.count - a.count),
    platforms
  };
}

function say(english, en, hi) {
  return english ? en : hi;
}

async function draftProduct(conversationId) {
  if (!conversationId) return null;
  for (const table of ['google_ad_drafts', 'meta_ad_drafts']) {
    try {
      const row = await one(`SELECT payload FROM ${table} WHERE conversation_id = ?`, [conversationId]);
      const payload = typeof row?.payload === 'string' ? JSON.parse(row.payload) : row?.payload;
      if (payload?.product) return { product: String(payload.product), locations: table === 'google_ad_drafts' ? payload.locations || [] : [] };
    } catch {
      // Table may not exist yet.
    }
  }
  return null;
}

function days(date) {
  const start = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(start) ? Math.max(0, Math.floor((Date.now() - start) / 86400000)) : null;
}

function quoted(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

async function metaSection(organizationId, topic, english) {
  const title = 'META · Facebook + Instagram';
  const account = await metaAccount(organizationId);
  const link = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=${encodeURIComponent(topic)}&search_type=keyword_unordered`;
  if (!account) {
    return {
      count: null,
      text: section(title, [
        say(english, 'Meta Ads is not connected, so the Ad Library was not searched.', 'Meta Ads connect nahi hai, isliye Ad Library search nahi hui.'),
        `${say(english, 'Check by hand', 'Khud dekho')}: ${link}`
      ])
    };
  }
  const { ads, error } = await adLibrarySearch({ apiKey: account.apiKey, query: topic, limit: 50 });
  if (!ads.length) {
    return {
      count: null,
      text: section(title, [
        error ? say(english, 'The Ad Library API did not answer.', 'Ad Library API ne jawab nahi diya.') : say(english, 'The Ad Library API returned no ads.', 'Ad Library API ne koi ad nahi di.'),
        hint(say(
          english,
          "For India, Meta's API only shares ads about social issues, elections or politics, so normal business ads usually do not come through it.",
          'India ke liye Meta ki API sirf social issue, election ya politics wali ads deti hai, isliye normal business ads isse nahi aati.'
        )),
        `${say(english, 'See them on the Ad Library website', 'Ad Library website pe dekho')}:\n${link}`
      ])
    };
  }
  const stats = libraryStats(ads);
  const top = stats.advertisers.slice(0, 6).map((row) => {
    const age = days(row.firstStart);
    return `*${row.page || 'Unknown page'}*  ${row.count} ${say(english, 'ads', 'ads')}${age != null ? ` · ${say(english, 'running', 'chal rahi')} ${age} ${say(english, 'days', 'din')}` : ''}`;
  });
  const platformLine = Object.entries(stats.platforms)
    .filter(([, value]) => value)
    .map(([name, value]) => `${PLATFORM_NAMES[name]} *${Math.round((value / stats.ads) * 100)}%*`)
    .join(' · ');
  const samples = ads.filter((ad) => ad.title || ad.text).slice(0, 3).map((ad, index) => [
    `*${index + 1}. ${ad.page}*`,
    ad.title ? `> *${quoted(ad.title)}*` : '',
    ad.text ? `> ${quoted(ad.text).slice(0, 220)}` : '',
    ad.description ? `> _${quoted(ad.description)}_` : ''
  ].filter(Boolean).join('\n'));
  return {
    count: stats.ads,
    text: card([
      section(title, [
        say(english, `*${stats.ads}* active ads · *${stats.advertisers.length}* advertisers`, `*${stats.ads}* active ads · *${stats.advertisers.length}* advertisers`),
        platformLine ? `${say(english, 'Where', 'Kahan')}: ${platformLine}` : ''
      ]),
      section(say(english, 'Top advertisers', 'Top advertisers'), bullets(top)),
      hint(say(english, 'Ads running for a long time usually work for them.', 'Jo ad lambe time se chal rahi hai, woh aam taur pe unke liye kaam kar rahi hai.')),
      samples.length ? section(say(english, 'Their ads', 'Unki ads'), samples.join('\n\n')) : '',
      `${say(english, 'Full list', 'Poori list')}: ${link}`
    ])
  };
}

async function googleSection(organizationId, topic, locations, english) {
  const title = 'GOOGLE SEARCH';
  const account = await googleAccount(organizationId);
  if (!account) return section(title, say(english, 'Google Ads is not connected, so keyword competition was not checked.', 'Google Ads connect nahi hai, isliye keyword competition check nahi hua.'));
  const cities = locations.map((item) => String(item.name || '').split(',')[0].toLowerCase()).filter(Boolean);
  const seeds = [topic.toLowerCase(), ...cities.slice(0, 2).map((city) => `${topic.toLowerCase()} ${city}`)];
  let ideas = [];
  let failure = '';
  try {
    ideas = await googleKeywordIdeas(account.input, { seeds, locations: locations.map((item) => item.id).filter(Boolean) });
  } catch (error) {
    failure = String(error?.message || 'unknown error').slice(0, 200);
  }
  if (failure) {
    return section(title, [
      say(english, 'Google Keyword Planner refused the request:', 'Google Keyword Planner ne request mana kar di:'),
      `> ${failure}`,
      hint(say(english, 'Keyword Planner usually needs a Google Ads developer token with Basic or Standard access. Test or Explorer access is often not enough.', 'Keyword Planner ke liye aam taur pe Basic ya Standard access wala developer token chahiye. Test ya Explorer access se aksar kaam nahi chalta.'))
    ]);
  }
  if (!ideas.length) return section(title, say(english, `Keyword Planner returned no data for "${topic}". Try a broader term, e.g. "flats in noida".`, `"${topic}" ke liye Keyword Planner ne data nahi diya. Broad term try karo, jaise "flats in noida".`));
  const rows = ideas.filter((row) => row.searches != null).sort((a, b) => Number(b.searches) - Number(a.searches)).slice(0, 8);
  const high = ideas.filter((row) => row.competition === 'HIGH').length;
  const medium = ideas.filter((row) => row.competition === 'MEDIUM').length;
  const currency = account.input.currency || '';
  const level = { HIGH: 'HIGH', MEDIUM: 'MED', LOW: 'LOW' };
  return card([
    section(title, [
      say(english, `Advertiser competition on *${ideas.length}* related keywords:`, `*${ideas.length}* related keywords pe advertiser competition:`),
      `HIGH *${high}* · MEDIUM *${medium}* · LOW/none *${ideas.length - high - medium}*`
    ]),
    section(say(english, 'Top keywords people search', 'Log sabse zyada kya search karte hain'), bullets(rows.map((row) => {
      const bid = row.lowBid != null && row.highBid != null ? ` · bid ${money(row.lowBid, currency)}-${money(row.highBid, currency)}` : '';
      return `${row.text}\n   ${Number(row.searches).toLocaleString('en-IN')}/mo · ${level[row.competition] || 'n/a'}${bid}`;
    }))),
    hint(say(
      english,
      'Google does not share who bids or their ad text through its API. Their live Google ads are on the Ads Transparency Center:',
      'Google apni API se nahi batata ki kaun bid kar raha hai ya unki ad copy kya hai. Unki live Google ads Ads Transparency Center pe dikhti hain:'
    )),
    'https://adstransparency.google.com/?region=IN'
  ]);
}

function profileLinks(profile, english) {
  const names = Array.isArray(profile?.competitors) ? profile.competitors.slice(0, 5) : [];
  if (!names.length) return '';
  return section(
    say(english, 'COMPETITORS IN YOUR PROFILE', 'AAPKE PROFILE KE COMPETITORS'),
    names.map((name) => {
      const domain = String(name).match(/([a-z0-9-]+\.)+[a-z]{2,}/i)?.[0];
      const google = domain ? `https://adstransparency.google.com/?region=IN&domain=${encodeURIComponent(domain)}` : 'https://adstransparency.google.com/?region=IN';
      const meta = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=IN&q=${encodeURIComponent(name)}&search_type=keyword_unordered`;
      return `*${name}*\nMeta: ${meta}\nGoogle: ${google}`;
    }).join('\n\n')
  );
}

export async function competitorReply({ organizationId, conversationId, text, topic: askedTopic = '' }) {
  const english = !HINGLISH.test(text);
  const draft = await draftProduct(conversationId);
  const profile = await businessProfile(organizationId);
  const topic = competitorTopic(askedTopic) || competitorTopic(text) || competitorTopic(draft?.product) || competitorTopic(profile?.offering || profile?.category || '');
  if (topic.length < 3) {
    return card([
      say(english, 'Which product or project should I check?', 'Kis product ya project ke competitors dekhun?'),
      hint('Example: competitors 2bhk flats noida')
    ]);
  }
  const meta = await metaSection(organizationId, topic, english);
  const google = await googleSection(organizationId, topic, draft?.locations || [], english);
  const ratio = meta.count != null
    ? say(english, 'Google does not publish advertiser counts, so a Google vs Meta ratio cannot be measured honestly. Keyword competition shows how crowded Google is.', 'Google advertisers ki ginti nahi deta, isliye Google vs Meta ratio sach mein nikal nahi sakte. Keyword competition se pata chalta hai Google pe kitni bheed hai.')
    : say(english, 'Neither platform shares an advertiser count through the API here, so a Google vs Meta ratio cannot be measured honestly.', 'Yahan dono platform API se advertisers ki ginti nahi dete, isliye Google vs Meta ratio sach mein nikal nahi sakte.');
  return card([
    header(say(english, 'Competitor Research', 'Competitor Research'), topic),
    meta.text,
    LINE,
    google,
    profileLinks(profile, english) ? LINE : '',
    profileLinks(profile, english),
    LINE,
    hint(ratio),
    `${say(english, 'Another product?', 'Doosra product?')} \`competitors <${say(english, 'product and city', 'product aur city')}>\``
  ]).slice(0, 3900);
}
