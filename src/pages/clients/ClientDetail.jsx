import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import { Drawer, Icon, Pill, fmtAmount, fmtDateTime, useConfirm, useToast } from '../../components/ui.jsx';
import { MAIL_STATUS_BY_ID, mailStatusLabel, ordinal, statusColor, statusLabel } from '../../crm/domain.js';
import { useCrm } from '../../crm/store.jsx';
import { navigate } from '../../route.js';

export default function ClientDetail({ c, user, duplicates, onEdit, onClose }) {
  const { drop, withdrawals, mails } = useCrm();
  const [wd, setWd] = useState(null);
  const [cases, setCases] = useState(null);
  const toast = useToast();
  const confirm = useConfirm();

  // Full history for this client (the board only loads recent requests). Refreshes with live updates.
  useEffect(() => {
    api(`/withdrawals/client/${c.id}`).then(setWd).catch(() => setWd([]));
    api(`/mails/client/${c.id}`).then(setCases).catch(() => setCases([]));
  }, [c.id, withdrawals, mails]);

  const remove = async () => {
    if (!(await confirm({
      title: `Delete ${c.name}?`,
      message: 'The client record is deleted. Their withdrawals and mail cases are kept, but no longer linked to a client.',
      confirmLabel: 'Delete client', danger: true,
    }))) return;
    try {
      await api(`/clients/${c.id}`, { method: 'DELETE' });
      drop.client(c.id);
      toast(`${c.name} deleted.`);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <Drawer
      onClose={onClose}
      title={c.name}
      sub={[c.accountNo, c.country, c.backfilled ? 'Imported (backfilled)' : null].filter(Boolean).join(' · ')}
      actions={<button onClick={onEdit}><Icon name="edit" size={16} />Edit</button>}
    >
      <div className="kv-grid">
        <div><span>Email</span><b>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</b></div>
        <div><span>Phone</span><b>{c.phone || '—'}</b></div>
        <div><span>Account</span><b>{c.accountNo || '—'}</b></div>
        <div><span>RM</span><b>{c.rmName || '—'}</b></div>
        <div><span>Added</span><b>{fmtDateTime(c.createdAt)}</b></div>
        <div><span>Country</span><b>{c.country || '—'}</b></div>
      </div>
      {c.notes && <p className="note-box">{c.notes}</p>}

      <div className="row">
        <a className="btn primary" href={`#/withdrawals?new=1&client=${c.id}`}><Icon name="plus" size={16} />New withdrawal</a>
        <a className="btn" href={`#/mails?new=1&client=${c.id}`}><Icon name="mail" size={16} />Log a mail</a>
        {user.role === 'admin' && <button className="ghost danger" onClick={remove}><Icon name="trash" size={16} />Delete</button>}
      </div>

      {duplicates.length > 0 && (
        <section className="panel warn-panel">
          <h3>Possible duplicates</h3>
          <p className="muted small">Same email or phone number as this client.</p>
          <ul className="link-list">
            {duplicates.map((d) => (
              <li key={d.id} onClick={() => navigate(`#/clients/${d.id}`)}>
                <b>{d.name}</b><span className="muted small">{[d.email, d.phone, d.accountNo].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h3>Withdrawals {wd && <span className="muted">({wd.length})</span>}</h3>
        {!wd ? <p className="muted small">Loading…</p> : !wd.length ? <p className="muted small">No withdrawal requests yet.</p> : (
          <ul className="link-list">
            {wd.map((w) => (
              <li key={w.id} onClick={() => navigate(`#/withdrawals/${w.id}`)}>
                <span><b>{w.ref}</b> <Pill color={statusColor(w.status)}>{statusLabel(w.status)}</Pill></span>
                <span className="r"><b>{fmtAmount(w.amount, w.currency)}</b><small className="muted">{fmtDateTime(w.requestedAt)}</small></span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h3>Mail cases {cases && <span className="muted">({cases.length})</span>}</h3>
        {!cases ? <p className="muted small">Loading…</p> : !cases.length ? <p className="muted small">No mails logged yet.</p> : (
          <ul className="link-list">
            {cases.map((m) => (
              <li key={m.id} onClick={() => navigate(`#/mails/${m.id}`)}>
                <span><b>{m.ticket}</b> {m.subject}<small className="muted"> · {ordinal(m.mailNo)} mail{m.followUps ? ` · ${m.followUps} follow-up${m.followUps === 1 ? '' : 's'}` : ''}</small></span>
                <span className="r"><Pill color={MAIL_STATUS_BY_ID[m.status]?.color}>{mailStatusLabel(m.status)}</Pill><small className="muted">{fmtDateTime(m.createdAt)}</small></span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Drawer>
  );
}
