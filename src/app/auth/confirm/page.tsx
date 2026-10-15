import { AuthCard, ConfirmLinkForm } from '@/components/AuthForms';

export const dynamic = 'force-dynamic';

// Invite and reset links an admin copies from the Admin Panel land here:
// /auth/confirm?token_hash=…&type=invite|recovery.
//
// The link is one-time, and chat apps (WhatsApp, iMessage, Slack) open every pasted link
// to build a preview. So opening this page spends nothing: the token is only redeemed when
// the person presses Continue (a POST a preview bot never sends), which signs them in and
// takes them to choose a password.
export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string }> }) {
  const { token_hash, type } = await searchParams;
  const kind = type === 'recovery' ? 'recovery' : 'invite';
  return (
    <AuthCard title={kind === 'invite' ? 'Welcome to the dashboard' : 'Reset your password'}
      sub={kind === 'invite' ? 'You’ve been invited to the UNCAHP team dashboard.' : 'Continue to choose a new password.'}>
      <ConfirmLinkForm tokenHash={token_hash ?? ''} type={kind} />
    </AuthCard>
  );
}
