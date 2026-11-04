import { users } from '../db.js';

// An error with a status code and a message meant for the person using the app.
// extra is merged into the JSON response (e.g. { needsConfirm: true }).
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

// Who made a change: stamped on every history / thread entry.
export const actor = (req) => ({ by: req.user.id, byName: req.user.name, byDept: req.user.department || '' });

export const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
export const pad = (n, w = 4) => String(n).padStart(w, '0');
export const isAdmin = (req) => req.user.role === 'admin';

// MongoDB doc → what the browser sees ({ _id } becomes { id }).
export const out = (doc) => {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
};

export function toDate(v, fallback = null) {
  if (v == null || v === '') return fallback;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

// Name of an active team member (used for RM fields), or null.
export async function personName(id) {
  if (id == null || id === '') return null;
  const u = await users.findOne({ _id: Number(id) }, { projection: { name: 1 } });
  return u?.name ?? null;
}

// Date-range filter for "?from=YYYY-MM-DD&to=YYYY-MM-DD" (to is inclusive).
export function dateRange(from, to) {
  const f = toDate(from && `${from}T00:00:00`);
  const t = toDate(to && `${to}T23:59:59.999`);
  if (!f && !t) return null;
  return { ...(f && { $gte: f }), ...(t && { $lte: t }) };
}
