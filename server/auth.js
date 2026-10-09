import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ah, sessions, users } from './db.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ROLES = ['admin', 'manager', 'staff'];

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// Only a hash of the token is stored, so a leaked database can't be used to log in.
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

// Expired sessions are deleted by MongoDB's TTL index on expiresAt.
export async function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  await sessions.insertOne({ _id: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) });
  return token;
}

export async function destroySession(token) {
  await sessions.deleteOne({ _id: sha256(token) });
}

export async function destroyUserSessions(userId, exceptToken) {
  const filter = { userId };
  if (exceptToken) filter._id = { $ne: sha256(exceptToken) };
  await sessions.deleteMany(filter);
}

export const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, active: !!u.active, createdAt: u.createdAt });

export const requireAuth = ah(async (req, res, next) => {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.get('authorization') || '');
  if (!m) return res.status(401).json({ error: 'Please sign in.' });
  // The TTL monitor runs about once a minute, so check the expiry here too.
  const session = await sessions.findOne({ _id: sha256(m[1]), expiresAt: { $gt: new Date() } });
  const user = session && await users.findOne({ _id: session.userId });
  if (!user || !user.active) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
  req.user = publicUser(user);
  req.token = m[1];
  next();
});

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have access to this.' });

// Simple in-memory brute-force guard: 5 failed logins per email+IP per 15 minutes.
const failures = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const keyFor = (req, email) => `${req.ip}|${String(email).toLowerCase()}`;

export function loginBlocked(req, email) {
  const f = failures.get(keyFor(req, email));
  return f && f.count >= 5 && Date.now() - f.first < WINDOW_MS;
}
export function recordLoginFailure(req, email) {
  const k = keyFor(req, email);
  const f = failures.get(k);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(k, { count: 1, first: Date.now() });
  else f.count += 1;
}
export const clearLoginFailures = (req, email) => failures.delete(keyFor(req, email));
