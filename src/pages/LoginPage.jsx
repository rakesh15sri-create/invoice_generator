import { useState } from 'react';
import { api } from '../api.js';
import { PasswordInput } from '../components/ui.jsx';
import { storage } from '../data.js';

const EMAIL_KEY = 'invgen.lastEmail';

export default function LoginPage({ needsSetup, serverError, onAuthed }) {
  const [form, setForm] = useState(() => ({ name: '', email: needsSetup ? '' : storage.get(EMAIL_KEY, ''), password: '', confirm: '' }));
  const [error, setError] = useState(serverError || '');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (needsSetup && form.password !== form.confirm) return setError('The two passwords do not match.');
    setBusy(true);
    try {
      const body = needsSetup
        ? { name: form.name, email: form.email, password: form.password }
        : { email: form.email, password: form.password };
      const { token, user } = await api(needsSetup ? '/auth/setup' : '/auth/login', { method: 'POST', body });
      storage.set(EMAIL_KEY, user.email);
      onAuthed(token, user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-screen auth-bg">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5" /><path d="M9 12h7M9 16h7M9 8h3" />
          </svg>
        </div>
        {needsSetup ? (
          <>
            <h1>Welcome! Let’s set you up</h1>
            <p className="muted">
              Create your <b>admin account</b>. You’ll use this email and password to sign in from now on,
              and you can give your team their own logins afterwards.
            </p>
          </>
        ) : (
          <>
            <h1>Sign in</h1>
            <p className="muted">Use the email and password your admin gave you.</p>
          </>
        )}

        {needsSetup && (
          <label className="field"><span>Your name</span><input required value={form.name} onChange={set('name')} autoFocus placeholder="e.g. Rakesh Sharma" /></label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" required value={form.email} onChange={set('email')} autoFocus={!needsSetup && !form.email} autoComplete="username" placeholder="you@company.com" />
        </label>
        <label className="field">
          <span>Password{needsSetup && ' (at least 8 characters)'}</span>
          <PasswordInput value={form.password} onChange={set('password')} minLength={needsSetup ? 8 : undefined} autoComplete={needsSetup ? 'new-password' : 'current-password'} autoFocus={!needsSetup && !!form.email} />
        </label>
        {needsSetup && (
          <label className="field"><span>Type the password again</span>
            <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
          </label>
        )}

        {error && <div className="form-error">{error}</div>}
        <button className="primary big" disabled={busy}>{busy ? 'Please wait…' : needsSetup ? 'Create my account' : 'Sign in'}</button>

        {!needsSetup && (
          <div className="forgot">
            <button type="button" className="link" onClick={() => setForgot(!forgot)}>Forgot your password?</button>
            {forgot && (
              <p className="muted small">
                Ask your administrator to reset it for you — they can do this in the <b>Team</b> page.
              </p>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
