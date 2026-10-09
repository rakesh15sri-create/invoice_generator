import { useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from './api.js';
import AccountPage from './pages/AccountPage.jsx';
import CompanyPage from './pages/CompanyPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EditorPage, { clearDrafts } from './pages/EditorPage.jsx';
import InvoicesPage from './pages/InvoicesPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import { FeedbackProvider, Loading } from './components/ui.jsx';
import { ROLE_LABEL } from './roles.js';
import { useHashRoute } from './route.js';

// Which pages each role can open. The server enforces the same rules on its API.
const NAV = [
  { page: 'dashboard', label: 'Dashboard', roles: ['admin', 'manager'] },
  { page: 'invoices', label: 'Invoices', roles: ['admin', 'manager', 'staff'] },
  { page: 'editor', label: 'Create / Edit', roles: ['admin', 'manager', 'staff'] },
  { page: 'team', label: 'Team', roles: ['admin'] },
  { page: 'company', label: 'Company', roles: ['admin'] },
];

export default function App() {
  return <FeedbackProvider><Root /></FeedbackProvider>;
}

function Root() {
  const [auth, setAuth] = useState({ loading: true, user: null, needsSetup: false, error: '' });

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setAuth({ loading: false, user: null, needsSetup: false, error: '' });
    });
    (async () => {
      if (getToken()) {
        try {
          const { user } = await api('/auth/me');
          return setAuth({ loading: false, user, needsSetup: false, error: '' });
        } catch { clearToken(); }
      }
      try {
        const { needsSetup } = await api('/auth/status');
        setAuth({ loading: false, user: null, needsSetup, error: '' });
      } catch (e) {
        setAuth({ loading: false, user: null, needsSetup: false, error: e.message });
      }
    })();
  }, []);

  if (auth.loading) return <div className="center-screen"><Loading /></div>;
  if (!auth.user) {
    return (
      <LoginPage
        needsSetup={auth.needsSetup}
        serverError={auth.error}
        onAuthed={(token, user) => { setToken(token); setAuth({ loading: false, user, needsSetup: false, error: '' }); }}
      />
    );
  }

  const logout = async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* already signed out */ }
    clearToken();
    clearDrafts();
    setAuth({ loading: false, user: null, needsSetup: false, error: '' });
  };

  return <Shell user={auth.user} onLogout={logout} />;
}

function Shell({ user, onLogout }) {
  const route = useHashRoute();
  const allowed = NAV.filter((n) => n.roles.includes(user.role));
  const home = allowed[0].page;
  const page = route.page === 'account' || allowed.some((n) => n.page === route.page) ? route.page : home;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={`#/${home}`}>
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5" /><path d="M9 12h7M9 16h7M9 8h3" />
            </svg>
          </span>
          Invoice Generator
        </a>
        <nav className="nav">
          {allowed.map((n) => (
            <a key={n.page} href={`#/${n.page}`} className={page === n.page ? 'active' : ''}>{n.label}</a>
          ))}
        </nav>
        <div className="user-box">
          <a href="#/account" className={page === 'account' ? 'active' : ''} title="My account">
            {user.name} <span className={`role-badge r-${user.role}`}>{ROLE_LABEL[user.role]}</span>
          </a>
          <button className="ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>

      <div className="page-body">
        {page === 'dashboard' && <DashboardPage user={user} />}
        {page === 'company' && <CompanyPage />}
        {page === 'invoices' && <InvoicesPage key={route.query.toString()} user={user} query={route.query} />}
        {page === 'editor' && <EditorPage user={user} invoiceId={route.param} query={route.query} />}
        {page === 'team' && <TeamPage user={user} />}
        {page === 'account' && <AccountPage user={user} />}
      </div>
    </div>
  );
}
