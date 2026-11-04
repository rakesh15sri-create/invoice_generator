import './env.js';
import { MongoClient } from 'mongodb';

// MongoDB connection, configured in .env (MONGODB_URI, MONGODB_DB).
//
// Collections (ids are plain numbers from the "counters" collection, so URLs like
// #/editor/12 stay short and the frontend keeps working with numeric ids):
//   users     { _id, name, email, emailLower, passwordHash, role, active, createdAt }
//   sessions  { _id: sha256(token), userId, expiresAt }      — expired ones removed by a TTL index
//   invoices  { _id, number, template, customerName, currency, total, paid, status, statusLower,
//               docDate, data, createdBy, updatedBy, createdAt, updatedAt }
//               — summary fields are derived from "data" on every save so lists and stats stay fast
//   settings  { _id: key, value }
//   counters  { _id: name, seq }
// Withdrawal CRM (see server/crm/):
//   withdrawals { _id, ref, clientId, clientName, accountNo, amount, currency, method, rmId, rmName, note,
//                 requestedAt, status, department, statusSince, closedAt, history[], createdBy, ... }
//   clients     { _id, name, email, emailLower, phone, phoneKey, country, accountNo, rmId, rmName, notes,
//                 source, importBatch, backfilled, ... }
//   mails       { _id, ticket, clientId, clientName, clientEmail, subject, issueType, relatedIssues[], priority,
//                 mailbox, cc, status, department, replyPending, mailNo, followUps, thread[], files[], ... }
//   crm_events  { _id: seq, at, kind, action, id, by, byName, origin, text } — the live-update feed
export const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
export const MONGODB_DB = process.env.MONGODB_DB || 'invoice_generator';

export const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
export const db = client.db(MONGODB_DB);

export const users = db.collection('users');
export const sessions = db.collection('sessions');
export const invoices = db.collection('invoices');
export const settings = db.collection('settings');
export const counters = db.collection('counters');
export const withdrawals = db.collection('withdrawals');
export const clients = db.collection('clients');
export const mails = db.collection('mails');
export const crmEvents = db.collection('crm_events');

// Connects and makes sure the indexes exist. Call once at startup.
export async function connectDb() {
  try {
    await client.connect();
    await db.command({ ping: 1 });
  } catch (err) {
    const where = MONGODB_URI.replace(/\/\/[^@/]*@/, '//***@'); // never print the password
    throw new Error(
      `Cannot connect to MongoDB at ${where} (${err.message}).\n` +
      '  Make sure MongoDB is running (Windows: Services → "MongoDB Server"), or fix MONGODB_URI in the .env file.',
    );
  }
  await Promise.all([
    users.createIndex({ emailLower: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ userId: 1 }),
    invoices.createIndex({ number: 1 }, { unique: true }),
    invoices.createIndex({ template: 1 }),
    invoices.createIndex({ createdBy: 1 }),
    invoices.createIndex({ docDate: -1, _id: -1 }),
    withdrawals.createIndex({ status: 1 }),
    withdrawals.createIndex({ accountNo: 1, status: 1 }),
    withdrawals.createIndex({ requestedAt: -1 }),
    withdrawals.createIndex({ clientId: 1 }),
    clients.createIndex({ name: 1 }),
    clients.createIndex({ importBatch: 1 }),
    mails.createIndex({ status: 1 }),
    mails.createIndex({ createdAt: -1 }),
    mails.createIndex({ clientId: 1 }),
    mails.createIndex({ clientEmailLower: 1 }),
    crmEvents.createIndex({ at: 1 }, { expireAfterSeconds: 2 * 24 * 3600 }),
  ]);
}

// Next numeric id for a collection (atomic, safe with several people saving at once).
export async function nextId(name) {
  const doc = await counters.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after' });
  return doc.seq;
}

export async function getSetting(key, fallback = null) {
  const doc = await settings.findOne({ _id: key });
  return doc ? doc.value : fallback;
}

export async function setSetting(key, value) {
  await settings.updateOne({ _id: key }, { $set: { value } }, { upsert: true });
}

// Express 4 doesn't catch errors from async handlers; wrap them so errors reach the error handler.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
