import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Loading, useConfirm, useToast } from '../components/ui.jsx';
import { ROLE_HELP, ROLE_LABEL } from '../roles.js';

// Readable temporary password (no look-alike characters).
function tempPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const blank = () => ({ name: '', email: '', password: tempPassword(), role: 'staff' });

export default function TeamPage({ user }) {
  const [users, setUsers] = useState(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(null); // login details to hand to a member
  const toast = useToast();
  const confirm = useConfirm();
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const reload = () => api('/users').then(setUsers).catch((e) => { toast(e.message, 'error'); setUsers((u) => u ?? []); });
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await api('/users', { method: 'POST', body: form });
      setShared({ name: u.name, email: u.email, password: form.password });
      setForm(blank());
      toast(`${u.name} can now sign in.`);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const update = async (u, changes, done) => {
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: changes });
      toast(done);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const toggleActive = async (u, active) => {
    if (!active && !(await confirm({
      title: `Disable ${u.name}?`,
      message: 'They will be signed out and won’t be able to sign in. Their invoices are kept, and you can turn access back on any time.',
      confirmLabel: 'Disable access',
      danger: true,
    }))) return;
    update(u, { active }, active ? `${u.name} can sign in again.` : `${u.name} has been disabled.`);
  };

  const resetPassword = async (u) => {
    if (!(await confirm({
      title: `Reset ${u.name}’s password?`,
      message: 'A new temporary password will be created and they will be signed out everywhere.',
      confirmLabel: 'Reset password',
    }))) return;
    const password = tempPassword();
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: { password } });
      setShared({ name: u.name, email: u.email, password });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const remove = async (u) => {
    if (!(await confirm({
      title: `Remove ${u.name}?`,
      message: 'They will lose access to the app. This cannot be undone.',
      confirmLabel: 'Remove',
      danger: true,
    }))) return;
    try {
      await api(`/users/${u.id}`, { method: 'DELETE' });
      toast(`${u.name} was removed.`);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const copy = async () => {
    const text = `Invoice Generator login\nURL: ${window.location.origin}\nEmail: ${shared.email}\nTemporary password: ${shared.password}\nPlease change it under "My account" after signing in.`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Login details copied — paste them into a message.');
    } catch {
      toast('Couldn’t copy automatically. Please select the details and copy them by hand.', 'error');
    }
  };

  if (!users) return <div className="page"><Loading /></div>;

  return (
    <div className="page">
      <div className="page-head"><h2>Team access</h2></div>

      <div className="roles-help">
        {Object.keys(ROLE_LABEL).map((r) => (
          <div key={r}><span className={`role-badge r-${r}`}>{ROLE_LABEL[r]}</span> {ROLE_HELP[r]}</div>
        ))}
      </div>

      {shared && (
        <div className="share-box">
          <div>
            <b>Share these login details with {shared.name}</b>
            <div>Email: <code>{shared.email}</code></div>
            <div>Temporary password: <code>{shared.password}</code></div>
            <small>This password is shown only once. Ask them to change it under “My account”.</small>
          </div>
          <div className="row">
            <button className="primary" onClick={copy}>Copy login details</button>
            <button className="ghost" onClick={() => setShared(null)}>Done</button>
          </div>
        </div>
      )}

      <form className="panel add-member" onSubmit={add}>
        <h3>Add team member</h3>
        <div className="add-grid">
          <label className="field"><span>Name</span><input required value={form.name} onChange={set('name')} placeholder="e.g. Priya Nair" /></label>
          <label className="field"><span>Email</span><input type="email" required value={form.email} onChange={set('email')} placeholder="name@company.com" /></label>
          <label className="field">
            <span>Temporary password</span>
            <div className="row" style={{ margin: 0 }}>
              <input required minLength={8} value={form.password} onChange={set('password')} />
              <button type="button" className="ghost" onClick={() => setForm({ ...form, password: tempPassword() })} title="Generate a new password">↻</button>
            </div>
          </label>
          <label className="field">
            <span>Access</span>
            <select value={form.role} onChange={set('role')}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button className="primary" disabled={busy}>{busy ? 'Adding…' : 'Give access'}</button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Member</th><th>Access</th><th>Status</th><th className="r">Invoices</th><th /></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === user.id;
              return (
                <tr key={u.id} className={u.active ? '' : 'muted-row'}>
                  <td><b>{u.name}</b>{self && ' (you)'}<div className="muted">{u.email}</div></td>
                  <td>
                    <select value={u.role} disabled={self} title={self ? 'You can’t change your own access' : undefined}
                      onChange={(e) => update(u, { role: e.target.value }, `${u.name} is now ${ROLE_LABEL[e.target.value]}.`)}>
                      {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <label className="toggle">
                      <input type="checkbox" checked={u.active} disabled={self} onChange={(e) => toggleActive(u, e.target.checked)} />
                      {u.active ? 'Active' : 'Disabled'}
                    </label>
                  </td>
                  <td className="r num">{u.invoiceCount}</td>
                  <td className="r">
                    <button className="link" onClick={() => resetPassword(u)}>Reset password</button>
                    {!self && (
                      <button
                        className="link danger"
                        onClick={() => remove(u)}
                        disabled={u.invoiceCount > 0}
                        title={u.invoiceCount > 0 ? 'Has invoices — disable access instead' : 'Remove member'}
                      >Remove</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
