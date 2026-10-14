'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createAuthClient } from '@/lib/supabaseAuth';

export type AuthFormState = { ok: boolean; error?: string; message?: string };

// Only same-site paths, so ?next= can't bounce someone to another site after sign-in.
const safeNext = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
};

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function signInAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const password = String(fd.get('password') ?? '');
  if (!email || !password) return { ok: false, error: 'Enter your email and password.' };
  const auth = await createAuthClient();
  const { error } = await auth.auth.signInWithPassword({ email, password });
  // One message for every failure, so the form doesn't reveal which emails have accounts.
  if (error) return { ok: false, error: 'That email and password don’t match.' };
  redirect(safeNext(fd.get('next')));
}

export async function signOutAction(): Promise<void> {
  const auth = await createAuthClient();
  await auth.auth.signOut();
  redirect('/login');
}

// Sends Supabase's password-reset email. The link comes back to /auth/callback with a code
// that only this browser can redeem (PKCE), then on to /auth/set-password.
export async function requestResetAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Enter your email.' };
  const auth = await createAuthClient();
  await auth.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/auth/set-password` });
  // Same answer whether or not the account exists.
  return { ok: true, message: 'If that email has an account, a reset link is on its way. Open it in this browser.' };
}

export async function setPasswordAction(_prev: AuthFormState, fd: FormData): Promise<AuthFormState> {
  const password = String(fd.get('password') ?? '');
  const confirm = String(fd.get('confirm') ?? '');
  if (password.length < 10) return { ok: false, error: 'Use at least 10 characters.' };
  if (password !== confirm) return { ok: false, error: 'The two passwords don’t match.' };
  const auth = await createAuthClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) return { ok: false, error: 'This link has expired. Ask an admin for a new one.' };
  const { error } = await auth.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };
  redirect('/');
}
