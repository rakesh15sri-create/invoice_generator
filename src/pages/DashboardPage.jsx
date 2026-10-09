import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Loading, StatusBadge, compact, fmtAmount, statusInfo } from '../components/ui.jsx';
import { fmtDate, pad, storage } from '../data.js';
import { navigate } from '../route.js';
import { templateName } from '../templates/index.js';

// ---------- periods ----------
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const monthStart = (back) => { const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth() - back, 1)); };

const PERIODS = [
  { id: 'month', label: 'This month', range: () => ({ from: monthStart(0), to: today() }) },
  { id: '3m', label: '3 months', range: () => ({ from: monthStart(2), to: today() }) },
  { id: 'year', label: 'This year', range: () => ({ from: `${new Date().getFullYear()}-01-01`, to: today() }) },
  { id: '12m', label: '12 months', range: () => ({ from: monthStart(11), to: today() }) },
  { id: 'all', label: 'All time', range: () => ({}) },
];

// Previous period of the same length, ending the day before this one starts.
function previousRange({ from, to }) {
  if (!from || !to) return {};
  const f = new Date(from + 'T00:00');
  const t = new Date(to + 'T00:00');
  const days = Math.round((t - f) / 86400000);
  const prevTo = new Date(f); prevTo.setDate(prevTo.getDate() - 1);
  const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days);
  return { prevFrom: iso(prevFrom), prevTo: iso(prevTo) };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (ym, withYear) => { const [y, m] = ym.split('-'); return `${MONTHS[m - 1]}${withYear ? ' ' + y : ''}`; };

function niceMax(max) {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max)) / 2;
  return Math.ceil(max / step) * step;
}

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

// ---------- small building blocks ----------
const ICONS = {
  billed: <path d="M3 7h18v12H3zM3 7l2-3h14l2 3M8 13h8" />,
  received: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  outstanding: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  invoices: <><path d="M6 2h9l5 5v15H6z" /><path d="M15 2v5h5M9 12h7M9 16h7" /></>,
};
const Icon = ({ name }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

// 12-point trend line; the last point is marked.
function Sparkline({ values }) {
  const w = 120, h = 34, p = 3;
  const max = Math.max(...values, 0) || 1;
  const pts = values.map((v, i) => [p + (i * (w - 2 * p)) / (values.length - 1), h - p - (v / max) * (h - 2 * p)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <polyline points={pts.map((q) => q.join(',')).join(' ')} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" />
    </svg>
  );
}

// "▲ 12% vs previous period" — colour by whether the direction is good.
function Delta({ now, before, upIsGood = true }) {
  if (before == null) return <span className="delta muted">Last 12 months trend</span>;
  if (before === 0) return <span className="delta muted">{now > 0 ? 'No data last period' : 'No change'}</span>;
  const change = ((now - before) / before) * 100;
  const up = change >= 0;
  const good = up === upIsGood;
  return (
    <span className={`delta ${Math.abs(change) < 0.5 ? 'muted' : good ? 'good' : 'bad'}`}>
      {up ? '▲' : '▼'} {Math.abs(change).toFixed(change !== 0 && Math.abs(change) < 10 ? 1 : 0)}% <span className="muted">vs previous period</span>
    </span>
  );
}

function Kpi({ icon, label, value, sub, trend, delta, hero, children }) {
  return (
    <div className={`kpi${hero ? ' hero' : ''}`}>
      <div className="kpi-top">
        <span className="kpi-icon"><Icon name={icon} /></span>
        <span className="kpi-label">{label}</span>
      </div>
      <div className="kpi-mid">
        <div>
          <div className="kpi-value">{value}</div>
          {sub && <div className="kpi-sub">{sub}</div>}
        </div>
        <Sparkline values={trend} />
      </div>
      {children}
      <div className="kpi-foot">{delta}</div>
    </div>
  );
}

function Card({ title, sub, action, className = '', children }) {
  return (
    <section className={`dcard ${className}`}>
      <header className="dcard-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

const Seg = ({ value, options, onChange, label }) => (
  <div className="seg" role="group" aria-label={label}>
    {options.map((o) => (
      <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
    ))}
  </div>
);

// ---------- Getting started (admin) ----------
function GettingStarted() {
  const [status, setStatus] = useState(null);
  const [hidden, setHidden] = useState(() => storage.get('invgen.hideGuide', false));
  useEffect(() => { if (!hidden) api('/setup-status').then(setStatus).catch(() => {}); }, [hidden]);
  if (hidden || !status) return null;

  const steps = [
    { done: status.hasCompany, title: 'Add your company details & logo', text: 'Entered once, used on every new invoice.', href: '#/company', cta: 'Add details' },
    { done: status.invoiceCount > 0, title: 'Create your first invoice', text: 'Pick a design, fill in the customer and save.', href: '#/editor', cta: 'Create invoice' },
    { done: status.memberCount > 1, title: 'Give your team access', text: 'Each person gets their own login.', href: '#/team', cta: 'Add team member' },
  ];
  if (steps.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card
      className="guide"
      title="Getting started"
      sub={`${doneCount} of 3 done`}
      action={<button className="link" onClick={() => { storage.set('invgen.hideGuide', true); setHidden(true); }}>Hide</button>}
    >
      <div className="guide-progress"><div style={{ width: `${(doneCount / 3) * 100}%` }} /></div>
      <ol className="guide-steps">
        {steps.map((s) => (
          <li key={s.title} className={s.done ? 'done' : ''}>
            <span className="guide-check" aria-hidden="true">{s.done ? '✓' : ''}</span>
            <div><b>{s.title}</b><div className="muted">{s.text}</div></div>
            {!s.done && <a className="btn" href={s.href}>{s.cta}</a>}
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------- page ----------
export default function DashboardPage({ user }) {
  const [period, setPeriod] = useState(() => storage.get('invgen.dashPeriod', '12m'));
  const [currency, setCurrency] = useState('');
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    storage.set('invgen.dashPeriod', period);
    const range = PERIODS.find((p) => p.id === period).range();
    const params = new URLSearchParams({ ...range, ...previousRange(range) });
    if (currency) params.set('currency', currency);
    api(`/stats?${params}`)
      .then((s) => { setStats(s); setError(''); })
      .catch((e) => setError(e.message));
  }, [period, currency]);

  useEffect(() => { api('/invoices').then((r) => setRecent(r.slice(0, 6))).catch(() => {}); }, []);

  if (error) return <div className="page"><div className="form-error">{error}</div></div>;
  if (!stats) return <div className="page"><Loading /></div>;

  const cur = stats.currency;
  const t = stats.totals;
  const prev = stats.previous;
  const months = stats.byMonth;
  const empty = t.count === 0;
  const firstName = user.name.split(/\s+/)[0];
  const longDate = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="page dash">
      <div className="dash-head">
        <div>
          <h2>{greeting()}, {firstName}</h2>
          <p className="muted">{longDate} · here’s how billing is going</p>
        </div>
        <div className="dash-controls">
          <Seg value={period} options={PERIODS} onChange={setPeriod} label="Period" />
          {stats.currencies.length > 1 && (
            <select value={cur} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">
              {stats.currencies.map((c) => <option key={c.currency} value={c.currency}>{c.currency}</option>)}
            </select>
          )}
          <a className="btn primary" href="#/editor">+ New invoice</a>
        </div>
      </div>

      {user.role === 'admin' && <GettingStarted />}

      <div className="kpis">
        <Kpi
          hero icon="billed" label="Total billed"
          value={`${cur} ${compact(t.billed)}`} sub={fmtAmount(t.billed, cur)}
          trend={months.map((m) => m.billed)}
          delta={<Delta now={t.billed} before={prev?.billed} />}
        />
        <Kpi
          icon="received" label="Received"
          value={`${cur} ${compact(t.paid)}`} sub={`${pct(t.paid, t.billed)}% collected`}
          trend={months.map((m) => m.paid)}
          delta={<Delta now={t.paid} before={prev?.paid} />}
        >
          <div className="meter" title={`${pct(t.paid, t.billed)}% of billed amount received`}>
            <div style={{ width: `${pct(t.paid, t.billed)}%` }} />
          </div>
        </Kpi>
        <Kpi
          icon="outstanding" label="Outstanding"
          value={`${cur} ${compact(t.outstanding)}`} sub="Not yet received"
          trend={months.map((m) => m.outstanding)}
          delta={<Delta now={t.outstanding} before={prev?.outstanding} upIsGood={false} />}
        />
        <Kpi
          icon="invoices" label="Invoices"
          value={t.count.toLocaleString('en-US')} sub={t.cancelled ? `${t.cancelled} cancelled` : 'Created in this period'}
          trend={months.map((m) => m.count)}
          delta={<Delta now={t.count} before={prev?.count} />}
        />
      </div>

      {empty ? (
        <section className="dcard empty-state">
          <div className="empty-art" aria-hidden="true"><Icon name="invoices" /></div>
          <h3>No {cur} invoices in this period</h3>
          <p className="muted">Create an invoice, or choose a longer period above.</p>
          <a className="btn primary" href="#/editor">Create an invoice</a>
        </section>
      ) : (
        <div className="dash-grid">
          <RevenueCard className="span-8" rows={months} currency={cur} />
          <StatusCard className="span-4" rows={stats.byStatus} currency={cur} />
          <CategoryCard className="span-6" rows={stats.byCategory} currency={cur} />
          <CustomersCard className="span-6" rows={stats.byCustomer} currency={cur} />
          <RecentCard className="span-8" rows={recent} />
          <TeamCard className="span-4" rows={stats.byUser} currency={cur} />
        </div>
      )}
    </div>
  );
}

// ---------- Billed vs received per month: grouped columns, 2 series ----------
function RevenueCard({ rows, currency, className }) {
  const [view, setView] = useState('chart');
  const [hover, setHover] = useState(null);
  const top = niceMax(Math.max(...rows.map((r) => r.billed), 0));
  const ticks = [top, (top * 2) / 3, top / 3, 0];

  return (
    <Card
      className={className}
      title="Billed vs received"
      sub={`Last 12 months · ${currency} · cancelled bills excluded`}
      action={<Seg value={view} onChange={setView} label="View" options={[{ id: 'chart', label: 'Chart' }, { id: 'table', label: 'Table' }]} />}
    >
      {view === 'chart' ? (
        <>
          <div className="legend">
            <span><i className="sw s1" />Billed</span>
            <span><i className="sw s2" />Received</span>
          </div>
          <div className="cols-chart">
            <div className="y-axis">{ticks.map((v) => <span key={v}>{compact(v)}</span>)}</div>
            <div className="cols-plot">
              {ticks.map((v) => <div key={v} className="grid-line" style={{ bottom: `${(v / top) * 100}%` }} />)}
              {rows.map((r, i) => (
                <div key={r.month} className={`col-slot${hover === i ? ' on' : ''}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                  <div className="col-pair">
                    <div className="col s1" style={{ height: `${(r.billed / top) * 100}%` }} />
                    <div className="col s2" style={{ height: `${(r.paid / top) * 100}%` }} />
                  </div>
                  <span className={`x-label${i % 2 ? ' alt' : ''}`}>
                    {monthLabel(r.month, false)}
                    {(i === 0 || r.month.endsWith('-01')) && <span className="yr"> {r.month.slice(0, 4)}</span>}
                  </span>
                  {hover === i && (
                    <div className={`tip col-tip${i > 8 ? ' left' : ''}`} style={{ bottom: `${Math.max(r.billed / top, 0.1) * 100}%` }}>
                      <b>{monthLabel(r.month, true)}</b>
                      <div><span><i className="sw s1" />Billed</span>{fmtAmount(r.billed, currency)}</div>
                      <div><span><i className="sw s2" />Received</span>{fmtAmount(r.paid, currency)}</div>
                      <div><span>Bills</span>{r.count}</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <table className="data-table compact">
          <thead><tr><th>Month</th><th className="r">Bills</th><th className="r">Billed</th><th className="r">Received</th><th className="r">Outstanding</th></tr></thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.month}>
                <td>{monthLabel(r.month, true)}</td>
                <td className="r num">{r.count}</td>
                <td className="r num">{fmtAmount(r.billed)}</td>
                <td className="r num">{fmtAmount(r.paid)}</td>
                <td className="r num">{fmtAmount(r.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------- Status: one stacked bar (part-to-whole) + legend with values ----------
function StatusCard({ rows, currency, className }) {
  const [hover, setHover] = useState(null);
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card className={className} title="Payment status" sub={`${total} bills in this period`}>
      <div className="stack" role="img" aria-label="Bills by status">
        {rows.map((r) => (
          <div
            key={r.status}
            className={`stack-seg${hover && hover !== r.status ? ' dim' : ''}`}
            style={{ flexGrow: r.count, background: statusInfo(r.status).color }}
            title={`${statusInfo(r.status).label}: ${r.count}`}
          />
        ))}
      </div>
      <ul className="status-list">
        {rows.map((r) => (
          <li
            key={r.status}
            onMouseEnter={() => setHover(r.status)}
            onMouseLeave={() => setHover(null)}
            onClick={() => navigate(`#/invoices?status=${encodeURIComponent(r.status)}`)}
          >
            <StatusBadge status={r.status} />
            <span className="sl-count">{r.count} <small>({pct(r.count, total)}%)</small></span>
            <span className="sl-amount">{fmtAmount(r.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Categories: ranked bars with share ----------
function CategoryCard({ rows, currency, className }) {
  const max = Math.max(...rows.map((r) => r.billed), 0);
  const total = rows.reduce((s, r) => s + r.billed, 0);
  return (
    <Card className={className} title="Bills by category" sub={`Billed amount, ${currency} · click to open`}>
      <ol className="rank-list">
        {rows.map((r, i) => (
          <li key={r.template} onClick={() => navigate(`#/invoices?template=${encodeURIComponent(r.template)}`)} title={`${r.count} bills · received ${fmtAmount(r.paid, currency)} · outstanding ${fmtAmount(r.outstanding, currency)}`}>
            <span className="rank">{i + 1}</span>
            <div className="rank-main">
              <div className="rank-row">
                <span className="rank-name">{templateName(r.template)}</span>
                <span className="rank-val">{compact(r.billed)} <small>{pct(r.billed, total)}%</small></span>
              </div>
              <div className="rank-track"><div style={{ width: `${max ? (r.billed / max) * 100 : 0}%` }} /></div>
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------- Top customers ----------
function CustomersCard({ rows, currency, className }) {
  return (
    <Card className={className} title="Top customers" sub={`By billed amount, ${currency}`}>
      <ul className="people">
        {rows.map((c) => (
          <li key={c.name}>
            <span className="avatar">{initials(c.name)}</span>
            <div className="people-main">
              <b>{c.name}</b>
              <small>{c.count} bill{c.count === 1 ? '' : 's'}{c.outstanding > 0 && <> · <span className="owes">{compact(c.outstanding)} outstanding</span></>}</small>
            </div>
            <span className="people-val">{fmtAmount(c.billed, currency)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------- Recent invoices ----------
function RecentCard({ rows, className }) {
  return (
    <Card className={className} title="Recent invoices" action={<a className="link-btn" href="#/invoices">View all →</a>}>
      {rows.length === 0 ? <p className="muted">No invoices yet.</p> : (
        <table className="data-table compact">
          <thead><tr><th>Invoice</th><th>Customer</th><th>Category</th><th>Status</th><th className="r">Amount</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => navigate(`#/editor/${r.id}`)}>
                <td><b>{r.number}</b><div className="muted small">{fmtDate(r.date)}</div></td>
                <td>{r.customerName}</td>
                <td>{templateName(r.template)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="r num">{fmtAmount(r.total, r.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ---------- Team ----------
function TeamCard({ rows, currency, className }) {
  const max = Math.max(...rows.map((r) => r.billed), 0);
  return (
    <Card className={className} title="Team" sub={`Billed by each member, ${currency}`}>
      <ul className="people team">
        {rows.map((r) => (
          <li key={r.userId ?? 'none'} className={r.userId ? 'clickable' : ''} onClick={() => r.userId && navigate(`#/invoices?member=${r.userId}`)}>
            <span className="avatar">{initials(r.name)}</span>
            <div className="people-main">
              <div className="rank-row"><b>{r.name}</b><span className="people-val">{compact(r.billed)}</span></div>
              <div className="rank-track thin"><div style={{ width: `${max ? (r.billed / max) * 100 : 0}%` }} /></div>
              <small>{r.count} bill{r.count === 1 ? '' : 's'} · {pct(r.paid, r.billed)}% collected</small>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
