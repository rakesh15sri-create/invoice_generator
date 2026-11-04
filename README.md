# invoice_generator

Invoice generator and withdrawal CRM for teams: create invoices from ready-made templates, download them as PDF, attach files and track billing on a dashboard; track client withdrawal requests, clients and client mails live. Team members get their own logins (Admin, Manager, Staff).

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

## Withdrawal CRM

Sidebar → **Withdrawal CRM**. Everyone on the team can use it. Only admins can delete records or wipe the CRM data.

**Withdrawals**: a 10-stage board (Received → With RM → Under review → Pending / Hold → Compliance → Approved → Processing → Completed / Rejected).
- Each stage has an owner department that changes automatically; "Move to next stage" follows the main path.
- Rules: an account can have only one open request; Pending, Hold and Rejected need a comment; amounts of 100,000 or more must be confirmed.
- Drag a card to another column to change its status (on touch screens, press and hold first).
- Each request has a full history, time spent in each status, and "Move back" to correct a mistake.
- Also: KPI cards per status (click to filter), filters (RM, department, status, waiting time, request date), analytics, and an audit log with CSV export.
- By default the board shows every open request plus the last 7 days.

**Clients**: a searchable, sortable table with paging, a column picker and duplicate detection (same email or phone).
- CSV import auto-maps common CRM column names and marks the clients as *backfilled*. "Undo last import" removes the whole batch.
- CSV export. Each client page shows possible duplicates, their withdrawals and their mail cases.

**Client mails**: each email is logged as a case with a ticket number, issue type, related issues, priority, mailbox and CC.
- The app counts the client's 1st / 2nd / 3rd mail, and lets you add a new mail to an open case as a follow-up.
- Actions: reply sent, client wrote again (reopens a resolved case), send to a department, escalate, internal note, waiting for client, resolve (outcome + solution), compliance flag, and **undo last action**.
- Files are stored privately in ImageKit, one folder per ticket.
- Views: list, by department, and insights. The sidebar badge shows cases waiting for a reply.

**Live updates**: the app polls the server every 5 seconds (`/api/crm/changes`), so it also works on Vercel.
- The status bar shows "✓ Live · updated …", and changes by other people pop up as notifications.

Set each person's **department** (Support, RM, Back Office, Compliance, Finance) on the Team page. It is stamped on every change they make.
For sample data, set `DEMO=true` and use the account menu at the top of the sidebar → *Load demo data*.

The look is a CRM theme with a collapsible sidebar (a slide-out menu on phones), a header search (press **/**) and a dark-mode switch.
All colours are CSS tokens at the top of `src/styles.css`.

## Hosting

**Vercel** (configured in `vercel.json`): the pages are served by Vercel and the API runs as a
serverless function from `api/index.js`.

- Import the GitHub repo in Vercel; the build settings come from `vercel.json`.
- Project → Settings → Environment Variables: add `MONGODB_URI`, `MONGODB_DB`,
  `IMAGEKIT_PRIVATE_KEY`, `IMAGEKIT_URL_ENDPOINT`, `IMAGEKIT_FOLDER`, then redeploy.
- MongoDB Atlas → Network Access: Vercel has no fixed IP, so allow `0.0.0.0/0` and use a strong database password.
- Uploads are limited to 4 MB per file on Vercel.

**Always-on Node server** (Render, Railway, a VPS…):

- Build command: `npm install && npm run build`
- Start command: `node server/index.js`
- Enter the `.env` values in the host's environment settings (never commit `.env`), plus `BROWSER=none`.
- In MongoDB Atlas → Network Access, allow the host's IP address.
