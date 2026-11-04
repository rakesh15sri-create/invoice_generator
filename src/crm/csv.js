// CSV read/write for client import/export and the audit log export.

// RFC 4180-style parser: quoted fields, "" escapes, commas/newlines inside quotes, ; or tab separators.
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = [',', ';', '\t'].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === sep) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

// Client fields and the column names CRMs commonly use for them.
export const CLIENT_FIELDS = [
  { key: 'name', label: 'Name', match: ['name', 'full name', 'client name', 'client', 'customer', 'customer name', 'contact name', 'account name'] },
  { key: 'email', label: 'Email', match: ['email', 'e-mail', 'email address', 'mail', 'primary email'] },
  { key: 'phone', label: 'Phone', match: ['phone', 'mobile', 'phone number', 'mobile number', 'telephone', 'tel', 'contact number', 'cell'] },
  { key: 'country', label: 'Country', match: ['country', 'nationality', 'country of residence', 'location'] },
  { key: 'accountNo', label: 'Account no.', match: ['account', 'account no', 'account number', 'account id', 'login', 'mt4', 'mt5', 'client id', 'cid'] },
  { key: 'rm', label: 'RM', match: ['rm', 'relationship manager', 'account manager', 'owner', 'manager', 'sales agent', 'agent'] },
  { key: 'notes', label: 'Notes', match: ['notes', 'note', 'comments', 'comment', 'remarks', 'description'] },
];

const norm = (s) => String(s).toLowerCase().replace(/[_\-.#]+/g, ' ').replace(/\s+/g, ' ').trim();

// header index for each field, or -1. First/last name columns are joined into the name.
export function autoMap(header) {
  const h = header.map(norm);
  const map = {};
  for (const f of CLIENT_FIELDS) {
    let i = h.findIndex((c) => f.match.includes(c));
    if (i < 0) i = h.findIndex((c) => f.match.some((m) => m.length > 3 && c.includes(m)));
    map[f.key] = i;
  }
  if (map.name < 0) {
    const first = h.findIndex((c) => ['first name', 'firstname', 'given name'].includes(c));
    const last = h.findIndex((c) => ['last name', 'lastname', 'surname', 'family name'].includes(c));
    if (first >= 0) map.name = last >= 0 ? `${first}+${last}` : first;
  }
  return map;
}

export function applyMap(rows, map) {
  const get = (r, idx) => {
    if (idx === -1 || idx == null || idx === '') return '';
    if (typeof idx === 'string' && idx.includes('+')) return idx.split('+').map((i) => (r[Number(i)] || '').trim()).filter(Boolean).join(' ');
    return (r[Number(idx)] || '').trim();
  };
  return rows.map((r) => Object.fromEntries(CLIENT_FIELDS.map((f) => [f.key, get(r, map[f.key])])));
}

const cell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  // Leading = + - @ would run as a formula in Excel.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');

export function downloadCsv(filename, header, rows) {
  const blob = new Blob(['﻿' + toCsv(header, rows)], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
