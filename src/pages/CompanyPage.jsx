import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field } from '../components/Editor.jsx';
import { Loading, useToast } from '../components/ui.jsx';
import { FORM, defaults, setPath } from '../data.js';

const COMPANY_FIELDS = FORM.find((s) => s.key === 'company').fields;

// Admin: the business details every new invoice starts with.
export default function CompanyPage() {
  const [data, setData] = useState(null); // { company }
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const toast = useToast();

  useEffect(() => {
    api('/settings/company')
      .then(({ company }) => setData({ company: { ...defaults().company, ...(company || {}) } }))
      .catch((e) => setError(e.message));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/settings/company', { method: 'PUT', body: { company: data.company } });
      setDirty(false);
      setError('');
      toast('Saved. Every new invoice will now start with these details.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <div className="page narrow">{error ? <div className="form-error">{error}</div> : <Loading />}</div>;

  return (
    <div className="page narrow">
      <div className="page-head"><h2>Company details</h2></div>
      <p className="muted">
        Enter your business details once. Every new invoice — created by you or your team — will start with them.
        Invoices that already exist are not changed.
      </p>
      <form className="panel" onSubmit={save}>
        <div className="grid2">
          {COMPANY_FIELDS.map((def) => (
            <Field key={def[0]} inv={data} def={def} onChange={(path, v) => { setData((d) => setPath(d, path, v)); setDirty(true); setError(''); }} />
          ))}
        </div>
        {error && <div className="form-error">{error}</div>}
        <div className="row">
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save company details'}</button>
          {dirty && <span className="chip warn self-center">Unsaved changes</span>}
        </div>
      </form>
    </div>
  );
}
