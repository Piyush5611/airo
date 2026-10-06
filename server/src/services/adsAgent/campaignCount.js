import { googleCampaignList } from '../../integrations/googleAds.js';
import { metaCampaignList } from '../../integrations/metaAds.js';
import { googleAccount } from '../googleAdChat.js';
import { metaAccount } from '../metaAdChat.js';
import { LINE, bullets, card, header, hint, section } from './waFormat.js';

const COUNT_ASK = /\b(kitne|kitni|kitna|how many|total|count|list|kaun ?kaun|kaunse|konse|kon se|sab|all|names?)\b/i;
const REPORT_WORDS = /\b(report|chart|graph|trend|performance|wise|spend|cpl|leads?|clicks?|results?|aaj|today|kal|yesterday|week|hafte|month|mahine)\b/i;
const HINGLISH = /\b(kitne|kitni|kitna|hai|hain|kaun|kaunse|konse|batao|btao|pe|par)\b/i;

export function wantsCampaignCount(text) {
  const value = String(text || '');
  return /\bcampaigns?\b/i.test(value) && COUNT_ASK.test(value) && !REPORT_WORDS.test(value);
}

export function platformsAsked(text) {
  const value = String(text || '');
  const google = /\b(google|search|adwords)\b/i.test(value);
  const meta = /\b(meta|facebook|fb|instagram|insta)\b/i.test(value);
  return { google: google || !meta, meta: meta || !google };
}

export function statusGroups(rows) {
  const active = rows.filter((row) => row.status === 'ENABLED' || row.status === 'ACTIVE');
  const paused = rows.filter((row) => row.status === 'PAUSED');
  const other = rows.filter((row) => !active.includes(row) && !paused.includes(row));
  return { active, paused, other };
}

function say(english, en, hi) {
  return english ? en : hi;
}

function platformBlock(title, rows, english) {
  const { active, paused, other } = statusGroups(rows);
  const line = (row) => `${row.name}  _(${row.status === 'ENABLED' || row.status === 'ACTIVE' ? say(english, 'active', 'chal raha') : row.status === 'PAUSED' ? 'paused' : row.status.toLowerCase()})_`;
  const shown = [...active, ...paused, ...other].slice(0, 10);
  return card([
    section(title, [
      say(english, `Total *${rows.length}*  ·  active *${active.length}*  ·  paused *${paused.length}*${other.length ? `  ·  other *${other.length}*` : ''}`, `Total *${rows.length}*  ·  chal rahe *${active.length}*  ·  paused *${paused.length}*${other.length ? `  ·  baaki *${other.length}*` : ''}`)
    ]),
    shown.length ? bullets(shown.map(line)) : '',
    rows.length > shown.length ? hint(say(english, `+${rows.length - shown.length} more in AIRO → Connections`, `+${rows.length - shown.length} aur AIRO → Connections mein`)) : ''
  ]);
}

export async function campaignCountReply({ organizationId, text }) {
  const english = !HINGLISH.test(text);
  const asked = platformsAsked(text);
  const blocks = [];
  if (asked.google) {
    const account = await googleAccount(organizationId);
    if (!account) blocks.push(section('GOOGLE ADS', say(english, 'Not connected.', 'Connect nahi hai.')));
    else {
      try {
        blocks.push(platformBlock('GOOGLE ADS', await googleCampaignList(account.input), english));
      } catch (error) {
        blocks.push(section('GOOGLE ADS', say(english, `Google did not send the list: ${String(error.message || '').slice(0, 140)}`, `Google ne list nahi bheji: ${String(error.message || '').slice(0, 140)}`)));
      }
    }
  }
  if (asked.meta) {
    const account = await metaAccount(organizationId);
    if (!account) blocks.push(section('META ADS', say(english, 'Not connected.', 'Connect nahi hai.')));
    else {
      try {
        blocks.push(platformBlock('META ADS', await metaCampaignList({ apiKey: account.apiKey, accountId: account.accountId }), english));
      } catch (error) {
        blocks.push(section('META ADS', say(english, `Meta did not send the list: ${String(error.message || '').replace(/access_token=[^&\s]+/gi, '').slice(0, 140)}`, `Meta ne list nahi bheji: ${String(error.message || '').replace(/access_token=[^&\s]+/gi, '').slice(0, 140)}`)));
      }
    }
  }
  return card([
    header(say(english, 'Your campaigns', 'Aapke campaigns'), say(english, 'Live from the ad accounts', 'Ad accounts se live')),
    blocks.join(`\n\n${LINE}\n\n`),
    hint(say(english, 'For results send: ads report  ·  campaign wise', 'Results ke liye likho: ads report  ·  campaign wise'))
  ]).slice(0, 3900);
}
