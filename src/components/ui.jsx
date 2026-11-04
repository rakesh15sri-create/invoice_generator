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
    setTimeout(() => dismiss(id), type === 'error' ? 7000 : type === 'live' ? 5000 : 3000);
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
            <span className="toast-icon" aria-hidden="true">{t.type === 'error' ? '!' : t.type === 'live' ? '●' : '✓'}</span>
            <span>{t.text}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Dismiss">&times;</button>
          </div>
        ))}
      </div>
      {dialog && <ConfirmDialog {...dialog} onClose={close} />}
    </FeedbackContext.Provider>
  );
}

// With `input` ({ label, placeholder, required, match }) the dialog asks for text and resolves
// with it (or false when cancelled). match = the exact text that must be typed, e.g. "DELETE".
function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', danger, input, onClose }) {
  const okRef = useRef(null);
  const inRef = useRef(null);
  const [text, setText] = useState(input?.value || '');
  const invalid = !!input && ((input.required && !text.trim()) || (!!input.match && text.trim() !== input.match));
  const submit = () => { if (!invalid) onClose(input ? text.trim() : true); };
  useEffect(() => { (inRef.current || okRef.current)?.focus(); }, []);
  const ref = useEscape(() => onClose(false));

  return (
    <div ref={ref} className="modal-backdrop layer" onMouseDown={(e) => e.target === e.currentTarget && onClose(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h3 id="dlg-title">{title || 'Are you sure?'}</h3>
        {message && <p id="dlg-msg">{message}</p>}
        {input && (
          <label className="field dlg-input">
            {input.label && <span>{input.label}</span>}
            {input.match
              ? <input ref={inRef} value={text} onChange={(e) => setText(e.target.value)} placeholder={input.placeholder} onKeyDown={(e) => e.key === 'Enter' && submit()} />
              : <textarea ref={inRef} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={input.placeholder} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && submit()} />}
          </label>
        )}
        <div className="modal-actions">
          <button onClick={() => onClose(false)}>{cancelLabel}</button>
          <button ref={okRef} className={danger ? 'danger-fill' : 'primary'} disabled={invalid} onClick={submit}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export const useToast = () => useContext(FeedbackContext).toast;
export const useConfirm = () => useContext(FeedbackContext).confirm;

// ---------- Modal & drawer ----------
// Escape closes the top-most layer only (a dialog opened from a drawer closes first).
function useEscape(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const layers = document.querySelectorAll('.layer');
      if (e.key === 'Escape' && layers[layers.length - 1] === ref.current) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return ref;
}

export function Modal({ title, sub, onClose, children, footer, wide }) {
  const ref = useEscape(onClose);
  return (
    <div ref={ref} className="modal-backdrop layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal form-modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div><h3>{title}</h3>{sub && <p className="muted small">{sub}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-actions">{footer}</footer>}
      </div>
    </div>
  );
}

// Slides in from the right; used for request, client and case details.
export function Drawer({ title, sub, onClose, actions, children }) {
  const ref = useEscape(onClose);
  return (
    <div ref={ref} className="drawer-backdrop layer" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}>
        <header className="drawer-head">
          <div className="drawer-title">{title}{sub && <div className="muted small">{sub}</div>}</div>
          <div className="drawer-actions">{actions}<button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

// ---------- Icons (24px stroke icons) ----------
const ICON_PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  invoice: <><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5M9 12h7M9 16h7" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  withdraw: <><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M7 15h3" /></>,
  clients: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m3 6 9 7 9-7" /></>,
  team: <><circle cx="9" cy="8" r="4" /><path d="M2 21a7 7 0 0 1 14 0" /><path d="M19 8v6M16 11h6" /></>,
  company: <><path d="M3 21h18M5 21V7l7-4 7 4v14" /><path d="M9 21v-6h6v6M9 10h.01M15 10h.01" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2" /></>,
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  collapse: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 21h16" /></>,
  upload: <><path d="M12 15V3M7 8l5-5 5 5" /><path d="M4 21h16" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <path d="m5 12 5 5L20 7" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  flag: <path d="M4 22V4M4 4h13l-2 4 2 4H4" />,
  board: <><rect x="3" y="3" width="5" height="18" rx="1.5" /><rect x="10" y="3" width="5" height="12" rx="1.5" /><rect x="17" y="3" width="4" height="8" rx="1.5" /></>,
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  chart: <><path d="M3 3v18h18" /><path d="M7 15v3M12 10v8M17 6v12" /></>,
  paperclip: <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" />,
  columns: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M15 4v16" /></>,
};

export function Icon({ name, size = 18 }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  );
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

export function fmtDateTime(v) {
  if (!v) return '—';
  return new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Coloured dot + label for a CRM status ({ label, color }).
export const Pill = ({ color, children, title }) => (
  <span className="pill" style={{ '--c': color }} title={title}><i />{children}</span>
);
