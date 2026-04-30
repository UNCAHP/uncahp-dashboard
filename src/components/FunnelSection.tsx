import { Eye, UserPlus, CreditCard, Receipt, CalendarCheck } from 'lucide-react';
import { Totals } from '@/lib/queries';
import { formatNumber, formatPercent } from '@/lib/utils';

type Stage = {
  label: string;
  value: number;
  icon: React.ReactNode;
  rate: number | null; // % from previous stage
  rateLabel: string;
};

export function FunnelSection({ totals }: { totals: Totals }) {
  const stages: Stage[] = [
    {
      label: 'LP Views',
      value: totals.lp_views,
      icon: <Eye size={16} />,
      rate: null,
      rateLabel: '',
    },
    {
      label: 'LP Leads',
      value: totals.lp_leads,
      icon: <UserPlus size={16} />,
      rate: totals.lead_optin_rate_pct,
      rateLabel: 'opt-in',
    },
    {
      label: 'Checkouts',
      value: totals.checkouts,
      icon: <CreditCard size={16} />,
      rate: totals.deposit_start_rate_pct,
      rateLabel: 'deposit start',
    },
    {
      label: 'Purchases',
      value: totals.purchases,
      icon: <Receipt size={16} />,
      rate: totals.deposit_collection_rate_pct,
      rateLabel: 'deposit collected',
    },
    {
      label: 'Bookings',
      value: totals.bookings,
      icon: <CalendarCheck size={16} />,
      rate: totals.purchases > 0
        ? +((100 * totals.bookings) / totals.purchases).toFixed(2)
        : null,
      rateLabel: 'show-up',
    },
  ];

  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-fg-muted">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-pink" />
        LP Funnel
      </div>
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {stages.map((s, i) => (
            <div key={s.label} className="relative">
              {i > 0 && s.rate != null && (
                <div className="absolute -left-2 top-2 hidden -translate-x-full md:flex flex-col items-center text-[10px] uppercase tracking-wider text-fg-dim">
                  <span className="text-pink font-mono">{formatPercent(s.rate, 1)}</span>
                  <span>{s.rateLabel}</span>
                </div>
              )}
              <div className="rounded-lg border border-border bg-surface-2 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-fg-muted">
                  {s.icon}
                  <span>{s.label}</span>
                </div>
                <div className="mt-2 font-mono text-3xl font-semibold tabular-nums">
                  {formatNumber(s.value)}
                </div>
                {i > 0 && s.rate != null && (
                  <div className="mt-1 text-xs text-fg-dim md:hidden">
                    <span className="text-pink font-mono">{formatPercent(s.rate, 1)}</span>{' '}
                    <span className="uppercase tracking-wider">{s.rateLabel}</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-fg-dim">
          All stages from Meta pixel except Bookings (GHL <span className="font-mono">won</span> opportunities).
          <span className="font-mono"> LP Leads</span> = LP form submits only (excludes Meta Instant Form leads — see &ldquo;LF Leads&rdquo; in client table).
          Stages read 0 for clients whose pixel doesn&apos;t fire that event yet.
        </p>
      </div>
    </section>
  );
}
