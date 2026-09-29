'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useState } from 'react';
import { Headphones, Megaphone, FlaskConical, Target, ChevronRight, Phone, MessageSquare, Zap } from 'lucide-react';
import type { CsrKpiRow, CsrDayRow, CsrSpeedRow } from '@/lib/kpis';
import { InfoTip } from '@/components/InfoTip';
import { SyncBadge } from '@/components/FreshnessBadge';
import { BOOKINGS_KPIS_ENABLED, SPEED_TO_LEAD_MINUTES } from '@/lib/csrConstants';
import { cn } from '@/lib/utils';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m] = iso.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? '?'} ${y}`;
};

type Tier = { label: string; cls: string };
const belowCls = 'bg-red/15 text-red';
const midCls = 'bg-yellow/15 text-yellow';
const topCls = 'bg-green/15 text-green';
const confirmedTier = (n: number): Tier => (n >= 110 ? { label: 'Senior', cls: topCls } : n >= 90 ? { label: 'Flat', cls: topCls } : n >= 60 ? { label: 'Junior', cls: midCls } : { label: 'Below', cls: belowCls });
const phoneTier = (p: number): Tier => (p >= 75 ? { label: 'Senior', cls: topCls } : p >= 65 ? { label: 'Flat', cls: topCls } : p >= 60 ? { label: 'Junior', cls: midCls } : { label: 'Below', cls: belowCls });
const speedTier = (p: number): Tier => (p >= 85 ? { label: 'Senior', cls: topCls } : p >= 80 ? { label: 'Flat', cls: topCls } : p >= 75 ? { label: 'Junior', cls: midCls } : { label: 'Below', cls: belowCls });

export function KpisView({ rows, months, month, daily, syncAgeHours, speed }: {
  rows: CsrKpiRow[];
  months: string[];
  month: string | null;
  daily: Record<string, CsrDayRow[]>;
  syncAgeHours: number | null;
  speed: CsrSpeedRow[];
}) {
  const router = useRouter();
  const goMonth = (m: string) => router.push(`/?view=kpis&month=${encodeURIComponent(m)}`);
  // Several setters can be open at once, so their days can be compared side by side.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (csr: string) => setOpen(o => ({ ...o, [csr]: !o[csr] }));

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">KPIs</h1>
          <p className="mt-1 text-sm text-fg-muted">Team performance by role · monthly targets with Junior / Flat / Senior tiers.</p>
        </div>
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
      </div>

      {/* Appointment Setters */}
      <RoleCard
        icon={Headphones}
        title="Appointment Setters"
        subtitle="Across all clinics"
        right={BOOKINGS_KPIS_ENABLED ? <SyncBadge label="Tracker sheet" hours={syncAgeHours} /> : null}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2.5 text-left font-semibold">Setter</th>
                <th className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center gap-1">Confirmed bookings <InfoTip text={BOOKINGS_KPIS_ENABLED ? "The setter's booking total for the month, from their tab in the Appointment Setting Tracker sheet (synced daily). Targets: Junior 60 · Flat 90 · Senior 110." : 'Paused — not currently being tracked. Targets when live: Junior 60 · Flat 90 · Senior 110.'} /></span></th>
                <th className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center gap-1">Phone booking ratio <InfoTip text={BOOKINGS_KPIS_ENABLED ? 'CALL ÷ (CALL + SMS) bookings from the same sheet tab. Targets: Junior 60% · Flat 65% · Senior 75%.' : 'Paused — not currently being tracked. Targets when live: Junior 60% · Flat 65% · Senior 75%.'} /></span></th>
                <th className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center gap-1">Speed to Lead <InfoTip text={`Of every new lead on this setter's assigned clients that arrived during their shift, the % with an outbound dial within ${SPEED_TO_LEAD_MINUTES} min (answered or not). A lead nobody phoned counts as a miss. Cover from another setter counts when they're off. Targets: Junior 75% · Flat 80% · Senior 85%.`} /></span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const days = daily[r.csr.toLowerCase()] ?? [];
                const expandable = days.length > 0;
                const isOpen = !!open[r.csr];
                return (
                <Fragment key={r.csr}>
                <tr
                  onClick={expandable ? () => toggle(r.csr) : undefined}
                  className={cn(
                    'border-b border-border/50',
                    expandable && 'cursor-pointer hover:bg-white/[0.02]',
                    isOpen && 'bg-white/[0.02]',
                  )}
                >
                  <td className="px-3 py-3 font-medium text-fg">
                    <span className="inline-flex items-center gap-1.5">
                      {expandable && (
                        <ChevronRight
                          size={14}
                          className={cn('text-fg-dim transition-transform', isOpen && 'rotate-90')}
                          aria-hidden
                        />
                      )}
                      {r.csr}
                    </span>
                  </td>
                  {/* Both columns come from the Appointment Setting Tracker sheet. A setter
                      with no tab for the month has no sheet row at all, so show that as
                      "no sheet data" rather than a scored 0 they didn't earn. */}
                  <KpiCell
                    value={!BOOKINGS_KPIS_ENABLED || !r.hasSheetRow ? '—' : String(r.confirmed)}
                    sub={!BOOKINGS_KPIS_ENABLED ? 'not tracked' : !r.hasSheetRow ? 'no sheet data' : `${r.bookingsTotal} booked`}
                    tier={!BOOKINGS_KPIS_ENABLED || !r.hasSheetRow ? null : confirmedTier(r.confirmed)}
                  />
                  <KpiCell
                    value={!BOOKINGS_KPIS_ENABLED || r.phonePct == null ? '—' : `${r.phonePct}%`}
                    sub={!BOOKINGS_KPIS_ENABLED ? 'not tracked' : !r.hasSheetRow ? 'no sheet data' : `${r.phone}/${r.phone + r.sms} by phone`}
                    tier={!BOOKINGS_KPIS_ENABLED || r.phonePct == null ? null : phoneTier(r.phonePct)}
                  />
                  <KpiCell
                    value={r.speedPct == null ? '—' : `${r.speedPct}%`}
                    sub={r.speedLeads > 0 ? `${r.speedWithin}/${r.speedLeads} leads on shift` : 'no leads on shift'}
                    tier={r.speedPct == null ? null : speedTier(r.speedPct)}
                  />
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/50">
                    <td colSpan={4} className="bg-black/20 px-3 pb-4 pt-1">
                      <DailyBreakdown csr={r.csr} days={days} />
                    </td>
                  </tr>
                )}
                </Fragment>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-fg-dim">No setter activity in {fmtMonth(month)}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </RoleCard>

      {/* Speed to Lead — by setter, with the per-client breakdown */}
      <RoleCard icon={Zap} title="Speed to Lead" subtitle={`By setter · new leads on their clients during their shift, reached by phone within ${SPEED_TO_LEAD_MINUTES} min`}>
        <SpeedBySetter rows={speed} month={month} />
      </RoleCard>

      {/* Media Buyers — awaiting KPI definitions */}
      <RoleCard icon={Megaphone} title="Media Buyers" subtitle="Meta ads performance">
        <PlaceholderKpis lines={['e.g. CPL, ROAS, spend pacing, LP-view → lead rate — with targets']} />
      </RoleCard>

      {/* Funnel Builders — awaiting KPI definitions */}
      <RoleCard icon={FlaskConical} title="Funnel Builders" subtitle="Funnel conversion performance">
        <PlaceholderKpis lines={['e.g. opt-in rate, deposit rate, pages shipped, time-to-launch — with targets']} />
      </RoleCard>
    </div>
  );
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// Parsed as UTC (the stored value is a plain yyyy-mm-dd) so the weekday can't drift by a
// day depending on where the viewer is.
const fmtDay = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()}`;
};

/**
 * A setter's month, day by day, split phone vs SMS.
 *
 * Days with no bookings are hidden rather than listed as zeroes — most months have a lot of
 * them, and they push the days that matter off the screen. The count is still reported so
 * the omission is visible.
 */
function DailyBreakdown({ csr, days }: { csr: string; days: CsrDayRow[] }) {
  const active = days.filter(d => d.total > 0);
  const quiet = days.length - active.length;
  const phone = days.reduce((n, d) => n + d.phone, 0);
  const sms = days.reduce((n, d) => n + d.sms, 0);
  const busiest = Math.max(1, ...active.map(d => d.total));

  if (!active.length) {
    return <div className="py-3 text-center text-xs text-fg-dim">No bookings logged on any day this month for {csr}.</div>;
  }

  return (
    <div className="rounded-lg border border-border bg-surface/60">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">{csr} · day by day</span>
        <span className="flex items-center gap-3 text-[11px] text-fg-dim">
          <span className="inline-flex items-center gap-1"><Phone size={11} className="text-green" />{phone} phone</span>
          <span className="inline-flex items-center gap-1"><MessageSquare size={11} className="text-fg-muted" />{sms} SMS</span>
          <span>{active.length} active {active.length === 1 ? 'day' : 'days'}</span>
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-fg-dim">
            <th className="px-3 py-1.5 text-left font-semibold">Day</th>
            <th className="px-3 py-1.5 text-right font-semibold">Total</th>
            <th className="px-3 py-1.5 text-right font-semibold">Phone</th>
            <th className="px-3 py-1.5 text-right font-semibold">SMS</th>
            <th className="w-1/3 px-3 py-1.5 text-left font-semibold">Split</th>
          </tr>
        </thead>
        <tbody>
          {active.map(d => (
            <tr key={d.date} className="border-t border-border/40">
              <td className="whitespace-nowrap px-3 py-1.5 text-fg-muted">{fmtDay(d.date)}</td>
              <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums text-fg">{d.total}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green">{d.phone || '·'}</td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-fg-muted">{d.sms || '·'}</td>
              <td className="px-3 py-1.5">
                {/* Bars are scaled against the setter's busiest day, so the shape of the
                    month reads at a glance without needing an axis. */}
                <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/5" title={`${d.phone} phone · ${d.sms} SMS`}>
                  <span className="bg-green/80" style={{ width: `${(100 * d.phone) / busiest}%` }} />
                  <span className="bg-white/25" style={{ width: `${(100 * d.sms) / busiest}%` }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {quiet > 0 && (
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-fg-dim">
          {quiet} {quiet === 1 ? 'day' : 'days'} with no bookings hidden
        </div>
      )}
    </div>
  );
}

function SpeedBySetter({ rows, month }: { rows: CsrSpeedRow[]; month: string | null }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen(o => ({ ...o, [k]: !o[k] }));
  if (rows.length === 0) {
    return <div className="px-3 py-10 text-center text-sm text-fg-dim">No leads on shift in {fmtMonth(month)}.</div>;
  }
  const pctText = (p: number | null) => (p == null ? 'text-fg-dim' : p >= 80 ? 'text-green' : p >= 75 ? 'text-yellow' : 'text-red');
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
            <th className="px-3 py-2.5 text-left font-semibold">Setter</th>
            <th className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1">Leads on shift <InfoTip text="New leads — contacts with a campaign REF tag (e.g. dlc-ec-01-aug26) and a phone number — on this setter's assigned clients that arrived while they were on shift, per the Start of Day check-in." /></span></th>
            <th className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1">Attempted ≤{SPEED_TO_LEAD_MINUTES}m <InfoTip text="Leads with an outbound dial within 30 min of enquiry, whether or not it was answered. This is the scored number — a setter can't make a lead pick up." /></span></th>
            <th className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1">Connected ≤{SPEED_TO_LEAD_MINUTES}m <InfoTip text="Leads actually reached: a completed outbound call of at least 60 seconds within 30 min. Shown for context, not scored." /></span></th>
            <th className="px-3 py-2.5 text-right font-semibold"><span className="inline-flex items-center gap-1">Never phoned <InfoTip text="Leads that got no outbound call at all. They count as misses." /></span></th>
            <th className="px-3 py-2.5 text-right font-semibold">Speed to Lead</th>
            <th className="px-3 py-2.5 text-right font-semibold">Tier</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const isOpen = !!open[r.key];
            return (
              <Fragment key={r.key}>
                <tr onClick={() => toggle(r.key)} className={cn('cursor-pointer border-b border-border/50 hover:bg-white/[0.02]', isOpen && 'bg-white/[0.02]')}>
                  <td className="px-3 py-3 font-medium text-fg">
                    <span className="inline-flex items-center gap-1.5">
                      <ChevronRight size={14} className={cn('text-fg-dim transition-transform', isOpen && 'rotate-90')} aria-hidden />
                      {r.csr}
                      <span className="text-[11px] font-normal text-fg-dim">· {r.clients.length} client{r.clients.length === 1 ? '' : 's'}</span>
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-fg">{r.leads}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-green">{r.within}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-fg-muted">{r.connected}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums text-red">{r.neverCalled}</td>
                  <td className={cn('px-3 py-3 text-right font-mono font-semibold tabular-nums', pctText(r.pct))}>{r.pct == null ? '—' : `${r.pct}%`}</td>
                  <td className="px-3 py-3 text-right">
                    {r.pct == null ? <span className="text-fg-dim">—</span> : <span className={cn('inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold', speedTier(r.pct).cls)}>{speedTier(r.pct).label}</span>}
                  </td>
                </tr>
                {isOpen && r.clients.map(c => (
                  <tr key={c.client_id} className="border-b border-border/40 bg-black/20 text-xs">
                    <td className="py-2 pl-10 pr-3 text-fg-muted">{c.client_name}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-fg-muted">{c.leads}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-green/80">{c.within}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-fg-dim">{c.connected}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-red/80">{c.neverCalled}</td>
                    <td className={cn('px-3 py-2 text-right font-mono tabular-nums', pctText(c.pct))}>{c.pct == null ? '—' : `${c.pct}%`}</td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RoleCard({ icon: Icon, title, subtitle, right, children }: { icon: typeof Target; title: string; subtitle: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><Icon size={16} className="text-pink" /></div>
        <div>
          <div className="text-sm font-semibold text-fg">{title}</div>
          <div className="text-[11px] text-fg-dim">{subtitle}</div>
        </div>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className="p-2 sm:p-4">{children}</div>
    </div>
  );
}

function KpiCell({ value, sub, tier }: { value: string; sub: string; tier: Tier | null }) {
  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-lg font-bold tabular-nums text-fg">{value}</span>
        {tier && <span className={cn('rounded-md px-2 py-0.5 text-[10px] font-semibold', tier.cls)}>{tier.label}</span>}
      </div>
      <div className="mt-0.5 text-[10px] text-fg-dim">{sub}</div>
    </td>
  );
}

function PlaceholderKpis({ lines }: { lines: string[] }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-dashed border-border/70 bg-surface-2/20 px-4 py-5">
      <Target size={16} className="mt-0.5 shrink-0 text-fg-dim" />
      <div className="text-xs text-fg-muted">
        <div className="font-medium text-fg">KPIs to be defined</div>
        <p className="mt-0.5 text-fg-dim">Send the metrics and their Junior / Flat / Senior targets and I&apos;ll wire them in here. {lines[0]}</p>
      </div>
    </div>
  );
}
