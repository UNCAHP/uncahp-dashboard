import { supabase, supabaseAdmin } from './supabase';
import type { DateRange } from './queries';
import { SPEED_TO_LEAD_MINUTES, hasRefTag } from './csrConstants';

// ─── Speed to Lead ───────────────────────────────────────────────────────────
// "% of ALL new leads contacted by phone within 30 min of enquiry, during setter shifts".
//
//   Denominator — every lead created in range whose enquiry landed while at least one
//                 setter was on shift that day (csr_shifts, written by Viktor after the
//                 Start of Day check-in; London time) AND has a phone number (a lead with
//                 no number can't be phoned, so it's excluded rather than counted as a
//                 miss) AND carries a campaign REF tag (see csrConstants.REF_TAG_RE) —
//                 untagged contacts and reactivation lists aren't new enquiries. Days
//                 with no shift rows fall back to the old fixed 10:00–18:00 window so
//                 history before the shift feed still renders.
//   Numerator   — those with an OUTBOUND call logged within 30 minutes of the enquiry.
//
// A lead with no call at all stays in the TEAM denominator and counts as a MISS — the
// point of the KPI is that every new lead gets a fast phone response. Credit for a hit
// goes to whoever actually made the first call (the call carries the CSR). Never-phoned
// leads can't be pinned on a person (leads route to the AI agent, not a setter), so they
// sit in the "No phone call" bucket and drag the team rate — individual rates are of the
// leads that setter phoned.

// Fallback window for days with no shift data.
const BUSINESS_START = 10;
const BUSINESS_END = 18; // exclusive (6pm)

// Per-day shift coverage for ONE client, as "HH:MM" London-local intervals:
//   • the client's assigned setter's shift (clients.csr_key), when they're on that day;
//   • otherwise — assigned setter off, or no assignment — everyone who was on (cover).
// A lead counts if its arrival time falls inside any interval for its day.
type Coverage = Map<string, { start: string; end: string }[]>;

async function getShiftCoverage(clientId: string, range: DateRange): Promise<Coverage> {
  const [{ data: client }, { data: shifts }] = await Promise.all([
    supabaseAdmin.from('clients').select('csr_key').eq('ghl_location_id', clientId).maybeSingle(),
    supabaseAdmin
      .from('csr_shifts')
      .select('shift_date, csr_key, shift_start, shift_end, off')
      .gte('shift_date', range.since)
      .lte('shift_date', range.until),
  ]);
  const assigned = (client as { csr_key?: string | null } | null)?.csr_key ?? null;

  const byDay = new Map<string, { csr: string; start: string; end: string }[]>();
  for (const r of shifts ?? []) {
    if (r.off || !r.shift_start || !r.shift_end) continue;
    const list = byDay.get(r.shift_date) ?? [];
    list.push({ csr: r.csr_key, start: String(r.shift_start).slice(0, 5), end: String(r.shift_end).slice(0, 5) });
    byDay.set(r.shift_date, list);
  }
  const cov: Coverage = new Map();
  for (const [day, list] of byDay) {
    const own = assigned ? list.filter(x => x.csr === assigned) : [];
    cov.set(day, (own.length ? own : list).map(({ start, end }) => ({ start, end })));
  }
  return cov;
}

// "HH:MM" in London time.
const londonClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });

// Was anyone on shift when this lead arrived? Shift data wins; otherwise the fixed window.
function onShift(iso: string, cov: Coverage): boolean {
  const day = londonDate(iso);
  const shifts = cov.get(day);
  if (shifts && shifts.length) {
    const t = londonClock(iso);
    return shifts.some(s => t >= s.start && t < s.end);
  }
  const h = londonHour(iso);
  return h >= BUSINESS_START && h < BUSINESS_END;
}

export type CsrSpeedRow = {
  csr: string;
  called: number;      // leads this CSR was the first to phone
  within: number;      // ...within the 30-min target
  pct: number | null;  // within ÷ called (this setter's phoned leads)
};

export type SpeedToLead = {
  leadsInHours: number;      // all new leads that arrived during a setter shift (the rate's denominator)
  phoned: number;            // ...of those, how many got a phone call (context)
  contactedWithin: number;   // ...within the 30-min target (numerator)
  pct: number | null;        // contactedWithin ÷ leadsInHours — measured on ALL new leads
  neverCalled: number;       // leads with no phone call — a miss at the team level
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

  const [{ data: leads }, { data: calls }, coverage] = await Promise.all([
    supabase
      .from('ghl_contacts')
      .select('source_id, date_added, phone, tags')
      .eq('location_id', clientId)
      .gte('date_added', `${range.since}T00:00:00Z`)
      .lte('date_added', `${range.until}T23:59:59Z`),
    supabaseAdmin
      .from('csr_calls')
      .select('contact_source_id, user_name, user_id, call_at, direction')
      .eq('location_id', clientId)
      .eq('direction', 'outbound'),
    getShiftCoverage(clientId, range),
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
    // No phone number → can't be a phone-response target, so it's not in the denominator.
    if (!String((l as { phone?: string | null }).phone ?? '').trim()) continue;
    // No campaign REF tag → not a new enquiry (manual add, import, reactivation list).
    if (!hasRefTag((l as { tags?: unknown }).tags)) continue;
    if (!onShift(l.date_added, coverage)) continue; // nobody on shift when it arrived
    leadsInHours++;

    const fc = firstCall.get(l.source_id);
    // Only calls *after* the enquiry count as a response to it. A never-phoned lead is a
    // miss at the team level (it's in leadsInHours) but can't be credited to a person.
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

  // The rate is measured on ALL new leads in business hours — a lead never phoned is a
  // miss (0), not an exclusion. `phoned` / `neverCalled` are kept for context/breakdown.
  const phoned = leadsInHours - neverCalled;
  return {
    leadsInHours,
    phoned,
    contactedWithin,
    pct: leadsInHours ? +((100 * contactedWithin) / leadsInHours).toFixed(1) : null,
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
  speedLeads: number;   // new leads this setter was the first to phone (10–6 window)
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
