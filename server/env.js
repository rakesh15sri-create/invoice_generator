// Loads settings into process.env from the app folder: first .env.local (local overrides, e.g. a
// local MongoDB), then .env. Import this first. A variable that is already set wins, so the
// environment beats .env.local, and .env.local beats .env.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const name of ['.env.local', '.env']) {
  const file = join(dir, name);
  if (existsSync(file)) process.loadEnvFile(file);
}
