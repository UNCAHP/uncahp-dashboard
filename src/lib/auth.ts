import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from './supabase';
import { createAuthClient } from './supabaseAuth';
import { PAGE_KEYS, ADMIN_ROLE, type PageKey } from './authPages';

// ─── Who is signed in, and what they may open ────────────────────────────────
// The data access layer for auth (per the Next.js auth guide): every page render and every
// server action asks here. The proxy only does an optimistic cookie check; this is the
// check that counts. A user needs an active profile (user_profiles) whose role (roles)
// lists the page.

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  roleLabel: string;
  pages: PageKey[];
  csrKey: string | null;     // the setter this user is, for CSRs
  isAdmin: boolean;
};

export type AuthState =
  | { status: 'signed-out' }
  | { status: 'no-access'; email: string; reason: 'no-profile' | 'inactive' }
  | { status: 'ok'; user: CurrentUser };

// Memoised per request: a page and its server actions read the session once.
export const getAuthState = cache(async (): Promise<AuthState> => {
  const auth = await createAuthClient();
  // getUser() asks Supabase to verify the token, rather than trusting the cookie as-is.
  const { data } = await auth.auth.getUser();
  const u = data.user;
  if (!u) return { status: 'signed-out' };

  const { data: p } = await supabaseAdmin
    .from('user_profiles')
    .select('email, name, role_key, csr_key, active, roles(label, pages)')
    .eq('user_id', u.id)
    .maybeSingle();
  const email = u.email ?? '';
  if (!p) return { status: 'no-access', email, reason: 'no-profile' };
  if (!p.active) return { status: 'no-access', email, reason: 'inactive' };

  const role = (Array.isArray(p.roles) ? p.roles[0] : p.roles) as { label: string; pages: string[] } | null;
  const pages = (role?.pages ?? []).filter((k): k is PageKey => (PAGE_KEYS as string[]).includes(k));
  const isAdmin = p.role_key === ADMIN_ROLE;
  if (isAdmin && !pages.includes('admin')) pages.push('admin');
  return {
    status: 'ok',
    user: { id: u.id, email: p.email || email, name: p.name, role: p.role_key, roleLabel: role?.label ?? p.role_key, pages, csrKey: p.csr_key, isAdmin },
  };
});

export const canView = (u: CurrentUser, page: PageKey) => u.pages.includes(page);
export const firstAllowedView = (u: CurrentUser): PageKey | null => PAGE_KEYS.find(k => u.pages.includes(k)) ?? null;

// For pages: the signed-in user, or a redirect to the sign-in page.
export async function requireUser(next?: string): Promise<CurrentUser> {
  const s = await getAuthState();
  if (s.status === 'ok') return s.user;
  if (s.status === 'signed-out') redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  redirect(`/login?error=${s.reason}`);
}

// For server actions: refuse unless the signed-in user may open this page. Actions are
// public endpoints in their own right, so hiding a button is not enough.
export async function requirePage(page: PageKey): Promise<CurrentUser> {
  const s = await getAuthState();
  if (s.status !== 'ok' || !canView(s.user, page)) throw new Error('Not allowed');
  return s.user;
}
