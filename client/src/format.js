export function inr(value) {
  const amount = Number(value || 0);
  if (Math.abs(amount) >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (Math.abs(amount) >= 100000) return `₹${(amount / 100000).toFixed(1)} L`;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

export function num(value) {
  return new Intl.NumberFormat('en-IN').format(Number(value || 0));
}

export function ago(value) {
  if (!value) return '';
  const text = String(value).replace(' ', 'T');
  const date = new Date(text.endsWith('Z') ? text : `${text}Z`);
  const mins = Math.round((Date.now() - date.getTime()) / 60000);
  if (Number.isNaN(mins)) return when(value);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return when(value);
}

const IST_PARTS = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

export function indianDate(date, withTime = true) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '—';
  const part = Object.fromEntries(IST_PARTS.formatToParts(date).map((item) => [item.type, item.value]));
  const text = `${part.day} ${part.month === 'Sept' ? 'Sep' : part.month} ${part.year}`;
  return withTime ? `${text}, ${part.hour}:${part.minute} ${String(part.dayPeriod || '').toUpperCase()}` : text;
}

function parseUtc(value) {
  if (value instanceof Date) return value;
  const text = String(value).replace(' ', 'T');
  return new Date(/Z$|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
}

export function parseIst(value) {
  if (value instanceof Date) return value;
  const text = String(value).trim().replace(' ', 'T');
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(text)) return new Date(text);
  return new Date(/T/.test(text) ? `${text}+05:30` : `${text}T00:00:00+05:30`);
}

export function when(value) {
  if (!value) return '—';
  return indianDate(parseUtc(value));
}

export function istWhen(value) {
  if (!value) return '—';
  return indianDate(parseIst(value));
}

export function day(value) {
  if (!value) return '—';
  const text = String(value);
  return indianDate(/^\d{4}-\d{2}-\d{2}$/.test(text) ? parseIst(text) : parseUtc(text), false);
}

export function label(value) {
  return String(value || '').replaceAll('_', ' ');
}

const ACTIONS = {
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'support.access_opened': 'Opened support access'
};

export function happened(action) {
  return ACTIONS[action] || label(action);
}

export function minutes(seconds) {
  const total = Number(seconds || 0);
  const mins = Math.floor(total / 60);
  const rest = total % 60;
  return `${mins}m ${rest}s`;
}
