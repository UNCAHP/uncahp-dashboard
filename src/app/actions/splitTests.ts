'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';

export type ActionState = { ok: boolean; error?: string };

// A split test is configured on the funnel itself (via the Add/Edit funnel form). These
// two actions are the quick controls shown on the funnel's Split Test panel: flip its
// status without reopening the form, and detach it entirely.

// Running ⇄ Decided ⇄ Paused, without touching the key/variants.
export async function setSplitTestStatus(funnelId: string, status: 'off' | 'running' | 'decided'): Promise<ActionState> {
  if (!funnelId) return { ok: false, error: 'Missing funnel id.' };
  const { error } = await supabaseAdmin.from('funnels').update({ split_status: status }).eq('id', funnelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

// Detach the split test from a funnel (collected events are kept, just no longer tracked here).
export async function clearSplitTest(funnelId: string): Promise<ActionState> {
  if (!funnelId) return { ok: false, error: 'Missing funnel id.' };
  const { error } = await supabaseAdmin
    .from('funnels')
    .update({ track_key: null, variants: [], split_status: 'off' })
    .eq('id', funnelId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}
