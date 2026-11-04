import { useMemo, useState } from 'react';
import { api } from '../../api.js';
import { Modal, useConfirm, useToast } from '../../components/ui.jsx';
import { CURRENCIES, LARGE_AMOUNT, METHODS } from '../../crm/domain.js';
import { rmOptions, useCrm } from '../../crm/store.jsx';

const pad = (n) => String(n).padStart(2, '0');
// Date → value for <input type="datetime-local"> (local time)
export const toLocalInput = (v) => {
  const d = v ? new Date(v) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const clientLabel = (c) => `${c.name}${c.accountNo ? ` · ${c.accountNo}` : ''}`;

// Add or edit a withdrawal request. clientId pre-selects a client (from the client page).
export default function WithdrawalForm({ row, clientId, onClose, onSaved }) {
  const { clients, people, put } = useCrm();
  const toast = useToast();
  const confirm = useConfirm();
  const preset = clientId && clients?.find((c) => c.id === Number(clientId));
  const [f, setF] = useState(() => (row ? {
    clientId: row.clientId ?? '', clientText: row.clientName, clientName: row.clientName, accountNo: row.accountNo,
    amount: String(row.amount), currency: row.currency, method: row.method, rmId: row.rmId ?? '', note: row.note || '',
    requestedAt: toLocalInput(row.requestedAt),
  } : {
    clientId: preset?.id ?? '', clientText: preset ? clientLabel(preset) : '', clientName: preset?.name || '', accountNo: preset?.accountNo || '',
    amount: '', currency: 'USD', method: 'Bank wire', rmId: preset?.rmId ?? '', note: '', requestedAt: toLocalInput(),
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); };
  const byLabel = useMemo(() => new Map((clients || []).map((c) => [clientLabel(c), c])), [clients]);
  const rms = rmOptions(people);

  // Typing a name that matches a client links the request to that client.
  const onClient = (e) => {
    const text = e.target.value;
    const c = byLabel.get(text);
    setError('');
    if (c) setF({ ...f, clientText: text, clientId: c.id, clientName: c.name, accountNo: c.accountNo || f.accountNo, rmId: c.rmId ?? f.rmId });
    else setF({ ...f, clientText: text, clientId: '', clientName: text });
  };

  const submit = async (e, confirmLarge = false) => {
    e?.preventDefault();
    setBusy(true);
    const body = {
      clientId: f.clientId || null, clientName: f.clientName.trim(), accountNo: f.accountNo.trim(), amount: Number(f.amount),
      currency: f.currency, method: f.method, rmId: f.rmId || null, note: f.note, requestedAt: new Date(f.requestedAt).toISOString(),
      confirmLarge,
    };
    try {
      const saved = row
        ? await api(`/withdrawals/${row.id}`, { method: 'PATCH', body })
        : await api('/withdrawals', { method: 'POST', body });
      put.withdrawal(saved);
      toast(row ? `${saved.ref} updated.` : `${saved.ref} added to the board.`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setBusy(false);
      if (err.data?.needsConfirm) {
        const ok = await confirm({
          title: 'Confirm a large amount',
          message: `${f.currency} ${Number(f.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} for ${f.clientName}. Requests of ${LARGE_AMOUNT.toLocaleString('en-US')} or more must be double-checked. Is the amount correct?`,
          confirmLabel: 'Yes, the amount is correct',
          cancelLabel: 'Let me check',
        });
        if (ok) submit(null, true);
        return;
      }
      setError(err.message);
      return;
    }
  };

  const large = Number(f.amount) >= LARGE_AMOUNT;

  return (
    <Modal
      title={row ? `Edit ${row.ref}` : 'New withdrawal request'}
      sub={row ? row.clientName : 'It starts as Received and goes to Support.'}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" form="wd-form" disabled={busy}>{busy ? 'Saving…' : row ? 'Save changes' : 'Add request'}</button>
      </>}
    >
      <form id="wd-form" className="form-grid" onSubmit={submit}>
        <label className="field full">
          <span>Client {f.clientId ? <em className="ok-text">· linked to client record</em> : clients?.length ? <em>· pick from the list or type a new name</em> : null}</span>
          <input list="wd-clients" required value={f.clientText} onChange={onClient} placeholder="Start typing a client name…" autoFocus={!row} />
          <datalist id="wd-clients">{(clients || []).slice(0, 2000).map((c) => <option key={c.id} value={clientLabel(c)} />)}</datalist>
        </label>
        <label className="field"><span>Account no.</span><input required value={f.accountNo} onChange={set('accountNo')} placeholder="e.g. ACC-104500" /></label>
        <label className="field"><span>Request date</span><input type="datetime-local" required value={f.requestedAt} onChange={set('requestedAt')} /></label>
        <label className="field">
          <span>Amount</span>
          <input type="number" min="0.01" step="0.01" required value={f.amount} onChange={set('amount')} placeholder="0.00" className={large ? 'warn-input' : ''} />
          {large && <small className="warn-text">Large amount — you’ll be asked to confirm it.</small>}
        </label>
        <div className="grid2 tight">
          <label className="field"><span>Currency</span><select value={f.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label className="field"><span>Method</span><select value={f.method} onChange={set('method')}>{METHODS.map((c) => <option key={c}>{c}</option>)}</select></label>
        </div>
        <label className="field full">
          <span>RM (relationship manager)</span>
          <select value={f.rmId} onChange={set('rmId')}>
            <option value="">— Not assigned —</option>
            {rms.map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
          </select>
        </label>
        <label className="field full"><span>Note</span><textarea rows={2} value={f.note} onChange={set('note')} placeholder="Anything the next desk should know" /></label>
      </form>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
