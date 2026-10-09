import { Router } from 'express';
import { ROLES, destroyUserSessions, hashPassword, publicUser } from './auth.js';
import { ah, invoices, nextId, sessions, users } from './db.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// partial: only validate the fields that were sent (used for updates).
export function validateUserInput({ name, email, password, role }, { partial = false } = {}) {
  const check = (v) => !partial || v !== undefined;
  if (check(name) && !String(name ?? '').trim()) return 'Name is required.';
  if (check(email) && !EMAIL_RE.test(String(email ?? ''))) return 'Enter a valid email address.';
  if (!partial && !password) return 'Password is required.';
  if (password && String(password).length < 8) return 'Password must be at least 8 characters.';
  if (role !== undefined && !ROLES.includes(role)) return 'Invalid role.';
  return null;
}

const activeAdminCount = () => users.countDocuments({ role: 'admin', active: true });
const emailTaken = (email, exceptId) => users.countDocuments(
  { emailLower: String(email).trim().toLowerCase(), ...(exceptId != null && { _id: { $ne: exceptId } }) }, { limit: 1 },
);

// Admin-only team management (mounted behind requireRole('admin')).
export const usersRouter = Router();

usersRouter.get('/', ah(async (req, res) => {
  const [rows, counts] = await Promise.all([
    users.find().sort({ active: -1, role: 1, name: 1 }).toArray(),
    invoices.aggregate([{ $group: { _id: '$createdBy', n: { $sum: 1 } } }]).toArray(),
  ]);
  const countBy = new Map(counts.map((c) => [c._id, c.n]));
  res.json(rows.map((u) => ({ ...publicUser(u), invoiceCount: countBy.get(u._id) || 0 })));
}));

usersRouter.post('/', ah(async (req, res) => {
  const { name, email, password, role = 'staff' } = req.body || {};
  const err = validateUserInput({ name, email, password, role });
  if (err) return res.status(400).json({ error: err });
  if (await emailTaken(email)) return res.status(409).json({ error: 'A user with this email already exists.' });
  const user = {
    _id: await nextId('users'),
    name: String(name).trim(),
    email: String(email).trim(),
    emailLower: String(email).trim().toLowerCase(),
    passwordHash: hashPassword(password),
    role,
    active: true,
    createdAt: new Date(),
  };
  await users.insertOne(user);
  res.status(201).json(publicUser(user));
}));

usersRouter.put('/:id', ah(async (req, res) => {
  const target = await users.findOne({ _id: Number(req.params.id) });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  const { name, email, role, active, password } = req.body || {};
  const err = validateUserInput({ name, email, password, role }, { partial: true });
  if (err) return res.status(400).json({ error: err });

  const self = target._id === req.user.id;
  const nextRole = role ?? target.role;
  const nextActive = active === undefined ? !!target.active : !!active;
  if (self && (nextRole !== 'admin' || !nextActive)) return res.status(400).json({ error: 'You cannot remove your own admin access.' });
  if (target.role === 'admin' && target.active && (nextRole !== 'admin' || !nextActive) && await activeAdminCount() <= 1) {
    return res.status(400).json({ error: 'At least one active admin is required.' });
  }
  if (email && await emailTaken(email, target._id)) {
    return res.status(409).json({ error: 'A user with this email already exists.' });
  }

  const nextEmail = String(email ?? target.email).trim();
  const changes = { name: String(name ?? target.name).trim(), email: nextEmail, emailLower: nextEmail.toLowerCase(), role: nextRole, active: nextActive };
  if (password) changes.passwordHash = hashPassword(password);
  await users.updateOne({ _id: target._id }, { $set: changes });
  // Disabling access or resetting the password signs that person out everywhere.
  if (!nextActive || password) await destroyUserSessions(target._id, self ? req.token : null);

  res.json(publicUser({ ...target, ...changes }));
}));

usersRouter.delete('/:id', ah(async (req, res) => {
  const target = await users.findOne({ _id: Number(req.params.id) });
  if (!target) return res.status(404).json({ error: 'User not found.' });
  if (target._id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  const n = await invoices.countDocuments({ createdBy: target._id });
  if (n > 0) return res.status(409).json({ error: `This member created ${n} invoice(s). Disable their access instead so the records keep their name.` });
  await users.deleteOne({ _id: target._id });
  await sessions.deleteMany({ userId: target._id });
  res.status(204).end();
}));
