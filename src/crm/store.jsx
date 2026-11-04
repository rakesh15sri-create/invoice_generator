import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CLIENT_ID, api } from '../api.js';
import { useToast } from '../components/ui.jsx';
import { isMailOpen, isOpen } from './domain.js';

// Live CRM data (withdrawals, clients, mail cases) shared by every page and the sidebar counts.
// Updates arrive by polling /api/crm/changes, which works on Vercel's serverless functions too.
const CrmContext = createContext(null);
const POLL_MS = 5000;
const FULL_REFRESH_MS = 120000; // safety net: reload everything now and then

const qs = (range) => new URLSearchParams(Object.entries(range || {}).filter(([, v]) => v)).toString();
const upsertIn = (list, doc) => {
  if (!list) return list;
  const i = list.findIndex((x) => x.id === doc.id);
  if (i < 0) return [doc, ...list];
  const next = list.slice();
  next[i] = doc;
  return next;
};

export function CrmProvider({ user, children }) {
  const [withdrawals, setWithdrawals] = useState(null);
  const [clients, setClients] = useState(null);
  const [mails, setMails] = useState(null);
  const [people, setPeople] = useState([]);
  const [invoiceCount, setInvoiceCount] = useState(null);
  const [wRange, setWRange] = useState({}); // {} = open + last 7 days
  const [mRange, setMRange] = useState({}); // {} = open + last 60 days
  const [live, setLive] = useState({ ok: true, at: null });
  const toast = useToast();

  const loaders = useRef({});
  loaders.current = {
    withdrawal: () => api(`/withdrawals?${qs(wRange)}`).then(setWithdrawals),
    client: () => api('/clients').then(setClients),
    mail: () => api(`/mails?${qs(mRange)}`).then(setMails),
    people: () => api('/crm/people').then(setPeople),
  };
  const reload = useCallback((kind) => {
    const kinds = kind === 'all' || !kind ? ['withdrawal', 'client', 'mail', 'people'] : [kind];
    return Promise.all(kinds.map((k) => loaders.current[k]().catch((e) => toast(e.message, 'error'))));
  }, [toast]);

  useEffect(() => { loaders.current.withdrawal().catch((e) => toast(e.message, 'error')); }, [wRange]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loaders.current.mail().catch((e) => toast(e.message, 'error')); }, [mRange]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload('client'); reload('people'); }, [reload]);

  // ---- polling ----
  useEffect(() => {
    let since = null; // null until the first answer gives the feed position
    let stopped = false;
    let timer;
    let lastFull = Date.now();
    const tick = async () => {
      if (document.hidden) { timer = setTimeout(tick, POLL_MS); return; }
      try {
        const r = await api(`/crm/changes${since == null ? '' : `?since=${since}`}`);
        if (stopped) return;
        setInvoiceCount(r.invoiceCount);
        const first = since == null;
        since = r.seq;
        const kinds = new Set();
        if (r.reload || Date.now() - lastFull > FULL_REFRESH_MS) { kinds.add('all'); lastFull = Date.now(); }
        for (const e of r.events) {
          if (e.action === 'reset' || e.kind === 'all') kinds.add('all');
          else if (e.origin !== CLIENT_ID) kinds.add(e.kind);
          if (e.text && e.by !== user.id && !first) toast(e.text, 'live');
        }
        if (kinds.has('all')) await reload('all');
        else await Promise.all([...kinds].map((k) => reload(k)));
        setLive({ ok: true, at: new Date() });
      } catch {
        if (!stopped) setLive((l) => ({ ...l, ok: false }));
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    tick();
    const onVisible = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [user.id, reload, toast]);

  // Local updates right after this tab saves something (the feed skips this tab's own changes).
  const put = useMemo(() => ({
    withdrawal: (doc) => setWithdrawals((l) => upsertIn(l, doc)),
    client: (doc) => setClients((l) => upsertIn(l, doc)),
    mail: (doc) => setMails((l) => upsertIn(l, doc)),
  }), []);
  const drop = useMemo(() => ({
    withdrawal: (id) => setWithdrawals((l) => l?.filter((x) => x.id !== id)),
    client: (id) => setClients((l) => l?.filter((x) => x.id !== id)),
    mail: (id) => setMails((l) => l?.filter((x) => x.id !== id)),
  }), []);

  const counts = useMemo(() => {
    const today = new Date().toDateString();
    const open = withdrawals?.filter((w) => isOpen(w.status)).length ?? null;
    const cleared = withdrawals?.filter((w) => w.status === 'completed' && w.closedAt && new Date(w.closedAt).toDateString() === today).length ?? 0;
    return {
      openWithdrawals: open,
      clearedToday: cleared,
      clients: clients?.length ?? null,
      openMails: mails?.filter((m) => isMailOpen(m.status)).length ?? null,
      replyPending: mails?.filter((m) => m.replyPending && isMailOpen(m.status)).length ?? null,
      invoices: invoiceCount,
    };
  }, [withdrawals, clients, mails, invoiceCount]);

  const value = {
    user, withdrawals, clients, mails, people, counts, live, reload, put, drop,
    wRange, setWRange, mRange, setMRange,
  };
  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>;
}

export const useCrm = () => useContext(CrmContext);

// Re-renders every `ms` so timers ("pending for 2h 10m") stay current.
export function useNow(ms = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// RMs first (people in the RM department), then everyone else.
export function rmOptions(people) {
  const rms = people.filter((p) => p.department === 'RM');
  return rms.length ? [...rms, ...people.filter((p) => p.department !== 'RM')] : people;
}
