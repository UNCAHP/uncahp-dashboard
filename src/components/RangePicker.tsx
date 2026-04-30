import Link from 'next/link';
import { cn } from '@/lib/utils';

const RANGES: Array<{ days: number; label: string }> = [
  { days: 7, label: 'Last 7d' },
  { days: 14, label: 'Last 14d' },
  { days: 30, label: 'Last 30d' },
  { days: 90, label: 'Last 90d' },
];

export function RangePicker({ activeDays, clientFilter }: { activeDays: number; clientFilter?: string }) {
  function href(days: number) {
    const p = new URLSearchParams();
    p.set('days', String(days));
    if (clientFilter) p.set('client', clientFilter);
    return `/?${p.toString()}`;
  }
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
      {RANGES.map(r => (
        <Link
          key={r.days}
          href={href(r.days)}
          className={cn(
            'rounded px-3 py-1.5 text-xs font-medium transition-colors',
            r.days === activeDays
              ? 'bg-pink text-white'
              : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
          )}
          prefetch={false}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );
}
