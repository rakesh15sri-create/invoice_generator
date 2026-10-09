import { useState } from 'react';
import { api, fileSrc, openStoredFile, upload } from '../api.js';
import { FORM, getPath, money, num, totals } from '../data.js';
import { TEMPLATE_GROUPS } from '../templates/index.js';
import { INDUSTRY_BY_ID } from '../templates/industries.js';
import { useConfirm, useToast } from './ui.jsx';

const SECTION = Object.fromEntries(FORM.map((s) => [s.key, s]));
const selectAll = (e) => e.target.select(); // typing into "0" replaces it instead of making "05"

// Collapsible panel. `open` is only the initial state (frozen on mount so a panel never
// snaps shut while someone is typing in it); after that the user toggles it.
export function Section({ step, title, hint, open = true, children }) {
  const [initiallyOpen] = useState(open);
  return (
    <details className="panel section" open={initiallyOpen}>
      <summary>
        {step && <span className="step">{step}</span>}
        <span className="section-title">{title}</span>
      </summary>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </details>
  );
}

export function Field({ inv, onChange, def }) {
  const [path, label, type = 'text', span] = def;
  const value = getPath(inv, path) ?? '';
  const full = span === 'full' || type === 'textarea' || type === 'file';
  const set = (v) => onChange(path, v);
  let input;

  if (type === 'textarea') {
    input = <textarea value={value} onChange={(e) => set(e.target.value)} />;
  } else if (type.startsWith('select:')) {
    const opts = type.slice(7).split('|');
    if (value && !opts.includes(value)) opts.push(value);
    input = (
      <select value={value} onChange={(e) => set(e.target.value)}>
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    );
  } else if (type === 'file') {
    input = <LogoInput value={value} set={set} />;
  } else if (type === 'number') {
    input = <input type="number" step="any" inputMode="decimal" value={value} onFocus={selectAll} onChange={(e) => set(e.target.value === '' ? '' : parseFloat(e.target.value))} />;
  } else {
    input = <input type={type} value={value} onChange={(e) => set(e.target.value)} />;
  }

  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {input}
    </label>
  );
}

const readAsDataUrl = (f) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(f);
});

// Logo is stored in ImageKit ("ik:<path>"); without file storage set up it falls back to
// an inline data URL as before.
function LogoInput({ value, set }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const pick = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.type)) { toast('Please choose a PNG, JPG, GIF or WEBP image.', 'error'); return; }
    if (f.size > 1.5 * 1024 * 1024) { toast('That image is too large. Please choose one smaller than 1.5 MB.', 'error'); return; }
    setBusy(true);
    try {
      const { ref } = await upload('/files/logo', f);
      set(ref);
    } catch (err) {
      if (err.status === 503) set(await readAsDataUrl(f)); // storage not configured
      else toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row" style={{ margin: 0, alignItems: 'center' }}>
      {value && <img src={fileSrc(value)} alt="" style={{ height: 32, maxWidth: 90, objectFit: 'contain' }} />}
      <label className={`file-btn${busy ? ' is-busy' : ''}`}>
        {busy ? 'Uploading…' : value ? 'Change logo' : 'Upload logo'}
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden disabled={busy} onChange={pick} />
      </label>
      {value && !busy && <button type="button" className="ghost danger" onClick={() => set('')}>Remove</button>}
    </div>
  );
}

function FormFields({ section, inv, onField }) {
  return (
    <div className="grid2">
      {section.fields.map((def) => <Field key={def[0]} inv={inv} def={def} onChange={onField} />)}
    </div>
  );
}

function ExtrasEditor({ extras, setExtras, template, onLoadSample }) {
  const cfg = INDUSTRY_BY_ID[template];
  const update = (i, key, v) => setExtras(extras.map((e, j) => (j === i ? { ...e, [key]: v } : e)));

  return (
    <>
      {extras.length === 0 && <div className="empty">Nothing here yet. Add details like Project name, Plan or Ticket No.</div>}
      {extras.map((e, i) => (
        <div className="extra-row" key={i}>
          <input placeholder="Label (e.g. Project)" value={e.label} onChange={(ev) => update(i, 'label', ev.target.value)} />
          <input placeholder="Value" value={e.value} onChange={(ev) => update(i, 'value', ev.target.value)} />
          <button title="Remove this detail" className="ghost danger" onClick={() => setExtras(extras.filter((_, j) => j !== i))}>&times;</button>
        </div>
      ))}
      <div className="row">
        <button className="ghost" onClick={() => setExtras([...extras, { label: '', value: '' }])}>+ Add detail</button>
        {cfg && <button className="ghost" onClick={onLoadSample}>Fill in example {cfg.name.toLowerCase()} details</button>}
      </div>
    </>
  );
}

function ItemsEditor({ inv, setItems }) {
  const { items, template, currency } = inv;
  const [c1, c2, c3] = INDUSTRY_BY_ID[template]?.cols || ['Description', 'Qty', 'Price'];
  const update = (i, key, v) => setItems(items.map((it, j) => (j === i ? { ...it, [key]: v } : it)));
  const remove = (i) => {
    const next = items.filter((_, j) => j !== i);
    setItems(next.length ? next : [{ desc: '', qty: 1, price: 0 }]);
  };
  const t = totals(inv);

  return (
    <>
      <div className="item-row head"><span>{c1}</span><span>{c2}</span><span>{c3}</span><span /></div>
      {items.map((it, i) => (
        <div className="item-row" key={i}>
          <input placeholder="What did you provide?" aria-label={c1} value={it.desc} onChange={(e) => update(i, 'desc', e.target.value)} />
          <input type="number" step="any" min="0" inputMode="decimal" aria-label={c2} value={it.qty} onFocus={selectAll} onChange={(e) => update(i, 'qty', e.target.value)} />
          <input type="number" step="any" min="0" inputMode="decimal" aria-label={c3} value={it.price} onFocus={selectAll} onChange={(e) => update(i, 'price', e.target.value)} />
          <button title="Remove this line" className="ghost danger" onClick={() => remove(i)}>&times;</button>
        </div>
      ))}
      <div className="items-foot">
        <button className="ghost" onClick={() => setItems([...items, { desc: '', qty: 1, price: 0 }])}>+ Add line</button>
        <div className="items-total">
          {num(inv.taxRate) > 0 || num(inv.discount) > 0
            ? <>Subtotal {money(t.subtotal, currency)} · <b>Total {money(t.total, currency)}</b></>
            : <b>Total {money(t.total, currency)}</b>}
        </div>
      </div>
    </>
  );
}

const ATTACH_MAX_MB = 20;
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtWhen = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Stored PDF + attachments of a saved invoice (kept privately in ImageKit).
function Attachments({ invoiceId, files, setFiles }) {
  const [uploading, setUploading] = useState('');
  const [over, setOver] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();
  const { pdf, attachments = [] } = files || {};

  const open = (f) => openStoredFile(invoiceId, f.id).catch((e) => toast(e.message, 'error'));

  const add = async (list) => {
    const picked = [...list];
    const tooBig = picked.filter((f) => f.size > ATTACH_MAX_MB * 1048576);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')}: larger than ${ATTACH_MAX_MB} MB, not added.`, 'error');
    let added = 0;
    for (const f of picked.filter((x) => !tooBig.includes(x))) {
      setUploading(`Uploading ${f.name}…`);
      try {
        const att = await upload(`/invoices/${invoiceId}/attachments`, f);
        setFiles((cur) => ({ ...cur, attachments: [...(cur?.attachments || []), att] }));
        added += 1;
      } catch (e) {
        toast(`${f.name}: ${e.message}`, 'error');
        if (e.status === 503) break; // storage not set up — no point trying the rest
      }
    }
    setUploading('');
    if (added) toast(added === 1 ? 'File attached.' : `${added} files attached.`);
  };

  const remove = async (f) => {
    if (!(await confirm({ title: `Remove ${f.name}?`, message: 'The file will be deleted from storage.', confirmLabel: 'Remove file', danger: true }))) return;
    try {
      await api(`/invoices/${invoiceId}/attachments/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
      setFiles((cur) => ({ ...cur, attachments: (cur?.attachments || []).filter((a) => a.id !== f.id) }));
      toast(`${f.name} removed.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (!invoiceId) return <div className="empty">Save the invoice first, then you can attach files here.</div>;

  return (
    <>
      {pdf && (
        <div className="file-row">
          <span className="file-icon pdf" aria-hidden="true">PDF</span>
          <div className="file-main"><b>{pdf.name}</b><small>Stored copy · {fmtWhen(pdf.uploadedAt)} · {fmtSize(pdf.size)}</small></div>
          <button className="link" onClick={() => open(pdf)}>Open</button>
        </div>
      )}
      {attachments.map((f) => (
        <div className="file-row" key={f.id}>
          <span className="file-icon" aria-hidden="true">{(f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase()}</span>
          <div className="file-main"><b title={f.name}>{f.name}</b><small>{fmtSize(f.size)} · {fmtWhen(f.uploadedAt)}</small></div>
          <button className="link" onClick={() => open(f)}>Open</button>
          <button className="link danger" onClick={() => remove(f)} aria-label={`Remove ${f.name}`}>Remove</button>
        </div>
      ))}
      <label
        className={`drop-zone${over ? ' over' : ''}${uploading ? ' is-busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!uploading) add(e.dataTransfer.files); }}
      >
        {uploading || <><b>+ Attach files</b> <span>or drop them here · up to {ATTACH_MAX_MB} MB each</span></>}
        <input type="file" multiple hidden disabled={!!uploading} onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      </label>
    </>
  );
}

function FileTools({ onExport, onImport, onReset, onSaveCompanyDefault }) {
  return (
    <>
      {onSaveCompanyDefault && (
        <button className="ghost" onClick={onSaveCompanyDefault} title="New invoices created by anyone on the team will start with these company details">
          Use these company details for all new invoices
        </button>
      )}
      <div className="row">
        <button className="ghost" onClick={onExport} title="Download this invoice as a backup file">Download backup (.json)</button>
        <label className="file-btn" title="Load an invoice from a backup file">Load backup
          <input type="file" accept="application/json" hidden onChange={(e) => { onImport(e.target.files[0]); e.target.value = ''; }} />
        </label>
        <button className="ghost danger" onClick={onReset}>Clear form</button>
      </div>
    </>
  );
}

export default function Editor({ inv, onField, onTemplate, setItems, setExtras, onLoadSample, fileProps, storedFiles }) {
  const cfg = INDUSTRY_BY_ID[inv.template];
  const companyFilled = inv.company.name && inv.company.name !== 'YOUR COMPANY';

  return (
    <aside className="editor">
      <Section step="1" title="Choose a design" hint="Pick the type of service you are billing for. You can switch any time — your details stay.">
        <div className="template-scroll">
          {TEMPLATE_GROUPS.map((g) => (
            <div key={g.name}>
              <div className="tpl-group">{g.name}</div>
              <div className="template-picker">
                {g.items.map((t) => (
                  <button key={t.id} className={t.id === inv.template ? 'active' : ''} onClick={() => onTemplate(t.id)}>
                    {t.accent && <i className="dot" style={{ background: t.accent }} />}
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <label className="field inline">
          <span>Colour</span>
          <input type="color" value={inv.accent} onChange={(e) => onField('accent', e.target.value)} />
        </label>
      </Section>

      <Section step="2" title="Customer" hint="Who are you billing?">
        <FormFields section={SECTION.customer} inv={inv} onField={onField} />
      </Section>

      <Section step="3" title="What you're billing for" hint="Add one line per service or product. Amounts are calculated for you.">
        <ItemsEditor inv={inv} setItems={setItems} />
      </Section>

      <Section step="4" title={cfg ? cfg.extrasTitle : 'Extra details'} hint="Optional. Shown on the invoice as a details box." open={!!inv.extras?.length}>
        <ExtrasEditor extras={inv.extras || []} setExtras={setExtras} template={inv.template} onLoadSample={onLoadSample} />
      </Section>

      <Section step="5" title="Invoice details" hint="Number, dates and payment status.">
        <FormFields section={SECTION.document} inv={inv} onField={onField} />
      </Section>

      <Section step="6" title={SECTION.amounts.title} hint="Leave “Amount paid” empty if the invoice is paid in full." open={false}>
        <FormFields section={SECTION.amounts} inv={inv} onField={onField} />
      </Section>

      <Section step="7" title="Payment method" open={false}>
        <FormFields section={SECTION.payment} inv={inv} onField={onField} />
      </Section>

      <Section step="8" title="Your company" hint={companyFilled ? 'Already filled in. Change only if needed.' : 'Your business name, address and logo.'} open={!companyFilled}>
        <FormFields section={SECTION.company} inv={inv} onField={onField} />
      </Section>

      <Section step="9" title={SECTION.footer.title} open={false}>
        <FormFields section={SECTION.footer} inv={inv} onField={onField} />
      </Section>

      <Section
        step="10"
        title="Attachments & PDF"
        hint="Receipts, contracts or scans for this invoice. A copy of the PDF is kept here each time you download it."
        open={!!(storedFiles.files?.attachments?.length || storedFiles.files?.pdf)}
      >
        <Attachments {...storedFiles} />
      </Section>

      <Section title="More options" open={false}>
        <FileTools {...fileProps} />
      </Section>
    </aside>
  );
}
