import { supabaseAdmin } from './supabase';
import { SPLIT_CONFIDENCE_TO_CALL, SPLIT_MIN_VIEWS_PER_VARIANT } from './optimisationConstants';

// Split-test reporting. Reads the pre-aggregated funnel_split_summary view (distinct
// visitors per funnel/variant/event) and turns it into a per-variant funnel plus a
// "can you call it yet?" confidence read, using a two-proportion z-test between the
// leading variant and its closest rival on the primary metric.
//
// Two time frames on purpose:
//   • the scoreboard (variants, confidence, winner) is ALL-TIME — a test is judged on its
//     whole sample, and slicing it to a week would flip leaders and un-call winners;
//   • `ranged` is the same first-party counts inside the dashboard's date range — what the
//     funnel's own stage numbers show, so they line up with the Meta/GHL figures beside them.

export type VariantStat = {
  key: string;
  label: string;
  views: number;
  optins: number;
  deposits: number;
  optinRate: number | null;   // optins / views
  depositRate: number | null; // deposits / optins — how well the offer converts the people who opted in
  isLeader: boolean;
};

export type SplitTest = {
  funnelId: string;
  funnelName: string;
  clientId: string;
  clientName: string;
  trackKey: string;
  status: 'off' | 'running' | 'decided';
  mode: 'measure' | 'test'; // 'measure' = single-bucket backup tracking; 'test' = 2+ variant A/B
  primaryMetric: 'deposit' | 'optin';
  variants: VariantStat[];
  totalViews: number;
  leaderKey: string | null;
  runnerUpKey: string | null;
  upliftPct: number | null;   // relative lift of leader vs runner-up on the primary metric
  confidencePct: number | null; // 0–100; null when not computable yet
  callable: boolean;          // confidence ≥ 95% AND both variants have enough traffic
  winnerKey: string | null;   // the declared winner (status 'decided'); collapses to simple flow
  decidedAt: string | null;   // when the test was called
  // First-party unique visitors per stage within the requested date range, all versions
  // combined. Each stage is counted on the day it happened, so a short range can hold an
  // opt-in whose view fell before it. Null when no range was asked for.
  // `byVariant` holds the same counts for each version on its own — a declared winner's
  // become the funnel's headline numbers.
  ranged: (RangeCounts & { byVariant: Record<string, RangeCounts> }) | null;
  firstEventAt: string | null; // when tracking started recording for this funnel
};

export type RangeCounts = { views: number; optins: number; deposits: number };

type SummaryRow = { funnel_key: string; variant: string; event: string; visitors: number };
type FunnelRow = {
  id: string; client_id: string; name: string; track_key: string | null;
  variants: unknown; split_status: string | null; winner_variant?: string | null;
  split_decided_at?: string | null;
};

// Standard normal CDF (Abramowitz & Stegun 7.1.26) — for the z-test p-value.
function normCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

// Two-sided confidence (%) that two conversion rates genuinely differ.
function confidence(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 === 0 || n2 === 0) return null;
  const p1 = x1 / n1, p2 = x2 / n2, p = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return null;
  const z = (p1 - p2) / se;
  const pValue = 2 * (1 - normCdf(Math.abs(z)));
  return Math.max(0, Math.min(100, (1 - pValue) * 100));
}

function normalizeVariants(raw: unknown): { key: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map(v => ({ key: String(v.key ?? '').trim(), label: String(v.label ?? '').trim() }))
    .filter(v => v.key);
}

// Distinct visitors per funnel and stage inside a date range, bots excluded. Counted here
// from the raw rows (a few thousand per month) rather than in SQL, so the range filter
// needs no extra database function.
type Ranged = RangeCounts & { byVariant: Record<string, RangeCounts> };
async function rangedCounts(keys: string[], range: { since: string; until: string }): Promise<Map<string, Ranged>> {
  type Sets = { view: Set<string>; optin: Set<string>; deposit: Set<string> };
  const sets = (): Sets => ({ view: new Set(), optin: new Set(), deposit: new Set() });
  const sizes = (s: Sets): RangeCounts => ({ views: s.view.size, optins: s.optin.size, deposits: s.deposit.size });
  const seen = new Map<string, { all: Sets; variants: Map<string, Sets> }>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('funnel_events')
      .select('funnel_key, variant, event, visitor_id')
      .in('funnel_key', keys)
      .eq('is_bot', false)
      .gte('created_at', `${range.since}T00:00:00Z`)
      .lte('created_at', `${range.until}T23:59:59.999Z`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const r of (data ?? []) as { funnel_key: string; variant: string; event: 'view' | 'optin' | 'deposit'; visitor_id: string }[]) {
      let s = seen.get(r.funnel_key);
      if (!s) { s = { all: sets(), variants: new Map() }; seen.set(r.funnel_key, s); }
      let v = s.variants.get(r.variant);
      if (!v) { v = sets(); s.variants.set(r.variant, v); }
      s.all[r.event]?.add(r.visitor_id);
      v[r.event]?.add(r.visitor_id);
    }
    if (!data || data.length < PAGE) break;
  }
  return new Map([...seen].map(([k, s]) => [k, {
    ...sizes(s.all),
    byVariant: Object.fromEntries([...s.variants].map(([variant, v]) => [variant, sizes(v)])),
  }]));
}

// When each funnel's tracking first recorded anything — ranges before it read as zero.
async function firstEvents(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(keys.map(async k => {
    const { data } = await supabaseAdmin.from('funnel_events').select('created_at').eq('funnel_key', k).order('created_at', { ascending: true }).limit(1);
    const at = data?.[0]?.created_at as string | undefined;
    if (at) out.set(k, at);
  }));
  return out;
}

export async function getSplitTests(range?: { since: string; until: string }): Promise<SplitTest[]> {
  // Try with winner_variant (migration 0012); fall back without it (0011 only). Before 0011
  // the columns don't exist at all — degrade to an empty scoreboard rather than crash.
  const base = 'id, client_id, name, track_key, variants, split_status';
  const q = (sel: string) => supabaseAdmin.from('funnels').select(sel).not('track_key', 'is', null);
  let res = await q(base + ', winner_variant, split_decided_at');
  if (res.error) res = await q(base + ', winner_variant');
  if (res.error) res = await q(base);
  if (res.error) {
    console.warn('getSplitTests: split-test columns not ready yet —', res.error.message);
    return [];
  }
  const funnels = (res.data ?? []) as unknown as FunnelRow[];
  if (funnels.length === 0) return [];

  const keys = funnels.map(f => f.track_key).filter((k): k is string => !!k);
  const { data: sumData, error: sErr } = await supabaseAdmin
    .from('funnel_split_summary')
    .select('funnel_key, variant, event, visitors')
    .in('funnel_key', keys);
  if (sErr) throw sErr;
  const summary = (sumData ?? []) as SummaryRow[];
  const [inRange, firstAt] = await Promise.all([
    range ? rangedCounts(keys, range) : Promise.resolve(null),
    firstEvents(keys),
  ]);

  // client_id → client_name for display.
  const { data: clientData } = await supabaseAdmin.from('clients').select('ghl_location_id, client_name');
  const clientName = new Map((clientData ?? []).map(c => [c.ghl_location_id as string, (c.client_name as string) ?? '']));

  // funnel_key → variant → {view, optin, deposit}
  const byKey = new Map<string, Map<string, { view: number; optin: number; deposit: number }>>();
  for (const r of summary) {
    if (!byKey.has(r.funnel_key)) byKey.set(r.funnel_key, new Map());
    const vm = byKey.get(r.funnel_key)!;
    if (!vm.has(r.variant)) vm.set(r.variant, { view: 0, optin: 0, deposit: 0 });
    const slot = vm.get(r.variant)!;
    if (r.event === 'view') slot.view = r.visitors;
    else if (r.event === 'optin') slot.optin = r.visitors;
    else if (r.event === 'deposit') slot.deposit = r.visitors;
  }

  // Don't call a winner before each side has a fair sample. Shared with the UI so the
  // scoreboard's "how far off is it?" read can never disagree with this judgement.
  const MIN_PER_VARIANT = SPLIT_MIN_VIEWS_PER_VARIANT;

  return funnels.map(f => {
    const key = f.track_key as string;
    const counts = byKey.get(key) ?? new Map();
    const declared = normalizeVariants(f.variants);
    // The funnel's CONFIGURED intent decides the layout, not leftover data: 2+ declared
    // versions = a real A/B test; anything else = single-bucket measure tracking. This
    // stops historical a/b visits from making a re-configured measure funnel look like a test.
    const isTest = declared.length >= 2;
    const mode: 'measure' | 'test' = isTest ? 'test' : 'measure';

    const anyDeposits = [...counts.values()].some(c => c.deposit > 0);
    const primaryMetric: 'deposit' | 'optin' = anyDeposits ? 'deposit' : 'optin';

    const mkVariant = (key: string, label: string, c: { view: number; optin: number; deposit: number }): VariantStat => ({
      key,
      label,
      views: c.view,
      optins: c.optin,
      deposits: c.deposit,
      optinRate: c.view ? c.optin / c.view : null,
      depositRate: c.optin ? c.deposit / c.optin : null,
      isLeader: false,
    });

    let variants: VariantStat[];
    if (isTest) {
      // Show exactly the declared versions; pull each one's counts from the data by key.
      variants = declared.map(d => mkVariant(d.key, d.label, counts.get(d.key) ?? { view: 0, optin: 0, deposit: 0 }));
    } else {
      // Measure: fold every recorded variant into one "all visitors" bucket.
      const agg = { view: 0, optin: 0, deposit: 0 };
      for (const c of counts.values()) { agg.view += c.view; agg.optin += c.optin; agg.deposit += c.deposit; }
      variants = [mkVariant(declared[0]?.key ?? 'default', declared[0]?.label ?? 'All visitors', agg)];
    }

    const rateOf = (v: VariantStat) => (primaryMetric === 'deposit' ? v.depositRate : v.optinRate) ?? -1;
    const convOf = (v: VariantStat) => (primaryMetric === 'deposit' ? v.deposits : v.optins);
    // The denominator the primary rate is measured over: opt-ins for the deposit rate,
    // views for the opt-in rate. The z-test and the ranking filter must use the same one.
    const trialsOf = (v: VariantStat) => (primaryMetric === 'deposit' ? v.optins : v.views);
    const totalViews = variants.reduce((s, v) => s + v.views, 0);

    // Rank by primary rate to find leader + closest rival.
    const ranked = [...variants].filter(v => trialsOf(v) > 0).sort((a, b) => rateOf(b) - rateOf(a));
    const leader = ranked[0] ?? null;
    const runnerUp = ranked[1] ?? null;
    if (leader) variants.find(v => v.key === leader.key)!.isLeader = true;

    let confidencePct: number | null = null;
    let upliftPct: number | null = null;
    let callable = false;
    if (leader && runnerUp) {
      confidencePct = confidence(convOf(leader), trialsOf(leader), convOf(runnerUp), trialsOf(runnerUp));
      const lr = rateOf(leader), rr = rateOf(runnerUp);
      upliftPct = rr > 0 ? ((lr - rr) / rr) * 100 : null;
      callable = confidencePct !== null && confidencePct >= SPLIT_CONFIDENCE_TO_CALL &&
        leader.views >= MIN_PER_VARIANT && runnerUp.views >= MIN_PER_VARIANT;
    }

    return {
      funnelId: f.id,
      funnelName: f.name ?? '',
      clientId: f.client_id,
      clientName: clientName.get(f.client_id) ?? '',
      trackKey: key,
      status: (f.split_status === 'running' || f.split_status === 'decided' ? f.split_status : 'off') as SplitTest['status'],
      mode,
      primaryMetric,
      variants,
      totalViews,
      leaderKey: leader?.key ?? null,
      runnerUpKey: runnerUp?.key ?? null,
      upliftPct,
      confidencePct,
      callable,
      winnerKey: isTest && declared.some(d => d.key === f.winner_variant) ? (f.winner_variant as string) : null,
      decidedAt: f.split_decided_at ? String(f.split_decided_at) : null,
      ranged: inRange ? (inRange.get(key) ?? { views: 0, optins: 0, deposits: 0, byVariant: {} }) : null,
      firstEventAt: firstAt.get(key) ?? null,
    };
  }).sort((a, b) => b.totalViews - a.totalViews);
}
