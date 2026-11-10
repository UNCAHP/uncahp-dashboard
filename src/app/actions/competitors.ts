'use server';

import { revalidatePath } from 'next/cache';
import { requirePage } from '@/lib/auth';
import { runCompetitorScan, deleteCompetitorScan } from '@/lib/competitors';

type Result = { ok: true; id: string } | { ok: false; error: string };

// Runs one competitor price scan (Firecrawl credits — see lib/competitors) and saves it.
export async function scanCompetitorsAction(input: { clientId: string; treatment: string; radiusMiles: number; ourPrice: number | null }): Promise<Result> {
  const user = await requirePage('competitors');
  try {
    const radius = [5, 10, 25].includes(input.radiusMiles) ? input.radiusMiles : 10;
    const ourPrice = input.ourPrice != null && Number.isFinite(input.ourPrice) && input.ourPrice > 0 ? input.ourPrice : null;
    const { id } = await runCompetitorScan({ clientId: input.clientId, treatment: input.treatment, radiusMiles: radius, ourPrice, by: user.email });
    revalidatePath('/');
    return { ok: true, id };
  } catch (e) {
    revalidatePath('/');
    return { ok: false, error: e instanceof Error ? e.message : 'Scan failed' };
  }
}

export async function deleteScanAction(id: string): Promise<{ ok: boolean; error?: string }> {
  await requirePage('competitors');
  try {
    await deleteCompetitorScan(id);
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Not deleted' };
  }
}
