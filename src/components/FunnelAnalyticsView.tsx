'use client';

import { Fragment, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, MousePointerClick, Landmark, ExternalLink, FlaskConical, ChevronRight, ArrowDown, ArrowRight, ArrowLeft, Plus, Pencil, Archive, ArchiveRestore, Loader2, AlertTriangle, Search, Trash2 } from 'lucide-react';
import type { ClientOption, FunnelMetrics } from '@/lib/queries';
import type { AdminFunnel, FunnelPageLink } from '@/lib/funnelAdmin';
import { FunnelFormModal } from '@/components/FunnelsManager';
import { setFunnelStatusAction, deleteFunnelAction } from '@/app/actions/funnels';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

type Props = {
  clients: ClientOption[];
  adminFunnels: AdminFunnel[];
  metricsList: FunnelMetrics[];
  funnelStatus: 'active' | 'archived';
  selectedFunnelId: string | null;
  since: string;
  until: string;
};

export function FunnelAnalyticsView({
  clients, adminFunnels, metricsList, funnelStatus, selectedFunnelId, since, until,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminFunnel | 'new' | null>(null);
  const [search, setSearch] = useState('');

  const clientInfo = new Map(clients.map(c => [c.client_id, c]));
  const selectedAdmin = selectedFunnelId ? adminFunnels.find(f => f.id === selectedFunnelId) ?? null : null;

  const navigate = (next: { funnel?: string; fstatus?: 'active' | 'archived' }) => {
    const params = new URLSearchParams();
    params.set('view', 'funnel');
    params.set('since', since);
    params.set('until', until);
    if (next.funnel) params.set('funnel', next.funnel);
    const fs = next.fstatus ?? funnelStatus;
    if (fs === 'archived') params.set('fstatus', 'archived');
    router.push(`/?${params.toString()}`);
  };

  const detail = selectedFunnelId ? metricsList.find(m => m.funnel_id === selectedFunnelId) ?? null : null;

  const q = search.trim().toLowerCase();
  const filtered = q
    ? metricsList.filter(m => {
        const cn = (clientInfo.get(m.client_id)?.client_name ?? '').toLowerCase();
        return cn.includes(q) || m.funnel_name.toLowerCase().includes(q);
      })
    : metricsList;

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
          <MetricsPanel metrics={detail} clientName={clientInfo.get(detail.client_id)?.client_name ?? ''} logoUrl={clientInfo.get(detail.client_id)?.logo_url ?? null} />
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
          </div>
          <Overview metricsList={filtered} clientInfo={clientInfo} status={funnelStatus} onOpen={fid => navigate({ funnel: fid })} />
        </>
      )}

      {editing && (
        <FunnelFormModal
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          clients={clients}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function StatusButton({ funnelId, to, onDone }: { funnelId: string; to: 'active' | 'archived'; onDone?: () => void }) {
  const [pending, start] = useTransition();
  const archiving = to === 'archived';
  const onClick = () => {
    if (archiving && !window.confirm('Set this funnel to inactive? It will be archived and hidden from the active list — you can reactivate it anytime.')) return;
    start(async () => { await setFunnelStatusAction(funnelId, to); onDone?.(); });
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
  const onClick = () => {
    if (!window.confirm(`Permanently delete "${funnelName}"?\n\nThis removes the funnel from the dashboard for good and cannot be undone. Your GHL and Meta data is not affected — only this funnel's configuration is deleted.\n\nTo just hide it instead, use “Set inactive”.`)) return;
    start(async () => { await deleteFunnelAction(funnelId); onDone?.(); });
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
  metricsList, clientInfo, status, onOpen,
}: {
  metricsList: FunnelMetrics[];
  clientInfo: Map<string, ClientOption>;
  status: 'active' | 'archived';
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

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sorted.map(m => (
        <FunnelSummaryCard key={m.funnel_id} m={m} client={clientInfo.get(m.client_id)} onClick={() => onOpen(m.funnel_id)} />
      ))}
    </div>
  );
}

function FunnelSummaryCard({ m, client, onClick }: { m: FunnelMetrics; client?: ClientOption; onClick: () => void }) {
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
            <div className="mt-0.5 truncate text-[11px] font-medium text-fg-muted">{m.funnel_name}</div>
            <div className="mt-0.5 text-[11px] text-fg-dim">
              {m.meta_campaign_count} campaign{m.meta_campaign_count === 1 ? '' : 's'} · {m.pages.length} page{m.pages.length === 1 ? '' : 's'}
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
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">Opt-in rate</div>
          <div className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-fg">{formatPercent(m.optin_rate_pct)}</div>
        </div>
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-fg-muted">Deposit rate</div>
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

function MetricsPanel({ metrics: m, clientName, logoUrl }: { metrics: FunnelMetrics; clientName: string; logoUrl: string | null }) {
  const top = m.lp_views && m.lp_views > 0 ? m.lp_views : Math.max(m.optins, m.deposits, 1);
  const share = (v: number | null) => (v == null ? null : Math.round((v / top) * 1000) / 10);

  const setterNote = m.setter_sources.length ? `+${m.setter_sources.length} phone source${m.setter_sources.length === 1 ? '' : 's'} (tag-verified)` : '';
  const depositCaption = m.deposit_sources.length
    ? [m.deposit_sources.join(' · '), setterNote].filter(Boolean).join(' · ')
    : (setterNote || 'No deposit source set');

  const stages = [
    { key: 'lpv', label: 'LP Views', icon: Eye, value: m.lp_views, tags: m.meta_campaign_count ? `${m.meta_campaign_count} campaign${m.meta_campaign_count === 1 ? '' : 's'}` : 'No campaigns mapped' },
    { key: 'opt', label: 'Opt-ins', icon: MousePointerClick, value: m.optins, tags: m.optin_tags.length ? m.optin_tags.join(' · ') : 'No opt-in tags' },
    { key: 'dep', label: 'Deposits', icon: Landmark, value: m.deposits, tags: depositCaption },
  ] as const;

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
        <div className="flex items-center gap-5 sm:gap-7">
          <Headline label="Deposits" value={m.deposits == null ? '—' : formatNumber(m.deposits)} />
          <div className="h-10 w-px bg-border" />
          <Headline label="Opt-in rate" value={formatPercent(m.optin_rate_pct)} />
          <div className="h-10 w-px bg-border" />
          <Headline label="Deposit rate" value={formatPercent(m.deposit_rate_pct)} accent />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {stages.map((s, i) => (
            <Fragment key={s.key}>
              <StageCard
                label={s.label}
                icon={s.icon}
                value={s.value}
                share={share(s.value)}
                widthPct={s.value == null ? 0 : Math.max(4, share(s.value) ?? 0)}
                tags={s.tags}
                breakdown={s.key === 'dep' && m.setter_sources.length > 0
                  ? [{ label: 'Funnel', value: m.deposits_direct }, { label: 'Phone', value: m.deposits_setter }]
                  : undefined}
              />
              {i < stages.length - 1 && (
                <StageConnector pct={i === 0 ? m.optin_rate_pct : m.deposit_rate_pct} dropped={s.value != null && stages[i + 1].value != null ? s.value - (stages[i + 1].value as number) : null} />
              )}
            </Fragment>
          ))}
        </div>
      </div>

      {m.lp_views == null && (
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

function Headline({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="text-right sm:text-left">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-3xl font-bold tabular-nums', accent ? 'text-pink' : 'text-fg')}>{value}</div>
    </div>
  );
}

function StageCard({
  label, icon: Icon, value, share, widthPct, tags, breakdown,
}: {
  label: string;
  icon: typeof Eye;
  value: number | null;
  share: number | null;
  widthPct: number;
  tags: string;
  breakdown?: { label: string; value: number }[];
}) {
  return (
    <div className="flex flex-1 flex-col rounded-xl border border-border bg-surface-2/30 p-5">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2"><Icon size={15} className="text-pink" /></div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-mono text-3xl font-bold tabular-nums text-fg">{value == null ? '—' : formatNumber(value)}</span>
        {share != null && <span className="text-xs tabular-nums text-fg-dim">{share}%</span>}
      </div>
      {breakdown && (
        <div className="mt-2.5 flex gap-2">
          {breakdown.map(b => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-border/60 bg-surface-2/40 px-2.5 py-2">
              <span className="text-[9px] font-medium uppercase tracking-wide text-fg-muted">{b.label}</span>
              <span className="font-mono text-base font-bold tabular-nums text-fg">{formatNumber(b.value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 truncate text-[11px] text-fg-dim" title={tags}>{tags}</div>
      <div className="mt-auto pt-4">
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-gradient-to-r from-pink/70 to-pink transition-[width] duration-500" style={{ width: `${widthPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function StageConnector({ pct, dropped }: { pct: number | null; dropped: number | null }) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 lg:w-24 lg:flex-col lg:gap-1">
      <ArrowDown size={16} className="text-fg-dim lg:hidden" />
      <ArrowRight size={18} className="hidden text-fg-dim lg:block" />
      <div className="text-center">
        <div className="text-sm font-bold text-pink">{pct == null ? '—' : `${pct}%`}</div>
        <div className="text-[9px] uppercase tracking-wide text-fg-dim">continue</div>
        {dropped != null && dropped > 0 && <div className="text-[9px] text-fg-dim">−{formatNumber(dropped)}</div>}
      </div>
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

