import { syncClientMeta, type MetaSyncResult } from '@/lib/metaSync';
import { syncClientGhl, type GhlSyncResult } from '@/lib/ghlSync';
import { syncClientCalls, callsWindowDays, type CallsSyncResult } from '@/lib/callsSync';
import { after } from 'next/server';
import { markClientStarted, markClientFinished, claimRunStep, finishRunStep } from '@/lib/syncStatus';
import { syncOffersToNotion } from '@/lib/notionSync';

// Syncs ONE client's Meta ads + GHL contacts/transactions + recent calls — all together.
// Invoked (fanned out) by the daily dispatcher, one invocation per client, so each gets
// its own function budget + rate-limit bucket and a slow client can't stall the others.
// 800s (Vercel Pro / Fluid Compute) so a high-volume client's calls sweep finishes in one
// pass instead of hitting the limit and catching up over subsequent daily runs.
export const maxDuration = 800;
export const dynamic = 'force-dynamic';

// Calls use a short rolling window; Meta/GHL pull their own ranges. A client with no calls
// on file yet gets the full backfill instead (see callsWindowDays).
const CALLS_WINDOW_DAYS = 3;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const loc = params.get('loc');
  if (!loc) return Response.json({ ok: false, error: 'missing loc' }, { status: 400 });
  // Part of a daily run: tell the dashboard this client is syncing (see lib/syncStatus).
  const runId = params.get('run');
  await markClientStarted(runId, loc, params.get('name'));

  const [meta, ghl, calls] = await Promise.all([
    syncClientMeta(loc).catch((e): MetaSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'meta error' })),
    syncClientGhl(loc).catch((e): GhlSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'ghl error' })),
    callsWindowDays(loc, CALLS_WINDOW_DAYS).then(days => syncClientCalls(loc, days)).catch((e): CallsSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'calls error' })),
  ]);

  const ok = meta.ok || ghl.ok || calls.ok;
  const errs = [meta, ghl, calls].map(r => (r.ok ? null : r.error)).filter(Boolean).join(' · ') || null;
  await markClientFinished(runId, loc, ok, errs);

  // The last client of the daily run to finish also refreshes the Live Offers table in
  // Notion (on top of its own 3-hourly schedule), after the response is sent.
  after(async () => {
    if (!runId || !process.env.NOTION_TOKEN || !(await claimRunStep(runId, 'notion'))) return;
    const res = await syncOffersToNotion();
    console.log('[sync] notion after daily run:', JSON.stringify(res));
    await finishRunStep(runId, 'notion', res.ok, res.error ?? null);
  });
  return Response.json({ ok, meta, ghl, calls });
}
