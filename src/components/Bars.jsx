// Ranked horizontal bars: [{ label, value, text?, sub?, color?, onClick? }]
export default function Bars({ rows, empty = 'Nothing to show yet.', format = (v) => v }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 0) || 1;
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.label} className={r.onClick ? 'clickable' : ''} onClick={r.onClick} title={r.title}>
          <div className="bars-row">
            <span className="bars-label">{r.label}</span>
            <span className="bars-val">{r.text ?? format(r.value)}{r.sub && <small> {r.sub}</small>}</span>
          </div>
          <div className="bars-track"><div style={{ width: `${(r.value / max) * 100}%`, ...(r.color && { background: r.color }) }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function Card({ title, sub, action, className = '', children }) {
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
