import { randomBytes } from 'node:crypto';
import { STATUSES, emailKey, isOpen, ownerDept, phoneKey } from '../../src/crm/domain.js';
import { clients, counters, mails, users, withdrawals } from '../db.js';
import { pad } from './util.js';

// Sample clients, withdrawals and mail cases (marked demo: true so they can be removed again).
const NAMES = [
  ['Aarav Mehta', 'IN'], ['Fatima Al Zahra', 'AE'], ['James Carter', 'GB'], ['Sofia Rossi', 'IT'], ['Omar Haddad', 'JO'],
  ['Priya Nair', 'IN'], ['Lukas Becker', 'DE'], ['Mei Lin', 'SG'], ['Daniel Okafor', 'NG'], ['Elena Petrova', 'BG'],
  ['Hassan Raza', 'PK'], ['Chloe Martin', 'FR'],
];
// [status, hours since requested, hours in the current status, amount]
const REQUESTS = [
  ['received', 0.3, 0.3, 2500], ['received', 2, 2, 18000], ['with_rm', 5, 3, 7400], ['with_rm', 30, 26, 125000],
  ['under_review', 6, 1.5, 9900], ['under_review', 3, 0.5, 4300], ['pending', 28, 20, 15000], ['hold', 52, 40, 60000],
  ['compliance', 9, 5, 220000], ['compliance', 4, 1, 32000], ['approved', 12, 2, 5600], ['processing', 20, 6, 11250],
  ['completed', 8, 1, 3000], ['completed', 26, 3, 47000], ['rejected', 30, 10, 900],
];
const PATH = ['received', 'with_rm', 'under_review', 'compliance', 'approved', 'processing', 'completed'];
const MAILS = [
  ['Withdrawal not received yet', 'Withdrawal', 'High', 'withdrawals@', 'open', true],
  ['Please update my bank details', 'KYC / documents', 'Normal', 'support@', 'with_dept', false],
  ['Statement for March', 'Statement request', 'Low', 'accounts@', 'resolved', false],
  ['Cannot log in to my account', 'Account access', 'Urgent', 'support@', 'escalated', true],
  ['Deposit shows pending', 'Deposit', 'Normal', 'support@', 'waiting', false],
  ['Complaint about delay', 'Complaint', 'High', 'support@', 'open', true],
];

const hoursAgo = (h) => new Date(Date.now() - h * 3600e3);
const block = async (name, n) => {
  const top = await counters.findOneAndUpdate({ _id: name }, { $inc: { seq: n } }, { upsert: true, returnDocument: 'after' });
  return top.seq - n + 1;
};

export async function loadDemo(req) {
  const me = { by: req.user.id, byName: req.user.name, byDept: req.user.department || '' };
  const team = await users.find({ active: true }, { projection: { name: 1, department: 1 } }).toArray();
  const rms = team.filter((u) => u.department === 'RM');
  const rmPool = rms.length ? rms : team;
  const year = new Date().getFullYear();

  const firstClient = await block('clients', NAMES.length);
  const clientDocs = NAMES.map(([name, country], i) => {
    const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.com`;
    const phone = `+971 50 ${pad(1000 + i * 37, 3)} ${pad(4000 + i * 91, 4)}`;
    const rm = rmPool[i % rmPool.length];
    return {
      _id: firstClient + i, name, email, emailLower: emailKey(email), phone, phoneKey: phoneKey(phone), country,
      accountNo: `ACC-${pad(10450 + i * 7, 6)}`, rmId: rm?._id ?? null, rmName: rm?.name ?? '', notes: '',
      source: 'manual', importBatch: null, backfilled: false, demo: true,
      createdBy: req.user.id, createdAt: hoursAgo(24 * 40 - i), updatedAt: hoursAgo(24 * 40 - i),
    };
  });
  // A likely duplicate (same email as the first client), to show duplicate detection.
  const dup = { ...clientDocs[0], _id: firstClient + NAMES.length, name: 'A. Mehta', accountNo: 'ACC-019990' };
  await counters.updateOne({ _id: 'clients' }, { $inc: { seq: 1 } });
  clientDocs.push(dup);

  const firstW = await block('withdrawals', REQUESTS.length);
  const wDocs = REQUESTS.map(([status, age, inStatus, amount], i) => {
    const c = clientDocs[i % NAMES.length];
    const steps = status === 'pending' || status === 'hold' || status === 'rejected'
      ? ['received', 'with_rm', 'under_review', status]
      : PATH.slice(0, PATH.indexOf(status) + 1);
    const requestedAt = hoursAgo(age);
    const history = steps.map((to, k) => {
      const at = k === 0 ? requestedAt : k === steps.length - 1 ? hoursAgo(inStatus) : hoursAgo(age - ((age - inStatus) * k) / (steps.length - 1));
      const comment = to === 'pending' ? 'Waiting for the client to confirm bank details.' : to === 'hold' ? 'Large amount: waiting for source-of-funds document.' : to === 'rejected' ? 'Account name does not match the bank account.' : '';
      return { at, ...me, type: k === 0 ? 'created' : 'status', ...(k && { from: steps[k - 1] }), to, comment };
    });
    const id = firstW + i;
    return {
      _id: id, ref: `WD-${year}-${pad(id)}`, clientId: c._id, clientName: c.name, accountNo: c.accountNo, amount,
      currency: 'USD', method: ['Bank wire', 'Card', 'Crypto', 'E-wallet'][i % 4], rmId: c.rmId, rmName: c.rmName, note: '',
      requestedAt, status, department: ownerDept(status), statusSince: hoursAgo(inStatus), closedAt: isOpen(status) ? null : hoursAgo(inStatus),
      history, demo: true, createdBy: req.user.id, createdAt: requestedAt, updatedBy: req.user.id, updatedAt: hoursAgo(inStatus),
    };
  });

  const firstM = await block('mails', MAILS.length);
  const mDocs = MAILS.map(([subject, issueType, priority, mailbox, status, replyPending], i) => {
    const c = clientDocs[(i * 2) % NAMES.length];
    const created = hoursAgo(6 + i * 9);
    const id = firstM + i;
    const entry = (type, h, extra = {}) => ({ id: randomBytes(6).toString('hex'), at: hoursAgo(h), ...me, type, text: '', ...extra });
    const thread = [entry('logged', 6 + i * 9, { text: `Hello, ${subject.toLowerCase()}. Please help.`, mailNo: 1 })];
    if (status === 'with_dept') thread.push(entry('forward', 3 + i * 8, { department: 'Back Office', text: 'Please update the bank details.' }));
    if (status === 'escalated') thread.push(entry('escalate', 2 + i * 8, { department: 'Compliance', text: 'Client is very upset.' }));
    if (status === 'waiting') thread.push(entry('reply', 2 + i * 8, { text: 'Please send the deposit receipt.' }), entry('waiting', 2 + i * 8));
    if (status === 'resolved') thread.push(entry('reply', 3 + i * 8, { text: 'Statement attached.' }), entry('resolve', 3 + i * 8, { outcome: 'Solved', text: 'Sent the March statement.' }));
    return {
      _id: id, ticket: `ML-${year}-${pad(id)}`, clientId: c._id, clientName: c.name, clientEmail: c.email, clientEmailLower: c.emailLower,
      subject, issueType, relatedIssues: [], priority, mailbox, cc: '', status,
      department: status === 'with_dept' ? 'Back Office' : status === 'escalated' ? 'Compliance' : 'Support',
      replyPending, complianceFlag: status === 'escalated', escalated: status === 'escalated',
      outcome: status === 'resolved' ? 'Solved' : '', solution: status === 'resolved' ? 'Sent the March statement.' : '',
      resolvedAt: status === 'resolved' ? hoursAgo(3 + i * 8) : null, mailNo: 1, followUps: 0,
      receivedAt: created, lastClientAt: created, lastReplyAt: null, thread, files: [], demo: true,
      createdBy: req.user.id, createdAt: created, updatedBy: req.user.id, updatedAt: thread[thread.length - 1].at,
    };
  });

  // An account can have only one open request: skip demo requests that would break that rule.
  const busy = new Set((await withdrawals.find({ status: { $nin: STATUSES.filter((s) => s.closed).map((s) => s.id) } }, { projection: { accountNo: 1 } }).toArray()).map((w) => w.accountNo));
  const okW = wDocs.filter((w) => { if (!isOpen(w.status)) return true; if (busy.has(w.accountNo)) return false; busy.add(w.accountNo); return true; });

  await clients.insertMany(clientDocs);
  if (okW.length) await withdrawals.insertMany(okW);
  await mails.insertMany(mDocs);
  return { clients: clientDocs.length, withdrawals: okW.length, mails: mDocs.length };
}

export async function removeDemo() {
  const [c, w, m] = await Promise.all([
    clients.deleteMany({ demo: true }), withdrawals.deleteMany({ demo: true }), mails.deleteMany({ demo: true }),
  ]);
  return { clients: c.deletedCount, withdrawals: w.deletedCount, mails: m.deletedCount };
}

export async function demoCount() {
  const [c, w, m] = await Promise.all([
    clients.countDocuments({ demo: true }), withdrawals.countDocuments({ demo: true }), mails.countDocuments({ demo: true }),
  ]);
  return c + w + m;
}
