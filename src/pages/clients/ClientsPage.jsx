import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { Icon, Loading, fmtDateTime, useConfirm, useToast } from '../../components/ui.jsx';
import { downloadCsv } from '../../crm/csv.js';
import { emailKey, phoneKey } from '../../crm/domain.js';
import { useCrm } from '../../crm/store.jsx';
import { storage } from '../../data.js';
import { navigate } from '../../route.js';
import ClientDetail from './ClientDetail.jsx';
import ClientForm from './ClientForm.jsx';
import ImportDialog from './ImportDialog.jsx';

const COLUMNS = [
  { key: 'name', label: 'Name', always: true },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'accountNo', label: 'Account no.' },
  { key: 'country', label: 'Country' },
  { key: 'rmName', label: 'RM' },
  { key: 'source', label: 'Source' },
  { key: 'createdAt', label: 'Added' },
];
const DEFAULT_COLS = ['name', 'email', 'phone', 'accountNo', 'rmName', 'source'];
const PAGE_SIZES = [25, 50, 100, 250];

// id → ids of other clients with the same email or phone.
export function findDuplicates(list) {
  const byKey = new Map();
  const add = (k, id) => { if (k) byKey.set(k, [...(byKey.get(k) || []), id]); };
  list.forEach((c) => { add('e:' + emailKey(c.email), c.id); add('p:' + phoneKey(c.phone), c.id); });
  const dups = new Map();
  for (const [k, ids] of byKey) {
    if (k === 'e:' || k === 'p:' || ids.length < 2) continue;
    ids.forEach((id) => dups.set(id, [...new Set([...(dups.get(id) || []), ...ids.filter((x) => x !== id)])]));
  }
  return dups;
}

export default function ClientsPage({ user, param, query, search }) {
  const { clients, reload } = useCrm();
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(() => storage.get('invgen.clientPage', 25));
  const [cols, setCols] = useState(() => storage.get('invgen.clientCols', DEFAULT_COLS));
  const [dupOnly, setDupOnly] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [colMenu, setColMenu] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => { storage.set('invgen.clientCols', cols); }, [cols]);
  useEffect(() => { storage.set('invgen.clientPage', size); }, [size]);
  useEffect(() => { setPage(0); }, [search, dupOnly, size, sort]);

  const dups = useMemo(() => findDuplicates(clients || []), [clients]);
  const lastImport = useMemo(() => (clients || []).reduce((m, c) => (c.importBatch > (m?.importBatch || 0) ? c : m), null), [clients]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    const list = (clients || []).filter((c) => {
      if (dupOnly && !dups.has(c.id)) return false;
      if (!q) return true;
      return [c.name, c.email, c.accountNo, c.country, c.rmName].some((v) => String(v || '').toLowerCase().includes(q))
        || (qDigits.length >= 3 && String(c.phone || '').replace(/\D/g, '').includes(qDigits));
    });
    const k = sort.key;
    return list.sort((a, b) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * sort.dir);
  }, [clients, search, dupOnly, dups, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const shown = rows.slice(page * size, page * size + size);
  const visibleCols = COLUMNS.filter((c) => c.always || cols.includes(c.key));
  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));

  const undoImport = async () => {
    const n = clients.filter((c) => c.importBatch === lastImport.importBatch).length;
    if (!(await confirm({
      title: 'Undo the last import?',
      message: `This deletes the ${n} clients added by the import on ${fmtDateTime(lastImport.createdAt)}.`,
      confirmLabel: `Delete ${n} clients`,
      danger: true,
    }))) return;
    try {
      const r = await api('/clients/import/last', { method: 'DELETE' });
      await reload('client');
      toast(`Import undone: ${r.removed} clients removed.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const exportCsv = () => {
    downloadCsv(`clients-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Name', 'Email', 'Phone', 'Account no.', 'Country', 'RM', 'Notes', 'Source', 'Possible duplicate', 'Added'],
      rows.map((c) => [c.name, c.email, c.phone, c.accountNo, c.country, c.rmName, c.notes, c.backfilled ? 'Imported (backfilled)' : 'Manual', dups.has(c.id) ? 'Yes' : '', c.createdAt]));
    toast(`Exported ${rows.length} clients.`);
  };

  const cell = (c, key) => {
    if (key === 'name') {
      return <><b>{c.name}</b>{dups.has(c.id) && <span className="tag warn" title="Same email or phone as another client">Possible duplicate</span>}</>;
    }
    if (key === 'source') return c.backfilled ? <span className="tag">Backfilled</span> : <span className="muted">Manual</span>;
    if (key === 'createdAt') return fmtDateTime(c.createdAt);
    return c[key] || <span className="muted">—</span>;
  };

  if (!clients) return <div className="page"><Loading /></div>;
  const detail = param && clients.find((c) => String(c.id) === param);

  return (
    <div className="page wide">
      <div className="toolbar-row">
        <div className="filters">
          <label className="toggle chip-toggle">
            <input type="checkbox" checked={dupOnly} onChange={(e) => setDupOnly(e.target.checked)} />
            Duplicates only{dups.size > 0 && <span className="sb-count alert">{dups.size}</span>}
          </label>
        </div>
        <div className="row tight-row">
          <button onClick={() => setImporting(true)}><Icon name="upload" size={16} />Import CSV</button>
          {lastImport && <button onClick={undoImport} title="Delete the clients from the most recent import"><Icon name="undo" size={16} />Undo last import</button>}
          <button onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={16} />Export CSV</button>
          <ColumnPicker open={colMenu} setOpen={setColMenu} cols={cols} setCols={setCols} />
        </div>
      </div>

      <div className="summary-line">{rows.length.toLocaleString('en-US')} client{rows.length === 1 ? '' : 's'}{rows.length !== clients.length && ` of ${clients.length.toLocaleString('en-US')}`}</div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {visibleCols.map((c) => (
                <th key={c.key}>
                  <button className="th-sort" onClick={() => sortBy(c.key)} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
                    {c.label}{sort.key === c.key && <span>{sort.dir > 0 ? ' ▲' : ' ▼'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => navigate(`#/clients/${c.id}`)}>
                {visibleCols.map((col) => <td key={col.key}>{cell(c, col.key)}</td>)}
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={visibleCols.length} className="empty-cell">
                {clients.length ? 'No clients match.' : <>No clients yet. <a href="#/clients?new=1">Add a client</a> or import a CSV file.</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <label>Rows per page <select value={size} onChange={(e) => setSize(Number(e.target.value))}>{PAGE_SIZES.map((n) => <option key={n}>{n}</option>)}</select></label>
        <span>{rows.length ? `${page * size + 1}–${Math.min(rows.length, (page + 1) * size)} of ${rows.length}` : '0'}</span>
        <button onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Previous page">‹</button>
        <button onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label="Next page">›</button>
      </div>

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {query.get('new') === '1' && <ClientForm onClose={() => navigate('#/clients')} onSaved={(c) => setTimeout(() => navigate(`#/clients/${c.id}`), 0)} />}
      {editing && <ClientForm row={editing} onClose={() => setEditing(null)} />}
      {detail && <ClientDetail c={detail} user={user} duplicates={(dups.get(detail.id) || []).map((id) => clients.find((x) => x.id === id)).filter(Boolean)} onEdit={() => setEditing(detail)} onClose={() => navigate('#/clients')} />}
    </div>
  );
}

function ColumnPicker({ open, setOpen, cols, setCols }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);
  return (
    <div className="pop-wrap" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-expanded={open}><Icon name="columns" size={16} />Columns</button>
      {open && (
        <div className="menu right">
          {COLUMNS.filter((c) => !c.always).map((c) => (
            <label key={c.key} className="menu-check">
              <input type="checkbox" checked={cols.includes(c.key)} onChange={(e) => setCols(e.target.checked ? [...cols, c.key] : cols.filter((k) => k !== c.key))} />
              {c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
