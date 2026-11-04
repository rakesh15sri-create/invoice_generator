import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api.js';
import Bars, { Card } from '../../components/Bars.jsx';
import { Icon, Loading, Pill, fmtDateTime, useToast } from '../../components/ui.jsx';
import {
  DEPARTMENTS, ISSUE_TYPES, MAIL_STATUSES, MAIL_STATUS_BY_ID, OUTCOMES, PRIORITIES, fmtDuration, isMailOpen, mailStatusLabel, ordinal,
} from '../../crm/domain.js';
import { useCrm, useNow } from '../../crm/store.jsx';
import { storage } from '../../data.js';
import { navigate } from '../../route.js';
import MailDetail from './MailDetail.jsx';
import MailForm from './MailForm.jsx';

const VIEWS = [
  { id: 'list', label: 'List', icon: 'list' },
  { id: 'board', label: 'By department', icon: 'board' },
  { id: 'insights', label: 'Insights', icon: 'chart' },
];
const NO_FILTERS = { status: 'open', dept: '', issue: '', priority: '', pending: false };
const PRIO_RANK = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export default function MailsPage({ user, param, query, search }) {
  const { mails, mRange, setMRange } = useCrm();
  const [filters, setFilters] = useState(NO_FILTERS);
  const [view, setViewState] = useState(() => storage.get('invgen.mailView', 'list'));
  const [editing, setEditing] = useState(null);
  const now = useNow(60000);
  const setView = (v) => { setViewState(v); storage.set('invgen.mailView', v); };
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (mails || []).filter((m) => {
      if (filters.status === 'open' ? !isMailOpen(m.status) : filters.status && m.status !== filters.status) return false;
      if (filters.dept && m.department !== filters.dept) return false;
      if (filters.issue && m.issueType !== filters.issue && !m.relatedIssues.includes(filters.issue)) return false;
      if (filters.priority && m.priority !== filters.priority) return false;
      if (filters.pending && !(m.replyPending && isMailOpen(m.status))) return false;
      if (q && ![m.ticket, m.clientName, m.clientEmail, m.subject, m.mailbox].some((v) => String(v || '').toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (b.replyPending && isMailOpen(b.status)) - (a.replyPending && isMailOpen(a.status))
      || PRIO_RANK[a.priority] - PRIO_RANK[b.priority]
      || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }, [mails, filters, search]);

  const pendingCount = (mails || []).filter((m) => m.replyPending && isMailOpen(m.status)).length;
  const detail = param && mails?.find((m) => String(m.id) === param);
  const close = () => navigate('#/mails');
  const changed = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS) || mRange.from || mRange.to;

  if (!mails) return <div className="page"><Loading /></div>;

  return (
    <div className="page wide">
      <div className="toolbar-row">
        <div className="filters">
          <select value={filters.status} onChange={set('status')} aria-label="Status">
            <option value="open">All open cases</option>
            <option value="">All cases</option>
            {MAIL_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <select value={filters.dept} onChange={set('dept')} aria-label="Department">
            <option value="">All departments</option>
            {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={filters.issue} onChange={set('issue')} aria-label="Issue type">
            <option value="">All issues</option>
            {ISSUE_TYPES.map((d) => <option key={d}>{d}</option>)}
          </select>
          <select value={filters.priority} onChange={set('priority')} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((d) => <option key={d}>{d}</option>)}
          </select>
          <label className="toggle chip-toggle">
            <input type="checkbox" checked={filters.pending} onChange={(e) => setFilters({ ...filters, pending: e.target.checked })} />
            Reply pending{pendingCount > 0 && <span className="sb-count alert">{pendingCount}</span>}
          </label>
          <label className="date-range" title="Date logged. Empty = all open cases plus the last 60 days.">
            <input type="date" value={mRange.from || ''} onChange={(e) => setMRange({ ...mRange, from: e.target.value })} aria-label="Logged from" />
            <span>–</span>
            <input type="date" value={mRange.to || ''} onChange={(e) => setMRange({ ...mRange, to: e.target.value })} aria-label="Logged to" />
          </label>
          {changed && <button className="link" onClick={() => { setFilters(NO_FILTERS); setMRange({}); }}>Reset filters</button>}
        </div>
        <div className="seg" role="group" aria-label="View">
          {VIEWS.map((v) => <button key={v.id} className={view === v.id ? 'on' : ''} onClick={() => setView(v.id)}><Icon name={v.icon} size={15} />{v.label}</button>)}
        </div>
      </div>

      <div className="summary-line">{rows.length} case{rows.length === 1 ? '' : 's'}{!mRange.from && !mRange.to && <span className="muted"> · open cases plus the last 60 days</span>}</div>

      {view === 'list' && <MailList rows={rows} now={now} />}
      {view === 'board' && <DeptBoard rows={rows} now={now} />}
      {view === 'insights' && <Insights rows={mails} now={now} onFilter={(f) => { setFilters({ ...NO_FILTERS, status: '', ...f }); setView('list'); }} />}

      {detail && <MailDetail m={detail} user={user} onClose={close} onEdit={() => setEditing(detail)} />}
      {param && !detail && <MissingCase key={param} id={param} user={user} onClose={close} onEdit={setEditing} />}
      {query.get('new') === '1' && <MailForm clientId={query.get('client')} onClose={close} onSaved={(m) => setTimeout(() => navigate(`#/mails/${m.id}`), 0)} />}
      {editing && <MailForm row={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// A case outside the loaded range (e.g. opened from an old client record).
function MissingCase({ id, user, onClose, onEdit }) {
  const [m, setM] = useState(null);
  const toast = useToast();
  useEffect(() => {
    api(`/mails/${id}`).then(setM).catch((e) => { toast(e.message, 'error'); onClose(); });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return m ? <MailDetail m={m} user={user} onClose={onClose} onEdit={() => onEdit(m)} /> : null;
}

const waited = (m, now) => (m.replyPending && isMailOpen(m.status) ? now - Date.parse(m.lastClientAt || m.createdAt) : null);

function MailList({ rows, now }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead><tr><th>Ticket</th><th>Client</th><th>Subject</th><th>Issue</th><th>Status</th><th>Department</th><th>Updated</th></tr></thead>
        <tbody>
          {rows.map((m) => {
            const w = waited(m, now);
            return (
              <tr key={m.id} className={`clickable${m.priority === 'Urgent' ? ' urgent-row' : ''}`} onClick={() => navigate(`#/mails/${m.id}`)}>
                <td className="nowrap"><b>{m.ticket}</b>{m.files.length > 0 && <span className="clip" title="Files">📎{m.files.length}</span>}<div className="muted small">{ordinal(m.mailNo)} mail{m.followUps ? ` · +${m.followUps}` : ''}</div></td>
                <td>{m.clientName}<div className="muted small">{m.mailbox}</div></td>
                <td className="wrap">
                  {m.subject}
                  <div className="tag-row tight">
                    {w != null && <span className="tag alert" title="The client is waiting for a reply">Reply pending · {fmtDuration(w)}</span>}
                    {m.complianceFlag && <span className="tag danger">Compliance</span>}
                    {m.priority !== 'Normal' && <span className={`tag prio-${m.priority.toLowerCase()}`}>{m.priority}</span>}
                  </div>
                </td>
                <td>{m.issueType}</td>
                <td><Pill color={MAIL_STATUS_BY_ID[m.status]?.color}>{mailStatusLabel(m.status)}</Pill></td>
                <td>{m.department}</td>
                <td className="nowrap">{fmtDateTime(m.updatedAt)}</td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={7} className="empty-cell">No cases match. <a href="#/mails?new=1">Log a mail</a></td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function DeptBoard({ rows, now }) {
  return (
    <div className="board">
      {DEPARTMENTS.map((d) => {
        const items = rows.filter((m) => m.department === d);
        return (
          <section key={d} className="col" style={{ '--c': 'var(--primary)' }}>
            <header className="col-head"><span className="col-dot" /><b>{d}</b><span className="col-count">{items.length}</span></header>
            <div className="col-cards">
              {items.map((m) => {
                const w = waited(m, now);
                return (
                  <div key={m.id} className="wcard" role="button" tabIndex={0} onClick={() => navigate(`#/mails/${m.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`#/mails/${m.id}`)}>
                    <div className="wcard-top"><span className="wcard-ref">{m.ticket}</span><Pill color={MAIL_STATUS_BY_ID[m.status]?.color}>{mailStatusLabel(m.status)}</Pill></div>
                    <b className="wcard-client">{m.clientName}</b>
                    <div className="wcard-sub">{m.subject}</div>
                    <div className="tag-row tight">
                      {w != null && <span className="tag alert">Reply · {fmtDuration(w)}</span>}
                      {m.priority !== 'Normal' && <span className={`tag prio-${m.priority.toLowerCase()}`}>{m.priority}</span>}
                      {m.complianceFlag && <span className="tag danger">Compliance</span>}
                    </div>
                  </div>
                );
              })}
              {!items.length && <div className="col-empty">No cases</div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Insights({ rows, now, onFilter }) {
  const open = rows.filter((m) => isMailOpen(m.status));
  const resolved = rows.filter((m) => m.status === 'resolved' && m.resolvedAt);
  const avgResolve = resolved.length ? resolved.reduce((t, m) => t + (Date.parse(m.resolvedAt) - Date.parse(m.createdAt)), 0) / resolved.length : 0;
  const pending = open.filter((m) => m.replyPending);
  const count = (list, fn) => {
    const c = new Map();
    list.forEach((m) => [].concat(fn(m)).forEach((k) => k && c.set(k, (c.get(k) || 0) + 1)));
    return [...c].sort((a, b) => b[1] - a[1]);
  };
  const repeat = count(rows, (m) => m.clientName).filter(([, n]) => n > 1).slice(0, 8);

  return (
    <div className="dash-grid">
      <div className="span-12 stat-row">
        <div className="stat"><span>Open cases</span><b>{open.length}</b><small>{open.filter((m) => m.escalated).length} escalated</small></div>
        <div className="stat"><span>Reply pending</span><b>{pending.length}</b><small>{pending.length ? `longest ${fmtDuration(Math.max(...pending.map((m) => now - Date.parse(m.lastClientAt || m.createdAt))))}` : 'all answered'}</small></div>
        <div className="stat"><span>Resolved</span><b>{resolved.length}</b><small>avg {fmtDuration(avgResolve)} to resolve</small></div>
        <div className="stat"><span>Compliance flags</span><b>{rows.filter((m) => m.complianceFlag).length}</b><small>on loaded cases</small></div>
      </div>
      <Card className="span-6" title="Open cases by department" sub="Click to filter">
        <Bars rows={count(open, (m) => m.department).map(([k, v]) => ({ label: k, value: v, onClick: () => onFilter({ status: 'open', dept: k }) }))} empty="No open cases." />
      </Card>
      <Card className="span-6" title="Issues" sub="Main issue and related issues, all loaded cases">
        <Bars rows={count(rows, (m) => [m.issueType, ...m.relatedIssues]).map(([k, v]) => ({ label: k, value: v, onClick: () => onFilter({ issue: k }) }))} />
      </Card>
      <Card className="span-6" title="Outcomes" sub="Resolved cases">
        <Bars rows={OUTCOMES.map((o) => ({ label: o, value: resolved.filter((m) => m.outcome === o).length })).filter((r) => r.value)} empty="No resolved cases yet." />
      </Card>
      <Card className="span-6" title="Clients writing most" sub="More than one case">
        <Bars rows={repeat.map(([k, v]) => ({ label: k, value: v }))} empty="No client has more than one case." />
      </Card>
      <Card className="span-12" title="Cases by status">
        <Bars rows={MAIL_STATUSES.map((s) => ({ label: s.label, value: rows.filter((m) => m.status === s.id).length, color: s.color, onClick: () => onFilter({ status: s.id }) })).filter((r) => r.value)} />
      </Card>
    </div>
  );
}
