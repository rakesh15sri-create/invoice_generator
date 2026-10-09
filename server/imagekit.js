import './env.js';
import { createHmac } from 'node:crypto';

// ImageKit file storage, configured in .env. Every file is uploaded as *private*: it can only be
// opened through a short-lived signed URL that this server creates for a signed-in user.
const PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY || '';
const URL_ENDPOINT = (process.env.IMAGEKIT_URL_ENDPOINT || '').replace(/\/+$/, '');
export const FOLDER = '/' + (process.env.IMAGEKIT_FOLDER || 'invoice-generator').replace(/^\/+|\/+$/g, '');

export const storageEnabled = () => !!(PRIVATE_KEY && URL_ENDPOINT);

// message = what the user sees; the technical reason (adminDetail) is only printed in the server window.
export class StorageError extends Error {
  constructor(message, status = 502, adminDetail = '') {
    super(message);
    this.status = status;
    if (adminDetail) console.error(`  File storage (ImageKit): ${adminDetail}`);
  }
}

const NOT_SET_UP = 'File uploads aren’t available yet. Please ask your administrator to turn them on.';
const UPLOAD_FAILED = 'The file couldn’t be uploaded right now. Please try again in a few minutes.';
const auth = () => 'Basic ' + Buffer.from(PRIVATE_KEY + ':').toString('base64');

// Keep names readable but safe in URLs: "Contract (final).pdf" → "Contract_final_.pdf"
export const safeName = (name, fallback = 'file') =>
  String(name || fallback).normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(-100) || fallback;

// Upload a file (Buffer) into a sub-folder of FOLDER. Returns ImageKit's file record
// ({ fileId, name, filePath, size, ... }).
export async function uploadFile(buffer, { fileName, folder, mime = 'application/octet-stream' }) {
  if (!storageEnabled()) throw new StorageError(NOT_SET_UP, 503, 'not set up — add IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT to .env and restart.');
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime }), safeName(fileName));
  form.append('fileName', safeName(fileName));
  form.append('folder', `${FOLDER}/${folder}`);
  form.append('isPrivateFile', 'true');
  form.append('useUniqueFileName', 'true');
  let res;
  try {
    res = await fetch('https://upload.imagekit.io/api/v1/files/upload', { method: 'POST', headers: { authorization: auth() }, body: form });
  } catch (err) {
    throw new StorageError(UPLOAD_FAILED, 502, `could not reach upload.imagekit.io (${err.cause?.code || err.message}).`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new StorageError(UPLOAD_FAILED, 502, 'ImageKit rejected the private key — check IMAGEKIT_PRIVATE_KEY in .env.');
    }
    throw new StorageError(UPLOAD_FAILED, 502, `upload failed (${res.status}): ${body.message || 'no details'}`);
  }
  return body;
}

// Best effort: a file that is already gone is not an error.
export async function deleteFile(fileId) {
  if (!storageEnabled() || !fileId) return;
  try {
    const res = await fetch(`https://api.imagekit.io/v1/files/${encodeURIComponent(fileId)}`, { method: 'DELETE', headers: { authorization: auth() } });
    if (!res.ok && res.status !== 404) console.warn(`ImageKit: could not delete file ${fileId} (${res.status})`);
  } catch (err) {
    console.warn(`ImageKit: could not delete file ${fileId} (${err.message})`);
  }
}

// Signed URL for a private file: HMAC-SHA1(private key, <path after endpoint> + <expiry>),
// passed as ?ik-t=<expiry>&ik-s=<signature>. Same scheme as ImageKit's official SDKs.
export function signedUrl(filePath, expireSeconds = 600) {
  if (!storageEnabled()) throw new StorageError(NOT_SET_UP, 503, 'not set up — cannot open stored files.');
  const url = new URL(URL_ENDPOINT + '/' + String(filePath).replace(/^\/+/, ''));
  const expiry = Math.floor(Date.now() / 1000) + expireSeconds;
  const toSign = url.href.replace(URL_ENDPOINT + '/', '') + expiry;
  url.searchParams.append('ik-t', String(expiry));
  url.searchParams.append('ik-s', createHmac('sha1', PRIVATE_KEY).update(toSign).digest('hex'));
  return url.href;
}
