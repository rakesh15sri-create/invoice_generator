// Minimal .xlsx reader: the first worksheet as rows of strings. An .xlsx file is a zip of XML
// files, unpacked here with the browser's built-in DecompressionStream, so no spreadsheet library
// is needed. Date cells come back as "YYYY-MM-DD", "HH:MM:SS" or "YYYY-MM-DD HH:MM:SS".
// Old binary .xls files aren't supported (save them as .xlsx or CSV).

async function openZip(file) {
  const buf = await file.arrayBuffer();
  const v = new DataView(buf);
  let end = -1; // "end of central directory" record, near the end of the file
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('This isn’t an .xlsx file. If it’s an old .xls file, open it in Excel and save it as .xlsx or CSV.');
  const entries = new Map();
  let p = v.getUint32(end + 16, true);
  for (let n = v.getUint16(end + 10, true); n > 0 && v.getUint32(p, true) === 0x02014b50; n--) {
    const nameLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nameLen));
    entries.set(name, { method: v.getUint16(p + 10, true), size: v.getUint32(p + 20, true), offset: v.getUint32(p + 42, true) });
    p += 46 + nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
  return async (name) => {
    const e = entries.get(name);
    if (!e) return null;
    const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
    const bytes = new Uint8Array(buf, start, e.size);
    if (e.method === 0) return new TextDecoder().decode(bytes);
    if (e.method !== 8) throw new Error('This spreadsheet uses a format that can’t be read. Save it as .xlsx or CSV and try again.');
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  };
}

const xml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const tags = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const textOf = (node) => tags(node, 't').map((t) => t.textContent).join('');

// Which cell styles are dates: built-in date formats, or custom formats with d/m/y/h codes.
function dateStyles(stylesXml) {
  if (!stylesXml) return [];
  const doc = xml(stylesXml);
  const custom = new Map(tags(doc, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') || '']));
  const isDate = (id) => (id >= 14 && id <= 22) || (id >= 45 && id <= 47)
    || /[dmyh]/i.test((custom.get(id) || '').replace(/"[^"]*"|\[[^\]]*\]/g, ''));
  const xfs = tags(doc, 'cellXfs')[0];
  return xfs ? tags(xfs, 'xf').map((xf) => isDate(Number(xf.getAttribute('numFmtId')))) : [];
}

const pad = (n) => String(n).padStart(2, '0');
function serialToText(serial) {
  const ms = Math.round((serial - 25569) * 86400000); // Excel day 25569 = 1970-01-01
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  if (serial < 1) return time;
  return Number.isInteger(serial) ? date : `${date} ${time}`;
}

const colIndex = (ref) => [...String(ref).replace(/\d+$/, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export async function readXlsx(file) {
  const read = await openZip(file);
  const workbook = await read('xl/workbook.xml');
  if (!workbook) throw new Error('This file has no worksheets. Save it from Excel as .xlsx or CSV and try again.');

  // First sheet → its file, via the workbook's relationships.
  let path = 'xl/worksheets/sheet1.xml';
  const first = tags(xml(workbook), 'sheet')[0];
  const rid = first?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rels = await read('xl/_rels/workbook.xml.rels');
  const target = rid && rels && tags(xml(rels), 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  if (target) path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;

  const [sheetXml, sharedXml, stylesXml] = await Promise.all([read(path), read('xl/sharedStrings.xml'), read('xl/styles.xml')]);
  if (!sheetXml) throw new Error('The first worksheet could not be found in this file.');
  const shared = sharedXml ? tags(xml(sharedXml), 'si').map(textOf) : [];
  const isDateStyle = dateStyles(stylesXml);

  const rows = [];
  for (const row of tags(xml(sheetXml), 'row')) {
    const out = [];
    tags(row, 'c').forEach((c, i) => {
      const ref = c.getAttribute('r');
      const col = ref ? colIndex(ref) : i;
      const type = c.getAttribute('t');
      const raw = tags(c, 'v')[0]?.textContent ?? '';
      let value;
      if (type === 's') value = shared[Number(raw)] ?? '';
      else if (type === 'inlineStr') value = textOf(c);
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
      else if (!type || type === 'n') value = raw !== '' && isDateStyle[Number(c.getAttribute('s') || 0)] ? serialToText(Number(raw)) : raw;
      else value = raw;
      while (out.length < col) out.push('');
      out[col] = value;
    });
    if (out.some((v) => String(v).trim() !== '')) rows.push(out);
  }
  return rows;
}
