import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useCrm } from '../crm/store.jsx';
import { storage } from '../data.js';
import { ROLE_LABEL } from '../roles.js';
import { Icon, initials, useConfirm, useToast } from './ui.jsx';

// Pages in the sidebar. roles = who can open it (the server enforces the same rules).
// count = live number shown next to the link; search = placeholder of the header search; add = main button.
export const NAV = [
  { page: 'dashboard', label: 'Dashboard', icon: 'dashboard', roles: ['admin', 'manager'], add: { label: 'New invoice', href: '#/editor' } },
  { page: 'invoices', label: 'Invoices', icon: 'invoice', count: 'invoices', search: 'Search invoice number or customer…', add: { label: 'New invoice', href: '#/editor' } },
  { page: 'editor', label: 'Create / Edit invoice', icon: 'edit', title: 'Invoice editor' },
  { section: 'Withdrawal CRM' },
  { page: 'withdrawals', label: 'Withdrawals', icon: 'withdraw', count: 'openWithdrawals', search: 'Search ref, client, account, RM…', add: { label: 'New withdrawal', href: '#/withdrawals?new=1' } },
  { page: 'clients', label: 'Clients', icon: 'clients', count: 'clients', search: 'Search name, email, phone, account…', add: { label: 'Add client', href: '#/clients?new=1' } },
  { page: 'mails', label: 'Client mails', icon: 'mail', count: 'replyPending', alert: true, search: 'Search ticket, client, subject…', add: { label: 'Log mail', href: '#/mails?new=1' } },
];
// Bottom of the sidebar.
export const FOOT_NAV = [
  { page: 'account', label: 'Change password', icon: 'key', title: 'My account' },
  { page: 'team', label: 'Manage team', icon: 'team', roles: ['admin'], title: 'Team access' },
  { page: 'company', label: 'Company details', icon: 'company', roles: ['admin'] },
];
const ALL_ROLES = ['admin', 'manager', 'staff'];
export const allowedPages = (user) => [...NAV, ...FOOT_NAV].filter((n) => n.page && (n.roles || ALL_ROLES).includes(user.role));

// ---------- theme ----------
function useTheme() {
  const [theme, setTheme] = useState(() => storage.get('invgen.theme', null)
    || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storage.set('invgen.theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

export default function Shell({ user, page, onLogout, search, setSearch, children }) {
  const [collapsed, setCollapsed] = useState(() => storage.get('invgen.sidebar', false));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const searchRef = useRef(null);
  const all = allowedPages(user);
  const current = all.find((n) => n.page === page) || all[0];

  useEffect(() => { storage.set('invgen.sidebar', collapsed); }, [collapsed]);
  useEffect(() => { setMobileOpen(false); }, [page]);

  // Press / to jump to the page search.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (!searchRef.current) return;
      e.preventDefault();
      searchRef.current.focus();
      searchRef.current.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${collapsed ? ' sb-collapsed' : ''}${mobileOpen ? ' sb-open' : ''}`}>
      <Sidebar
        user={user} page={page} onLogout={onLogout} collapsed={collapsed}
        onCollapse={() => setCollapsed(!collapsed)} theme={theme} setTheme={setTheme}
      />
      <div className="sb-scrim" onClick={() => setMobileOpen(false)} aria-hidden="true" />

      <div className="main">
        <header className="app-header">
          <button className="icon-btn only-mobile" onClick={() => setMobileOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <h1 className="page-title">{current.title || current.label}</h1>
          {current.search && (
            <label className="header-search">
              <Icon name="search" size={16} />
              <input
                ref={searchRef} type="search" placeholder={current.search} value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur(); } }}
                aria-label="Search this page"
              />
              {!search && <kbd>/</kbd>}
            </label>
          )}
        </header>
        {page !== 'editor' && <StatusBar add={current.add} />}
        <div className="page-body">{children}</div>
      </div>
    </div>
  );
}

function StatusBar({ add }) {
  const { live } = useCrm();
  const time = live.at ? live.at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  return (
    <div className="statusbar">
      <span className={`live-dot${live.ok ? '' : ' off'}`} role="status">
        {live.ok ? <><b>✓ Live</b>{time && <> · updated {time}</>}</> : <b>Reconnecting…</b>}
      </span>
      {add && <a className="btn primary" href={add.href}><Icon name="plus" size={16} />{add.label}</a>}
    </div>
  );
}

function Sidebar({ user, page, onLogout, collapsed, onCollapse, theme, setTheme }) {
  const { counts } = useCrm();
  const allowed = (n) => (n.roles || ALL_ROLES).includes(user.role);
  const meterTotal = counts.clearedToday + (counts.openWithdrawals || 0);
  const meterPct = meterTotal ? Math.round((counts.clearedToday / meterTotal) * 100) : 0;

  const link = (n) => {
    const c = n.count ? counts[n.count] : null;
    return (
      <a key={n.page} href={`#/${n.page}`} className={`sb-link${page === n.page ? ' active' : ''}`} title={collapsed ? n.label : undefined}>
        <Icon name={n.icon} />
        <span className="sb-label">{n.label}</span>
        {c != null && c > 0 && <span className={`sb-count${n.alert ? ' alert' : ''}`} title={n.alert ? `${c} waiting for a reply` : undefined}>{c > 999 ? '999+' : c}</span>}
      </a>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sb-top">
        <AccountSwitcher user={user} onLogout={onLogout} collapsed={collapsed} />
        <button className="icon-btn sb-collapse only-desktop" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand' : 'Collapse'}>
          <Icon name="collapse" />
        </button>
      </div>

      <nav className="sb-nav">
        {NAV.map((n, i) => (n.section
          ? <div key={i} className="sb-section">{n.section}</div>
          : allowed(n) && link(n)))}

        <div className="sb-section">Quick actions</div>
        <a className="sb-link quick" href="#/withdrawals?new=1" title={collapsed ? 'New withdrawal' : undefined}><Icon name="plus" /><span className="sb-label">New withdrawal</span></a>
        <a className="sb-link quick" href="#/mails?new=1" title={collapsed ? 'Log a mail' : undefined}><Icon name="plus" /><span className="sb-label">Log a mail</span></a>
        <a className="sb-link quick" href="#/editor" title={collapsed ? 'New invoice' : undefined}><Icon name="plus" /><span className="sb-label">New invoice</span></a>

        <div className="sb-meter" title={`${counts.clearedToday} completed today, ${counts.openWithdrawals ?? 0} still open`}>
          <div className="sb-meter-head"><span>Cleared today</span><b>{counts.clearedToday}</b></div>
          <div className="meter"><div style={{ width: `${meterPct}%` }} /></div>
          <small>{counts.openWithdrawals ?? 0} open · {meterPct}% cleared</small>
        </div>
      </nav>

      <div className="sb-foot">
        {FOOT_NAV.filter(allowed).map(link)}
        <label className="sb-link theme-switch" title={collapsed ? 'Dark mode' : undefined}>
          <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
          <span className="sb-label">Dark mode</span>
          <input type="checkbox" role="switch" checked={theme === 'dark'} onChange={(e) => setTheme(e.target.checked ? 'dark' : 'light')} />
          <span className="switch" aria-hidden="true" />
        </label>
      </div>
    </aside>
  );
}

// Top of the sidebar: who is signed in, plus demo data, delete all and log out.
function AccountSwitcher({ user, onLogout, collapsed }) {
  const [open, setOpen] = useState(false);
  const [demo, setDemo] = useState(null); // { enabled, count }
  const ref = useRef(null);
  const { reload } = useCrm();
  const confirm = useConfirm();
  const toast = useToast();
  const isAdmin = user.role === 'admin';

  useEffect(() => {
    if (!open) return;
    if (isAdmin) api('/admin/demo').then(setDemo).catch(() => {});
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, isAdmin]);

  const run = async (fn, done) => {
    setOpen(false);
    try {
      const r = await fn();
      await reload('all');
      toast(done(r));
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const loadDemo = () => run(() => api('/admin/demo', { method: 'POST' }), (r) => `Demo data loaded: ${r.clients} clients, ${r.withdrawals} withdrawals, ${r.mails} mail cases.`);
  const removeDemo = () => run(() => api('/admin/demo', { method: 'DELETE' }), () => 'Demo data removed.');
  const wipe = async () => {
    setOpen(false);
    const typed = await confirm({
      title: 'Delete all CRM data?',
      message: 'This permanently deletes every withdrawal, client and client mail (with their files). Invoices are not affected. This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true,
      input: { label: 'Type DELETE to confirm', placeholder: 'DELETE', match: 'DELETE' },
    });
    if (!typed) return;
    run(() => api('/admin/wipe', { method: 'POST', body: { confirm: 'DELETE' } }), (r) => `Deleted ${r.withdrawals} withdrawals, ${r.clients} clients and ${r.mails} mail cases.`);
  };

  return (
    <div className="acct" ref={ref}>
      <button className="acct-btn" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" title={collapsed ? user.name : undefined}>
        <span className="avatar sm">{initials(user.name)}</span>
        <span className="acct-text">
          <b>{user.name}</b>
          <small>{ROLE_LABEL[user.role]}{user.department ? ` · ${user.department}` : ''}</small>
        </span>
        <span className="acct-chev"><Icon name="chevron" size={16} /></span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><b>{user.name}</b><small>{user.email}</small></div>
          <a role="menuitem" href="#/account" onClick={() => setOpen(false)}><Icon name="user" size={16} />My account</a>
          {isAdmin && demo?.enabled && (
            demo.count > 0
              ? <button role="menuitem" onClick={removeDemo}><Icon name="database" size={16} />Remove demo data</button>
              : <button role="menuitem" onClick={loadDemo}><Icon name="database" size={16} />Load demo data</button>
          )}
          {isAdmin && <button role="menuitem" className="danger" onClick={wipe}><Icon name="trash" size={16} />Delete all CRM data</button>}
          <div className="menu-sep" />
          <button role="menuitem" onClick={onLogout}><Icon name="logout" size={16} />Log out</button>
        </div>
      )}
    </div>
  );
}
