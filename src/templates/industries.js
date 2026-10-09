// Tech-service invoice presets. All are rendered by IndustryInvoice.jsx; they differ in layout,
// colour, title, item column names and the sample "extra details" fields they suggest.
//
// layout: band | corner | split | ticket | outline
// cols:   item-table headers for [description, quantity, unit price]
// extras: [label, sample value] pairs loaded into the editable Extra details list

export const INDUSTRIES = [
  {
    id: 'webdev', name: 'Web Development', layout: 'band', accent: '#2563eb', title: 'Web Development Invoice',
    cols: ['Deliverable / Milestone', 'Qty', 'Rate'], extrasTitle: 'Project Details',
    extras: [['Project', 'Corporate Website'], ['Website URL', 'www.example.com'], ['Tech Stack', 'React, Node.js'], ['Milestone', 'Phase 2 – Development'], ['Project Manager', 'PM Name']],
  },
  {
    id: 'appdev', name: 'Mobile App', layout: 'corner', accent: '#6366f1', title: 'App Development Invoice',
    cols: ['Feature / Sprint', 'Qty', 'Rate'], extrasTitle: 'App Details',
    extras: [['App Name', 'Customer App'], ['Platforms', 'iOS & Android'], ['Version', 'v1.2.0'], ['Sprint', 'Sprint 6'], ['Store Release', '20 Oct 2026']],
  },
  {
    id: 'software', name: 'Custom Software', layout: 'split', accent: '#1e293b', title: 'Software Development Invoice',
    cols: ['Module / Service', 'Qty', 'Rate'], extrasTitle: 'Project Details',
    extras: [['Project', 'ERP Implementation'], ['Module', 'Inventory & Billing'], ['Contract Type', 'Fixed price'], ['Phase', 'UAT'], ['Repository', 'git.example.com/erp']],
  },
  {
    id: 'hourly', name: 'Hourly / Timesheet', layout: 'band', accent: '#0d9488', title: 'Timesheet Invoice',
    cols: ['Task / Date', 'Hours', 'Hourly Rate'], extrasTitle: 'Billing Period',
    extras: [['Period', '1 Sep – 30 Sep 2026'], ['Consultant', 'Developer Name'], ['Role', 'Senior Developer'], ['Total Hours', '120'], ['Approved By', 'Client PM']],
  },
  {
    id: 'retainer', name: 'Monthly Retainer', layout: 'corner', accent: '#0f766e', title: 'Retainer Invoice',
    cols: ['Service', 'Qty', 'Rate'], extrasTitle: 'Retainer Details',
    extras: [['Retainer Period', 'October 2026'], ['Included Hours', '40'], ['Hours Used', '36'], ['Rollover Hours', '4'], ['Account Manager', 'Manager Name']],
  },
  {
    id: 'milestone', name: 'Project Milestone', layout: 'outline', accent: '#b45309', title: 'Milestone Invoice',
    cols: ['Milestone', 'Qty', 'Amount Due'], extrasTitle: 'Contract Summary',
    extras: [['Project', 'Project Name'], ['Milestone', '2 of 4 – Beta delivery'], ['Completion', '50%'], ['Contract Value', 'AED 36,000.00'], ['Paid to Date', 'AED 9,000.00']],
  },
  {
    id: 'saas', name: 'SaaS Subscription', layout: 'corner', accent: '#4f46e5', title: 'Subscription Invoice',
    cols: ['Plan / Add-on', 'Seats', 'Price / Seat'], extrasTitle: 'Subscription Details',
    extras: [['Account ID', 'ACC-30915'], ['Plan', 'Business'], ['Users / Seats', '25'], ['Billing Cycle', 'Monthly'], ['Next Renewal', '08 Nov 2026']],
  },
  {
    id: 'hosting', name: 'Domain & Hosting', layout: 'split', accent: '#059669', title: 'Hosting Invoice',
    cols: ['Service', 'Period', 'Price'], extrasTitle: 'Service Details',
    extras: [['Domain', 'example.com'], ['Hosting Plan', 'Business Pro'], ['Server', 'EU-West-2'], ['Billing Cycle', 'Yearly'], ['Renewal Date', '10 Oct 2027']],
  },
  {
    id: 'cloud', name: 'Cloud Services', layout: 'band', accent: '#ea580c', title: 'Cloud Services Invoice',
    cols: ['Resource', 'Usage', 'Unit Price'], extrasTitle: 'Usage Details',
    extras: [['Cloud Account', '1234-5678-9012'], ['Provider', 'AWS / Azure / GCP'], ['Region', 'me-central-1'], ['Billing Period', 'September 2026'], ['Managed By', 'Cloud Team']],
  },
  {
    id: 'amc', name: 'IT Support (AMC)', layout: 'outline', accent: '#0369a1', title: 'IT Support Invoice',
    cols: ['Service', 'Qty', 'Rate'], extrasTitle: 'Support Contract',
    extras: [['Contract No.', 'AMC-2026-014'], ['Coverage', '01 Oct 2026 – 30 Sep 2027'], ['SLA', '4-hour response'], ['Devices Covered', '45 PCs, 3 servers'], ['Support Hours', 'Sun–Thu, 9am–6pm']],
  },
  {
    id: 'support', name: 'Support Ticket / Repair', layout: 'ticket', accent: '#7c3aed', title: 'Service Ticket Invoice',
    cols: ['Labour / Part', 'Qty', 'Rate'], extrasTitle: 'Ticket Details',
    extras: [['Ticket No.', 'TCK-88412'], ['Device', 'Dell Latitude 7440'], ['Serial No.', 'SN-4FD92K'], ['Issue', 'Motherboard replacement'], ['Technician', 'Tech Name'], ['Resolved On', '07 Oct 2026']],
  },
  {
    id: 'network', name: 'Network & Hardware', layout: 'outline', accent: '#0891b2', title: 'Installation Invoice',
    cols: ['Equipment / Work', 'Qty', 'Unit Price'], extrasTitle: 'Installation Details',
    extras: [['Site Address', 'Office 1204, Tower A'], ['Installation Date', '05 Oct 2026'], ['Engineer', 'Engineer Name'], ['Scope', 'LAN cabling, Wi-Fi, firewall'], ['Warranty', '1 year']],
  },
  {
    id: 'license', name: 'Software License', layout: 'band', accent: '#16a34a', title: 'License Invoice',
    cols: ['Product / License', 'Qty', 'Unit Price'], extrasTitle: 'License Details',
    extras: [['Order No.', 'ORD-55219'], ['License Type', 'Annual subscription'], ['Users', '10'], ['Valid From', '08 Oct 2026'], ['Valid Until', '07 Oct 2027']],
  },
  {
    id: 'security', name: 'Cybersecurity', layout: 'split', accent: '#dc2626', title: 'Security Services Invoice',
    cols: ['Service', 'Qty', 'Rate'], extrasTitle: 'Engagement Details',
    extras: [['Engagement', 'Penetration Test'], ['Scope', 'Web app + 2 APIs'], ['Testing Window', '28 Sep – 03 Oct 2026'], ['Report Delivered', '06 Oct 2026'], ['Lead Tester', 'Tester Name']],
  },
  {
    id: 'design', name: 'UI / UX Design', layout: 'corner', accent: '#db2777', title: 'Design Invoice',
    cols: ['Design Deliverable', 'Qty', 'Rate'], extrasTitle: 'Design Details',
    extras: [['Project', 'Mobile App Redesign'], ['Screens', '32'], ['Revisions', '2 rounds'], ['Tool', 'Figma'], ['Handoff Date', '15 Oct 2026']],
  },
  {
    id: 'marketing', name: 'Digital Marketing / SEO', layout: 'band', accent: '#9333ea', title: 'Digital Marketing Invoice',
    cols: ['Service', 'Qty', 'Rate'], extrasTitle: 'Campaign Details',
    extras: [['Campaign', 'Q4 Lead Generation'], ['Channels', 'Google Ads, Meta, SEO'], ['Period', 'October 2026'], ['Ad Spend', 'AED 5,000.00'], ['Report', 'Monthly performance report']],
  },
  {
    id: 'consulting', name: 'IT Consulting', layout: 'outline', accent: '#334155', title: 'Consulting Invoice',
    cols: ['Consulting Service', 'Hours', 'Rate'], extrasTitle: 'Engagement Details',
    extras: [['Engagement', 'Digital Transformation'], ['Consultant', 'Consultant Name'], ['Scope', 'Assessment & roadmap'], ['Duration', '4 weeks']],
  },
  {
    id: 'quotation', name: 'Quotation / Estimate', layout: 'split', accent: '#475569', title: 'Quotation',
    cols: ['Service', 'Qty', 'Rate'], extrasTitle: 'Quotation Details',
    extras: [['Valid Until', '07 Nov 2026'], ['Prepared By', 'Sales Name'], ['Delivery Timeline', '6–8 weeks'], ['Payment Terms', '50% advance, 50% on delivery']],
  },
];

export const INDUSTRY_BY_ID = Object.fromEntries(INDUSTRIES.map((i) => [i.id, i]));

export const presetExtras = (id) =>
  (INDUSTRY_BY_ID[id]?.extras || []).map(([label, value]) => ({ label, value }));
