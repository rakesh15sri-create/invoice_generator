import './env.js';
import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clearLoginFailures, createSession, destroySession, destroyUserSessions, hashPassword, loginBlocked,
  publicUser, recordLoginFailure, requireAuth, requireRole, verifyPassword,
} from './auth.js';
import { ah, connectDb, getSetting, invoices, nextId, setSetting, users } from './db.js';
import { filesRouter, logoProxy } from './files.js';
import { StorageError } from './imagekit.js';
import { invoicesRouter } from './invoices.js';
import { statsRouter } from './stats.js';
import { usersRouter, validateUserInput } from './users.js';

// The Express app. Started as a normal server by server/index.js, or run by Vercel as a
// serverless function through api/index.js.
export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Vercel/Render's proxy: req.ip is the visitor, not the proxy
app.use(express.json({ limit: '5mb' })); // logos are stored inline as data URLs

app.get('/api/files/logo', logoProxy); // public, doesn't need the database: see files.js

// ---------- database ----------
// Connects on the first API request and reuses the connection afterwards. If it fails, the
// visitor gets a plain "try again" message, the technical reason goes to the server log, and
// the next request tries again — so the app recovers by itself once the problem is fixed.
let connecting = null;
let lastLogged = 0;
export function explainDbError(err) {
  // Atlas answers an IP that isn't on its Network Access list with this TLS alert.
  return /alert number 80|TLSV1_ALERT_INTERNAL_ERROR/i.test(err.message)
    ? 'MongoDB Atlas is refusing this server — add its IP address (or 0.0.0.0/0 for hosts like Vercel) under Atlas → Security → Network Access'
    : 'Check that MongoDB is running and that MONGODB_URI is correct';
}
export const ensureDb = () => (connecting ??= connectDb().catch((err) => { connecting = null; throw err; }));

app.use('/api', async (req, res, next) => {
  try {
    await ensureDb();
    next();
  } catch (err) {
    if (Date.now() - lastLogged > 60000) { // don't flood the log
      lastLogged = Date.now();
      console.error(`  ${err.message.split('\n')[0]}\n  → ${explainDbError(err)}.`);
    }
    res.status(503).json({ error: 'The app is temporarily unavailable. Please try again in a few minutes. If this keeps happening, contact your administrator.' });
  }
});

// ---------- auth ----------
const userCount = () => users.countDocuments();

app.get('/api/auth/status', ah(async (req, res) => res.json({ needsSetup: (await userCount()) === 0 })));

// First run only: the first account becomes the admin.
app.post('/api/auth/setup', ah(async (req, res) => {
  if (await userCount() > 0) return res.status(409).json({ error: 'Setup is already complete. Please sign in.' });
  const { name, email, password } = req.body || {};
  const err = validateUserInput({ name, email, password, role: 'admin' });
  if (err) return res.status(400).json({ error: err });
  const user = {
    _id: await nextId('users'),
    name: String(name).trim(),
    email: String(email).trim(),
    emailLower: String(email).trim().toLowerCase(),
    passwordHash: hashPassword(password),
    role: 'admin',
    active: true,
    createdAt: new Date(),
  };
  await users.insertOne(user);
  res.status(201).json({ token: await createSession(user._id), user: publicUser(user) });
}));

app.post('/api/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (loginBlocked(req, email)) return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
  const user = await users.findOne({ emailLower: String(email || '').trim().toLowerCase() });
  if (!user || !verifyPassword(String(password || ''), user.passwordHash)) {
    recordLoginFailure(req, email);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  if (!user.active) return res.status(403).json({ error: 'Your access has been disabled. Contact your admin.' });
  clearLoginFailures(req, email);
  res.json({ token: await createSession(user._id), user: publicUser(user) });
}));

app.use('/api', requireAuth);

app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

app.post('/api/auth/logout', ah(async (req, res) => {
  await destroySession(req.token);
  res.status(204).end();
}));

app.put('/api/auth/password', ah(async (req, res) => {
  const { current, next } = req.body || {};
  const row = await users.findOne({ _id: req.user.id }, { projection: { passwordHash: 1 } });
  if (!verifyPassword(String(current || ''), row.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  if (String(next || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  await users.updateOne({ _id: req.user.id }, { $set: { passwordHash: hashPassword(next) } });
  await destroyUserSessions(req.user.id, req.token); // sign out other devices
  res.status(204).end();
}));

// ---------- company defaults (shared by the team for new invoices) ----------
app.get('/api/settings/company', ah(async (req, res) => res.json({ company: await getSetting('company', null) })));
app.put('/api/settings/company', requireRole('admin'), ah(async (req, res) => {
  const company = req.body?.company;
  if (!company || typeof company !== 'object') return res.status(400).json({ error: 'Company details are missing.' });
  await setSetting('company', company);
  res.json({ company });
}));

// Drives the admin's "Getting started" checklist.
app.get('/api/setup-status', requireRole('admin'), ah(async (req, res) => {
  const [company, invoiceCount, memberCount] = await Promise.all([
    getSetting('company', null), invoices.countDocuments(), userCount(),
  ]);
  res.json({ hasCompany: !!company, invoiceCount, memberCount });
}));

// ---------- data ----------
app.use('/api/files', filesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/stats', requireRole('admin', 'manager'), statsRouter);
app.use('/api/users', requireRole('admin'), usersRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.code === 11000) { // MongoDB duplicate key
    if (err.keyPattern?.number) {
      return res.status(409).json({ error: 'Another invoice already uses this number. Change the invoice number and save again.' });
    }
    if (err.keyPattern?.emailLower) return res.status(409).json({ error: 'A user with this email already exists.' });
  }
  if (err instanceof StorageError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.too.large') {
    const mb = Math.round((err.limit / 1024 / 1024) * 10) / 10;
    return res.status(413).json({
      error: req.get('content-type') === 'application/octet-stream'
        ? `That file is too large. The limit is ${mb} MB.`
        : 'Invoice is too large (try a smaller logo).',
    });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again in a moment.' });
});

// ---------- production on a normal server: serve the built React app ----------
// (On Vercel the pages are served by Vercel itself and dist/ isn't part of the function.)
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}
