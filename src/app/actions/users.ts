'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { requirePage } from '@/lib/auth';
import { PAGE_KEYS, ADMIN_ROLE } from '@/lib/authPages';
import { CSR_SETTERS } from '@/lib/csrConstants';

// Admin Panel actions. Every one checks the caller can open the Admin Panel first.
// Invites are links the admin copies and sends (Slack, WhatsApp, email) rather than
// Supabase emails: no mail setup, no send limits, and the admin sees it worked.

export type UserActionState = { ok: boolean; error?: string; link?: string };

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

const confirmLink = async (tokenHash: string, type: 'invite' | 'recovery') =>
  `${await origin()}/auth/confirm?token_hash=${encodeURIComponent(tokenHash)}&type=${type}`;

const setterOf = (v: FormDataEntryValue | null) => {
  const k = String(v ?? '').toLowerCase();
  return CSR_SETTERS.some(s => s.key === k) ? k : null;
};

async function roleExists(key: string) {
  const { data } = await supabaseAdmin.from('roles').select('key').eq('key', key).maybeSingle();
  return !!data;
}

export async function inviteUserAction(_prev: UserActionState, fd: FormData): Promise<UserActionState> {
  await requirePage('admin');
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const name = String(fd.get('name') ?? '').trim() || null;
  const role = String(fd.get('role') ?? '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Enter a valid email.' };
  if (!(await roleExists(role))) return { ok: false, error: 'Pick a role.' };

  const { data: existing } = await supabaseAdmin.from('user_profiles').select('user_id').eq('email', email).maybeSingle();
  if (existing) return { ok: false, error: 'That email already has access. Use “Reset link” on their row instead.' };

  // An invite link creates the account; if one already exists in Supabase Auth (e.g. made
  // by hand), a recovery link signs them in to set a password instead.
  let res = await supabaseAdmin.auth.admin.generateLink({ type: 'invite', email });
  let type: 'invite' | 'recovery' = 'invite';
  if (res.error && /already|registered|exists/i.test(res.error.message)) {
    res = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email });
    type = 'recovery';
  }
  if (res.error || !res.data.user) return { ok: false, error: res.error?.message ?? 'Could not create the invite.' };

  const { error } = await supabaseAdmin.from('user_profiles').insert({
    user_id: res.data.user.id, email, name, role_key: role, csr_key: setterOf(fd.get('csr_key')), active: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true, link: await confirmLink(res.data.properties.hashed_token, type) };
}

// A fresh sign-in link for someone who lost their invite or forgot their password.
export async function resetLinkAction(userId: string): Promise<UserActionState> {
  await requirePage('admin');
  const { data: p } = await supabaseAdmin.from('user_profiles').select('email').eq('user_id', userId).maybeSingle();
  if (!p) return { ok: false, error: 'User not found.' };
  const res = await supabaseAdmin.auth.admin.generateLink({ type: 'recovery', email: p.email });
  if (res.error) return { ok: false, error: res.error.message };
  return { ok: true, link: await confirmLink(res.data.properties.hashed_token, 'recovery') };
}

export async function updateUserAction(userId: string, patch: { role?: string; csrKey?: string | null; active?: boolean; name?: string | null }): Promise<UserActionState> {
  const me = await requirePage('admin');
  // Nobody can lock themselves out: no demoting or deactivating your own account.
  if (userId === me.id && ((patch.role && patch.role !== ADMIN_ROLE) || patch.active === false)) {
    return { ok: false, error: 'You can’t remove your own admin access.' };
  }
  const row: Record<string, unknown> = {};
  if (patch.role !== undefined) {
    if (!(await roleExists(patch.role))) return { ok: false, error: 'Unknown role.' };
    row.role_key = patch.role;
  }
  if (patch.csrKey !== undefined) row.csr_key = patch.csrKey ? setterOf(patch.csrKey) : null;
  if (patch.active !== undefined) row.active = patch.active;
  if (patch.name !== undefined) row.name = patch.name?.trim() || null;
  const { error } = await supabaseAdmin.from('user_profiles').update(row).eq('user_id', userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

export async function updateRolePagesAction(roleKey: string, pages: string[]): Promise<UserActionState> {
  await requirePage('admin');
  const clean = PAGE_KEYS.filter(k => pages.includes(k));
  // The admin role always keeps the Admin Panel.
  if (roleKey === ADMIN_ROLE && !clean.includes('admin')) clean.push('admin');
  const { error } = await supabaseAdmin.from('roles').update({ pages: clean }).eq('key', roleKey);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}
