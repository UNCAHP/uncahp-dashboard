import { supabaseAdmin } from './supabase';

// Split-test reporting. Reads the pre-aggregated funnel_split_summary view (distinct
// visitors per funnel/variant/event) and turns it into a per-variant funnel plus a
// "can you call it yet?" confidence read, using a two-proportion z-test between the
// leading variant and its closest rival on the primary metric.

export type VariantStat = {
  key: string;
  label: string;
  views: number;
  optins: number;
  deposits: number;
  optinRate: number | null;   // optins / views
  depositRate: number | null; // deposits / views
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
};

type SummaryRow = { funnel_key: string; variant: string; event: string; visitors: number };
type FunnelRow = {
  id: string; client_id: string; name: string; track_key: string | null;
  variants: unknown; split_status: string | null; winner_variant?: string | null;
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

export async function getSplitTests(): Promise<SplitTest[]> {
  // Try with winner_variant (migration 0012); fall back without it (0011 only). Before 0011
  // the columns don't exist at all — degrade to an empty scoreboard rather than crash.
  const base = 'id, client_id, name, track_key, variants, split_status';
  const q = (sel: string) => supabaseAdmin.from('funnels').select(sel).not('track_key', 'is', null);
  let res = await q(base + ', winner_variant');
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

  const MIN_PER_VARIANT = 30; // don't call a winner before each side has a fair sample

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
      depositRate: c.view ? c.deposit / c.view : null,
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
    const totalViews = variants.reduce((s, v) => s + v.views, 0);

    // Rank by primary rate to find leader + closest rival.
    const ranked = [...variants].filter(v => v.views > 0).sort((a, b) => rateOf(b) - rateOf(a));
    const leader = ranked[0] ?? null;
    const runnerUp = ranked[1] ?? null;
    if (leader) variants.find(v => v.key === leader.key)!.isLeader = true;

    let confidencePct: number | null = null;
    let upliftPct: number | null = null;
    let callable = false;
    if (leader && runnerUp) {
      confidencePct = confidence(convOf(leader), leader.views, convOf(runnerUp), runnerUp.views);
      const lr = rateOf(leader), rr = rateOf(runnerUp);
      upliftPct = rr > 0 ? ((lr - rr) / rr) * 100 : null;
      callable = confidencePct !== null && confidencePct >= 95 &&
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
    };
  }).sort((a, b) => b.totalViews - a.totalViews);
}
