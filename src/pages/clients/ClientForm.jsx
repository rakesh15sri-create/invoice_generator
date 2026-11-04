import { useState } from 'react';
import { api } from '../../api.js';
import { Modal, useToast } from '../../components/ui.jsx';
import { rmOptions, useCrm } from '../../crm/store.jsx';

export default function ClientForm({ row, onClose, onSaved }) {
  const { people, put } = useCrm();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    name: row?.name || '', email: row?.email || '', phone: row?.phone || '', country: row?.country || '',
    accountNo: row?.accountNo || '', rmId: row?.rmId ?? '', rmName: row?.rmName || '', notes: row?.notes || '',
  }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = row
        ? await api(`/clients/${row.id}`, { method: 'PUT', body: f })
        : await api('/clients', { method: 'POST', body: f });
      put.client(saved);
      toast(row ? `${saved.name} updated.` : `${saved.name} added.`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={row ? `Edit ${row.name}` : 'Add client'}
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" form="client-form" disabled={busy}>{busy ? 'Saving…' : row ? 'Save changes' : 'Add client'}</button>
      </>}
    >
      <form id="client-form" className="form-grid" onSubmit={submit}>
        <label className="field full"><span>Name</span><input required value={f.name} onChange={set('name')} autoFocus /></label>
        <label className="field"><span>Email</span><input type="email" value={f.email} onChange={set('email')} /></label>
        <label className="field"><span>Phone</span><input value={f.phone} onChange={set('phone')} /></label>
        <label className="field"><span>Account no.</span><input value={f.accountNo} onChange={set('accountNo')} /></label>
        <label className="field"><span>Country</span><input value={f.country} onChange={set('country')} /></label>
        <label className="field full">
          <span>RM</span>
          <select value={f.rmId} onChange={set('rmId')}>
            <option value="">{f.rmName && !f.rmId ? `${f.rmName} (from import)` : '— Not assigned —'}</option>
            {rmOptions(people).map((p) => <option key={p.id} value={p.id}>{p.name}{p.department ? ` · ${p.department}` : ''}</option>)}
          </select>
        </label>
        <label className="field full"><span>Notes</span><textarea rows={2} value={f.notes} onChange={set('notes')} /></label>
      </form>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
