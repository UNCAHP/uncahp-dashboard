import { NextRequest, NextResponse } from 'next/server';
import { createAuthClient } from '@/lib/supabaseAuth';

// The password-reset email (requested from the sign-in page) comes back here with a code.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next') ?? '/auth/set-password';
  const to = req.nextUrl.clone();
  to.search = '';
  if (code) {
    const auth = await createAuthClient();
    const { error } = await auth.auth.exchangeCodeForSession(code);
    if (!error) {
      to.pathname = next.startsWith('/') && !next.startsWith('//') ? next : '/auth/set-password';
      return NextResponse.redirect(to);
    }
  }
  to.pathname = '/login';
  to.searchParams.set('error', 'link');
  return NextResponse.redirect(to);
}
