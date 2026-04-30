import { FreshnessReport } from '@/lib/queries';
import { cn } from '@/lib/utils';

function relative(hours: number | null) {
  if (hours == null) return 'unknown';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function FreshnessBadge({ freshness }: { freshness: FreshnessReport }) {
  const stale = freshness.is_stale;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs',
        stale ? 'border-yellow/40 bg-yellow/5 text-yellow' : 'border-border bg-surface text-fg-muted',
      )}
      title={`Meta synced ${relative(freshness.hours_since_meta)} · GHL synced ${relative(freshness.hours_since_ghl)}`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-yellow' : 'bg-green')} />
      <span>
        Meta {relative(freshness.hours_since_meta)} · GHL {relative(freshness.hours_since_ghl)}
      </span>
    </div>
  );
}
