import { useEffect, useRef, useState } from 'react';
import { api, openStoredFile, upload } from '../../api.js';
import { Drawer, Icon, Pill, fmtDateTime, useConfirm, useToast } from '../../components/ui.jsx';
import { DEPARTMENTS, MAIL_ENTRY, MAIL_STATUS_BY_ID, OUTCOMES, isMailOpen, mailStatusLabel, ordinal } from '../../crm/domain.js';
import { useCrm } from '../../crm/store.jsx';

const ACTIONS = [
  { type: 'reply', label: 'Reply sent', icon: 'check', text: 'What did you reply? (optional)' },
  { type: 'client', label: 'Client wrote again', icon: 'mail', text: 'What did the client write?' },
  { type: 'forward', label: 'Send to department', icon: 'arrowRight', dept: true, text: 'Note for the department (optional)' },
  { type: 'escalate', label: 'Escalate', icon: 'flag', dept: true, text: 'Why is it escalated?' },
  { type: 'note', label: 'Internal note', icon: 'edit', text: 'Note (only the team sees this)', required: true },
  { type: 'waiting', label: 'Waiting for client', icon: 'clock', text: 'What are we waiting for? (optional)' },
  { type: 'resolve', label: 'Resolve', icon: 'check', resolve: true },
];
const fileSize = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ext = (name) => (String(name).split('.').pop() || 'file').slice(0, 4).toUpperCase();

export default function MailDetail({ m, user, onClose, onEdit }) {
  const { put, drop } = useCrm();
  const toast = useToast();
  const confirm = useConfirm();
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({ text: '', department: '', outcome: '', solution: '' });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [limitMb, setLimitMb] = useState(20);
  const fileRef = useRef(null);
  const open = isMailOpen(m.status);
  const last = m.thread[m.thread.length - 1];

  useEffect(() => { api('/files/config').then((c) => setLimitMb(c.maxUploadMb)).catch(() => {}); }, []);
  useEffect(() => { setAction(null); }, [m.id]);

  const pick = (a) => {
    setAction(action?.type === a.type ? null : a);
    setForm({ text: '', department: a.type === 'escalate' ? '' : (m.department === 'Support' ? '' : m.department), outcome: '', solution: '' });
  };

  const run = async (body, done) => {
    setBusy(true);
    try {
      const saved = await api(`/mails/${m.id}/${body.type === 'undo' ? 'undo' : 'action'}`, { method: 'POST', body });
      put.mail(saved);
      toast(done);
      setAction(null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    run({ type: action.type, ...form }, `${MAIL_ENTRY[action.type]} · ${m.ticket}`);
  };
  const toggleCompliance = () => run({ type: 'compliance' }, m.complianceFlag ? 'Compliance flag removed.' : 'Flagged for compliance.');
  const undo = async () => {
    if (!(await confirm({ title: `Undo “${MAIL_ENTRY[last.type]}”?`, message: `The case goes back to how it was before ${last.byName}’s last action (${fmtDateTime(last.at)}).`, confirmLabel: 'Undo' }))) return;
    run({ type: 'undo' }, 'Last action undone.');
  };

  const uploadFiles = async (list) => {
    const files = [...list];
    const big = files.find((f) => f.size > limitMb * 1048576);
    if (big) return toast(`${big.name} is larger than ${limitMb} MB.`, 'error');
    setUploading(files.length);
    for (const f of files) {
      try { await upload(`/mails/${m.id}/files`, f); }
      catch (e) { toast(`${f.name}: ${e.message}`, 'error'); }
      setUploading((n) => n - 1);
    }
    try { put.mail(await api(`/mails/${m.id}`)); } catch { /* the feed will refresh it */ }
  };
  const removeFile = async (f) => {
    if (!(await confirm({ title: `Remove ${f.name}?`, message: 'The file is deleted from storage.', confirmLabel: 'Remove file', danger: true }))) return;
    try {
      await api(`/mails/${m.id}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      put.mail({ ...m, files: m.files.filter((x) => x.id !== f.id) });
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${m.ticket}?`, message: 'The case, its thread and its files are deleted for everyone. This cannot be undone.', confirmLabel: 'Delete case', danger: true }))) return;
    try {
      await api(`/mails/${m.id}`, { method: 'DELETE' });
      drop.mail(m.id);
      toast(`${m.ticket} deleted.`);
      onClose();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const available = ACTIONS.filter((a) => open || a.type === 'client' || a.type === 'note');

  return (
    <Drawer
      onClose={onClose}
      title={<div className="dt-title"><span>{m.ticket}</span><Pill color={MAIL_STATUS_BY_ID[m.status]?.color}>{mailStatusLabel(m.status)}</Pill></div>}
      sub={`${m.clientName} · ${ordinal(m.mailNo)} mail${m.followUps ? ` · ${m.followUps} follow-up${m.followUps === 1 ? '' : 's'}` : ''}`}
      actions={<button onClick={onEdit}><Icon name="edit" size={16} />Edit</button>}
    >
      <h3 className="case-subject">{m.subject}</h3>
      <div className="tag-row">
        {m.replyPending && open && <span className="tag alert">Reply pending</span>}
        {m.complianceFlag && <span className="tag danger">Compliance flag</span>}
        {m.escalated && <span className="tag warn">Escalated</span>}
        <span className={`tag prio-${m.priority.toLowerCase()}`}>{m.priority}</span>
        <span className="tag">{m.issueType}</span>
        {m.relatedIssues.map((t) => <span key={t} className="tag muted-tag">{t}</span>)}
      </div>

      <div className="kv-grid">
        <div><span>Client</span><b>{m.clientId ? <a href={`#/clients/${m.clientId}`}>{m.clientName}</a> : m.clientName}</b></div>
        <div><span>Email</span><b>{m.clientEmail || '—'}</b></div>
        <div><span>Department</span><b>{m.department}</b></div>
        <div><span>Mailbox</span><b>{m.mailbox}</b></div>
        <div><span>Received</span><b>{fmtDateTime(m.receivedAt || m.createdAt)}</b></div>
        <div><span>CC</span><b>{m.cc || '—'}</b></div>
      </div>
      {m.status === 'resolved' && (
        <div className="note-box ok"><b>{m.outcome}</b> · {m.solution}</div>
      )}

      <section className="panel control">
        <h3>Actions</h3>
        <div className="action-grid">
          {available.map((a) => (
            <button key={a.type} className={action?.type === a.type ? 'on' : ''} onClick={() => pick(a)} disabled={busy}>
              <Icon name={a.icon} size={16} />{a.label}
            </button>
          ))}
          <button onClick={toggleCompliance} disabled={busy} className={m.complianceFlag ? 'on-danger' : ''}><Icon name="flag" size={16} />{m.complianceFlag ? 'Unflag compliance' : 'Compliance flag'}</button>
          {last && last.type !== 'logged' && <button onClick={undo} disabled={busy}><Icon name="undo" size={16} />Undo last action</button>}
        </div>

        {action && (
          <form className="action-form" onSubmit={submit}>
            {action.dept && (
              <label className="field">
                <span>Department{action.type === 'escalate' ? ' (optional)' : ''}</span>
                <select required={action.type === 'forward'} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  <option value="">{action.type === 'escalate' ? `Keep ${m.department}` : 'Choose…'}</option>
                  {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
            )}
            {action.resolve ? (
              <>
                <label className="field"><span>Outcome</span>
                  <select required value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                    <option value="">Choose…</option>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </label>
                <label className="field"><span>Solution</span><textarea required rows={3} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} placeholder="What was done to solve it" /></label>
              </>
            ) : (
              <label className="field"><span>{action.text}</span><textarea rows={3} required={action.required} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></label>
            )}
            <div className="row">
              <button className="primary" disabled={busy}>{busy ? 'Saving…' : action.label}</button>
              <button type="button" className="ghost" onClick={() => setAction(null)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <h3>Files <span className="muted">({m.files.length})</span></h3>
        {m.files.map((f) => (
          <div key={f.id} className="file-row">
            <span className={`file-icon${/pdf/i.test(f.type) ? ' pdf' : ''}`}>{ext(f.name)}</span>
            <div className="file-main"><b title={f.name}>{f.name}</b><small>{fileSize(f.size)} · {f.uploadedByName} · {fmtDateTime(f.uploadedAt)}</small></div>
            <button className="link" onClick={() => openStoredFile(m.id, f.id, '/mails').catch((e) => toast(e.message, 'error'))}>Open</button>
            {(user.role === 'admin' || f.uploadedBy === user.id) ? <button className="link danger" onClick={() => removeFile(f)}>Remove</button> : <span />}
          </div>
        ))}
        <label
          className={`drop-zone${uploading ? ' is-busy' : ''}`}
          onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
          onDragLeave={(e) => e.currentTarget.classList.remove('over')}
          onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('over'); uploadFiles(e.dataTransfer.files); }}
        >
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }} />
          {uploading ? `Uploading ${uploading} file${uploading === 1 ? '' : 's'}…` : <><b>Attach files</b> or drop them here · max {limitMb} MB each</>}
        </label>
      </section>

      <section className="panel">
        <h3>Thread</h3>
        <ol className="timeline">
          {[...m.thread].reverse().map((e) => (
            <li key={e.id} className={`te-${e.type}`}>
              <span className="tl-dot" />
              <div>
                <div className="tl-head">
                  <b>{MAIL_ENTRY[e.type] || e.type}</b>
                  {e.mailNo && <span>{ordinal(e.mailNo)} mail</span>}
                  {e.department && <span>→ {e.department}</span>}
                  {e.outcome && <span>{e.outcome}</span>}
                  {e.type === 'compliance' && <span>{e.flag ? 'on' : 'off'}</span>}
                </div>
                {e.text && <div className="tl-comment">{e.text}</div>}
                <small className="muted">{e.byName}{e.byDept ? ` · ${e.byDept}` : ''} · {fmtDateTime(e.at)}</small>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {user.role === 'admin' && <div className="row"><button className="ghost danger" onClick={remove}><Icon name="trash" size={16} />Delete case</button></div>}
    </Drawer>
  );
}
