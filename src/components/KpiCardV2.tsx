import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function KpiCardV2({
  label,
  value,
  icon: Icon,
  hero = false,
  hint,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  hero?: boolean;
  hint?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-surface transition-colors hover:border-border-strong',
        hero ? 'p-5' : 'p-4',
      )}
      title={hint}
    >
      <div className="mb-3 flex items-start justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wider text-fg">{label}</span>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2">
          <Icon size={13} className="text-fg-muted" />
        </div>
      </div>
      <div className={cn('font-extrabold tracking-tight text-fg tabular-nums', hero ? 'text-3xl' : 'text-2xl')}>
        {value}
      </div>
    </div>
  );
}
