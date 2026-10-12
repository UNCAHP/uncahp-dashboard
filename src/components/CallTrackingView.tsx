'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { NavLink, useNav } from '@/components/NavProgress';
import {
  Loader2, RefreshCw, ArrowLeft, Search, ChevronRight, ChevronUp, ChevronDown, Users, Building2, PhoneOutgoing, Moon,
} from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { ClientSpeed, ClientSpeedRow, SetterCard, ShiftRow, LeadEval } from '@/lib/csrMetrics';
import { SPEED_TO_LEAD_MINUTES, CSR_SETTERS, SPEED_TARGET_PCT, SPEED_TARGET_TEXT, UNTRACKED_SETTERS, isTrackedSetter } from '@/lib/csrConstants';
import { syncClientCallsAction } from '@/app/actions/sync';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { InfoTip } from '@/components/InfoTip';
import { Tooltip } from '@/components/Tooltip';
import { cn, formatNumber } from '@/lib/utils';

export type CallOverviewRow = { client: ClientOption; row: ClientSpeedRow };
export type CallDetail = { client: ClientOption; speed: ClientSpeed };
type Tab = 'clients' | 'setters';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
};
const fmtClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const rateOf = (n: number, d: number) => (d ? +((100 * n) / d).toFixed(1) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const setterLabel = (key: string | null): string =>
  key ? (CSR_SETTERS.find(s => s.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1)) : 'Self booking';
const selfBookedNote = (n: number) => (n ? `${n} self-booked within ${SPEED_TO_LEAD_MINUTES}m, not counted` : '');

// Colour + status come straight from the rate against the single 70% standard.
const onTarget = (v: number | null) => v != null && v >= SPEED_TARGET_PCT;
const speedText = (v: number | null) => (v == null ? 'text-fg-dim' : onTarget(v) ? 'text-green' : 'text-red');
const TierChip = ({ v }: { v: number | null }) =>
  v == null ? null
    : <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', onTarget(v) ? 'bg-green/15 text-green' : 'bg-red/15 text-red')}>{onTarget(v) ? 'On target' : 'Below target'}</span>;

const DEFINITION = `A new lead = a contact with a campaign REF tag (e.g. dlc-ec-01-aug26) and a phone number, arriving while the client's setter (or cover) was on shift per the daily Start of Day check-in. Test submissions are left out, and so are leads that paid a deposit within 30 min before anyone called them. Attempted = an outbound dial within ${SPEED_TO_LEAD_MINUTES} min, answered or not — the scored KPI. Connected = a completed call of 60s+ in that window. A lead nobody phoned counts as a miss. ${SPEED_TARGET_TEXT}`;

const TABS = [['clients', 'Clients', Building2], ['setters', 'Setters', Users]] as const;

export function CallTrackingView({
  overview, detail, setters, clients, tab, since, until,
}: {
  overview: CallOverviewRow[];
  detail: CallDetail | null;
  setters: SetterCard[];
  clients: ClientOption[];
  tab: Tab;
  since: string;
  until: string;
}) {
  const { navigate: go } = useNav();
  // The tab you click is selected at once, while its data loads.
  const [shownTab, setShownTab] = useState<Tab>(tab);
  // Opening a client keeps the tab you came from, so "back" returns you there.
  const hrefFor = (next: { client?: string; tab?: Tab }) => {
    const p = new URLSearchParams({ view: 'calls', since, until });
    if (next.client) p.set('client', next.client);
    if ((next.tab ?? tab) === 'setters') p.set('ctab', 'setters');
    return `/?${p.toString()}`;
  };
  const navigate = (next: { client?: string; tab?: Tab }) => {
    if (next.tab) setShownTab(next.tab);
    go(hrefFor(next));
  };
  const open = (id: string) => navigate({ client: id });
  const clientHref = (id: string) => hrefFor({ client: id });

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Call Tracking</h1>
          <p className="mt-1 text-sm text-fg-muted">Speed to Lead: new leads dialled within {SPEED_TO_LEAD_MINUTES} minutes while a setter was on shift. Target {SPEED_TARGET_PCT}%.</p>
        </div>
        {!detail && (
          <div role="tablist" aria-label="Speed to Lead view" className="inline-flex rounded-lg border border-border bg-surface p-0.5">
            {TABS.map(([key, label, Icon]) => (
              <button key={key} role="tab" aria-selected={shownTab === key} onClick={() => navigate({ tab: key })}
                className={cn('inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors', shownTab === key ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {detail ? (
        <>
          <button onClick={() => navigate({})} className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-pink">
            <ArrowLeft size={14} /> {tab === 'setters' ? 'All setters' : 'All clients'}
          </button>
          <Detail row={detail} />
        </>
      ) : tab === 'setters' ? (
        <SettersView setters={setters} clients={clients} onOpen={open} hrefFor={clientHref} />
      ) : (
        <ClientsView overview={overview} onOpen={open} hrefFor={clientHref} />
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
    { n: attempted, cls: 'bg-green', label: `dialled ≤${SPEED_TO_LEAD_MINUTES}m`, extra: connected != null ? ` (${connected} connected)` : '' },
    { n: late, cls: 'bg-yellow', label: 'dialled late', extra: '' },
    { n: neverCalled, cls: 'bg-red', label: 'never phoned', extra: '' },
  ];
  const share = (n: number) => (leads ? Math.round((1000 * n) / leads) / 10 : 0);
  return (
    <div className={cn('flex h-2.5 w-full gap-0.5 overflow-visible rounded-full bg-surface-2', className)}>
      {leads > 0 && seg.filter(x => x.n > 0).map(x => (
        // Each segment explains itself on hover — one tooltip per colour, not one for the bar.
        <Tooltip key={x.label} always label={`${x.n} of ${leads} ${x.label} · ${share(x.n)}%${x.extra}`} className="h-full cursor-default" style={{ width: `${(x.n / leads) * 100}%` }}>
          <div className={cn('h-full w-full rounded-full transition-opacity hover:opacity-80', x.cls)} />
        </Tooltip>
      ))}
    </div>
  );
}

function BarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-muted">
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-green" /> Dialled ≤{SPEED_TO_LEAD_MINUTES}m</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-yellow" /> Dialled late</span>
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red" /> Never phoned</span>
    </div>
  );
}

// ─── Summary: the one headline for whatever is on screen ─────────────────────
// The rate, the bar that explains it, and the four counts the bar is made of.

function Summary({ leads, attempted, connected, never, rate, note }: { leads: number; attempted: number; connected: number; never: number; rate: number | null; note?: string }) {
  const late = Math.max(0, leads - attempted - never);
  return (
    <section aria-label="Speed to Lead summary" className="rounded-2xl border border-border bg-surface p-6">
      <div className="grid items-center gap-x-10 gap-y-5 lg:grid-cols-[auto_1fr]">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Speed to Lead <InfoTip text={DEFINITION} /></div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className={cn('font-mono text-5xl font-bold tabular-nums leading-none', speedText(rate))}>{pct(rate)}</span>
            <TierChip v={rate} />
          </div>
        </div>
        <div className="min-w-0">
          <OutcomeBar leads={leads} attempted={attempted} neverCalled={never} connected={connected} className="h-3" />
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Stat label="Leads on shift" value={leads} />
            <Stat label={`Dialled ≤${SPEED_TO_LEAD_MINUTES}m`} value={attempted} dot="bg-green" sub={connected ? `${connected} connected` : undefined} />
            <Stat label="Dialled late" value={late} dot="bg-yellow" />
            <Stat label="Never phoned" value={never} dot="bg-red" />
          </dl>
        </div>
      </div>
      {note && <p className="mt-5 border-t border-border pt-3 text-xs text-fg-dim">{note}</p>}
    </section>
  );
}

function Stat({ label, value, dot, sub }: { label: string; value: number; dot?: string; sub?: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-[11px] text-fg-muted">{dot && <span className={cn('h-2 w-2 rounded-sm', dot)} />}{label}</dt>
      <dd className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-fg">
        {formatNumber(value)}{sub && <span className="ml-2 font-sans text-[11px] font-normal text-fg-dim">{sub}</span>}
      </dd>
    </div>
  );
}

// ─── Clients: one row per client ─────────────────────────────────────────────

type SortKey = 'rate' | 'leads' | 'name';

// Rows open on click anywhere; the client name is also a real link, so a row can be reached
// with the keyboard and opened in a new tab.
function ClientsView({ overview, onOpen, hrefFor }: { overview: CallOverviewRow[]; onOpen: (client: string) => void; hrefFor: (client: string) => string }) {
  const [search, setSearch] = useState('');
  // Worst first by default: the clients that need a look are at the top of the table.
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'rate', asc: true });

  const team = useMemo(() => overview.reduce((a, r) => ({
    leads: a.leads + r.row.leads, attempted: a.attempted + r.row.attempted, connected: a.connected + r.row.connected, never: a.never + r.row.neverCalled, selfBooked: a.selfBooked + r.row.selfBooked,
  }), { leads: 0, attempted: 0, connected: 0, never: 0, selfBooked: 0 }), [overview]);

  const withLeads = overview.filter(r => r.row.leads > 0);
  const below = withLeads.filter(r => !onTarget(r.row.pct)).length;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const dir = sort.asc ? 1 : -1;
    const byName = (a: CallOverviewRow, b: CallOverviewRow) => a.client.client_name.localeCompare(b.client.client_name);
    return overview
      .filter(r => !q || r.client.client_name.toLowerCase().includes(q) || setterLabel(r.row.csr).toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort.key === 'name') return dir * byName(a, b);
        // Clients with no leads have nothing to rank; they always sit at the bottom.
        const empty = Number(a.row.leads === 0) - Number(b.row.leads === 0);
        if (empty) return empty;
        const d = sort.key === 'leads' ? a.row.leads - b.row.leads : (a.row.pct ?? 0) - (b.row.pct ?? 0);
        return dir * d || b.row.leads - a.row.leads || byName(a, b);
      });
  }, [overview, search, sort]);

  const toggle = (key: SortKey) => setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: key !== 'leads' }));

  return (
    <>
      <Summary leads={team.leads} attempted={team.attempted} connected={team.connected} never={team.never} rate={rateOf(team.attempted, team.leads)}
        note={[`All measured clients`, selfBookedNote(team.selfBooked)].filter(Boolean).join(' · ')} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {withLeads.length === 0 ? 'No leads on shift in this range.'
            : <><span className="font-semibold text-fg">{plural(withLeads.length, 'client')}</span> with leads · {below === 0 ? <span className="text-green">all on target</span> : <><span className="font-semibold text-red">{below}</span> below target</>}</>}
        </p>
        <div className="relative w-full max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients or setters…" aria-label="Search clients or setters"
            className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-dim" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-muted">
              <SortTh label="Client" k="name" sort={sort} onSort={toggle} className="px-5 text-left" />
              <th className="px-3 py-3 text-left font-semibold">Setter</th>
              <SortTh label="Leads" k="leads" sort={sort} onSort={toggle} className="px-3 text-right" />
              <th className="w-[36%] px-3 py-3 text-left font-semibold"><BarLegend /></th>
              <SortTh label="Speed to Lead" k="rate" sort={sort} onSort={toggle} className="px-3 text-right" />
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.client.client_id} onClick={() => onOpen(r.client.client_id)} className={cn('group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2', r.row.leads === 0 && 'text-fg-dim')}>
                <td className="px-5 py-3">
                  <span className="inline-flex items-center gap-3"><Badge c={r.client} /><NavLink href={hrefFor(r.client.client_id)} onClick={e => e.stopPropagation()} className={cn('rounded font-medium group-hover:text-pink', r.row.leads === 0 ? 'text-fg-muted' : 'text-fg')}>{r.client.client_name}</NavLink></span>
                </td>
                <td className="px-3 py-3 text-fg-muted">{setterLabel(r.row.csr)}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums">{r.row.leads}</td>
                <td className="px-3 py-3">{r.row.leads > 0 ? <OutcomeBar leads={r.row.leads} attempted={r.row.attempted} neverCalled={r.row.neverCalled} connected={r.row.connected} /> : <span className="text-xs">No leads on shift</span>}</td>
                <td className={cn('px-3 py-3 text-right font-mono text-base font-semibold tabular-nums', speedText(r.row.pct))}>{pct(r.row.pct)}</td>
                <td className="pr-4 text-right"><ChevronRight size={15} className="inline text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-fg-dim">{search ? `No clients match “${search}”.` : 'No measured clients in this range.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SortTh({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; asc: boolean }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Arrow = sort.asc ? ChevronUp : ChevronDown;
  return (
    <th aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'} className={cn('py-3 font-semibold', className)}>
      <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-fg', active && 'text-fg')}>
        {label} <Arrow size={12} className={cn(!active && 'opacity-0')} />
      </button>
    </th>
  );
}

// ─── Setters: one card per setter, across every client they answered for ─────

function SettersView({ setters, clients, onOpen, hrefFor }: { setters: SetterCard[]; clients: ClientOption[]; onOpen: (client: string) => void; hrefFor: (client: string) => string }) {
  const byId = useMemo(() => new Map(clients.map(c => [c.client_id, c])), [clients]);
  const team = setters.reduce((a, s) => ({
    leads: a.leads + s.leads, attempted: a.attempted + s.attempted, connected: a.connected + s.connected, never: a.never + s.neverCalled, selfBooked: a.selfBooked + s.selfBooked,
  }), { leads: 0, attempted: 0, connected: 0, never: 0, selfBooked: 0 });
  const untracked = UNTRACKED_SETTERS.map(setterLabel);

  return (
    <>
      <Summary leads={team.leads} attempted={team.attempted} connected={team.connected} never={team.never} rate={rateOf(team.attempted, team.leads)}
        note={[`All setters`, selfBookedNote(team.selfBooked), untracked.length ? `${untracked.join(', ')} not tracked` : ''].filter(Boolean).join(' · ')} />

      {setters.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface px-5 py-12 text-center text-sm text-fg-dim">No setters with assigned clients or check-ins in this range.</div>
      )}

      {/* Side by side when there's room, so setters can be compared at a glance. Below
          that width a half-card can't hold a client name beside its bar, so they stack. */}
      <div className="grid items-start gap-6 2xl:grid-cols-2">
      {setters.map(s => {
        const own = s.clients.filter(c => !c.cover).length;
        const late = Math.max(0, s.leads - s.attempted - s.neverCalled);
        return (
          <section key={s.csr} aria-label={setterLabel(s.csr)} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
                <div className="min-w-0">
                  <h2 className="text-xl font-bold tracking-tight text-fg">{setterLabel(s.csr)}</h2>
                  <p className="mt-0.5 text-xs text-fg-muted">{plural(own, 'client')} · {plural(s.shifts, 'shift')}{s.medianMinutes != null && ` · median ${s.medianMinutes}m to dial`}</p>
                </div>
                <div className="flex items-baseline gap-3">
                  <TierChip v={s.pct} />
                  <span className={cn('font-mono text-4xl font-bold tabular-nums leading-none', speedText(s.pct))}>{pct(s.pct)}</span>
                </div>
              </div>
              <OutcomeBar leads={s.leads} attempted={s.attempted} neverCalled={s.neverCalled} connected={s.connected} className="mt-5 h-3" />
              <p className="mt-2 text-xs text-fg-muted">
                {s.leads === 0 ? 'No leads on shift in this range.' : <>
                  <span className="font-mono font-semibold tabular-nums text-fg">{s.attempted}</span> of <span className="font-mono font-semibold tabular-nums text-fg">{s.leads}</span> leads dialled within {SPEED_TO_LEAD_MINUTES}m
                  {late > 0 && <> · <span className="font-mono font-semibold tabular-nums text-yellow">{late}</span> late</>}
                  {s.neverCalled > 0 && <> · <span className="font-mono font-semibold tabular-nums text-red">{s.neverCalled}</span> never phoned</>}
                </>}
              </p>
            </div>

            {s.days.length > 0 && (
              <div className="flex items-center gap-4 border-t border-border px-6 py-3">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Shifts</span>
                <div className="flex min-w-0 gap-1 overflow-x-auto py-1">
                  {s.days.map(d => <ShiftCell key={d.date} r={d} />)}
                </div>
              </div>
            )}

            <table className="w-full border-t border-border text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-muted">
                  <th className="px-6 py-2.5 text-left font-semibold">Client</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                  <th className="w-[28%] px-3 py-2.5 text-left font-semibold">Outcome</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Rate</th>
                  <th className="w-9" />
                </tr>
              </thead>
              <tbody>
                {s.clients.map(c => {
                  const client = byId.get(c.client_id);
                  if (!client) return null;
                  return (
                    <tr key={c.client_id} onClick={() => onOpen(c.client_id)} className={cn('group cursor-pointer border-b border-border/60 transition-colors last:border-0 hover:bg-surface-2', c.leads === 0 && 'text-fg-dim')}>
                      <td className="px-6 py-2.5">
                        <span className="inline-flex items-center gap-3">
                          <Badge c={client} />
                          <NavLink href={hrefFor(c.client_id)} onClick={e => e.stopPropagation()} className={cn('rounded font-medium group-hover:text-pink', c.leads === 0 ? 'text-fg-muted' : 'text-fg')}>{client.client_name}</NavLink>
                          {c.cover && <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-muted">cover</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{c.leads}</td>
                      <td className="px-3 py-2.5">{c.leads > 0 ? <OutcomeBar leads={c.leads} attempted={c.attempted} neverCalled={c.neverCalled} connected={c.connected} /> : <span className="text-xs">No leads</span>}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-mono text-base font-semibold tabular-nums', speedText(c.pct))}>{pct(c.pct)}</td>
                      <td className="pr-4 text-right"><ChevronRight size={15} className="inline text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
      </div>
    </>
  );
}

// One day of a setter's shift history: colour is that day's rate, the number is its leads.
function ShiftCell({ r }: { r: ShiftRow }) {
  const day = Number(r.date.slice(8, 10));
  const label = r.off
    ? `${fmtDay(r.date)} · off`
    : `${fmtDay(r.date)} · ${r.start}–${r.end} · ${r.leads === 0 ? 'no leads' : `${r.attempted} of ${r.leads} dialled ≤${SPEED_TO_LEAD_MINUTES}m (${r.pct}%)`}${r.coverLeads ? ` · ${r.coverLeads} cover` : ''}`;
  const cls = r.off ? 'bg-border text-fg-dim'
    : r.leads === 0 ? 'border border-border bg-surface-2 text-fg-dim'
    : onTarget(r.pct) ? 'bg-green text-black'
    : 'bg-red text-white';
  return (
    <Tooltip label={label} always className="shrink-0">
      <div className="flex w-8 flex-col items-center gap-1">
        <div className={cn('flex h-7 w-8 items-center justify-center rounded-md font-mono text-[10px] font-semibold tabular-nums', cls)}>
          {r.off ? <Moon size={11} /> : r.leads > 0 ? r.leads : ''}
        </div>
        <span className="text-[9px] tabular-nums text-fg-dim">{day}</span>
      </div>
    </Tooltip>
  );
}

// ─── Detail: one client — headline, who dialled, and the lead-by-lead log ────

function Detail({ row }: { row: CallDetail }) {
  const { client, speed: s } = row;
  const [pending, start] = useTransition();
  const sync = () => {
    start(async () => {
      const res = await syncClientCallsAction(client.client_id, 30);
      if (res.ok) toast.success('Calls synced', { description: `${res.calls ?? 0} calls from ${res.conversationsScanned ?? 0} conversations.` });
      else toast.error('Call sync failed', { description: res.error });
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <Badge c={client} big />
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-fg">{client.client_name}</h2>
            <p className="text-xs text-fg-muted">Assigned setter · <span className="text-fg">{setterLabel(s.assigned)}</span>{s.assigned && !isTrackedSetter(s.assigned) && <span className="ml-1.5 rounded bg-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-dim">Speed to Lead not tracked</span>}</p>
          </div>
        </div>
        <button onClick={sync} disabled={pending}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync calls
        </button>
      </div>

      {s.callsOnFile === 0 && (
        <div className="rounded-xl border border-yellow/30 bg-yellow/10 px-4 py-2.5 text-xs text-yellow">
          No calls on file for this client yet — every lead below shows as never phoned. Hit <span className="font-semibold">Sync calls</span> to pull recent activity from GHL.
        </div>
      )}

      <Summary leads={s.leadsInHours} attempted={s.contactedWithin} connected={s.connectedWithin} never={s.neverCalled} rate={s.pct}
        note={[s.medianMinutes != null ? `Median ${s.medianMinutes}m to first dial` : 'No dials yet', selfBookedNote(s.selfBooked)].filter(Boolean).join(' · ')} />

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
  const measured = leads.filter(l => !l.selfBooked).length;
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="inline-flex items-center gap-2 text-sm font-semibold text-fg"><PhoneOutgoing size={14} className="text-pink" /> Lead log <span className="text-xs font-normal text-fg-dim">· {measured} measured lead{measured === 1 ? '' : 's'}{leads.length > measured ? ` + ${leads.length - measured} self-booked` : ''}, newest first</span></div>
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
              <tr key={l.source_id} className={cn('border-b border-border/40', l.selfBooked && 'opacity-60')}>
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs tabular-nums text-fg-muted">{fmtDay(l.day)} · {fmtClock(l.arrivedAt)}</td>
                <td className="px-2 py-2 text-fg">{l.name}</td>
                <td className="px-2 py-2 text-fg-muted">{setterLabel(l.responsible)}{l.cover && <span className="ml-1 rounded bg-border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-dim">cover</span>}</td>
                <td className={cn('whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums', l.minsToDial == null ? 'text-red' : l.attempted ? 'text-green' : 'text-yellow')}>
                  {l.minsToDial == null ? 'never' : l.minsToDial < 60 ? `${l.minsToDial}m` : l.minsToDial < 1440 ? `${Math.round(l.minsToDial / 60)}h` : `${Math.round(l.minsToDial / 1440)}d`}
                </td>
                <td className="px-2 py-2 text-xs text-fg-muted">{l.firstDialBy ?? '—'}</td>
                <td className="px-2 py-2 text-right">
                  {l.selfBooked ? <Tooltip always label={`Paid a deposit ${l.paidAt ? fmtDay(l.paidAt.slice(0, 10)) + ' ' + fmtClock(l.paidAt) : ''} within 30 min, before any call — not counted`} className="inline-block"><span className="rounded-md bg-pink/15 px-2 py-0.5 text-[10px] font-semibold text-pink">Self-booked</span></Tooltip>
                    : l.connected ? <span className="rounded-md bg-green/15 px-2 py-0.5 text-[10px] font-semibold text-green">Connected</span>
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
