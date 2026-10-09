import { Router } from 'express';
import { ah, invoices } from './db.js';
import { userNames } from './invoices.js';

const round2 = (n) => Math.round(n * 100) / 100;
const PAID = new Set(['paid', 'successful']);
const isCancelled = (s) => String(s).toLowerCase() === 'cancelled';

function addTo(map, key, init) {
  if (!map.has(key)) map.set(key, init());
  return map.get(key);
}

function lastMonths(endISO, count) {
  const end = endISO ? new Date(endISO + 'T00:00') : new Date();
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// Dashboard numbers. Amounts are only summed within one currency; cancelled invoices
// are counted in the status breakdown but excluded from billed/paid/outstanding.
export const statsRouter = Router();

async function loadRows(from, to) {
  const filter = {};
  if (from || to) {
    filter.docDate = {};
    if (from) filter.docDate.$gte = String(from);
    if (to) filter.docDate.$lte = String(to);
  }
  const rows = await invoices.find(filter, {
    projection: { template: 1, currency: 1, total: 1, paid: 1, status: 1, docDate: 1, createdBy: 1, customerName: 1 },
  }).toArray();
  const names = await userNames(rows.map((r) => r.createdBy));
  return rows.map((r) => ({
    template: r.template, currency: r.currency, total: r.total, paid: r.paid, status: r.status,
    doc_date: r.docDate, created_by: r.createdBy ?? null, customer_name: r.customerName, user_name: names.get(r.createdBy) ?? null,
  }));
}

function headline(rows) {
  const t = { count: 0, billed: 0, paid: 0, outstanding: 0 };
  for (const r of rows) {
    const cancelled = isCancelled(r.status);
    t.count += 1;
    t.billed += cancelled ? 0 : r.total;
    t.paid += cancelled ? 0 : r.paid;
  }
  t.outstanding = t.billed - t.paid;
  return { count: t.count, billed: round2(t.billed), paid: round2(t.paid), outstanding: round2(t.outstanding) };
}

statsRouter.get('/', ah(async (req, res) => {
  const { from, to, prevFrom, prevTo } = req.query;
  const rows = await loadRows(from, to);

  const currencyCounts = new Map();
  for (const r of rows) currencyCounts.set(r.currency, (currencyCounts.get(r.currency) || 0) + 1);
  const currencies = [...currencyCounts].map(([currency, count]) => ({ currency, count })).sort((a, b) => b.count - a.count);
  const currency = req.query.currency && currencyCounts.has(req.query.currency) ? req.query.currency : currencies[0]?.currency || 'AED';

  const totals = { count: 0, billed: 0, paid: 0, outstanding: 0, cancelled: 0 };
  const byCategory = new Map();
  const byStatus = new Map();
  const byUser = new Map();
  const byCustomer = new Map();
  const months = lastMonths(to, 12);
  const byMonth = new Map(months.map((m) => [m, { month: m, count: 0, billed: 0, paid: 0 }]));

  for (const r of rows.filter((x) => x.currency === currency)) {
    const cancelled = isCancelled(r.status);
    const billed = cancelled ? 0 : r.total;
    const paid = cancelled ? 0 : r.paid;

    totals.count += 1;
    totals.billed += billed;
    totals.paid += paid;
    if (cancelled) totals.cancelled += 1;

    const cat = addTo(byCategory, r.template, () => ({ template: r.template, count: 0, billed: 0, paid: 0 }));
    cat.count += 1; cat.billed += billed; cat.paid += paid;

    const statusKey = PAID.has(String(r.status).toLowerCase()) ? 'Paid' : r.status;
    const st = addTo(byStatus, statusKey, () => ({ status: statusKey, count: 0, amount: 0 }));
    st.count += 1; st.amount += r.total;

    const uKey = r.created_by ?? 0;
    const u = addTo(byUser, uKey, () => ({ userId: r.created_by, name: r.user_name || 'Removed user', count: 0, billed: 0, paid: 0 }));
    u.count += 1; u.billed += billed; u.paid += paid;

    const cKey = (r.customer_name || 'Unnamed customer').trim();
    const c = addTo(byCustomer, cKey.toLowerCase(), () => ({ name: cKey, count: 0, billed: 0, paid: 0 }));
    c.count += 1; c.billed += billed; c.paid += paid;

  }

  // The monthly trend always covers the 12 months up to the end of the period,
  // independent of the period filter, so short periods still show context.
  const trendFrom = `${months[0]}-01`;
  const trendTo = to || new Date().toISOString().slice(0, 10);
  for (const r of (await loadRows(trendFrom, trendTo)).filter((x) => x.currency === currency)) {
    const mo = byMonth.get(String(r.doc_date || '').slice(0, 7));
    if (!mo || isCancelled(r.status)) { if (mo) mo.count += 1; continue; }
    mo.count += 1; mo.billed += r.total; mo.paid += r.paid;
  }

  const fin = (o) => ({ ...o, billed: round2(o.billed), paid: round2(o.paid), outstanding: round2(o.billed - o.paid) });
  const previous = prevFrom && prevTo ? headline((await loadRows(prevFrom, prevTo)).filter((r) => r.currency === currency)) : null;
  res.json({
    currency,
    currencies,
    totals: { ...fin(totals) },
    byCategory: [...byCategory.values()].map(fin).sort((a, b) => b.billed - a.billed || b.count - a.count),
    byStatus: [...byStatus.values()].map((s) => ({ ...s, amount: round2(s.amount) })).sort((a, b) => b.count - a.count),
    byMonth: [...byMonth.values()].map(fin),
    byUser: [...byUser.values()].map(fin).sort((a, b) => b.billed - a.billed),
    byCustomer: [...byCustomer.values()].map(fin).sort((a, b) => b.billed - a.billed).slice(0, 6),
    // Same headline numbers for the previous period of equal length (for "vs previous" deltas).
    previous,
  });
}));
