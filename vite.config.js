import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import './server/env.js'; // PORT from .env

export default defineConfig({
  plugins: [react()],
  server: {
    // API runs separately (npm run server) — forward /api calls to it in dev.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT || 3001}`,
        // If the API server isn't running, answer with a plain message instead of a blank 500
        // (the reason is in the "api" output of npm run dev).
        configure: (proxy) => proxy.on('error', (err, req, res) => {
          if (res.headersSent || !res.writeHead) return;
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'The app is temporarily unavailable. Please try again in a few minutes. If this keeps happening, contact your administrator.' }));
        }),
      },
    },
  },
});
