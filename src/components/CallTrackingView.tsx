'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, RefreshCw, ArrowLeft, Search, ChevronRight, Zap, Users, CalendarDays,
  PhoneOutgoing, PhoneOff, PhoneCall, Gauge as GaugeIcon, Moon,
} from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { ClientSpeed, ClientSpeedRow, ShiftScorecard, ShiftRow, LeadEval } from '@/lib/csrMetrics';
import { SPEED_TO_LEAD_MINUTES, CSR_SETTERS } from '@/lib/csrConstants';
import { syncClientCallsAction } from '@/app/actions/sync';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { InfoTip } from '@/components/InfoTip';
import { cn, formatNumber } from '@/lib/utils';

export type CallOverviewRow = { client: ClientOption; row: ClientSpeedRow };
export type CallDetail = { client: ClientOption; speed: ClientSpeed };
type Tab = 'speed' | 'shifts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
};
const fmtClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const setterLabel = (key: string | null): string =>
  key ? (CSR_SETTERS.find(s => s.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1)) : 'Self booking';

// Colour + tier come straight from the Speed-to-Lead rate against the KPI bands.
const speedText = (v: number | null) => (v == null ? 'text-fg-dim' : v >= 80 ? 'text-green' : v >= 75 ? 'text-yellow' : 'text-red');
const speedTier = (v: number | null): { label: string; cls: string } => {
  if (v == null) return { label: '—', cls: 'text-fg-dim' };
  if (v >= 85) return { label: 'Senior', cls: 'bg-green/15 text-green' };
  if (v >= 80) return { label: 'Flat', cls: 'bg-green/15 text-green' };
  if (v >= 75) return { label: 'Junior', cls: 'bg-yellow/15 text-yellow' };
  return { label: 'Below target', cls: 'bg-red/15 text-red' };
};
const TierChip = ({ v }: { v: number | null }) =>
  v == null ? <span className="text-fg-dim">—</span> : <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', speedTier(v).cls)}>{speedTier(v).label}</span>;

const DEFINITION = `A new lead = a contact with a campaign REF tag (e.g. dlc-ec-01-aug26) and a phone number, arriving while the client's setter (or cover) was on shift per the daily Start of Day check-in. Attempted = an outbound dial within ${SPEED_TO_LEAD_MINUTES} min, answered or not — the scored KPI. Connected = a completed call of 60s+ in that window. A lead nobody phoned counts as a miss. Targets: Junior 75% · Flat 80% · Senior 85%.`;

export function CallTrackingView({
  overview, detail, shifts, tab, since, until,
}: {
  overview: CallOverviewRow[];
  detail: CallDetail | null;
  shifts: ShiftScorecard | null;
  tab: Tab;
  since: string;
  until: string;
}) {
  const router = useRouter();
  const navigate = (next: { client?: string; tab?: Tab }) => {
    const p = new URLSearchParams({ view: 'calls', since, until });
    if (next.client) p.set('client', next.client);
    if (next.tab === 'shifts') p.set('ctab', 'shifts');
    router.push(`/?${p.toString()}`);
  };

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Call Tracking</h1>
          <p className="mt-1 text-sm text-fg-muted">Speed to Lead — new leads dialled within {SPEED_TO_LEAD_MINUTES} minutes, during setter shifts.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          {([['speed', 'Speed to Lead', Zap], ['shifts', 'Shifts', CalendarDays]] as const).map(([key, label, Icon]) => (
            <button key={key} onClick={() => navigate({ tab: key })}
              className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', tab === key && !detail ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'shifts' && shifts ? (
        <ShiftsView data={shifts} />
      ) : detail ? (
        <>
          <button onClick={() => navigate({})} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-pink">
            <ArrowLeft size={14} /> All clients
          </button>
          <Detail row={detail} />
        </>
      ) : (
        <Overview overview={overview} onOpen={id => navigate({ client: id })} />
      )}
    </div>
  );
}

// ─── Overview: team band + one row per client ────────────────────────────────

function Overview({ overview, onOpen }: { overview: CallOverviewRow[]; onOpen: (client: string) => void }) {
  const [search, setSearch] = useState('');
  const team = useMemo(() => {
    const t = overview.reduce((a, r) => ({
      leads: a.leads + r.row.leads, attempted: a.attempted + r.row.attempted, connected: a.connected + r.row.connected, never: a.never + r.row.neverCalled,
    }), { leads: 0, attempted: 0, connected: 0, never: 0 });
    return { ...t, pct: t.leads ? +((100 * t.attempted) / t.leads).toFixed(1) : null };
  }, [overview]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...overview]
      .filter(r => !q || r.client.client_name.toLowerCase().includes(q) || setterLabel(r.row.csr).toLowerCase().includes(q))
      .sort((a, b) => b.row.leads - a.row.leads || a.client.client_name.localeCompare(b.client.client_name));
  }, [overview, search]);

  return (
    <>
      <TeamBand leads={team.leads} attempted={team.attempted} connected={team.connected} never={team.never} pct={team.pct} note="all measured clients" />

      <div className="flex items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          <Users size={13} className="text-pink" /> By client <InfoTip text="Only B2C clients with an assigned setter are measured. Self-booking clients book themselves, so a phone-response KPI doesn't apply." />
        </div>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients or setters…"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Client</th>
              <th className="px-3 py-2.5 text-left font-semibold">Setter</th>
              <th className="px-3 py-2.5 text-right font-semibold">Leads on shift</th>
              <th className="px-3 py-2.5 text-right font-semibold">Attempted ≤{SPEED_TO_LEAD_MINUTES}m</th>
              <th className="px-3 py-2.5 text-right font-semibold">Connected</th>
              <th className="px-3 py-2.5 text-right font-semibold">Never phoned</th>
              <th className="px-3 py-2.5 text-right font-semibold">Speed to Lead</th>
              <th className="px-3 py-2.5 text-right font-semibold">Tier</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.client.client_id} onClick={() => onOpen(r.client.client_id)} className="group cursor-pointer border-b border-border/50 transition-colors hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-2.5"><Badge c={r.client} /><span className="font-medium text-fg group-hover:text-pink">{r.client.client_name}</span></span>
                </td>
                <td className="px-3 py-3 text-fg-muted">{setterLabel(r.row.csr)}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-fg">{r.row.leads}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-green">{r.row.attempted}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-fg-muted">{r.row.connected}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-red">{r.row.neverCalled}</td>
                <td className={cn('px-3 py-3 text-right font-mono font-semibold tabular-nums', speedText(r.row.pct))}>{pct(r.row.pct)}</td>
                <td className="px-3 py-3 text-right"><TierChip v={r.row.pct} /></td>
                <td className="pr-3"><ChevronRight size={15} className="text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-fg-dim">{search ? `No clients match “${search}”.` : 'No measured clients in this range.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TeamBand({ leads, attempted, connected, never, pct: rate, note }: { leads: number; attempted: number; connected: number; never: number; pct: number | null; note: string }) {
  return (
    <div className="grid gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface-2/50 to-surface p-5 lg:grid-cols-[auto_1fr]">
      <div className="flex items-center gap-4">
        <Gauge value={rate} size={120} />
        <div>
          <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-muted"><Zap size={12} className="text-pink" /> Speed to Lead <InfoTip text={DEFINITION} /></div>
          <div className="mt-1"><TierChip v={rate} /></div>
          <div className="mt-1.5 text-[11px] text-fg-dim">{note}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Vital icon={GaugeIcon} tint="text-fg" label="Leads on shift" value={formatNumber(leads)} />
        <Vital icon={PhoneOutgoing} tint="text-green" label={`Attempted ≤${SPEED_TO_LEAD_MINUTES}m`} value={formatNumber(attempted)} sub="scored" />
        <Vital icon={PhoneCall} tint="text-fg-muted" label={`Connected ≤${SPEED_TO_LEAD_MINUTES}m`} value={formatNumber(connected)} sub="completed, 60s+" />
        <Vital icon={PhoneOff} tint="text-red" label="Never phoned" value={formatNumber(never)} sub="counts as a miss" />
      </div>
    </div>
  );
}

// ─── Detail: one client — headline, who dialled, and the lead-by-lead log ────

function Detail({ row }: { row: CallDetail }) {
  const { client, speed: s } = row;
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sync = () => {
    setMsg(null);
    start(async () => {
      const res = await syncClientCallsAction(client.client_id, 30);
      setMsg(res.ok ? { ok: true, text: `Synced ${res.calls ?? 0} calls from ${res.conversationsScanned ?? 0} conversations.` } : { ok: false, text: res.error ?? 'Sync failed' });
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-gradient-to-br from-surface-2/50 to-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <Badge c={client} big />
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-fg">{client.client_name}</h2>
            <p className="text-xs text-fg-muted">Assigned setter · <span className="text-fg">{setterLabel(s.assigned)}</span></p>
          </div>
        </div>
        <button onClick={sync} disabled={pending}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync calls
        </button>
      </div>

      {msg && <div className={cn('rounded-lg border px-3 py-2 text-xs', msg.ok ? 'border-border bg-surface text-fg-muted' : 'border-red/30 bg-red/10 text-red')}>{msg.text}</div>}

      {s.callsOnFile === 0 && (
        <div className="rounded-xl border border-yellow/30 bg-yellow/10 px-4 py-2.5 text-xs text-yellow">
          No calls on file for this client yet — every lead below shows as never phoned. Hit <span className="font-semibold">Sync calls</span> to pull recent activity from GHL.
        </div>
      )}

      <TeamBand leads={s.leadsInHours} attempted={s.contactedWithin} connected={s.connectedWithin} never={s.neverCalled} pct={s.pct}
        note={s.medianMinutes != null ? `median ${s.medianMinutes}m to first dial` : 'no dials yet'} />

      {s.perCsr.length > 0 && (
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-fg"><Users size={14} className="text-pink" /> Who dialled first</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                <th className="px-2 py-2 text-left font-semibold">Setter</th>
                <th className="px-2 py-2 text-right font-semibold">Leads phoned</th>
                <th className="px-2 py-2 text-right font-semibold">≤{SPEED_TO_LEAD_MINUTES}m</th>
                <th className="px-2 py-2 text-right font-semibold"><span className="inline-flex items-center gap-1">Of their dials <InfoTip text="Of the leads this person was first to phone, the share dialled within 30 min. The client's scored rate above also counts never-phoned leads as misses." /></span></th>
              </tr>
            </thead>
            <tbody>
              {s.perCsr.map(r => (
                <tr key={r.csr} className="border-b border-border/50">
                  <td className="px-2 py-2.5 font-medium text-fg">{r.csr}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums">{r.called}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-green">{r.within}</td>
                  <td className={cn('px-2 py-2.5 text-right font-mono tabular-nums', speedText(r.pct))}>{pct(r.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LeadLog leads={s.leads} />
    </div>
  );
}

function LeadLog({ leads }: { leads: LeadEval[] }) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? leads : leads.slice(0, 40);
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-fg"><PhoneOutgoing size={14} className="text-pink" /> Lead log <span className="text-xs font-normal text-fg-dim">· {leads.length} measured lead{leads.length === 1 ? '' : 's'}, newest first</span></div>
      </div>
      {leads.length === 0 ? (
        <div className="py-8 text-center text-xs text-fg-dim">No measured leads in this range.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
              <th className="px-2 py-2 text-left font-semibold">Arrived</th>
              <th className="px-2 py-2 text-left font-semibold">Lead</th>
              <th className="px-2 py-2 text-left font-semibold"><span className="inline-flex items-center gap-1">Responsible <InfoTip text="The assigned setter if they were on shift when it arrived; otherwise whoever was covering." /></span></th>
              <th className="px-2 py-2 text-right font-semibold">First dial</th>
              <th className="px-2 py-2 text-left font-semibold">By</th>
              <th className="px-2 py-2 text-right font-semibold">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {list.map(l => (
              <tr key={l.source_id} className="border-b border-border/40">
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs tabular-nums text-fg-muted">{fmtDay(l.day)} · {fmtClock(l.arrivedAt)}</td>
                <td className="px-2 py-2 text-fg">{l.name}</td>
                <td className="px-2 py-2 text-fg-muted">{setterLabel(l.responsible)}{l.cover && <span className="ml-1 rounded bg-border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-dim">cover</span>}</td>
                <td className={cn('whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums', l.minsToDial == null ? 'text-red' : l.attempted ? 'text-green' : 'text-yellow')}>
                  {l.minsToDial == null ? 'never' : l.minsToDial < 60 ? `${l.minsToDial}m` : l.minsToDial < 1440 ? `${Math.round(l.minsToDial / 60)}h` : `${Math.round(l.minsToDial / 1440)}d`}
                </td>
                <td className="px-2 py-2 text-xs text-fg-muted">{l.firstDialBy ?? '—'}</td>
                <td className="px-2 py-2 text-right">
                  {l.connected ? <span className="rounded-md bg-green/15 px-2 py-0.5 text-[10px] font-semibold text-green">Connected</span>
                    : l.attempted ? <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">Dialled, no answer</span>
                    : l.minsToDial != null ? <span className="rounded-md bg-yellow/15 px-2 py-0.5 text-[10px] font-semibold text-yellow">Late</span>
                    : <span className="rounded-md bg-red/15 px-2 py-0.5 text-[10px] font-semibold text-red">Missed</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {leads.length > 40 && !showAll && (
        <button onClick={() => setShowAll(true)} className="mt-3 text-xs font-medium text-fg-muted hover:text-pink">Show all {leads.length} leads</button>
      )}
    </div>
  );
}

// ─── Shifts: every setter's hours each day, with their Speed to Lead on that shift ──

function ShiftsView({ data }: { data: ShiftScorecard }) {
  if (data.days.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-12 text-center">
        <CalendarDays size={22} className="mx-auto mb-2 text-fg-dim" />
        <div className="text-sm text-fg">No shift data in this range</div>
        <p className="mx-auto mt-1 max-w-sm text-xs text-fg-muted">Viktor writes each setter&apos;s hours here after the morning Start of Day check-in.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      {/* Per-setter summary for the range */}
      <div className="grid gap-3 sm:grid-cols-3">
        {data.setters.map(s => (
          <div key={s.csr} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-fg">{setterLabel(s.csr)}</div>
              <TierChip v={s.pct} />
            </div>
            <div className={cn('mt-1 font-mono text-3xl font-bold tabular-nums', speedText(s.pct))}>{pct(s.pct)}</div>
            <div className="mt-1 text-[11px] text-fg-dim">
              {s.attempted}/{s.leads} dialled ≤{SPEED_TO_LEAD_MINUTES}m · {s.connected} connected · <span className="text-red/80">{s.neverCalled} never</span> · {s.shifts} shift{s.shifts === 1 ? '' : 's'}
            </div>
          </div>
        ))}
      </div>

      {/* Day by day */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
              <th className="px-4 py-2.5 text-left font-semibold">Setter</th>
              <th className="px-3 py-2.5 text-left font-semibold">Shift</th>
              <th className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1">Leads <InfoTip text="New leads this setter was responsible for during this shift — their own clients, plus any they covered (marked)." /></span></th>
              <th className="px-3 py-2.5 text-right font-semibold">Attempted ≤{SPEED_TO_LEAD_MINUTES}m</th>
              <th className="px-3 py-2.5 text-right font-semibold">Connected</th>
              <th className="px-3 py-2.5 text-right font-semibold">Never phoned</th>
              <th className="px-3 py-2.5 text-right font-semibold">Speed to Lead</th>
              <th className="px-3 py-2.5 text-right font-semibold">Tier</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map(d => (
              <Fragment key={d.date}>
                <tr className="border-b border-border/60 bg-black/20">
                  <td colSpan={8} className="px-4 py-2 text-xs font-semibold text-fg">{fmtDay(d.date)}</td>
                </tr>
                {d.rows.map(r => <ShiftLine key={`${d.date}-${r.csr}`} r={r} />)}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftLine({ r }: { r: ShiftRow }) {
  if (r.off) {
    return (
      <tr className="border-b border-border/40 text-fg-dim">
        <td className="px-4 py-2.5">{setterLabel(r.csr)}</td>
        <td className="px-3 py-2.5"><span className="inline-flex items-center gap-1.5 text-xs"><Moon size={12} /> Off</span></td>
        <td colSpan={6} />
      </tr>
    );
  }
  return (
    <tr className="border-b border-border/40">
      <td className="px-4 py-2.5 font-medium text-fg">{setterLabel(r.csr)}</td>
      <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-fg-muted">{r.start}–{r.end}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg">
        {r.leads}{r.coverLeads > 0 && <span className="ml-1 text-[10px] text-fg-dim">({r.coverLeads} cover)</span>}
      </td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-green">{r.attempted}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg-muted">{r.connected}</td>
      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-red">{r.neverCalled}</td>
      <td className={cn('px-3 py-2.5 text-right font-mono font-semibold tabular-nums', speedText(r.pct))}>{pct(r.pct)}</td>
      <td className="px-3 py-2.5 text-right"><TierChip v={r.pct} /></td>
    </tr>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

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

function Vital({ icon: Icon, tint, label, value, sub }: { icon: typeof PhoneOutgoing; tint: string; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/30 p-3.5">
      <div className="flex items-center gap-1.5">
        <Icon size={13} className={tint} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      </div>
      <div className={cn('mt-1.5 font-mono text-2xl font-bold tabular-nums', tint)}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-fg-dim">{sub}</div>}
    </div>
  );
}

// Radial gauge for the Speed-to-Lead rate. The arc + centre number take the band colour.
function Gauge({ value, size = 168 }: { value: number | null; size?: number }) {
  const stroke = Math.round(size / 13);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const v = value == null ? 0 : Math.max(0, Math.min(100, value));
  const colorCls = speedText(value);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-current text-surface-2" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          className={cn('stroke-current transition-[stroke-dashoffset] duration-700', colorCls)}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - v / 100)} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-mono font-bold tabular-nums', colorCls, size < 140 ? 'text-2xl' : 'text-4xl')}>{value == null ? '—' : `${value}`}</span>
        {value != null && <span className={cn('text-[10px] font-semibold', colorCls)}>%</span>}
      </div>
    </div>
  );
}
