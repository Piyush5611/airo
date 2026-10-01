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

export function when(value) {
  if (!value) return '—';
  const text = String(value).replace(' ', 'T');
  const date = new Date(text.endsWith('Z') ? text : `${text}Z`);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

export function day(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(value));
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
