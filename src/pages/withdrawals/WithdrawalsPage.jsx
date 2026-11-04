import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Icon, Loading, Pill, compact, fmtDateTime, useConfirm, useToast } from '../../components/ui.jsx';
import { downloadCsv } from '../../crm/csv.js';
import {
  AGE_FILTERS, DEPARTMENTS, STATUSES, isOpen, needsComment, statusColor, statusLabel,
} from '../../crm/domain.js';
import { useCrm, useNow } from '../../crm/store.jsx';
import { storage } from '../../data.js';
import { navigate } from '../../route.js';
import Analytics from './Analytics.jsx';
import Board from './Board.jsx';
import WithdrawalDetail from './WithdrawalDetail.jsx';
import WithdrawalForm from './WithdrawalForm.jsx';

const VIEWS = [
  { id: 'board', label: 'Board', icon: 'board' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { id: 'audit', label: 'Audit log', icon: 'list' },
];
const NO_FILTERS = { rm: '', dept: '', status: '', age: '' };
const ENTRY_TEXT = { created: 'Created', status: 'Status', back: 'Moved back', edit: 'Edited', comment: 'Comment' };

const money = (rows) => {
  const m = new Map();
  rows.forEach((w) => m.set(w.currency, (m.get(w.currency) || 0) + w.amount));
  const list = [...m].sort((a, b) => b[1] - a[1]);
  if (!list.length) return '—';
  return `${list[0][0]} ${compact(list[0][1])}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
};

export default function WithdrawalsPage({ user, param, query, search }) {
  const { withdrawals, put, wRange, setWRange } = useCrm();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [view, setViewState] = useState(() => storage.get('invgen.wdView', 'board'));
  const [editing, setEditing] = useState(null);
  const now = useNow(30000);
  const toast = useToast();
  const confirm = useConfirm();
  const setView = (v) => { setViewState(v); storage.set('invgen.wdView', v); };
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  const rms = useMemo(() => [...new Set((withdrawals || []).map((w) => w.rmName).filter(Boolean))].sort(), [withdrawals]);

  // Everything except the status filter (KPIs show counts per status for the other filters).
  const base = useMemo(() => {
    const q = search.trim().toLowerCase();
    const age = AGE_FILTERS.find((a) => a.id === filters.age);
    return (withdrawals || []).filter((w) => {
      if (filters.rm && (filters.rm === '-' ? w.rmName : w.rmName !== filters.rm)) return false;
      if (filters.dept && w.department !== filters.dept) return false;
      if (age && !(isOpen(w.status) && now - Date.parse(w.requestedAt) > age.ms)) return false;
      if (q && ![w.ref, w.clientName, w.accountNo, w.rmName, w.note, w.method].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    });
  }, [withdrawals, filters, search, now]);
  const rows = filters.status ? base.filter((w) => w.status === filters.status) : base;

  const move = useCallback(async (w, to) => {
    let comment = '';
    if (needsComment(to)) {
      comment = await confirm({
        title: `Move ${w.ref} to ${statusLabel(to)}?`,
        message: `${w.clientName}. A reason is required for ${statusLabel(to)}.`,
        confirmLabel: `Move to ${statusLabel(to)}`,
        danger: to === 'rejected',
        input: { label: 'Reason', placeholder: 'e.g. waiting for bank details from the client', required: true },
      });
      if (!comment) return;
    }
    // Show the move straight away; put the card back if the server says no.
    put.withdrawal({ ...w, status: to });
    try {
      put.withdrawal(await api(`/withdrawals/${w.id}`, { method: 'PATCH', body: { status: to, comment } }));
      toast(`${w.ref} moved to ${statusLabel(to)}.`);
    } catch (e) {
      put.withdrawal(w);
      toast(e.message, 'error');
    }
  }, [confirm, put, toast]);

  const exportAudit = () => {
    const out = [];
    rows.forEach((w) => w.history.forEach((e) => out.push([
      new Date(e.at).toISOString(), w.ref, w.clientName, w.accountNo, w.amount, w.currency, ENTRY_TEXT[e.type] || e.type,
      e.from ? statusLabel(e.from) : '', e.to ? statusLabel(e.to) : '',
      [e.comment, ...(e.changes || []).map((c) => `${c.field}: ${c.from} → ${c.to}`)].filter(Boolean).join(' | '), e.byName, e.byDept,
    ])));
    out.sort((a, b) => (a[0] < b[0] ? 1 : -1));
    downloadCsv(`withdrawals-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Time', 'Ref', 'Client', 'Account', 'Amount', 'Currency', 'Action', 'From', 'To', 'Comment / changes', 'By', 'Department'], out);
    toast(`Exported ${out.length} audit entries.`);
  };

  const detail = param && withdrawals?.find((w) => String(w.id) === param);
  const closeDetail = () => navigate('#/withdrawals');
  const showNew = query.get('new') === '1';
  const anyFilter = Object.values(filters).some(Boolean) || wRange.from || wRange.to;

  if (!withdrawals) return <div className="page"><Loading /></div>;

  return (
    <div className="page wide">
      <div className="kpi-strip">
        {STATUSES.map((s) => {
          const items = base.filter((w) => w.status === s.id);
          const on = filters.status === s.id;
          return (
            <button key={s.id} className={`kpi-chip${on ? ' on' : ''}`} style={{ '--c': s.color }} onClick={() => setFilters({ ...filters, status: on ? '' : s.id })} title={`${s.label} · owned by ${s.dept}. Click to ${on ? 'show all' : 'filter'}.`}>
              <span className="kc-label"><i />{s.label}</span>
              <b>{items.length}</b>
              <small>{money(items)}</small>
            </button>
          );
        })}
      </div>

      <div className="toolbar-row">
        <div className="filters">
          <select value={filters.rm} onChange={set('rm')} aria-label="RM">
            <option value="">All RMs</option>
            <option value="-">Not assigned</option>
            {rms.map((r) => <option key={r}>{r}</option>)}
          </select>
          <select value={filters.dept} onChange={set('dept')} aria-label="Department">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={filters.status} onChange={set('status')} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={filters.age} onChange={set('age')} aria-label="Waiting time">
            <option value="">Any waiting time</option>
            {AGE_FILTERS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
          <label className="date-range" title="Request date. Empty = all open requests plus the last 7 days.">
            <input type="date" value={wRange.from || ''} onChange={(e) => setWRange({ ...wRange, from: e.target.value })} aria-label="Requested from" />
            <span>–</span>
            <input type="date" value={wRange.to || ''} onChange={(e) => setWRange({ ...wRange, to: e.target.value })} aria-label="Requested to" />
          </label>
          {anyFilter && <button className="link" onClick={() => { setFilters(NO_FILTERS); setWRange({}); }}>Clear filters</button>}
        </div>
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((v) => (
            <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}><Icon name={v.icon} size={15} />{v.label}</button>
          ))}
        </div>
      </div>

      <div className="summary-line">
        {rows.length} request{rows.length === 1 ? '' : 's'} · {money(rows)}
        {!wRange.from && !wRange.to && <span className="muted"> · showing all open requests and the last 7 days</span>}
        {view === 'board' && <span className="muted only-desktop"> · drag a card to another column to change its status</span>}
        {view === 'board' && <span className="muted only-mobile"> · press and hold a card to drag it</span>}
      </div>

      {view === 'board' && <Board rows={rows} now={now} statuses={filters.status ? [filters.status] : null} onMove={move} />}
      {view === 'analytics' && <Analytics rows={rows} now={now} onFilter={(f) => { setFilters({ ...filters, ...f }); setView('board'); }} />}
      {view === 'audit' && <AuditLog rows={rows} onExport={exportAudit} />}

      {detail && <WithdrawalDetail w={detail} user={user} onClose={closeDetail} onEdit={() => setEditing(detail)} />}
      {param && !detail && <MissingDetail key={param} id={param} user={user} onClose={closeDetail} onEdit={setEditing} />}
      {showNew && <WithdrawalForm clientId={query.get('client')} onClose={() => navigate('#/withdrawals')} onSaved={(s) => setTimeout(() => navigate(`#/withdrawals/${s.id}`), 0)} />}
      {editing && <WithdrawalForm row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// A request linked from elsewhere (e.g. an old one on a client page) that is outside the loaded range.
function MissingDetail({ id, user, onClose, onEdit }) {
  const [w, setW] = useState(null);
  const toast = useToast();
  useEffect(() => {
    api(`/withdrawals/${id}`).then(setW).catch((e) => { toast(e.message, 'error'); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return w ? <WithdrawalDetail w={w} user={user} onClose={onClose} onEdit={() => onEdit(w)} /> : null;
}

function AuditLog({ rows, onExport }) {
  const [limit, setLimit] = useState(200);
  const entries = useMemo(() => rows
    .flatMap((w) => w.history.map((e) => ({ ...e, w })))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), [rows]);

  return (
    <>
      <div className="row space">
        <span className="muted small">{entries.length} entries</span>
        <button onClick={onExport} disabled={!entries.length}><Icon name="download" size={16} />Export CSV</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Time</th><th>Request</th><th>Action</th><th>Change</th><th>Comment</th><th>By</th></tr></thead>
          <tbody>
            {entries.slice(0, limit).map((e, i) => (
              <tr key={i} className="clickable" onClick={() => navigate(`#/withdrawals/${e.w.id}`)}>
                <td className="nowrap">{fmtDateTime(e.at)}</td>
                <td><b>{e.w.ref}</b><div className="muted small">{e.w.clientName}</div></td>
                <td>{ENTRY_TEXT[e.type] || e.type}</td>
                <td>
                  {e.to && <>{e.from && <><Pill color={statusColor(e.from)}>{statusLabel(e.from)}</Pill> → </>}<Pill color={statusColor(e.to)}>{statusLabel(e.to)}</Pill></>}
                  {e.changes?.map((c, k) => <div key={k} className="small">{c.field} changed</div>)}
                </td>
                <td className="wrap">{e.comment}</td>
                <td>{e.byName}<div className="muted small">{e.byDept}</div></td>
              </tr>
            ))}
            {!entries.length && <tr><td colSpan={6} className="empty-cell">No activity in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      {entries.length > limit && <div className="row center"><button onClick={() => setLimit(limit + 500)}>Show more</button></div>}
    </>
  );
}
