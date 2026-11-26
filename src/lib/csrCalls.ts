import { supabaseAdmin } from './supabase';
import type { DateRange } from './queries';
import { CSR_SETTERS } from './csrConstants';
import { CONVERSATION_MIN_SEC, pageAll } from './csrMetrics';

// ─── Calls made: every outbound dial, per setter, per client, per day ────────
// Straight from the GHL call log (csr_calls), so it counts every dial a setter made, not
// just the ones to new leads that Speed to Lead scores. A call is credited to whoever
// made it, on whichever account it was. "Connected" = answered and lasted 60s+, the same
// bar Speed to Lead uses. Days are London days.

export type CallDay = { csr: string; client_id: string; day: string; dials: number; connected: number };
export type CallActivity = { rows: CallDay[]; syncedAt: string | null };

const londonDate = (iso: string): string => {
  const p = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
};

// "Cathy Swift" → "cathy", only for the setters on the team (not the AI bot or clinic staff).
const KEYS = new Set(CSR_SETTERS.map(s => s.key));
const setterKey = (name: string | null): string | null => {
  const k = String(name ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return KEYS.has(k) ? k : null;
};

export async function getCallActivity(range: DateRange): Promise<CallActivity> {
  // A day either side, then cut to London days, so the edges of the range are whole days.
  const from = new Date(Date.parse(`${range.since}T00:00:00Z`) - 86_400_000).toISOString();
  const to = new Date(Date.parse(`${range.until}T23:59:59Z`) + 86_400_000).toISOString();
  const [calls, last] = await Promise.all([
    pageAll<{ location_id: string; user_name: string | null; call_at: string | null; status: string | null; duration_sec: number | null }>((f, t) =>
      supabaseAdmin.from('csr_calls')
        .select('location_id, user_name, call_at, status, duration_sec')
        .eq('direction', 'outbound')
        .gte('call_at', from)
        .lte('call_at', to)
        .order('call_at')
        .order('id')
        .range(f, t)),
    supabaseAdmin.from('csr_calls').select('_synced_at').order('_synced_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const map = new Map<string, CallDay>();
  for (const c of calls) {
    if (!c.call_at) continue;
    const csr = setterKey(c.user_name);
    if (!csr) continue;
    const day = londonDate(c.call_at);
    if (day < range.since || day > range.until) continue;
    const k = `${csr}|${c.location_id}|${day}`;
    const r = map.get(k) ?? { csr, client_id: c.location_id, day, dials: 0, connected: 0 };
    r.dials++;
    if (c.status === 'completed' && (c.duration_sec ?? 0) >= CONVERSATION_MIN_SEC) r.connected++;
    map.set(k, r);
  }
  return { rows: [...map.values()], syncedAt: (last.data as { _synced_at: string } | null)?._synced_at ?? null };
}
