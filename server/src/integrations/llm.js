import { ApiError } from '../utils/errors.js';

const PROVIDERS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini'
};

export function llmProviderName(provider) {
  return PROVIDERS[provider] || '';
}

function httpsOrigin(raw, fallback) {
  let url;
  try { url = new URL(String(raw || fallback).trim()); } catch {
    throw new ApiError(422, 'Base URL must be an https address.', 'validation_error');
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new ApiError(422, 'Base URL must start with https.', 'validation_error');
  }
  return url.origin;
}

async function getJson(url, headers) {
  let response;
  try {
    response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  } catch {
    throw new ApiError(502, 'The model provider did not respond.', 'llm_unreachable');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ApiError(422, 'The model provider did not accept this API.', 'validation_error');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(422, 'Wrong API.', 'validation_error');
  }
  if (!response.ok) {
    const message = String(data?.error?.message || data?.error?.status || 'The model provider rejected this API.')
      .replace(/key=[^&\s]+/gi, '')
      .slice(0, 240);
    throw new ApiError(422, message, 'validation_error');
  }
  return data;
}

function shortName(value) {
  const text = String(value || '').trim();
  const slash = text.lastIndexOf('/');
  return (slash >= 0 ? text.slice(slash + 1) : text).slice(0, 120);
}

export async function listLlmModels({ provider, apiKey, baseUrl }) {
  if (!PROVIDERS[provider]) throw new ApiError(422, 'Choose a model provider.', 'validation_error');
  const rows = [];
  let savedBase = '';
  if (provider === 'openai') {
    const origin = httpsOrigin(baseUrl, 'https://api.openai.com');
    const data = await getJson(`${origin}/v1/models`, { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' });
    rows.push(...(Array.isArray(data.data) ? data.data : []).map((row) => shortName(row.id)));
    savedBase = origin === 'https://api.openai.com' ? '' : origin;
  } else if (provider === 'anthropic') {
    const headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', Accept: 'application/json' };
    let after = '';
    for (let page = 0; page < 20; page += 1) {
      const query = after ? `?limit=100&after_id=${encodeURIComponent(after)}` : '?limit=100';
      const data = await getJson(`https://api.anthropic.com/v1/models${query}`, headers);
      const batch = Array.isArray(data.data) ? data.data : [];
      rows.push(...batch.map((row) => shortName(row.id || row.name)));
      if (!data.has_more || !data.last_id || data.last_id === after) break;
      after = data.last_id;
    }
  } else {
    let token = '';
    for (let page = 0; page < 20; page += 1) {
      const query = token ? `&pageToken=${encodeURIComponent(token)}` : '';
      const data = await getJson(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100${query}&key=${encodeURIComponent(apiKey)}`,
        { Accept: 'application/json' }
      );
      const batch = Array.isArray(data.models) ? data.models : [];
      rows.push(...batch.map((row) => shortName(row.name || row.displayName)));
      if (!data.nextPageToken || data.nextPageToken === token) break;
      token = data.nextPageToken;
    }
  }
  const models = [...new Set(rows.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (!models.length) throw new ApiError(422, 'The provider did not return any models for this key.', 'validation_error');
  return { models, baseUrl: savedBase };
}

async function postJson(url, headers, body) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw new ApiError(502, 'The model provider did not respond.', 'llm_unreachable');
  }
  if (response.status >= 300 && response.status < 400) {
    throw new ApiError(422, 'The model provider did not accept this API.', 'validation_error');
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(422, 'Wrong API.', 'validation_error');
  }
  if (!response.ok) {
    const message = String(data?.error?.message || data?.error?.status || 'The model provider rejected this API.')
      .replace(/key=[^&\s]+/gi, '')
      .slice(0, 240);
    throw new ApiError(422, message, 'validation_error');
  }
  return data;
}

function replyText(value) {
  const text = String(value || '').trim();
  if (!text) throw new ApiError(502, 'The model returned an empty reply.', 'llm_empty');
  return text.slice(0, 8000);
}

const ASSISTANT_BRIEF = `You are the AIRO assistant.
Write in Hinglish: Hindi words in English letters, mixed with normal English. Example: "Haan, WhatsApp chatbot pehle se connected hai."
Never use Hindi script (Devanagari). If an earlier reply used Hindi letters, that reply was wrong. Do not copy those letters.
If the person writes only in English, answer in English.
If the person only greets you, start in English with "I am the AIRO assistant." Then one short Hinglish line: connection ya is workspace ke baare mein pooch sakte ho. Do not say "How can I help you today."
Use only the status and the steps in this message. If an earlier reply mentioned Integrations, Settings, a dashboard login, or a support ticket, that reply was wrong. Do not repeat it.
When they ask whether something is connected, start with haan or nahi from the status.
When they ask how to connect, do not tell them to log in. They are already in AIRO. Give only the steps below for the tools that are not connected. Do not invent pages.

Workspace steps, for a client user:
- Open Connections in the left sidebar. The tabs are Advertising, Real Estate Portals, Communication, Calling, CRM, Analytics, and Developer / API.
- Google Ads, Meta Ads, and LinkedIn Ads are under Advertising. 99acres, MagicBricks, Housing.com, and NoBroker are under Real Estate Portals. Email and SMS are under Communication. Nexcall is under Calling. Salesforce and HubSpot are under CRM. Google Analytics and Google Tag Manager are under Analytics.
- On that provider row, press Connect API.
- Meta Ads: paste the access token and the ad account id, shaped like act_123456789, then Save API key. Meta checks both before it connects.
- Nexcall: paste the x-api-key. Leave Base URL blank. Save API key.
- Any other tool: paste the API key or access token. Account id and Base URL can stay blank. Save API key.
- A wrong key shows Wrong API and is not saved.
- WhatsApp is not connected with a business key. Super Admin or Developer/Admin connects the shared chatbot on the platform. If the status says the WhatsApp chatbot is connected, say it is already connected.
- The status says whether this person can press Connect API. If they can, never mention Owners, Admins, permissions, or a missing button. Do not add a note. If they cannot, add one short sentence: an Owner or Admin must save the key.

Platform steps, only if this person is a platform user:
- A model is connected on Platform AI, then AI Models. Choose a purpose, a provider, paste the API key, choose a model, then Connect model.
- Only Super Admin, Operations Admin, and Developer/Admin can save that key.`;

export const WHATSAPP_BRIEF = `You are the AIRO assistant replying on WhatsApp. Keep each reply short, like a chat message.
Write in Hinglish: Hindi words in English letters, mixed with normal English. Example: "Haan, Meta Ads is business pe connected hai."
Never use Hindi script (Devanagari).
If the person writes only in English, answer in English.
If the person only greets you, start with "I am the AIRO assistant." Then one short line. Do not say "How can I help you today."
Use only the status in this message. Do not invent leads, money, pages, or whether something is connected.
If the status includes a report, share those figures in a short reply. Repeat the filter it names, such as the employee, team, team head, or dates, and share only those figures. Do not say the report is missing when those figures are present. The Nexcall calling report is the call report: totals, incoming, outgoing, missed, rejected, and the employee table. If those figures are present, share them. A zero in AIRO workspace records does not mean the Nexcall report is empty. Do not replace the call report with a list of phone numbers. If a figure is not in the status, say only that part is not in the report.
If the status says a person, team, or team head was not found, say that and do not share anyone else's numbers.
If the status says Nexcall is not split by employee or team, do not present Nexcall totals as that person's.
If the status does not name a business, do not guess the business and do not share any connection status or report.`;

function hasDevanagari(text) {
  return /[\u0900-\u097F]/.test(String(text || ''));
}

async function completeLlm({ provider, model, apiKey, baseUrl, system, turns }) {
  if (provider === 'openai') {
    const origin = httpsOrigin(baseUrl, 'https://api.openai.com');
    const data = await postJson(`${origin}/v1/chat/completions`, { Authorization: `Bearer ${apiKey}` }, {
      model,
      messages: [{ role: 'system', content: system }, ...turns]
    });
    const content = data?.choices?.[0]?.message?.content;
    return Array.isArray(content) ? content.map((part) => part.text || '').join('') : content;
  }
  if (provider === 'anthropic') {
    const data = await postJson('https://api.anthropic.com/v1/messages', {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }, {
      model,
      max_tokens: 1024,
      system,
      messages: turns
    });
    return Array.isArray(data.content) ? data.content.map((part) => part.text || '').join('') : '';
  }
  const data = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {},
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((row) => ({
        role: row.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: row.content }]
      }))
    }
  );
  const parts = data?.candidates?.[0]?.content?.parts || [];
  if (!parts.length && data?.promptFeedback?.blockReason) {
    throw new ApiError(422, `The model declined this message (${data.promptFeedback.blockReason}).`, 'validation_error');
  }
  return parts.map((part) => part.text || '').join('');
}

export async function replyLlm({ provider, model, apiKey, baseUrl, messages, facts, system }) {
  if (!PROVIDERS[provider]) throw new ApiError(422, 'Choose a model provider.', 'validation_error');
  const brief = `${system || ASSISTANT_BRIEF}\n\nStatus from AIRO just now:\n${facts || 'No status was loaded.'}`;
  const turns = messages
    .map((row) => ({ role: row.role === 'assistant' ? 'assistant' : 'user', content: String(row.content || '').trim() }))
    .filter((row) => row.content)
    .slice(-20);
  if (!turns.length || turns.at(-1).role !== 'user') {
    throw new ApiError(422, 'Type a message first.', 'validation_error');
  }
  const call = { provider, model, apiKey, baseUrl };
  let text = await completeLlm({ ...call, system: brief, turns });
  if (hasDevanagari(text)) {
    const fixed = await completeLlm({
      ...call,
      system: 'Rewrite the message in Hinglish using only English letters. Keep the same meaning. Do not use Hindi script. Do not add a note.',
      turns: [{ role: 'user', content: text }]
    });
    if (!hasDevanagari(fixed)) text = fixed;
  }
  return replyText(text);
}

export async function verifyLlm({ provider, model, apiKey, baseUrl, manual }) {
  const listed = await listLlmModels({ provider, apiKey, baseUrl });
  const wanted = model.trim().toLowerCase();
  const known = listed.models.some((name) => name.toLowerCase() === wanted);
  if (!known && !manual) {
    throw new ApiError(422, 'Choose a model from the list, or type a new model name.', 'validation_error');
  }
  return { baseUrl: listed.baseUrl };
}
