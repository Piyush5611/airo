import { Resvg } from '@resvg/resvg-js';
import { fileURLToPath } from 'node:url';

const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
const FONTS = ['Inter-400', 'Inter-600', 'Inter-700', 'Inter-ext-400', 'Inter-ext-600', 'Inter-ext-700'].map((name) => `${FONT_DIR}${name}.ttf`);
const SIZE = 1080;
const PAD = 84;
const MAX_BYTES = 2400000;

export const THEMES = [
  { from: '#1E3A8A', to: '#6D28D9', accent: '#FACC15', button: '#FACC15', buttonText: '#1E1B4B' },
  { from: '#065F46', to: '#0E7490', accent: '#FDE68A', button: '#FFFFFF', buttonText: '#065F46' },
  { from: '#9A3412', to: '#BE123C', accent: '#FEF3C7', button: '#FFFFFF', buttonText: '#9F1239' }
];

const CTA_TEXT = {
  LEARN_MORE: 'Learn More',
  SIGN_UP: 'Enquire Now',
  BOOK_NOW: 'Book Now',
  SHOP_NOW: 'Shop Now',
  MESSAGE_PAGE: 'Message Us',
  CONTACT_US: 'Contact Us',
  GET_QUOTE: 'Get a Quote',
  APPLY_NOW: 'Apply Now'
};

function escapeXml(value) {
  return String(value || '').replace(/\u00A0/g, ' ').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function charWidth(char, size, bold) {
  if (/[ilI.,:;'|!]/.test(char)) return size * 0.28;
  if (/[mwMW@]/.test(char)) return size * (bold ? 0.92 : 0.86);
  if (/[A-Z0-9]/.test(char)) return size * (bold ? 0.7 : 0.66);
  if (char === ' ') return size * 0.27;
  return size * (bold ? 0.58 : 0.54);
}

export function textWidth(text, size, bold = false) {
  return [...String(text || '')].reduce((total, char) => total + charWidth(char, size, bold), 0);
}

function keepTogether(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').replace(/(\d)\s+(bhk|rk|km|min|mins|lakh|lakhs|cr|crore|sq\.? ?ft|acres?|%)\b/gi, '$1\u00A0$2');
}

export function wrapText(text, size, maxWidth, bold = false) {
  const lines = [];
  let line = '';
  for (const word of keepTogether(text).split(' ').filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, size, bold) <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function fitText(text, { maxWidth, maxLines, start, min, bold = false }) {
  for (let size = start; size >= min; size -= 4) {
    const lines = wrapText(text, size, maxWidth, bold);
    if (lines.length <= maxLines) return { size, lines };
  }
  const lines = wrapText(text, min, maxWidth, bold);
  const kept = lines.slice(0, maxLines);
  if (lines.length > maxLines) kept[maxLines - 1] = `${kept[maxLines - 1].replace(/[\s,.;:-]+\S*$/, '')}…`;
  return { size: min, lines: kept };
}

export function ctaLabel(cta) {
  return CTA_TEXT[String(cta || '').toUpperCase()] || 'Learn More';
}

function hostOf(link) {
  try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function photoType(base64) {
  return String(base64 || '').startsWith('/9j/') ? 'image/jpeg' : 'image/png';
}

export function creativeSvg({ headline, points = [], cta, business = '', link = '', theme = 0, photoBase64 = '' }) {
  const colors = THEMES[theme % THEMES.length];
  const inner = SIZE - PAD * 2;
  const parts = [];
  parts.push(`<defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${colors.from}"/><stop offset="1" stop-color="${colors.to}"/></linearGradient>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.5" stop-color="#000" stop-opacity="0.55"/><stop offset="1" stop-color="#000" stop-opacity="0.85"/></linearGradient>
    <linearGradient id="side" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="0.75" stop-color="#000" stop-opacity="0"/></linearGradient>
  </defs>`);
  if (photoBase64) {
    parts.push(`<image href="data:${photoType(photoBase64)};base64,${photoBase64}" x="0" y="0" width="${SIZE}" height="${SIZE}" preserveAspectRatio="xMidYMid slice"/>`);
    parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="url(#shade)"/>`);
    parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="url(#side)"/>`);
  } else {
    parts.push(`<rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>`);
    parts.push(`<circle cx="${SIZE - 80}" cy="120" r="260" fill="#FFFFFF" fill-opacity="0.07"/>`);
    parts.push(`<circle cx="${SIZE - 40}" cy="140" r="150" fill="#FFFFFF" fill-opacity="0.06"/>`);
    parts.push(`<circle cx="60" cy="${SIZE - 60}" r="220" fill="#000000" fill-opacity="0.10"/>`);
  }

  let y = PAD;
  if (business) {
    const label = business.slice(0, 40);
    const size = 30;
    const width = textWidth(label, size, true) + 48;
    parts.push(`<rect x="${PAD}" y="${y}" width="${width}" height="58" rx="29" fill="#FFFFFF" fill-opacity="0.16"/>`);
    parts.push(`<text x="${PAD + 24}" y="${y + 39}" font-family="Inter" font-weight="600" font-size="${size}" fill="#FFFFFF">${escapeXml(label)}</text>`);
  }

  const kept = points.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 3);
  const pointBlocks = kept.map((item) => fitText(item, { maxWidth: inner - 64, maxLines: 2, start: 36, min: 28 }));
  const pointsHeight = pointBlocks.reduce((total, block) => total + block.lines.length * block.size * 1.25 + 22, 0);
  const title = fitText(headline, { maxWidth: inner, maxLines: 4, start: 92, min: 56, bold: true });
  const titleHeight = title.lines.length * title.size * 1.12;
  const bottomBlock = 120 + 60;
  const free = SIZE - PAD - bottomBlock - (business ? 58 : 0) - PAD;
  y = PAD + (business ? 58 : 0) + Math.max(40, (free - titleHeight - 50 - pointsHeight) / 2) + title.size;

  parts.push(`<rect x="${PAD}" y="${y - title.size - 26}" width="96" height="10" rx="5" fill="${colors.accent}"/>`);
  for (const line of title.lines) {
    parts.push(`<text x="${PAD}" y="${y}" font-family="Inter" font-weight="700" font-size="${title.size}" fill="#FFFFFF">${escapeXml(line)}</text>`);
    y += title.size * 1.12;
  }
  y += 34;
  for (const block of pointBlocks) {
    const first = y + block.size * 0.15;
    parts.push(`<circle cx="${PAD + 20}" cy="${first - block.size * 0.35}" r="20" fill="${colors.accent}"/>`);
    parts.push(`<path d="M${PAD + 11} ${first - block.size * 0.35} l6 7 l12 -14" stroke="${colors.from}" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
    for (const line of block.lines) {
      parts.push(`<text x="${PAD + 64}" y="${y}" font-family="Inter" font-weight="600" font-size="${block.size}" fill="#FFFFFF" fill-opacity="0.95">${escapeXml(line)}</text>`);
      y += block.size * 1.25;
    }
    y += 22;
  }

  const label = ctaLabel(cta);
  const buttonSize = 40;
  const labelWidth = textWidth(label, buttonSize, true);
  const buttonWidth = labelWidth + 160;
  const buttonY = SIZE - PAD - 104;
  const arrowX = PAD + 52 + labelWidth + 26;
  parts.push(`<rect x="${PAD}" y="${buttonY}" width="${buttonWidth}" height="104" rx="52" fill="${colors.button}"/>`);
  parts.push(`<text x="${PAD + 52}" y="${buttonY + 66}" font-family="Inter" font-weight="700" font-size="${buttonSize}" fill="${colors.buttonText}">${escapeXml(label)}</text>`);
  parts.push(`<path d="M${arrowX} ${buttonY + 52} h34 m-14 -14 l14 14 l-14 14" stroke="${colors.buttonText}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`);
  const host = hostOf(link);
  if (host) {
    parts.push(`<text x="${SIZE - PAD}" y="${buttonY + 64}" text-anchor="end" font-family="Inter" font-weight="600" font-size="30" fill="#FFFFFF" fill-opacity="0.85">${escapeXml(host)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${parts.join('')}</svg>`;
}

export function renderCreative(input) {
  const svg = creativeSvg(input);
  for (const width of [SIZE, 900, 720]) {
    const png = new Resvg(svg, {
      font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Inter' },
      fitTo: { mode: 'width', value: width }
    }).render().asPng();
    if (png.length <= MAX_BYTES) return png;
  }
  throw new Error('The designed image is too large.');
}

export function creativePoints(payload) {
  const points = [...(payload.sellingPoints || []), ...(payload.suggestion?.sellingPoints || [])];
  const unique = [...new Map(points.map((item) => [String(item).toLowerCase(), String(item)])).values()];
  if (unique.length) return unique.slice(0, 3);
  return [payload.region && payload.region !== 'India' ? payload.region.split(';')[0] : ''].filter(Boolean);
}

export function variantCreatives(payload, { photoBase64 = '', business = '' } = {}) {
  const variants = payload.variants?.length ? payload.variants : [{ headline: payload.headline }];
  return variants.slice(0, 2).map((variant, index) => renderCreative({
    headline: variant.headline,
    points: creativePoints(payload),
    cta: payload.cta,
    business: business || payload.pageName || '',
    link: payload.website || '',
    theme: index,
    photoBase64
  }));
}
