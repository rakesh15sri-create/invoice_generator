import { money, num } from '../data.js';

export const Logo = ({ inv, className = 'logo' }) =>
  inv.company.logo ? <img className={className} src={inv.company.logo} alt="" /> : null;

export const Multiline = ({ text, className }) =>
  text ? <div className={className} style={{ whiteSpace: 'pre-line' }}>{text}</div> : null;

export function ExtrasBasic({ inv }) {
  const list = (inv.extras || []).filter((e) => e.label || e.value);
  if (!list.length) return null;
  return (
    <div className="extras-basic">
      {list.map((e, i) => <div key={i}><span>{e.label}</span>{e.value}</div>)}
    </div>
  );
}

export function ItemsTable({ inv, className = 'items' }) {
  return (
    <table className={className}>
      <thead>
        <tr><th>Description</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Amount</th></tr>
      </thead>
      <tbody>
        {inv.items.map((it, i) => (
          <tr key={i}>
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

export function TotalsRows({ inv, t }) {
  return (
    <>
      <tr><td>Subtotal</td><td className="r">{money(t.subtotal, inv.currency)}</td></tr>
      {t.discount > 0 && <tr><td>Discount</td><td className="r">- {money(t.discount, inv.currency)}</td></tr>}
      {num(inv.taxRate) > 0 && <tr><td>VAT ({num(inv.taxRate)}%)</td><td className="r">{money(t.tax, inv.currency)}</td></tr>}
    </>
  );
}
