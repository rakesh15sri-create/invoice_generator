import Confirmation from './Confirmation.jsx';
import Classic from './Classic.jsx';
import Modern from './Modern.jsx';
import Minimal from './Minimal.jsx';
import Receipt from './Receipt.jsx';
import IndustryInvoice from './IndustryInvoice.jsx';
import { INDUSTRIES } from './industries.js';

// Picker groups. Basic templates have their own components; industry ones share IndustryInvoice.
export const TEMPLATE_GROUPS = [
  {
    name: 'Basic',
    items: [
      { id: 'confirm', name: 'Confirmation' },
      { id: 'classic', name: 'Classic' },
      { id: 'modern', name: 'Modern' },
      { id: 'minimal', name: 'Minimal' },
      { id: 'receipt', name: 'Receipt' },
    ],
  },
  { name: 'Tech Services', items: INDUSTRIES.map(({ id, name, accent }) => ({ id, name, accent })) },
];

// id → { name, group } for lists and the dashboard. Unknown ids (e.g. removed templates) fall back to the id.
const INFO = Object.fromEntries(TEMPLATE_GROUPS.flatMap((g) => g.items.map((t) => [t.id, { name: t.name, group: g.name }])));
export const templateName = (id) => INFO[id]?.name || id;

export const TEMPLATE_COMPONENTS = {
  confirm: Confirmation,
  classic: Classic,
  modern: Modern,
  minimal: Minimal,
  receipt: Receipt,
  ...Object.fromEntries(INDUSTRIES.map((i) => [i.id, IndustryInvoice])),
};
