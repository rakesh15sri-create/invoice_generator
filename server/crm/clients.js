import { Router } from 'express';
import { emailKey, phoneKey } from '../../src/crm/domain.js';
import { requireRole } from '../auth.js';
import { ah, clients, counters, mails, nextId, users, withdrawals } from '../db.js';
import { emit } from './events.js';
import { HttpError, isAdmin, out, personName, str } from './util.js';

const MAX_IMPORT = 5000;

function readClient(body) {
  const c = {
    name: str(body.name, 120),
    email: str(body.email, 160),
    phone: str(body.phone, 40),
    country: str(body.country, 60),
    accountNo: str(body.accountNo, 40),
    notes: str(body.notes, 2000),
  };
  c.emailLower = emailKey(c.email);
  c.phoneKey = phoneKey(c.phone);
  return c;
}

export const clientsRouter = Router();

clientsRouter.get('/', ah(async (req, res) => {
  const rows = await clients.find().sort({ name: 1 }).limit(20000).toArray();
  res.json(rows.map(out));
}));

clientsRouter.post('/', ah(async (req, res) => {
  const c = readClient(req.body || {});
  if (!c.name) throw new HttpError(400, 'Client name is required.');
  const rmId = req.body?.rmId ? Number(req.body.rmId) : null;
  const now = new Date();
  const row = {
    _id: await nextId('clients'), ...c, rmId, rmName: (await personName(rmId)) || '',
    source: 'manual', importBatch: null, backfilled: false,
    createdBy: req.user.id, createdAt: now, updatedAt: now,
  };
  await clients.insertOne(row);
  await emit(req, 'client', 'upsert', row._id, `${req.user.name} added client ${row.name}`);
  res.status(201).json(out(row));
}));

clientsRouter.put('/:id', ah(async (req, res) => {
  const c = readClient(req.body || {});
  if (!c.name) throw new HttpError(400, 'Client name is required.');
  const rmId = req.body?.rmId ? Number(req.body.rmId) : null;
  const row = await clients.findOneAndUpdate(
    { _id: Number(req.params.id) },
    { $set: { ...c, rmId, rmName: (await personName(rmId)) || (rmId ? '' : str(req.body?.rmName, 80)), updatedAt: new Date(), updatedBy: req.user.id } },
    { returnDocument: 'after' },
  );
  if (!row) throw new HttpError(404, 'Client not found.');
  // Keep the name on their withdrawals and mail cases in step.
  await Promise.all([
    withdrawals.updateMany({ clientId: row._id }, { $set: { clientName: row.name } }),
    mails.updateMany({ clientId: row._id }, { $set: { clientName: row.name } }),
  ]);
  await emit(req, 'client', 'upsert', row._id, `${req.user.name} updated client ${row.name}`);
  res.json(out(row));
}));

// CSV import: the app parses the file and maps the columns, then sends the rows here.
// Imported clients are marked as backfilled and share a batch number, so the import can be undone.
clientsRouter.post('/import', ah(async (req, res) => {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows?.length) throw new HttpError(400, 'The file has no client rows.');
  if (rows.length > MAX_IMPORT) throw new HttpError(400, `Import up to ${MAX_IMPORT} clients at a time. Split the file and try again.`);
  const team = await users.find({}, { projection: { name: 1 } }).toArray();
  const byName = new Map(team.map((u) => [u.name.trim().toLowerCase(), u]));
  const batch = await nextId('client_imports');
  const now = new Date();
  const docs = [];
  for (const r of rows) {
    const c = readClient(r || {});
    if (!c.name) continue;
    const rm = byName.get(str(r.rm, 80).toLowerCase());
    docs.push({
      ...c, rmId: rm?._id ?? null, rmName: rm?.name ?? str(r.rm, 80),
      source: 'import', importBatch: batch, importedBy: req.user.id, backfilled: true,
      createdBy: req.user.id, createdAt: now, updatedAt: now,
    });
  }
  if (!docs.length) throw new HttpError(400, 'No rows had a client name. Check that the name column is mapped.');
  // Reserve a block of ids in one step.
  const top = await counters.findOneAndUpdate({ _id: 'clients' }, { $inc: { seq: docs.length } }, { upsert: true, returnDocument: 'after' });
  docs.forEach((d, i) => { d._id = top.seq - docs.length + 1 + i; });
  await clients.insertMany(docs, { ordered: false });
  await emit(req, 'client', 'reload', null, `${req.user.name} imported ${docs.length} clients`);
  res.status(201).json({ imported: docs.length, skipped: rows.length - docs.length, batch });
}));

// Undo the most recent import (the importer, or an admin).
clientsRouter.delete('/import/last', ah(async (req, res) => {
  const last = await clients.find({ importBatch: { $ne: null } }).sort({ importBatch: -1 }).limit(1).next();
  if (!last) throw new HttpError(404, 'There is no import to undo.');
  if (!isAdmin(req) && last.importedBy !== req.user.id) throw new HttpError(403, 'Only the person who imported these clients, or an admin, can undo the import.');
  const { deletedCount } = await clients.deleteMany({ importBatch: last.importBatch });
  await emit(req, 'client', 'reload', null, `${req.user.name} undid the last client import (${deletedCount} clients)`);
  res.json({ removed: deletedCount });
}));

clientsRouter.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  const row = await clients.findOneAndDelete({ _id: Number(req.params.id) });
  if (!row) throw new HttpError(404, 'Client not found.');
  // Their requests and cases stay (with the name), just no longer linked.
  await Promise.all([
    withdrawals.updateMany({ clientId: row._id }, { $set: { clientId: null } }),
    mails.updateMany({ clientId: row._id }, { $set: { clientId: null } }),
  ]);
  await emit(req, 'client', 'remove', row._id, `${req.user.name} deleted client ${row.name}`);
  res.status(204).end();
}));
