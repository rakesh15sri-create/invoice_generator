import { useEffect, useMemo, useState } from 'react';
import { api, openStoredFile } from '../api.js';
import { StatusBadge, fmtAmount, useConfirm, useToast } from '../components/ui.jsx';
import { fmtDate } from '../data.js';
import { canSeeAll } from '../roles.js';
import { navigate } from '../route.js';
import { TEMPLATE_GROUPS, templateName } from '../templates/index.js';

const STATUSES = ['Paid', 'Successful', 'Pending', 'Unpaid', 'Overdue', 'Cancelled'];
const isSettled = (status) => ['paid', 'successful', 'cancelled'].includes(String(status).toLowerCase());

export default function InvoicesPage({ user, query }) {
  const [filters, setFilters] = useState({
    q: '', template: query.get('template') || '', status: query.get('status') || '', member: query.get('member') || '',
  });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(null); // id of the row being updated
  const toast = useToast();
  const confirm = useConfirm();
  const all = canSeeAll(user);

  // Category/status/search are filtered on the server; team member on the client
  // (managers can't list users, so the member list comes from the invoices themselves).
  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.template) params.set('template', filters.template);
    if (filters.status) params.set('status', filters.status);
    const t = setTimeout(() => {
      setLoading(true);
      api(`/invoices?${params}`)
        .then((r) => { setRows(r); setError(''); })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [filters.q, filters.template, filters.status]);

  const members = useMemo(() => {
    const m = new Map();
    rows.forEach((r) => r.createdBy && m.set(String(r.createdBy), r.createdByName));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const visible = filters.member ? rows.filter((r) => String(r.createdBy) === filters.member) : rows;

  const totalsByCurrency = useMemo(() => {
    const m = new Map();
    visible.filter((r) => r.status.toLowerCase() !== 'cancelled')
      .forEach((r) => m.set(r.currency, (m.get(r.currency) || 0) + r.total));
    return [...m];
  }, [visible]);

  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  const remove = async (r) => {
    if (!(await confirm({
      title: `Delete invoice ${r.number}?`,
      message: `${r.customerName || 'This invoice'} · ${fmtAmount(r.total, r.currency)}. This cannot be undone.`,
      confirmLabel: 'Delete invoice',
      danger: true,
    }))) return;
    try {
      await api(`/invoices/${r.id}`, { method: 'DELETE' });
      setRows((rs) => rs.filter((x) => x.id !== r.id));
      toast(`Invoice ${r.number} deleted.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // Marks the invoice as paid in full without opening the editor.
  const markPaid = async (r) => {
    setWorking(r.id);
    try {
      const { data } = await api(`/invoices/${r.id}`);
      const next = { ...data, doc: { ...data.doc, status: 'Paid' }, amountPaid: '' };
      await api(`/invoices/${r.id}`, { method: 'PUT', body: { data: next } });
      setRows((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: 'Paid' } : x)));
      toast(`Invoice ${r.number} marked as paid.`);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h2>{all ? 'All invoices' : 'My invoices'}</h2>
        <a className="btn primary" href="#/editor">+ Create invoice</a>
      </div>

      <div className="filters">
        <input type="search" placeholder="Search number or customer…" value={filters.q} onChange={set('q')} />
        <select value={filters.template} onChange={set('template')}>
          <option value="">All categories</option>
          {TEMPLATE_GROUPS.map((g) => (
            <optgroup key={g.name} label={g.name}>
              {g.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </optgroup>
          ))}
        </select>
        <select value={filters.status} onChange={set('status')}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        {all && (
          <select value={filters.member} onChange={set('member')}>
            <option value="">All team members</option>
            {members.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="summary-line">
        {loading ? 'Loading…' : `${visible.length} invoice${visible.length === 1 ? '' : 's'}`}        {!loading && totalsByCurrency.map(([cur, total]) => <span key={cur}> · {fmtAmount(total, cur)}</span>)}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Invoice #</th><th>Date</th><th>Customer</th><th>Category</th><th>Status</th>
              <th className="r">Total</th>{all && <th>Created by</th>}<th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`#/editor/${r.id}`)}>
                <td>
                  <b>{r.number}</b>
                  {r.attachmentCount > 0 && (
                    <span className="clip" title={`${r.attachmentCount} attachment${r.attachmentCount === 1 ? '' : 's'}`}>📎{r.attachmentCount}</span>
                  )}
                </td>
                <td>{fmtDate(r.date)}</td>
                <td>{r.customerName}</td>
                <td>{templateName(r.template)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="r num">{fmtAmount(r.total, r.currency)}</td>
                {all && <td>{r.createdByName || '—'}</td>}
                <td className="r row-actions" onClick={(e) => e.stopPropagation()}>
                  {!isSettled(r.status) && (
                    <button className="link" onClick={() => markPaid(r)} disabled={working === r.id} title="Set the status to Paid (paid in full)">
                      {working === r.id ? 'Saving…' : 'Mark paid'}
                    </button>
                  )}
                  {r.pdfId && (
                    <button className="link" title="Open the stored PDF" onClick={() => openStoredFile(r.id, r.pdfId).catch((e) => toast(e.message, 'error'))}>PDF</button>
                  )}
                  <a href={`#/editor?copyOf=${r.id}`} title="Start a new invoice with the same customer and items">Duplicate</a>
                  <a href={`#/editor/${r.id}`}>Open</a>
                  {all && <button className="link danger" onClick={() => remove(r)}>Delete</button>}
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={all ? 8 : 7} className="empty-cell">
                  {Object.values(filters).some(Boolean) ? (
                    <>No invoices match these filters. <button className="link" onClick={() => setFilters({ q: '', template: '', status: '', member: '' })}>Clear filters</button></>
                  ) : (
                    <>No invoices yet. <a href="#/editor">Create your first invoice</a></>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
