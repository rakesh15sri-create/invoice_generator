// Defaults, form layout and formatting helpers shared by the editor and templates.

// Form layout: [path, label, type?, span?]. Types: text (default), email, date, time, number, textarea, select:<a|b|c>, file
export const FORM = [
  { key: 'company', title: 'Your company', fields: [
    ['company.name', 'Company name'],
    ['company.legal', 'Legal suffix (e.g. FZE LLC)'],
    ['company.tagline', 'Tagline'],
    ['company.phone', 'Phone'],
    ['company.email', 'Email', 'email'],
    ['company.taxId', 'Tax / TRN no.'],
    ['company.address', 'Address', 'textarea'],
    ['company.logo', 'Logo', 'file'],
  ]},
  { key: 'document', title: 'Invoice details', fields: [
    ['doc.title', 'Document title'],
    ['doc.number', 'Invoice / Ref no.'],
    ['doc.date', 'Date', 'date'],
    ['doc.time', 'Time', 'time'],
    ['doc.dueDate', 'Due date', 'date'],
    ['doc.status', 'Status', 'select:Paid|Successful|Pending|Unpaid|Overdue|Cancelled'],
    ['doc.service', 'Service / description', 'text', 'full'],
  ]},
  { key: 'customer', title: 'Customer (bill to)', fields: [
    ['customer.name', 'Name'],
    ['customer.email', 'Email', 'email'],
    ['customer.phone', 'Phone'],
    ['customer.company', 'Company'],
    ['customer.address', 'Address', 'textarea'],
  ]},
  { key: 'payment', title: 'Payment', fields: [
    ['payment.method', 'Method', 'select:Card|Bank Transfer|Cash|Cheque|Online|Other'],
    ['payment.cardType', 'Card / wallet type'],
    ['payment.cardLast4', 'Card last 4 digits'],
    ['payment.bank', 'Issuing bank'],
    ['payment.txnId', 'Transaction / RRN ID'],
    ['payment.bankDetails', 'Bank details for payment (IBAN etc.)', 'textarea'],
  ]},
  { key: 'amounts', title: 'Tax, discount & currency', fields: [
    ['currency', 'Currency', 'select:AED|USD|EUR|GBP|INR|SAR|QAR|OMR|KWD|BHD'],
    ['taxRate', 'Tax / VAT %', 'number'],
    ['discount', 'Discount (amount)', 'number'],
    ['amountPaid', 'Amount paid (blank = full)', 'number'],
  ]},
  { key: 'footer', title: 'Notes & footer', fields: [
    ['confirmText', 'Confirmation message ({service} is replaced)', 'textarea'],
    ['notes', 'Notes / terms', 'textarea'],
    ['footer', 'Footer line'],
  ]},
];

export const pad = (n, w = 2) => String(n).padStart(w, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayISO = () => iso(new Date());
export const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const addDays = (s, n) => { const d = new Date(s + 'T00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const randomTxn = () => Array.from({ length: 12 }, () => Math.floor(Math.random() * 10)).join('');

export function defaults() {
  const date = todayISO();
  return {
    template: 'confirm',
    accent: '#2e7d5b',
    company: {
      name: 'YOUR COMPANY', legal: 'LLC', tagline: 'IT Solutions & Services',
      phone: '+971 00 000 0000', email: 'billing@yourcompany.com', taxId: '',
      address: 'Office 000, Business Bay\nDubai, UAE', logo: '',
    },
    doc: {
      title: 'Payment Confirmation', number: `INV-${new Date().getFullYear()}-0001`,
      date, time: nowTime(), dueDate: addDays(date, 14), status: 'Paid', service: 'Service Rendered',
    },
    customer: { name: 'Customer Name', email: 'customer@example.com', phone: '', company: '', address: '' },
    payment: { method: 'Card', cardType: 'Apple Pay', cardLast4: '0000', bank: 'Bank Name', txnId: randomTxn(), bankDetails: '' },
    currency: 'AED',
    taxRate: 0,
    discount: 0,
    amountPaid: '',
    items: [{ desc: 'Service Rendered', qty: 1, price: 9000 }],
    extras: [], // [{ label, value }] — industry-specific details (check-in, seat no., patient ID…)
    confirmText: 'This document serves as confirmation that the above payment was received successfully for {service}.',
    notes: '',
    footer: 'Thank you for your payment',
  };
}

export function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) deepMerge(base[k], over[k]);
    else base[k] = over[k];
  }
  return base;
}

export const getPath = (obj, p) => p.split('.').reduce((o, k) => (o == null ? '' : o[k]), obj);
export function setPath(obj, p, v) {
  const next = structuredClone(obj);
  const keys = p.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), next)[last] = v;
  return next;
}

export const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
export const money = (v, cur) => `${cur} ${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function totals(inv) {
  const subtotal = inv.items.reduce((s, it) => s + num(it.qty) * num(it.price), 0);
  const discount = num(inv.discount);
  const tax = (subtotal - discount) * num(inv.taxRate) / 100;
  const total = subtotal - discount + tax;
  const paid = inv.amountPaid === '' || inv.amountPaid == null ? total : num(inv.amountPaid);
  return { subtotal, discount, tax, total, paid, balance: total - paid };
}

export const isPaid = (inv) => ['paid', 'successful'].includes(String(inv.doc.status).toLowerCase());

export function hexToSoft(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#e8f3ed';
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(c + (255 - c) * 0.9);
  return `rgb(${mix(n >> 16)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// localStorage can throw (private mode, blocked storage) — never let it break the app.
export const storage = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
