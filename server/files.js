import express, { Router } from 'express';
import { Readable } from 'node:stream';
import { ah } from './db.js';
import { FOLDER, StorageError, signedUrl, uploadFile } from './imagekit.js';

// Uploads arrive as the raw request body (content-type application/octet-stream) with the
// original name and type in headers, so a .json attachment is never parsed as JSON.
export const rawBody = (limitMb) => express.raw({ type: () => true, limit: `${limitMb}mb` });
export const fileMeta = (req) => ({
  fileName: decodeURIComponent(req.get('x-file-name') || 'file'),
  mime: req.get('x-file-type') || 'application/octet-stream',
});

// No SVG: it can contain scripts, and logos are served from this app's own address.
const LOGO_TYPES = /^image\/(png|jpe?g|gif|webp)$/;
const LOGO_MAX_MB = 1.5;

// Logos are saved in invoices as "ik:<filePath>" and shown via /api/files/logo?path=...
export const filesRouter = Router();

filesRouter.post('/logo', rawBody(LOGO_MAX_MB), ah(async (req, res) => {
  const { fileName, mime } = fileMeta(req);
  if (!LOGO_TYPES.test(mime)) return res.status(400).json({ error: 'Please choose a PNG, JPG, GIF or WEBP image.' });
  if (!req.body?.length) return res.status(400).json({ error: 'The image is empty.' });
  const file = await uploadFile(req.body, { fileName, folder: 'logos', mime });
  res.status(201).json({ ref: `ik:${file.filePath}` });
}));

// Public (no sign-in) so <img> tags, printing and PDF export can load it from this server.
// Only files in the logos folder are served; logos appear on every invoice sent out anyway.
export const logoProxy = ah(async (req, res) => {
  const path = String(req.query.path || '');
  if (!path.startsWith(`${FOLDER}/logos/`) || path.includes('..')) return res.status(404).end();
  let upstream;
  try {
    upstream = await fetch(signedUrl(path, 120));
  } catch (err) {
    if (err instanceof StorageError) return res.status(err.status).end();
    return res.status(502).end();
  }
  if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).end();
  const type = upstream.headers.get('content-type') || '';
  if (!/^image\/(png|jpe?g|gif|webp|avif)$/.test(type.split(';')[0].trim())) return res.status(415).end(); // ImageKit may convert formats
  res.set('content-type', type);
  res.set('x-content-type-options', 'nosniff');
  res.set('content-security-policy', "default-src 'none'; sandbox");
  res.set('cache-control', 'private, max-age=86400'); // paths are unique, so a logo never changes
  Readable.fromWeb(upstream.body).pipe(res);
});
