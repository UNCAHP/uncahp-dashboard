import { supabase, supabaseAdmin } from './supabase';
import type { DateRange } from './queries';
import { SPEED_TO_LEAD_MINUTES } from './csrConstants';

// ─── Speed to Lead ───────────────────────────────────────────────────────────
// "% of new leads contacted by phone within 30 min of enquiry (9am–5pm)".
//
//   Denominator — leads created in range whose enquiry landed inside business hours
//                 (09:00–17:00 Europe/London; the clinics are UK-based).
//   Numerator   — those with an OUTBOUND call logged within 30 minutes of the enquiry.
//
// A lead with no call at all stays in the denominator (it's a miss, not an exclusion).
// Credit goes to whoever actually made the first call (the call carries the CSR), not
// the assigned user — the assignee often isn't the one who picks the phone up.

const BUSINESS_START = 9;
const BUSINESS_END = 17; // exclusive

export type CsrSpeedRow = {
  csr: string;
  called: number;      // leads this CSR made the first call to
  within: number;      // ...within the 30-min target
  pct: number | null;
};

export type SpeedToLead = {
  leadsInHours: number;      // all new leads created 9am–5pm (context)
  phoned: number;            // ...of those, how many got a phone call (the rate's denominator)
  contactedWithin: number;   // ...within the 30-min target (numerator)
  pct: number | null;        // contactedWithin ÷ phoned — measured on phoned leads only
  neverCalled: number;       // leads with no phone call (handled by SMS / AI, not a miss)
  medianMinutes: number | null;
  perCsr: CsrSpeedRow[];
  callsOnFile: number;       // rows in csr_calls for this client (0 ⇒ not synced yet)
};

const londonHour = (iso: string): number =>
  Number(new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hour12: false }));

// YYYY-MM-DD in London time — for daily buckets.
const londonDate = (iso: string): string => {
  const p = new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
};

// A "conversation" = a connected call of at least this long (matches the ≥60s definition).
const CONVERSATION_MIN_SEC = 60;

export async function getSpeedToLead(clientId: string, range: DateRange): Promise<SpeedToLead> {
  const empty: SpeedToLead = {
    leadsInHours: 0, phoned: 0, contactedWithin: 0, pct: null, neverCalled: 0,
    medianMinutes: null, perCsr: [], callsOnFile: 0,
  };
  if (!clientId) return empty;

  const [{ data: leads }, { data: calls }] = await Promise.all([
    supabase
      .from('ghl_contacts')
      .select('source_id, date_added')
      .eq('location_id', clientId)
      .gte('date_added', `${range.since}T00:00:00Z`)
      .lte('date_added', `${range.until}T23:59:59Z`),
    supabaseAdmin
      .from('csr_calls')
      .select('contact_source_id, user_name, user_id, call_at, direction')
      .eq('location_id', clientId)
      .eq('direction', 'outbound'),
  ]);

  const callsOnFile = calls?.length ?? 0;

  // Earliest outbound call per contact.
  const firstCall = new Map<string, { at: string; csr: string }>();
  for (const c of calls ?? []) {
    if (!c.contact_source_id || !c.call_at) continue;
    const prev = firstCall.get(c.contact_source_id);
    if (!prev || c.call_at < prev.at) {
      firstCall.set(c.contact_source_id, { at: c.call_at, csr: c.user_name || c.user_id || '(unknown)' });
    }
  }

  let leadsInHours = 0, contactedWithin = 0, neverCalled = 0;
  const deltas: number[] = [];
  const perCsr = new Map<string, CsrSpeedRow>();

  for (const l of leads ?? []) {
    if (!l.date_added) continue;
    const h = londonHour(l.date_added);
    if (h < BUSINESS_START || h >= BUSINESS_END) continue; // outside business hours
    leadsInHours++;

    const fc = firstCall.get(l.source_id);
    // Only calls *after* the enquiry count as a response to it.
    if (!fc || fc.at <= l.date_added) { neverCalled++; continue; }

    const mins = (Date.parse(fc.at) - Date.parse(l.date_added)) / 60000;
    deltas.push(mins);
    const row = perCsr.get(fc.csr) ?? { csr: fc.csr, called: 0, within: 0, pct: null };
    row.called++;
    if (mins <= SPEED_TO_LEAD_MINUTES) { row.within++; contactedWithin++; }
    perCsr.set(fc.csr, row);
  }

  for (const r of perCsr.values()) r.pct = r.called ? +((100 * r.within) / r.called).toFixed(1) : null;
  deltas.sort((a, b) => a - b);
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;

  // The rate is measured only on leads that were actually phoned — leads handled by
  // SMS / the AI agent (never called) are excluded, not counted as a miss.
  const phoned = leadsInHours - neverCalled;
  return {
    leadsInHours,
    phoned,
    contactedWithin,
    pct: phoned ? +((100 * contactedWithin) / phoned).toFixed(1) : null,
    neverCalled,
    medianMinutes: median == null ? null : Math.round(median),
    perCsr: [...perCsr.values()].sort((a, b) => b.called - a.called),
    callsOnFile,
  };
}

// ─── Call Activity (setter productivity) ─────────────────────────────────────
// Dials = outbound calls. Conversations = connected calls ≥60s. Plus per-setter rows
// (with their Speed-to-Lead merged in) and a daily dials/conversations series.

export type CsrActivityRow = {
  csr: string;
  dials: number;
  conversations: number;
  convRatePct: number | null;
  avgDurationSec: number | null;
  speedToLeadPct: number | null;
  speedLeads: number;   // new leads this setter was first to phone (9–5 window)
  speedWithin: number;  // ...of those, contacted within the 30-min target
};
export type DailyPoint = { date: string; dials: number; conversations: number };
export type CallActivity = {
  dials: number;
  conversations: number;
  convRatePct: number | null;
  avgDurationSec: number | null;
  setters: CsrActivityRow[];
  daily: DailyPoint[];
  callsOnFile: number;
  speed: SpeedToLead;
};

// Lightweight top-line per client — for the overview grid, so we don't run the heavier
// leads-join (Speed to Lead) across every client.
export type CallSummary = {
  clientId: string;
  dials: number;
  conversations: number;
  convRatePct: number | null;
  avgDurationSec: number | null;
  callsOnFile: number;
};

export async function getCallSummary(clientId: string, range: DateRange): Promise<CallSummary> {
  const empty: CallSummary = { clientId, dials: 0, conversations: 0, convRatePct: null, avgDurationSec: null, callsOnFile: 0 };
  if (!clientId) return empty;
  const [{ data: calls }, { count }] = await Promise.all([
    supabaseAdmin
      .from('csr_calls').select('duration_sec')
      .eq('location_id', clientId).eq('direction', 'outbound')
      .gte('call_at', `${range.since}T00:00:00Z`).lte('call_at', `${range.until}T23:59:59Z`),
    supabaseAdmin.from('csr_calls').select('*', { count: 'exact', head: true }).eq('location_id', clientId),
  ]);
  let dials = 0, conv = 0, durSum = 0;
  for (const c of calls ?? []) {
    dials++;
    if ((c.duration_sec ?? 0) >= CONVERSATION_MIN_SEC) { conv++; durSum += c.duration_sec ?? 0; }
  }
  return {
    clientId, dials, conversations: conv,
    convRatePct: dials ? +((100 * conv) / dials).toFixed(1) : null,
    avgDurationSec: conv ? Math.round(durSum / conv) : null,
    callsOnFile: count ?? 0,
  };
}

export async function getCallActivity(clientId: string, range: DateRange): Promise<CallActivity> {
  const speed = await getSpeedToLead(clientId, range);
  const base: CallActivity = {
    dials: 0, conversations: 0, convRatePct: null, avgDurationSec: null,
    setters: [], daily: [], callsOnFile: speed.callsOnFile, speed,
  };
  if (!clientId) return base;

  const { data: calls } = await supabaseAdmin
    .from('csr_calls')
    .select('user_name, user_id, duration_sec, call_at')
    .eq('location_id', clientId)
    .eq('direction', 'outbound')
    .gte('call_at', `${range.since}T00:00:00Z`)
    .lte('call_at', `${range.until}T23:59:59Z`);

  const speedByCsr = new Map(speed.perCsr.map(r => [r.csr, r]));
  const bySetter = new Map<string, { dials: number; conv: number; durSum: number }>();
  const byDay = new Map<string, { dials: number; conv: number }>();
  let dials = 0, conv = 0, durSum = 0;

  for (const c of calls ?? []) {
    const isConv = (c.duration_sec ?? 0) >= CONVERSATION_MIN_SEC;
    dials++;
    if (isConv) { conv++; durSum += c.duration_sec ?? 0; }
    const csr = c.user_name || c.user_id || '(unknown)';
    const s = bySetter.get(csr) ?? { dials: 0, conv: 0, durSum: 0 };
    s.dials++; if (isConv) { s.conv++; s.durSum += c.duration_sec ?? 0; }
    bySetter.set(csr, s);
    if (c.call_at) {
      const d = londonDate(c.call_at);
      const dd = byDay.get(d) ?? { dials: 0, conv: 0 };
      dd.dials++; if (isConv) dd.conv++;
      byDay.set(d, dd);
    }
  }

  const setters: CsrActivityRow[] = [...bySetter.entries()]
    .map(([csr, s]) => {
      const sp = speedByCsr.get(csr);
      return {
        csr, dials: s.dials, conversations: s.conv,
        convRatePct: s.dials ? +((100 * s.conv) / s.dials).toFixed(1) : null,
        avgDurationSec: s.conv ? Math.round(s.durSum / s.conv) : null,
        speedToLeadPct: sp?.pct ?? null,
        speedLeads: sp?.called ?? 0,
        speedWithin: sp?.within ?? 0,
      };
    })
    .sort((a, b) => b.dials - a.dials);

  // Daily series across the range, gaps filled with zeros (capped so long ranges stay sane).
  const daily: DailyPoint[] = [];
  const start = Date.parse(`${range.since}T00:00:00Z`);
  const end = Date.parse(`${range.until}T00:00:00Z`);
  for (let t = start; t <= end && daily.length < 120; t += 86_400_000) {
    const key = new Date(t).toISOString().slice(0, 10);
    const v = byDay.get(key) ?? { dials: 0, conv: 0 };
    daily.push({ date: key, dials: v.dials, conversations: v.conv });
  }

  return {
    dials,
    conversations: conv,
    convRatePct: dials ? +((100 * conv) / dials).toFixed(1) : null,
    avgDurationSec: conv ? Math.round(durSum / conv) : null,
    setters, daily, callsOnFile: speed.callsOnFile, speed,
  };
}
