import { Router } from 'express';
import { defaults, isPaid, num, pad, totals } from '../src/data.js';
import { requireRole } from './auth.js';
import { ah, getSetting, invoices, nextId, nextIds, settings, users } from './db.js';
import { UPLOAD_LIMIT_MB, fileMeta, rawBody } from './files.js';
import { deleteFile, signedUrl, uploadFile } from './imagekit.js';

const ATTACH_MAX_MB = UPLOAD_LIMIT_MB;
const ATTACH_MAX_COUNT = 20;
const PDF_MAX_MB = UPLOAD_LIMIT_MB;

// Stored file → what the browser sees (no ImageKit paths or ids beyond what's needed).
const fileInfo = (f) => f && ({ id: f.fileId, name: f.name, size: f.size, type: f.mime, uploadedAt: f.uploadedAt, uploadedBy: f.uploadedBy });
const filesOf = (row) => ({ pdf: fileInfo(row.pdf), attachments: (row.attachments || []).map(fileInfo) });

const round2 = (n) => Math.round(n * 100) / 100;
const MAX_DATA_BYTES = 4 * 1024 * 1024;
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Fields derived from the invoice data so lists/stats never need to read the whole invoice.
export function summarize(data) {
  const t = totals(data);
  const status = String(data.doc?.status || 'Unpaid');
  const cancelled = status.toLowerCase() === 'cancelled';
  const partial = data.amountPaid === '' || data.amountPaid == null ? 0 : Math.min(num(data.amountPaid), t.total);
  return {
    number: String(data.doc?.number || '').trim(),
    template: String(data.template || 'confirm'),
    customerName: String(data.customer?.name || ''),
    currency: String(data.currency || 'AED'),
    total: round2(t.total),
    paid: round2(cancelled ? 0 : isPaid(data) ? t.total : partial),
    status,
    statusLower: status.toLowerCase(),
    docDate: data.doc?.date || null,
  };
}

function validate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Invoice data is missing.';
  if (!Array.isArray(data.items) || data.items.length > 500) return 'Invoice items are invalid.';
  if (!data.doc || typeof data.doc !== 'object') return 'Invoice document details are missing.';
  if (!String(data.doc.number || '').trim()) return 'Invoice number is required.';
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_DATA_BYTES) return 'Invoice is too large (try a smaller logo).';
  return null;
}

const canSeeAll = (user) => user.role === 'admin' || user.role === 'manager';

// id → name for the given user ids (missing users map to null, like a removed account).
export async function userNames(ids) {
  const list = [...new Set(ids.filter((id) => id != null))];
  if (!list.length) return new Map();
  const rows = await users.find({ _id: { $in: list } }, { projection: { name: 1 } }).toArray();
  return new Map(rows.map((u) => [u._id, u.name]));
}

async function findVisible(req, id) {
  const row = await invoices.findOne({ _id: Number(id) });
  if (!row) return null;
  if (!canSeeAll(req.user) && row.createdBy !== req.user.id) return null; // staff: own invoices only
  return row;
}

export const invoicesRouter = Router();

invoicesRouter.get('/', ah(async (req, res) => {
  const filter = {};
  const { template, status, q, createdBy, from, to } = req.query;
  if (!canSeeAll(req.user)) filter.createdBy = req.user.id;
  else if (createdBy) filter.createdBy = Number(createdBy);
  if (template) filter.template = String(template);
  if (String(status).toLowerCase() === 'paid') filter.statusLower = { $in: ['paid', 'successful'] }; // dashboard groups these
  else if (status) filter.statusLower = String(status).toLowerCase();
  if (from || to) {
    filter.docDate = {};
    if (from) filter.docDate.$gte = String(from);
    if (to) filter.docDate.$lte = String(to);
  }
  if (q) {
    const re = new RegExp(escapeRegex(String(q)), 'i');
    filter.$or = [{ number: re }, { customerName: re }];
  }
  const rows = await invoices.find(filter, { projection: { data: 0 } })
    .sort({ docDate: -1, _id: -1 })
    .limit(1000)
    .toArray();
  const names = await userNames(rows.flatMap((r) => [r.createdBy, r.updatedBy]));
  res.json(rows.map((r) => ({
    id: r._id,
    number: r.number,
    template: r.template,
    customerName: r.customerName,
    currency: r.currency,
    total: r.total,
    paid: r.paid,
    status: r.status,
    date: r.docDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    createdBy: r.createdBy,
    createdByName: names.get(r.createdBy) ?? null,
    updatedByName: names.get(r.updatedBy) ?? null,
    pdfId: r.pdf?.fileId ?? null,
    attachmentCount: r.attachments?.length || 0,
  })));
}));

// Reserve the next `count` free invoice numbers (shared across the whole team). Each $inc is atomic,
// so two people asking at the same moment always get different numbers.
async function reserveNumbers(count) {
  const year = new Date().getFullYear();
  const out = [];
  while (out.length < count) {
    const want = count - out.length;
    const { value } = await settings.findOneAndUpdate(
      { _id: 'invoice_counter' }, { $inc: { value: want } }, { upsert: true, returnDocument: 'after' },
    );
    const batch = Array.from({ length: want }, (_, i) => `INV-${year}-${pad(value - want + 1 + i, 4)}`);
    const taken = new Set((await invoices.find({ number: { $in: batch } }, { projection: { number: 1 } }).toArray()).map((r) => r.number));
    out.push(...batch.filter((n) => !taken.has(n)));
  }
  return out;
}

invoicesRouter.post('/next-number', ah(async (req, res) => {
  const [number] = await reserveNumbers(1);
  res.json({ number });
}));

// Bulk create from an imported payment report: { invoices: [{ ref, data }] }. A blank invoice number
// gets the next one in sequence. ref (the gateway's order id) is stored, so importing the same
// report again skips payments that already have an invoice.
const IMPORT_MAX = 500;
invoicesRouter.post('/import', ah(async (req, res) => {
  const list = req.body?.invoices;
  if (!Array.isArray(list) || !list.length) return res.status(400).json({ error: 'There is nothing to import.' });
  if (list.length > IMPORT_MAX) return res.status(400).json({ error: `Import up to ${IMPORT_MAX} payments at a time. Split the file and try again.` });

  const refOf = (e) => String(e?.ref || '').trim() || null;
  const numberOf = (e) => String(e?.data?.doc?.number || '').trim();
  const refs = list.map(refOf).filter(Boolean);
  const numbers = list.map(numberOf).filter(Boolean);
  const [doneRefs, usedNumbers, company] = await Promise.all([
    invoices.find({ importRef: { $in: refs } }, { projection: { importRef: 1 } }).toArray(),
    invoices.find({ number: { $in: numbers } }, { projection: { number: 1 } }).toArray(),
    getSetting('company', null),
  ]);
  const seenRefs = new Set(doneRefs.map((r) => r.importRef));
  const seenNumbers = new Set(usedNumbers.map((r) => r.number));

  const skipped = [];
  const accepted = [];
  for (const e of list) {
    const ref = refOf(e);
    const number = numberOf(e);
    if (ref && seenRefs.has(ref)) { skipped.push({ ref, reason: 'Already imported' }); continue; }
    if (number && seenNumbers.has(number)) { skipped.push({ ref, reason: `Invoice number ${number} is already used` }); continue; }
    const err = validate(number ? e.data : { ...e?.data, doc: { ...e?.data?.doc, number: 'pending' } });
    if (err) { skipped.push({ ref, reason: err }); continue; }
    if (ref) seenRefs.add(ref);
    if (number) seenNumbers.add(number);
    // The browser leaves out the company (its logo can be large); every invoice gets the team's.
    accepted.push({ ref, data: { ...e.data, company: e.data.company || company || defaults().company } });
  }

  const blanks = accepted.filter((e) => !numberOf(e));
  const fresh = blanks.length ? await reserveNumbers(blanks.length) : [];
  blanks.forEach((e, i) => { e.data.doc.number = fresh[i]; });

  const created = [];
  if (accepted.length) {
    const now = new Date();
    const firstId = await nextIds('invoices', accepted.length);
    const docs = accepted.map(({ ref, data }, i) => ({
      _id: firstId + i, ...summarize(data), data, ...(ref && { importRef: ref }),
      createdBy: req.user.id, updatedBy: req.user.id, createdAt: now, updatedAt: now,
    }));
    await invoices.insertMany(docs);
    created.push(...docs.map((d) => ({ id: d._id, number: d.number, ref: d.importRef ?? null })));
  }
  res.status(201).json({ created, skipped });
}));

invoicesRouter.get('/:id', ah(async (req, res) => {
  const row = await findVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  res.json({ id: row._id, data: row.data, createdBy: row.createdBy, files: filesOf(row) });
}));

invoicesRouter.post('/', ah(async (req, res) => {
  const data = req.body?.data;
  const err = validate(data);
  if (err) return res.status(400).json({ error: err });
  const now = new Date();
  const id = await nextId('invoices');
  await invoices.insertOne({
    _id: id, ...summarize(data), data, createdBy: req.user.id, updatedBy: req.user.id, createdAt: now, updatedAt: now,
  });
  res.status(201).json({ id });
}));

invoicesRouter.put('/:id', ah(async (req, res) => {
  const row = await findVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  const data = req.body?.data;
  const err = validate(data);
  if (err) return res.status(400).json({ error: err });
  await invoices.updateOne(
    { _id: row._id },
    { $set: { ...summarize(data), data, updatedBy: req.user.id, updatedAt: new Date() } },
  );
  res.json({ id: row._id });
}));

invoicesRouter.delete('/:id', requireRole('admin', 'manager'), ah(async (req, res) => {
  const row = await invoices.findOneAndDelete({ _id: Number(req.params.id) });
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  res.status(204).end();
  // Remove its stored PDF and attachments from ImageKit in the background.
  for (const f of [row.pdf, ...(row.attachments || [])]) if (f) deleteFile(f.fileId);
}));

// ---------- stored files (ImageKit, private) ----------
const stored = (file, req, mime) => ({
  fileId: file.fileId, name: file.name, filePath: file.filePath, size: file.size, mime,
  uploadedAt: new Date(), uploadedBy: req.user.id,
});

// Keep a copy of the PDF that was downloaded; replaces the previous copy.
invoicesRouter.post('/:id/pdf', rawBody(PDF_MAX_MB), ah(async (req, res) => {
  const row = await findVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  if (!req.body?.length) return res.status(400).json({ error: 'The PDF is empty.' });
  const file = await uploadFile(req.body, { fileName: `${row.number}.pdf`, folder: `invoices/${row._id}`, mime: 'application/pdf' });
  const pdf = stored(file, req, 'application/pdf');
  await invoices.updateOne({ _id: row._id }, { $set: { pdf } });
  if (row.pdf) deleteFile(row.pdf.fileId);
  res.status(201).json(fileInfo(pdf));
}));

invoicesRouter.post('/:id/attachments', rawBody(ATTACH_MAX_MB), ah(async (req, res) => {
  const row = await findVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  if ((row.attachments?.length || 0) >= ATTACH_MAX_COUNT) {
    return res.status(400).json({ error: `An invoice can have up to ${ATTACH_MAX_COUNT} attachments. Remove one first.` });
  }
  if (!req.body?.length) return res.status(400).json({ error: 'The file is empty.' });
  const { fileName, mime } = fileMeta(req);
  const file = await uploadFile(req.body, { fileName, folder: `invoices/${row._id}`, mime });
  const att = stored(file, req, mime);
  att.name = fileName; // show the original name, not ImageKit's unique one
  await invoices.updateOne({ _id: row._id }, { $push: { attachments: att } });
  res.status(201).json(fileInfo(att));
}));

invoicesRouter.delete('/:id/attachments/:fileId', ah(async (req, res) => {
  const row = await findVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  const att = row.attachments?.find((a) => a.fileId === req.params.fileId);
  if (!att) return res.status(404).json({ error: 'Attachment not found.' });
  await invoices.updateOne({ _id: row._id }, { $pull: { attachments: { fileId: att.fileId } } });
  await deleteFile(att.fileId);
  res.status(204).end();
}));

// Short-lived link to open a stored file (only for people who can see the invoice).
invoicesRouter.get('/:id/files/:fileId/url', ah(async (req, res) => {
  const row = await findVisible(req, req.params.id);
  if (!row) return res.status(404).json({ error: 'Invoice not found.' });
  const file = [row.pdf, ...(row.attachments || [])].find((f) => f?.fileId === req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found. It may have been removed.' });
  res.json({ url: signedUrl(file.filePath, 600), name: file.name });
}));
