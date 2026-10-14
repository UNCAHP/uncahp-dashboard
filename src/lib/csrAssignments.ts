import { supabaseAdmin } from './supabase';

// Who owned each account, and from when (client_csr_assignments, migration 0020).
// clients.csr_key is the CURRENT owner; this history lets a past day be credited to
// whoever owned the account then, so reassigning an account doesn't rewrite past months.

type Span = { from: string; csr: string | null };        // from = yyyy-mm-dd
export type AssignmentHistory = Map<string, Span[]>;     // by GHL location id, oldest first

// null when the table isn't there yet (migration 0020 not run): callers fall back to
// clients.csr_key, which is how every day was attributed before the history existed.
export async function getAssignmentHistory(): Promise<AssignmentHistory | null> {
  const { data, error } = await supabaseAdmin
    .from('client_csr_assignments')
    .select('ghl_location_id, csr_key, effective_from')
    .order('effective_from');
  if (error) return null;
  const h: AssignmentHistory = new Map();
  for (const r of (data ?? []) as { ghl_location_id: string; csr_key: string | null; effective_from: string }[]) {
    const l = h.get(r.ghl_location_id) ?? [];
    l.push({ from: String(r.effective_from), csr: r.csr_key });
    h.set(r.ghl_location_id, l);
  }
  return h;
}

// The owner on a London yyyy-mm-dd day. undefined = no history for this account (use the
// current owner); null = self booking that day.
export function ownerOn(h: AssignmentHistory | null, id: string, day: string): string | null | undefined {
  const spans = h?.get(id);
  if (!spans?.length) return undefined;
  let owner: string | null | undefined = undefined;
  for (const s of spans) if (s.from <= day) owner = s.csr;
  return owner;
}

// Everyone who owned the account at some point between two days, inclusive.
export function ownersBetween(h: AssignmentHistory | null, id: string, since: string, until: string): (string | null)[] | undefined {
  const spans = h?.get(id);
  if (!spans?.length) return undefined;
  const out = new Set<string | null>();
  spans.forEach((s, i) => {
    const end = spans[i + 1]?.from;              // exclusive
    if (s.from <= until && (!end || end > since)) out.add(s.csr);
  });
  return [...out];
}

// First of the current month in London — when a reassignment made today takes effect.
export function currentMonthStart(): string {
  const p = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit' }).split('/');
  return `${p[1]}-${p[0]}-01`;
}
