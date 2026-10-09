import { fmtDate, isPaid, money, totals } from '../data.js';
import { ItemsTable, Logo, Multiline } from './shared.jsx';

export default function Confirmation({ inv }) {
  const t = totals(inv);
  const { company: c, doc: d, customer: cu, payment: p } = inv;
  const paid = isPaid(inv);
  const card = p.cardLast4 ? `Card Number **** ${p.cardLast4}` : p.method;

  return (
    <div className="t-confirm">
      <div className="hdr">
        <div>
          <Logo inv={inv} />
          <div className="co-name">{c.name}</div>
          <div className="co-legal">{c.legal}</div>
          <div className="co-tag">{c.tagline}</div>
        </div>
        <div>
          <div className="doc-title">{d.title}</div>
          <div className="doc-date">{fmtDate(d.date)}</div>
        </div>
      </div>

      <div className="hero">
        <div className="hero-l">
          <div className="lbl">{paid ? 'Payment Received' : 'Amount Due'}</div>
          <div className="amt">{money(paid ? t.paid : t.total, inv.currency)}</div>
          <div className="sub">{d.service}</div>
        </div>
        <div className="hero-r">
          <div className="check">{paid ? '✓' : '◯'}</div>
          <div className="status">{paid ? 'Successful' : d.status}</div>
          <div className="status-sub">{paid ? 'Paid' : 'Awaiting payment'}</div>
        </div>
      </div>

      <div className="sec">Customer</div>
      <div className="box c2">
        <div><div className="k">Customer</div><div className="v n">{cu.email}</div></div>
        <div><div className="k">Name</div><div className="v">{cu.name}</div></div>
      </div>

      <div className="sec">Transaction Information</div>
      <div className="box c2">
        <div><div className="k">RETL / ID</div><div className="v">{p.txnId}</div></div>
        <div><div className="k">Payment Date</div><div className="v">{fmtDate(d.date)}</div></div>
        <div><div className="k">Time</div><div className="v">{d.time}</div></div>
        <div><div className="k">Service</div><div className="v">{d.service}</div></div>
      </div>

      {inv.items.length > 1 && (<><div className="sec">Items</div><ItemsTable inv={inv} /></>)}

      <div className="sec">Payment Method</div>
      <div className="box c3">
        <div><div className="k">{p.method}</div><div className="v">{card}</div></div>
        <div><div className="k">Card Type</div><div className="v">{p.cardType}</div></div>
        <div><div className="k">Issuing Bank</div><div className="v">{p.bank}</div></div>
      </div>

      <div className="note">
        <div className="t">{paid ? 'Payment Confirmed' : `Payment ${d.status}`}</div>
        <Multiline className="b" text={inv.confirmText.replace(/\{service\}/g, d.service)} />
      </div>

      <div className="foot">
        <div className="a">{c.name} {c.legal}</div>
        <div className="b">{inv.footer}</div>
      </div>
    </div>
  );
}
