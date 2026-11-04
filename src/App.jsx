import { useEffect, useState } from 'react';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from './api.js';
import AccountPage from './pages/AccountPage.jsx';
import CompanyPage from './pages/CompanyPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import EditorPage, { clearDrafts } from './pages/EditorPage.jsx';
import InvoicesPage from './pages/InvoicesPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import TeamPage from './pages/TeamPage.jsx';
import ClientsPage from './pages/clients/ClientsPage.jsx';
import MailsPage from './pages/mails/MailsPage.jsx';
import WithdrawalsPage from './pages/withdrawals/WithdrawalsPage.jsx';
import Shell, { allowedPages } from './components/Shell.jsx';
import { FeedbackProvider, Loading } from './components/ui.jsx';
import { CrmProvider } from './crm/store.jsx';
import { useHashRoute } from './route.js';

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

  return <Main user={auth.user} onLogout={logout} />;
}

function Main({ user, onLogout }) {
  const route = useHashRoute();
  const allowed = allowedPages(user);
  const home = allowed[0].page;
  const page = allowed.some((n) => n.page === route.page) ? route.page : home;
  const [search, setSearch] = useState('');
  useEffect(() => { setSearch(''); }, [page]);

  return (
    <CrmProvider user={user}>
      <Shell user={user} page={page} onLogout={onLogout} search={search} setSearch={setSearch}>
        {page === 'dashboard' && <DashboardPage user={user} />}
        {page === 'company' && <CompanyPage />}
        {page === 'invoices' && <InvoicesPage key={route.query.toString()} user={user} query={route.query} search={search} />}
        {page === 'editor' && <EditorPage user={user} invoiceId={route.param} query={route.query} />}
        {page === 'team' && <TeamPage user={user} />}
        {page === 'account' && <AccountPage user={user} />}
        {page === 'withdrawals' && <WithdrawalsPage user={user} param={route.param} query={route.query} search={search} />}
        {page === 'clients' && <ClientsPage user={user} param={route.param} query={route.query} search={search} />}
        {page === 'mails' && <MailsPage user={user} param={route.param} query={route.query} search={search} />}
      </Shell>
    </CrmProvider>
  );
}
