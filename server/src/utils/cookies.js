export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const item = part.trim();
    const index = item.indexOf('=');
    if (index === -1) continue;
    const key = decodeURIComponent(item.slice(0, index));
    if (key === name) return decodeURIComponent(item.slice(index + 1));
  }
  return null;
}

export function setRefreshCookie(res, token) {
  res.cookie('airo_refresh', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 14 * 24 * 60 * 60 * 1000,
    path: '/api/auth'
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie('airo_refresh', { path: '/api/auth' });
}
