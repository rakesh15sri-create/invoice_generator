// Runs the app as a normal long-running server (local use, Render, Railway, a VPS…).
// On Vercel, api/index.js is used instead.
import { app, ensureDb, explainDbError } from './app.js';
import { storageEnabled } from './imagekit.js';
import { openBrowser } from './open-browser.js';

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  if (process.env.OPEN_BROWSER) {
    console.log(`\n  ✔ Invoice Generator is running at ${url}\n    Your browser should open automatically.`);
    console.log('    Keep this window open while you use the app. Close it to stop the app.\n');
    openBrowser(url);
  } else {
    console.log(`Invoice API listening on ${url}`);
  }
  if (!storageEnabled()) {
    console.log('  Note: file storage (ImageKit) is off — add IMAGEKIT_PRIVATE_KEY and IMAGEKIT_URL_ENDPOINT to .env to store PDFs and attachments.\n');
  }
  // Connect right away so problems show up at start-up, not at the first sign-in.
  ensureDb()
    .then(() => console.log('  ✔ Connected to MongoDB.'))
    .catch((err) => console.error(`\n  ${err.message.split('\n')[0]}\n  → ${explainDbError(err)}.\n  The app keeps trying on every request and connects by itself once this is fixed.\n`));
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already used by another program.`);
    console.error('  Close that program, or use another port: set PORT=3002 in the .env file and start again.\n');
    process.exit(1);
  }
  throw err;
});
