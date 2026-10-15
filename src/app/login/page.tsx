import { redirect } from 'next/navigation';
import { AuthCard, SignInForm } from '@/components/AuthForms';
import { getAuthState } from '@/lib/auth';
import { signOutAction } from '@/app/actions/auth';

export const dynamic = 'force-dynamic';

const NOTICES: Record<string, string> = {
  'no-profile': 'Your account isn’t set up for the dashboard yet. Ask an admin to give you access.',
  inactive: 'Your access has been turned off. Ask an admin if this is a mistake.',
  link: 'That link has expired, was already used, or was opened in a different browser from the one that asked for it. Request a new reset link, or ask an admin for one.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const state = await getAuthState();
  if (state.status === 'ok') redirect(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

  // Signed in, but no profile or switched off: say so, and offer a way out of the account.
  if (state.status === 'no-access') {
    return (
      <AuthCard title="No access" sub={state.email}>
        <p className="text-sm text-fg-muted">{NOTICES[state.reason]}</p>
        <form action={signOutAction} className="mt-5">
          <button className="w-full rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg">Sign out</button>
        </form>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Sign in" sub="UNCAHP team dashboard">
      <SignInForm next={next ?? '/'} notice={error ? NOTICES[error] : undefined} />
    </AuthCard>
  );
}
