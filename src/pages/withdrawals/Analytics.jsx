import Bars, { Card } from '../../components/Bars.jsx';
import { compact, fmtAmount } from '../../components/ui.jsx';
import { AGE_BUCKETS, DEPARTMENTS, STATUSES, fmtDuration, isOpen, statusStints } from '../../crm/domain.js';

const sumBy = (rows) => {
  const m = new Map();
  rows.forEach((w) => m.set(w.currency, (m.get(w.currency) || 0) + w.amount));
  return [...m].sort((a, b) => b[1] - a[1]);
};
const money = (rows) => (rows.length ? sumBy(rows).map(([c, v]) => `${c} ${compact(v)}`).join(' · ') : '—');

function groupOpen(rows, key, fallback) {
  const m = new Map();
  rows.forEach((w) => {
    const k = w[key] || fallback;
    const g = m.get(k) || { count: 0, rows: [] };
    g.count += 1;
    g.rows.push(w);
    m.set(k, g);
  });
  return [...m].sort((a, b) => b[1].count - a[1].count);
}

export default function Analytics({ rows, now, onFilter }) {
  const open = rows.filter((w) => isOpen(w.status));
  const completed = rows.filter((w) => w.status === 'completed');
  const rejected = rows.filter((w) => w.status === 'rejected');

  // Average handling time per desk: finished steps only (the last one is still running, or is the
  // final Completed/Rejected status, which needs no handling).
  const desk = new Map(DEPARTMENTS.map((d) => [d, { ms: 0, n: 0 }]));
  rows.forEach((w) => {
    const st = statusStints(w, now);
    st.slice(0, -1).forEach((s) => {
      const d = desk.get(s.dept);
      if (d) { d.ms += s.ms; d.n += 1; }
    });
  });
  const deskRows = [...desk].filter(([, d]) => d.n).map(([dept, d]) => ({
    label: dept, value: d.ms / d.n, text: fmtDuration(d.ms / d.n), sub: `· ${d.n} step${d.n === 1 ? '' : 's'}`,
  })).sort((a, b) => b.value - a.value);

  const ageRows = AGE_BUCKETS.map((b, i) => {
    const min = i ? AGE_BUCKETS[i - 1].max : 0;
    const items = open.filter((w) => { const a = now - Date.parse(w.requestedAt); return a >= min && a < b.max; });
    return { label: b.label, value: items.length, sub: items.length ? `· ${money(items)}` : '', color: ['#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#5b21b6'][i] };
  });

  const rmRows = groupOpen(open, 'rmName', 'Not assigned').map(([k, g]) => ({
    label: k, value: g.count, sub: `· ${money(g.rows)}`, onClick: () => onFilter({ rm: k === 'Not assigned' ? '-' : k }),
  }));
  const deptRows = groupOpen(open, 'department', '—').map(([k, g]) => ({
    label: k, value: g.count, sub: `· ${money(g.rows)}`, onClick: () => onFilter({ dept: k }),
  }));
  const statusRows = STATUSES.map((s) => {
    const items = rows.filter((w) => w.status === s.id);
    return { label: s.label, value: items.reduce((t, w) => t + w.amount, 0), text: money(items), color: s.color, onClick: () => onFilter({ status: s.id }) };
  }).filter((r) => r.value > 0);

  return (
    <div className="dash-grid">
      <div className="span-12 stat-row">
        <Stat label="Open requests" value={open.length} sub={money(open)} />
        <Stat label="Completed" value={completed.length} sub={money(completed)} />
        <Stat label="Rejected" value={rejected.length} sub={money(rejected)} />
        <Stat label="Average amount" value={rows.length ? fmtAmount(rows.reduce((t, w) => t + w.amount, 0) / rows.length) : '—'} sub="All shown requests" />
      </div>
      <Card className="span-6" title="Average handling time per desk" sub="How long a request stays with each department">
        <Bars rows={deskRows} empty="Move some requests through the stages to see handling times." />
      </Card>
      <Card className="span-6" title="Ageing of open requests" sub="Time since the client asked">
        <Bars rows={ageRows} />
      </Card>
      <Card className="span-6" title="Pending by RM" sub="Open requests · click to filter the board">
        <Bars rows={rmRows} empty="No open requests." />
      </Card>
      <Card className="span-6" title="Pending by department" sub="Who owns the open requests right now">
        <Bars rows={deptRows} empty="No open requests." />
      </Card>
      <Card className="span-12" title="Amounts by status" sub="All requests in the current range">
        <Bars rows={statusRows} empty="No requests." />
      </Card>
    </div>
  );
}

const Stat = ({ label, value, sub }) => (
  <div className="stat"><span>{label}</span><b>{value}</b><small>{sub}</small></div>
);
