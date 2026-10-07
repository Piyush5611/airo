import dns from 'node:dns/promises';
import net from 'node:net';
import { privateAddress } from './verify.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; AIRO/1.0; +https://airo.kalaakchar.in)';

async function publicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host)) return privateAddress(host) ? null : url;
  const records = await dns.lookup(host, { all: true }).catch(() => []);
  if (!records.length || records.some((record) => privateAddress(record.address))) return null;
  return url;
}

async function readCapped(response, cap) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks = [];
  let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8').slice(0, cap);
}

// Only public http(s) hosts are fetched; every redirect hop is checked again.
export async function fetchPublic(raw, cap) {
  let target = raw;
  for (let hop = 0; hop < 4; hop += 1) {
    const url = await publicUrl(target);
    if (!url) return { blocked: true };
    let response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/javascript,*/*' },
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      return { failed: true };
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      target = new URL(response.headers.get('location'), url).toString();
      continue;
    }
    if (!response.ok) return { status: response.status };
    return { url, body: await readCapped(response, cap) };
  }
  return { failed: true };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', ndash: '-', mdash: '-', hellip: '...', rupee: 'Rs' };

export function decodeEntities(text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole);
}

const clean = (text) => decodeEntities(String(text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function pageText(html) {
  const source = String(html || '');
  const title = clean(source.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).slice(0, 200);
  const description = clean(source.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i)?.[1]
    || source.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i)?.[1]).slice(0, 400);
  const headings = [...source.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => clean(match[1]))
    .filter((text) => text.length > 2)
    .slice(0, 25);
  const body = clean(source
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr|\/section)[^>]*>/gi, ' | '));
  return { title, description, headings, text: body.replace(/(\s*\|\s*)+/g, ' | ').slice(0, 9000) };
}

const LINK_HINTS = /(project|propert|residen|apartment|flat|villa|plot|price|pricing|offer|floor|plan|amenit|about|location|product|service|course|package|plans)/i;
const SKIP_LINKS = /\.(pdf|jpe?g|png|gif|webp|zip|mp4)(\?|$)|\/(wp-admin|wp-login|cart|checkout|account|login|signup|tag|author|feed)\b|mailto:|tel:|javascript:|^#/i;

export function samePageLinks(html, pageUrl, limit = 5) {
  const base = new URL(pageUrl);
  const scored = new Map();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1]);
    if (SKIP_LINKS.test(href)) continue;
    let url;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    url.hash = '';
    const key = url.toString();
    if (key === base.toString() || scored.has(key)) continue;
    const label = clean(match[2]);
    const score = (LINK_HINTS.test(url.pathname) ? 2 : 0) + (LINK_HINTS.test(label) ? 2 : 0) - url.pathname.split('/').length * 0.1;
    scored.set(key, score);
  }
  return [...scored.entries()].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([key]) => key);
}

export function pricesIn(text) {
  const found = new Set();
  const pattern = /(?:₹|rs\.?|inr)\s?[\d,.]+\s?(?:lakh|lac|lacs|l|cr|crore|k)?(?:\s?(?:onwards|\*|\+))?|[\d,.]+\s?(?:lakh|lac|lacs|cr|crore)\b(?:\s?(?:onwards|\*))?/gi;
  for (const match of String(text).matchAll(pattern)) {
    const value = match[0].replace(/\s+/g, ' ').trim();
    if (/\d/.test(value) && value.length <= 40) found.add(value);
    if (found.size >= 15) break;
  }
  return [...found];
}
