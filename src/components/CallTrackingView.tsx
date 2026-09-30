'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2, RefreshCw, ArrowLeft, Search, ChevronRight, Zap, Users, CalendarDays,
  PhoneOutgoing, PhoneOff, PhoneCall, Gauge as GaugeIcon, Moon, AlertTriangle, CheckCircle2, Table2,
} from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { ClientSpeed, ClientSpeedRow, ShiftScorecard, ShiftRow, LeadEval } from '@/lib/csrMetrics';
import { SPEED_TO_LEAD_MINUTES, CSR_SETTERS } from '@/lib/csrConstants';
import { syncClientCallsAction } from '@/app/actions/sync';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { InfoTip } from '@/components/InfoTip';
import { Tooltip } from '@/components/Tooltip';
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

// ─── Outcome bar: one shape per row instead of five numbers ──────────────────
// Segments, left to right: dialled ≤30m (green) · dialled late (amber) · never phoned
// (red). Width = share of that row's leads. Exact counts live in the hover tooltip.
function OutcomeBar({ leads, attempted, neverCalled, connected, className }: { leads: number; attempted: number; neverCalled: number; connected?: number; className?: string }) {
  const late = Math.max(0, leads - attempted - neverCalled);
  const seg = [
    { n: attempted, cls: 'bg-green', label: `dialled ≤${SPEED_TO_LEAD_MINUTES}m` },
    { n: late, cls: 'bg-yellow', label: 'dialled late' },
    { n: neverCalled, cls: 'bg-red', label: 'never phoned' },
  ];
  const tip = leads === 0 ? 'No leads' : `${leads} leads · ${seg.map(x => `${x.n} ${x.label}`).join(' · ')}${connected != null ? ` · ${connected} connected` : ''}`;
  return (
    <Tooltip label={tip} className={cn('block w-full', className)}>
      <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-surface-2">
        {leads > 0 && seg.filter(x => x.n > 0).map(x => (
          <div key={x.label} className={cn('h-full rounded-full', x.cls)} style={{ width: `${(x.n / leads) * 100}%` }} />
        ))}
      </div>
    </Tooltip>
  );
}

function BarLegend() {
  return (
    <div className="flex items-center gap-3 text-[10px] text-fg-muted">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green" /> Dialled ≤{SPEED_TO_LEAD_MINUTES}m</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-yellow" /> Dialled late</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red" /> Never phoned</span>
    </div>
  );
}

// "Needs attention" — the sentence you read instead of the table.
function Attention({ items, allGood }: { items: { key: string; text: string; sub?: string }[]; allGood: string }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-green/30 bg-green/10 px-4 py-2.5 text-xs text-green">
        <CheckCircle2 size={14} /> {allGood}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-yellow/30 bg-yellow/10 px-4 py-3">
      <div className="mb-1.5 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-yellow"><AlertTriangle size={12} /> Needs attention</div>
      <ul className="space-y-1">
        {items.map(i => (
          <li key={i.key} className="text-xs text-fg">{i.text}{i.sub && <span className="text-fg-dim"> · {i.sub}</span>}</li>
        ))}
      </ul>
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

  // Below-target clients with enough leads to mean something, worst first.
  const attention = useMemo(() => {
    const below = overview
      .filter(r => r.row.leads >= 5 && r.row.pct != null && r.row.pct < 75)
      .sort((a, b) => b.row.neverCalled - a.row.neverCalled || (a.row.pct ?? 0) - (b.row.pct ?? 0));
    const items: { key: string; text: string; sub?: string }[] = below.slice(0, 4).map(r => ({
      key: r.client.client_id,
      text: `${r.client.client_name} · ${r.row.pct}% — ${r.row.neverCalled} of ${r.row.leads} leads never phoned`,
      sub: setterLabel(r.row.csr),
    }));
    if (below.length > 4) items.push({ key: 'more', text: `…and ${below.length - 4} more clients below target`, sub: undefined });
    return items;
  }, [overview]);

  return (
    <>
      <Attention items={attention} allGood="Every measured client is on target for this range." />

      <TeamBand leads={team.leads} attempted={team.attempted} connected={team.connected} never={team.never} pct={team.pct} note="all measured clients" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
          <Users size={13} className="text-pink" /> By client <InfoTip text="Only B2C clients with an assigned setter are measured. Self-booking clients book themselves, so a phone-response KPI doesn't apply. Hover a bar for the exact counts." />
        </div>
        <BarLegend />
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
              <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
              <th className="w-[38%] px-3 py-2.5 text-left font-semibold">Outcome</th>
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
                <td className="px-3 py-3"><OutcomeBar leads={r.row.leads} attempted={r.row.attempted} neverCalled={r.row.neverCalled} connected={r.row.connected} /></td>
                <td className={cn('px-3 py-3 text-right font-mono font-semibold tabular-nums', speedText(r.row.pct))}>{pct(r.row.pct)}</td>
                <td className="px-3 py-3 text-right"><TierChip v={r.row.pct} /></td>
                <td className="pr-3"><ChevronRight size={15} className="text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-fg-dim">{search ? `No clients match “${search}”.` : 'No measured clients in this range.'}</td></tr>}
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

// ─── Shifts: a calendar of every setter's shifts, coloured by that shift's rate ──

function ShiftsView({ data }: { data: ShiftScorecard }) {
  const [picked, setPicked] = useState<ShiftRow | null>(null);
  const [showTable, setShowTable] = useState(false);

  // Columns = every day with a check-in, oldest → newest. Rows = setters.
  const days = useMemo(() => [...data.days].sort((a, b) => a.date.localeCompare(b.date)), [data.days]);
  const setters = useMemo(() => {
    const order = CSR_SETTERS.map(c => c.key);
    return [...new Set(days.flatMap(d => d.rows.map(r => r.csr)))].sort((a, b) => (order.indexOf(a) + 99) - (order.indexOf(b) + 99) || a.localeCompare(b));
  }, [days]);
  const cell = (csr: string, date: string) => days.find(d => d.date === date)?.rows.find(r => r.csr === csr) ?? null;

  const attention = useMemo(() => {
    const bad = days.flatMap(d => d.rows).filter(r => !r.off && r.leads >= 3 && r.pct != null && r.pct < 75)
      .sort((a, b) => b.date.localeCompare(a.date) || b.neverCalled - a.neverCalled);
    const items: { key: string; text: string; sub?: string }[] = bad.slice(0, 4).map(r => ({ key: `${r.date}-${r.csr}`, text: `${setterLabel(r.csr)} · ${fmtDay(r.date)} · ${r.pct}% — ${r.neverCalled} of ${r.leads} leads never phoned on a ${r.start}–${r.end} shift`, sub: r.coverLeads ? `${r.coverLeads} were cover` : undefined }));
    if (bad.length > 4) items.push({ key: 'more', text: `…and ${bad.length - 4} more shifts below target`, sub: undefined });
    return items;
  }, [days]);

  if (days.length === 0) {
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
      <Attention items={attention} allGood="Every shift with leads in this range hit target." />

      {/* Per-setter summary for the range */}
      <div className="grid gap-3 sm:grid-cols-3">
        {data.setters.map(s => (
          <div key={s.csr} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-fg">{setterLabel(s.csr)}</div>
              <TierChip v={s.pct} />
            </div>
            <div className={cn('mt-1 font-mono text-3xl font-bold tabular-nums', speedText(s.pct))}>{pct(s.pct)}</div>
            <OutcomeBar leads={s.leads} attempted={s.attempted} neverCalled={s.neverCalled} connected={s.connected} className="mt-2" />
            <div className="mt-1.5 text-[11px] text-fg-dim">{s.leads} leads over {s.shifts} shift{s.shifts === 1 ? '' : 's'}</div>
          </div>
        ))}
      </div>

      {/* Calendar: one row per setter, one cell per day */}
      <div className="rounded-2xl border border-border bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-semibold text-fg"><CalendarDays size={14} className="text-pink" /> Shift calendar <span className="text-xs font-normal text-fg-dim">· click a day for the detail</span></div>
          <div className="flex items-center gap-3 text-[10px] text-fg-muted">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-green/80" /> ≥80%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-yellow/80" /> 75–80%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red/80" /> &lt;75%</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-border bg-surface-2" /> On, no leads</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-border" /> Off</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-1">
            <thead>
              <tr>
                <th className="w-20" />
                {days.map(d => {
                  const [y, m, dd] = d.date.split('-').map(Number);
                  const dow = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
                  return <th key={d.date} className={cn('px-0 pb-1 text-center text-[9px] font-medium tabular-nums', dow === 0 || dow === 6 ? 'text-fg-dim' : 'text-fg-muted')}>{dd}<br /><span className="text-[8px]">{DOW[dow][0]}</span></th>;
                })}
              </tr>
            </thead>
            <tbody>
              {setters.map(csr => (
                <tr key={csr}>
                  <td className="pr-2 text-xs font-medium text-fg">{setterLabel(csr)}</td>
                  {days.map(d => <ShiftCell key={d.date} r={cell(csr, d.date)} active={picked?.csr === csr && picked?.date === d.date} onClick={() => { const r = cell(csr, d.date); setPicked(r && !r.off ? r : null); }} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {picked && (
          <div className="mt-4 rounded-xl border border-border bg-surface-2/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-fg">{setterLabel(picked.csr)} · {fmtDay(picked.date)}</div>
                <div className="text-xs text-fg-muted">On shift {picked.start}–{picked.end}{picked.coverLeads > 0 && <> · {picked.coverLeads} of the leads were cover for a colleague&apos;s client</>}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn('font-mono text-2xl font-bold tabular-nums', speedText(picked.pct))}>{pct(picked.pct)}</span>
                <TierChip v={picked.pct} />
              </div>
            </div>
            <OutcomeBar leads={picked.leads} attempted={picked.attempted} neverCalled={picked.neverCalled} connected={picked.connected} className="mt-3" />
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-fg-muted sm:grid-cols-4">
              <span>{picked.leads} leads on this shift</span>
              <span className="text-green">{picked.attempted} dialled ≤{SPEED_TO_LEAD_MINUTES}m</span>
              <span>{picked.connected} connected</span>
              <span className="text-red">{picked.neverCalled} never phoned</span>
            </div>
          </div>
        )}
      </div>

      {/* Table view, for anyone who wants the numbers */}
      <div className="rounded-2xl border border-border bg-surface">
        <button onClick={() => setShowTable(v => !v)} className="flex w-full items-center justify-between px-5 py-3 text-left">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted"><Table2 size={13} /> Day-by-day table</span>
          <ChevronRight size={15} className={cn('text-fg-dim transition-transform', showTable && 'rotate-90')} />
        </button>
        {showTable && (
          <table className="w-full border-t border-border text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                <th className="px-4 py-2.5 text-left font-semibold">Setter</th>
                <th className="px-3 py-2.5 text-left font-semibold">Shift</th>
                <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
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
        )}
      </div>
    </div>
  );
}

function ShiftCell({ r, active, onClick }: { r: ShiftRow | null; active: boolean; onClick: () => void }) {
  if (!r) return <td><div className="h-7 w-7 rounded-md" /></td>;
  const label = r.off
    ? `${setterLabel(r.csr)} · ${fmtDay(r.date)} · off`
    : `${setterLabel(r.csr)} · ${fmtDay(r.date)} · ${r.start}–${r.end} · ${r.leads === 0 ? 'no leads' : `${r.attempted}/${r.leads} dialled ≤${SPEED_TO_LEAD_MINUTES}m (${r.pct}%)`}`;
  const cls = r.off ? 'bg-border'
    : r.leads === 0 ? 'border border-border bg-surface-2'
    : (r.pct ?? 0) >= 80 ? 'bg-green/80'
    : (r.pct ?? 0) >= 75 ? 'bg-yellow/80'
    : 'bg-red/80';
  return (
    <td>
      <Tooltip label={label}>
        <button onClick={onClick} disabled={r.off}
          className={cn('flex h-7 w-7 items-center justify-center rounded-md text-[9px] font-semibold tabular-nums transition-transform', cls, !r.off && 'hover:scale-110', active && 'ring-2 ring-pink ring-offset-1 ring-offset-surface', r.off ? 'text-fg-dim' : r.leads === 0 ? 'text-fg-dim' : 'text-black')}>
          {r.off ? <Moon size={10} /> : r.leads > 0 ? r.leads : ''}
        </button>
      </Tooltip>
    </td>
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
