import { FreshnessReport } from '@/lib/queries';
import { cn } from '@/lib/utils';

function relative(hours: number | null) {
  if (hours == null) return 'unknown';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Freshness for a single daily-synced source.
 *
 * The point is that a sync which quietly stops looks identical to one that's working —
 * the numbers just stop moving. This makes "last updated" visible, and goes amber once
 * the age exceeds a normal gap between runs.
 */
export function SyncBadge({ label, hours, staleAfterHours = 30 }: {
  label: string;
  hours: number | null;
  staleAfterHours?: number;
}) {
  // Never synced is its own state — amber, but say so rather than showing "unknown ago".
  const never = hours == null;
  const stale = never || hours > staleAfterHours;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px]',
        stale ? 'border-yellow/40 bg-yellow/5 text-yellow' : 'border-border bg-surface text-fg-muted',
      )}
      title={never
        ? `${label} has never synced`
        : `${label} last synced ${relative(hours)}. Goes amber past ${staleAfterHours}h — the daily cron runs at 06:00 UTC.`}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-yellow' : 'bg-green')} />
      <span>{never ? `${label} · never synced` : `${label} · synced ${relative(hours)}`}</span>
    </div>
  );
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
