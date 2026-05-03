import { Calendar } from 'lucide-react';
import Link from 'next/link';
import type { FreshnessReport } from '@/lib/queries';
import { cn } from '@/lib/utils';

const RANGES: Array<{ days: number; label: string }> = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

function relative(hours: number | null) {
  if (hours == null) return 'unknown';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function Topbar({
  title,
  subtitle,
  freshness,
  rangeLabel,
  view,
  client,
  days,
}: {
  title: string;
  subtitle?: string | null;
  freshness: FreshnessReport;
  rangeLabel: string;
  view?: string;
  client?: string;
  days: number;
}) {
  const stale = freshness.is_stale;
  const buildHref = (d: number) => {
    const p = new URLSearchParams();
    if (view && view !== 'overview') p.set('view', view);
    if (client) p.set('client', client);
    p.set('days', String(d));
    return `/?${p.toString()}`;
  };

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/80 px-8 py-4 backdrop-blur">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="h-5 w-1 rounded-full bg-pink" />
        <span className="text-sm font-medium text-fg truncate">{title}</span>
        {subtitle && <span className="text-sm text-fg-muted truncate">· {subtitle}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
            stale ? 'border-yellow/40 bg-yellow/5 text-yellow' : 'border-border bg-surface text-fg-muted',
          )}
          title={`Meta synced ${relative(freshness.hours_since_meta)} · GHL synced ${relative(freshness.hours_since_ghl)}`}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-yellow' : 'bg-green')} />
          <span>Meta {relative(freshness.hours_since_meta)} · GHL {relative(freshness.hours_since_ghl)}</span>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1">
          {RANGES.map(r => (
            <Link
              key={r.days}
              href={buildHref(r.days)}
              prefetch={false}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                r.days === days ? 'bg-pink text-black' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )}
            >
              {r.label}
            </Link>
          ))}
        </div>

        <span className="inline-flex items-center gap-1.5 rounded-lg border border-pink/30 bg-pink/10 px-3 py-1.5 text-xs text-pink">
          <Calendar size={12} />
          {rangeLabel}
        </span>
      </div>
    </div>
  );
}
