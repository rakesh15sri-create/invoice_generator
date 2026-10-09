export const ROLE_LABEL = { admin: 'Admin', manager: 'Manager', staff: 'Staff' };

export const ROLE_HELP = {
  admin: 'Everything: dashboard, all invoices, team access and company defaults.',
  manager: 'Dashboard and all invoices (create, edit, delete). Cannot manage the team.',
  staff: 'Create invoices and see or edit only their own.',
};

export const canSeeAll = (user) => user.role === 'admin' || user.role === 'manager';
