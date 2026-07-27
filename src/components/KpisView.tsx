'use client';

import { useRouter } from 'next/navigation';
import { Headphones, Megaphone, FlaskConical, Target } from 'lucide-react';
import type { CsrKpiRow } from '@/lib/kpis';
import { InfoTip } from '@/components/InfoTip';
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

export function KpisView({ rows, months, month }: { rows: CsrKpiRow[]; months: string[]; month: string | null }) {
  const router = useRouter();
  const goMonth = (m: string) => router.push(`/?view=kpis&month=${encodeURIComponent(m)}`);

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
      <RoleCard icon={Headphones} title="Appointment Setters" subtitle="Across all clinics">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2.5 text-left font-semibold">Setter</th>
                <th className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center gap-1">Confirmed bookings <InfoTip text="Bookings that paid a booking fee this month. Targets: Junior 60 · Flat 90 · Senior 110." /></span></th>
                <th className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center gap-1">Phone booking ratio <InfoTip text="Phone ÷ (Phone + SMS) bookings, from the channel each setter marks. Targets: Junior 60% · Flat 65% · Senior 75%." /></span></th>
                <th className="px-3 py-2.5 text-left font-semibold"><span className="inline-flex items-center gap-1">Speed to Lead <InfoTip text="Per setter: reached by phone within 30 min ÷ the leads they phoned (10am–6pm UK). Never-phoned leads count against the team total on Call Tracking, not per person. Targets: Junior 75% · Flat 80% · Senior 85%." /></span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.csr} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-3 font-medium text-fg">{r.csr}</td>
                  <KpiCell value={String(r.confirmed)} sub={`${r.bookingsTotal} booked`} tier={confirmedTier(r.confirmed)} />
                  <KpiCell
                    value={r.phonePct == null ? '—' : `${r.phonePct}%`}
                    sub={r.phone + r.sms > 0 ? `${r.phone}/${r.phone + r.sms} marked` : 'not marked'}
                    tier={r.phonePct == null ? null : phoneTier(r.phonePct)}
                  />
                  <KpiCell
                    value={r.speedPct == null ? '—' : `${r.speedPct}%`}
                    sub={r.speedLeads > 0 ? `${r.speedWithin}/${r.speedLeads} phoned` : 'no phoned leads'}
                    tier={r.speedPct == null ? null : speedTier(r.speedPct)}
                  />
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-fg-dim">No setter activity in {fmtMonth(month)}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
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

function RoleCard({ icon: Icon, title, subtitle, children }: { icon: typeof Target; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border px-5 py-3.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><Icon size={16} className="text-pink" /></div>
        <div>
          <div className="text-sm font-semibold text-fg">{title}</div>
          <div className="text-[11px] text-fg-dim">{subtitle}</div>
        </div>
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
