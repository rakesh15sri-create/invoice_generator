import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Modal, useToast } from '../../components/ui.jsx';
import { DEPARTMENTS, ISSUE_TYPES, MAILBOXES, PRIORITIES, emailKey, isMailOpen, ordinal } from '../../crm/domain.js';
import { useCrm } from '../../crm/store.jsx';
import { toLocalInput } from '../withdrawals/WithdrawalForm.jsx';

const clientLabel = (c) => `${c.name}${c.email ? ` · ${c.email}` : ''}`;

// Log a client email as a new case — or, when the client already has an open case, as a follow-up on it.
// With `row`, edits the case details instead.
export default function MailForm({ row, clientId, onClose, onSaved }) {
  const { clients, mails, put } = useCrm();
  const toast = useToast();
  const preset = clientId && clients?.find((c) => c.id === Number(clientId));
  const [f, setF] = useState(() => ({
    clientId: row?.clientId ?? preset?.id ?? '',
    clientText: row ? row.clientName : preset ? clientLabel(preset) : '',
    clientName: row?.clientName || preset?.name || '',
    clientEmail: row?.clientEmail || preset?.email || '',
    subject: row?.subject || '', text: '', issueType: row?.issueType || 'Withdrawal', relatedIssues: row?.relatedIssues || [],
    priority: row?.priority || 'Normal', mailbox: row?.mailbox || MAILBOXES[0], cc: row?.cc || '', department: 'Support',
    receivedAt: toLocalInput(),
  }));
  const [followOn, setFollowOn] = useState(''); // id of an open case to add this mail to
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); };
  const byLabel = useMemo(() => new Map((clients || []).map((c) => [clientLabel(c), c])), [clients]);

  const onClient = (e) => {
    const text = e.target.value;
    const c = byLabel.get(text);
    setError('');
    setFollowOn('');
    if (c) setF({ ...f, clientText: text, clientId: c.id, clientName: c.name, clientEmail: c.email || f.clientEmail });
    else setF({ ...f, clientText: text, clientId: '', clientName: text });
  };

  // This client's cases: for mail counting and offering a follow-up.
  const theirs = useMemo(() => {
    if (row || !mails) return [];
    const key = emailKey(f.clientEmail);
    return mails.filter((m) => (f.clientId ? m.clientId === Number(f.clientId) : key ? emailKey(m.clientEmail) === key : f.clientName && m.clientName === f.clientName));
  }, [mails, f.clientId, f.clientEmail, f.clientName, row]);
  const openCases = theirs.filter((m) => isMailOpen(m.status));

  const toggleRelated = (t) => setF({ ...f, relatedIssues: f.relatedIssues.includes(t) ? f.relatedIssues.filter((x) => x !== t) : [...f.relatedIssues, t] });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let saved;
      if (row) {
        const { clientId: cid, clientName, clientEmail, subject, issueType, relatedIssues, priority, mailbox, cc } = f;
        saved = await api(`/mails/${row.id}`, { method: 'PUT', body: { clientId: cid, clientName, clientEmail, subject, issueType, relatedIssues, priority, mailbox, cc } });
        toast(`${saved.ticket} updated.`);
      } else if (followOn) {
        saved = await api(`/mails/${followOn}/followup`, { method: 'POST', body: { text: [f.subject, f.text].filter(Boolean).join('\n\n') } });
        toast(`Added as a follow-up on ${saved.ticket}.`);
      } else {
        saved = await api('/mails', { method: 'POST', body: { ...f, clientId: f.clientId || null, receivedAt: new Date(f.receivedAt).toISOString() } });
        toast(`${saved.ticket} logged — ${f.clientName}’s ${ordinal(saved.mailNo)} mail.`);
      }
      put.mail(saved);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={row ? `Edit ${row.ticket}` : 'Log a client mail'}
      sub={row ? row.clientName : 'Each email becomes a case with its own ticket number.'}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" form="mail-form" disabled={busy}>{busy ? 'Saving…' : row ? 'Save changes' : followOn ? 'Add follow-up' : 'Log mail'}</button>
      </>}
    >
      <form id="mail-form" className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>Client {f.clientId ? <em className="ok-text">· linked</em> : null}</span>
          <input list="mail-clients" required value={f.clientText} onChange={onClient} placeholder="Start typing a client name…" autoFocus={!row} />
          <datalist id="mail-clients">{(clients || []).slice(0, 2000).map((c) => <option key={c.id} value={clientLabel(c)} />)}</datalist>
        </label>
        <label className="field"><span>Client email</span><input type="email" value={f.clientEmail} onChange={set('clientEmail')} /></label>

        {!row && f.clientName && (
          <div className="field full count-note">
            {theirs.length ? <>This will be <b>{f.clientName}’s {ordinal(theirs.length + 1)} mail</b>.</> : <>First mail from <b>{f.clientName}</b>.</>}
            {openCases.length > 0 && (
              <div className="follow-pick">
                <span>They already have {openCases.length === 1 ? 'an open case' : `${openCases.length} open cases`}. Add this mail to it instead?</span>
                <label className="toggle"><input type="radio" name="follow" checked={!followOn} onChange={() => setFollowOn('')} />New case</label>
                {openCases.map((m) => (
                  <label key={m.id} className="toggle"><input type="radio" name="follow" checked={followOn === m.id} onChange={() => setFollowOn(m.id)} />Follow-up on {m.ticket} · {m.subject}</label>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="field full"><span>Subject</span><input required value={f.subject} onChange={set('subject')} /></label>
        {!row && <label className="field full"><span>What the client wrote</span><textarea rows={4} value={f.text} onChange={set('text')} placeholder="Paste the email text or a short summary" /></label>}

        {!followOn && (
          <>
            <label className="field"><span>Issue type</span><select value={f.issueType} onChange={set('issueType')}>{ISSUE_TYPES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <label className="field"><span>Priority</span><select value={f.priority} onChange={set('priority')}>{PRIORITIES.map((t) => <option key={t}>{t}</option>)}</select></label>
            <div className="field full">
              <span>Related issues</span>
              <div className="chips">
                {ISSUE_TYPES.filter((t) => t !== f.issueType).map((t) => (
                  <button type="button" key={t} className={`chip-btn${f.relatedIssues.includes(t) ? ' on' : ''}`} onClick={() => toggleRelated(t)}>{t}</button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Mailbox</span>
              <input list="mailboxes" value={f.mailbox} onChange={set('mailbox')} />
              <datalist id="mailboxes">{MAILBOXES.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label className="field"><span>CC</span><input value={f.cc} onChange={set('cc')} placeholder="Other addresses on the email" /></label>
            {!row && (
              <>
                <label className="field"><span>Send to department</span><select value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select></label>
                <label className="field"><span>Received</span><input type="datetime-local" value={f.receivedAt} onChange={set('receivedAt')} /></label>
              </>
            )}
          </>
        )}
      </form>
      {!row && <p className="muted small">You can attach files after the case is logged.</p>}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
