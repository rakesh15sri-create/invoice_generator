import { useState } from 'react';
import { api } from '../api.js';
import { PasswordInput, useToast } from '../components/ui.jsx';
import { ROLE_HELP, ROLE_LABEL } from '../roles.js';

export default function AccountPage({ user }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); setError(''); };

  const submit = async (e) => {
    e.preventDefault();
    if (form.next !== form.confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await api('/auth/password', { method: 'PUT', body: { current: form.current, next: form.next } });
      setForm({ current: '', next: '', confirm: '' });
      toast('Password changed. Any other devices have been signed out.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow">
      <div className="page-head"><h2>My account</h2></div>
      <section className="panel">
        <div className="kv-list">
          <div><span>Name</span><b>{user.name}</b></div>
          <div><span>Email</span><b>{user.email}</b></div>
          <div><span>Access</span><b>{ROLE_LABEL[user.role]}</b></div>
        </div>
        <p className="muted small">{ROLE_HELP[user.role]}</p>
      </section>
      <form className="panel stack-form" onSubmit={submit}>
        <h3>Change password</h3>
        <label className="field"><span>Current password</span>
          <PasswordInput value={form.current} onChange={set('current')} autoComplete="current-password" />
        </label>
        <label className="field"><span>New password (at least 8 characters)</span>
          <PasswordInput value={form.next} onChange={set('next')} minLength={8} autoComplete="new-password" />
        </label>
        <label className="field"><span>Type the new password again</span>
          <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="row"><button className="primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></div>
      </form>
    </div>
  );
}
