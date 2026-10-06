import { z } from 'zod';
import { one } from '../db/sql.js';
import { structuredLlm } from './llmService.js';

export const INTENTS = [
  'ad_setup_answer',
  'start_google_ad',
  'start_meta_ad',
  'cancel_ad_setup',
  'competitors',
  'campaign_list',
  'ads_report',
  'ads_advice',
  'ads_analysis',
  'call_report',
  'crm_report',
  'greeting',
  'other'
];

const intentSchema = z.object({
  intent: z.enum(INTENTS),
  request: z.string().trim().max(200).default(''),
  platform: z.enum(['google', 'meta', 'both', 'none']).default('none'),
  topic: z.string().trim().max(60).default('')
});

const STEP_QUESTIONS = {
  product: 'what the ad is for',
  category: 'what the ad is for',
  offering: 'which saved products/projects/services to advertise (a tapped item name, numbers like 1,3, Done, Add new, or a typed new item name)',
  offer_save: 'whether to save the new item in the AIRO panel: haan or nahi',
  website: 'the website link (or "no website")',
  details: 'selling points such as price, offer, amenities (or "skip")',
  region: 'which cities to target (a tapped city name, Done, Best pick, All suggested, Add other city, a typed city name to add, "remove <city>", ok, numbers, or all India)',
  region_pick: 'which city number from a list',
  radius: 'the radius around the chosen cities (City only, +17/+25/+40/+80 km, or any km number)',
  budget: 'the daily budget (Meta also asks the goal, e.g. "500 leads")',
  objective: 'the goal: leads, appointments, sales, awareness or traffic',
  shop: 'an https shop link, or leads/appointments',
  special: 'the special ad category or none',
  audience: 'age and gender',
  page: 'which Facebook Page number',
  review: 'reviewing the Google plan: ok to save, or edits such as headlines:, keywords:, budget:, or an idea in words',
  image: '"design"/"ok" to use the AIRO designs, the ad photo, "original", "skip", a budget change like "budget 600", or a copy edit "headline | text" / "use 3"',
  ad: 'the ad photo or "skip"',
  approval: 'whether to publish the saved paused campaign: haan or nahi'
};

const ROUTER_BRIEF = `You route WhatsApp messages for AIRO, a business CRM and ads assistant used by Indian business owners. Messages are in English or Hinglish and are often short.
Read the recent chat and the open ad setup (if any). Decide what the LATEST user message is about, using earlier messages only to understand short follow-ups like "kya hua", "aur?", "past 7 days", "uska list do".
Intents:
- ad_setup_answer: the message answers the question the open ad setup asked (a product, link, city, number, budget, ok, skip, haan/nahi to publish, copy edits, photo). Only when an ad setup is open.
- start_google_ad / start_meta_ad: wants to create or run a new Google or Meta (Facebook/Instagram) ad.
- cancel_ad_setup: wants to stop the open ad setup.
- competitors: asks what competitors or other advertisers run. Put the product/project/place in topic.
- campaign_list: asks how many campaigns exist, or their names or status (not results).
- ads_report: asks ad results: spend, leads from ads, clicks, CPL, campaign wise results, ad charts.
- ads_advice: asks what to change or improve in ads, or AI recommendations.
- ads_analysis: asks which ads are good or bad, best or worst ad, how well each ad performs, an ad ranking, score or analysis (per ad, not totals).
- call_report: asks about phone calls: call report, calls by an employee, missed calls, best time to call, who called whom.
- crm_report: asks about CRM leads, bookings, site visits, follow ups, team or employee performance that is not about calls or ads.
- greeting: only a greeting.
- other: anything else.
request: rewrite the user's need as one short standalone English request with every detail kept: platform, dates or period ("today", "yesterday", "last 7 days", "this month"), employee or team names, project, city. Example: "Kaushal ne aaj kitni call ki" -> "call report today for Kaushal". "kya hua" after asking a call report -> repeat that call report request. Do not add details the user did not give.
platform: google, meta, both, or none.`;

async function draftState(conversationId) {
  for (const [table, platform] of [['google_ad_drafts', 'Google'], ['meta_ad_drafts', 'Meta']]) {
    try {
      const row = await one(`SELECT step FROM ${table} WHERE conversation_id = ? AND step <> 'done'`, [conversationId]);
      if (row?.step) return { platform, step: row.step };
    } catch {
      // Draft tables may be missing before migrate.
    }
  }
  return null;
}

export function chatFacts(messages, draft) {
  const recent = (messages || []).slice(-8).map((row) => `${row.role === 'user' ? 'User' : 'AIRO'}: ${String(row.content || '').replace(/\s+/g, ' ').slice(0, 300)}`);
  return [
    `Today: ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}`,
    draft
      ? `Open ad setup: ${draft.platform}, waiting for ${STEP_QUESTIONS[draft.step] || draft.step}.`
      : 'Open ad setup: none.',
    'Recent chat (oldest first, the last User line is the latest message):',
    ...recent
  ].join('\n');
}

const ROUTER_TIMEOUT_MS = 9000;

export async function classifyMessage({ organizationId, conversationId, messages }) {
  const draft = await draftState(conversationId);
  let timer;
  try {
    const call = structuredLlm({
      organizationId,
      schema: intentSchema,
      system: ROUTER_BRIEF,
      facts: chatFacts(messages, draft),
      task: 'Route the latest user message as JSON: {"intent":"","request":"","platform":"none","topic":""}',
      maxTokens: 300,
      purposes: ['assistant', 'whatsapp', 'ads']
    });
    call.catch(() => {});
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('router timeout')), ROUTER_TIMEOUT_MS); });
    const { data } = await Promise.race([call, timeout]);
    if (data.intent === 'ad_setup_answer' && !draft) data.intent = 'other';
    return { ...data, draft };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function withLatest(messages, content) {
  const copy = [...messages];
  for (let index = copy.length - 1; index >= 0; index -= 1) {
    if (copy[index].role === 'user') {
      copy[index] = { ...copy[index], content };
      break;
    }
  }
  return copy;
}
