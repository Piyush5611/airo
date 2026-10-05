let accessToken = null;
let supportMode = false;

export function setAccessToken(token, support = false) {
  accessToken = token;
  supportMode = support;
  if (support && token) sessionStorage.setItem('airo_support', token);
  if (!support) sessionStorage.removeItem('airo_support');
}

export function restoreSupportToken() {
  const saved = sessionStorage.getItem('airo_support');
  if (!saved) return false;
  accessToken = saved;
  supportMode = true;
  return true;
}

export function clearSupportToken() {
  sessionStorage.removeItem('airo_support');
  supportMode = false;
  accessToken = null;
}

export function currentToken() {
  return accessToken;
}

async function request(path, { method = 'GET', body } = {}, retry = false) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (response.status === 401 && !retry && !supportMode && !path.startsWith('/api/auth/')) {
    const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshed.ok) {
      const json = await refreshed.json();
      accessToken = json.data.accessToken;
      return request(path, { method, body }, true);
    }
    accessToken = null;
    window.dispatchEvent(new Event('airo:unauthorized'));
  }
  if (response.status === 204) return null;
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(json?.error?.message || 'Request failed.');
    error.status = response.status;
    throw error;
  }
  return json.data;
}

export async function download(path, filename) {
  const headers = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(path, { headers, credentials: 'include' });
  if (!response.ok) throw new Error('Export failed.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: body ?? {} }),
  patch: (path, body) => request(path, { method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path) => request(path, { method: 'DELETE' })
};
