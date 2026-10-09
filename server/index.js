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
import { StorageError, storageEnabled } from './imagekit.js';
import { openBrowser } from './open-browser.js';
import { invoicesRouter } from './invoices.js';
import { statsRouter } from './stats.js';
import { usersRouter, validateUserInput } from './users.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' })); // logos are stored inline as data URLs

// Until the database is reachable, API calls get a plain "try again" message. The technical
// reason is printed in the server window only. The server keeps retrying (connectWithRetry below).
let dbProblem = 'Starting up…';
app.use('/api', (req, res, next) => {
  if (!dbProblem) return next();
  res.status(503).json({ error: 'The app is temporarily unavailable. Please try again in a few minutes. If this keeps happening, contact your administrator.' });
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

app.get('/api/files/logo', logoProxy); // public: see files.js

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

// ---------- production: serve the built React app ----------
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}

const RETRY_MS = 15000;
async function connectWithRetry(attempt = 1) {
  try {
    await connectDb();
    dbProblem = null;
    console.log(`  ✔ Connected to MongoDB${attempt > 1 ? ` (after ${attempt} attempts)` : ''}.`);
  } catch (err) {
    // Atlas answers an IP that isn't on its Network Access list with this TLS alert.
    const ipBlocked = /alert number 80|TLSV1_ALERT_INTERNAL_ERROR/i.test(err.message);
    dbProblem = ipBlocked
      ? 'MongoDB Atlas is refusing this computer — add its IP address under Atlas → Security → Network Access'
      : 'Check that MongoDB is running and that MONGODB_URI in the .env file is correct';
    if (attempt === 1 || attempt % 20 === 0) {
      console.error(`\n  ${err.message.split('\n')[0]}`);
      console.error(`  → ${dbProblem}.\n  Retrying every ${RETRY_MS / 1000} seconds; the app connects by itself once this is fixed.\n`);
    }
    setTimeout(() => connectWithRetry(attempt + 1), RETRY_MS);
  }
}
connectWithRetry();

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  if (process.env.OPEN_BROWSER) {
    console.log(`\n  ✔ Invoice Generator is running at ${url}\n    Your browser should open automatically.`);
    console.log('    Keep this window open while you use the app. Close it to stop the app.\n');
    openBrowser(url);
  } else {
    console.log(`Invoice API listening on ${url}`);
  }
  if (!storageEnabled()) {
    console.log('  Note: file storage (ImageKit) is off — add IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT to .env to store PDFs and attachments.\n');
  }
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already used by another program.`);
    console.error('  Close that program, or use another port: set PORT=3002 in the .env file and start again.\n');
    process.exit(1);
  }
  throw err;
});
