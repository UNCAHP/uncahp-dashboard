import { NextRequest, NextResponse } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createAuthClient } from '@/lib/supabaseAuth';

// Invite and reset links an admin copies from the Admin Panel land here:
// /auth/confirm?token_hash=…&type=invite|recovery. Verifying the token signs the person in
// (session cookies), then they choose a password.
export async function GET(req: NextRequest) {
  const tokenHash = req.nextUrl.searchParams.get('token_hash');
  const type = req.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const to = req.nextUrl.clone();
  to.search = '';
  if (tokenHash && type) {
    const auth = await createAuthClient();
    const { error } = await auth.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      to.pathname = '/auth/set-password';
      return NextResponse.redirect(to);
    }
  }
  to.pathname = '/login';
  to.searchParams.set('error', 'link');
  return NextResponse.redirect(to);
}
