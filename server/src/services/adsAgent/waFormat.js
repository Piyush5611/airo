export const LINE = '━━━━━━━━━━━━━━━━';

const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ' };

export function money(amount, currency) {
  const value = Number(amount);
  const text = Number.isFinite(value) ? value.toLocaleString('en-IN') : String(amount || '');
  const symbol = SYMBOLS[String(currency || '').toUpperCase()];
  if (symbol) return `${symbol}${text}`;
  return currency ? `${text} ${currency}` : text;
}

export function header(title, note = '') {
  return [`*${title}*`, note ? `_${note}_` : '', LINE].filter(Boolean).join('\n');
}

export function section(label, body) {
  const content = Array.isArray(body) ? body.filter(Boolean).join('\n') : String(body || '').trim();
  return content ? `*${label}*\n${content}` : '';
}

export function bullets(items) {
  return items.filter(Boolean).map((item) => `• ${item}`).join('\n');
}

export function numbered(items) {
  return items.filter(Boolean).map((item, index) => `${index + 1}. ${item}`).join('\n');
}

export function field(label, value) {
  return value == null || value === '' ? '' : `• ${label}: *${value}*`;
}

export function options(pairs) {
  return pairs.filter(Boolean).map(([reply, meaning]) => `> *${reply}*  →  ${meaning}`).join('\n');
}

export function hint(text) {
  return text ? `_${text}_` : '';
}

export function card(parts) {
  return parts.filter(Boolean).join('\n\n');
}

export function step(number, total, label, question, example = '') {
  return card([`*Step ${number}/${total} · ${label}*`, question, example ? hint(example) : '']);
}
