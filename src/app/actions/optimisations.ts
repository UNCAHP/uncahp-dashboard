'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { PRIMARY_METRICS, VERDICTS } from '@/lib/optimisationConstants';

export type ActionState = { ok: boolean; error?: string };

function field(fd: FormData, name: string): string | null {
  const v = (fd.get(name) ?? '').toString().trim();
  return v.length ? v : null;
}

const isMetric = (v: string | null): boolean => !!v && (PRIMARY_METRICS as readonly string[]).includes(v);
const isVerdict = (v: string | null): boolean => !!v && (VERDICTS as readonly string[]).includes(v);

// yyyy-mm-dd, and a date that actually exists (the <input type="date"> gives us this, but
// the action is reachable without it).
function validDate(v: string | null): boolean {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function payload(fd: FormData): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const funnel_id = field(fd, 'funnel_id');
  const change_date = field(fd, 'change_date');
  const title = field(fd, 'title');
  const primary_metric = field(fd, 'primary_metric');
  const verdict = field(fd, 'verdict');

  if (!funnel_id) return { ok: false, error: 'Pick the funnel this change was made to.' };
  if (!validDate(change_date)) return { ok: false, error: 'Give the date the change went live.' };
  if (!title) return { ok: false, error: 'Say what was changed.' };

  return {
    ok: true,
    value: {
      funnel_id,
      change_date,
      title,
      detail: field(fd, 'detail'),
      primary_metric: isMetric(primary_metric) ? primary_metric : 'deposit_rate',
      // Empty verdict is meaningful — "not decided yet" — so it maps to null, not a default.
      verdict: isVerdict(verdict) ? verdict : null,
      verdict_note: field(fd, 'verdict_note'),
    },
  };
}

export async function saveOptimisationAction(_prev: ActionState | null, fd: FormData): Promise<ActionState> {
  try {
    const parsed = payload(fd);
    if (!parsed.ok) return { ok: false, error: parsed.error };

    const id = field(fd, 'id');
    const { error } = id
      ? await supabaseAdmin.from('funnel_optimisations').update(parsed.value).eq('id', id)
      : await supabaseAdmin.from('funnel_optimisations').insert(parsed.value);

    if (error) return { ok: false, error: error.message };
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('saveOptimisationAction failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error saving the log entry.' };
  }
}

/** Set (or clear) just the verdict — the one-click path from the suggested verdict. */
export async function setVerdictAction(id: string, verdict: string | null): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing entry id.' };
  if (verdict !== null && !isVerdict(verdict)) return { ok: false, error: 'Unknown verdict.' };
  const { error } = await supabaseAdmin.from('funnel_optimisations').update({ verdict }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

export async function deleteOptimisationAction(id: string): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing entry id.' };
  const { error } = await supabaseAdmin.from('funnel_optimisations').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}
