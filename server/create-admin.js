// Create an admin, or reset an existing user's password and make them an active admin.
// Usage: npm run create-admin -- <email> <password> [name]
import { destroyUserSessions, hashPassword } from './auth.js';
import { client, connectDb, nextId, users } from './db.js';

const [email, password, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ') || 'Admin';

if (!email || !password) {
  console.error('Usage: npm run create-admin -- <email> <password> [name]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

try {
  await connectDb();
  const emailLower = email.trim().toLowerCase();
  const existing = await users.findOne({ emailLower });
  if (existing) {
    await users.updateOne({ _id: existing._id }, { $set: { passwordHash: hashPassword(password), role: 'admin', active: true } });
    await destroyUserSessions(existing._id);
    console.log(`Updated ${email}: password reset, role set to admin, access enabled.`);
  } else {
    await users.insertOne({
      _id: await nextId('users'), name, email: email.trim(), emailLower,
      passwordHash: hashPassword(password), role: 'admin', active: true, createdAt: new Date(),
    });
    console.log(`Created admin ${email}.`);
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.close();
}
