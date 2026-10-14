import { supabaseAdmin } from './supabase';

// Read side of the Admin Panel: who has access, and what each role can open.

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  csrKey: string | null;
  active: boolean;
  lastSignIn: string | null;   // ISO, from Supabase Auth
  passwordSet: boolean;        // false until they've used their invite link
};

export type RoleRow = { key: string; label: string; pages: string[] };

export async function getRoles(): Promise<RoleRow[]> {
  const { data } = await supabaseAdmin.from('roles').select('key, label, pages').order('created_at');
  return (data ?? []) as RoleRow[];
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  const [{ data: profiles }, list] = await Promise.all([
    supabaseAdmin.from('user_profiles').select('user_id, email, name, role_key, csr_key, active').order('created_at'),
    supabaseAdmin.auth.admin.listUsers({ perPage: 1000 }),
  ]);
  const authBy = new Map((list.data?.users ?? []).map(u => [u.id, u]));
  return ((profiles ?? []) as { user_id: string; email: string; name: string | null; role_key: string; csr_key: string | null; active: boolean }[]).map(p => {
    const a = authBy.get(p.user_id);
    return {
      id: p.user_id,
      email: p.email,
      name: p.name,
      role: p.role_key,
      csrKey: p.csr_key,
      active: p.active,
      lastSignIn: a?.last_sign_in_at ?? null,
      // An invited user who hasn't opened the link has no confirmed email yet.
      passwordSet: !!a?.email_confirmed_at && !!a?.last_sign_in_at,
    };
  });
}
