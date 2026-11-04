import { useState } from 'react';
import { api } from '../../api.js';
import { Icon, Modal, useToast } from '../../components/ui.jsx';
import { CLIENT_FIELDS, applyMap, autoMap, parseCsv } from '../../crm/csv.js';
import { useCrm } from '../../crm/store.jsx';

// CSV import: pick a file, check the column mapping (auto-detected from common CRM column names), import.
export default function ImportDialog({ onClose }) {
  const { reload } = useCrm();
  const toast = useToast();
  const [file, setFile] = useState(null); // { name, header, rows }
  const [map, setMap] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError('');
    try {
      const all = parseCsv(await f.text());
      if (all.length < 2) throw new Error('The file needs a header row and at least one client.');
      const header = all[0].map((h) => h.trim());
      setFile({ name: f.name, header, rows: all.slice(1) });
      setMap(autoMap(header));
    } catch (err) {
      setError(err.message || 'Could not read that file. Save it as CSV and try again.');
    }
  };

  const mapped = file ? applyMap(file.rows, map) : [];
  const valid = mapped.filter((r) => r.name);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api('/clients/import', { method: 'POST', body: { rows: valid } });
      await reload('client');
      toast(`Imported ${r.imported} clients${r.skipped ? ` (${r.skipped} rows without a name skipped)` : ''}. Use “Undo last import” if something looks wrong.`);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const options = file?.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>);

  return (
    <Modal
      wide
      title="Import clients from CSV"
      sub="Imported clients are marked as backfilled. You can undo the whole import afterwards."
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>Cancel</button>
        <button className="primary" onClick={run} disabled={busy || !valid.length}>{busy ? 'Importing…' : `Import ${valid.length} client${valid.length === 1 ? '' : 's'}`}</button>
      </>}
    >
      <label className="drop-zone">
        <input type="file" accept=".csv,text/csv,.txt" onChange={pick} hidden />
        <Icon name="upload" /> {file ? <><b>{file.name}</b> · {file.rows.length} rows · choose another file</> : <><b>Choose a CSV file</b> exported from your CRM or spreadsheet</>}
      </label>

      {file && (
        <>
          <h4 className="sub-head">Columns</h4>
          <div className="map-grid">
            {CLIENT_FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}{f.key === 'name' && ' (required)'}</span>
                <select value={String(map[f.key] ?? -1)} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '-1' ? -1 : e.target.value })}>
                  <option value="-1">— Don’t import —</option>
                  {typeof map[f.key] === 'string' && map[f.key].includes('+') && <option value={map[f.key]}>First + last name</option>}
                  {options}
                </select>
              </label>
            ))}
          </div>
          <h4 className="sub-head">Preview</h4>
          <div className="table-wrap">
            <table className="data-table compact">
              <thead><tr>{CLIENT_FIELDS.map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {mapped.slice(0, 5).map((r, i) => <tr key={i} className={r.name ? '' : 'muted-row'}>{CLIENT_FIELDS.map((f) => <td key={f.key}>{r[f.key]}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {mapped.length - valid.length > 0 && <p className="muted small">{mapped.length - valid.length} rows have no name and will be skipped.</p>}
        </>
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}
