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

  // Each fetch spins up a separate sync-client invocation → they run concurrently.
  const results = await Promise.all(locs.map(async l => {
    try {
      const r = await fetch(`${origin}/api/cron/sync-client?loc=${encodeURIComponent(l.id)}`, { headers: authHeaders });
      const text = await r.text();
      let j: { ok?: boolean; error?: string; meta?: { error?: string }; ghl?: { error?: string }; calls?: { error?: string } } | null = null;
      try { j = JSON.parse(text); } catch { /* non-JSON = auth wall / protection page, not our route */ }
      if (!j) return { client: l.name, ok: false, error: `non-JSON ${r.status}: ${text.slice(0, 140)}` };
      return { client: l.name, ok: !!j.ok, error: j.error ?? null, meta: j.meta?.error ?? null, ghl: j.ghl?.error ?? null, calls: j.calls?.error ?? null };
    } catch (e) {
      return { client: l.name, ok: false, error: e instanceof Error ? e.message : 'dispatch error' };
    }
  }));

  // Surface the full per-client / per-source outcome in the Vercel logs so failures are
  // diagnosable (the route otherwise returns 200 even when every inner sync errored).
  const summary = { origin, clients: locs.length, succeeded: results.filter(r => r.ok).length, results };
  console.log('[cron] sync summary:', JSON.stringify(summary));
  return Response.json({ ok: true, ...summary });
}
