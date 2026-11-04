import { useState } from 'react';
import { api } from '../../api.js';
import { Drawer, Icon, Pill, fmtAmount, fmtDateTime, useConfirm, useToast } from '../../components/ui.jsx';
import {
  STATUSES, fmtDuration, isOpen, needsComment, nextStatus, statusColor, statusLabel, statusPath, statusStints,
} from '../../crm/domain.js';
import { useCrm, useNow } from '../../crm/store.jsx';

const ENTRY_TEXT = { created: 'Created', status: 'Status changed', back: 'Moved back (correction)', edit: 'Details edited', comment: 'Comment' };
const show = (v) => {
  if (v == null || v === '') return '—';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return fmtDateTime(v);
  return String(v);
};

export default function WithdrawalDetail({ w, user, onClose, onEdit }) {
  const { put, drop } = useCrm();
  const toast = useToast();
  const confirm = useConfirm();
  const now = useNow(30000);
  const [to, setTo] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const call = async (fn, done) => {
    setBusy(true);
    try {
      const saved = await fn();
      put.withdrawal(saved);
      toast(done(saved));
      setTo('');
      setComment('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const next = nextStatus(w.status);
  const path = statusPath(w.history);
  const prev = path[path.length - 2];
  const stints = statusStints(w, now);
  const maxStint = Math.max(...stints.map((s) => s.ms), 1);
  const commentNeeded = to && needsComment(to);

  const moveNext = () => call(() => api(`/withdrawals/${w.id}/next`, { method: 'POST', body: {} }), (s) => `${s.ref} moved to ${statusLabel(s.status)}.`);
  const update = (e) => {
    e.preventDefault();
    if (!to && !comment.trim()) return;
    call(() => api(`/withdrawals/${w.id}`, { method: 'PATCH', body: { ...(to && { status: to }), comment } }),
      (s) => (to ? `${s.ref} is now ${statusLabel(s.status)}.` : 'Comment added.'));
  };
  const moveBack = async () => {
    const reason = await confirm({
      title: `Move ${w.ref} back to ${statusLabel(prev)}?`,
      message: 'Use this to correct a status that was set by mistake. It is recorded in the history.',
      confirmLabel: 'Move back',
      input: { label: 'Reason (optional)', placeholder: 'e.g. moved to the wrong column' },
    });
    if (reason === false) return;
    call(() => api(`/withdrawals/${w.id}/back`, { method: 'POST', body: { comment: reason } }), (s) => `${s.ref} moved back to ${statusLabel(s.status)}.`);
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${w.ref}?`, message: `${w.clientName} · ${fmtAmount(w.amount, w.currency)}. The request and its history are deleted for everyone. This cannot be undone.`, confirmLabel: 'Delete request', danger: true }))) return;
    try {
      await api(`/withdrawals/${w.id}`, { method: 'DELETE' });
      drop.withdrawal(w.id);
      toast(`${w.ref} deleted.`);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <Drawer
      onClose={onClose}
      title={<div className="dt-title"><span>{w.ref}</span><Pill color={statusColor(w.status)}>{statusLabel(w.status)}</Pill></div>}
      sub={`${w.clientName} · owned by ${w.department}`}
      actions={<button onClick={onEdit}><Icon name="edit" size={16} />Edit</button>}
    >
      <div className="amount-hero">
        <div>
          <small>Amount</small>
          <b>{fmtAmount(w.amount, w.currency)}</b>
        </div>
        {isOpen(w.status) && (
          <div className="r">
            <small>Pending for</small>
            <b>{fmtDuration(now - Date.parse(w.requestedAt))}</b>
          </div>
        )}
      </div>

      <div className="kv-grid">
        <div><span>Client</span><b>{w.clientId ? <a href={`#/clients/${w.clientId}`}>{w.clientName}</a> : w.clientName}</b></div>
        <div><span>Account</span><b>{w.accountNo}</b></div>
        <div><span>Method</span><b>{w.method}</b></div>
        <div><span>RM</span><b>{w.rmName || '—'}</b></div>
        <div><span>Requested</span><b>{fmtDateTime(w.requestedAt)}</b></div>
        <div><span>In this status</span><b>{fmtDuration(now - Date.parse(w.statusSince))}</b></div>
      </div>
      {w.note && <p className="note-box">{w.note}</p>}

      <section className="panel control">
        <h3>Control panel</h3>
        {next && (
          <button className="primary block" onClick={moveNext} disabled={busy}>
            Move to next stage: {statusLabel(next)} <Icon name="arrowRight" size={16} />
          </button>
        )}
        <form onSubmit={update} className="stack-form">
          <div className="grid2 tight">
            <label className="field">
              <span>Change status</span>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">— Keep {statusLabel(w.status)} —</option>
                {STATUSES.filter((s) => s.id !== w.status).map((s) => <option key={s.id} value={s.id}>{s.label} ({s.dept})</option>)}
              </select>
            </label>
            <div className="field self-end">
              <button disabled={busy || (!to && !comment.trim()) || (commentNeeded && !comment.trim())}>{to ? 'Update status' : 'Add comment'}</button>
            </div>
          </div>
          <label className="field">
            <span>Comment{commentNeeded ? ` (required for ${statusLabel(to)})` : ''}</span>
            <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={commentNeeded ? 'Why is it on ' + statusLabel(to) + '?' : 'Optional'} />
          </label>
        </form>
        <div className="row">
          {prev && <button className="ghost" onClick={moveBack} disabled={busy}><Icon name="undo" size={16} />Move back to {statusLabel(prev)}</button>}
          {user.role === 'admin' && <button className="ghost danger" onClick={remove}><Icon name="trash" size={16} />Delete</button>}
        </div>
      </section>

      <section className="panel">
        <h3>Time in each status</h3>
        <ul className="stints">
          {stints.map((s, i) => (
            <li key={i}>
              <span className="stint-label"><Pill color={statusColor(s.status)}>{statusLabel(s.status)}</Pill><small>{s.dept}</small></span>
              <span className="stint-bar"><i style={{ width: `${(s.ms / maxStint) * 100}%`, background: statusColor(s.status) }} /></span>
              <span className="stint-val">{fmtDuration(s.ms)}{i === stints.length - 1 && isOpen(s.status) ? ' (now)' : ''}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h3>Activity history</h3>
        <ol className="timeline">
          {[...w.history].reverse().map((e, i) => (
            <li key={i}>
              <span className="tl-dot" style={{ background: e.to ? statusColor(e.to) : 'var(--muted)' }} />
              <div>
                <div className="tl-head">
                  <b>{ENTRY_TEXT[e.type] || e.type}</b>
                  {e.to && <span>{e.from ? `${statusLabel(e.from)} → ` : ''}{statusLabel(e.to)}</span>}
                </div>
                {e.changes?.map((c, k) => <div key={k} className="tl-change">{c.field}: <s>{show(c.from)}</s> → {show(c.to)}</div>)}
                {e.comment && <div className="tl-comment">{e.comment}</div>}
                <small className="muted">{e.byName}{e.byDept ? ` · ${e.byDept}` : ''} · {fmtDateTime(e.at)}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </Drawer>
  );
}
