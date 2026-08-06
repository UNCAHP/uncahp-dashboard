import { supabaseAdmin } from '@/lib/supabase';

// Daily sync dispatcher (Vercel Cron). It doesn't do the work itself — it fans out one
// /api/cron/sync-client invocation PER client, in parallel. Each client sync (Meta ads +
// GHL contacts/transactions + recent calls) then gets its own 300s budget and isolated
// rate-limit bucket, so a slow/busy client can't stall or time-out the whole run.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  // Fail closed — without a configured secret the endpoint is never callable.
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const origin = new URL(req.url).origin;
  // The dispatcher fans out by calling its own deployment over HTTP. If Vercel Deployment
  // Protection is on, that self-call hits the auth wall and returns a login page instead of
  // JSON — so every client "fails". Carry the automation-bypass secret (auto-populated when
  // "Protection Bypass for Automation" is enabled) so the internal calls skip the wall.
  const authHeaders: Record<string, string> = { authorization: `Bearer ${secret}` };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) authHeaders['x-vercel-protection-bypass'] = bypass;

  const { data: keys } = await supabaseAdmin
    .from('ghl_api_keys')
    .select('location_id, location_name')
    .eq('is_active', true);
  const locs = (keys ?? []).map(k => ({ id: k.location_id as string, name: (k.location_name as string) ?? (k.location_id as string) }));

  // Each fetch spins up a SEPARATE sync-client invocation with its own 300s budget. We
  // trigger them all, then wait only a short window — NOT for every client to finish.
  // Awaiting all of them made the dispatcher block for the full sync and blow past its own
  // 300s limit (FUNCTION_INVOCATION_TIMEOUT / 504). Vercel serverless functions run to
  // completion even after the caller stops waiting, so the clients that don't confirm inside
  // the window still finish and write their data in the background.
  const TRIGGER_MS = 60_000;
  const settled = await Promise.allSettled(locs.map(l =>
    fetch(`${origin}/api/cron/sync-client?loc=${encodeURIComponent(l.id)}`, {
      headers: authHeaders,
      signal: AbortSignal.timeout(TRIGGER_MS),
    }).then(async r => {
      const t = await r.text();
      try {
        const j = JSON.parse(t) as { ok?: boolean; meta?: { error?: string }; ghl?: { error?: string }; calls?: { error?: string } };
        return { client: l.name, ok: !!j.ok, meta: j.meta?.error ?? null, ghl: j.ghl?.error ?? null, calls: j.calls?.error ?? null };
      } catch { return { client: l.name, ok: false, error: `non-JSON ${r.status}` }; }
    }),
  ));

  const results = settled.filter(s => s.status === 'fulfilled').map(s => (s as PromiseFulfilledResult<Record<string, unknown>>).value);
  const confirmed = results.filter(r => r.ok).length;
  const stillRunning = locs.length - results.length;
  // Log per-client outcomes for the clients that confirmed within the window; the rest are
  // still syncing in their own invocations.
  console.log('[cron] dispatched:', JSON.stringify({ origin, clients: locs.length, confirmed, stillRunning, results }));
  return Response.json({ ok: true, clients: locs.length, confirmed, stillRunning });
}
