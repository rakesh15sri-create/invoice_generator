import { fmtDate, isPaid, money, totals } from '../data.js';
import { ExtrasBasic, ItemsTable, Logo, Multiline, TotalsRows } from './shared.jsx';

export default function Modern({ inv }) {
  const t = totals(inv);
  const { company: c, doc: d, customer: cu, payment: p } = inv;
  const paid = isPaid(inv);

  return (
    <div className="t-modern">
      <div className="band">
        <div>
          <Logo inv={inv} />
          <div className="co-name">{c.name} {c.legal}</div>
          <div className="sub">{c.tagline}</div>
          <div className="sub">{[c.email, c.phone].filter(Boolean).join(' · ')}</div>
        </div>
        <div>
          <h1>{d.title || 'Invoice'}</h1>
          <div className="num">{d.number}</div>
          <div style={{ textAlign: 'right' }}><span className="pill">{d.status}</span></div>
        </div>
      </div>

      <div className="body">
        <div className="cards">
          <div className="card">
            <div className="k">Billed to</div>
            <div className="v">{cu.name}</div>
            <div>{cu.email}</div>
            {cu.company && <div>{cu.company}</div>}
          </div>
          <div className="card">
            <div className="k">Date</div>
            <div className="v">{fmtDate(d.date)}{d.time && `, ${d.time}`}</div>
            {d.dueDate && <><div className="k" style={{ marginTop: 8 }}>Due</div><div className="v">{fmtDate(d.dueDate)}</div></>}
          </div>
          <div className="card">
            <div className="k">Payment</div>
            <div className="v">{p.cardType || p.method}</div>
            {p.cardLast4 && <div>**** {p.cardLast4}</div>}
            <div>{p.bank}</div>
          </div>
        </div>

        <ExtrasBasic inv={inv} />
        <ItemsTable inv={inv} />
        <div className="sum"><table><tbody><TotalsRows inv={inv} t={t} /></tbody></table></div>
        <div className="total-box">
          <div>{paid ? 'Total paid' : 'Total due'}</div>
          <div className="amt">{money(paid ? t.paid : t.total, inv.currency)}</div>
        </div>

        {p.txnId && <div className="notes"><b>Transaction ID:</b> {p.txnId}</div>}
        <Multiline className="notes" text={inv.notes} />
        {p.bankDetails && <div className="notes"><b>Bank details</b><Multiline text={p.bankDetails} /></div>}
      </div>

      <div className="foot">
        <span>{inv.footer}</span>
        <span>{c.taxId && `TRN ${c.taxId}`}</span>
      </div>
    </div>
  );
}
