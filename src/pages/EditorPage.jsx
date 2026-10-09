import { useEffect, useRef, useState } from 'react';
import { api, upload } from '../api.js';
import Editor from '../components/Editor.jsx';
import Preview from '../components/Preview.jsx';
import { useConfirm, useToast } from '../components/ui.jsx';
import { addDays, deepMerge, defaults, nowTime, randomTxn, setPath, storage, todayISO } from '../data.js';
import { navigate, replaceRoute } from '../route.js';
import { INDUSTRY_BY_ID, presetExtras } from '../templates/industries.js';
import { TEMPLATE_COMPONENTS } from '../templates/index.js';

// The open invoice is kept as a local draft so a refresh never loses work.
// id = server id once saved; dirty = has changes not yet saved to the server;
// files = { pdf, attachments } stored in ImageKit for the saved invoice (managed by their own API calls).
// Drafts are per user (and cleared on sign-out) so a shared computer never shows
// one person's invoice to the next.
export const DRAFT_PREFIX = 'invgen.draft.';
const DEFAULT_TITLE = defaults().doc.title;

const load = (data) => deepMerge(defaults(), structuredClone(data || {}));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function initialDraft(key) {
  const d = storage.get(key, null);
  if (d?.inv) return { inv: load(d.inv), id: d.id ?? null, dirty: !!d.dirty, files: d.files ?? null };
  return { inv: load({}), id: null, dirty: false, fresh: true }; // fresh → fetch number & company defaults
}

export function clearDrafts() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(DRAFT_PREFIX) || k === 'invgen.current').forEach((k) => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}

export default function EditorPage({ user, invoiceId, query }) {
  const draftKey = DRAFT_PREFIX + user.id;
  const [draft, setDraft] = useState(() => initialDraft(draftKey));
  const [busy, setBusy] = useState('');
  const [view, setView] = useState('edit'); // small screens show the form or the preview
  const toast = useToast();
  const confirm = useConfirm();
  const paperRef = useRef(null);
  const { inv, id, dirty } = draft;

  // A fresh placeholder isn't persisted, so a reload before setup finishes still starts properly.
  useEffect(() => { if (!draft.fresh) storage.set(draftKey, draft); }, [draft, draftKey]);

  const confirmDiscard = async () => !dirty || confirm({
    title: 'Discard unsaved changes?',
    message: `Your latest changes to ${inv.doc.number || 'this invoice'} haven’t been saved yet.`,
    confirmLabel: 'Discard changes',
    cancelLabel: 'Keep editing',
    danger: true,
  });

  // ---- open an invoice from the URL (#/editor/:id) ----
  // Re-opening the invoice already in the draft refreshes it from the server (unless it has
  // unsaved edits), so changes made elsewhere — e.g. "Mark paid" in the list — show up.
  useEffect(() => {
    if (!invoiceId) {
      if (id) replaceRoute(`#/editor/${id}`);
      return;
    }
    const same = Number(invoiceId) === id;
    if (same && dirty) return;
    (async () => {
      if (!same) {
        if (!(await confirmDiscard())) { replaceRoute(id ? `#/editor/${id}` : '#/editor'); return; }
        setBusy('Opening…');
      }
      try {
        const r = await api(`/invoices/${invoiceId}`);
        const fetched = { inv: load(r.data), id: r.id, dirty: false, files: r.files };
        // Never overwrite typing that started meanwhile (but do pick up the latest files).
        setDraft((d) => (same && d.dirty ? { ...d, files: r.files } : fetched));
      } catch (e) {
        if (same) return; // keep the local copy
        navigate('#/editor');
        if (draft.fresh) await newInvoice();
        toast(e.message, 'error');
      } finally {
        setBusy('');
      }
    })();
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- editing ----
  const edit = (fn) => setDraft((d) => ({ ...d, inv: fn(d.inv), dirty: true, fresh: false }));
  const onField = (path, value) => edit((cur) => setPath(cur, path, value));
  const setItems = (items) => edit((cur) => ({ ...cur, items }));
  const setExtras = (extras) => edit((cur) => ({ ...cur, extras }));
  const loadSampleExtras = () => edit((cur) => ({ ...cur, extras: presetExtras(cur.template) }));
  // Stored files change on the server immediately, so they never make the invoice "unsaved".
  const setFiles = (fn) => setDraft((d) => ({ ...d, files: typeof fn === 'function' ? fn(d.files) : fn }));

  // Switching template applies its colour. Extra details and title are swapped only if the
  // user hasn't edited them (still the previous template's samples).
  const selectTemplate = (tid) => edit((cur) => {
    const cfg = INDUSTRY_BY_ID[tid];
    const titleFor = (t) => INDUSTRY_BY_ID[t]?.title ?? DEFAULT_TITLE;
    const extrasUntouched = !cur.extras?.length || JSON.stringify(cur.extras) === JSON.stringify(presetExtras(cur.template));
    const titleUntouched = cur.doc.title === titleFor(cur.template);
    return {
      ...cur,
      template: tid,
      accent: cfg ? cfg.accent : cur.accent,
      extras: extrasUntouched ? presetExtras(tid) : cur.extras,
      doc: titleUntouched ? { ...cur.doc, title: titleFor(tid) } : cur.doc,
    };
  });

  // First visit (no draft yet): start a proper new invoice.
  // Deep links: #/editor?template=webdev  ·  #/editor?copyOf=12 (duplicate invoice 12)
  useEffect(() => {
    const t = query.get('template');
    const copyOf = query.get('copyOf');
    (async () => {
      if (copyOf && await duplicate(async () => (await api(`/invoices/${copyOf}`)).data)) return;
      if (draft.fresh && !invoiceId) await newInvoice();
      if (t && TEMPLATE_COMPONENTS[t]) selectTemplate(t);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- server actions ----
  // Returns the invoice id, or null if saving failed.
  const save = async ({ quiet = false } = {}) => {
    setBusy('Saving…');
    try {
      let savedId = id;
      if (id) {
        await api(`/invoices/${id}`, { method: 'PUT', body: { data: inv } });
        setDraft((d) => ({ ...d, dirty: false }));
      } else {
        const r = await api('/invoices', { method: 'POST', body: { data: inv } });
        savedId = r.id;
        setDraft((d) => ({ ...d, id: r.id, dirty: false, files: null }));
        replaceRoute(`#/editor/${r.id}`);
      }
      if (!quiet) toast(`Invoice ${inv.doc.number} saved.`);
      return savedId;
    } catch (e) {
      toast(e.message, 'error');
      return null;
    } finally {
      setBusy('');
    }
  };

  // New invoice: team company defaults + next shared number; keeps template & tax setup.
  const newInvoice = async () => {
    if (!(await confirmDiscard())) return;
    setBusy('Preparing…');
    try {
      const [{ number }, { company }] = await Promise.all([
        api('/invoices/next-number', { method: 'POST' }),
        api('/settings/company'),
      ]);
      const next = load({
        template: inv.template, accent: inv.accent, currency: inv.currency, taxRate: inv.taxRate,
        footer: inv.footer, confirmText: inv.confirmText, company: company || inv.company,
      });
      next.doc.number = number;
      next.doc.title = inv.doc.title;
      next.extras = presetExtras(inv.template);
      setDraft({ inv: next, id: null, dirty: false, files: null });
      replaceRoute('#/editor');
      setView('edit');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  // Duplicate: same customer, items and design under a new number, dated today. Not saved until Save.
  const duplicate = async (getSource) => {
    if (!(await confirmDiscard())) { replaceRoute(id ? `#/editor/${id}` : '#/editor'); return false; }
    setBusy('Copying…');
    try {
      const [source, { number }] = await Promise.all([getSource(), api('/invoices/next-number', { method: 'POST' })]);
      const next = load(source);
      const date = todayISO();
      next.doc = { ...next.doc, number, date, time: nowTime(), dueDate: addDays(date, 14) };
      next.payment = { ...next.payment, txnId: randomTxn() };
      setDraft({ inv: next, id: null, dirty: true, files: null }); // attachments stay with the original
      replaceRoute('#/editor');
      setView('edit');
      toast(`Copied into new invoice ${number}. Check the details, then click Save.`);
      return true;
    } catch (e) {
      replaceRoute(id ? `#/editor/${id}` : '#/editor');
      toast(e.message, 'error');
      return false;
    } finally {
      setBusy('');
    }
  };

  // Ctrl+S / Cmd+S saves; warn before closing the tab with unsaved work.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const [showTip, setShowTip] = useState(() => !storage.get('invgen.hideEditorTip', false));
  const hideTip = () => { setShowTip(false); storage.set('invgen.hideEditorTip', true); };

  const saveCompanyDefault = async () => {
    try {
      await api('/settings/company', { method: 'PUT', body: { company: inv.company } });
      toast('Company details saved as the team default for new invoices.');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  // ---- local file tools ----
  const reset = async () => {
    if (await confirm({
      title: 'Clear the whole form?',
      message: 'Every field on this invoice will be emptied back to the defaults. The invoice number is kept.',
      confirmLabel: 'Clear form',
      danger: true,
    })) {
      edit(() => ({ ...defaults(), doc: { ...defaults().doc, number: inv.doc.number } }));
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(inv, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${inv.doc.number || 'invoice'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file) => {
    if (!file) return;
    let data;
    try {
      data = load(JSON.parse(await file.text()));
    } catch {
      toast('That file isn’t an invoice backup. Choose a .json file made with “Download backup”.', 'error');
      return;
    }
    if (!(await confirm({
      title: 'Load this backup?',
      message: `The details on this screen will be replaced with the ones from “${file.name}”.`,
      confirmLabel: 'Load backup',
    }))) return;
    edit(() => data);
    toast('Backup loaded. Click Save to keep it.');
  };

  const showPreview = async () => {
    if (view === 'preview') return;
    setView('preview');
    await nextFrame();
  };

  const print = async () => {
    await showPreview();
    window.print();
  };

  // Downloads the PDF and keeps a copy with the invoice in file storage. Unsaved changes are
  // saved first so the stored copy always matches the saved invoice.
  const downloadPdf = async () => {
    const savedId = dirty || !id ? await save({ quiet: true }) : id;
    const name = `${inv.doc.number || 'invoice'}.pdf`;
    setBusy('Creating PDF…');
    await showPreview();
    const paper = paperRef.current;
    const scaler = paper.parentElement;
    const prev = scaler.style.transform;
    let blob;
    try {
      const { default: html2pdf } = await import('html2pdf.js');
      scaler.style.transform = 'none';
      paper.style.boxShadow = 'none';
      blob = await html2pdf().set({
        margin: 0,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'px', format: [794, 1123], orientation: 'portrait', hotfixes: ['px_scaling'] },
      }).from(paper).outputPdf('blob');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch {
      toast('The PDF couldn’t be created. Try “Print” and choose “Save as PDF” instead.', 'error');
      return;
    } finally {
      scaler.style.transform = prev;
      paper.style.boxShadow = '';
      setBusy('');
    }

    if (!savedId) { toast(`${name} downloaded. It wasn’t stored online because the invoice couldn’t be saved.`, 'error'); return; }
    setBusy('Storing PDF…');
    try {
      const pdf = await upload(`/invoices/${savedId}/pdf`, new Blob([blob], { type: 'application/pdf' }), name);
      setFiles((cur) => ({ ...cur, pdf }));
      toast(`${name} downloaded. A copy is stored with the invoice.`);
    } catch (e) {
      if (e.status === 503) toast(`${name} downloaded.`); // file storage not set up
      else toast(`${name} downloaded, but the online copy couldn’t be stored: ${e.message}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const state = busy || (id ? (dirty ? 'Unsaved changes' : 'All changes saved') : 'Not saved yet');

  return (
    <div className="editor-page">
      <div className="toolbar">
        <div className="doc-state">
          <b>{inv.doc.number || 'Untitled'}</b>
          <span className={`chip ${busy ? '' : dirty || !id ? 'warn' : 'ok'}`} aria-live="polite">{state}</span>
        </div>
        <div className="actions">
          <button onClick={newInvoice} disabled={!!busy} title="Start a new, empty invoice with the next number">+ New</button>
          {id && (
            <button onClick={() => duplicate(async () => inv)} disabled={!!busy} title="Start a new invoice with the same customer and items">
              Duplicate
            </button>
          )}
          <button onClick={print} disabled={!!busy} title="Print, or choose “Save as PDF” in the print window">Print</button>
          <button onClick={downloadPdf} disabled={!!busy}>Download PDF</button>
          <button className="primary" onClick={save} disabled={!!busy} title="Save (Ctrl+S)">
            {dirty || !id ? 'Save' : 'Saved ✓'}
          </button>
        </div>
      </div>
      {showTip && (
        <div className="tip-bar">
          <span>👋 Fill in the steps on the left — the invoice on the right updates as you type. Click <b>Save</b> (or press Ctrl+S) so your team can see it, then <b>Download PDF</b> to send it.</span>
          <button className="link" onClick={hideTip}>Got it</button>
        </div>
      )}
      <div className="view-tabs" role="tablist" aria-label="Show">
        <button role="tab" aria-selected={view === 'edit'} className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}>Edit details</button>
        <button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')}>Preview invoice</button>
      </div>

      <main className={`layout v-${view}`}>
        <Editor
          inv={inv}
          onField={onField}
          onTemplate={selectTemplate}
          setItems={setItems}
          setExtras={setExtras}
          onLoadSample={loadSampleExtras}
          fileProps={{
            onExport: exportJson,
            onImport: importJson,
            onReset: reset,
            onSaveCompanyDefault: user.role === 'admin' ? saveCompanyDefault : null,
          }}
          storedFiles={{ invoiceId: id, files: draft.files, setFiles }}
        />
        <Preview inv={inv} ref={paperRef} />
      </main>
    </div>
  );
}
