import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import {
  DEPARTMENTS, ISSUE_TYPES, MAILBOXES, MAIL_ENTRY, OUTCOMES, PRIORITIES, emailKey, isMailOpen, ordinal,
} from '../../src/crm/domain.js';
import { requireRole } from '../auth.js';
import { ah, clients, mails, nextId } from '../db.js';
import { UPLOAD_LIMIT_MB, fileMeta, rawBody } from '../files.js';
import { deleteFile, signedUrl, uploadFile } from '../imagekit.js';
import { emit } from './events.js';
import { HttpError, actor, dateRange, isAdmin, out, pad, str } from './util.js';

const MAX_FILES = 30;

// Case state that actions change. Each thread entry keeps the state from before it ("prev"),
// which is what "undo last action" restores.
const STATE_KEYS = [
  'status', 'department', 'replyPending', 'priority', 'complianceFlag', 'escalated', 'outcome', 'solution',
  'resolvedAt', 'followUps', 'lastClientAt', 'lastReplyAt',
];
const snapshot = (m) => Object.fromEntries(STATE_KEYS.map((k) => [k, m[k] ?? null]));

const fileInfo = (f) => ({ id: f.fileId, name: f.name, size: f.size, type: f.mime, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy, uploadedByName: f.uploadedByName });
// What the browser sees: no ImageKit paths, no undo snapshots.
const view = (m) => {
  const { files = [], thread = [], ...rest } = out(m);
  return { ...rest, files: files.map(fileInfo), thread: thread.map(({ prev, ...e }) => e) };
};

function readMeta(body) {
  const m = {};
  const has = (k) => body[k] !== undefined;
  if (has('clientName')) m.clientName = str(body.clientName, 120);
  if (has('clientEmail')) { m.clientEmail = str(body.clientEmail, 160); m.clientEmailLower = emailKey(m.clientEmail); }
  if (has('subject')) m.subject = str(body.subject, 200);
  if (has('issueType')) m.issueType = ISSUE_TYPES.includes(body.issueType) ? body.issueType : 'Other';
  if (has('relatedIssues')) m.relatedIssues = (Array.isArray(body.relatedIssues) ? body.relatedIssues : []).filter((t) => ISSUE_TYPES.includes(t)).slice(0, 8);
  if (has('priority')) m.priority = PRIORITIES.includes(body.priority) ? body.priority : 'Normal';
  if (has('mailbox')) m.mailbox = str(body.mailbox, 80) || MAILBOXES[0];
  if (has('cc')) m.cc = str(body.cc, 400);
  return m;
}

const find = async (id) => {
  const m = await mails.findOne({ _id: Number(id) });
  if (!m) throw new HttpError(404, 'Mail case not found. It may have been deleted.');
  return m;
};

// What each action does to the case. Returns the fields to set and the thread entry.
function applyAction(m, a, req) {
  const now = new Date();
  const text = str(a.text, 5000);
  const entry = { id: randomBytes(6).toString('hex'), at: now, ...actor(req), type: a.type, text, prev: snapshot(m) };
  const set = {};
  switch (a.type) {
    case 'reply':
      Object.assign(set, { replyPending: false, lastReplyAt: now });
      if (m.status === 'waiting') set.status = 'open';
      break;
    case 'client': // the client wrote again: a follow-up; reopens a resolved case
      Object.assign(set, { replyPending: true, lastClientAt: now, followUps: (m.followUps || 0) + 1 });
      if (m.status === 'resolved' || m.status === 'waiting') Object.assign(set, { status: 'open', resolvedAt: null, outcome: '', solution: '' });
      entry.mailNo = (m.mailNo || 1) + (m.followUps || 0) + 1;
      break;
    case 'forward':
    case 'escalate': {
      const dept = DEPARTMENTS.includes(a.department) ? a.department : null;
      if (a.type === 'forward' && !dept) throw new HttpError(400, 'Choose the department to send the case to.');
      if (!isMailOpen(m.status)) throw new HttpError(400, 'This case is resolved. Use "Client wrote again" to reopen it.');
      Object.assign(set, { status: a.type === 'escalate' ? 'escalated' : 'with_dept', department: dept || m.department });
      if (a.type === 'escalate') Object.assign(set, { escalated: true, priority: m.priority === 'Urgent' ? 'Urgent' : 'High' });
      entry.department = set.department;
      break;
    }
    case 'note':
      if (!text) throw new HttpError(400, 'Write the note first.');
      break;
    case 'resolve': {
      if (!isMailOpen(m.status)) throw new HttpError(400, 'This case is already resolved.');
      const outcome = OUTCOMES.includes(a.outcome) ? a.outcome : null;
      if (!outcome) throw new HttpError(400, 'Choose an outcome.');
      const solution = str(a.solution, 5000);
      if (!solution) throw new HttpError(400, 'Describe the solution, so the next person knows what was done.');
      Object.assign(set, { status: 'resolved', replyPending: false, resolvedAt: now, outcome, solution });
      Object.assign(entry, { outcome, text: solution });
      break;
    }
    case 'waiting':
      if (!isMailOpen(m.status)) throw new HttpError(400, 'This case is resolved.');
      Object.assign(set, { status: 'waiting', replyPending: false });
      break;
    case 'compliance':
      set.complianceFlag = !m.complianceFlag;
      entry.flag = set.complianceFlag;
      break;
    default:
      throw new HttpError(400, 'Unknown action.');
  }
  return { set: { ...set, updatedAt: now, updatedBy: req.user.id }, entry };
}

const ACTION_TEXT = {
  reply: 'replied on', client: 'logged a follow-up on', forward: 'sent', escalate: 'escalated', note: 'added a note to',
  resolve: 'resolved', waiting: 'set to waiting', compliance: 'flagged',
};

async function runAction(req, res, a) {
  const m = await find(req.params.id);
  const { set, entry } = applyAction(m, a, req);
  // Only apply if nobody else changed the case meanwhile.
  const updated = await mails.findOneAndUpdate(
    { _id: m._id, updatedAt: m.updatedAt },
    { $set: set, $push: { thread: entry } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(409, 'Someone else just updated this case. It has been refreshed, please try again.');
  const to = entry.department ? ` to ${entry.department}` : '';
  await emit(req, 'mail', 'upsert', m._id, `${req.user.name} ${ACTION_TEXT[a.type]} ${m.ticket}${to} · ${m.clientName}`);
  res.json(view(updated));
}

export const mailsRouter = Router();

// Default: every open case plus anything logged in the last 60 days.
mailsRouter.get('/', ah(async (req, res) => {
  const range = dateRange(req.query.from, req.query.to);
  const filter = range
    ? { createdAt: range }
    : { $or: [{ status: { $ne: 'resolved' } }, { createdAt: { $gte: new Date(Date.now() - 60 * 864e5) } }] };
  const rows = await mails.find(filter, { projection: { 'thread.prev': 0 } }).sort({ createdAt: -1 }).limit(3000).toArray();
  res.json(rows.map(view));
}));

mailsRouter.get('/client/:clientId', ah(async (req, res) => {
  const rows = await mails.find({ clientId: Number(req.params.clientId) }, { projection: { 'thread.prev': 0 } }).sort({ createdAt: -1 }).limit(500).toArray();
  res.json(rows.map(view));
}));

mailsRouter.get('/:id', ah(async (req, res) => res.json(view(await find(req.params.id)))));

mailsRouter.post('/', ah(async (req, res) => {
  const body = req.body || {};
  const meta = readMeta({ issueType: 'Other', relatedIssues: [], priority: 'Normal', mailbox: MAILBOXES[0], cc: '', clientEmail: '', ...body });
  let clientId = body.clientId ? Number(body.clientId) : null;
  if (clientId) {
    const c = await clients.findOne({ _id: clientId });
    if (!c) throw new HttpError(400, 'That client no longer exists.');
    meta.clientName ||= c.name;
    if (!meta.clientEmail && c.email) Object.assign(meta, { clientEmail: c.email, clientEmailLower: emailKey(c.email) });
  } else clientId = null;
  if (!meta.clientName) throw new HttpError(400, 'Client name is required.');
  if (!meta.subject) throw new HttpError(400, 'Subject is required.');

  // Mail counting: this is the client's Nth mail case.
  const sameClient = clientId ? { clientId } : meta.clientEmailLower ? { clientEmailLower: meta.clientEmailLower } : { clientName: meta.clientName };
  const before = await mails.countDocuments(sameClient);
  const dept = DEPARTMENTS.includes(body.department) ? body.department : 'Support';
  const now = new Date();
  const seq = await nextId('mails');
  const row = {
    _id: seq, ticket: `ML-${now.getFullYear()}-${pad(seq)}`, clientId, ...meta,
    status: 'open', department: dept, replyPending: true, complianceFlag: false, escalated: false,
    outcome: '', solution: '', resolvedAt: null, mailNo: before + 1, followUps: 0,
    receivedAt: new Date(body.receivedAt || now), lastClientAt: now, lastReplyAt: null,
    thread: [{ id: randomBytes(6).toString('hex'), at: now, ...actor(req), type: 'logged', text: str(body.text, 10000), mailNo: before + 1 }],
    files: [], createdBy: req.user.id, createdAt: now, updatedBy: req.user.id, updatedAt: now,
  };
  if (Number.isNaN(row.receivedAt.getTime())) row.receivedAt = now;
  await mails.insertOne(row);
  await emit(req, 'mail', 'upsert', row._id, `${req.user.name} logged ${row.ticket} (${ordinal(row.mailNo)} mail) · ${row.clientName}`);
  res.status(201).json(view(row));
}));

mailsRouter.put('/:id', ah(async (req, res) => {
  const m = await find(req.params.id);
  const meta = readMeta(req.body || {});
  if ('subject' in meta && !meta.subject) throw new HttpError(400, 'Subject is required.');
  if ('clientName' in meta && !meta.clientName) throw new HttpError(400, 'Client name is required.');
  const updated = await mails.findOneAndUpdate(
    { _id: m._id },
    { $set: { ...meta, updatedAt: new Date(), updatedBy: req.user.id } },
    { returnDocument: 'after' },
  );
  await emit(req, 'mail', 'upsert', m._id, `${req.user.name} edited ${m.ticket} · ${updated.clientName}`);
  res.json(view(updated));
}));

mailsRouter.post('/:id/action', ah(async (req, res) => runAction(req, res, req.body || {})));
mailsRouter.post('/:id/followup', ah(async (req, res) => runAction(req, res, { ...(req.body || {}), type: 'client' })));

// Undo the most recent action (not the logged mail itself).
mailsRouter.post('/:id/undo', ah(async (req, res) => {
  const m = await find(req.params.id);
  const last = m.thread[m.thread.length - 1];
  if (!last || last.type === 'logged' || !last.prev) throw new HttpError(400, 'There is nothing to undo on this case.');
  const updated = await mails.findOneAndUpdate(
    { _id: m._id, updatedAt: m.updatedAt },
    { $set: { ...last.prev, updatedAt: new Date(), updatedBy: req.user.id }, $pop: { thread: 1 } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(409, 'Someone else just updated this case. It has been refreshed, please try again.');
  await emit(req, 'mail', 'upsert', m._id, `${req.user.name} undid "${MAIL_ENTRY[last.type]}" on ${m.ticket}`);
  res.json(view(updated));
}));

mailsRouter.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  const m = await mails.findOneAndDelete({ _id: Number(req.params.id) });
  if (!m) throw new HttpError(404, 'Mail case not found.');
  await emit(req, 'mail', 'remove', m._id, `${req.user.name} deleted ${m.ticket} · ${m.clientName}`);
  res.status(204).end();
  for (const f of m.files || []) deleteFile(f.fileId);
}));

// ---------- files (ImageKit, private; one folder per ticket) ----------
mailsRouter.post('/:id/files', rawBody(UPLOAD_LIMIT_MB), ah(async (req, res) => {
  const m = await find(req.params.id);
  if ((m.files?.length || 0) >= MAX_FILES) throw new HttpError(400, `A case can have up to ${MAX_FILES} files. Remove one first.`);
  if (!req.body?.length) throw new HttpError(400, 'The file is empty.');
  const { fileName, mime } = fileMeta(req);
  const file = await uploadFile(req.body, { fileName, folder: `mails/${m.ticket}`, mime });
  const f = {
    fileId: file.fileId, name: fileName, filePath: file.filePath, size: file.size, mime,
    uploadedAt: new Date(), uploadedBy: req.user.id, uploadedByName: req.user.name,
  };
  await mails.updateOne({ _id: m._id }, { $push: { files: f }, $set: { updatedAt: new Date() } });
  await emit(req, 'mail', 'upsert', m._id, '');
  res.status(201).json(fileInfo(f));
}));

mailsRouter.get('/:id/files/:fileId/url', ah(async (req, res) => {
  const m = await find(req.params.id);
  const f = m.files?.find((x) => x.fileId === req.params.fileId);
  if (!f) throw new HttpError(404, 'File not found. It may have been removed.');
  res.json({ url: signedUrl(f.filePath, 600), name: f.name });
}));

mailsRouter.delete('/:id/files/:fileId', ah(async (req, res) => {
  const m = await find(req.params.id);
  const f = m.files?.find((x) => x.fileId === req.params.fileId);
  if (!f) throw new HttpError(404, 'File not found.');
  if (!isAdmin(req) && f.uploadedBy !== req.user.id) throw new HttpError(403, 'Only the person who uploaded this file, or an admin, can remove it.');
  await mails.updateOne({ _id: m._id }, { $pull: { files: { fileId: f.fileId } }, $set: { updatedAt: new Date() } });
  await deleteFile(f.fileId);
  await emit(req, 'mail', 'upsert', m._id, '');
  res.status(204).end();
}));
