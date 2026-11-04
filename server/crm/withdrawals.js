import { Router } from 'express';
import {
  CLOSED_STATUSES, CURRENCIES, LARGE_AMOUNT, METHODS, STATUS_BY_ID, emailKey, isOpen, needsComment, nextStatus, ownerDept,
  statusLabel, statusPath,
} from '../../src/crm/domain.js';
import { requireRole } from '../auth.js';
import { ah, clients, nextId, nextIds, withdrawals } from '../db.js';
import { emit } from './events.js';
import { HttpError, actor, dateRange, out, pad, personName, str, toDate } from './util.js';

// Request fields people can edit. Status changes go through the workflow below.
const FIELD_LABEL = {
  clientName: 'Client', accountNo: 'Account', amount: 'Amount', currency: 'Currency', method: 'Method',
  rmName: 'RM', note: 'Note', requestedAt: 'Request date',
};

async function readFields(body, current = {}) {
  const f = {};
  const has = (k) => body[k] !== undefined;
  if (has('clientName')) f.clientName = str(body.clientName, 120);
  if (has('accountNo')) f.accountNo = str(body.accountNo, 40);
  if (has('clientId')) {
    f.clientId = body.clientId === '' || body.clientId == null ? null : Number(body.clientId);
    if (f.clientId != null) {
      // Linked to a client record: fill in what was left empty.
      const c = await clients.findOne({ _id: f.clientId });
      if (!c) throw new HttpError(400, 'That client no longer exists. Pick another client.');
      if (!f.clientName) f.clientName = c.name;
      if (!f.accountNo && c.accountNo) f.accountNo = c.accountNo;
    }
  }
  if (has('amount')) {
    const n = Math.round(Number(body.amount) * 100) / 100;
    if (!(n > 0) || n > 1e12) throw new HttpError(400, 'Enter an amount greater than 0.');
    f.amount = n;
  }
  if (has('currency')) f.currency = CURRENCIES.includes(body.currency) ? body.currency : 'USD';
  if (has('method')) f.method = METHODS.includes(body.method) ? body.method : 'Other';
  if (has('rmId')) {
    f.rmId = body.rmId === '' || body.rmId == null ? null : Number(body.rmId);
    f.rmName = f.rmId == null ? '' : await personName(f.rmId);
    if (f.rmId != null && f.rmName == null) throw new HttpError(400, 'That RM is not on the team any more.');
  }
  if (has('note')) f.note = str(body.note, 2000);
  if (has('requestedAt')) f.requestedAt = toDate(body.requestedAt, current.requestedAt || new Date());
  return f;
}

// Rule: an account can have only one open request.
async function assertOneOpen(accountNo, exceptId) {
  if (!accountNo) return;
  const other = await withdrawals.findOne(
    { accountNo, status: { $nin: CLOSED_STATUSES }, ...(exceptId != null && { _id: { $ne: exceptId } }) },
    { projection: { ref: 1, status: 1 } },
  );
  if (other) {
    throw new HttpError(409, `Account ${accountNo} already has an open request (${other.ref}, ${statusLabel(other.status)}). Finish or reject it first.`);
  }
}

// Rule: amounts of 100k or more must be confirmed by the person entering them.
function assertLargeConfirmed(amount, body) {
  if (amount >= LARGE_AMOUNT && !body.confirmLarge) {
    throw new HttpError(409, `This request is for ${amount.toLocaleString('en-US')}. Please confirm the amount.`, { needsConfirm: true });
  }
}

function statusChange(row, to, comment, req, type = 'status') {
  if (!STATUS_BY_ID[to]) throw new HttpError(400, 'Unknown status.');
  if (to === row.status) throw new HttpError(400, `The request is already ${statusLabel(to)}.`);
  if (type === 'status' && needsComment(to) && !comment) throw new HttpError(400, `Add a comment to explain why it is ${statusLabel(to)}.`);
  const now = new Date();
  return {
    set: {
      status: to, department: ownerDept(to), statusSince: now, closedAt: isOpen(to) ? null : now,
      updatedAt: now, updatedBy: req.user.id,
    },
    entry: { at: now, ...actor(req), type, from: row.status, to, comment },
  };
}

// Applies the update only if nobody changed the status in the meantime.
async function save(row, set, entries) {
  const updated = await withdrawals.findOneAndUpdate(
    { _id: row._id, status: row.status },
    { $set: set, $push: { history: { $each: entries } } },
    { returnDocument: 'after' },
  );
  if (!updated) throw new HttpError(409, 'Someone else just changed this request. The board has been refreshed, please try again.');
  return updated;
}

const find = async (id) => {
  const row = await withdrawals.findOne({ _id: Number(id) });
  if (!row) throw new HttpError(404, 'Request not found. It may have been deleted.');
  return row;
};

export const withdrawalsRouter = Router();

// Default: every open request plus anything requested in the last 7 days.
withdrawalsRouter.get('/', ah(async (req, res) => {
  const range = dateRange(req.query.from, req.query.to);
  const filter = range
    ? { requestedAt: range }
    : { $or: [{ status: { $nin: CLOSED_STATUSES } }, { requestedAt: { $gte: new Date(Date.now() - 7 * 864e5) } }] };
  const rows = await withdrawals.find(filter).sort({ requestedAt: -1 }).limit(3000).toArray();
  res.json(rows.map(out));
}));

// Every request of one client (client detail page).
withdrawalsRouter.get('/client/:clientId', ah(async (req, res) => {
  const rows = await withdrawals.find({ clientId: Number(req.params.clientId) }).sort({ requestedAt: -1 }).limit(500).toArray();
  res.json(rows.map(out));
}));

withdrawalsRouter.get('/:id', ah(async (req, res) => res.json(out(await find(req.params.id)))));

withdrawalsRouter.post('/', ah(async (req, res) => {
  const body = req.body || {};
  const f = await readFields({ currency: 'USD', method: 'Bank wire', ...body, amount: body.amount ?? 0 });
  if (!f.clientName) throw new HttpError(400, 'Client name is required.');
  if (!f.accountNo) throw new HttpError(400, 'Account number is required.');
  assertLargeConfirmed(f.amount, body);
  await assertOneOpen(f.accountNo);
  const now = new Date();
  const seq = await nextId('withdrawals');
  const row = {
    _id: seq,
    ref: `WD-${now.getFullYear()}-${pad(seq)}`,
    clientId: null, rmId: null, rmName: '', note: '', ...f,
    requestedAt: f.requestedAt || now,
    status: 'received', department: ownerDept('received'), statusSince: now, closedAt: null,
    history: [{ at: now, ...actor(req), type: 'created', to: 'received', comment: f.note || '' }],
    createdBy: req.user.id, createdAt: now, updatedBy: req.user.id, updatedAt: now,
  };
  await withdrawals.insertOne(row);
  await emit(req, 'withdrawal', 'upsert', row._id, `${req.user.name} added ${row.ref} · ${row.clientName}`);
  res.status(201).json(out(row));
}));

// Bulk import from the trading CRM's transactions export (the app reads the file and sends the rows).
// Every imported request starts as Pending. The usual rules still apply: one open request per account
// and confirmation for large amounts. ref (the export's transaction id) is stored so a transaction
// is never imported twice. Rows linked to a client by e-mail when one matches.
const IMPORT_MAX = 2000;
const IMPORT_STATUS = 'pending';
withdrawalsRouter.post('/import', ah(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows?.length) throw new HttpError(400, 'There are no requests to import.');
  if (rows.length > IMPORT_MAX) throw new HttpError(400, `Import up to ${IMPORT_MAX} requests at a time. Split the file and try again.`);
  const confirmLarge = !!req.body.confirmLarge;

  const items = rows.map((r) => ({
    ref: str(r?.ref, 60) || null,
    clientName: str(r?.clientName, 120),
    emailLower: emailKey(r?.email),
    accountNo: str(r?.accountNo, 40),
    amount: Math.round(Number(r?.amount) * 100) / 100,
    currency: CURRENCIES.includes(r?.currency) ? r.currency : 'USD',
    method: METHODS.includes(r?.method) ? r.method : 'Other',
    requestedAt: toDate(r?.requestedAt, null),
    note: str(r?.note, 2000),
  }));
  const refs = items.map((i) => i.ref).filter(Boolean);
  const accounts = [...new Set(items.map((i) => i.accountNo).filter(Boolean))];
  const emails = [...new Set(items.map((i) => i.emailLower).filter(Boolean))];
  const [done, open, linked] = await Promise.all([
    withdrawals.find({ importRef: { $in: refs } }, { projection: { importRef: 1 } }).toArray(),
    withdrawals.find({ accountNo: { $in: accounts }, status: { $nin: CLOSED_STATUSES } }, { projection: { accountNo: 1, ref: 1 } }).toArray(),
    clients.find({ emailLower: { $in: emails } }, { projection: { emailLower: 1 } }).toArray(),
  ]);
  const seenRefs = new Set(done.map((w) => w.importRef));
  const openBy = new Map(open.map((w) => [w.accountNo, w.ref]));
  const clientBy = new Map(linked.map((c) => [c.emailLower, c._id]));

  const skipped = [];
  const accepted = [];
  for (const i of items) {
    const skip = (reason) => skipped.push({ ref: i.ref, clientName: i.clientName, reason });
    if (i.ref && seenRefs.has(i.ref)) { skip('Already imported'); continue; }
    if (!i.clientName) { skip('No client name'); continue; }
    if (!i.accountNo) { skip('No account number'); continue; }
    if (!(i.amount > 0) || i.amount > 1e12) { skip('No amount'); continue; }
    if (i.amount >= LARGE_AMOUNT && !confirmLarge) { skip('Large amount not confirmed'); continue; }
    if (openBy.has(i.accountNo)) { skip(`Account ${i.accountNo} already has an open request (${openBy.get(i.accountNo) || 'in this file'})`); continue; }
    if (i.ref) seenRefs.add(i.ref);
    openBy.set(i.accountNo, '');
    accepted.push(i);
  }

  if (accepted.length) {
    const now = new Date();
    const first = await nextIds('withdrawals', accepted.length);
    const docs = accepted.map(({ emailLower, ref, ...f }, n) => ({
      _id: first + n,
      ref: `WD-${now.getFullYear()}-${pad(first + n)}`,
      clientId: clientBy.get(emailLower) ?? null, rmId: null, rmName: '', ...f,
      requestedAt: f.requestedAt || now,
      status: IMPORT_STATUS, department: ownerDept(IMPORT_STATUS), statusSince: now, closedAt: null,
      history: [{ at: now, ...actor(req), type: 'created', to: IMPORT_STATUS, comment: f.note }],
      ...(ref && { importRef: ref }),
      createdBy: req.user.id, createdAt: now, updatedBy: req.user.id, updatedAt: now,
    }));
    await withdrawals.insertMany(docs);
    await emit(req, 'withdrawal', 'reload', null, `${req.user.name} imported ${docs.length} withdrawal requests`);
  }
  res.status(201).json({ imported: accepted.length, skipped });
}));

// Edit fields and/or change status (with comment).
withdrawalsRouter.patch('/:id', ah(async (req, res) => {
  const body = req.body || {};
  const row = await find(req.params.id);
  const f = await readFields(body, row);
  const entries = [];
  let set = {};

  const changes = Object.keys(FIELD_LABEL)
    .filter((k) => k in f && String(f[k] ?? '') !== String(row[k] ?? '') && !(k === 'requestedAt' && +f[k] === +row[k]))
    .map((k) => ({ field: FIELD_LABEL[k], from: row[k] ?? '', to: f[k] ?? '' }));
  if (changes.length || 'clientId' in f || 'rmId' in f) {
    if ('amount' in f && f.amount !== row.amount) assertLargeConfirmed(f.amount, body);
    set = { ...f, updatedAt: new Date(), updatedBy: req.user.id };
    if (changes.length) entries.push({ at: new Date(), ...actor(req), type: 'edit', changes, comment: '' });
  }

  const comment = str(body.comment, 2000);
  const to = body.status && body.status !== row.status ? body.status : null;
  if (to) {
    if (isOpen(to) && !isOpen(row.status)) await assertOneOpen(f.accountNo ?? row.accountNo, row._id);
    const sc = statusChange(row, to, comment, req);
    set = { ...set, ...sc.set };
    entries.push(sc.entry);
  } else if (comment) {
    entries.push({ at: new Date(), ...actor(req), type: 'comment', comment });
  }
  if (f.accountNo && f.accountNo !== row.accountNo && isOpen(to || row.status)) await assertOneOpen(f.accountNo, row._id);
  if (!entries.length && !Object.keys(set).length) return res.json(out(row));

  const updated = await save(row, set, entries);
  const what = to ? `moved ${row.ref} to ${statusLabel(to)}` : `updated ${row.ref}`;
  await emit(req, 'withdrawal', 'upsert', row._id, `${req.user.name} ${what} · ${updated.clientName}`);
  res.json(out(updated));
}));

// "Move to next stage": the owner department changes with the status.
withdrawalsRouter.post('/:id/next', ah(async (req, res) => {
  const row = await find(req.params.id);
  const to = nextStatus(row.status);
  if (!to) throw new HttpError(400, `${statusLabel(row.status)} is the last stage.`);
  const { set, entry } = statusChange(row, to, str(req.body?.comment, 2000), req);
  const updated = await save(row, set, [entry]);
  await emit(req, 'withdrawal', 'upsert', row._id, `${req.user.name} moved ${row.ref} to ${statusLabel(to)} · ${row.clientName}`);
  res.json(out(updated));
}));

// Correction: go back to the status before the current one.
withdrawalsRouter.post('/:id/back', ah(async (req, res) => {
  const row = await find(req.params.id);
  const path = statusPath(row.history);
  const to = path[path.length - 2];
  if (!to) throw new HttpError(400, 'There is no earlier status to go back to.');
  if (isOpen(to) && !isOpen(row.status)) await assertOneOpen(row.accountNo, row._id);
  const { set, entry } = statusChange(row, to, str(req.body?.comment, 2000) || 'Correction', req, 'back');
  const updated = await save(row, set, [entry]);
  await emit(req, 'withdrawal', 'upsert', row._id, `${req.user.name} moved ${row.ref} back to ${statusLabel(to)} · ${row.clientName}`);
  res.json(out(updated));
}));

withdrawalsRouter.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  const row = await withdrawals.findOneAndDelete({ _id: Number(req.params.id) });
  if (!row) throw new HttpError(404, 'Request not found.');
  await emit(req, 'withdrawal', 'remove', row._id, `${req.user.name} deleted ${row.ref} · ${row.clientName}`);
  res.status(204).end();
}));
