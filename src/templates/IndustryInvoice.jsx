import { fmtDate, isPaid, money, num, totals } from '../data.js';
import { INDUSTRIES, INDUSTRY_BY_ID } from './industries.js';
import { Logo, Multiline } from './shared.jsx';

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function Brand({ inv, light }) {
  const c = inv.company;
  return (
    <div className="brand-blk">
      {c.logo ? <Logo inv={inv} /> : <div className={`mono${light ? ' light' : ''}`}>{initials(c.name)}</div>}
      <div>
        <div className="co-name">{c.name} {c.legal}</div>
        <div className="co-tag">{c.tagline}</div>
      </div>
    </div>
  );
}

const Status = ({ inv }) => (
  <span className={`status-pill ${isPaid(inv) ? 'ok' : 'due'}`}>{inv.doc.status}</span>
);

function Meta({ inv }) {
  const d = inv.doc;
  return (
    <div className="meta">
      <div><span>Invoice No.</span><b>{d.number}</b></div>
      <div><span>Date</span><b>{fmtDate(d.date)}{d.time && `, ${d.time}`}</b></div>
      {d.dueDate && <div><span>Due Date</span><b>{fmtDate(d.dueDate)}</b></div>}
      <div><span>Status</span><Status inv={inv} /></div>
    </div>
  );
}

function CompanyBlock({ inv }) {
  const c = inv.company;
  return (
    <div className="party">
      <div className="p-lbl">Pay To</div>
      <div className="p-name">{c.name} {c.legal}</div>
      <Multiline text={c.address} />
      {c.phone && <div>{c.phone}</div>}
      {c.email && <div>{c.email}</div>}
      {c.taxId && <div>TRN: {c.taxId}</div>}
    </div>
  );
}

function CustomerBlock({ inv }) {
  const cu = inv.customer;
  return (
    <div className="party">
      <div className="p-lbl">Invoice To</div>
      <div className="p-name">{cu.name}</div>
      {cu.company && <div>{cu.company}</div>}
      <Multiline text={cu.address} />
      {cu.phone && <div>{cu.phone}</div>}
      {cu.email && <div>{cu.email}</div>}
    </div>
  );
}

function Extras({ inv, cfg }) {
  const list = (inv.extras || []).filter((e) => e.label || e.value);
  if (!list.length) return null;
  return (
    <div className="extras">
      <div className="sec-title">{cfg.extrasTitle}</div>
      <div className="extras-grid">
        {list.map((e, i) => (
          <div key={i}><span>{e.label}</span><b>{e.value}</b></div>
        ))}
      </div>
    </div>
  );
}

function Items({ inv, cfg }) {
  const [c1, c2, c3] = cfg.cols;
  return (
    <table className="items">
      <thead>
        <tr><th className="n">#</th><th>{c1}</th><th className="r">{c2}</th><th className="r">{c3}</th><th className="r">Amount</th></tr>
      </thead>
      <tbody>
        {inv.items.map((it, i) => (
          <tr key={i}>
            <td className="n">{pad2(i + 1)}</td>
            <td>{it.desc}</td>
            <td className="r">{it.qty}</td>
            <td className="r">{money(it.price, inv.currency)}</td>
            <td className="r">{money(num(it.qty) * num(it.price), inv.currency)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
const pad2 = (n) => String(n).padStart(2, '0');

function PaymentInfo({ inv }) {
  const p = inv.payment;
  const rows = [
    ['Method', p.method],
    ['Card / Wallet', [p.cardType, p.cardLast4 && `**** ${p.cardLast4}`].filter(Boolean).join(' · ')],
    ['Bank', p.bank],
    ['Transaction ID', p.txnId],
  ].filter(([, v]) => v);
  return (
    <div className="pay">
      <div className="sec-title">Payment Info</div>
      {rows.map(([k, v]) => <div className="kv" key={k}><span>{k}</span><b>{v}</b></div>)}
      {p.bankDetails && <Multiline className="bank" text={p.bankDetails} />}
    </div>
  );
}

function Totals({ inv }) {
  const t = totals(inv);
  const cur = inv.currency;
  const showPaid = inv.amountPaid !== '' && inv.amountPaid != null;
  return (
    <div className="totals">
      <div className="kv"><span>Subtotal</span><b>{money(t.subtotal, cur)}</b></div>
      {t.discount > 0 && <div className="kv"><span>Discount</span><b>- {money(t.discount, cur)}</b></div>}
      {num(inv.taxRate) > 0 && <div className="kv"><span>VAT ({num(inv.taxRate)}%)</span><b>{money(t.tax, cur)}</b></div>}
      <div className="kv grand"><span>Total</span><b>{money(t.total, cur)}</b></div>
      {showPaid && <div className="kv"><span>Paid</span><b>{money(t.paid, cur)}</b></div>}
      {showPaid && <div className="kv"><span>Balance Due</span><b>{money(t.balance, cur)}</b></div>}
    </div>
  );
}

function Closing({ inv }) {
  return (
    <>
      {(inv.notes || inv.confirmText) && (
        <div className="terms">
          <div className="sec-title">Terms &amp; Notes</div>
          <Multiline text={inv.notes || inv.confirmText.replace(/\{service\}/g, inv.doc.service)} />
        </div>
      )}
      <div className="sign">
        <div className="thanks">{inv.footer}</div>
        <div className="sig"><div className="line" />Authorised Signature</div>
      </div>
    </>
  );
}

// ---------- layouts ----------

function Band({ inv, cfg }) {
  return (
    <>
      <div className="head band">
        <Brand inv={inv} light />
        <div className="ttl">
          <h1>{cfg.title}</h1>
          <div className="sub">{inv.doc.number}</div>
        </div>
      </div>
      <div className="body">
        <Meta inv={inv} />
        <div className="parties"><CustomerBlock inv={inv} /><CompanyBlock inv={inv} /></div>
        <Extras inv={inv} cfg={cfg} />
        <Items inv={inv} cfg={cfg} />
        <div className="bottom"><PaymentInfo inv={inv} /><Totals inv={inv} /></div>
        <Closing inv={inv} />
      </div>
    </>
  );
}

function Corner({ inv, cfg }) {
  return (
    <>
      <div className="head corner">
        <Brand inv={inv} />
        <div className="ttl"><h1>{cfg.title}</h1></div>
        <div className="shape" />
      </div>
      <div className="body">
        <Meta inv={inv} />
        <div className="parties"><CustomerBlock inv={inv} /><CompanyBlock inv={inv} /></div>
        <Extras inv={inv} cfg={cfg} />
        <Items inv={inv} cfg={cfg} />
        <div className="bottom"><PaymentInfo inv={inv} /><Totals inv={inv} /></div>
        <Closing inv={inv} />
      </div>
      <div className="corner-foot" />
    </>
  );
}

function Split({ inv, cfg }) {
  return (
    <div className="split-wrap">
      <aside className="side">
        <Brand inv={inv} light />
        <CustomerBlock inv={inv} />
        <CompanyBlock inv={inv} />
        <PaymentInfo inv={inv} />
      </aside>
      <div className="main">
        <h1>{cfg.title}</h1>
        <Meta inv={inv} />
        <Extras inv={inv} cfg={cfg} />
        <Items inv={inv} cfg={cfg} />
        <div className="bottom single"><Totals inv={inv} /></div>
        <Closing inv={inv} />
      </div>
    </div>
  );
}

function Ticket({ inv, cfg }) {
  const t = totals(inv);
  return (
    <div className="ticket">
      <div className="head band">
        <Brand inv={inv} light />
        <div className="ttl">
          <h1>{cfg.title}</h1>
          <div className="sub">{inv.doc.number}</div>
        </div>
      </div>
      <div className="body">
        <Extras inv={inv} cfg={cfg} />
        <div className="ticket-strip">
          <div><span>Customer</span><b>{inv.customer.name}</b></div>
          <div><span>Date</span><b>{fmtDate(inv.doc.date)}</b></div>
          <div><span>Total</span><b>{money(t.total, inv.currency)}</b></div>
          <div><span>Status</span><Status inv={inv} /></div>
        </div>
      </div>
      <div className="perf" />
      <div className="body">
        <div className="parties"><CustomerBlock inv={inv} /><CompanyBlock inv={inv} /></div>
        <Items inv={inv} cfg={cfg} />
        <div className="bottom"><PaymentInfo inv={inv} /><Totals inv={inv} /></div>
        <Closing inv={inv} />
      </div>
    </div>
  );
}

function Outline({ inv, cfg }) {
  return (
    <div className="outline-wrap">
      <div className="head outline">
        <Brand inv={inv} />
        <div className="ttl"><h1>{cfg.title}</h1><div className="sub">{inv.doc.number}</div></div>
      </div>
      <div className="body">
        <Meta inv={inv} />
        <div className="parties boxed"><CustomerBlock inv={inv} /><CompanyBlock inv={inv} /></div>
        <Extras inv={inv} cfg={cfg} />
        <Items inv={inv} cfg={cfg} />
        <div className="bottom"><PaymentInfo inv={inv} /><Totals inv={inv} /></div>
        <Closing inv={inv} />
      </div>
    </div>
  );
}

const LAYOUTS = { band: Band, corner: Corner, split: Split, ticket: Ticket, outline: Outline };

export default function IndustryInvoice({ inv }) {
  const base = INDUSTRY_BY_ID[inv.template] || INDUSTRIES[0];
  const cfg = { ...base, title: inv.doc.title || base.title }; // title stays editable
  const Layout = LAYOUTS[cfg.layout];
  return (
    <div className={`t-ind l-${cfg.layout}`}>
      <Layout inv={inv} cfg={cfg} />
    </div>
  );
}
