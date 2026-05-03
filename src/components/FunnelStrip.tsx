import { Eye, Users, ShoppingCart, CreditCard, CheckCircle2, Calendar as CalIcon, PoundSterling, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

export type FunnelStripData = {
  lp_views: number;
  leads: number;
  lp_leads: number;
  lf_leads: number;
  checkouts: number;
  deposits: number;
  showed?: number | null;
  treatment?: number | null;
  revenue?: number | null;
};

type Stage = {
  key: keyof FunnelStripData;
  label: string;
  icon: LucideIcon;
  hasData: boolean;
  isCurrency?: boolean;
  showsLpLfSplit?: boolean;
};

export function FunnelStrip({
  data,
  detailHref,
}: {
  data: FunnelStripData;
  detailHref?: string;
}) {
  const stages: Stage[] = [
    { key: 'lp_views', label: 'LP Views', icon: Eye, hasData: data.lp_views > 0 },
    { key: 'leads', label: 'Leads', icon: Users, hasData: data.leads > 0, showsLpLfSplit: true },
    { key: 'checkouts', label: 'Checkouts', icon: ShoppingCart, hasData: data.checkouts > 0 },
    { key: 'deposits', label: 'Deposits', icon: CreditCard, hasData: data.deposits > 0 },
    { key: 'showed', label: 'Showed Up', icon: CheckCircle2, hasData: data.showed != null },
    { key: 'treatment', label: 'Treatment', icon: CalIcon, hasData: data.treatment != null },
    { key: 'revenue', label: 'Revenue', icon: PoundSterling, hasData: data.revenue != null, isCurrency: true },
  ];

  const maxValue = data.lp_views || data.leads || 1;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-fg">Funnel Snapshot</div>
          <div className="mt-0.5 text-xs text-fg-muted">From landing page view through to revenue</div>
        </div>
        {detailHref && (
          <Link href={detailHref} prefetch={false} className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
            Open full funnel
            <ChevronRight size={12} />
          </Link>
        )}
      </div>
      <div className="flex items-stretch gap-2">
        {stages.map((stage, i) => {
          const Icon = stage.icon;
          const value = data[stage.key];
          const numValue = typeof value === 'number' ? value : 0;
          const prevStage = i > 0 ? stages[i - 1] : null;
          const prevValue = prevStage ? data[prevStage.key] : null;
          const conv =
            prevStage && prevStage.hasData && stage.hasData && typeof prevValue === 'number' && prevValue > 0
              ? ((numValue / prevValue) * 100).toFixed(1)
              : null;
          const width = stage.hasData ? Math.max((numValue / maxValue) * 100, 12) : 100;
          const display = !stage.hasData
            ? '—'
            : stage.isCurrency
              ? formatGBP(numValue, { decimals: 0 })
              : formatNumber(numValue);

          return (
            <div key={stage.key} className="min-w-0 flex-1">
              <div className="mb-1.5 flex items-center gap-1">
                <Icon size={11} className={stage.hasData ? 'text-fg-muted' : 'text-fg-dim'} />
                <span
                  className={cn(
                    'truncate text-[10px] font-medium uppercase tracking-wider',
                    stage.hasData ? 'text-fg-muted' : 'text-fg-dim',
                  )}
                >
                  {stage.label}
                </span>
              </div>
              <div
                className={cn(
                  'relative h-16 overflow-hidden rounded-lg border',
                  stage.hasData ? 'border-border bg-surface-2' : 'border-dashed border-border bg-surface-2/40',
                )}
              >
                {stage.hasData && (
                  <div
                    className="absolute inset-y-0 left-0 transition-all"
                    style={{
                      width: `${width}%`,
                      background: stage.isCurrency
                        ? 'linear-gradient(90deg, rgba(74,222,128,0.25), rgba(74,222,128,0.06))'
                        : 'linear-gradient(90deg, rgba(247,165,222,0.22), rgba(247,165,222,0.05))',
                    }}
                  />
                )}
                <div className="relative flex h-full flex-col justify-center px-3">
                  <div
                    className={cn(
                      'text-base font-bold tabular-nums',
                      !stage.hasData ? 'text-fg-dim' : stage.isCurrency ? 'text-green' : 'text-fg',
                    )}
                  >
                    {display}
                  </div>
                  {stage.showsLpLfSplit && stage.hasData && (
                    <div className="mt-0.5 text-[9px] text-fg-muted">
                      {data.lp_leads} LP · {data.lf_leads} LF
                    </div>
                  )}
                  {!stage.hasData && (
                    <div className="mt-0.5 text-[9px] text-fg-dim">awaiting data</div>
                  )}
                </div>
                {conv && (
                  <div className="absolute right-1.5 top-1 text-[9px] font-medium text-fg-muted">
                    {conv}%
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
