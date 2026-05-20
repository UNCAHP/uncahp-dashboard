import type { FreshnessReport } from '@/lib/queries';
import { DateRangePicker } from '@/components/DateRangePicker';
import { cn } from '@/lib/utils';

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
  since,
  until,
  view,
  client,
  funnel,
}: {
  title: string;
  subtitle?: string | null;
  freshness: FreshnessReport;
  since: string;
  until: string;
  view?: string;
  client?: string;
  funnel?: string;
}) {
  const stale = freshness.is_stale;

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg/80 px-8 py-4 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="h-5 w-1 rounded-full bg-pink" />
        <span className="truncate text-sm font-medium text-fg">{title}</span>
        {subtitle && <span className="truncate text-sm text-fg-muted">· {subtitle}</span>}
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

        <DateRangePicker since={since} until={until} view={view} client={client} funnel={funnel} />
      </div>
    </div>
  );
}
