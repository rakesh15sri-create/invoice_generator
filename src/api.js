import { storage } from './data.js';

const TOKEN_KEY = 'invgen.token';

export const getToken = () => storage.get(TOKEN_KEY, null);
export const setToken = (t) => storage.set(TOKEN_KEY, t);
export const clearToken = () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

// Small fetch wrapper: adds the session token, parses JSON, throws Error(message) on failure.
export async function api(path, { method = 'GET', body } = {}) {
  return request(path, method, body === undefined ? {} : { 'content-type': 'application/json' }, body === undefined ? undefined : JSON.stringify(body));
}

// Upload a File/Blob as the raw request body; the server stores it in ImageKit.
export function upload(path, file, name = file.name) {
  return request(path, 'POST', {
    'content-type': 'application/octet-stream',
    'x-file-name': encodeURIComponent(name || 'file'),
    'x-file-type': file.type || 'application/octet-stream',
  }, file);
}

async function request(path, method, headers, body) {
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body });
  } catch {
    throw new Error('Can’t connect right now. Check your internet connection and try again. If this keeps happening, contact your administrator.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const err = new Error(data.error || 'Something went wrong. Please try again in a moment.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Ask the server for a short-lived link to a stored file, then open it in a new tab.
// The tab is opened first (synchronously) so popup blockers allow it.
export async function openStoredFile(invoiceId, fileId) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const { url } = await api(`/invoices/${invoiceId}/files/${encodeURIComponent(fileId)}/url`);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

// Logos are saved as "ik:<path>" (stored in ImageKit) or as an inline data URL (older invoices,
// or when file storage isn't set up). This turns either into something an <img> can show.
export const fileSrc = (v) => (typeof v === 'string' && v.startsWith('ik:') ? `/api/files/logo?path=${encodeURIComponent(v.slice(3))}` : v);
