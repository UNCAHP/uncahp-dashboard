'use client';

import { Fragment, useState, useTransition } from 'react';
import { useNav } from '@/components/NavProgress';
import { ExternalLink, FlaskConical, SplitSquareHorizontal, ChevronRight, ArrowDown, ArrowRight, ArrowLeft, Plus, Pencil, Archive, ArchiveRestore, Loader2, AlertTriangle, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/Confirm';
import type { ClientOption, FunnelMetrics, FunnelMeta } from '@/lib/queries';
import type { AdminFunnel, FunnelPageLink } from '@/lib/funnelAdmin';
import type { SplitTest } from '@/lib/splitTests';
import { FunnelFormModal } from '@/components/FunnelsManager';
import { SplitTestPanel, TrackingPanel } from '@/components/SplitTestPanel';
import { StageFlow, STAGE_ICONS, type Stage } from '@/components/FunnelStages';
import { setFunnelStatusAction, deleteFunnelAction } from '@/app/actions/funnels';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { splitTotals, applySplitTotals } from '@/lib/funnelTotals';
import { InfoTip } from '@/components/InfoTip';
import { FunnelDailyChart } from '@/components/FunnelDailyChart';
import { cn, formatGBP, formatNumber, formatPercent } from '@/lib/utils';

type Props = {
  clients: ClientOption[];
  adminFunnels: AdminFunnel[];
  metricsList: FunnelMetrics[];
  splitTests: SplitTest[];
  baseUrl: string;
  funnelStatus: 'active' | 'archived';
  selectedFunnelId: string | null;
  since: string;
  until: string;
};

export function FunnelAnalyticsView({
  clients, adminFunnels, metricsList: rawMetricsList, splitTests, baseUrl, funnelStatus, selectedFunnelId, since, until,
}: Props) {
  const { navigate: go } = useNav();
  const [editing, setEditing] = useState<AdminFunnel | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const clientInfo = new Map(clients.map(c => [c.client_id, c]));
  const splitByFunnel = new Map(splitTests.map(t => [t.funnelId, t]));
  // A running split test's first-party counts replace Meta LP views and GHL tags everywhere
  // in this view (list cards, totals, detail), so the numbers agree with the split test panel.
  const metricsList = rawMetricsList.map(m => applySplitTotals(m, splitByFunnel.get(m.funnel_id)));
  const selectedAdmin = selectedFunnelId ? adminFunnels.find(f => f.id === selectedFunnelId) ?? null : null;
  const selectedTest = selectedFunnelId ? splitByFunnel.get(selectedFunnelId) ?? null : null;

  const navigate = (next: { funnel?: string; fstatus?: 'active' | 'archived' }) => {
    const params = new URLSearchParams();
    params.set('view', 'funnel');
    params.set('since', since);
    params.set('until', until);
    if (next.funnel) params.set('funnel', next.funnel);
    const fs = next.fstatus ?? funnelStatus;
    if (fs === 'archived') params.set('fstatus', 'archived');
    go(`/?${params.toString()}`);
  };

  const detail = selectedFunnelId ? metricsList.find(m => m.funnel_id === selectedFunnelId) ?? null : null;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? metricsList.filter(m => {
        const cn = (clientInfo.get(m.client_id)?.client_name ?? '').toLowerCase();
        return cn.includes(q) || m.funnel_name.toLowerCase().includes(q);
      })
    : metricsList;

  // Totals across the funnels shown (respects the Active/Inactive tab + search), minus two
  // kinds of funnel that would skew a B2C benchmark:
  //   • funnels with a split test still running — their numbers are a blend of versions
  //     being compared, not a settled funnel;
  //   • B2B clients (UNCAHP's own funnels) — a different audience entirely.
  // Both stay listed as cards; they're just not in the totals.
  const isTesting = (m: FunnelMetrics) => {
    const t = splitByFunnel.get(m.funnel_id);
    return !!t && t.mode === 'test' && t.status === 'running';
  };
  const isB2B = (m: FunnelMetrics) => clientInfo.get(m.client_id)?.segment === 'b2b';
  const counted = filtered.filter(m => !isTesting(m) && !isB2B(m));
  const excludedTesting = filtered.filter(isTesting).length;
  const excludedB2B = filtered.filter(isB2B).length;
  const excludedNote = [
    excludedTesting ? `${excludedTesting} running split test${excludedTesting === 1 ? '' : 's'}` : '',
    excludedB2B ? `${excludedB2B} B2B` : '',
  ].filter(Boolean).join(' · ');

  const sums = counted.reduce(
    (a, m) => ({ lp: a.lp + (m.lp_views ?? 0), optins: a.optins + m.optins, deposits: a.deposits + m.deposits }),
    { lp: 0, optins: 0, deposits: 0 },
  );
  // Average opt-in rate = mean of each funnel's opt-in rate (funnels with LP views).
  const rated = counted.filter(m => m.optin_rate_pct != null);
  const avgOptinRate = rated.length
    ? +(rated.reduce((s, m) => s + (m.optin_rate_pct ?? 0), 0) / rated.length).toFixed(1)
    : null;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Funnel Analytics</h1>
          <p className="mt-1 text-sm text-fg-muted">
            LP views (Meta) → opt-ins → deposits (GHL tags), per registered funnel.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="inline-flex items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft"
        >
          <Plus size={16} /> Add funnel
        </button>
      </div>

      {detail ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <button onClick={() => navigate({})} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-pink">
              <ArrowLeft size={14} /> Back to funnels
            </button>
            {selectedAdmin && (
              <div className="flex items-center gap-2">
                <button onClick={() => setEditing(selectedAdmin)} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg transition-colors hover:border-border-strong hover:text-pink">
                  <Pencil size={13} /> Edit
                </button>
                <StatusButton
                  funnelId={selectedAdmin.id}
                  to={selectedAdmin.status === 'active' ? 'archived' : 'active'}
                  onDone={() => navigate({})}
                />
                <DeleteButton
                  funnelId={selectedAdmin.id}
                  funnelName={selectedAdmin.name}
                  onDone={() => navigate({})}
                />
              </div>
            )}
          </div>
          <MetricsPanel metrics={detail} splitTest={selectedTest} clientName={clientInfo.get(detail.client_id)?.client_name ?? ''} logoUrl={clientInfo.get(detail.client_id)?.logo_url ?? null} />
          {selectedTest ? (
            selectedTest.mode === 'test'
              ? <SplitTestPanel test={selectedTest} baseUrl={baseUrl} />
              : <TrackingPanel test={selectedTest} baseUrl={baseUrl} metaLpViews={detail?.lp_views ?? null} primary={detail.meta_campaign_count === 0} since={since} until={until} />
          ) : selectedAdmin ? (
            <SplitTestSetupCTA onSetup={() => setEditing(selectedAdmin)} />
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
              {(['active', 'archived'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => navigate({ fstatus: s })}
                  className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', funnelStatus === s ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}
                >
                  {s === 'active' ? 'Active' : 'Inactive'}
                </button>
              ))}
            </div>
            <div className="relative max-w-xs flex-1">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients or funnels…"
                className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none"
              />
            </div>
            <div className="ml-auto flex flex-col items-end gap-1">
              <div className="flex items-center gap-5 rounded-lg border border-border bg-surface px-4 py-1.5">
                <TotalSum label="LP Views" value={formatNumber(sums.lp)} />
                <TotalSum label="Opt-ins" value={formatNumber(sums.optins)} />
                <TotalSum label="Avg Opt-in Rate" value={formatPercent(avgOptinRate)} />
                <TotalSum label={`${funnelStatus === 'active' ? 'Active' : 'Inactive'} deposits`} value={formatNumber(sums.deposits)} accent />
              </div>
              {excludedNote && <div className="text-[10px] text-fg-dim">Not in totals: {excludedNote}</div>}
            </div>
          </div>
          <Overview metricsList={filtered} clientInfo={clientInfo} status={funnelStatus} splitByFunnel={splitByFunnel} onOpen={fid => navigate({ funnel: fid })} />
        </>
      )}

      {editing && (
        <FunnelFormModal
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          clients={clients}
          baseUrl={baseUrl}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SplitTestSetupCTA({ onSetup }: { onSetup: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-pink/10"><SplitSquareHorizontal size={18} className="text-pink" /></div>
        <div>
          <div className="text-sm font-semibold text-fg">First-party tracking is off for this funnel</div>
          <div className="text-xs text-fg-muted">Turn it on for a Meta-independent backup of views, opt-ins &amp; deposits — and optionally run an A/B test. You&apos;ll get a snippet to paste in.</div>
        </div>
      </div>
      <button onClick={onSetup} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black hover:bg-pink-soft">
        <SplitSquareHorizontal size={15} /> Set up tracking
      </button>
    </div>
  );
}

function TotalSum({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-center">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-sm font-bold tabular-nums', accent ? 'text-pink' : 'text-fg')}>{value}</div>
    </div>
  );
}

function StatusButton({ funnelId, to, onDone }: { funnelId: string; to: 'active' | 'archived'; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const archiving = to === 'archived';
  const confirm = useConfirm();
  const onClick = async () => {
    if (archiving && !(await confirm({ title: 'Set this funnel to inactive?', body: 'It will be archived and hidden from the active list. You can reactivate it anytime.', confirmLabel: 'Set inactive' }))) return;
    start(async () => {
      const res = await setFunnelStatusAction(funnelId, to);
      if (!res.ok) { toast.error(res.error ?? 'Could not update the funnel'); return; }
      toast.success(archiving ? 'Funnel set inactive' : 'Funnel set active');
      onDone?.();
    });
  };
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : archiving ? <Archive size={13} /> : <ArchiveRestore size={13} />}
      {archiving ? 'Set inactive' : 'Set active'}
    </button>
  );
}

function DeleteButton({ funnelId, funnelName, onDone }: { funnelId: string; funnelName: string; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const confirm = useConfirm();
  const onClick = async () => {
    if (!(await confirm({ title: `Permanently delete ${funnelName}?`, body: `This removes the funnel from the dashboard for good and cannot be undone. Your GHL and Meta data is not affected — only this funnel's configuration is deleted.\n\nTo just hide it instead, use “Set inactive”.`, confirmLabel: 'Delete funnel', danger: true }))) return;
    start(async () => {
      const res = await deleteFunnelAction(funnelId);
      if (!res.ok) { toast.error(res.error ?? 'Could not delete the funnel'); return; }
      toast.success(`${funnelName} deleted`);
      onDone?.();
    });
  };
  return (
    <button
      onClick={onClick}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-red/30 bg-surface px-3 py-1.5 text-xs font-medium text-red transition-colors hover:border-red/60 hover:bg-red/10 disabled:opacity-50"
    >
      {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
      Delete
    </button>
  );
}

// ─── Overview (all funnels, grouped by client) ───────────────────────────────

function Overview({
  metricsList, clientInfo, status, splitByFunnel, onOpen,
}: {
  metricsList: FunnelMetrics[];
  clientInfo: Map<string, ClientOption>;
  status: 'active' | 'archived';
  splitByFunnel: Map<string, SplitTest>;
  onOpen: (funnelId: string) => void;
}) {
  if (metricsList.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-pink/10"><FlaskConical size={20} className="text-pink" /></div>
        <div className="mb-1 text-sm text-fg">{status === 'active' ? 'No active funnels' : 'No inactive funnels'}</div>
        <div className="text-xs text-fg-muted">{status === 'active' ? 'Use “Add funnel” to create one.' : 'Funnels you set to inactive will appear here.'}</div>
      </div>
    );
  }

  // One flat responsive grid so cards fill the row. Sorted by client, then funnel,
  // so a client's funnels stay adjacent (each card also shows its client).
  const sorted = [...metricsList].sort((a, b) => {
    const an = clientInfo.get(a.client_id)?.client_name ?? a.client_id;
    const bn = clientInfo.get(b.client_id)?.client_name ?? b.client_id;
    return an.localeCompare(bn) || a.funnel_name.localeCompare(b.funnel_name);
  });

  // Funnels mid-split-test are a different kind of thing from a settled funnel — their
  // numbers are a blend of versions — so they get their own section at the top.
  const testing = sorted.filter(m => { const t = splitByFunnel.get(m.funnel_id); return t?.mode === 'test' && t.status === 'running'; });
  const settled = sorted.filter(m => !testing.includes(m));

  const grid = (list: FunnelMetrics[]) => (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {list.map(m => (
        <FunnelSummaryCard key={m.funnel_id} m={m} client={clientInfo.get(m.client_id)} mode={splitByFunnel.get(m.funnel_id)?.mode} combined={splitTotals(splitByFunnel.get(m.funnel_id), m.meta_campaign_count)} onClick={() => onOpen(m.funnel_id)} />
      ))}
    </div>
  );

  if (testing.length === 0) return grid(settled);

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading icon={SplitSquareHorizontal} title="Running split tests" count={testing.length} hint="Comparing versions · not in totals" />
        {grid(testing)}
      </section>
      {settled.length > 0 && (
        <section>
          <SectionHeading icon={FlaskConical} title="Funnels" count={settled.length} />
          {grid(settled)}
        </section>
      )}
    </div>
  );
}

function SectionHeading({ icon: Icon, title, count, hint }: { icon: typeof FlaskConical; title: string; count: number; hint?: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon size={14} className="text-pink" />
      <span className="text-sm font-semibold text-fg">{title}</span>
      <span className="rounded-full bg-border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-fg-dim">{count}</span>
      {hint && <span className="text-[11px] text-fg-dim">· {hint}</span>}
    </div>
  );
}

function FunnelSummaryCard({ m, client, mode, combined, onClick }: { m: FunnelMetrics; client?: ClientOption; mode?: 'measure' | 'test'; combined: { winner: string | null } | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex flex-col rounded-2xl border border-border bg-surface p-5 text-left transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {client?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={client.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-border object-cover" />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-fg-muted" style={{ background: clientColor(m.client_id) }}>
              {clientInitials(client?.client_name ?? '?')}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg group-hover:text-pink">{client?.client_name ?? '—'}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate text-[11px] font-medium text-fg-muted">{m.funnel_name}</span>
              {mode === 'test' ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green">
                  <SplitSquareHorizontal size={9} /> A/B
                </span>
              ) : mode === 'measure' ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-pink/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-pink">
                  Tracked
                </span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[11px] text-fg-dim">
              {combined ? (combined.winner ? `First-party · ${combined.winner}` : mode === 'test' ? 'First-party · all versions' : 'First-party tracking') : `${m.meta_campaign_count} campaign${m.meta_campaign_count === 1 ? '' : 's'}`} · {m.pages.length} page{m.pages.length === 1 ? '' : 's'}
            </div>
          </div>
        </div>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Mini label="LP Views" value={m.lp_views == null ? '—' : formatNumber(m.lp_views)} />
        <Mini label="Opt-ins" value={formatNumber(m.optins)} />
        <Mini label="Deposits" value={formatNumber(m.deposits)} accent />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border/60 pt-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">Opt-in rate</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">{formatPercent(m.optin_rate_pct)}</div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">Deposit rate</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">{formatPercent(m.deposit_rate_direct_pct)}</div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">Conversion rate</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-pink">{formatPercent(m.deposit_rate_pct)}</div>
        </div>
      </div>
    </button>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-lg font-bold tabular-nums', accent ? 'text-pink' : 'text-fg')}>{value}</div>
    </div>
  );
}

// ─── Detail (single funnel) ──────────────────────────────────────────────────

function MetricsPanel({ metrics: m, splitTest, clientName, logoUrl }: { metrics: FunnelMetrics; splitTest: SplitTest | null; clientName: string; logoUrl: string | null }) {
  const setterNote = m.setter_sources.length ? `+${m.setter_sources.length} phone source${m.setter_sources.length === 1 ? '' : 's'} (tag-verified)` : '';
  const depositCaption = m.deposit_sources.length
    ? [m.deposit_sources.join(' · '), setterNote].filter(Boolean).join(' · ')
    : (setterNote || 'No deposit source set');

  const combined = splitTotals(splitTest, m.meta_campaign_count);
  const isTest = splitTest?.mode === 'test';
  const fpCaption = !combined ? '' : combined.winner ? `first-party · ${combined.winner}` : isTest ? `first-party · ${combined.versions} versions combined` : 'first-party tracking';

  const stages: Stage[] = [
    { key: 'lpv', label: 'LP Views', icon: STAGE_ICONS.views, value: m.lp_views, caption: combined ? fpCaption : m.meta_campaign_count ? `${m.meta_campaign_count} campaign${m.meta_campaign_count === 1 ? '' : 's'}` : 'No campaigns mapped' },
    { key: 'opt', label: 'Opt-ins', icon: STAGE_ICONS.optins, value: m.optins, caption: combined ? fpCaption : m.optin_tags.length ? m.optin_tags.join(' · ') : 'No opt-in tags' },
    { key: 'dep', label: 'Deposits', icon: STAGE_ICONS.deposits, value: m.deposits, caption: combined ? fpCaption : depositCaption,
      breakdown: m.setter_sources.length > 0 ? [{ label: 'Funnel', value: m.deposits_direct }, { label: 'Phone', value: m.deposits_setter }] : undefined },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface-2/50 to-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-12 w-12 rounded-2xl border border-border object-cover" />
          ) : (
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-bold text-fg-muted" style={{ background: clientColor(m.client_id) }}>
              {clientInitials(clientName || '?')}
            </div>
          )}
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-fg">{m.funnel_name}</h2>
            <p className="text-xs text-fg-muted">{clientName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5 sm:gap-7">
          <Headline label="Deposits" value={m.deposits == null ? '—' : formatNumber(m.deposits)} />
          <div className="h-10 w-px bg-border" />
          <Headline label="Opt-in rate" value={formatPercent(m.optin_rate_pct)} />
          <div className="h-10 w-px bg-border" />
          <Headline label="Deposit rate" value={formatPercent(m.deposit_rate_direct_pct)} />
          <div className="h-10 w-px bg-border" />
          <Headline label="Conversion rate" value={formatPercent(m.deposit_rate_pct)} accent />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6">
        {combined && (
          <div className="mb-4 flex items-center gap-2 text-[11px] text-fg-dim">
            <SplitSquareHorizontal size={13} className="text-pink" />
            {combined.winner
              ? <>First-party tracking for the selected dates, showing the winning version <span className="font-semibold text-fg">{combined.winner}</span> only. The split test below keeps its full history.</>
              : isTest
              ? 'First-party tracking for the selected dates, all versions combined. The split test below is judged on its full history.'
              : 'First-party tracking for the selected dates. No Meta campaigns are mapped to this funnel, so these are recorded directly from its pages.'}
          </div>
        )}
        <StageFlow stages={stages} />
      </div>

      {/* Ad spend beside the day-by-day results on wide screens; stacked below that. With no
          campaigns mapped there is no Meta panel and the chart takes the full width. */}
      <div className={cn('grid gap-5', m.meta && 'xl:grid-cols-2')}>
        {m.meta && <MetaAdsPanel meta={m.meta} campaigns={m.meta_campaign_count} />}
        {m.daily.length > 0 && <FunnelDailyChart days={m.daily} note={combined ? 'opt-in tags and payments in GHL' : undefined} />}
      </div>

      {m.lp_views == null && !combined && (
        <div className="rounded-xl border border-yellow/30 bg-yellow/10 px-4 py-2.5 text-xs text-yellow">
          No Meta campaigns are mapped to this funnel, so LP views (and the rates based on them) can’t be calculated. Add campaigns under “Manage funnels”.
        </div>
      )}

      {m.pages.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-4 text-sm font-semibold text-fg">Funnel pages</div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
            {m.pages.map((p, i) => (
              <Fragment key={i}>
                <PageCard index={i} page={p} />
                {i < m.pages.length - 1 && <PageArrow />}
              </Fragment>
            ))}
          </div>
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-yellow/30 bg-gradient-to-br from-yellow/10 to-transparent p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow/15 ring-1 ring-yellow/20">
              <AlertTriangle size={16} className="text-yellow" />
            </div>
            <div className="text-xs leading-relaxed">
              <div className="font-semibold text-yellow">Heads up — opening pages fires their pixels</div>
              <p className="mt-0.5 text-fg-muted">
                Loading a page (especially the <span className="font-medium text-fg">Thank You page</span>) can trigger its Meta / GA conversion pixels and pollute attribution. Preview conversion pages in a <span className="font-medium text-fg">private / incognito window</span>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// The ad side of the funnel: what the mapped Meta campaigns spent in the selected dates and
// what each funnel result cost. Spend and the three cost-per figures lead; delivery sits under.
function MetaAdsPanel({ meta: a, campaigns }: { meta: FunnelMeta; campaigns: number }) {
  const money = (v: number | null) => formatGBP(v, { decimals: 2 });
  const count = (v: number) => new Intl.NumberFormat('en-GB').format(v);
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-fg">Meta Ads</div>
        <div className="text-[11px] text-fg-dim">{campaigns} campaign{campaigns === 1 ? '' : 's'} mapped · selected dates</div>
      </div>
      {a.spend === 0 && a.impressions === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">The mapped campaign{campaigns === 1 ? '' : 's'} had no spend or delivery in these dates.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-2">
            <AdStat label="Amount spent" value={money(a.spend)} big />
            <AdStat label="CPL" tip="Cost per lead: amount spent ÷ this funnel's opt-ins in GHL." value={money(a.cpl)} big accent />
            <AdStat label="Cost per deposit" tip="Amount spent ÷ this funnel's deposits (funnel and phone)." value={money(a.cost_per_deposit)} big />
            <AdStat label="Cost per LP view" tip="Amount spent ÷ landing page views reported by Meta." value={money(a.cost_per_lp_view)} big />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-4 border-t border-border/60 pt-4 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-3">
            <AdStat label="Impressions" value={count(a.impressions)} />
            <AdStat label="Link clicks" value={count(a.link_clicks)} />
            <AdStat label="LP views" value={count(a.lp_views)} />
            <AdStat label="CTR" tip="Link clicks ÷ impressions." value={formatPercent(a.ctr_pct, 2)} />
            <AdStat label="CPC" tip="Amount spent ÷ link clicks." value={money(a.cpc)} />
            <AdStat label="CPM" tip="Cost per 1,000 impressions." value={money(a.cpm)} />
          </div>
        </>
      )}
    </div>
  );
}

function AdStat({ label, value, tip, big, accent }: { label: string; value: string; tip?: string; big?: boolean; accent?: boolean }) {
  return (
    <div className={cn(big && 'rounded-xl bg-surface-2 px-4 py-3')}>
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}{tip && <InfoTip text={tip} />}</div>
      <div className={cn('mt-1 font-mono font-bold tabular-nums', big ? 'text-2xl' : 'text-base', accent ? 'text-pink' : 'text-fg')}>{value}</div>
    </div>
  );
}

function Headline({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right sm:text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-3xl font-bold tabular-nums', accent ? 'text-pink' : 'text-fg')}>{value}</div>
    </div>
  );
}

function PageCard({ index, page }: { index: number; page: FunnelPageLink }) {
  const url = page.url ? (page.url.startsWith('http') ? page.url : `https://${page.url}`) : null;
  const display = url ? url.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-border bg-surface-2/30 p-4">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold text-fg-muted">{index + 1}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{page.name || 'Untitled page'}</span>
      </div>
      {display && <div className="mt-2 truncate text-[11px] text-fg-dim" title={display}>{display}</div>}
      <div className="mt-auto pt-3">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-pink transition-colors hover:text-pink-soft">
            Open <ExternalLink size={12} />
          </a>
        ) : (
          <span className="text-[11px] text-fg-dim">No link</span>
        )}
      </div>
    </div>
  );
}

function PageArrow() {
  return (
    <div className="flex shrink-0 items-center justify-center lg:w-8">
      <ArrowDown size={16} className="text-fg-dim lg:hidden" />
      <ArrowRight size={16} className="hidden text-fg-dim lg:block" />
    </div>
  );
}

