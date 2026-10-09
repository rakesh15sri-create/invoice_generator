import { fmtDate, money, num, totals } from '../data.js';
import { Logo, Multiline } from './shared.jsx';

const Ln = ({ a, b, className = '' }) => (
  <div className={`ln ${className}`}><span>{a}</span><span>{b}</span></div>
);

export default function Receipt({ inv }) {
  const t = totals(inv);
  const { company: c, doc: d, customer: cu, payment: p } = inv;

  return (
    <div className="t-receipt">
      <div className="slip">
        <div className="c">
          <Logo inv={inv} />
          <div className="co-name">{c.name}</div>
          <div>{c.legal}</div>
          <Multiline text={c.address} />
          <div>{c.phone}</div>
          {c.taxId && <div>TRN {c.taxId}</div>}
        </div>
        <hr />
        <Ln a="Receipt" b={d.number} />
        <Ln a="Date" b={fmtDate(d.date)} />
        <Ln a="Time" b={d.time} />
        <Ln a="Customer" b={cu.name} />
        <hr />
        {inv.items.map((it, i) => (
          <div key={i}>
            <div>{it.desc}</div>
            <Ln a={` ${it.qty} x ${num(it.price).toFixed(2)}`} b={(num(it.qty) * num(it.price)).toFixed(2)} />
          </div>
        ))}
        <hr />
        <Ln a="Subtotal" b={t.subtotal.toFixed(2)} />
        {t.discount > 0 && <Ln a="Discount" b={`-${t.discount.toFixed(2)}`} />}
        {num(inv.taxRate) > 0 && <Ln a={`VAT ${num(inv.taxRate)}%`} b={t.tax.toFixed(2)} />}
        <Ln className="total" a="TOTAL" b={money(t.total, inv.currency)} />
        <hr />
        <Ln a="Paid by" b={p.cardType || p.method} />
        {p.cardLast4 && <Ln a="Card" b={`**** ${p.cardLast4}`} />}
        {p.bank && <Ln a="Bank" b={p.bank} />}
        {p.txnId && <Ln a="Ref" b={p.txnId} />}
        <div className="c status">*** {String(d.status).toUpperCase()} ***</div>
        <hr />
        <div className="c">{inv.footer}</div>
      </div>
    </div>
  );
}
