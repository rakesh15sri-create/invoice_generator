import { fmtDate, money, totals } from '../data.js';
import { ExtrasBasic, ItemsTable, Logo, Multiline, TotalsRows } from './shared.jsx';

export default function Classic({ inv }) {
  const t = totals(inv);
  const { company: c, doc: d, customer: cu, payment: p } = inv;
  const showPaid = inv.amountPaid !== '' && inv.amountPaid != null;

  return (
    <div className="t-classic">
      <div className="hdr">
        <div>
          <Logo inv={inv} />
          <div className="co-name">{c.name} {c.legal}</div>
          <Multiline className="muted" text={c.address} />
          <div className="muted">{[c.phone, c.email].filter(Boolean).join(' · ')}</div>
          {c.taxId && <div className="muted">TRN: {c.taxId}</div>}
        </div>
        <div>
          <h1>INVOICE</h1>
          <table className="meta">
            <tbody>
              <tr><td className="muted">Invoice #</td><td><b>{d.number}</b></td></tr>
              <tr><td className="muted">Date</td><td>{fmtDate(d.date)}</td></tr>
              {d.dueDate && <tr><td className="muted">Due</td><td>{fmtDate(d.dueDate)}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="parties">
        <div>
          <div className="lbl">Bill to</div>
          <div><b>{cu.name}</b></div>
          {cu.company && <div>{cu.company}</div>}
          <Multiline className="muted" text={cu.address} />
          <div className="muted">{cu.email}</div>
          <div className="muted">{cu.phone}</div>
        </div>
        <div>
          <div className="lbl">Payment</div>
          <div>{[p.method, p.cardType].filter(Boolean).join(' · ')}</div>
          {p.cardLast4 && <div className="muted">**** {p.cardLast4}</div>}
          {p.bank && <div className="muted">{p.bank}</div>}
          {p.txnId && <div className="muted">Ref: {p.txnId}</div>}
        </div>
      </div>

      <ExtrasBasic inv={inv} />
      <ItemsTable inv={inv} />
      <table className="totals">
        <tbody>
          <TotalsRows inv={inv} t={t} />
          <tr className="grand"><td>Total</td><td className="r">{money(t.total, inv.currency)}</td></tr>
          {showPaid && (
            <>
              <tr><td>Paid</td><td className="r">{money(t.paid, inv.currency)}</td></tr>
              <tr><td><b>Balance</b></td><td className="r"><b>{money(t.balance, inv.currency)}</b></td></tr>
            </>
          )}
        </tbody>
      </table>

      <div className="bottom">
        <div>
          {inv.notes && <><div className="lbl">Notes</div><Multiline text={inv.notes} /></>}
          {p.bankDetails && <><div className="lbl" style={{ marginTop: 14 }}>Bank details</div><Multiline text={p.bankDetails} /></>}
        </div>
        <div style={{ textAlign: 'right' }}><span className="stamp">{d.status}</span></div>
      </div>
      <div className="foot">{inv.footer}</div>
    </div>
  );
}
