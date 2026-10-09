// One-time copy of the old SQLite database (data/app.db) into MongoDB.
// Usage: npm run migrate-sqlite [-- path/to/app.db]
//
// Keeps ids, password hashes, invoice numbers and settings, so links and logins keep working.
// Safe to run again: existing records with the same id are overwritten with the SQLite copy.
// Sessions are not copied — everyone just signs in once more.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { client, connectDb, counters, invoices, settings, users } from './db.js';
import { summarize } from './invoices.js';

const file = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'app.db');
if (!existsSync(file)) {
  console.error(`No SQLite database found at ${file}. Nothing to migrate.`);
  process.exit(1);
}

// SQLite datetime('now') → "YYYY-MM-DD HH:MM:SS" in UTC.
const toDate = (s) => (s ? new Date(String(s).replace(' ', 'T') + 'Z') : new Date());

const sqlite = new DatabaseSync(file, { readOnly: true });
try {
  await connectDb();

  const userRows = sqlite.prepare('SELECT * FROM users').all();
  for (const u of userRows) {
    await users.replaceOne({ _id: u.id }, {
      name: u.name,
      email: u.email,
      emailLower: String(u.email).trim().toLowerCase(),
      passwordHash: u.password_hash,
      role: u.role,
      active: !!u.active,
      createdAt: toDate(u.created_at),
    }, { upsert: true });
  }

  const invoiceRows = sqlite.prepare('SELECT * FROM invoices').all();
  for (const r of invoiceRows) {
    const data = JSON.parse(r.data);
    await invoices.replaceOne({ _id: r.id }, {
      ...summarize(data),
      number: r.number, // keep exactly what was stored
      data,
      createdBy: r.created_by ?? null,
      updatedBy: r.updated_by ?? null,
      createdAt: toDate(r.created_at),
      updatedAt: toDate(r.updated_at),
    }, { upsert: true });
  }

  const settingRows = sqlite.prepare('SELECT * FROM settings').all();
  for (const s of settingRows) {
    const value = JSON.parse(s.value);
    // Never move the invoice number counter backwards.
    if (s.key === 'invoice_counter') await settings.updateOne({ _id: s.key }, { $max: { value } }, { upsert: true });
    else await settings.updateOne({ _id: s.key }, { $set: { value } }, { upsert: true });
  }

  // New ids continue after the highest migrated ones.
  const maxId = (rows) => rows.reduce((m, r) => Math.max(m, r.id), 0);
  await counters.updateOne({ _id: 'users' }, { $max: { seq: maxId(userRows) } }, { upsert: true });
  await counters.updateOne({ _id: 'invoices' }, { $max: { seq: maxId(invoiceRows) } }, { upsert: true });

  console.log(`Copied ${userRows.length} user(s), ${invoiceRows.length} invoice(s) and ${settingRows.length} setting(s) into MongoDB.`);
  console.log('Everyone will need to sign in again once.');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  sqlite.close();
  await client.close();
}
