import { spawn } from 'node:child_process';

// Set BROWSER=none to skip (e.g. on a server).
export function openBrowser(url) {
  if (process.env.BROWSER === 'none') return;
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch { /* no browser available — the URL is printed instead */ }
}
