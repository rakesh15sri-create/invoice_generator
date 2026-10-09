# invoice_generator

Invoice generator for teams: create invoices from ready-made templates, download them as PDF, attach files, and track billing on a dashboard. Team members get their own logins (Admin, Manager, Staff).

Built with React (Vite) and Express. Data lives in MongoDB; PDFs, attachments and logos are stored privately in ImageKit.

## Setup

1. Install Node.js 22 or newer.
2. `npm install`
3. Copy `.env.example` to `.env` and fill in:
   - `MONGODB_URI`, `MONGODB_DB`: your MongoDB (e.g. Atlas) connection
   - `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`: ImageKit → Developer options
4. Start it:
   - development: `npm run dev` → http://localhost:5173
   - production: `npm run build`, then `node server/index.js` → http://localhost:3001

The first person to open the app creates the admin account. To create or reset an admin from the command line:

```
npm run create-admin -- email@example.com StrongPassword "Name"
```

## Hosting

Use a host that runs an always-on Node server (Render, Railway, a VPS…).

- Build command: `npm install && npm run build`
- Start command: `node server/index.js`
- Enter the `.env` values in the host's environment settings (never commit `.env`), plus `BROWSER=none`.
- In MongoDB Atlas → Network Access, allow the host's IP address.
