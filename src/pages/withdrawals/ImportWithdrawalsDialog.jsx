import { useState } from 'react';
import { api } from '../../api.js';
import { Icon, Modal, fmtAmount, fmtDateTime, useToast } from '../../components/ui.jsx';
import { LARGE_AMOUNT } from '../../crm/domain.js';
import { useCrm } from '../../crm/store.jsx';
import { readWithdrawals } from '../../crm/withdrawalImport.js';

// Import the trading CRM's transactions export: each withdrawal becomes a request in Pending.
// The status in the file only decides which rows to take (all by default).
export default function ImportWithdrawalsDialog({ onClose }) {
  const { reload } = useCrm();
  const toast = useToast();
  const [file, setFile] = useState(null); // { name, rows }
  const [statuses, setStatuses] = useState([]); // file statuses to import
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { imported, skipped } when some rows were skipped

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    setResult(null);
    setConfirmLarge(false);
    try {
      const rows = await readWithdrawals(f);
      if (!rows.length) throw new Error('No withdrawal rows found in this file.');
      setFile({ name: f.name, rows });
      setStatuses([...new Set(rows.map((r) => r.fileStatus))]);
    } catch (err) {
      setFile(null);
      setError(err.message || 'Could not read that file. Save it as .xlsx or CSV and try again.');
    }
  };

  // Why a row won't be imported ('' = it will). One open request per account: the first row wins
  // (the export lists the newest first).
  const rows = file?.rows || [];
  const fileStatuses = [...new Set(rows.map((r) => r.fileStatus))];
  const taken = new Set();
  const plan = rows.map((r) => {
    let why = r.problem;
    if (!why && !statuses.includes(r.fileStatus)) why = 'Status not selected';
    if (!why && !r.accountNo) why = 'No account number';
    if (!why && taken.has(r.accountNo)) why = 'Same account earlier in the file';
    if (!why) taken.add(r.accountNo);
    return { r, why };
  });
  const ready = plan.filter((p) => !p.why).map((p) => p.r);
  const large = ready.filter((r) => r.large).length;

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const body = {
        rows: ready.map(({ ref, clientName, email, accountNo, amount, currency, method, requestedAt, note }) => ({ ref, clientName, email, accountNo, amount, currency, method, requestedAt, note })),
        confirmLarge,
      };
      const r = await api('/withdrawals/import', { method: 'POST', body });
      await reload('withdrawal');
      if (!r.skipped.length) {
        toast(`Imported ${r.imported} withdrawal request${r.imported === 1 ? '' : 's'} as Pending.`);
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

  const toggle = (s) => setStatuses(statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s]);
  const footer = result
    ? <button className="primary" onClick={onClose}>Done</button>
    : <>
      <button type="button" onClick={onClose}>Cancel</button>
      <button className="primary" onClick={run} disabled={busy || !ready.length || (large > 0 && !confirmLarge)}>
        {busy ? 'Importing…' : `Import ${ready.length} request${ready.length === 1 ? '' : 's'}`}
      </button>
    </>;

  return (
    <Modal
      wide
      title="Import withdrawal requests"
      sub="Upload the transactions export (CSV or Excel). Every imported request starts in Pending."
      onClose={onClose}
      footer={footer}
    >
      {result ? (
        <>
          <p>Imported <b>{result.imported}</b> request{result.imported === 1 ? '' : 's'} as Pending. {result.skipped.length} skipped:</p>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr><th>Transaction</th><th>Client</th><th>Reason</th></tr></thead>
              <tbody>
                {result.skipped.map((s, i) => <tr key={i}><td>{s.ref || '—'}</td><td>{s.clientName}</td><td>{s.reason}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <label className="drop-zone">
            <input type="file" accept=".csv,.xlsx,text/csv" onChange={pick} hidden />
            <Icon name="upload" /> {file
              ? <><b>{file.name}</b> · {rows.length} row{rows.length === 1 ? '' : 's'} · choose another file</>
              : <><b>Choose the transactions export</b> (.csv or .xlsx)</>}
          </label>

          {file && (
            <>
              {fileStatuses.length > 1 && (
                <>
                  <h4 className="sub-head">Import rows with status (in the file)</h4>
                  <div className="filters">
                    {fileStatuses.map((s) => (
                      <label key={s} className="toggle chip-toggle">
                        <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggle(s)} />
                        {s || 'no status'} ({rows.filter((r) => r.fileStatus === s).length})
                      </label>
                    ))}
                  </div>
                </>
              )}

              <h4 className="sub-head">Requests</h4>
              <div className="table-wrap">
                <table className="data-table compact">
                  <thead><tr><th>Transaction</th><th>Requested</th><th>Client</th><th>Account</th><th>Method</th><th className="r">Amount</th><th>In file</th><th>Import</th></tr></thead>
                  <tbody>
                    {plan.map(({ r, why }, i) => (
                      <tr key={i} className={why ? 'muted-row' : ''}>
                        <td>{r.ref || '—'}</td>
                        <td>{r.requestedAt ? fmtDateTime(r.requestedAt) : '—'}</td>
                        <td>{r.clientName}{r.email && <div className="muted small">{r.email}</div>}</td>
                        <td>{r.accountNo || '—'}</td>
                        <td>{r.method}</td>
                        <td className="r num">{fmtAmount(r.amount, r.currency)}</td>
                        <td>{r.fileStatus || '—'}</td>
                        <td>{why ? `Skip: ${why}` : 'Yes'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {large > 0 && (
                <label className="toggle">
                  <input type="checkbox" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
                  I’ve checked the {large} request{large === 1 ? '' : 's'} of {LARGE_AMOUNT.toLocaleString('en-US')} or more
                </label>
              )}
              <p className="muted small">
                Only the transaction, client, account, amount, method, date and bank details are imported; other columns are ignored.
                Accounts that already have an open request, and transactions imported before, are skipped.
              </p>
            </>
          )}
        </>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
