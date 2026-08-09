import { supabaseAdmin } from './supabase';
import { getFunnelMetrics, type DateRange, type FunnelMetrics } from './queries';
import type { AdminFunnel } from './funnelAdmin';
import {
  PRIMARY_METRICS as METRICS, VERDICTS as VERDICT_VALUES, isRateMetric,
  type PrimaryMetric, type Verdict,
} from './optimisationConstants';

// Optimisation cadence — the log of changes made to funnels, with the 7 days either side of
// each change measured from the same source the funnel page uses.
//
// Windows (both inclusive, both 7 days):
//   before = change_date − 7 … change_date − 1   (ends the day BEFORE the change, so the
//                                                 change day itself — usually a part-day of
//                                                 each — pollutes neither side)
//   after  = change_date + 1 … change_date + 7
//
// The after window is only meaningful once it has fully elapsed. Until then the entry is
// "measuring": the numbers so far ARE shown, but no verdict is suggested — judging a test on
// 2 of 7 days is how you talk yourself into a win that isn't there.
//
// One asymmetry matters while a window is still open. RATES (opt-in %, conversion %) stay
// comparable at any point, being already normalised per visitor. COUNTS (views, opt-ins,
// deposits) are not: 2 days of "after" against 7 days of "before" always looks like a
// collapse. So a partial delta is offered for rates only, and counts are shown as running
// totals with the elapsed day count stated next to them.

// Labels and the metric/verdict vocabularies live in a client-safe module — this one pulls
// in supabase, so anything a client component imports has to come from there instead.
export { PRIMARY_METRICS, METRIC_LABELS, VERDICTS, VERDICT_LABELS } from './optimisationConstants';
export type { PrimaryMetric, Verdict } from './optimisationConstants';

export type OptimisationRow = {
  id: string;
  funnelId: string;
  changeDate: string;          // yyyy-mm-dd
  title: string;
  detail: string | null;
  primaryMetric: PrimaryMetric;
  verdict: Verdict | null;
  verdictNote: string | null;
};

export type Snapshot = {
  lpViews: number | null;
  optins: number;
  deposits: number;
  optinRate: number | null;
  depositRate: number | null;
  /**
   * Deposits taken on the funnel's OWN deposit page, and their rate — the part of the
   * result the page itself earned. `deposits` blends in deposits a setter closed on the
   * phone, which move with call effort rather than with anything a funnel change did.
   *
   * Display only. `depositRate` stays the verdict metric so that logged entries keep the
   * meaning they were judged under; switching it would retroactively flip past win/loss.
   */
  depositsDirect: number;
  depositRateDirect: number | null;
};

export type OptimisationEntry = OptimisationRow & {
  funnelName: string;
  clientId: string;
  beforeRange: DateRange;
  afterRange: DateRange;
  before: Snapshot | null;
  after: Snapshot | null;
  /** After-window still running — `after` covers only the days elapsed so far. */
  measuring: boolean;
  daysRemaining: number;
  /** Days of the after-window that have actually elapsed (0-7). */
  afterDaysElapsed: number;
  /** Too few events behind the rate for the comparison to mean anything. */
  lowSample: boolean;
  /** Change in the primary metric, after vs before (percentage points for rates). */
  delta: number | null;
  /** What the numbers alone suggest. The stored verdict is what a human decided. */
  suggested: Verdict | null;
};

const WINDOW_DAYS = 7;
// Rates are compared in percentage POINTS and counts in percent — a 0.4pp move on a 3%
// opt-in rate is noise, and so is one extra deposit out of forty.
const RATE_POINT_THRESHOLD = 0.5;
const COUNT_PERCENT_THRESHOLD = 10;
// A rate computed off a handful of events is noise wearing a percentage sign: 1 deposit from
// 1 opt-in is "100%", and 3 opt-ins against 2 LP views is "150%". Both have been observed in
// real windows here. Below this many events in the denominator, the rate is shown but never
// turned into a delta or a verdict.
const MIN_RATE_DENOMINATOR = 10;

// What each rate is actually divided by.
const denominatorFor = (s: Snapshot, metric: PrimaryMetric): number | null => {
  if (metric === 'optin_rate') return s.lpViews;
  if (metric === 'deposit_rate') return s.optins;
  return null;
};

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const shift = (day: string, days: number): string => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
};

export function windowsFor(changeDate: string): { before: DateRange; after: DateRange } {
  return {
    before: { since: shift(changeDate, -WINDOW_DAYS), until: shift(changeDate, -1), label: '7 days before' },
    after: { since: shift(changeDate, 1), until: shift(changeDate, WINDOW_DAYS), label: '7 days after' },
  };
}

const snapshotOf = (m: FunnelMetrics): Snapshot => ({
  lpViews: m.lp_views,
  optins: m.optins,
  deposits: m.deposits,
  optinRate: m.optin_rate_pct,
  depositRate: m.deposit_rate_pct,
  depositsDirect: m.deposits_direct,
  depositRateDirect: m.deposit_rate_direct_pct,
});

const metricValue = (s: Snapshot | null, metric: PrimaryMetric): number | null => {
  if (!s) return null;
  switch (metric) {
    case 'optin_rate': return s.optinRate;
    case 'deposit_rate': return s.depositRate;
    case 'optins': return s.optins;
    case 'deposits': return s.deposits;
    case 'lp_views': return s.lpViews;
  }
};

/**
 * What the numbers alone say. Deliberately conservative: anything inside the noise band is
 * "flat", and a missing or zero baseline yields no suggestion at all rather than an
 * infinite-percent "win".
 */
function suggest(before: Snapshot | null, after: Snapshot | null, metric: PrimaryMetric): { delta: number | null; suggested: Verdict | null; lowSample: boolean } {
  const b = metricValue(before, metric);
  const a = metricValue(after, metric);
  if (b == null || a == null) return { delta: null, suggested: null, lowSample: false };

  if (isRateMetric(metric)) {
    // Both windows have to carry enough events for the comparison to mean anything.
    const db = before ? denominatorFor(before, metric) : null;
    const da = after ? denominatorFor(after, metric) : null;
    if ((db ?? 0) < MIN_RATE_DENOMINATOR || (da ?? 0) < MIN_RATE_DENOMINATOR) {
      return { delta: null, suggested: null, lowSample: true };
    }
    const delta = +(a - b).toFixed(1);                     // percentage points
    if (Math.abs(delta) < RATE_POINT_THRESHOLD) return { delta, suggested: 'flat', lowSample: false };
    return { delta, suggested: delta > 0 ? 'win' : 'loss', lowSample: false };
  }

  if (b === 0) return { delta: null, suggested: null, lowSample: true };  // no baseline at all
  const delta = +((100 * (a - b)) / b).toFixed(1);         // percent change
  if (Math.abs(delta) < COUNT_PERCENT_THRESHOLD) return { delta, suggested: 'flat', lowSample: false };
  return { delta, suggested: delta > 0 ? 'win' : 'loss', lowSample: false };
}

type DbRow = {
  id: string; funnel_id: string; change_date: string; title: string; detail: string | null;
  primary_metric: string; verdict: string | null; verdict_note: string | null;
};

const toRow = (r: DbRow): OptimisationRow => ({
  id: r.id,
  funnelId: r.funnel_id,
  changeDate: String(r.change_date),
  title: r.title,
  detail: r.detail,
  primaryMetric: (METRICS as readonly string[]).includes(r.primary_metric) ? r.primary_metric as PrimaryMetric : 'deposit_rate',
  verdict: (VERDICT_VALUES as readonly string[]).includes(r.verdict ?? '') ? r.verdict as Verdict : null,
  verdictNote: r.verdict_note,
});

/** Months (yyyy-mm-01) that have at least one logged optimisation, newest first. */
export async function getOptimisationMonths(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('funnel_optimisations')
    .select('change_date')
    .order('change_date', { ascending: false });
  const seen = new Set<string>();
  for (const r of (data ?? []) as { change_date: string }[]) seen.add(`${String(r.change_date).slice(0, 7)}-01`);
  return [...seen];
}

/**
 * Every optimisation logged in a month, with both snapshots computed.
 *
 * Each entry costs two getFunnelMetrics calls, so this is scoped to one month rather than
 * the whole history — a month is a handful of entries, a year is not.
 */
export async function getOptimisations(month: string | null, funnels: AdminFunnel[]): Promise<OptimisationEntry[]> {
  if (!month) return [];
  const ym = month.slice(0, 7);
  const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

  const { data } = await supabaseAdmin
    .from('funnel_optimisations')
    .select('id, funnel_id, change_date, title, detail, primary_metric, verdict, verdict_note')
    .gte('change_date', `${ym}-01`)
    .lte('change_date', `${ym}-${String(lastDay).padStart(2, '0')}`)
    .order('change_date', { ascending: false });

  const rows = ((data ?? []) as DbRow[]).map(toRow);
  const byId = new Map(funnels.map(f => [f.id, f]));
  const today = iso(new Date());

  return Promise.all(rows.map(async (row): Promise<OptimisationEntry> => {
    const funnel = byId.get(row.funnelId) ?? null;
    const { before, after } = windowsFor(row.changeDate);
    const measuring = after.until >= today;
    // While measuring, only ask for the days that have actually happened.
    const afterSoFar: DateRange = measuring ? { ...after, until: today < after.since ? after.since : today } : after;

    let beforeSnap: Snapshot | null = null;
    let afterSnap: Snapshot | null = null;
    if (funnel) {
      const [b, a] = await Promise.all([
        getFunnelMetrics(funnel, before),
        // Nothing to measure yet if the after window hasn't started.
        today < after.since ? Promise.resolve(null) : getFunnelMetrics(funnel, afterSoFar),
      ]);
      beforeSnap = snapshotOf(b);
      afterSnap = a ? snapshotOf(a) : null;
    }

    // A partial after-window is shown but never judged. Rates stay comparable mid-window so
    // their delta is kept as a running read; count deltas are withheld, because a short
    // window guarantees a false negative.
    const full = suggest(beforeSnap, afterSnap, row.primaryMetric);
    const { delta, suggested } = measuring
      ? { delta: isRateMetric(row.primaryMetric) ? full.delta : null, suggested: null }
      : full;

    const daysRemaining = measuring
      ? Math.max(0, Math.round((Date.parse(`${after.until}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000))
      : 0;
    const afterDaysElapsed = Math.max(0, Math.min(WINDOW_DAYS, WINDOW_DAYS - daysRemaining));

    return {
      ...row,
      funnelName: funnel?.name ?? 'Deleted funnel',
      clientId: funnel?.client_id ?? '',
      beforeRange: before,
      afterRange: after,
      before: beforeSnap,
      after: afterSnap,
      measuring,
      daysRemaining,
      afterDaysElapsed,
      lowSample: full.lowSample,
      delta,
      suggested,
    };
  }));
}
