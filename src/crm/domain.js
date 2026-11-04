// Withdrawal workflow and mail-case rules. Shared by the server (which enforces them) and the
// app (which shows them), so both always agree.

export const DEPARTMENTS = ['Support', 'RM', 'Back Office', 'Compliance', 'Finance'];

// ---------- Withdrawals ----------
// dept = the desk that owns a request while it is in this status (changes automatically).
export const STATUSES = [
  { id: 'received', label: 'Received', dept: 'Support', color: '#64748b' },
  { id: 'with_rm', label: 'With RM', dept: 'RM', color: '#8b5cf6' },
  { id: 'under_review', label: 'Under review', dept: 'Back Office', color: '#3b82f6' },
  { id: 'pending', label: 'Pending', dept: 'RM', color: '#d97706', needsComment: true },
  { id: 'hold', label: 'Hold', dept: 'Back Office', color: '#ea580c', needsComment: true },
  { id: 'compliance', label: 'Compliance', dept: 'Compliance', color: '#a855f7' },
  { id: 'approved', label: 'Approved', dept: 'Finance', color: '#0d9488' },
  { id: 'processing', label: 'Processing', dept: 'Finance', color: '#0284c7' },
  { id: 'completed', label: 'Completed', dept: 'Finance', color: '#16a34a', closed: true },
  { id: 'rejected', label: 'Rejected', dept: 'Back Office', color: '#dc2626', closed: true, needsComment: true },
];
export const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
export const CLOSED_STATUSES = STATUSES.filter((s) => s.closed).map((s) => s.id);

// "Move to next stage". Pending and Hold go back to review once resolved.
const NEXT = {
  received: 'with_rm', with_rm: 'under_review', under_review: 'compliance', pending: 'under_review',
  hold: 'under_review', compliance: 'approved', approved: 'processing', processing: 'completed',
};
export const nextStatus = (s) => NEXT[s] || null;
export const statusLabel = (s) => STATUS_BY_ID[s]?.label || s || '—';
export const statusColor = (s) => STATUS_BY_ID[s]?.color || '#64748b';
export const ownerDept = (s) => STATUS_BY_ID[s]?.dept || '';
export const isOpen = (s) => !STATUS_BY_ID[s]?.closed;
export const needsComment = (s) => !!STATUS_BY_ID[s]?.needsComment;

export const LARGE_AMOUNT = 100000; // asks for confirmation at or above this amount
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'INR'];
export const METHODS = ['Bank wire', 'Card', 'Crypto', 'E-wallet', 'Other'];

const H = 3600e3;
export const AGE_FILTERS = [
  { id: '1h', label: 'Pending > 1h', ms: H },
  { id: '4h', label: 'Pending > 4h', ms: 4 * H },
  { id: '24h', label: 'Pending > 24h', ms: 24 * H },
];
export const AGE_BUCKETS = [
  { id: 'lt1h', label: '< 1h', max: H },
  { id: '1to4h', label: '1–4h', max: 4 * H },
  { id: '4to24h', label: '4–24h', max: 24 * H },
  { id: '1to3d', label: '1–3 days', max: 72 * H },
  { id: 'gt3d', label: '> 3 days', max: Infinity },
];
// Age colour for the "pending for" timers.
export const ageLevel = (ms) => (ms < H ? 0 : ms < 4 * H ? 1 : ms < 24 * H ? 2 : 3);

export function fmtDuration(ms) {
  if (!(ms > 0)) return '0m';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// Status path from the history: created/status push a status, "back" (a correction) pops one.
export function statusPath(history = []) {
  const path = [];
  for (const e of history) {
    if (e.type === 'created' || e.type === 'status') path.push(e.to);
    else if (e.type === 'back') { path.pop(); if (path[path.length - 1] !== e.to) path.push(e.to); }
  }
  return path;
}

// Time spent in each status, in order: [{ status, dept, from, to, ms }]
export function statusStints(w, now = Date.now()) {
  const marks = (w.history || []).filter((e) => e.to && ['created', 'status', 'back'].includes(e.type));
  return marks.map((e, i) => {
    const from = Date.parse(e.at);
    const end = marks[i + 1] ? Date.parse(marks[i + 1].at) : (isOpen(e.to) ? now : from);
    return { status: e.to, dept: ownerDept(e.to), from, to: end, ms: Math.max(0, end - from) };
  });
}

// ---------- Client mails (case tracking) ----------
export const MAIL_STATUSES = [
  { id: 'open', label: 'Open', color: '#3b82f6' },
  { id: 'with_dept', label: 'With department', color: '#8b5cf6' },
  { id: 'escalated', label: 'Escalated', color: '#dc2626' },
  { id: 'waiting', label: 'Waiting for client', color: '#d97706' },
  { id: 'resolved', label: 'Resolved', color: '#16a34a', closed: true },
];
export const MAIL_STATUS_BY_ID = Object.fromEntries(MAIL_STATUSES.map((s) => [s.id, s]));
export const mailStatusLabel = (s) => MAIL_STATUS_BY_ID[s]?.label || s || '—';
export const isMailOpen = (s) => !MAIL_STATUS_BY_ID[s]?.closed;

export const ISSUE_TYPES = [
  'Withdrawal', 'Deposit', 'Account access', 'KYC / documents', 'Trading issue', 'Statement request', 'Complaint', 'Other',
];
export const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent'];
export const MAILBOXES = ['support@', 'withdrawals@', 'accounts@', 'compliance@'];
export const OUTCOMES = ['Solved', 'Partly solved', 'Not solved', 'Duplicate', 'No action needed'];

// Thread entry types. "logged" is the first mail and can't be undone.
export const MAIL_ENTRY = {
  logged: 'Mail logged',
  reply: 'Reply sent',
  client: 'Client wrote again',
  forward: 'Sent to department',
  escalate: 'Escalated',
  note: 'Internal note',
  resolve: 'Resolved',
  waiting: 'Waiting for client',
  compliance: 'Compliance flag',
  edit: 'Details edited',
};

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Duplicate keys: lower-case email, and the last 9 digits of the phone number.
export const emailKey = (e) => String(e || '').trim().toLowerCase();
export const phoneKey = (p) => { const d = String(p || '').replace(/\D/g, ''); return d.length >= 7 ? d.slice(-9) : ''; };
