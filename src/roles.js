export const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };

export const ROLE_HELP = {
  admin: 'Everything: dashboard, all invoices, team access, company defaults, and deleting CRM records.',
  manager: 'Dashboard and all invoices (create, edit, delete). Cannot manage the team.',
  staff: 'Create invoices and see or edit only their own. Works on the withdrawal CRM like everyone else.',
};

export const canSeeAll = (user) => user.role === 'admin' || user.role === 'manager';
