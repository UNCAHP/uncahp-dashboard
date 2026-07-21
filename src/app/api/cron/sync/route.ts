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
  const authHeaders: HeadersInit = { authorization: `Bearer ${secret}` };

  const { data: keys } = await supabaseAdmin
    .from('ghl_api_keys')
    .select('location_id, location_name')
    .eq('is_active', true);
  const locs = (keys ?? []).map(k => ({ id: k.location_id as string, name: (k.location_name as string) ?? (k.location_id as string) }));

  // Each fetch spins up a separate sync-client invocation → they run concurrently.
  const results = await Promise.all(locs.map(async l => {
    try {
      const r = await fetch(`${origin}/api/cron/sync-client?loc=${encodeURIComponent(l.id)}`, { headers: authHeaders });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      return { client: l.name, ok: !!j.ok, error: j.error };
    } catch (e) {
      return { client: l.name, ok: false, error: e instanceof Error ? e.message : 'dispatch error' };
    }
  }));

  return Response.json({
    ok: true,
    clients: locs.length,
    succeeded: results.filter(r => r.ok).length,
    results,
  });
}
