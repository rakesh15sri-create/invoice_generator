import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { num } from '../data.js';

// Status palette (reserved colours, always shown with an icon + label, never colour alone).
const STATUS = {
  paid: { color: '#0ca30c', icon: '✓', label: 'Paid' },
  pending: { color: '#fab219', icon: '◷', label: 'Pending' },
  unpaid: { color: '#ec835a', icon: '•', label: 'Unpaid' },
  overdue: { color: '#d03b3b', icon: '!', label: 'Overdue' },
  cancelled: { color: '#898781', icon: '✕', label: 'Cancelled' },
};

export function statusInfo(status) {
  const key = String(status || '').toLowerCase();
  if (key === 'successful') return STATUS.paid;
  return STATUS[key] || { color: '#898781', icon: '•', label: status || '—' };
}

export function StatusBadge({ status }) {
  const s = statusInfo(status);
  return (
    <span className="status-badge">
      <i style={{ background: s.color }}>{s.icon}</i>{s.label}
    </span>
  );
}

export const fmtAmount = (v, cur) =>
  `${cur ? cur + ' ' : ''}${num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// 1,284 / 12.9K / 4.2M
export function compact(v) {
  const n = num(v);
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
  return Math.round(n).toLocaleString('en-US');
}

export const Loading = ({ text = 'Loading…' }) => (
  <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{text}</div>
);

export function PasswordInput({ value, onChange, autoComplete, minLength, autoFocus }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input type={show ? 'text' : 'password'} required minLength={minLength} value={value} onChange={onChange} autoComplete={autoComplete} autoFocus={autoFocus} />
      <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

// ---------- Toasts & confirm dialog ----------
// <FeedbackProvider> wraps the app; pages call useToast() / useConfirm() instead of alert() / confirm().
const FeedbackContext = createContext(null);

export function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null); // { title, message, confirmLabel, danger, resolve }
  const nextId = useRef(0);

  const dismiss = useCallback((id) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);

  const toast = useCallback((text, type = 'ok') => {
    const id = ++nextId.current;
    setToasts((ts) => [...ts.filter((t) => t.text !== text), { id, text, type }].slice(-4));
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : 3000);
  }, [dismiss]);

  const confirm = useCallback((opts) => new Promise((resolve) => {
    setDialog({ confirmLabel: 'OK', ...(typeof opts === 'string' ? { message: opts } : opts), resolve });
  }), []);

  const close = useCallback((answer) => {
    setDialog((d) => { d?.resolve(answer); return null; });
  }, []);

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-msg ${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <span className="toast-icon" aria-hidden="true">{t.type === 'error' ? '!' : '✓'}</span>
            <span>{t.text}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">&times;</button>
          </div>
        ))}
      </div>
      {dialog && <ConfirmDialog {...dialog} onClose={close} />}
    </FeedbackContext.Provider>
  );
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', danger, onClose }) {
  const okRef = useRef(null);
  useEffect(() => {
    okRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h3 id="dlg-title">{title || 'Are you sure?'}</h3>
        {message && <p id="dlg-msg">{message}</p>}
        <div className="modal-actions">
          <button onClick={() => onClose(false)}>{cancelLabel}</button>
          <button ref={okRef} className={danger ? 'danger-fill' : 'primary'} onClick={() => onClose(true)}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export const useToast = () => useContext(FeedbackContext).toast;
export const useConfirm = () => useContext(FeedbackContext).confirm;
