import { syncClientMeta, type MetaSyncResult } from '@/lib/metaSync';
import { syncClientGhl, type GhlSyncResult } from '@/lib/ghlSync';
import { syncClientCalls, type CallsSyncResult } from '@/lib/callsSync';

// Syncs ONE client's Meta ads + GHL contacts/transactions + recent calls — all together.
// Invoked (fanned out) by the daily dispatcher, one invocation per client, so each gets
// its own function budget + rate-limit bucket and a slow client can't stall the others.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const CALLS_WINDOW_DAYS = 3; // calls use a short rolling window; Meta/GHL pull their own ranges

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const loc = new URL(req.url).searchParams.get('loc');
  if (!loc) return Response.json({ ok: false, error: 'missing loc' }, { status: 400 });

  const [meta, ghl, calls] = await Promise.all([
    syncClientMeta(loc).catch((e): MetaSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'meta error' })),
    syncClientGhl(loc).catch((e): GhlSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'ghl error' })),
    syncClientCalls(loc, CALLS_WINDOW_DAYS).catch((e): CallsSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'calls error' })),
  ]);

  return Response.json({ ok: meta.ok || ghl.ok || calls.ok, meta, ghl, calls });
}
