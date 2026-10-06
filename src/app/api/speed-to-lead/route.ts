import { getActiveClients } from '@/lib/queries';
import { evaluateLeads, getShifts, type LeadEval } from '@/lib/csrMetrics';
import { setterClients, isTrackedSetter, UNTRACKED_SETTERS, SPEED_TO_LEAD_MINUTES, SPEED_TARGET_PCT, CSR_SETTERS } from '@/lib/csrConstants';

// Read-only Speed to Lead for Viktor (the Slack CSR bot), so it can report back to Slack.
// Same bearer secret as /api/shifts — one integration, one credential.
//
//   GET /api/speed-to-lead?from=YYYY-MM-DD&to=YYYY-MM-DD[&csr=alexis][&client=<ghl location id>]
//   Authorization: Bearer <SHIFTS_API_SECRET>
//
// Defaults: from = to = today (London). `csr` narrows to one setter; `client` to one client.
// Visibility (who may see whose numbers) is Viktor's job — it knows who's asking; this
// endpoint returns the measured data for the range it's given.
//
// Definition, in short: a NEW LEAD is a contact with a campaign REF tag and a phone number
// that arrived while its client's assigned setter (or cover) was on shift. ATTEMPTED =
// an outbound dial within 30 min, answered or not (the scored rate). CONNECTED = a
// completed 60s+ call within 30 min. A lead paid-up within 30 min before any dial
// SELF-BOOKED and isn't counted. Target: 70%.

export const dynamic = 'force-dynamic';

const londonToday = (): string => {
  const p = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
};
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
const label = (key: string) => CSR_SETTERS.find(c => c.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1);
const rate = (n: number, d: number) => (d ? Math.round((1000 * n) / d) / 10 : null);

type Bucket = { leads: number; attempted: number; connected: number; neverCalled: number; selfBooked: number; mins: number[] };
const bucket = (): Bucket => ({ leads: 0, attempted: 0, connected: 0, neverCalled: 0, selfBooked: 0, mins: [] });
function add(b: Bucket, l: LeadEval) {
  if (l.selfBooked) { b.selfBooked++; return; }
  b.leads++;
  if (l.attempted) b.attempted++;
  if (l.connected) b.connected++;
  if (!l.firstDialBy) b.neverCalled++;
  if (l.minsToDial != null) b.mins.push(l.minsToDial);
}
function out(b: Bucket) {
  const sorted = [...b.mins].sort((a, c) => a - c);
  const pct = rate(b.attempted, b.leads);
  return {
    leads: b.leads,
    attempted_within_30m: b.attempted,
    connected_within_30m: b.connected,
    never_phoned: b.neverCalled,
    self_booked_excluded: b.selfBooked,
    speed_to_lead_pct: pct,
    on_target: pct == null ? null : pct >= SPEED_TARGET_PCT,
    median_minutes_to_first_dial: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
  };
}

export async function GET(req: Request) {
  const secret = process.env.SHIFTS_API_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'SHIFTS_API_SECRET not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const today = londonToday();
  const from = isDate(url.searchParams.get('from')) ? url.searchParams.get('from')! : today;
  const to = isDate(url.searchParams.get('to')) ? url.searchParams.get('to')! : from;
  if (to < from) return Response.json({ ok: false, error: '`to` is before `from`' }, { status: 400 });
  const csrFilter = url.searchParams.get('csr')?.trim().toLowerCase() || null;
  const clientFilter = url.searchParams.get('client')?.trim() || null;

  if (csrFilter && !isTrackedSetter(csrFilter)) {
    return Response.json({ ok: true, from, to, csr: label(csrFilter), tracked: false, note: 'Speed to Lead is not tracked for this setter.' });
  }

  const all = setterClients(await getActiveClients());
  let measured = all.map(c => ({ client_id: c.client_id, csr: c.csr_key ?? null, name: c.client_name }));
  if (clientFilter) measured = measured.filter(c => c.client_id === clientFilter);
  // `csr` is applied per LEAD (responsible setter), not per client — so cover leads on a
  // colleague's client count for the setter who was on, matching the KPIs page.
  const range = { since: from, until: to, label: '' };

  const [leads, shifts] = await Promise.all([evaluateLeads(measured, range), getShifts(range)]);
  const nameOf = new Map(measured.map(c => [c.client_id, c.name]));
  const csrOf = new Map(measured.map(c => [c.client_id, c.csr]));

  const team = bucket();
  const bySetter = new Map<string, { b: Bucket; clients: Map<string, Bucket> }>();
  for (const l of leads) {
    // When filtering by setter, keep only leads they were responsible for (own + cover).
    if (csrFilter && l.responsible !== csrFilter) continue;
    add(team, l);
    const s = bySetter.get(l.responsible) ?? { b: bucket(), clients: new Map() };
    add(s.b, l);
    const cb = s.clients.get(l.client_id) ?? bucket();
    add(cb, l);
    s.clients.set(l.client_id, cb);
    bySetter.set(l.responsible, s);
  }
  // Setters who were on shift but had no leads still appear, with zeros.
  for (const s of shifts) if (!s.off && isTrackedSetter(s.csr) && (!csrFilter || s.csr === csrFilter) && !bySetter.has(s.csr)) bySetter.set(s.csr, { b: bucket(), clients: new Map() });

  const shiftsBy = new Map<string, { date: string; start: string; end: string }[]>();
  for (const s of shifts) { if (s.off || !isTrackedSetter(s.csr)) continue; const l = shiftsBy.get(s.csr) ?? []; l.push({ date: s.date, start: s.start, end: s.end }); shiftsBy.set(s.csr, l); }

  const setters = [...bySetter.entries()].map(([key, v]) => ({
    csr: label(key),
    key,
    ...out(v.b),
    shifts: shiftsBy.get(key) ?? [],
    clients: [...v.clients.entries()]
      .map(([id, b]) => ({ client_id: id, client: nameOf.get(id) ?? id, assigned_to: label(csrOf.get(id) ?? key), covered: (csrOf.get(id) ?? key) !== key, ...out(b) }))
      .sort((a, c) => c.leads - a.leads),
  })).sort((a, c) => c.leads - a.leads);

  return Response.json({
    ok: true,
    from, to,
    generated_at: new Date().toISOString(),
    target_pct: SPEED_TARGET_PCT,
    window_minutes: SPEED_TO_LEAD_MINUTES,
    not_tracked: UNTRACKED_SETTERS.map(label),
    team: out(team),
    setters,
    definition: `A new lead is a contact with a campaign REF tag and a phone number that arrived while its client's assigned setter (or cover) was on shift. Attempted = an outbound dial within ${SPEED_TO_LEAD_MINUTES} min, answered or not — the scored rate. Connected = a completed 60s+ call within ${SPEED_TO_LEAD_MINUTES} min. A lead that paid a deposit within ${SPEED_TO_LEAD_MINUTES} min before any dial self-booked and is excluded. Target ${SPEED_TARGET_PCT}%.`,
  });
}
