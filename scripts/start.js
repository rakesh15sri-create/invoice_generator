// One-command start: builds the app if needed, starts the server and opens the browser.
// Used by "npm start" and the "Start Invoice App.bat" double-click launcher.
import '../server/env.js';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowser } from '../server/open-browser.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3001;
const URL = `http://localhost:${PORT}`;

// Already running (e.g. launcher double-clicked twice)? Just open it.
try {
  const r = await fetch(`${URL}/api/auth/status`);
  if (r.ok) {
    console.log(`Invoice Generator is already running: ${URL}`);
    openBrowser(URL);
    process.exit(0);
  }
} catch { /* not running yet */ }

const newest = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((t, e) => {
  const p = join(dir, e.name);
  return Math.max(t, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
}, 0);

const built = join(root, 'dist', 'index.html');
const stale = !existsSync(built) || Math.max(newest(join(root, 'src')), statSync(join(root, 'index.html')).mtimeMs) > statSync(built).mtimeMs;
if (stale) {
  console.log('Preparing the app (only after updates, takes about 20 seconds)…');
  execSync('npx vite build --logLevel error', { cwd: root, stdio: 'inherit' });
}

process.env.OPEN_BROWSER = '1';
await import('../server/index.js');
