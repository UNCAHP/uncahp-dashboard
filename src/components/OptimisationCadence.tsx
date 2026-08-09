'use client';

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Pencil, Trash2, Loader2, TrendingUp, TrendingDown, Minus, Undo2, Timer, Check, SplitSquareHorizontal, ChevronRight, Trophy } from 'lucide-react';
import type { AdminFunnel } from '@/lib/funnelAdmin';
import type { SplitTest, VariantStat } from '@/lib/splitTests';
import type { ClientOption, FunnelMetrics } from '@/lib/queries';
// Values come from the client-safe constants module; lib/optimisations imports supabase and
// would blow up the moment this component is evaluated in the browser.
import { METRIC_LABELS, PRIMARY_METRICS, SPLIT_CONFIDENCE_TO_CALL, SPLIT_MIN_VIEWS_PER_VARIANT, VERDICTS, VERDICT_LABELS, isRateMetric, type PrimaryMetric, type Verdict } from '@/lib/optimisationConstants';
import type { OptimisationEntry, Snapshot } from '@/lib/optimisations';
import { saveOptimisationAction, setVerdictAction, deleteOptimisationAction, type ActionState } from '@/app/actions/optimisations';
import { DateField } from '@/components/DateField';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmtMonth = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? '?'} ${y}`;
};
const fmtMonthLong = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  return `${LONG_MONTHS[Number(m) - 1] ?? '?'} ${y}`;
};
/** "1 view", "2 views" — small counts are common on a young split test, so they read wrong often. */
const plural = (n: number, word: string) => `${formatNumber(n)} ${word}${n === 1 ? '' : 's'}`;
const dayOf = (iso: string) => new Date(`${iso}T12:00:00Z`);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtShort = (iso: string): string => {
  const d = dayOf(iso);
  return `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
};

// Verdicts drive the page's only colour decisions, so they're declared once.
const VERDICT_TONE: Record<Verdict, { text: string; bg: string; dot: string; ring: string; icon: typeof TrendingUp }> = {
  win:         { text: 'text-green',    bg: 'bg-green/10',  dot: 'bg-green',    ring: 'ring-green/40',  icon: TrendingUp },
  loss:        { text: 'text-red',      bg: 'bg-red/10',    dot: 'bg-red',      ring: 'ring-red/40',    icon: TrendingDown },
  flat:        { text: 'text-yellow',   bg: 'bg-yellow/10', dot: 'bg-yellow',   ring: 'ring-yellow/40', icon: Minus },
  rolled_back: { text: 'text-fg-muted', bg: 'bg-white/5',   dot: 'bg-fg-muted', ring: 'ring-white/20',  icon: Undo2 },
};

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

export function OptimisationCadence({ entries, funnels, clients, months, month, since, until, splitTests, metricsList }: {
  entries: OptimisationEntry[];
  funnels: AdminFunnel[];
  clients: ClientOption[];
  months: string[];
  month: string | null;
  since: string;
  until: string;
  splitTests: SplitTest[];
  /** Funnel-level GHL/Meta metrics for the selected range — the source of the deposit figures. */
  metricsList: FunnelMetrics[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<OptimisationEntry | 'new' | null>(null);
  const onSaved = useCallback(() => { setEditing(null); router.refresh(); }, [router]);

  const goMonth = (m: string) => {
    const p = new URLSearchParams({ view: 'funnel', ftab: 'cadence', month: m, since, until });
    router.push(`/?${p.toString()}`);
  };

  // A split test is an optimisation with better evidence than any before/after window can
  // give: both versions ran at the same time against randomly split traffic, so budget
  // changes, seasonality and day-of-week cancel out rather than confound the result. Running
  // tests have no date to sort by, so they sit in their own band; a CALLED test is dated and
  // belongs on the timeline with the other changes.
  const running = splitTests.filter(t => t.mode === 'test' && t.status === 'running');
  const decidedThisMonth = splitTests.filter(t =>
    t.mode === 'test' && t.status === 'decided' && t.decidedAt && month &&
    String(t.decidedAt).slice(0, 7) === month.slice(0, 7),
  );

  type Item = { kind: 'log'; entry: OptimisationEntry; date: string } | { kind: 'split'; test: SplitTest; date: string };
  const items: Item[] = [
    ...entries.map((entry): Item => ({ kind: 'log', entry, date: entry.changeDate })),
    ...decidedThisMonth.map((test): Item => ({ kind: 'split', test, date: String(test.decidedAt).slice(0, 10) })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  // Deposits never come from the split-test beacons here. A beacon only fires if the payer
  // comes back to the thank-you page, so it under-counts; the funnel's GHL record is the
  // money actually taken. Direct only — a deposit a setter closed on the phone belongs to
  // the call, not to the page being tested.
  const metricsById = useMemo(() => new Map(metricsList.map(m => [m.funnel_id, m])), [metricsList]);

  const wins = entries.filter(e => e.verdict === 'win').length;
  const losses = entries.filter(e => e.verdict === 'loss').length;
  const awaiting = entries.filter(e => !e.verdict && !e.measuring).length;
  const measuring = entries.filter(e => e.measuring).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {months.length > 0 && (
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-0.5">
            {months.map(m => (
              <button key={m} onClick={() => goMonth(m)}
                className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', month === m ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
                {fmtMonth(m)}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setEditing('new')}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft"
        >
          <Plus size={16} /> Log optimisation
        </button>
      </div>

      <MonthRhythm month={month} entries={entries} wins={wins} losses={losses} awaiting={awaiting} measuring={measuring} />

      {running.length > 0 && (
        <InFlight tests={running} since={since} until={until} metricsById={metricsById} />
      )}

      {items.length === 0 ? (
        <EmptyMonth month={month} onLog={() => setEditing('new')} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          {items.map((item, i) => item.kind === 'log' ? (
            <EntryRow
              key={item.entry.id}
              entry={item.entry}
              first={i === 0}
              last={i === items.length - 1}
              clientName={clients.find(c => c.client_id === item.entry.clientId)?.client_name ?? ''}
              onEdit={() => setEditing(item.entry)}
            />
          ) : (
            <DecidedTestRow
              key={`split-${item.test.funnelId}`}
              test={item.test}
              first={i === 0}
              last={i === items.length - 1}
              since={since}
              until={until}
              metrics={metricsById.get(item.test.funnelId) ?? null}
            />
          ))}
        </div>
      )}

      {editing && (
        <EntryModal
          entry={editing === 'new' ? null : editing}
          funnels={funnels}
          clients={clients}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/**
 * The month at a glance: every day a tick, changes marked by their outcome.
 *
 * This is the page's namesake — cadence asks "how often do we ship, and does it land" — and
 * no stack of cards answers that. Strip the copy out and the shape still says: this many
 * changes, spread like this, going this well.
 */
function MonthRhythm({ month, entries, wins, losses, awaiting, measuring }: {
  month: string | null; entries: OptimisationEntry[]; wins: number; losses: number; awaiting: number; measuring: number;
}) {
  const days = useMemo(() => {
    if (!month) return [];
    const [y, m] = month.split('-').map(Number);
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const byDay = new Map<number, OptimisationEntry[]>();
    for (const e of entries) {
      const d = dayOf(e.changeDate).getUTCDate();
      byDay.set(d, [...(byDay.get(d) ?? []), e]);
    }
    return Array.from({ length: count }, (_, i) => ({ day: i + 1, hits: byDay.get(i + 1) ?? [] }));
  }, [month, entries]);

  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-fg-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-pink" />
            Optimisation cadence
          </div>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-fg">{fmtMonthLong(month)}</h2>
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Tally value={entries.length} label={entries.length === 1 ? 'change shipped' : 'changes shipped'} accent />
          {wins > 0 && <Tally value={wins} label={wins === 1 ? 'win' : 'wins'} tone="text-green" />}
          {losses > 0 && <Tally value={losses} label={losses === 1 ? 'loss' : 'losses'} tone="text-red" />}
          {measuring > 0 && <Tally value={measuring} label="still measuring" tone="text-fg-muted" />}
          {awaiting > 0 && <Tally value={awaiting} label={awaiting === 1 ? 'needs your verdict' : 'need your verdict'} tone="text-pink" />}
        </div>
      </div>

      {days.length > 0 && (
        <div className="mt-6 flex items-end gap-[3px] border-t border-border pt-4">
          {days.map(({ day, hits }) => {
            const top = hits[0];
            const tone = top?.verdict ? VERDICT_TONE[top.verdict].dot : top ? 'bg-pink' : 'bg-white/[0.07]';
            return (
              <div
                key={day}
                title={hits.length ? `${day} ${fmtMonth(month)} — ${hits.map(h => h.title).join(' · ')}` : undefined}
                className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
              >
                <span className={cn('w-1 rounded-full transition-colors sm:w-1.5', tone, hits.length ? 'h-7' : 'h-1.5')} />
                <span className={cn('font-mono text-[9px] leading-none tabular-nums', hits.length ? 'text-fg-muted' : 'text-fg-dim/60')}>
                  {day === 1 || day % 5 === 0 ? day : ' '}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Tests running right now. They carry no date — an experiment isn't an event — so they sit
 * above the timeline rather than in it, which is also where you want them during a monthly
 * review: this is what's still in flight and can't be judged yet.
 */
function InFlight({ tests, since, until, metricsById }: {
  tests: SplitTest[]; since: string; until: string; metricsById: Map<string, FunnelMetrics>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <SplitSquareHorizontal size={13} className="text-pink" />
        <span className="text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
          Split tests in flight
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-fg-dim">{tests.length}</span>
      </div>
      {tests.map(t => (
        <InFlightTest key={t.funnelId} test={t} since={since} until={until} metrics={metricsById.get(t.funnelId) ?? null} />
      ))}
    </div>
  );
}

/**
 * One running test: the full funnel for each version side by side, not just the traffic split.
 *
 * Views alone can't be read — a version "ahead" on visitors is ahead on nothing, and the rate
 * that decides the test is invisible without the opt-ins under it. So each version shows its
 * primary rate as a bar (compared on one scale, so the gap is seen before it's read) with the
 * raw counts that produced it. Deposits ride along even while opt-in rate is the primary
 * metric, because a version that wins opt-ins and loses deposits is a loss.
 */
function InFlightTest({ test: t, since, until, metrics }: {
  test: SplitTest; since: string; until: string; metrics: FunnelMetrics | null;
}) {
  const isDeposit = t.primaryMetric === 'deposit';
  const rateOf = (v: VariantStat) => (isDeposit ? v.depositRate : v.optinRate);
  // Bars share one scale so two versions are compared, not each drawn against itself.
  const scale = Math.max(...t.variants.map(v => (rateOf(v) ?? 0) * 100), 1);
  const shortOn = t.variants.filter(v => v.views < SPLIT_MIN_VIEWS_PER_VARIANT);
  const anyTrackedDeposits = t.variants.some(v => v.deposits > 0);

  return (
    <a
      href={`/?view=funnel&funnel=${encodeURIComponent(t.funnelId)}&since=${since}&until=${until}`}
      className="block border-b border-border/50 px-5 py-4 transition-colors last:border-0 hover:bg-white/[0.02]"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">{t.funnelName}</div>
          <div className="mt-0.5 text-[11px] text-fg-dim">
            {t.clientName} · comparing {isDeposit ? 'conversion rate' : 'opt-in rate'}
          </div>
        </div>

        {/* Confidence is the only honest headline for a running test: a leader at 60% is
            not a result, and showing an uplift without it invites calling it too early. */}
        <div className="flex shrink-0 items-center gap-1.5 text-right">
          <div>
            {t.confidencePct == null ? (
              <span className="text-[11px] text-fg-dim">too early to read</span>
            ) : (
              <>
                <div className={cn(
                  'font-mono text-sm font-bold tabular-nums',
                  t.callable ? 'text-green' : 'text-fg-muted',
                )}>
                  {t.confidencePct.toFixed(0)}%
                </div>
                <div className="text-[9px] uppercase tracking-wider text-fg-dim">
                  {t.callable ? 'ready to call' : 'confidence'}
                </div>
              </>
            )}
          </div>
          <ChevronRight size={14} className="text-fg-dim" />
        </div>
      </div>

      <div className="mt-3 space-y-2.5">
        {t.variants.map(v => {
          const leading = v.key === t.leaderKey && t.totalViews > 0;
          return (
            <div key={v.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={cn(
                'flex w-full shrink-0 items-center gap-1.5 text-[11px] sm:w-[9rem]',
                leading ? 'text-fg' : 'text-fg-muted',
              )}>
                <span className="truncate">{v.label}</span>
                {leading && (
                  <span className="shrink-0 rounded bg-pink/10 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-pink">
                    Ahead
                  </span>
                )}
              </span>

              <span className="h-2.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <span
                  className={cn('block h-full rounded-full', leading ? 'bg-pink' : 'bg-white/25')}
                  style={{ width: rateOf(v) == null ? '0%' : `${Math.max(2, Math.round((100 * (rateOf(v)! * 100)) / scale))}%` }}
                />
              </span>

              <span className={cn(
                'w-14 shrink-0 text-right font-mono text-sm font-bold tabular-nums',
                leading ? 'text-pink' : 'text-fg-muted',
              )}>
                {rateOf(v) == null ? '—' : formatPercent(rateOf(v)! * 100)}
              </span>

              {/* The counts behind the rate — a percentage off 2 visitors is not a rate. */}
              <span className="w-full shrink-0 font-mono text-[10px] tabular-nums text-fg-dim sm:w-[13rem] sm:text-right">
                {plural(v.views, 'view')} · {plural(v.optins, 'opt-in')}
                {/* Beacon deposits are shown only once there are any. A "0 deposits" on every
                    row reads as a measured zero, when the real deposit figure is the funnel's
                    GHL one below. */}
                {anyTrackedDeposits && ` · ${plural(v.deposits, 'tracked deposit')}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* The money, from the funnel's own record rather than the versions'. GHL knows a
          deposit was paid but not which version the payer saw, so this is the funnel as a
          whole — said plainly, because a per-version deposit rate is what a reader will
          assume otherwise. Direct only: setter-closed deposits belong to the call. */}
      {metrics && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border/60 pt-3 text-[11px]">
          <span className="uppercase tracking-wider text-fg-dim">Funnel deposit rate · direct</span>
          <span className="font-mono text-sm font-bold tabular-nums text-fg">
            {formatPercent(metrics.deposit_rate_direct_pct)}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-fg-dim">
            {plural(metrics.deposits_direct, 'deposit')} from {plural(metrics.optins, 'opt-in')}
          </span>
          <span className="text-fg-dim/70">
            · whole funnel, not split by version · {fmtShort(since)}–{fmtShort(until)}
          </span>
        </div>
      )}

      {/* Why it isn't callable yet, stated as the thing that has to happen next. */}
      {!t.callable && (
        <div className="mt-3 text-[11px] text-fg-dim">
          {shortOn.length > 0
            ? `Needs ${SPLIT_MIN_VIEWS_PER_VARIANT} views per version before it can be called — ${shortOn
                .map(v => `${v.label} is on ${formatNumber(v.views)}`).join(', ')}.`
            : `Both versions have the traffic; waiting for ${SPLIT_CONFIDENCE_TO_CALL}% confidence.`}
        </div>
      )}
    </a>
  );
}

/**
 * A called split test, on the timeline alongside the manual changes.
 *
 * It deliberately shows the TEST's own result rather than a 7-day before/after comparison.
 * Both versions ran simultaneously against split traffic, so the uplift is measured with
 * confounds cancelled out — re-deriving a verdict from consecutive weeks would replace
 * strong evidence with weak.
 */
function DecidedTestRow({ test, first, last, since, until, metrics }: {
  test: SplitTest; first: boolean; last: boolean; since: string; until: string;
  metrics: FunnelMetrics | null;
}) {
  const d = dayOf(String(test.decidedAt).slice(0, 10));
  const winner = test.variants.find(v => v.key === test.winnerKey) ?? null;
  const others = test.variants.filter(v => v.key !== test.winnerKey);
  // SplitTest rates are fractions; Bar (like every other metric on this page) is in percentage
  // points. Feeding it 0.58 renders "0.6%" for a 58% opt-in rate.
  const rateOf = (v: VariantStat) => {
    const r = test.primaryMetric === 'deposit' ? v.depositRate : v.optinRate;
    return r == null ? null : r * 100;
  };

  // Calling a test is not the same as the winner having beaten anything. A test called with
  // no measurable gap — or on a hunch below the 95% bar — is a FLAT result: you picked a
  // version to keep, but the data didn't separate them. Stamping every decision "Win" would
  // make the month's tally meaningless.
  const conclusive = test.upliftPct != null && test.confidencePct != null && test.confidencePct >= 95;
  const tone = conclusive ? VERDICT_TONE.win : VERDICT_TONE.flat;
  const ToneIcon = tone.icon;

  return (
    <div className={cn('relative flex gap-4 px-4 py-5 sm:gap-6 sm:px-5', !last && 'border-b border-border')}>
      <div className="relative flex w-9 shrink-0 flex-col items-center sm:w-11">
        <span aria-hidden className={cn('absolute left-1/2 w-px -translate-x-1/2 bg-border', first ? 'top-3' : '-top-5', last ? 'h-3' : '-bottom-5')} />
        <span className={cn('relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface', tone.dot)} />
        <div className="mt-2 text-center">
          <div className="font-mono text-lg font-extrabold leading-none tabular-nums text-fg">{d.getUTCDate()}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-fg-dim">{WEEKDAYS[d.getUTCDay()]}</div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold leading-snug text-fg">
              Called the split test
              <span className="inline-flex items-center gap-1 rounded-md bg-green/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green ring-1 ring-green/40">
                <Trophy size={10} /> {winner?.label ?? test.winnerKey ?? 'winner'} won
              </span>
            </h3>
            <div className="mt-0.5 truncate text-[11px] text-fg-dim">
              {test.clientName} · {test.funnelName} · decided on {test.primaryMetric === 'deposit' ? 'conversion rate' : 'opt-in rate'}
            </div>
          </div>
          <a
            href={`/?view=funnel&funnel=${encodeURIComponent(test.funnelId)}&since=${since}&until=${until}`}
            className="shrink-0 text-[11px] font-medium text-fg-muted transition-colors hover:text-pink"
          >
            Open test →
          </a>
        </div>

        <div className="mt-4 rounded-xl bg-black/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="min-w-[15rem] flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                {test.primaryMetric === 'deposit' ? 'Conversion rate' : 'Opt-in rate'} by version
              </div>
              <div className="mt-2.5 space-y-2">
                {test.variants.map(v => (
                  <Bar
                    key={v.key}
                    label={`${v.label} · ${formatNumber(v.views)} visitors`}
                    value={rateOf(v)}
                    scale={Math.max(1, ...test.variants.map(x => rateOf(x) ?? 0))}
                    rate
                    accent={v.key === test.winnerKey}
                  />
                ))}
              </div>
            </div>

            <div className="w-full text-left sm:w-auto sm:text-right">
              {test.upliftPct != null && others.length > 0 ? (
                <>
                  <div className={cn('font-mono text-4xl font-extrabold leading-none tracking-tight tabular-nums', tone.text)}>
                    +{Math.abs(test.upliftPct).toFixed(1)}<span className="text-xl">%</span>
                  </div>
                  <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                    over {others[0].label}
                    {test.confidencePct != null && ` · ${test.confidencePct.toFixed(0)}% confidence`}
                  </div>
                </>
              ) : (
                <div className="text-[11px] leading-relaxed text-fg-dim sm:max-w-[13rem]">
                  Called without a measurable gap between the versions.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* What the funnel actually banked over the period, from GHL — the test measured the
            page, this measures the money. Direct only; setter-closed deposits belong to the call. */}
        {metrics && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="uppercase tracking-wider text-fg-dim">Funnel deposit rate · direct</span>
            <span className="font-mono text-sm font-bold tabular-nums text-fg">
              {formatPercent(metrics.deposit_rate_direct_pct)}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-fg-dim">
              {plural(metrics.deposits_direct, 'deposit')} from {plural(metrics.optins, 'opt-in')}
            </span>
            <span className="text-fg-dim/70">
            · whole funnel, not split by version · {fmtShort(since)}–{fmtShort(until)}
          </span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ring-1', tone.bg, tone.text, tone.ring)}>
            <ToneIcon size={12} /> {conclusive ? 'Win' : 'Flat'}
          </span>
          <span className="text-[11px] text-fg-dim">
            {conclusive
              ? 'Measured by the test itself — both versions ran at once, so nothing else that week can explain it.'
              : 'Called, but the versions never separated far enough to call it a win.'}
          </span>
        </div>
      </div>
    </div>
  );
}

function Tally({ value, label, tone, accent }: { value: number; label: string; tone?: string; accent?: boolean }) {
  return (
    <div className="text-right">
      <div className={cn('font-mono text-3xl font-extrabold leading-none tracking-tight tabular-nums', accent ? 'text-pink' : tone ?? 'text-fg')}>
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-fg-dim">{label}</div>
    </div>
  );
}

function EntryRow({ entry, first, last, clientName, onEdit }: {
  entry: OptimisationEntry; first: boolean; last: boolean; clientName: string; onEdit: () => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const d = dayOf(entry.changeDate);
  const tone = entry.verdict ? VERDICT_TONE[entry.verdict] : null;

  const setVerdict = (v: Verdict | null) => start(async () => {
    await setVerdictAction(entry.id, v);
    router.refresh();
  });
  const remove = () => start(async () => {
    if (!confirm(`Delete "${entry.title}" from the log? This can't be undone.`)) return;
    await deleteOptimisationAction(entry.id);
    router.refresh();
  });

  return (
    <div className={cn('relative flex gap-4 px-4 py-5 sm:gap-6 sm:px-5', !last && 'border-b border-border')}>
      {/* The spine: one thread the whole month hangs from, so the log reads as a sequence
          rather than a pile. The node carries the outcome colour. */}
      <div className="relative flex w-9 shrink-0 flex-col items-center sm:w-11">
        <span
          aria-hidden
          className={cn(
            'absolute left-1/2 w-px -translate-x-1/2 bg-border',
            first ? 'top-3' : '-top-5',
            last ? 'h-3' : '-bottom-5',
          )}
        />
        <span className={cn(
          'relative z-10 mt-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface',
          tone ? tone.dot : entry.measuring ? 'bg-fg-dim' : 'bg-pink',
        )} />
        <div className="mt-2 text-center">
          <div className="font-mono text-lg font-extrabold leading-none tabular-nums text-fg">{d.getUTCDate()}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-fg-dim">{WEEKDAYS[d.getUTCDay()]}</div>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <h3 className="text-base font-semibold leading-snug text-fg">{entry.title}</h3>
            <div className="mt-0.5 truncate text-[11px] text-fg-dim">
              {clientName ? `${clientName} · ` : ''}{entry.funnelName}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={onEdit} title="Edit entry" aria-label="Edit entry" className="rounded-md p-1.5 text-fg-dim transition-colors hover:bg-white/5 hover:text-fg">
              <Pencil size={13} />
            </button>
            <button onClick={remove} disabled={pending} title="Delete entry" aria-label="Delete entry" className="rounded-md p-1.5 text-fg-dim transition-colors hover:bg-red/10 hover:text-red disabled:opacity-50">
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          </div>
        </div>

        {entry.detail && <p className="mt-2 max-w-2xl text-xs leading-relaxed text-fg-muted">{entry.detail}</p>}

        <div className="mt-4 space-y-2">
          {entry.measuring && <Measuring entry={entry} />}
          <Evidence entry={entry} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <VerdictControl entry={entry} pending={pending} onSet={setVerdict} />
          {entry.verdictNote && <span className="text-[11px] text-fg-dim">“{entry.verdictNote}”</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * The evidence: the metric the change was meant to move, drawn as two bars on one shared
 * scale so the move is seen before it's read, with the delta at display size.
 */
function Evidence({ entry }: { entry: OptimisationEntry }) {
  const { before, after, primaryMetric: metric } = entry;
  const b = metricValue(before, metric);
  const a = metricValue(after, metric);
  const scale = Math.max(b ?? 0, a ?? 0, 1);
  const rate = isRateMetric(metric);
  const tone = entry.suggested ? VERDICT_TONE[entry.suggested] : null;
  const Icon = tone?.icon;
  const partial = entry.measuring;
  const elapsed = entry.afterDaysElapsed;
  // After-window label tells you exactly how much of it you're looking at.
  const afterLabel = partial
    ? `${fmtShort(entry.afterRange.since)}–${fmtShort(entry.afterRange.since === entry.afterRange.until ? entry.afterRange.until : todayISO())} · ${elapsed}/7d`
    : `${fmtShort(entry.afterRange.since)}–${fmtShort(entry.afterRange.until)}`;

  return (
    <div className="rounded-xl bg-black/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-[15rem] flex-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{METRIC_LABELS[metric]}</div>
          <div className="mt-2.5 space-y-2">
            <Bar label={`${fmtShort(entry.beforeRange.since)}–${fmtShort(entry.beforeRange.until)}`} value={b} scale={scale} rate={rate} />
            <Bar label={afterLabel} value={a} scale={scale} rate={rate} accent partial={partial} />
          </div>
        </div>

        {entry.delta != null ? (
          <div className="w-full text-left sm:w-auto sm:text-right">
            <div className={cn(
              'font-mono text-4xl font-extrabold leading-none tracking-tight tabular-nums',
              partial ? 'text-fg-muted' : tone?.text ?? 'text-fg',
            )}>
              {entry.delta > 0 ? '+' : ''}{entry.delta}<span className="text-xl">{rate ? 'pp' : '%'}</span>
            </div>
            {partial ? (
              <div className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
                running · {elapsed} of 7 days
              </div>
            ) : entry.suggested && Icon ? (
              <div className={cn('mt-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider', tone.text)}>
                <Icon size={11} /> reads as {VERDICT_LABELS[entry.suggested].toLowerCase()}
              </div>
            ) : null}
          </div>
        ) : entry.lowSample ? (
          // Never silently show a blank here — the reason a rate can't be read is itself
          // the useful signal ("this funnel had almost no traffic that week").
          <div className="w-full text-[11px] leading-relaxed text-fg-dim sm:max-w-[13rem] sm:text-right">
            {`Too few ${entry.primaryMetric === 'optin_rate' ? 'LP views' : 'opt-ins'} behind this rate to compare — a percentage off a handful of events isn’t a result.`}
          </div>
        ) : partial ? (
          // Counts can't be compared against a part-elapsed window without reading as a
          // collapse, so the totals stand on their own until day 7.
          <div className="w-full text-[11px] leading-relaxed text-fg-dim sm:max-w-[13rem] sm:text-right">
            {METRIC_LABELS[metric]} is a running total over {elapsed} of 7 days — not yet
            comparable with the full week before.
          </div>
        ) : (
          <div className="w-full text-[11px] leading-relaxed text-fg-dim sm:max-w-[12rem] sm:text-right">
            Not enough data either side to compare {METRIC_LABELS[metric].toLowerCase()}.
          </div>
        )}
      </div>

      <SecondaryRow before={before} after={after} metric={metric} partial={partial} elapsed={elapsed} />
    </div>
  );
}

function Bar({ label, value, scale, rate, accent, partial }: {
  label: string; value: number | null; scale: number; rate: boolean; accent?: boolean; partial?: boolean;
}) {
  const pct = value == null ? 0 : Math.max(2, Math.round((100 * value) / scale));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-full shrink-0 font-mono text-[10px] tabular-nums text-fg-dim sm:w-[7rem] sm:text-right">{label}</span>
      <span className="h-2.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <span
          className={cn('block h-full rounded-full', accent ? 'bg-pink' : 'bg-white/25', partial && 'opacity-70')}
          style={{ width: value == null ? '0%' : `${pct}%` }}
        />
      </span>
      <span className={cn('w-14 shrink-0 text-right font-mono text-sm font-bold tabular-nums sm:w-16', accent ? 'text-pink' : 'text-fg-muted')}>
        {value == null ? '—' : rate ? `${value}%` : formatNumber(value)}
      </span>
    </div>
  );
}

/** The rest of the funnel, so a "win" that quietly cost volume can't hide behind one metric. */
function SecondaryRow({ before, after, metric, partial, elapsed }: {
  before: Snapshot | null; after: Snapshot | null; metric: PrimaryMetric; partial: boolean; elapsed: number;
}) {
  if (!before && !after) return null;

  // `key: null` = never the primary metric, so never filtered out. The direct deposit rate
  // is shown on every entry precisely because it is not what the verdict is computed from:
  // it's the check that a "win" on opt-ins actually reached the deposit page.
  const cells: Array<{ key: PrimaryMetric | null; label: string; fmt: (s: Snapshot) => string }> = [
    { key: 'lp_views', label: 'LP views', fmt: s => (s.lpViews == null ? '—' : formatNumber(s.lpViews)) },
    { key: 'optins', label: 'Opt-ins', fmt: s => formatNumber(s.optins) },
    { key: 'optin_rate', label: 'Opt-in rate', fmt: s => formatPercent(s.optinRate) },
    { key: 'deposits', label: 'Deposits', fmt: s => formatNumber(s.deposits) },
    { key: 'deposit_rate', label: 'Conv. rate', fmt: s => formatPercent(s.depositRate) },
    { key: null, label: 'Deposit rate · direct', fmt: s => `${formatPercent(s.depositRateDirect)} (${formatNumber(s.depositsDirect)})` },
  ];

  return (
    <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2 border-t border-border pt-3">
      <div className="text-[9px] uppercase tracking-wider text-fg-dim">
        7d before <span className="text-fg-dim/60">→</span> {partial ? `${elapsed}d after` : '7d after'}
      </div>
      {cells.filter(c => c.key !== metric).map(c => (
        <div key={c.key} className="min-w-[5.5rem]">
          <div className="text-[9px] uppercase tracking-wider text-fg-dim">{c.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5 font-mono text-xs tabular-nums">
            <span className="text-fg-muted">{before ? c.fmt(before) : '—'}</span>
            <span className="text-fg-dim">→</span>
            <span className="font-semibold text-fg">{after ? c.fmt(after) : '—'}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Still inside the after-window: show the wait honestly rather than a half-formed number. */
function Measuring({ entry }: { entry: OptimisationEntry }) {
  const elapsed = Math.max(0, Math.min(7, 7 - entry.daysRemaining));
  return (
    <div className="rounded-xl bg-black/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            <Timer size={11} /> Measuring {METRIC_LABELS[entry.primaryMetric].toLowerCase()}
          </div>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-fg-dim">
            Judged once the full 7 days after the change have run —{' '}
            {entry.daysRemaining === 0 ? 'finishing today' : `${entry.daysRemaining} ${entry.daysRemaining === 1 ? 'day' : 'days'} to go`}.
          </p>
        </div>
        <div className="flex items-center gap-1.5" title={`${elapsed} of 7 days elapsed`}>
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i} className={cn('h-6 w-2.5 rounded-full', i < elapsed ? 'bg-pink' : 'bg-white/[0.08]')} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The verdict is the job this page exists for, so an undecided entry asks for it outright
 * instead of sitting in a row of equal-weight buttons, and the reading the numbers support
 * is ringed. Once decided it collapses to the single answer, the rest one click away.
 */
function VerdictControl({ entry, pending, onSet }: { entry: OptimisationEntry; pending: boolean; onSet: (v: Verdict | null) => void }) {
  const [open, setOpen] = useState(false);

  if (entry.verdict && !open) {
    const tone = VERDICT_TONE[entry.verdict];
    const Icon = tone.icon;
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={pending}
        title="Change verdict"
        className={cn('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ring-1 transition-colors disabled:opacity-50', tone.bg, tone.text, tone.ring)}
      >
        <Icon size={12} /> {VERDICT_LABELS[entry.verdict]}
        <Pencil size={10} className="opacity-60" />
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!entry.verdict && (
        <span className={cn('text-[11px] font-medium', entry.measuring ? 'text-fg-dim' : 'text-pink')}>
          {entry.measuring ? 'Call it early?' : 'Your call:'}
        </span>
      )}
      {VERDICTS.map(v => {
        const tone = VERDICT_TONE[v];
        const Icon = tone.icon;
        const suggested = entry.suggested === v && !entry.verdict;
        return (
          <button
            key={v}
            onClick={() => { onSet(entry.verdict === v ? null : v); setOpen(false); }}
            disabled={pending}
            title={suggested ? 'What the numbers suggest' : undefined}
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50',
              entry.verdict === v
                ? cn(tone.bg, tone.text, 'ring-1', tone.ring)
                : suggested
                  ? cn('ring-1 hover:bg-white/5', tone.text, tone.ring)
                  : 'text-fg-dim hover:bg-white/5 hover:text-fg',
            )}
          >
            {entry.verdict === v ? <Check size={11} /> : <Icon size={11} />}
            {VERDICT_LABELS[v]}
          </button>
        );
      })}
    </div>
  );
}

function EmptyMonth({ month, onLog }: { month: string | null; onLog: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border-strong bg-surface px-6 py-14 text-center">
      <div className="text-base font-semibold text-fg">No changes logged in {fmtMonth(month)}</div>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-fg-muted">
        Log a change the day it goes live. The 7 days either side are measured for you from the same
        data the funnel page uses — all you decide is whether it worked.
      </p>
      <button
        onClick={onLog}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft"
      >
        <Plus size={16} /> Log the first one
      </button>
    </div>
  );
}

function EntryModal({ entry, funnels, clients, onClose, onSaved }: {
  entry: OptimisationEntry | null;
  funnels: AdminFunnel[];
  clients: ClientOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveOptimisationAction, { ok: false });
  // Closing has to happen in an effect, not during render — calling the parent's setState
  // mid-render is what produces "cannot update a component while rendering another".
  useEffect(() => { if (state.ok) onSaved(); }, [state.ok, onSaved]);

  const clientName = (id: string) => clients.find(c => c.client_id === id)?.client_name ?? 'Unknown client';
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/80 p-6" onClick={onClose}>
      <form
        action={action}
        onClick={e => e.stopPropagation()}
        className="mt-10 w-full max-w-xl space-y-4 rounded-2xl border border-border-strong bg-surface p-6 shadow-2xl shadow-black/60"
      >
        <div>
          <h2 className="text-lg font-bold tracking-tight text-fg">{entry ? 'Edit log entry' : 'Log an optimisation'}</h2>
          <p className="mt-1 text-xs text-fg-dim">
            The 7 days either side of the change date are measured automatically — nothing to type in.
          </p>
        </div>

        {entry && <input type="hidden" name="id" value={entry.id} />}

        <Field label="Funnel">
          <select name="funnel_id" defaultValue={entry?.funnelId ?? ''} required className={inputCls}>
            <option value="" disabled>Pick a funnel…</option>
            {funnels.map(f => (
              <option key={f.id} value={f.id}>{clientName(f.client_id)} — {f.name}</option>
            ))}
          </select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date the change went live">
            {/* Not <input type="date"> — that renders in the browser's locale, and a US-format
                08/06/2026 is genuinely ambiguous to a UK team. Also capped at today: a change
                can't have gone live in the future, and a typo'd year would silently produce
                two empty windows. */}
            <DateField name="change_date" defaultValue={entry?.changeDate ?? today} max={today} />
          </Field>
          <Field label="Metric it should move">
            <select name="primary_metric" defaultValue={entry?.primaryMetric ?? 'deposit_rate'} className={inputCls}>
              {PRIMARY_METRICS.map(m => <option key={m} value={m}>{METRIC_LABELS[m]}</option>)}
            </select>
          </Field>
        </div>

        <Field label="What was changed">
          <input name="title" defaultValue={entry?.title ?? ''} required maxLength={200}
            placeholder="Swapped hero headline to price-led" className={inputCls} />
        </Field>

        <Field label="Detail / hypothesis" optional>
          <textarea name="detail" defaultValue={entry?.detail ?? ''} rows={3}
            placeholder="Why you expected it to work, and anything else running at the same time."
            className={cn(inputCls, 'resize-y')} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Verdict" optional>
            <select name="verdict" defaultValue={entry?.verdict ?? ''} className={inputCls}>
              <option value="">Not decided yet</option>
              {VERDICTS.map(v => <option key={v} value={v}>{VERDICT_LABELS[v]}</option>)}
            </select>
          </Field>
          <Field label="Verdict note" optional>
            <input name="verdict_note" defaultValue={entry?.verdictNote ?? ''} maxLength={200}
              placeholder="Budget doubled mid-window" className={inputCls} />
          </Field>
        </div>

        {state?.error && (
          <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{state.error}</div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
            Cancel
          </button>
          <button type="submit" disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft disabled:opacity-60">
            {pending && <Loader2 size={14} className="animate-spin" />}
            {entry ? 'Save changes' : 'Add to log'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-border bg-black/20 px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none';

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-fg-muted">
        {label}{optional && <span className="text-fg-dim"> · optional</span>}
      </span>
      {children}
    </label>
  );
}
