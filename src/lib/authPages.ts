// Dashboard pages a role can be given, keyed by the page's view (?view=). Client-safe: no
// server imports, so the Admin Panel's role editor and the sidebar can use it too.

export const PAGES = [
  { key: 'overview', label: 'Portfolio Overview' },
  { key: 'client', label: 'Client View' },
  { key: 'funnel', label: 'Funnel Analytics' },
  { key: 'calls', label: 'CSR Dashboard' },
  { key: 'kpis', label: 'KPIs' },
  { key: 'clients', label: 'Clients' },
  { key: 'admin', label: 'Admin Panel' },
] as const;

export type PageKey = (typeof PAGES)[number]['key'];
export const PAGE_KEYS = PAGES.map(p => p.key) as PageKey[];
export const isPageKey = (v: string): v is PageKey => (PAGE_KEYS as string[]).includes(v);

// The admin role always keeps the Admin Panel, so nobody can lock everyone out of it.
export const ADMIN_ROLE = 'admin';
