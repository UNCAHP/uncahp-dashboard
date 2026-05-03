'use client';

import { Fragment, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, ChevronRight, FlaskConical, Sparkles } from 'lucide-react';
import type { FunnelBreakdown, FunnelListItem, FunnelStep, FunnelPage } from '@/lib/queries';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

const PINK = '#f7a5de';
const PINK_DIM = 'rgba(247, 165, 222, 0.15)';
const PINK_BORDER = 'rgba(247, 165, 222, 0.3)';

type Props = {
  funnelList: FunnelListItem[];
  funnel: FunnelBreakdown | null;
  funnelClientId: string | null;
  funnelClientName: string | null;
  selectedFunnelId: string | null;
  days: number;
};

export function FunnelAnalyticsView({
  funnelList,
  funnel,
  funnelClientId,
  funnelClientName,
  selectedFunnelId,
  days,
}: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<'steps' | 'stats'>('steps');

  // Group funnels by client for the dropdown
  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const f of funnelList) seen.set(f.client_id, f.client_name);
    return Array.from(seen.entries()).map(([client_id, client_name]) => ({ client_id, client_name }));
  }, [funnelList]);

  const funnelsForClient = useMemo(
    () => funnelList.filter(f => !funnelClientId || f.client_id === funnelClientId),
    [funnelList, funnelClientId],
  );

  const navigate = (next: { client?: string; funnel?: string }) => {
    const params = new URLSearchParams();
    params.set('view', 'funnel');
    params.set('days', String(days));
    if (next.client) params.set('client', next.client);
    if (next.funnel) params.set('funnel', next.funnel);
    router.push(`/?${params.toString()}`);
  };

  // Real metrics: deposits + revenue (per variant / per step / total). LP views and
  // opt-ins still require LP-side instrumentation we don't have yet — show as "—".
  const totals = funnel
    ? {
        deposits: funnel.total_deposits,
        revenue_gbp: funnel.total_amount_gbp,
      }
    : { deposits: 0, revenue_gbp: 0 };

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Funnel Analytics</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Variant performance and full-funnel attribution · GHL funnels (page views + opt-ins land
          when LPs move to our own hosting).
        </p>
      </div>

      {/* Selectors */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={funnelClientId ?? ''}
            onChange={e => {
              const cid = e.target.value;
              const first = funnelList.find(f => f.client_id === cid);
              navigate({ client: cid, funnel: first?.funnel_id });
            }}
            className="cursor-pointer appearance-none rounded-lg border border-border bg-surface px-3 py-2 pr-8 text-xs text-fg focus:border-border-strong focus:outline-none"
          >
            <option value="" disabled>
              Select a client…
            </option>
            {clients.map(c => (
              <option key={c.client_id} value={c.client_id}>
                {c.client_name}
              </option>
            ))}
          </select>
          <ChevronRight size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-fg-dim" />
        </div>
        <div className="relative max-w-md flex-1">
          <select
            value={selectedFunnelId ?? ''}
            onChange={e => navigate({ client: funnelClientId ?? undefined, funnel: e.target.value })}
            disabled={!funnelClientId || funnelsForClient.length === 0}
            className="w-full cursor-pointer appearance-none rounded-lg border border-border bg-surface px-3 py-2 pr-8 text-sm text-fg focus:border-border-strong focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="" disabled>
              {funnelsForClient.length === 0 ? 'No funnels for this client' : 'Select a funnel…'}
            </option>
            {funnelsForClient.map(f => (
              <option key={f.funnel_id} value={f.funnel_id}>
                {f.funnel_name}
              </option>
            ))}
          </select>
          <ChevronRight size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rotate-90 text-fg-dim" />
        </div>
      </div>

      {!funnel && (
        <div className="rounded-xl border border-border bg-surface p-12 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-pink/10">
            <FlaskConical size={20} className="text-pink" />
          </div>
          <div className="mb-1 text-sm text-fg">Pick a client and funnel to begin</div>
          <div className="text-xs text-fg-muted">
            We&apos;ll load the steps, variants, and per-variant deposit performance.
          </div>
        </div>
      )}

      {funnel && (
        <>
          <FunnelHeader
            funnel={funnel}
            clientName={funnelClientName ?? ''}
            totals={totals}
          />

          <div className="flex items-center gap-1 border-b border-border">
            {(['steps', 'stats'] as const).map(t => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    'relative px-4 py-2.5 text-sm font-medium transition-colors',
                    active ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {t === 'steps' ? 'Steps' : 'Stats'}
                  {active && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-t bg-pink" />}
                </button>
              );
            })}
          </div>

          {tab === 'steps' && <StepsTab funnel={funnel} />}
          {tab === 'stats' && <StatsTab funnel={funnel} />}
        </>
      )}
    </div>
  );
}

function FunnelHeader({
  funnel,
  clientName,
  totals,
}: {
  funnel: FunnelBreakdown;
  clientName: string;
  totals: { deposits: number; revenue_gbp: number };
}) {
  const stat = (label: string, value: string, accent?: 'pink' | 'green') => (
    <div>
      <div className="mb-1 text-[9px] uppercase tracking-wider text-fg-dim">{label}</div>
      <div
        className={cn(
          'text-lg font-bold tabular-nums',
          accent === 'pink' ? 'text-pink' : accent === 'green' ? 'text-green' : 'text-fg',
        )}
      >
        {value}
      </div>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-fg-muted">
              {funnel.funnel_id.slice(-8)}
            </span>
            <span className="text-[10px] text-fg-muted">·</span>
            <span className="text-[10px] text-fg-muted">{clientName}</span>
          </div>
          <div className="text-xl font-bold tracking-tight text-fg">{funnel.funnel_name}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-3 lg:grid-cols-6">
        {stat('LP Views', '—')}
        {stat('Opt-Ins', '—')}
        {stat('Opt-In Rate', '—', 'pink')}
        {stat('Deposits Paid', formatNumber(totals.deposits))}
        {stat('Full-Funnel', '—', 'green')}
        {stat('Revenue', formatGBP(totals.revenue_gbp, { decimals: 0 }), 'green')}
      </div>
    </div>
  );
}

function StepsTab({ funnel }: { funnel: FunnelBreakdown }) {
  const [activeStepId, setActiveStepId] = useState<string>(
    funnel.steps[0]?.step_id ?? '',
  );
  const activeStep = funnel.steps.find(s => s.step_id === activeStepId) ?? funnel.steps[0];
  if (!activeStep) {
    return (
      <div className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-fg-muted">
        No steps in this funnel yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 lg:col-span-3">
        <StepNavigator
          steps={funnel.steps}
          activeStepId={activeStep.step_id}
          onSelect={setActiveStepId}
        />
      </div>
      <div className="col-span-12 space-y-4 lg:col-span-9">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="text-sm font-semibold text-fg">{activeStep.step_name}</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            {activeStep.pages.length === 1
              ? 'Single page · no split test running'
              : `${activeStep.pages.length}-way split test · ${formatNumber(activeStep.step_deposits)} deposits across variants`}
          </div>
        </div>

        {activeStep.pages.length === 1 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <VariantCard variant={activeStep.pages[0]} isControl isWinner={false} />
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-pink/15">
                <FlaskConical size={18} className="text-pink" />
              </div>
              <div className="mb-1 text-sm font-medium text-fg">Start a split test</div>
              <div className="mb-4 max-w-xs text-xs text-fg-muted">
                Test a new variant of this page against the control to optimise the deposit rate.
              </div>
              <button
                disabled
                className="cursor-not-allowed rounded-lg bg-pink px-4 py-2 text-xs font-medium text-black opacity-60"
                title="LP builder integration coming with Vercel-hosted LPs"
              >
                Create variation
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(() => {
              const winner = [...activeStep.pages].sort((a, b) => b.deposits - a.deposits)[0];
              return activeStep.pages.map((p, i) => (
                <VariantCard
                  key={p.page_id}
                  variant={p}
                  isControl={i === 0}
                  isWinner={p.page_id === winner.page_id && p.deposits > 0}
                />
              ));
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

function StepNavigator({
  steps,
  activeStepId,
  onSelect,
}: {
  steps: FunnelStep[];
  activeStepId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="sticky top-24 rounded-xl border border-border bg-surface p-3">
      <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-widest text-fg-dim">
        Funnel Steps
      </div>
      <div className="space-y-0.5">
        {steps.map((step, i) => {
          const isActive = step.step_id === activeStepId;
          return (
            <button
              key={step.step_id}
              onClick={() => onSelect(step.step_id)}
              className={cn(
                'group w-full rounded-lg px-3 py-2.5 text-left transition-colors',
                isActive ? 'bg-surface-2' : 'hover:bg-surface-2/50',
              )}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold',
                    isActive ? 'bg-pink text-black' : 'bg-surface-2 text-fg-muted',
                  )}
                >
                  {i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate text-xs font-medium', isActive ? 'text-fg' : 'text-fg-muted')}>
                    {step.step_name}
                  </div>
                  <div className="mt-0.5 text-[9px] text-fg-dim">
                    {step.pages.length} {step.pages.length === 1 ? 'variant' : 'variants'}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VariantCard({
  variant,
  isControl,
  isWinner,
}: {
  variant: FunnelPage;
  isControl: boolean;
  isWinner: boolean;
}) {
  const urlLabel = variant.page_url
    ? variant.page_url.replace(/^https?:\/\//, '')
    : '(no URL)';
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-surface-2 transition-colors',
        isWinner ? 'border-green/40' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              isControl ? 'bg-surface text-fg-muted' : 'bg-pink text-black',
            )}
          >
            {isControl ? 'Control' : 'Variation'}
          </span>
          {isWinner && (
            <span className="rounded bg-green/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-green">
              Leading
            </span>
          )}
        </div>
        <span className="text-[10px] text-fg-dim">deposits-led</span>
      </div>

      <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-border bg-gradient-to-br from-surface to-surface-2">
        <div className="absolute inset-x-0 top-0 flex h-6 items-center gap-1 border-b border-border bg-bg/80 px-2">
          <span className="h-1.5 w-1.5 rounded-full bg-fg-dim" />
          <span className="h-1.5 w-1.5 rounded-full bg-fg-dim" />
          <span className="h-1.5 w-1.5 rounded-full bg-fg-dim" />
          <span className="ml-2 truncate text-[8px] text-fg-dim">{urlLabel}</span>
        </div>
        <div className="mt-4 w-3/4 space-y-2">
          <div className="mx-auto h-2 w-2/3 rounded bg-surface" />
          <div className="h-2 w-full rounded bg-surface" />
          <div className="mx-auto h-2 w-5/6 rounded bg-surface" />
          <div
            className="mx-auto mt-3 h-8 w-1/2 rounded"
            style={{ background: PINK_DIM, border: `1px solid ${PINK_BORDER}` }}
          />
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <div className="truncate text-sm font-semibold text-fg">{variant.page_name}</div>
          <div className="mt-0.5 text-[10px] text-fg-muted">Hosted on GHL</div>
        </div>
        <div className="grid grid-cols-3 gap-2 border-t border-border pt-2">
          <div>
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-fg-dim">Views</div>
            <div className="text-sm font-bold tabular-nums text-fg-dim">—</div>
          </div>
          <div>
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-fg-dim">Opt-Ins</div>
            <div className="text-sm font-bold tabular-nums text-fg-dim">—</div>
          </div>
          <div>
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-fg-dim">Deposits</div>
            <div className={cn('text-sm font-bold tabular-nums', isWinner ? 'text-green' : 'text-fg')}>
              {variant.deposits > 0 ? formatNumber(variant.deposits) : '—'}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-2">
          <div className="text-[10px] text-fg-muted">
            Revenue
            <span className="ml-1 font-mono text-green">
              {variant.amount_gbp > 0 ? formatGBP(variant.amount_gbp, { decimals: 0 }) : '—'}
            </span>
          </div>
          {variant.page_url ? (
            <a
              href={variant.page_url.startsWith('http') ? variant.page_url : `https://${variant.page_url}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[10px] font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              View page
              <ArrowUpRight size={10} />
            </a>
          ) : (
            <span className="text-[10px] text-fg-dim">no url</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatsTab({ funnel }: { funnel: FunnelBreakdown }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const s of funnel.steps) init[s.step_id] = true;
    return init;
  });
  const toggle = (id: string) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <div className="text-sm font-semibold text-fg">Per-step performance</div>
            <div className="mt-0.5 text-xs text-fg-muted">
              Deposits and revenue for each step and its variants. Page views + opt-ins land when
              LPs move to our hosting.
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="w-[280px] px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Step / Variant
                </th>
                <th className="border-l border-border px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Views
                </th>
                <th className="border-l border-border px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Opt-Ins
                </th>
                <th className="border-l border-border px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Deposits
                </th>
                <th className="border-l border-border px-3 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                  Revenue
                </th>
              </tr>
            </thead>
            <tbody>
              {funnel.steps.map((step, i) => {
                const isExpanded = expanded[step.step_id] ?? true;
                return (
                  <Fragment key={step.step_id}>
                    <tr className="border-b border-border bg-surface-2/40">
                      <td className="px-5 py-3">
                        <button onClick={() => toggle(step.step_id)} className="flex items-center gap-2 text-left">
                          <ChevronRight
                            size={14}
                            className={cn('text-fg-muted transition-transform', isExpanded && 'rotate-90')}
                          />
                          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-2 text-[10px] font-bold text-fg-muted">
                            {i + 1}
                          </span>
                          <span className="text-sm font-semibold text-fg">{step.step_name}</span>
                        </button>
                      </td>
                      <td className="border-l border-border px-3 py-3 text-right text-sm text-fg-dim">—</td>
                      <td className="border-l border-border px-3 py-3 text-right text-sm text-fg-dim">—</td>
                      <td className="border-l border-border px-3 py-3 text-right font-mono text-sm tabular-nums text-fg">
                        {step.step_deposits > 0 ? formatNumber(step.step_deposits) : '—'}
                      </td>
                      <td className="border-l border-border px-3 py-3 text-right font-mono text-sm tabular-nums text-green">
                        {step.step_amount_gbp > 0 ? formatGBP(step.step_amount_gbp, { decimals: 0 }) : '—'}
                      </td>
                    </tr>
                    {isExpanded &&
                      step.pages.map((p, j) => (
                        <tr key={p.page_id} className="border-b border-border/50 transition-colors hover:bg-surface-2/30">
                          <td className="py-2.5 pl-14 pr-5">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
                                  j === 0 ? 'bg-surface-2 text-fg-muted' : 'bg-pink text-black',
                                )}
                              >
                                {String.fromCharCode(65 + j)}
                              </span>
                              <span className="text-xs text-fg">{p.page_name}</span>
                            </div>
                          </td>
                          <td className="border-l border-border px-3 py-2.5 text-right text-xs text-fg-dim">—</td>
                          <td className="border-l border-border px-3 py-2.5 text-right text-xs text-fg-dim">—</td>
                          <td className="border-l border-border px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg-muted">
                            {p.deposits > 0 ? formatNumber(p.deposits) : '—'}
                          </td>
                          <td className="border-l border-border px-3 py-2.5 text-right font-mono text-xs tabular-nums text-green/80">
                            {p.amount_gbp > 0 ? formatGBP(p.amount_gbp, { decimals: 0 }) : '—'}
                          </td>
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-2">
          <Sparkles size={14} className="mt-0.5 shrink-0 text-pink" />
          <div className="text-xs leading-relaxed text-fg-muted">
            <span className="text-fg">Heads up:</span> opt-in rate, deposit rate, and full-funnel
            attribution per variant all need page-view + form-submit events from the LP itself.
            GHL&apos;s Private Integration Tokens don&apos;t expose page statistics — those numbers
            light up once we move LPs to our own Vercel hosting (or Kyle gets us OAuth on GHL).
          </div>
        </div>
      </div>
    </div>
  );
}
