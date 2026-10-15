'use client';

import { useActionState, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { signInAction, requestResetAction, setPasswordAction, type AuthFormState } from '@/app/actions/auth';
import { cn } from '@/lib/utils';

const initial: AuthFormState = { ok: false };

// "Forgot password?" is hidden until Supabase's Site URL points at the live dashboard —
// until then its reset emails link to localhost. Admins send reset links from the Admin
// Panel meanwhile. Flip to true once the Supabase URL Configuration is fixed.
const SELF_SERVE_RESET = false;
const inputCls = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-fg placeholder:text-fg-dim';

export function AuthCard({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/UNCAHP%20LOGO.png" alt="" className="h-9 w-9 object-contain" />
          <div>
            <div className="text-sm font-bold leading-tight text-fg">UNCAHP</div>
            <div className="text-[9px] uppercase tracking-widest text-fg">Client Dashboard</div>
          </div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h1 className="text-xl font-bold tracking-tight text-fg">{title}</h1>
          {sub && <p className="mt-1 text-sm text-fg-muted">{sub}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-pink px-4 py-2.5 text-sm font-semibold text-black transition-colors hover:bg-pink-soft disabled:opacity-60">
      {pending && <Loader2 size={15} className="animate-spin" />}{children}
    </button>
  );
}

function Note({ state }: { state: AuthFormState }) {
  if (state.error) return <p role="alert" className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{state.error}</p>;
  if (state.message) return <p role="status" className="rounded-lg border border-green/30 bg-green/10 px-3 py-2 text-xs text-green">{state.message}</p>;
  return null;
}

export function SignInForm({ next, notice }: { next: string; notice?: string }) {
  const [mode, setMode] = useState<'in' | 'reset'>('in');
  const [signInState, signIn, signingIn] = useActionState(signInAction, initial);
  const [resetState, reset, resetting] = useActionState(requestResetAction, initial);

  if (mode === 'reset') {
    return (
      <form action={reset} className="space-y-4">
        <p className="text-sm text-fg-muted">We’ll email you a link to choose a new password.</p>
        <Field label="Email"><input name="email" type="email" autoComplete="email" required autoFocus className={inputCls} /></Field>
        <Note state={resetState} />
        <Submit pending={resetting}>Send reset link</Submit>
        <button type="button" onClick={() => setMode('in')} className="w-full text-center text-xs font-medium text-fg-muted transition-colors hover:text-pink">Back to sign in</button>
      </form>
    );
  }
  return (
    <form action={signIn} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      {notice && !signInState.error && <p className="rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-xs text-yellow">{notice}</p>}
      <Field label="Email"><input name="email" type="email" autoComplete="email" required autoFocus className={inputCls} /></Field>
      <Field label="Password"><input name="password" type="password" autoComplete="current-password" required className={inputCls} /></Field>
      <Note state={signInState} />
      <Submit pending={signingIn}>Sign in</Submit>
      {SELF_SERVE_RESET && <button type="button" onClick={() => setMode('reset')} className={cn('w-full text-center text-xs font-medium text-fg-muted transition-colors hover:text-pink')}>Forgot password?</button>}
    </form>
  );
}

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPasswordAction, initial);
  return (
    <form action={action} className="space-y-4">
      <Field label="New password"><input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus className={inputCls} /></Field>
      <Field label="Confirm password"><input name="confirm" type="password" autoComplete="new-password" minLength={10} required className={inputCls} /></Field>
      <Note state={state} />
      <Submit pending={pending}>Save and continue</Submit>
    </form>
  );
}
