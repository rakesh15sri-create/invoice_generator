import { fmtDate, money, totals } from '../data.js';
import { ItemsTable, Logo, Multiline, TotalsRows } from './shared.jsx';

export default function Minimal({ inv }) {
  const t = totals(inv);
  const { company: c, doc: d, customer: cu, payment: p } = inv;
  const payLine = [
    p.method + (p.cardLast4 ? ` **** ${p.cardLast4}` : ''),
    p.bank,
    p.txnId && `Ref ${p.txnId}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="t-minimal">
      <div className="top">
        <div>
          <Logo inv={inv} />
          <div className="co-name">{c.name} {c.legal}</div>
          <Multiline className="muted" text={c.address} />
        </div>
        <div className="muted" style={{ textAlign: 'right' }}>{c.email}<br />{c.phone}</div>
      </div>

      <div className="big">{d.title || 'Invoice'}</div>
      <div className="muted">{d.number}</div>

      <div className="grid">
        <div><div className="k">Billed to</div>{cu.name}<br /><span className="muted">{cu.email}</span></div>
        <div><div className="k">Date</div>{fmtDate(d.date)}</div>
        <div><div className="k">{d.dueDate ? 'Due' : 'Time'}</div>{d.dueDate ? fmtDate(d.dueDate) : d.time}</div>
        <div><div className="k">Status</div>{d.status}</div>
      </div>

      <ItemsTable inv={inv} className="" />
      <table style={{ width: 280, marginLeft: 'auto', marginTop: 10 }}>
        <tbody><TotalsRows inv={inv} t={t} /></tbody>
      </table>
      <div className="tot"><span>Total</span><b>{money(t.total, inv.currency)}</b></div>

      <div className="foot">
        {payLine}
        {inv.notes && <p style={{ whiteSpace: 'pre-line' }}>{inv.notes}</p>}
        <p>{inv.footer}</p>
      </div>
    </div>
  );
}
