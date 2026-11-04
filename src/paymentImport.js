// Payment-gateway report → invoices. Reads the transaction report the gateway exports
// (one payment per row; column names like "Merchant Defined Order Number", "Card Holder Email")
// and keeps only what an invoice needs. Also accepts the report turned sideways (field names down
// the first column, one payment per column) and the "12. Total: 3675" text from the gateway's e-mails.
import { defaults, todayISO } from './data.js';
import { INDUSTRY_BY_ID } from './templates/industries.js';
import { readSpreadsheet } from './xlsx.js';

// Invoice field → report column names, best match first. Matching ignores case, a leading
// "12." and the "#1" the gateway adds to card columns.
const FIELDS = {
  orderId: ['system generated order', 'order id', 'order reference', 'transaction id'],
  orderNo: ['merchant defined order number', 'merchant order number', 'order number', 'reference'],
  status: ['payment status', 'status', 'order status'],
  date: ['date', 'transaction date', 'captured date', 'authorised date'],
  time: ['time', 'transaction time', 'captured time', 'authorised time'],
  total: ['total', 'amount', 'captured amount', 'authorised amount'],
  currency: ['currency'],
  refund: ['refund amount'],
  name: ['cardholder name', 'card holder name', 'customer name', 'name'],
  email: ['card holder email', 'cardholder email', 'customer email', 'email'],
  phone: ['phone number', 'phone', 'mobile'],
  address: ['billing address', 'address'],
  card: ['card number', 'masked card number', 'pan'],
  method: ['payment method'],
  scheme: ['card scheme', 'scheme'],
  bank: ['issuing organization', 'issuing bank', 'issuer'],
  rrn: ['rrn', 'retrieval reference number'],
  authCode: ['authorisation data', 'authorization code', 'auth code'],
};
const KNOWN = new Set(Object.values(FIELDS).flat());

const norm = (s) => String(s ?? '').toLowerCase().replace(/^\s*\d+[.)]\s*/, '').replace(/#\s*\d+\s*$/, '')
  .replace(/[_\-:]+/g, ' ').replace(/\s+/g, ' ').trim();
const EMPTY = new Set(['', 'na', 'n/a', 'null', 'none', '-', '--', 'undefined']);
const clean = (v) => { const s = String(v ?? '').trim(); return EMPTY.has(s.toLowerCase()) ? '' : s; };

// ---------- file → records ({ normalized column name: value }) ----------

export async function readPaymentFile(file) {
  return toRecords(await readSpreadsheet(file));
}

function toRecords(rows) {
  if (!rows.length) return [];
  const known = (cells) => cells.filter((c) => KNOWN.has(norm(c))).length;
  const width = Math.max(...rows.map((r) => r.length));

  // Table: header row, one payment per row (the header may sit below a title or a blank line).
  const headerAt = rows.slice(0, 10).findIndex((r) => known(r) >= 3);
  if (headerAt >= 0) {
    const header = rows[headerAt].map(norm);
    return rows.slice(headerAt + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  }

  // Sideways: field names down the first column, one payment per column.
  if (width > 1 && known(rows.map((r) => r[0])) >= 3) {
    return Array.from({ length: width - 1 }, (_, c) => Object.fromEntries(rows.map((r) => [norm(r[0]), r[c + 1] ?? ''])))
      .filter((rec) => Object.values(rec).some((v) => clean(v)));
  }

  // Lines like "8. Time: 16:19:20"; a field seen twice starts the next payment.
  const records = [];
  let cur = null;
  for (const line of rows.flat()) {
    const m = /^([^:]+):\s*(.*)$/.exec(String(line).trim());
    if (!m || !KNOWN.has(norm(m[1]))) continue;
    const key = norm(m[1]);
    if (!cur || key in cur) records.push(cur = {});
    cur[key] = m[2];
  }
  return records;
}

const pick = (rec, field) => {
  for (const col of FIELDS[field]) { const v = clean(rec[col]); if (v) return v; }
  return '';
};

// ---------- values ----------

const amount = (s) => { const n = parseFloat(String(s).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : 0; };
const pad = (n) => String(n).padStart(2, '0');

// "15/07/2026", "15-07-2026", "2026-07-15", "2026-07-15 16:19:20" → { date: "2026-07-15", time }
// Day comes first in d/m/y dates, as the gateway writes them.
function parseDate(s) {
  const t = /(\d{1,2}):(\d{2})/.exec(s.replace(/^\S*\d{4}\S*/, ''));
  const time = t ? `${pad(t[1])}:${t[2]}` : '';
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return valid(m[1], m[2], m[3], time);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
  if (m) return valid(m[3], m[2], m[1], time);
  return null;
}
function valid(y, mo, d, time) {
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getMonth() !== Number(mo) - 1) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, time };
}

const titleCase = (s) => s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const OK_STATUSES = ['success', 'successful', 'captured', 'purchased', 'paid', 'approved', 'authorised', 'authorized', 'settled', 'completed'];

// One record → { ref, orderNo, date, time, total, currency, customer, payment, problem }.
// problem is set when the payment shouldn't become an invoice.
export function toPayment(rec) {
  const status = pick(rec, 'status');
  const total = amount(pick(rec, 'total'));
  const refund = amount(pick(rec, 'refund'));
  const rawDate = pick(rec, 'date');
  const when = rawDate ? parseDate(rawDate) : { date: todayISO(), time: '' };
  const time = /(\d{1,2}):(\d{2})/.exec(pick(rec, 'time'));

  const email = pick(rec, 'email');
  const holder = pick(rec, 'name');
  const method = pick(rec, 'method');
  const scheme = pick(rec, 'scheme');
  const methodName = method && !/^card$/i.test(method) ? titleCase(method) : '';
  const schemeName = scheme ? titleCase(scheme) : '';

  let problem = '';
  if (status && !OK_STATUSES.includes(status.toLowerCase())) problem = `Payment ${status.toLowerCase()}`;
  else if (!(total > 0)) problem = 'No amount';
  else if (!when) problem = `Date “${rawDate}” not recognised`;
  else if (refund >= total) problem = 'Fully refunded';

  return {
    ref: pick(rec, 'orderId'),
    orderNo: pick(rec, 'orderNo'),
    date: when?.date || '',
    time: time ? `${pad(time[1])}:${time[2]}` : when?.time || '',
    total,
    refund,
    currency: (pick(rec, 'currency') || 'AED').toUpperCase(),
    customer: {
      // The gateway sometimes puts an order reference in the name; fall back to the e-mail then.
      name: /[a-z]/i.test(holder) ? holder : email || 'Customer',
      email,
      phone: pick(rec, 'phone'),
      address: pick(rec, 'address'),
    },
    payment: {
      method: 'Card',
      cardType: methodName && schemeName ? `${methodName} (${schemeName})` : methodName || schemeName,
      cardLast4: (pick(rec, 'card').match(/(\d{4})\D*$/) || [])[1] || '',
      bank: pick(rec, 'bank'),
      txnId: pick(rec, 'rrn') || pick(rec, 'authCode') || pick(rec, 'orderId'),
    },
    problem,
  };
}

// Rows with no order reference or e-mail (blank lines, a report's grand-total row) are dropped.
export async function readPayments(file) {
  return (await readPaymentFile(file)).map(toPayment).filter((p) => p.ref || p.orderNo || p.customer.email);
}

// ---------- payment → invoice data ----------

// options: { template, service, numberFrom: 'sequence' | 'order' }. The company is filled in by the server.
export function paymentToInvoice(p, { template, service, numberFrom }) {
  const base = defaults();
  const cfg = INDUSTRY_BY_ID[template];
  const extras = [
    p.orderNo && { label: 'Order no.', value: p.orderNo },
    p.ref && { label: 'Order ID', value: p.ref },
    p.refund > 0 && { label: 'Refunded', value: `${p.currency} ${p.refund.toFixed(2)}` },
  ].filter(Boolean);
  const { company, ...rest } = base; // eslint-disable-line no-unused-vars
  return {
    ...rest,
    template,
    accent: cfg ? cfg.accent : base.accent,
    doc: {
      ...base.doc,
      title: cfg ? cfg.title : base.doc.title,
      number: numberFrom === 'order' ? p.orderNo : '', // blank → next number in sequence (server)
      date: p.date,
      time: p.time || base.doc.time,
      dueDate: p.date,
      status: 'Paid',
      service,
    },
    customer: { ...base.customer, ...p.customer },
    payment: { ...base.payment, ...p.payment },
    currency: p.currency,
    items: [{ desc: service, qty: 1, price: p.total }],
    extras,
  };
}
