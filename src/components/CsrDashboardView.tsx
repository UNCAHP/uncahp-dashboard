'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { NavLink } from '@/components/NavProgress';
import {
  Loader2, RefreshCw, ArrowLeft, ChevronRight, ChevronDown, ChevronUp, Users, PhoneOutgoing, Moon, CalendarCheck, Zap, ExternalLink,
} from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { ClientSpeed, ClientSpeedRow, SetterCard, ShiftRow, LeadEval } from '@/lib/csrMetrics';
import type { BookingsBoard, AccountBookings, BookingCount } from '@/lib/csrBookings';
import { SPEED_TO_LEAD_MINUTES, CSR_SETTERS, SPEED_TARGET_PCT, SPEED_TARGET_TEXT, SPEED_WINDOW_TEXT, TEAM_SPEED_EXCLUDES, TEAM_SPEED_EXCLUDED_NAMES, isTrackedSetter } from '@/lib/csrConstants';
import { syncClientCallsAction, syncSheetAction } from '@/app/actions/sync';
import { useRouter } from 'next/navigation';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { InfoTip } from '@/components/InfoTip';
import { Tooltip } from '@/components/Tooltip';
import { cn, formatNumber } from '@/lib/utils';

export type CallOverviewRow = { client: ClientOption; row: ClientSpeedRow };
export type CallDetail = { client: ClientOption; speed: ClientSpeed };
// Whose dashboard is open: the whole team, or one setter (lowercased first name).
export type CsrKey = 'team' | string;
export type CsrPart = 'bookings' | 'stl';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDay = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
};
const fmtShort = (iso: string): string => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
};
const fmtClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false });
const pct = (v: number | null) => (v == null ? '—' : `${v}%`);
const rateOf = (n: number, d: number) => (d ? +((100 * n) / d).toFixed(1) : null);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const setterLabel = (key: string | null): string =>
  key ? (CSR_SETTERS.find(s => s.key === key)?.label ?? key.charAt(0).toUpperCase() + key.slice(1)) : 'Self booking';
const personLabel = (key: CsrKey) => (key === 'team' ? 'CSR Team' : setterLabel(key));
const teamSpeedNote = TEAM_SPEED_EXCLUDED_NAMES ? `Team rate leaves out ${TEAM_SPEED_EXCLUDED_NAMES}` : '';
const selfBookedNote = (n: number) => (n ? `${n} self-booked within ${SPEED_TO_LEAD_MINUTES}m, not counted` : '');
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const num1 = (n: number) => (Number.isInteger(n) ? `${n}` : n.toFixed(1));
// The lead's contact in GHL, where the conversation and call history live.
const ghlContact = (locationId: string, contactId: string) =>
  `https://app.gohighlevel.com/v2/location/${encodeURIComponent(locationId)}/contacts/detail/${encodeURIComponent(contactId)}`;

// Colour + status come straight from the rate against the single 70% standard.
const onTarget = (v: number | null) => v != null && v >= SPEED_TARGET_PCT;
const speedText = (v: number | null) => (v == null ? 'text-fg-dim' : onTarget(v) ? 'text-green' : 'text-red');
const TierChip = ({ v }: { v: number | null }) =>
  v == null ? null
    : <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', onTarget(v) ? 'bg-green/15 text-green' : 'bg-red/15 text-red')}>{onTarget(v) ? 'On target' : 'Below target'}</span>;

const DEFINITION = `A new lead = a contact with a campaign REF tag (e.g. dlc-ec-01-aug26) and a phone number, on an account assigned to a setter who was working that day per the daily Start of Day check-in. Covers aren't tracked: leads on a colleague's accounts don't count for anyone. ${SPEED_WINDOW_TEXT} Test submissions are left out, and so are leads that paid a deposit within 30 min before anyone called them. Attempted = an outbound dial within ${SPEED_TO_LEAD_MINUTES} min, answered or not — the scored KPI. Connected = a completed call of 60s+ in that window. A lead nobody phoned counts as a miss. ${SPEED_TARGET_TEXT}`;

// ─── Speed to Lead, rolled up for whoever's dashboard is open ────────────────

type SpeedTotals = { leads: number; attempted: number; connected: number; never: number; selfBooked: number; pct: number | null };

function speedFor(key: CsrKey, setters: SetterCard[]): SpeedTotals {
  if (key === 'team') {
    // Every lead belongs to exactly one setter's card (the one responsible for it), so the
    // cards add up to the team, minus the setters left out of the team rate.
    const t = setters.filter(c => !TEAM_SPEED_EXCLUDES.includes(c.csr)).reduce((a, c) => ({
      leads: a.leads + c.leads, attempted: a.attempted + c.attempted, connected: a.connected + c.connected, never: a.never + c.neverCalled, selfBooked: a.selfBooked + c.selfBooked,
    }), { leads: 0, attempted: 0, connected: 0, never: 0, selfBooked: 0 });
    return { ...t, pct: rateOf(t.attempted, t.leads) };
  }
  const s = setters.find(x => x.csr === key);
  if (!s) return { leads: 0, attempted: 0, connected: 0, never: 0, selfBooked: 0, pct: null };
  return { leads: s.leads, attempted: s.attempted, connected: s.connected, never: s.neverCalled, selfBooked: s.selfBooked, pct: s.pct };
}

// ─── Bookings, rolled up for a set of accounts ───────────────────────────────
// Booked counts every account. Target, pace and status only count accounts that have a
// target set — an account without one can't be on or off track.

type BookingTotals = {
  range: BookingCount;
  week: BookingCount;
  target: number;        // targets for the selected dates, summed over accounts that have one
  weekTarget: number;
  rangePace: number;     // that target pro rata up to today
  weekPace: number;
  bookedTargeted: number;     // bookings in range on accounts with a target
  weekBookedTargeted: number;
  withTarget: number;
  accounts: number;
};

function bookingsFor(accounts: AccountBookings[]): BookingTotals {
  const add = (a: BookingCount, b: BookingCount): BookingCount => ({ total: a.total + b.total, manual: a.manual + b.manual, lp: a.lp + b.lp, split: a.split + b.split });
  const zero: BookingCount = { total: 0, manual: 0, lp: 0, split: 0 };
  const t: BookingTotals = { range: zero, week: zero, target: 0, weekTarget: 0, rangePace: 0, weekPace: 0, bookedTargeted: 0, weekBookedTargeted: 0, withTarget: 0, accounts: accounts.filter(a => !a.cover).length };
  for (const a of accounts) {
    t.range = add(t.range, a.range);
    t.week = add(t.week, a.week);
    if (a.rangeTarget == null) continue;
    t.withTarget++;
    t.target += a.rangeTarget;
    t.weekTarget += a.weekTarget ?? 0;
    t.rangePace += a.rangePace ?? 0;
    t.weekPace += a.weekPace ?? 0;
    t.bookedTargeted += a.range.total;
    t.weekBookedTargeted += a.week.total;
  }
  return t;
}

// Team: every tab combined. A setter: their own tab only (csrBookings header).
const accountsFor = (board: BookingsBoard, key: CsrKey): AccountBookings[] =>
  key === 'team' ? board.accounts : board.setters?.[key] ?? [];

type Track = 'on' | 'off' | 'none';
const trackOf = (booked: number, pace: number | null, hasTarget: boolean): Track =>
  !hasTarget || pace == null ? 'none' : booked >= Math.floor(pace) ? 'on' : 'off';
const TrackChip = ({ t }: { t: Track }) =>
  t === 'none' ? <span className="inline-block rounded-md bg-border px-2 py-0.5 text-[10px] font-semibold text-fg-dim">No target</span>
    : <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', t === 'on' ? 'bg-green/15 text-green' : 'bg-red/15 text-red')}>{t === 'on' ? 'On track' : 'Off track'}</span>;

// Progress towards a target, with a tick where the pace says bookings should be by now.
function TargetBar({ booked, target, pace, className }: { booked: number; target: number; pace: number; className?: string }) {
  const max = Math.max(target, booked, 1);
  const on = booked >= Math.floor(pace);
  return (
    <div className={cn('relative h-2.5 w-full rounded-full bg-surface-2', className)}>
      <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', on ? 'bg-green' : 'bg-red')} style={{ width: `${(Math.min(booked, max) / max) * 100}%` }} />
      {target > 0 && pace < target && (
        <Tooltip always label={`Pace for today: ${num1(pace)} of ${target}`} className="absolute -top-1 h-4.5 w-1 -translate-x-1/2" style={{ left: `${(pace / max) * 100}%` }}>
          <div className="h-full w-full rounded-full bg-fg/70" />
        </Tooltip>
      )}
    </div>
  );
}

// LP vs manual, as a share of the bookings whose split is known.
function SplitBar({ c, className }: { c: BookingCount; className?: string }) {
  if (c.split === 0) return <span className={cn('text-[11px] text-fg-dim', className)}>{c.total ? 'Split not logged' : '—'}</span>;
  const lpPct = Math.round((100 * c.lp) / c.split);
  return (
    <Tooltip always label={`${c.lp} LP · ${c.manual} manual (${lpPct}% LP)`} className={cn('block', className)}>
      <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full">
        {c.lp > 0 && <div className="h-full rounded-full bg-pink" style={{ width: `${(c.lp / c.split) * 100}%` }} />}
        {c.manual > 0 && <div className="h-full rounded-full bg-secondary" style={{ width: `${(c.manual / c.split) * 100}%` }} />}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-fg-muted">
        <span><span className="text-pink">{c.lp}</span> LP</span>
        <span><span className="text-secondary">{c.manual}</span> MAN</span>
      </div>
    </Tooltip>
  );
}

// "October" for a whole month, "October to date" for this month so far, otherwise the dates.
function periodLabel(since: string, until: string): string {
  const [y, m] = since.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (since.endsWith('-01') && until.slice(0, 7) === since.slice(0, 7)) {
    const name = MONTHS_LONG[m - 1];
    return Number(until.slice(8)) === last ? name : `${name} 1–${Number(until.slice(8))}`;
  }
  return since === until ? fmtShort(since) : `${fmtShort(since)} – ${fmtShort(until)}`;
}

function syncNote(board: BookingsBoard): string {
  const h = board.syncAgeHours;
  if (h == null) return 'Tracker sheet not synced yet';
  const m = Math.floor(h * 60);
  return `Tracker sheet synced ${m < 1 ? 'just now' : m < 60 ? `${m} min` : h < 24 ? `${Math.floor(h)}h` : `${Math.floor(h / 24)}d`} ago`;
}

// ─── The dashboard ───────────────────────────────────────────────────────────

export function CsrDashboardView({
  visible, csr, part, overview, detail, setters, leads, bookings, clients, since, until,
}: {
  visible: CsrKey[] | null;       // dashboards this user may open; null = all
  csr: CsrKey | null;
  part: CsrPart | null;
  overview: CallOverviewRow[];
  detail: CallDetail | null;
  setters: SetterCard[];
  leads: LeadEval[];
  bookings: BookingsBoard;
  clients: ClientOption[];
  since: string;
  until: string;
}) {
  const href = (next: { csr?: CsrKey | null; part?: CsrPart | null; client?: string | null }) => {
    const p = new URLSearchParams({ view: 'calls', since, until });
    if (next.csr) p.set('csr', next.csr);
    if (next.part) p.set('part', next.part);
    if (next.client) p.set('client', next.client);
    return `/?${p.toString()}`;
  };

  const monthName = periodLabel(bookings.since, bookings.until);
  const crumbs: { label: string; href: string }[] = [];
  if (csr) crumbs.push({ label: 'CSR Dashboard', href: href({}) });
  if (csr && (part || detail)) crumbs.push({ label: personLabel(csr), href: href({ csr }) });
  if (csr && part && detail) crumbs.push({ label: part === 'bookings' ? 'Bookings' : 'Speed to Lead', href: href({ csr, part }) });

  let body: React.ReactNode;
  if (detail) body = <Detail row={detail} />;
  else if (!csr) body = <Home visible={visible} setters={setters} bookings={bookings} monthName={monthName} href={href} />;
  else if (part === 'bookings') body = <BookingsAccounts csr={csr} bookings={bookings} clients={clients} monthName={monthName} />;
  else if (part === 'stl') body = <SpeedAccounts csr={csr} overview={overview} setters={setters} leads={leads} clients={clients} detailHref={id => href({ csr, part, client: id })} />;
  else body = <Person csr={csr} setters={setters} bookings={bookings} monthName={monthName} href={href} />;

  const heading = detail ? detail.client.client_name
    : !csr ? 'CSR Dashboard'
    : part === 'bookings' ? `${personLabel(csr)} · Bookings`
    : part === 'stl' ? `${personLabel(csr)} · Speed to Lead`
    : personLabel(csr);

  return (
    <div className="space-y-6 p-8">
      <div>
        {crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs font-medium text-fg-muted">
            <ArrowLeft size={13} className="mr-0.5" />
            {crumbs.map((c, i) => (
              <Fragment key={c.href}>
                {i > 0 && <ChevronRight size={12} className="text-fg-dim" />}
                <NavLink href={c.href} className="rounded transition-colors hover:text-pink">{c.label}</NavLink>
              </Fragment>
            ))}
          </nav>
        )}
        {!detail && <h1 className="text-3xl font-bold tracking-tight text-fg">{heading}</h1>}
        {!csr && !detail && <p className="mt-1 text-sm text-fg-muted">Bookings against target and Speed to Lead, for the team and each setter.</p>}
      </div>
      {body}
    </div>
  );
}

// ─── Home: the team and each setter, one card each ───────────────────────────

function Home({ visible, setters, bookings, monthName, href }: {
  visible: CsrKey[] | null;
  setters: SetterCard[]; bookings: BookingsBoard; monthName: string;
  href: (n: { csr?: CsrKey | null; part?: CsrPart | null }) => string;
}) {
  const people: CsrKey[] = ['team', ...CSR_SETTERS.map(s => s.key)].filter(k => !visible || visible.includes(k));
  return (
    <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
      {people.map(key => {
        const accounts = accountsFor(bookings, key);
        const b = bookingsFor(accounts);
        const s = speedFor(key, setters);
        const hasTarget = b.withTarget > 0;
        return (
          <NavLink key={key} href={href({ csr: key })}
            className={cn('group flex flex-col rounded-2xl border bg-surface p-6 transition-colors hover:border-pink/50', key === 'team' ? 'border-pink/30' : 'border-border')}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-fg">{personLabel(key)}</h2>
                <p className="mt-0.5 text-xs text-fg-muted">{key === 'team' ? 'All accounts combined' : plural(accounts.filter(a => !a.cover).length, 'account')}</p>
              </div>
              <ChevronRight size={18} className="mt-1 text-fg-dim transition-transform group-hover:translate-x-0.5 group-hover:text-pink" />
            </div>

            <div className="mt-6 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                <span className="inline-flex items-center gap-1.5"><CalendarCheck size={12} className="text-pink" /> Bookings · {monthName}</span>
                <TrackChip t={trackOf(b.bookedTargeted, b.rangePace, hasTarget)} />
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="font-mono text-3xl font-bold tabular-nums text-fg">{b.range.total}</span>
                {hasTarget && <span className="font-mono text-sm tabular-nums text-fg-muted">/ {Math.round(b.target)}</span>}
              </div>
              {hasTarget && <TargetBar booked={b.bookedTargeted} target={b.target} pace={b.rangePace} className="mt-3" />}
              <p className="mt-2 text-xs text-fg-muted">
                This week <span className="font-mono font-semibold tabular-nums text-fg">{b.week.total}</span>{hasTarget && <> of {num1(b.weekTarget)}</>}
              </p>
            </div>

            <div className="mt-5 border-t border-border pt-4">
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                <span className="inline-flex items-center gap-1.5"><Zap size={12} className="text-pink" /> Speed to Lead</span>
                <TierChip v={s.pct} />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className={cn('font-mono text-3xl font-bold tabular-nums', speedText(s.pct))}>{pct(s.pct)}</span>
                <span className="text-xs text-fg-muted">{plural(s.leads, 'lead')}{key === 'team' && TEAM_SPEED_EXCLUDED_NAMES && <> · excl. {TEAM_SPEED_EXCLUDED_NAMES}</>}</span>
              </div>
              <OutcomeBar leads={s.leads} attempted={s.attempted} neverCalled={s.never} connected={s.connected} className="mt-3" />
            </div>
          </NavLink>
        );
      })}
    </div>
  );
}

// ─── One person: the two parts, each opening its own breakdown ───────────────

function Person({ csr, setters, bookings, monthName, href }: {
  csr: CsrKey; setters: SetterCard[]; bookings: BookingsBoard; monthName: string;
  href: (n: { csr?: CsrKey | null; part?: CsrPart | null }) => string;
}) {
  const accounts = accountsFor(bookings, csr);
  const b = bookingsFor(accounts);
  const s = speedFor(csr, setters);
  const hasTarget = b.withTarget > 0;
  const monthTrack = trackOf(b.bookedTargeted, b.rangePace, hasTarget);
  const weekTrack = trackOf(b.weekBookedTargeted, b.weekPace, hasTarget);
  const late = Math.max(0, s.leads - s.attempted - s.never);

  return (
    <div className="grid items-stretch gap-6 xl:grid-cols-2">
      <NavLink href={href({ csr, part: 'bookings' })} className="group flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-pink/50">
        <PanelHead icon={CalendarCheck} title="Bookings" sub={`${monthName} · ${plural(accounts.filter(a => !a.cover).length, 'account')}`} />
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Selected dates <TrackChip t={monthTrack} /></div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-5xl font-bold tabular-nums leading-none text-fg">{b.range.total}</span>
              {hasTarget && <span className="font-mono text-lg tabular-nums text-fg-muted">/ {Math.round(b.target)}</span>}
            </div>
            {hasTarget && <TargetBar booked={b.bookedTargeted} target={b.target} pace={b.rangePace} className="mt-4" />}
            {hasTarget && <p className="mt-2 text-xs text-fg-muted">{signed(b.bookedTargeted - Math.round(b.target))} vs the target for these dates</p>}
          </div>
          <div>
            <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-fg-muted">This week <TrackChip t={weekTrack} /></div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-mono text-5xl font-bold tabular-nums leading-none text-fg">{b.week.total}</span>
              {hasTarget && <span className="font-mono text-lg tabular-nums text-fg-muted">/ {num1(b.weekTarget)}</span>}
            </div>
            {hasTarget && <TargetBar booked={b.weekBookedTargeted} target={b.weekTarget} pace={b.weekPace} className="mt-4" />}
            <p className="mt-2 text-xs text-fg-muted">{fmtShort(bookings.weekSince)} – {fmtShort(bookings.until)}</p>
          </div>
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">LP / manual · selected dates</div>
          <SplitBar c={b.range} />
        </div>
        <BookingsFootnote board={bookings} b={b} />
      </NavLink>

      <NavLink href={href({ csr, part: 'stl' })} className="group flex flex-col rounded-2xl border border-border bg-surface p-6 transition-colors hover:border-pink/50">
        <PanelHead icon={Zap} title="Speed to Lead" sub={`${csr === 'team' ? 'All accounts' : 'Their accounts'} · target ${SPEED_TARGET_PCT}%`} info={DEFINITION} />
        <div className="mt-6 flex items-baseline gap-3">
          <span className={cn('font-mono text-5xl font-bold tabular-nums leading-none', speedText(s.pct))}>{pct(s.pct)}</span>
          <TierChip v={s.pct} />
        </div>
        <OutcomeBar leads={s.leads} attempted={s.attempted} neverCalled={s.never} connected={s.connected} className="mt-5 h-3" />
        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Stat label="Leads measured" value={s.leads} />
          <Stat label={`Dialled ≤${SPEED_TO_LEAD_MINUTES}m`} value={s.attempted} dot="bg-green" />
          <Stat label="Dialled late" value={late} dot="bg-yellow" />
          <Stat label="Never phoned" value={s.never} dot="bg-red" />
        </dl>
        <p className="mt-auto border-t border-border pt-3 text-xs text-fg-dim">{[SPEED_WINDOW_TEXT, csr === 'team' ? teamSpeedNote : '', selfBookedNote(s.selfBooked)].filter(Boolean).join(' · ')}</p>
      </NavLink>
    </div>
  );
}

function PanelHead({ icon: Icon, title, sub, info }: { icon: typeof Zap; title: string; sub: string; info?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h2 className="inline-flex items-center gap-2 text-xl font-bold tracking-tight text-fg"><Icon size={18} className="text-pink" /> {title}{info && <InfoTip text={info} />}</h2>
        <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>
      </div>
      <span className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted transition-colors group-hover:text-pink">By account <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" /></span>
    </div>
  );
}

function BookingsFootnote({ board, b }: { board: BookingsBoard; b: BookingTotals }) {
  const notes = [
    !board.available ? 'Per-account bookings appear once migration 0020 has run' : '',
    b.accounts > 0 && b.withTarget === 0 ? 'No targets set yet. Add them in Clients' : b.withTarget < b.accounts ? `${b.accounts - b.withTarget} without a target, not in on-track` : '',
    syncNote(board),
  ].filter(Boolean);
  return <p className="mt-auto border-t border-border pt-3 text-xs text-fg-dim">{notes.join(' · ')}</p>;
}

// ─── Bookings by account ─────────────────────────────────────────────────────

function BookingsAccounts({ csr, bookings, clients, monthName }: { csr: CsrKey; bookings: BookingsBoard; clients: ClientOption[]; monthName: string }) {
  const byId = useMemo(() => new Map(clients.map(c => [c.client_id, c])), [clients]);
  const accounts = accountsFor(bookings, csr);
  const b = bookingsFor(accounts);
  // Default: furthest behind target first. Any column header re-sorts; accounts without a
  // target always sit below those with one when sorting by target, +/- or status.
  const [sort, setSort] = useState<{ key: BookSort; asc: boolean }>({ key: 'status', asc: true });
  const rows = sortBookings(accounts, sort);
  const toggle = (key: BookSort) => setSort(s => (s.key === key ? { key, asc: !s.asc } : { key, asc: key === 'name' || key === 'setter' || key === 'status' }));
  const behind = rows.filter(a => trackOf(a.range.total, a.rangePace, a.rangeTarget != null) === 'off').length;

  return (
    <>
      <section aria-label="Bookings summary" className="grid gap-x-10 gap-y-5 rounded-2xl border border-border bg-surface p-6 sm:grid-cols-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{monthName}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-4xl font-bold tabular-nums text-fg">{b.range.total}</span>
            {b.withTarget > 0 && <span className="font-mono text-base tabular-nums text-fg-muted">/ {Math.round(b.target)}</span>}
          </div>
          {b.withTarget > 0 && <p className="mt-1 text-xs text-fg-muted">{signed(b.bookedTargeted - Math.round(b.target))} vs target · {behind === 0 ? <span className="text-green">all on track</span> : <><span className="font-semibold text-red">{behind}</span> off track</>}</p>}
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">This week · {fmtShort(bookings.weekSince)} – {fmtShort(bookings.until)}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="font-mono text-4xl font-bold tabular-nums text-fg">{b.week.total}</span>
            {b.withTarget > 0 && <span className="font-mono text-base tabular-nums text-fg-muted">/ {num1(b.weekTarget)}</span>}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">LP / manual</div>
          <SplitBar c={b.range} />
        </div>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-muted">
              <SortHead label="Account" k="name" sort={sort} onSort={toggle} className="px-5 text-left" />
              {csr === 'team' && <SortHead label="Setter" k="setter" sort={sort} onSort={toggle} className="px-3 text-left" />}
              <SortHead label="Target" k="target" sort={sort} onSort={toggle} className="px-3 text-right" info="The monthly target's share of the selected dates. Hover a figure for the monthly target." />
              <SortHead label="Booked" k="booked" sort={sort} onSort={toggle} className="px-3 text-right" />
              <SortHead label="LP / MAN" k="lp" sort={sort} onSort={toggle} className="w-[18%] px-3 text-left" info="LP = booked on the landing page. MAN = booked by a setter. Sorts by LP share. From the Appointment Setting Tracker; months before October 2026 logged SMS / CALL instead, so they have no split." />
              <SortHead label="This week" k="week" sort={sort} onSort={toggle} className="px-3 text-right" />
              <SortHead label="+/-" k="diff" sort={sort} onSort={toggle} className="px-3 text-right" info="Bookings in the selected dates minus the target for those dates." />
              <SortHead label="Status" k="status" sort={sort} onSort={toggle} className="px-5 text-right" info="On track = bookings are at or above the target pro rata up to today. Sorted furthest behind first." />
            </tr>
          </thead>
          <tbody>
            {rows.map(a => {
              const c = byId.get(a.client_id);
              const track = trackOf(a.range.total, a.rangePace, a.rangeTarget != null);
              const goal = a.rangeTarget == null ? null : Math.round(a.rangeTarget);
              return (
                <tr key={a.client_id} className={cn('border-b border-border/60 last:border-0', a.range.total === 0 && a.rangeTarget == null && 'text-fg-dim')}>
                  <td className="px-5 py-3"><span className="inline-flex items-center gap-3">{c && <Badge c={c} />}<span className="font-medium text-fg">{a.client_name}</span>{a.cover && <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-muted">cover</span>}</span></td>
                  {csr === 'team' && <td className="px-3 py-3 text-fg-muted">{setterLabel(a.csr)}</td>}
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-fg-muted">
                    {goal == null ? '—' : <Tooltip always label={`${a.target} a month`} className="inline-block">{goal}</Tooltip>}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-base font-semibold tabular-nums text-fg">{a.range.total}</td>
                  <td className="px-3 py-3"><SplitBar c={a.range} /></td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{a.week.total}{a.weekTarget != null && <span className="text-fg-dim"> / {num1(a.weekTarget)}</span>}</td>
                  <td className={cn('px-3 py-3 text-right font-mono text-base font-semibold tabular-nums', goal == null ? 'text-fg-dim' : a.range.total >= goal ? 'text-green' : track === 'on' ? 'text-fg' : 'text-red')}>
                    {goal == null ? '—' : signed(a.range.total - goal)}
                  </td>
                  <td className="px-5 py-3 text-right"><TrackChip t={track} /></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="px-5 py-12 text-center text-sm text-fg-dim">No accounts assigned.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-fg-dim">
        {[
          !bookings.available ? 'Per-account bookings appear once migration 0020 has run' : '',
          b.withTarget < b.accounts ? 'Set monthly targets on each client in Clients' : '',
          csr === 'team' && bookings.unmatched.length ? `Sheet columns with no matching client: ${bookings.unmatched.map(u => `${u.account} (${u.total})`).join(', ')}` : '',
          csr !== 'team' ? `From ${personLabel(csr)}’s own tab in the tracker sheet; accounts marked cover aren’t theirs and have no target` : '',
          syncNote(bookings),
        ].filter(Boolean).join(' · ')}
      </p>
      <SheetSyncButton />
      </div>
    </>
  );
}

// ─── Sorting the bookings table ──────────────────────────────────────────────

type BookSort = 'name' | 'setter' | 'target' | 'booked' | 'lp' | 'week' | 'diff' | 'status';

function sortBookings(list: AccountBookings[], sort: { key: BookSort; asc: boolean }): AccountBookings[] {
  const dir = sort.asc ? 1 : -1;
  const name = (a: AccountBookings, b: AccountBookings) => a.client_name.localeCompare(b.client_name);
  const lpShare = (a: AccountBookings) => (a.range.split ? a.range.lp / a.range.split : -1);
  const diff = (a: AccountBookings) => a.range.total - Math.round(a.rangeTarget ?? 0);
  const behind = (a: AccountBookings) => a.range.total - (a.rangePace ?? 0);
  const needsTarget = sort.key === 'target' || sort.key === 'diff' || sort.key === 'status';
  return [...list].sort((a, b) => {
    if (needsTarget) {
      const na = a.rangeTarget == null, nb = b.rangeTarget == null;
      if (na !== nb) return Number(na) - Number(nb);
      if (na && nb) return b.range.total - a.range.total || name(a, b);
    }
    const d =
      sort.key === 'name' ? name(a, b)
      : sort.key === 'setter' ? setterLabel(a.csr).localeCompare(setterLabel(b.csr))
      : sort.key === 'target' ? (a.rangeTarget ?? 0) - (b.rangeTarget ?? 0)
      : sort.key === 'booked' ? a.range.total - b.range.total
      : sort.key === 'lp' ? lpShare(a) - lpShare(b)
      : sort.key === 'week' ? a.week.total - b.week.total
      : sort.key === 'diff' ? diff(a) - diff(b)
      : behind(a) - behind(b);
    return dir * d || name(a, b);
  });
}

function SortHead({ label, k, sort, onSort, className, info }: { label: string; k: BookSort; sort: { key: BookSort; asc: boolean }; onSort: (k: BookSort) => void; className?: string; info?: string }) {
  const active = sort.key === k;
  const Arrow = sort.asc ? ChevronUp : ChevronDown;
  return (
    <th aria-sort={active ? (sort.asc ? 'ascending' : 'descending') : 'none'} className={cn('py-3 font-semibold', className)}>
      <span className="inline-flex items-center gap-1">
        <button onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-fg', active && 'text-fg')}>
          {label} <Arrow size={12} className={cn(!active && 'opacity-0')} />
        </button>
        {info && <InfoTip text={info} />}
      </span>
    </th>
  );
}

// Pull the tracker sheet now, instead of waiting for the background refresh.
function SheetSyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const res = await syncSheetAction();
    if (res.ok) { toast.success('Tracker sheet synced'); router.refresh(); }
    else toast.error('Sheet sync failed', { description: res.error });
  });
  return (
    <button onClick={run} disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50">
      {pending ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Sync sheet
    </button>
  );
}

// ─── Speed to Lead by account, each opening to its leads ─────────────────────

type SpeedRow = { client_id: string; csr: string | null; cover: boolean; leads: number; attempted: number; connected: number; neverCalled: number; pct: number | null };

function SpeedAccounts({ csr, overview, setters, leads, clients, detailHref }: {
  csr: CsrKey; overview: CallOverviewRow[]; setters: SetterCard[]; leads: LeadEval[]; clients: ClientOption[]; detailHref: (id: string) => string;
}) {
  const byId = useMemo(() => new Map(clients.map(c => [c.client_id, c])), [clients]);
  const card = csr === 'team' ? null : setters.find(s => s.csr === csr) ?? null;
  const s = speedFor(csr, setters);
  const [open, setOpen] = useState<string | null>(null);

  const rows: SpeedRow[] = csr === 'team'
    ? overview.map(r => ({ client_id: r.client.client_id, csr: r.row.csr, cover: false, leads: r.row.leads, attempted: r.row.attempted, connected: r.row.connected, neverCalled: r.row.neverCalled, pct: r.row.pct }))
    : (card?.clients ?? []).map(c => ({ ...c, csr }));
  // Worst first; accounts with no leads at the bottom.
  rows.sort((a, b) => Number(a.leads === 0) - Number(b.leads === 0) || (a.pct ?? 0) - (b.pct ?? 0) || b.leads - a.leads);

  const leadsFor = (r: SpeedRow) => leads.filter(l => l.client_id === r.client_id && (csr === 'team' || l.responsible === csr));
  const late = Math.max(0, s.leads - s.attempted - s.never);
  const below = rows.filter(r => r.leads > 0 && !onTarget(r.pct)).length;

  return (
    <>
      <section aria-label="Speed to Lead summary" className="rounded-2xl border border-border bg-surface p-6">
        <div className="grid items-center gap-x-10 gap-y-5 lg:grid-cols-[auto_1fr]">
          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Speed to Lead <InfoTip text={DEFINITION} /></div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className={cn('font-mono text-5xl font-bold tabular-nums leading-none', speedText(s.pct))}>{pct(s.pct)}</span>
              <TierChip v={s.pct} />
            </div>
          </div>
          <div className="min-w-0">
            <OutcomeBar leads={s.leads} attempted={s.attempted} neverCalled={s.never} connected={s.connected} className="h-3" />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <Stat label="Leads measured" value={s.leads} />
              <Stat label={`Dialled ≤${SPEED_TO_LEAD_MINUTES}m`} value={s.attempted} dot="bg-green" sub={s.connected ? `${s.connected} connected` : undefined} />
              <Stat label="Dialled late" value={late} dot="bg-yellow" />
              <Stat label="Never phoned" value={s.never} dot="bg-red" />
            </dl>
          </div>
        </div>
        <p className="mt-5 border-t border-border pt-3 text-xs text-fg-dim">{[SPEED_WINDOW_TEXT, csr === 'team' ? teamSpeedNote : '', card?.medianMinutes != null ? `Median ${card.medianMinutes}m to first dial` : '', selfBookedNote(s.selfBooked)].filter(Boolean).join(' · ')}</p>
      </section>

      {card && card.days.length > 0 && (
        <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-3">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Shifts</span>
          <div className="flex min-w-0 gap-1 overflow-x-auto py-1">
            {card.days.map(d => <ShiftCell key={d.date} r={d} />)}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          {rows.every(r => r.leads === 0) ? 'No measured leads in this range.'
            : below === 0 ? <span className="text-green">Every account on target</span>
            : <><span className="font-semibold text-red">{below}</span> {below === 1 ? 'account' : 'accounts'} below target. Open one to see its leads.</>}
        </p>
        <BarLegend />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
        <table className="w-full min-w-[680px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="px-5 py-3 text-left font-semibold">Account</th>
              {csr === 'team' && <th className="px-3 py-3 text-left font-semibold">Setter</th>}
              <th className="px-3 py-3 text-right font-semibold">Leads</th>
              <th className="w-[36%] px-3 py-3 text-left font-semibold">Outcome</th>
              <th className="px-3 py-3 text-right font-semibold">Speed to Lead</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const client = byId.get(r.client_id);
              if (!client) return null;
              const isOpen = open === r.client_id;
              const list = isOpen ? leadsFor(r) : [];
              return (
                <Fragment key={r.client_id}>
                  <tr onClick={() => setOpen(isOpen ? null : r.client_id)} className={cn('group cursor-pointer border-b border-border/60 transition-colors hover:bg-surface-2', isOpen && 'bg-surface-2', r.leads === 0 && 'text-fg-dim')}>
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center gap-3">
                        <Badge c={client} />
                        <button aria-expanded={isOpen} onClick={e => { e.stopPropagation(); setOpen(isOpen ? null : r.client_id); }}
                          className={cn('rounded text-left font-medium group-hover:text-pink', r.leads === 0 ? 'text-fg-muted' : 'text-fg')}>{client.client_name}</button>
                        {r.cover && <span className="rounded bg-border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-muted">cover</span>}
                      </span>
                    </td>
                    {csr === 'team' && <td className="px-3 py-3 text-fg-muted">{setterLabel(r.csr)}</td>}
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{r.leads}</td>
                    <td className="px-3 py-3">{r.leads > 0 ? <OutcomeBar leads={r.leads} attempted={r.attempted} neverCalled={r.neverCalled} connected={r.connected} /> : <span className="text-xs">No leads measured</span>}</td>
                    <td className={cn('px-3 py-3 text-right font-mono text-base font-semibold tabular-nums', speedText(r.pct))}>{pct(r.pct)}</td>
                    <td className="pr-4 text-right"><ChevronDown size={15} className={cn('inline text-fg-dim transition-transform duration-200 ease-out group-hover:text-pink', isOpen && 'rotate-180 text-pink')} /></td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b border-border/60 bg-bg/40">
                      <td colSpan={csr === 'team' ? 6 : 5} className="px-5 py-4">
                        <LeadList leads={list} />
                        <NavLink href={detailHref(r.client_id)} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-fg-muted transition-colors hover:text-pink">
                          Account detail and call sync <ChevronRight size={13} />
                        </NavLink>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-fg-dim">No measured accounts in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

// The leads behind one account's rate, each name opening the contact in GHL.
function LeadList({ leads }: { leads: LeadEval[] }) {
  if (leads.length === 0) return <p className="py-2 text-xs text-fg-dim">No leads measured for this account in this range.</p>;
  return (
    <table className="pop w-full text-sm">
      <thead>
        <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
          <th className="px-2 py-2 text-left font-semibold">Lead</th>
          <th className="px-2 py-2 text-left font-semibold">Arrived</th>
          <th className="px-2 py-2 text-right font-semibold">First dial</th>
          <th className="px-2 py-2 text-left font-semibold">By</th>
          <th className="px-2 py-2 text-right font-semibold">Outcome</th>
        </tr>
      </thead>
      <tbody>
        {leads.map(l => (
          <tr key={l.source_id} className={cn('border-b border-border/40 last:border-0', l.selfBooked && 'opacity-60')}>
            <td className="px-2 py-2">
              <a href={ghlContact(l.client_id, l.source_id)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded font-medium text-fg transition-colors hover:text-pink">
                {l.name} <ExternalLink size={12} className="text-fg-dim" />
              </a>
            </td>
            <td className="whitespace-nowrap px-2 py-2 font-mono text-xs tabular-nums text-fg-muted">{fmtDay(l.day)} · {fmtClock(l.arrivedAt)}</td>
            <td className={cn('whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums', l.minsToDial == null ? 'text-red' : l.attempted ? 'text-green' : 'text-yellow')}>
              {l.minsToDial == null ? 'never' : l.minsToDial < 60 ? `${l.minsToDial}m` : l.minsToDial < 1440 ? `${Math.round(l.minsToDial / 60)}h` : `${Math.round(l.minsToDial / 1440)}d`}
            </td>
            <td className="px-2 py-2 text-xs text-fg-muted">{l.firstDialBy ?? '—'}</td>
            <td className="px-2 py-2 text-right"><OutcomeChip l={l} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutcomeChip({ l }: { l: LeadEval }) {
  return l.selfBooked ? <Tooltip always label={`Paid a deposit ${l.paidAt ? fmtDay(l.paidAt.slice(0, 10)) + ' ' + fmtClock(l.paidAt) : ''} within 30 min, before any call — not counted`} className="inline-block"><span className="rounded-md bg-pink/15 px-2 py-0.5 text-[10px] font-semibold text-pink">Self-booked</span></Tooltip>
    : l.connected ? <span className="rounded-md bg-green/15 px-2 py-0.5 text-[10px] font-semibold text-green">Connected</span>
    : l.attempted ? <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-semibold text-fg-muted">Dialled, no answer</span>
    : l.minsToDial != null ? <span className="rounded-md bg-yellow/15 px-2 py-0.5 text-[10px] font-semibold text-yellow">Late</span>
    : <span className="rounded-md bg-red/15 px-2 py-0.5 text-[10px] font-semibold text-red">Missed</span>;
}

// ─── Shared pieces ───────────────────────────────────────────────────────────

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

// One day of a setter's shift history: colour is that day's rate, the number is its leads.
function ShiftCell({ r }: { r: ShiftRow }) {
  const day = Number(r.date.slice(8, 10));
  const label = r.off
    ? `${fmtDay(r.date)} · off`
    : `${fmtDay(r.date)} · ${r.start}–${r.end}${r.breaks.map(b => ` · break ${b.start}–${b.end}`).join('')} · ${r.leads === 0 ? 'no leads' : `${r.attempted} of ${r.leads} dialled ≤${SPEED_TO_LEAD_MINUTES}m (${r.pct}%)`}${r.coverLeads ? ` · ${r.coverLeads} cover` : ''}`;
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
              <th className="px-2 py-2 text-left font-semibold"><span className="inline-flex items-center gap-1">Responsible <InfoTip text="The setter the account is assigned to." /></span></th>
              <th className="px-2 py-2 text-right font-semibold">First dial</th>
              <th className="px-2 py-2 text-left font-semibold">By</th>
              <th className="px-2 py-2 text-right font-semibold">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {list.map(l => (
              <tr key={l.source_id} className={cn('border-b border-border/40', l.selfBooked && 'opacity-60')}>
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs tabular-nums text-fg-muted">{fmtDay(l.day)} · {fmtClock(l.arrivedAt)}</td>
                <td className="px-2 py-2"><a href={ghlContact(l.client_id, l.source_id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded text-fg transition-colors hover:text-pink">{l.name} <ExternalLink size={12} className="text-fg-dim" /></a></td>
                <td className="px-2 py-2 text-fg-muted">{setterLabel(l.responsible)}{l.cover && <span className="ml-1 rounded bg-border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-fg-dim">cover</span>}</td>
                <td className={cn('whitespace-nowrap px-2 py-2 text-right font-mono text-xs tabular-nums', l.minsToDial == null ? 'text-red' : l.attempted ? 'text-green' : 'text-yellow')}>
                  {l.minsToDial == null ? 'never' : l.minsToDial < 60 ? `${l.minsToDial}m` : l.minsToDial < 1440 ? `${Math.round(l.minsToDial / 60)}h` : `${Math.round(l.minsToDial / 1440)}d`}
                </td>
                <td className="px-2 py-2 text-xs text-fg-muted">{l.firstDialBy ?? '—'}</td>
                <td className="px-2 py-2 text-right">
                  <OutcomeChip l={l} />
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
