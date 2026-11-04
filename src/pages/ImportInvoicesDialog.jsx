import { useState } from 'react';
import { api } from '../api.js';
import { Icon, Modal, fmtAmount, useToast } from '../components/ui.jsx';
import { defaults, fmtDate } from '../data.js';
import { paymentToInvoice, readPayments } from '../paymentImport.js';
import { TEMPLATE_GROUPS } from '../templates/index.js';

// Import a payment-gateway report (Excel or CSV): one paid invoice per successful payment.
// Failed, declined and fully refunded payments are listed but not imported; payments imported
// before are skipped by the server.
export default function ImportInvoicesDialog({ onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null); // { name, payments }
  const [opts, setOpts] = useState({ template: 'confirm', service: defaults().doc.service, numberFrom: 'sequence' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { created, skipped } after importing

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setResult(null);
    try {
      const payments = await readPayments(f);
      if (!payments.length) throw new Error('No payments found in this file. It needs a header row with columns like “Merchant Defined Order Number”, “Date”, “Total”, “Currency” and “Card Holder Email”.');
      setFile({ name: f.name, payments });
    } catch (err) {
      setFile(null);
      setError(err.message || 'Could not read that file. Save it as .xlsx or CSV and try again.');
    }
  };

  const set = (k) => (e) => setOpts({ ...opts, [k]: e.target.value });
  const payments = file?.payments || [];
  const problemOf = (p) => p.problem || (opts.numberFrom === 'order' && !p.orderNo ? 'No order number' : '');
  const ready = payments.filter((p) => !problemOf(p));
  const service = opts.service.trim();

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { invoices: ready.map((p) => ({ ref: p.ref, data: paymentToInvoice(p, { ...opts, service }) })) };
      const r = await api('/invoices/import', { method: 'POST', body });
      onDone();
      if (!r.skipped.length) {
        toast(`Created ${r.created.length} invoice${r.created.length === 1 ? '' : 's'}.`);
        onClose();
        return;
      }
      setResult(r);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const footer = result
    ? <button className="primary" onClick={onClose}>Done</button>
    : <>
      <button type="button" onClick={onClose}>Cancel</button>
      <button className="primary" onClick={run} disabled={busy || !ready.length || !service}>
        {busy ? 'Creating…' : `Create ${ready.length} invoice${ready.length === 1 ? '' : 's'}`}
      </button>
    </>;

  return (
    <Modal
      wide
      title="Import payments"
      sub="Upload the payment report (Excel or CSV). Each successful payment becomes a paid invoice."
      onClose={onClose}
      footer={footer}
    >
      {result ? (
        <>
          <p>Created <b>{result.created.length}</b> invoice{result.created.length === 1 ? '' : 's'}. {result.skipped.length} skipped:</p>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>Order</th><th>Reason</th></tr></thead>
              <tbody>
                {result.skipped.map((s, i) => {
                  const p = payments.find((x) => x.ref && x.ref === s.ref);
                  return <tr key={i}><td>{p?.orderNo || s.ref || '—'}</td><td>{s.reason}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <label className="drop-zone">
            <input type="file" accept=".xlsx,.csv,.txt,text/csv" onChange={pick} hidden />
            <Icon name="upload" /> {file
              ? <><b>{file.name}</b> · {payments.length} payment{payments.length === 1 ? '' : 's'} · choose another file</>
              : <><b>Choose the payment report</b> (.xlsx or .csv)</>}
          </label>

          {file && (
            <>
              <h4 className="sub-head">Invoice settings</h4>
              <div className="map-grid">
                <label className="field">
                  <span>Template</span>
                  <select value={opts.template} onChange={set('template')}>
                    {TEMPLATE_GROUPS.map((g) => (
                      <optgroup key={g.name} label={g.name}>
                        {g.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Service (line item)</span>
                  <input value={opts.service} onChange={set('service')} placeholder="e.g. Service Rendered" />
                </label>
                <label className="field">
                  <span>Invoice number</span>
                  <select value={opts.numberFrom} onChange={set('numberFrom')}>
                    <option value="sequence">Next in sequence (INV-…)</option>
                    <option value="order">Merchant order number</option>
                  </select>
                </label>
              </div>

              <h4 className="sub-head">Payments</h4>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>Order no.</th><th>Date</th><th>Customer</th><th>Card</th><th className="r">Amount</th><th>Import</th></tr></thead>
                  <tbody>
                    {payments.map((p, i) => {
                      const problem = problemOf(p);
                      return (
                        <tr key={i} className={problem ? 'muted-row' : ''}>
                          <td>{p.orderNo || p.ref || '—'}</td>
                          <td>{p.date ? fmtDate(p.date) : '—'}</td>
                          <td>{p.customer.name}{p.customer.email && p.customer.email !== p.customer.name && <div className="muted small">{p.customer.email}</div>}</td>
                          <td>{[p.payment.cardType, p.payment.cardLast4 && `•••• ${p.payment.cardLast4}`].filter(Boolean).join(' ') || '—'}</td>
                          <td className="r num">{fmtAmount(p.total, p.currency)}</td>
                          <td>{problem ? `Skip: ${problem}` : 'Yes'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {payments.length - ready.length > 0 && (
                <p className="muted small">{payments.length - ready.length} payment{payments.length - ready.length === 1 ? '' : 's'} won’t be imported (see the last column).</p>
              )}
              <p className="muted small">Your company details from the Company page are used on every invoice. Payments imported before are skipped automatically.</p>
            </>
          )}
        </>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
