import { Router } from 'express';
import { requireRole } from '../auth.js';
import { ah, clients, mails, users, withdrawals } from '../db.js';
import { deleteFile } from '../imagekit.js';
import { clientsRouter } from './clients.js';
import { demoCount, loadDemo, removeDemo } from './demo.js';
import { emit, eventsRouter } from './events.js';
import { mailsRouter } from './mails.js';
import { HttpError } from './util.js';
import { withdrawalsRouter } from './withdrawals.js';

// Withdrawal CRM: withdrawals board, clients and client mails. Mounted after sign-in.
export const crmRouter = Router();

crmRouter.use('/crm', eventsRouter);

// Team members for RM / assignee pickers (everyone can see names and departments).
crmRouter.get('/crm/people', ah(async (req, res) => {
  const rows = await users.find({ active: true }, { projection: { name: 1, department: 1 } }).sort({ name: 1 }).toArray();
  res.json(rows.map((u) => ({ id: u._id, name: u.name, department: u.department || '' })));
}));

crmRouter.use('/withdrawals', withdrawalsRouter);
crmRouter.use('/clients', clientsRouter);
crmRouter.use('/mails', mailsRouter);

// ---------- admin: wipe and demo data ----------
const admin = Router();
admin.use(requireRole('admin'));
const demoEnabled = () => /^(1|true|yes)$/i.test(process.env.DEMO || '');

// Deletes every withdrawal, client and mail case (and the mail files). Invoices are not touched.
admin.post('/wipe', ah(async (req, res) => {
  if (req.body?.confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  const files = await mails.find({ 'files.0': { $exists: true } }, { projection: { files: 1 } }).toArray();
  const [w, c, m] = await Promise.all([withdrawals.deleteMany({}), clients.deleteMany({}), mails.deleteMany({})]);
  await emit(req, 'all', 'reset', null, `${req.user.name} deleted all CRM data`);
  res.json({ withdrawals: w.deletedCount, clients: c.deletedCount, mails: m.deletedCount });
  for (const row of files) for (const f of row.files) deleteFile(f.fileId);
}));

admin.get('/demo', ah(async (req, res) => res.json({ enabled: demoEnabled(), count: demoEnabled() ? await demoCount() : 0 })));
admin.post('/demo', ah(async (req, res) => {
  if (!demoEnabled()) throw new HttpError(403, 'Demo data is turned off. Set DEMO=true on the server to use it.');
  const added = await loadDemo(req);
  await emit(req, 'all', 'reset', null, `${req.user.name} loaded demo data`);
  res.status(201).json(added);
}));
admin.delete('/demo', ah(async (req, res) => {
  const removed = await removeDemo();
  await emit(req, 'all', 'reset', null, `${req.user.name} removed the demo data`);
  res.json(removed);
}));

crmRouter.use('/admin', admin);
