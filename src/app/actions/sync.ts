'use server';

import { requirePage } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { syncClientMeta, type MetaSyncResult } from '@/lib/metaSync';
import { syncClientGhl, type GhlSyncResult } from '@/lib/ghlSync';
import { syncClientCalls, callsWindowDays, type CallsSyncResult } from '@/lib/callsSync';

export type ClientSyncResult = { meta: MetaSyncResult; ghl: GhlSyncResult };

// On-demand pull of BOTH Meta ad data and GHL contacts/transactions for one client,
// using the Meta system-user token + the client's GHL Private Integration Token. Lets a
// newly-added client fetch everything immediately instead of waiting for the daily runs.
// Calls ride along too: the last few days normally, the full backfill for a client with
// none on file, so a new client's Speed to Lead is right from its first sync. A calls
// failure never fails the sync — Call Tracking has its own Sync calls button.
export async function syncClientAction(ghlLocationId: string): Promise<ClientSyncResult> {
  await requirePage('clients');
  const [meta, ghl] = await Promise.all([
    syncClientMeta(ghlLocationId).catch((e): MetaSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'Meta sync error' })),
    syncClientGhl(ghlLocationId).catch((e): GhlSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'GHL sync error' })),
    callsWindowDays(ghlLocationId, 3).then(days => syncClientCalls(ghlLocationId, days))
      .catch(e => { console.error('syncClientAction: calls sync failed:', e); return null; }),
  ]);
  if (meta.ok || ghl.ok) revalidatePath('/');
  return { meta, ghl };
}

// Pull GHL call events into csr_calls for the Speed-to-Lead KPI. Separate from the
// Meta/GHL sync because it's slower (walks conversations) and only needed for Call Tracking.
export async function syncClientCallsAction(ghlLocationId: string, days = 30): Promise<CallsSyncResult> {
  await requirePage('calls');
  try {
    const res = await syncClientCalls(ghlLocationId, days);
    if (res.ok) revalidatePath('/');
    return res;
  } catch (e) {
    console.error('syncClientCallsAction failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error syncing calls.' };
  }
}
