'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, PhoneCall, Clock, TrendingUp, Loader2, RefreshCw, ArrowLeft, Search, ChevronRight, Zap } from 'lucide-react';
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
const speedColor = (v: number | null) => (v == null ? 'text-fg-dim' : v >= 80 ? 'text-green' : v >= 75 ? 'text-yellow' : 'text-red');
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

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Call Tracking</h1>
        <p className="mt-1 text-sm text-fg-muted">Appointment-setter activity — dials, conversations and speed to lead, per client.</p>
      </div>

      {detail ? (
        <>
          <button onClick={() => navigate()} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-pink">
            <ArrowLeft size={14} /> All clients
          </button>
          <Detail row={detail} />
        </>
      ) : (
        <>
          <div className="relative max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {overview.filter(r => !search || r.client.client_name.toLowerCase().includes(search.toLowerCase()))
              .map(r => <OverviewCard key={r.client.client_id} row={r} onClick={() => navigate(r.client.client_id)} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ c, big = false }: { c: ClientOption; big?: boolean }) {
  const cls = big ? 'h-12 w-12 rounded-2xl' : 'h-8 w-8 rounded-lg';
  return c.logo_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={c.logo_url} alt="" className={cn(cls, 'shrink-0 border border-border object-cover')} />
  ) : (
    <div className={cn(cls, 'flex shrink-0 items-center justify-center text-[10px] font-bold text-fg-muted')} style={{ background: clientColor(c.client_id) }}>
      {clientInitials(c.client_name)}
    </div>
  );
}

function OverviewCard({ row, onClick }: { row: CallOverviewRow; onClick: () => void }) {
  const { client, summary: s } = row;
  const synced = s.callsOnFile > 0;
  return (
    <button onClick={onClick} className="group flex flex-col rounded-2xl border border-border bg-surface p-5 text-left transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <Badge c={client} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg group-hover:text-pink">{client.client_name}</div>
            <div className="mt-0.5 text-[11px] text-fg-dim">{synced ? `${s.dials} dials · ${s.conversations} conv.` : 'Calls not synced'}</div>
          </div>
        </div>
        <ChevronRight size={16} className="mt-0.5 shrink-0 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" />
      </div>
      {synced ? (
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Mini label="Dials" value={formatNumber(s.dials)} />
          <Mini label="Conv." value={formatNumber(s.conversations)} accent />
          <Mini label="Rate" value={pct(s.convRatePct)} />
        </div>
      ) : (
        <div className="mt-4 text-[11px] text-fg-dim">Open to sync this client&apos;s calls.</div>
      )}
    </button>
  );
}

function Mini({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-surface-2/40 px-2 py-1.5 text-center">
      <div className="text-[8px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-sm font-bold tabular-nums', accent ? 'text-green' : 'text-fg')}>{value}</div>
    </div>
  );
}

function Detail({ row }: { row: CallDetail }) {
  const { client, activity: a } = row;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const sync = () => {
    setMsg(null);
    start(async () => {
      const res = await syncClientCallsAction(client.client_id, 30);
      setMsg(res.ok ? `Synced ${res.calls ?? 0} calls from ${res.conversationsScanned ?? 0} conversations.` : (res.error ?? 'Sync failed'));
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface-2/50 to-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <Badge c={client} big />
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-fg">{client.client_name}</h2>
            <p className="text-xs text-fg-muted">Setter activity · conversation = connected call ≥60s</p>
          </div>
        </div>
        <button onClick={sync} disabled={pending}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync calls
        </button>
      </div>

      {msg && <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg-muted">{msg}</div>}

      {a.callsOnFile === 0 ? (
        <div className="rounded-2xl border border-yellow/30 bg-yellow/10 p-6 text-center text-sm text-yellow">
          No calls synced yet. Hit <span className="font-semibold">Sync calls</span> to pull this client&apos;s recent call activity from GHL.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Kpi icon={Phone} label="Total Dials" value={formatNumber(a.dials)} colorClass="text-pink" info="Every outbound call the setters made in this range (connected or not)." />
            <Kpi icon={PhoneCall} label="Conversations" value={formatNumber(a.conversations)} accent="green" sub="≥60s"
              info="Dials that turned into a real conversation — a connected call lasting at least 60 seconds. Short/missed calls don't count." />
            <Kpi icon={TrendingUp} label="Conv. Rate" value={pct(a.convRatePct)}
              info="Conversations ÷ Total Dials — how often a dial becomes a real conversation." />
            <Kpi icon={Clock} label="Avg Duration" value={fmtDuration(a.avgDurationSec)} sub="on conv."
              info="Average length of the conversations (calls ≥60s)." />
            <Kpi icon={Zap} label="Speed to Lead" value={pct(a.speed.pct)} colorClass={speedColor(a.speed.pct)}
              sub={`${a.speed.contactedWithin}/${a.speed.phoned} phoned ≤${SPEED_TO_LEAD_MINUTES}m${a.speed.medianMinutes != null ? ` · med ${a.speed.medianMinutes}m` : ''}`}
              info={`Of the new leads that were PHONED (9am–5pm), the % reached within ${SPEED_TO_LEAD_MINUTES} minutes. Leads handled by SMS or the AI agent (no call) are excluded — not counted as a miss. Calls made off GHL aren't seen.`} />
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6">
            <div className="mb-4">
              <div className="text-sm font-semibold text-fg">Appointment setters</div>
              {a.speed.leadsInHours > 0 && (
                <div className="mt-0.5 text-[11px] text-fg-dim">
                  {a.speed.leadsInHours} new leads 9–5 · {a.speed.phoned} phoned · {a.speed.neverCalled} no call (SMS/AI). Speed to Lead is measured on the phoned leads only.
                </div>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                    <th className="px-2 py-2 text-left font-semibold">Setter</th>
                    <th className="px-2 py-2 text-right font-semibold">Dials</th>
                    <th className="px-2 py-2 text-right font-semibold">Conv.</th>
                    <th className="px-2 py-2 text-right font-semibold">Rate</th>
                    <th className="px-2 py-2 text-right font-semibold">Avg Dur.</th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">New Leads <InfoTip text="New leads (9am–5pm) this setter was the FIRST to phone (credited by who called, not assignment). Leads nobody phoned are the 'No phone call' row; the Total is every new lead. Speed to Lead uses only the phoned ones." /></span></th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">≤{SPEED_TO_LEAD_MINUTES}m <InfoTip text={`Of the leads this setter phoned, how many within ${SPEED_TO_LEAD_MINUTES} minutes of the enquiry.`} /></span></th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">Speed to Lead <InfoTip text="Reached ≤30m ÷ leads phoned. Measured only on leads that got a call — SMS/AI-handled leads (no call) are excluded, not counted as a miss." /></span></th>
                    <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">Tier <InfoTip text="Performance level from the speed-to-lead rate — Senior ≥85%, Flat ≥80%, Junior ≥75%, and below 75% is under target." /></span></th>
                  </tr>
                </thead>
                <tbody>
                  {a.setters.map(s => (
                    <tr key={s.csr} className="border-b border-border/50 last:border-0">
                      <td className="px-2 py-2.5 font-medium text-fg">{s.csr}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-pink">{s.dials}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-green">{s.conversations}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-fg-muted">{pct(s.convRatePct)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-fg-muted">{fmtDuration(s.avgDurationSec)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-fg-muted">{s.speedLeads}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-fg">{s.speedWithin}</td>
                      <td className={cn('px-2 py-2.5 text-right font-mono font-semibold tabular-nums', speedColor(s.speedToLeadPct))}>{pct(s.speedToLeadPct)}</td>
                      <td className="px-2 py-2.5 text-right">
                        <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', speedTier(s.speedToLeadPct).cls)}>{speedTier(s.speedToLeadPct).label}</span>
                      </td>
                    </tr>
                  ))}
                  {a.speed.leadsInHours > 0 && (
                    <>
                      {a.speed.neverCalled > 0 && (
                        <tr className="border-b border-border/50 text-fg-dim">
                          <td className="px-2 py-2.5"><span className="inline-flex items-center gap-1 italic">No phone call <InfoTip text="New leads with no phone call — handled by SMS or the AI agent (or missed). Not part of Speed to Lead, and not counted as a miss." /></span></td>
                          <td className="px-2 py-2.5 text-right">—</td>
                          <td className="px-2 py-2.5 text-right">—</td>
                          <td className="px-2 py-2.5 text-right">—</td>
                          <td className="px-2 py-2.5 text-right">—</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{a.speed.neverCalled}</td>
                          <td className="px-2 py-2.5 text-right">—</td>
                          <td className="px-2 py-2.5 text-right">—</td>
                          <td className="px-2 py-2.5 text-right">—</td>
                        </tr>
                      )}
                      <tr className="border-t border-border font-semibold text-fg">
                        <td className="px-2 py-2.5">Total <span className="font-normal text-fg-dim">· all new leads 9–5</span></td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-pink">{a.dials}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-green">{a.conversations}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{pct(a.convRatePct)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{fmtDuration(a.avgDurationSec)}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{a.speed.leadsInHours}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{a.speed.contactedWithin}</td>
                        <td className={cn('px-2 py-2.5 text-right font-mono tabular-nums', speedColor(a.speed.pct))} title={`${a.speed.contactedWithin} of ${a.speed.phoned} phoned`}>{pct(a.speed.pct)}</td>
                        <td className="px-2 py-2.5 text-right">
                          <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', speedTier(a.speed.pct).cls)}>{speedTier(a.speed.pct).label}</span>
                        </td>
                      </tr>
                    </>
                  )}
                  {a.setters.length === 0 && a.speed.leadsInHours === 0 && <tr><td colSpan={9} className="px-2 py-6 text-center text-xs text-fg-dim">No call or lead activity in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-6">
            <div className="mb-1 flex items-center justify-between">
              <div className="text-sm font-semibold text-fg">Daily activity</div>
              <Legend />
            </div>
            <DailyChart data={a.daily} />
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, accent, colorClass, info }: { icon: typeof Phone; label: string; value: string; sub?: string; accent?: 'green'; colorClass?: string; info?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/30 p-4">
      <div className="flex items-center gap-1.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2"><Icon size={14} className="text-pink" /></div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className={cn('mt-2 font-mono text-2xl font-bold tabular-nums', colorClass ?? (accent === 'green' ? 'text-green' : 'text-fg'))}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-fg-dim">{sub}</div>}
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
