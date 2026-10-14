import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export const config = {
  // Static files (icons, the logo, Next's own assets) are public by nature and fetched by
  // browsers with no session; anything with a file extension is skipped.
  matcher: ['/((?!_next/static|_next/image|.*\\.[a-zA-Z0-9]+$).*)'],
};

// Routes that sign in for themselves with a bearer secret, or are public by design.
const OPEN_API = ['/api/shifts', '/api/speed-to-lead', '/api/funnel-analytics'];
const isOpen = (path: string) =>
  path.startsWith('/api/cron/')        // Vercel Cron, CRON_SECRET
  || path.startsWith('/api/track')     // split-test collector, called from funnel sites
  || OPEN_API.includes(path)           // Viktor, SHIFTS_API_SECRET / REPORTS_API_SECRET
  || path === '/login'
  || path.startsWith('/auth/');

// Keeps the Supabase session fresh on every request and sends anyone without one to the
// sign-in page. This is the optimistic check only — the page and every server action
// verify the user and their page access themselves (src/lib/auth.ts).
export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  if (path.startsWith('/api/') && isOpen(path)) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: list => {
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  // Verifies the token and refreshes it when it's close to expiry (writing new cookies).
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims && !isOpen(path)) {
    const to = req.nextUrl.clone();
    to.pathname = '/login';
    to.search = '';
    const next = `${path}${req.nextUrl.search}`;
    if (next !== '/') to.searchParams.set('next', next);
    return NextResponse.redirect(to);
  }
  return res;
}
