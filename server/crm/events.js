import { Router } from 'express';
import { ah, counters, crmEvents, invoices, nextId } from '../db.js';

// Live updates without websockets (on Vercel the API runs as short-lived functions): every change
// is written to crm_events, and the app polls /api/crm/changes?since=<last seq> every few seconds.
// kind: withdrawal | client | mail | all   action: upsert | remove | reload | reset
export async function emit(req, kind, action, id = null, text = '') {
  const seq = await nextId('crm_events');
  await crmEvents.insertOne({
    _id: seq, at: new Date(), kind, action, id,
    by: req.user.id, byName: req.user.name, origin: String(req.get('x-client-id') || '').slice(0, 40), text,
  });
}

const MAX_EVENTS = 200;
const GAP_WAIT_MS = 10000;

export const eventsRouter = Router();

eventsRouter.get('/changes', ah(async (req, res) => {
  // No "since" = first call: just return the current position.
  const first = req.query.since == null || req.query.since === '';
  const since = Number(req.query.since) || 0;
  const canSeeAll = req.user.role === 'admin' || req.user.role === 'manager';
  const [counter, invoiceCount] = await Promise.all([
    counters.findOne({ _id: 'crm_events' }),
    canSeeAll ? invoices.estimatedDocumentCount() : invoices.countDocuments({ createdBy: req.user.id }),
  ]);
  const head = counter?.seq || 0;
  if (first || since >= head) return res.json({ seq: first || since > head ? head : since, events: [], invoiceCount });

  const rows = await crmEvents.find({ _id: { $gt: since } }).sort({ _id: 1 }).limit(MAX_EVENTS + 1).toArray();
  if (rows.length > MAX_EVENTS) return res.json({ seq: head, events: [], reload: true, invoiceCount });

  // Ids are taken before the insert, so a slightly later id can be visible before an earlier one.
  // Stop at a gap (and pick it up on the next poll) unless it's old enough to be a lost event.
  const events = [];
  let seq = since;
  for (const e of rows) {
    if (e._id !== seq + 1 && Date.now() - e.at.getTime() < GAP_WAIT_MS) break;
    events.push({ seq: e._id, kind: e.kind, action: e.action, id: e.id, by: e.by, byName: e.byName, origin: e.origin, text: e.text });
    seq = e._id;
  }
  res.json({ seq, events, invoiceCount });
}));
