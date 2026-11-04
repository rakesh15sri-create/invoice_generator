// Trading-CRM "transactions export" (CSV or .xlsx) → withdrawal requests. Only the columns a
// request needs are read; every other column (date of birth, KYC, affiliate, MT5 group…) is ignored.
import { readSpreadsheet } from '../xlsx.js';
import { CURRENCIES, LARGE_AMOUNT } from './domain.js';

// Request field → export column names (matched ignoring case, spaces and punctuation).
const COLUMNS = {
  txnId: ['transaction id', 'txn id'],
  type: ['type'],
  fileStatus: ['status'],
  name: ['full name', 'name', 'client name'],
  email: ['email', 'e mail'],
  mt5: ['mt5 id', 'mt5', 'login'],
  userId: ['user id', 'client id'],
  amount: ['amount'],
  currency: ['currency'],
  method: ['payment method'],
  gateway: ['payment gateway'],
  network: ['psp transaction id'],
  created: ['created', 'date', 'request date'],
  comment: ['internal comment'],
  bankName: ['bank name'],
  bankAccount: ['account number'],
  iban: ['iban'],
  swift: ['swift code', 'swift'],
};
const REQUIRED = { name: 'Full Name', amount: 'Amount' };

const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\-.#:]+/g, ' ').replace(/\s+/g, ' ').trim();

// "11/3/2026, 2:12:50 PM" (month first, as the export writes it) or "2026-11-03 14:12:50".
function parseCreated(s) {
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?/i.exec(s.replace(/^[^,\s]*/, ''));
  let h = t ? Number(t[1]) : 0;
  if (t?.[4]) h = (h % 12) + (/p/i.test(t[4]) ? 12 : 0);
  const at = (y, mo, d) => {
    const date = new Date(y, mo - 1, d, h, t ? Number(t[2]) : 0, t?.[3] ? Number(t[3]) : 0);
    return date.getMonth() === mo - 1 ? date : null;
  };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return at(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return at(+m[3], +m[1], +m[2]);
  return null;
}

function methodOf(method, gateway) {
  const s = `${method} ${gateway}`.toLowerCase();
  if (/bank|wire|transfer/.test(s)) return 'Bank wire';
  if (/usdt|crypto|trc|erc|btc/.test(s)) return 'Crypto';
  if (/card|ngenius|visa|master/.test(s)) return 'Card';
  if (/wallet|skrill|neteller/.test(s)) return 'E-wallet';
  return 'Other';
}

// File → [{ ref, clientName, email, accountNo, amount, currency, method, requestedAt, note, fileStatus, problem }]
export async function readWithdrawals(file) {
  const rows = await readSpreadsheet(file);
  const headerAt = rows.slice(0, 10).findIndex((r) => r.some((c) => norm(c) === 'full name') || r.filter((c) => norm(c) === 'amount' || norm(c) === 'transaction id').length === 2);
  if (headerAt < 0) throw new Error('This doesn’t look like a transactions export. The first row needs column names such as “Transaction ID”, “Full Name” and “Amount”.');
  const header = rows[headerAt].map(norm);
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, names]) => [k, header.findIndex((h) => names.includes(h))]));
  const missing = Object.keys(REQUIRED).filter((k) => col[k] < 0).map((k) => REQUIRED[k]);
  if (missing.length) throw new Error(`The file has no ${missing.join(' or ')} column.`);

  return rows.slice(headerAt + 1).map((r) => {
    const get = (k) => (col[k] < 0 ? '' : String(r[col[k]] ?? '').trim());
    const amount = Math.round(parseFloat(get('amount').replace(/[^\d.-]/g, '')) * 100) / 100;
    const currency = get('currency').toUpperCase();
    const created = get('created');
    const requestedAt = created ? parseCreated(created) : null;
    const type = get('type').toLowerCase();
    const crypto = methodOf(get('method'), get('gateway')) === 'Crypto';
    const bank = [
      get('bankName') && `Bank: ${get('bankName')}`,
      get('iban') && `IBAN: ${get('iban')}`,
      get('swift') && `SWIFT: ${get('swift')}`,
      get('bankAccount') && `Account no.: ${get('bankAccount')}`,
      crypto && get('network') && `Network: ${get('network')}`,
    ].filter(Boolean).join(' · ');
    const fileStatus = get('fileStatus').toLowerCase();
    const note = [
      `Imported from transactions export${get('txnId') ? ` (${get('txnId')})` : ''}${fileStatus ? `, status there: ${fileStatus}` : ''}.`,
      get('comment') && `Comment: ${get('comment')}`,
      bank,
    ].filter(Boolean).join('\n');

    let problem = '';
    if (type && !/withdraw/.test(type)) problem = `Not a withdrawal (${type})`;
    else if (!get('name')) problem = 'No client name';
    else if (!(amount > 0)) problem = 'No amount';
    else if (created && !requestedAt) problem = `Date “${created}” not recognised`;

    return {
      ref: get('txnId'),
      clientName: get('name'),
      email: get('email'),
      accountNo: get('mt5') || get('userId'), // older rows have no MT5 login: the CRM user id stands in
      amount,
      currency: CURRENCIES.includes(currency) ? currency : 'USD',
      method: methodOf(get('method'), get('gateway')),
      requestedAt: requestedAt ? requestedAt.toISOString() : null,
      note,
      fileStatus,
      large: amount >= LARGE_AMOUNT,
      problem,
    };
  }).filter((w) => w.ref || w.clientName || w.amount > 0);
}
