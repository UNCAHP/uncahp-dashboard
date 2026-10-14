import { redirect } from 'next/navigation';
import { AuthCard, SetPasswordForm } from '@/components/AuthForms';
import { createAuthClient } from '@/lib/supabaseAuth';

export const dynamic = 'force-dynamic';

// Reached from an invite or reset link, which has already signed the person in.
export default async function SetPasswordPage() {
  const auth = await createAuthClient();
  const { data } = await auth.auth.getUser();
  if (!data.user) redirect('/login?error=link');
  return (
    <AuthCard title="Choose a password" sub={data.user.email ?? undefined}>
      <SetPasswordForm />
    </AuthCard>
  );
}
