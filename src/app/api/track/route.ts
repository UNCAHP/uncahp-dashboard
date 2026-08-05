import { supabaseAdmin } from '@/lib/supabase';

// Split-test event collector. Funnel pages beacon view/opt-in/deposit events here (see
// src/lib/splitScript.ts). Public by design — the middleware lets /api/track through
// Basic Auth — so it validates the calling origin against FUNNEL_ORIGINS and drops bots.
export const dynamic = 'force-dynamic';

const ALLOWED = (process.env.FUNNEL_ORIGINS ?? '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const BOT = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|headless|lighthouse|pingdom|uptime|monitor|preview/i;
const EVENTS = new Set(['view', 'optin', 'deposit']);

function originAllowed(origin: string | null): boolean {
  if (ALLOWED.length === 0) return true;                 // unconfigured → accept (dev / initial setup)
  if (!origin) return false;
  try { return ALLOWED.includes(new URL(origin).host.toLowerCase()); } catch { return false; }
}

// Beacons are text/plain (no CORS preflight); reflect the origin so a fetch fallback works too.
function corsHeaders(origin: string | null): HeadersInit {
  return {
    'Access-Control-Allow-Origin': origin && originAllowed(origin) ? origin : '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Vary': 'Origin',
  };
}

export function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  const headers = corsHeaders(origin);

  // Prefer Origin, fall back to Referer's host (sendBeacon doesn't always send Origin).
  const referer = req.headers.get('referer');
  const source = origin ?? referer;
  if (!originAllowed(source)) return new Response(null, { status: 204, headers }); // silently ignore

  let body: Record<string, unknown>;
  try { body = JSON.parse(await req.text()); } catch { return new Response(null, { status: 204, headers }); }

  const funnel = String(body.funnel ?? '').trim().slice(0, 200);
  const variant = String(body.variant ?? '').trim().slice(0, 60);
  const visitor = String(body.visitor_id ?? '').trim().slice(0, 120);
  const event = String(body.event ?? '').trim();
  if (!funnel || !variant || !visitor || !EVENTS.has(event)) {
    return new Response(null, { status: 204, headers });
  }

  const ua = req.headers.get('user-agent') ?? '';
  const utm = body.utm && typeof body.utm === 'object' ? body.utm : {};

  await supabaseAdmin.from('funnel_events').insert({
    funnel_key: funnel,
    variant,
    visitor_id: visitor,
    event,
    page_url: body.url ? String(body.url).slice(0, 2000) : null,
    referrer: body.referrer ? String(body.referrer).slice(0, 2000) : null,
    utm,
    user_agent: ua.slice(0, 500),
    is_bot: BOT.test(ua),
  });

  return new Response(null, { status: 204, headers });
}
