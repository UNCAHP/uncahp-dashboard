'use server';

import { revalidatePath } from 'next/cache';
import { syncClientMeta, type MetaSyncResult } from '@/lib/metaSync';
import { syncClientGhl, type GhlSyncResult } from '@/lib/ghlSync';

export type ClientSyncResult = { meta: MetaSyncResult; ghl: GhlSyncResult };

// On-demand pull of BOTH Meta ad data and GHL contacts/transactions for one client,
// using the Meta system-user token + the client's GHL Private Integration Token. Lets a
// newly-added client fetch everything immediately instead of waiting for the daily runs.
export async function syncClientAction(ghlLocationId: string): Promise<ClientSyncResult> {
  const [meta, ghl] = await Promise.all([
    syncClientMeta(ghlLocationId).catch((e): MetaSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'Meta sync error' })),
    syncClientGhl(ghlLocationId).catch((e): GhlSyncResult => ({ ok: false, error: e instanceof Error ? e.message : 'GHL sync error' })),
  ]);
  if (meta.ok || ghl.ok) revalidatePath('/');
  return { meta, ghl };
}
