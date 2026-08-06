import { NextRequest, NextResponse } from 'next/server';

export const config = {
  // Site icons are public by nature and get requested by browsers/crawlers that have no
  // password. Exempt every path they're fetched from, otherwise each one shows up in the
  // Vercel logs as a warning-level 401.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png|icon.png|apple-icon.png).*)'],
};

export function middleware(req: NextRequest) {
  // Cron routes authenticate with CRON_SECRET (a Bearer token), not Basic Auth. Let them
  // through — otherwise Vercel Cron gets 401'd by the site password and never syncs.
  if (req.nextUrl.pathname.startsWith('/api/cron/')) return NextResponse.next();

  // Split-test tracking must be reachable by visitors on the funnel sites (who don't have
  // the dashboard password). The collector does its own origin/bot checks. Let it through.
  if (req.nextUrl.pathname.startsWith('/api/track')) return NextResponse.next();

  const expectedUser = process.env.BASIC_AUTH_USER;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPass) return NextResponse.next();

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice(6));
    const [user, ...rest] = decoded.split(':');
    const pass = rest.join(':');
    if (user === expectedUser && pass === expectedPass) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Auth required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="UNCAHP Dashboard"' },
  });
}
