'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  PhoneOutgoing, PhoneCall, Clock, TrendingUp, Loader2, RefreshCw, ArrowLeft,
  Search, ChevronRight, Zap, Users, Activity, Gauge as GaugeIcon, Trophy, Radio,
} from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { CallActivity, CallSummary, DailyPoint } from '@/lib/csrMetrics';
import { SPEED_TO_LEAD_MINUTES } from '@/lib/csrConstants';
import { syncClientCallsAction } from '@/app/actions/sync';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { InfoTip } from '@/components/InfoTip';
import { cn, formatNumber } from '@/lib/utils';

export type CallOverviewRow = { client: ClientOption; summary: CallSummary };
export type CallDetail = { client: ClientOption; activity: CallActivity };

const fmtDuration = (sec: number | null): string => {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
};
const fmtDay = (iso: string): string => {
  const [, m, d] = iso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  return `${Number(d)} ${mon}`;
};
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
// Colour + tier are derived straight from the Speed-to-Lead rate against the KPI bands.
const speedText = (v: number | null) => (v == null ? 'text-fg-dim' : v >= 80 ? 'text-green' : v >= 75 ? 'text-yellow' : 'text-red');
const speedTier = (v: number | null): { label: string; cls: string } => {
  if (v == null) return { label: '—', cls: 'text-fg-dim' };
  if (v >= 85) return { label: 'Senior', cls: 'bg-green/15 text-green' };
  if (v >= 80) return { label: 'Flat', cls: 'bg-green/15 text-green' };
  if (v >= 75) return { label: 'Junior', cls: 'bg-yellow/15 text-yellow' };
  return { label: 'Below target', cls: 'bg-red/15 text-red' };
};

export function CallTrackingView({
  overview, detail, since, until,
}: {
  overview: CallOverviewRow[];
  detail: CallDetail | null;
  since: string;
  until: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const navigate = (client?: string) => {
    const p = new URLSearchParams({ view: 'calls', since, until });
    if (client) p.set('client', client);
    router.push(`/?${p.toString()}`);
  };

  if (detail) {
    return (
      <div className="space-y-6 p-8">
        <button onClick={() => navigate()} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-pink">
          <ArrowLeft size={14} /> Call floor
        </button>
        <Detail row={detail} />
      </div>
    );
  }

  return <Roster overview={overview} search={search} setSearch={setSearch} onOpen={navigate} />;
}

// ─── Overview: the "call floor" — aggregate band + ranked roster ──────────────

function Roster({
  overview, search, setSearch, onOpen,
}: {
  overview: CallOverviewRow[];
  search: string;
  setSearch: (s: string) => void;
  onOpen: (client: string) => void;
}) {
  const agg = useMemo(() => {
    const synced = overview.filter(r => r.summary.callsOnFile > 0);
    const dials = synced.reduce((n, r) => n + r.summary.dials, 0);
    const conv = synced.reduce((n, r) => n + r.summary.conversations, 0);
    return {
      dials, conv,
      convRate: dials ? +((100 * conv) / dials).toFixed(1) : null,
      tracked: synced.length,
      total: overview.length,
      maxDials: Math.max(1, ...synced.map(r => r.summary.dials)),
    };
  }, [overview]);

  // Busiest first; not-yet-synced clients sink to the bottom.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...overview]
      .filter(r => !q || r.client.client_name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.summary.callsOnFile > 0) - Number(a.summary.callsOnFile > 0) || b.summary.dials - a.summary.dials);
  }, [overview, search]);

  return (
    <div className="space-y-6 p-8">
      {/* Aggregate band — the pulse of every client's phone room, side by side */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl border border-border bg-gradient-to-br from-surface-2/60 via-surface to-surface p-4 lg:grid-cols-4">
        <BandStat icon={PhoneOutgoing} tint="text-pink" label="Total dials" value={formatNumber(agg.dials)} note="outbound, all clients" />
        <BandStat icon={PhoneCall} tint="text-green" label="Conversations" value={formatNumber(agg.conv)} note="connected ≥60s" />
        <BandStat icon={TrendingUp} tint="text-fg" label="Connect rate" value={pct(agg.convRate)} note="conv ÷ dials" />
        <BandStat icon={Radio} tint="text-fg" label="Clients tracked" value={`${agg.tracked}`} note={`of ${agg.total} with call data`} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          <Trophy size={13} className="text-pink" /> Ranked by call volume
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none" />
        </div>
      </div>

      {/* Roster — one horizontal strip per client, with a shared-scale volume bar */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        {rows.length === 0 && <div className="px-5 py-12 text-center text-sm text-fg-dim">No clients match “{search}”.</div>}
        {rows.map((r, i) => (
          <RosterRow key={r.client.client_id} row={r} rank={r.summary.callsOnFile > 0 ? i + 1 : null} maxDials={agg.maxDials} onClick={() => onOpen(r.client.client_id)} />
        ))}
      </div>
    </div>
  );
}

function BandStat({ icon: Icon, tint, label, value, note }: { icon: typeof PhoneOutgoing; tint: string; label: string; value: string; note: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-1 py-1">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2"><Icon size={17} className={tint} /></div>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
        <div className={cn('font-mono text-xl font-bold tabular-nums leading-tight', tint)}>{value}</div>
        <div className="truncate text-[10px] text-fg-dim">{note}</div>
      </div>
    </div>
  );
}

function RosterRow({ row, rank, maxDials, onClick }: { row: CallOverviewRow; rank: number | null; maxDials: number; onClick: () => void }) {
  const { client, summary: s } = row;
  const synced = s.callsOnFile > 0;
  const dialW = synced ? Math.max(2, (s.dials / maxDials) * 100) : 0;
  const convW = synced ? (s.conversations / maxDials) * 100 : 0;
  return (
    <button onClick={onClick}
      className="group grid w-full grid-cols-[2rem_1fr] items-center gap-3 border-b border-border/60 px-4 py-3.5 text-left transition-colors last:border-0 hover:bg-surface-2/40 sm:grid-cols-[2rem_minmax(0,14rem)_1fr_auto]">
      {/* rank */}
      <span className={cn('flex h-7 w-7 items-center justify-center rounded-lg font-mono text-xs font-bold tabular-nums',
        rank === 1 ? 'bg-pink/20 text-pink' : rank ? 'bg-surface-2 text-fg-muted' : 'text-fg-dim')}>
        {rank ?? '—'}
      </span>

      {/* identity */}
      <div className="flex min-w-0 items-center gap-2.5">
        <Badge c={client} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg group-hover:text-pink">{client.client_name}</div>
          <div className="mt-0.5 text-[11px] text-fg-dim">
            {synced ? <>{formatNumber(s.dials)} dials · {formatNumber(s.conversations)} conv · {pct(s.convRatePct)}</> : <span className="text-fg-muted">Not synced — open to pull calls</span>}
          </div>
        </div>
      </div>

      {/* shared-scale volume bar (hidden on mobile) */}
      <div className="hidden sm:block">
        {synced ? (
          <div className="relative h-6 w-full overflow-hidden rounded-md bg-surface-2/60">
            <div className="absolute inset-y-0 left-0 rounded-md bg-pink/25" style={{ width: `${dialW}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-md bg-green/70" style={{ width: `${convW}%` }} />
          </div>
        ) : (
          <div className="h-6 w-full rounded-md border border-dashed border-border/70" />
        )}
      </div>

      {/* avg duration + chevron */}
      <div className="hidden items-center gap-4 sm:flex">
        <div className="text-right">
          <div className="font-mono text-sm font-semibold tabular-nums text-fg">{synced ? fmtDuration(s.avgDurationSec) : '—'}</div>
          <div className="text-[9px] uppercase tracking-wider text-fg-muted">avg dur.</div>
        </div>
        <ChevronRight size={16} className="shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" />
      </div>
    </button>
  );
}

// ─── Detail: one client's call floor ─────────────────────────────────────────

function Detail({ row }: { row: CallDetail }) {
  const { client, activity: a } = row;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sync = () => {
    setMsg(null);
    start(async () => {
      const res = await syncClientCallsAction(client.client_id, 30);
      setMsg(res.ok
        ? { ok: true, text: `Synced ${res.calls ?? 0} calls from ${res.conversationsScanned ?? 0} conversations.` }
        : { ok: false, text: res.error ?? 'Sync failed' });
    });
  };

  const topDials = Math.max(1, ...a.setters.map(s => s.dials));

  return (
    <div className="space-y-5">
      {/* Command bar */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface-2/50 to-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <Badge c={client} big />
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-fg">{client.client_name}</h2>
            <p className="text-xs text-fg-muted">Call floor · conversation = connected call ≥60s</p>
          </div>
        </div>
        <button onClick={sync} disabled={pending}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync calls
        </button>
      </div>

      {msg && (
        <div className={cn('rounded-lg border px-3 py-2 text-xs', msg.ok ? 'border-border bg-surface text-fg-muted' : 'border-red/30 bg-red/10 text-red')}>
          {msg.text}
        </div>
      )}

      {a.callsOnFile === 0 ? (
        <div className="rounded-2xl border border-yellow/30 bg-yellow/10 p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-yellow/15"><PhoneOutgoing size={20} className="text-yellow" /></div>
          <div className="text-sm font-medium text-yellow">No calls on file yet</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-yellow/80">Hit <span className="font-semibold">Sync calls</span> to pull this client&apos;s recent call activity from GHL. If it stays empty, the client may handle enquiries by SMS only.</p>
        </div>
      ) : (
        <>
          {/* Speed-to-Lead spotlight: the headline KPI as a radial gauge */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_1fr]">
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-border bg-gradient-to-br from-surface-2/40 to-surface p-6">
              <div className="flex items-center gap-1.5 self-start text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                <Zap size={13} className="text-pink" /> Speed to Lead
                <InfoTip text={`Of the new leads that were PHONED (9am–5pm), the % reached within ${SPEED_TO_LEAD_MINUTES} minutes. Leads handled by SMS or the AI agent (no call) are excluded — not a miss. Calls made off GHL aren't seen.`} />
              </div>
              <Gauge value={a.speed.pct} />
              <span className={cn('rounded-md px-2.5 py-1 text-xs font-semibold', speedTier(a.speed.pct).cls)}>{speedTier(a.speed.pct).label}</span>
              <div className="text-center text-[11px] text-fg-dim">
                {a.speed.contactedWithin}/{a.speed.phoned} phoned reached ≤{SPEED_TO_LEAD_MINUTES}m
                {a.speed.medianMinutes != null && <> · median {a.speed.medianMinutes}m</>}
              </div>
            </div>

            {/* Vitals + funnel of leads */}
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Vital icon={PhoneOutgoing} tint="text-pink" label="Dials" value={formatNumber(a.dials)} sub="outbound" info="Every outbound call the setters made in this range (connected or not)." />
                <Vital icon={PhoneCall} tint="text-green" label="Conversations" value={formatNumber(a.conversations)} sub="≥60s" info="Dials that turned into a real conversation — a connected call lasting at least 60 seconds." />
                <Vital icon={TrendingUp} tint="text-fg" label="Connect rate" value={pct(a.convRatePct)} sub="conv ÷ dials" info="How often a dial becomes a real conversation." />
                <Vital icon={Clock} tint="text-fg" label="Avg duration" value={fmtDuration(a.avgDurationSec)} sub="on conv." info="Average length of the conversations (calls ≥60s)." />
              </div>

              {a.speed.leadsInHours > 0 && (
                <div className="rounded-2xl border border-border bg-surface p-5">
                  <div className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
                    <GaugeIcon size={13} className="text-pink" /> New leads 9am–5pm
                    <InfoTip text="New leads created in business hours. Speed to Lead is measured only on the ones a setter actually phoned — SMS/AI-handled leads aren't counted as a miss." />
                  </div>
                  <LeadSplit leads={a.speed.leadsInHours} phoned={a.speed.phoned} within={a.speed.contactedWithin} />
                </div>
              )}
            </div>
          </div>

          {/* Setter leaderboard */}
          <div className="rounded-2xl border border-border bg-surface p-6">
            <div className="mb-4 flex items-center gap-2">
              <Users size={15} className="text-pink" />
              <div className="text-sm font-semibold text-fg">Setter leaderboard</div>
              <span className="text-[11px] text-fg-dim">· ranked by dials</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                    <th className="px-2 py-2 text-left font-semibold">#</th>
                    <th className="px-2 py-2 text-left font-semibold">Setter</th>
                    <th className="px-2 py-2 text-left font-semibold">Dials</th>
                    <th className="px-2 py-2 text-right font-semibold">Conv.</th>
                    <th className="px-2 py-2 text-right font-semibold">Rate</th>
                    <th className="px-2 py-2 text-right font-semibold">Avg Dur.</th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">Leads <InfoTip text="New leads (9am–5pm) this setter was the FIRST to phone (credited by who called, not assignment). Leads nobody phoned are the 'No phone call' row; the Total is every new lead." /></span></th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">≤{SPEED_TO_LEAD_MINUTES}m <InfoTip text={`Of the leads this setter phoned, how many within ${SPEED_TO_LEAD_MINUTES} minutes of the enquiry.`} /></span></th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">Speed to Lead <InfoTip text="Reached ≤30m ÷ leads phoned. Measured only on leads that got a call — SMS/AI-handled leads are excluded, not counted as a miss." /></span></th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">Tier <InfoTip text="Performance level from the speed-to-lead rate — Senior ≥85%, Flat ≥80%, Junior ≥75%, and below 75% is under target." /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {a.setters.map((s, i) => (
                    <tr key={s.csr} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-3">
                        <span className={cn('flex h-6 w-6 items-center justify-center rounded-md font-mono text-[11px] font-bold tabular-nums', i === 0 ? 'bg-pink/20 text-pink' : 'bg-surface-2 text-fg-muted')}>{i + 1}</span>
                      </td>
                      <td className="px-2 py-3 font-medium text-fg">{s.csr}</td>
                      <td className="px-2 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-8 shrink-0 text-right font-mono tabular-nums text-pink">{s.dials}</span>
                          <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-2 sm:block">
                            <span className="block h-full rounded-full bg-pink/60" style={{ width: `${Math.max(4, (s.dials / topDials) * 100)}%` }} />
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-3 text-right tabular-nums text-green">{s.conversations}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-fg-muted">{pct(s.convRatePct)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-fg-muted">{fmtDuration(s.avgDurationSec)}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-fg-muted">{s.speedLeads}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-fg">{s.speedWithin}</td>
                      <td className={cn('px-2 py-3 text-right font-mono font-semibold tabular-nums', speedText(s.speedToLeadPct))}>{pct(s.speedToLeadPct)}</td>
                      <td className="px-2 py-3 text-right">
                        <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', speedTier(s.speedToLeadPct).cls)}>{speedTier(s.speedToLeadPct).label}</span>
                      </td>
                    </tr>
                  ))}
                  {a.speed.leadsInHours > 0 && (
                    <>
                      {a.speed.neverCalled > 0 && (
                        <tr className="border-b border-border/50 text-fg-dim">
                          <td className="px-2 py-3"></td>
                          <td className="px-2 py-3"><span className="inline-flex items-center gap-1 italic">No phone call <InfoTip text="New leads with no phone call — handled by SMS or the AI agent (or missed). Not part of Speed to Lead, and not counted as a miss." /></span></td>
                          <td className="px-2 py-3">—</td>
                          <td className="px-2 py-3 text-right">—</td>
                          <td className="px-2 py-3 text-right">—</td>
                          <td className="px-2 py-3 text-right">—</td>
                          <td className="px-2 py-3 text-right tabular-nums">{a.speed.neverCalled}</td>
                          <td className="px-2 py-3 text-right">—</td>
                          <td className="px-2 py-3 text-right">—</td>
                          <td className="px-2 py-3 text-right">—</td>
                        </tr>
                      )}
                      <tr className="border-t border-border font-semibold text-fg">
                        <td className="px-2 py-3"></td>
                        <td className="px-2 py-3">Total <span className="font-normal text-fg-dim">· all new leads 9–5</span></td>
                        <td className="px-2 py-3 tabular-nums text-pink">{a.dials}</td>
                        <td className="px-2 py-3 text-right tabular-nums text-green">{a.conversations}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{pct(a.convRatePct)}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{fmtDuration(a.avgDurationSec)}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{a.speed.leadsInHours}</td>
                        <td className="px-2 py-3 text-right tabular-nums">{a.speed.contactedWithin}</td>
                        <td className={cn('px-2 py-3 text-right font-mono tabular-nums', speedText(a.speed.pct))} title={`${a.speed.contactedWithin} of ${a.speed.phoned} phoned`}>{pct(a.speed.pct)}</td>
                        <td className="px-2 py-3 text-right">
                          <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', speedTier(a.speed.pct).cls)}>{speedTier(a.speed.pct).label}</span>
                        </td>
                      </tr>
                    </>
                  )}
                  {a.setters.length === 0 && a.speed.leadsInHours === 0 && <tr><td colSpan={10} className="px-2 py-6 text-center text-xs text-fg-dim">No call or lead activity in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Daily activity */}
          <div className="rounded-2xl border border-border bg-surface p-6">
            <div className="mb-1 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-fg"><Activity size={15} className="text-pink" /> Daily activity</div>
              <Legend />
            </div>
            <DailyChart data={a.daily} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function Badge({ c, big = false }: { c: ClientOption; big?: boolean }) {
  const cls = big ? 'h-12 w-12 rounded-2xl' : 'h-9 w-9 rounded-lg';
  return c.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.logo_url} alt="" className={cn(cls, 'shrink-0 border border-border object-cover')} />
  ) : (
    <div className={cn(cls, 'flex shrink-0 items-center justify-center text-[10px] font-bold text-fg-muted')} style={{ background: clientColor(c.client_id) }}>
      {clientInitials(c.client_name)}
    </div>
  );
}

// Radial gauge for the Speed-to-Lead rate. The arc + centre number take the band colour.
function Gauge({ value, size = 168 }: { value: number | null; size?: number }) {
  const stroke = 13;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const colorCls = speedText(value);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-current text-surface-2" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={cn('stroke-current transition-[stroke-dashoffset] duration-700', colorCls)}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - v / 100)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-mono text-4xl font-bold tabular-nums', colorCls)}>{value == null ? '—' : `${value}`}</span>
        {value != null && <span className={cn('text-xs font-semibold', colorCls)}>%</span>}
      </div>
    </div>
  );
}

function Vital({ icon: Icon, tint, label, value, sub, info }: { icon: typeof PhoneOutgoing; tint: string; label: string; value: string; sub?: string; info?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/30 p-4">
      <div className="flex items-center gap-1.5">
        <Icon size={14} className={tint} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className={cn('mt-2 font-mono text-2xl font-bold tabular-nums', tint)}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-fg-dim">{sub}</div>}
    </div>
  );
}

// A three-segment horizontal funnel: all leads → phoned → reached ≤30m.
function LeadSplit({ leads, phoned, within }: { leads: number; phoned: number; within: number }) {
  const seg = [
    { label: 'New leads', value: leads, cls: 'bg-surface-2', text: 'text-fg' },
    { label: 'Phoned', value: phoned, cls: 'bg-pink/50', text: 'text-pink' },
    { label: `Reached ≤${SPEED_TO_LEAD_MINUTES}m`, value: within, cls: 'bg-green/70', text: 'text-green' },
  ];
  return (
    <div className="flex items-end gap-2">
      {seg.map(s => (
        <div key={s.label} className="flex-1">
          <div className="mb-1 flex items-baseline justify-between gap-1">
            <span className="truncate text-[10px] font-medium text-fg-muted">{s.label}</span>
            <span className={cn('font-mono text-sm font-bold tabular-nums', s.text)}>{formatNumber(s.value)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div className={cn('h-full rounded-full', s.cls)} style={{ width: `${leads ? Math.max(3, (s.value / leads) * 100) : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-fg-muted">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-pink/40" /> Dials</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green/70" /> Conversations</span>
    </div>
  );
}

// Stacked daily bars — full height = dials, green base = conversations (a subset).
// Hover any day's column for a tooltip with the exact dials + conversations.
function DailyChart({ data }: { data: DailyPoint[] }) {
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const W = Math.max(560, data.length * 22), H = 220;
  const pad = { t: 12, r: 8, b: 28, l: 32 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(1, ...data.map(d => d.dials));
  const colW = iw / Math.max(1, data.length);
  const bw = Math.max(3, colW * 0.62);
  const cx = (i: number) => pad.l + (i + 0.5) * colW;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = Array.from(new Set([0, Math.round(max / 2), max]));
  const every = Math.max(1, Math.ceil(data.length / 10));
  const at = (e: React.MouseEvent, i: number) => setHover({ i, x: e.clientX, y: e.clientY });
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ minWidth: data.length > 34 ? W : undefined }}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stroke-current text-fg-dim/15" strokeDasharray="2 3" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-current text-[9px] text-fg-dim">{t}</text>
          </g>
        ))}
        {hover && <rect x={pad.l + hover.i * colW} y={pad.t} width={colW} height={ih} className="fill-current text-fg/5" pointerEvents="none" />}
        {data.map((d, i) => (
          <g key={d.date}>
            <rect x={cx(i) - bw / 2} y={y(d.dials)} width={bw} height={pad.t + ih - y(d.dials)} rx={1.5} className="fill-current text-pink/30" />
            <rect x={cx(i) - bw / 2} y={y(d.conversations)} width={bw} height={pad.t + ih - y(d.conversations)} rx={1.5} className="fill-current text-green/70" />
          </g>
        ))}
        {data.map((d, i) => (i % every === 0 ? (
          <text key={d.date} x={cx(i)} y={H - 9} textAnchor="middle" className="fill-current text-[8px] text-fg-dim">{fmtDay(d.date)}</text>
        ) : null))}
        {/* transparent hit areas — one per day column — capture the hover */}
        {data.map((d, i) => (
          <rect key={`hit-${d.date}`} x={pad.l + i * colW} y={pad.t} width={colW} height={ih} fill="transparent"
            onMouseEnter={e => at(e, i)} onMouseMove={e => at(e, i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-full rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-[11px] leading-snug shadow-lg"
          style={{ left: hover.x, top: hover.y - 10 }}
        >
          <div className="mb-0.5 font-semibold text-fg">{fmtDay(data[hover.i].date)}</div>
          <div className="whitespace-nowrap text-fg-muted">Dials <span className="ml-1 tabular-nums font-semibold text-pink">{data[hover.i].dials}</span></div>
          <div className="whitespace-nowrap text-fg-muted">Conversations <span className="ml-1 tabular-nums font-semibold text-green">{data[hover.i].conversations}</span></div>
        </div>
      )}
    </div>
  );
}
