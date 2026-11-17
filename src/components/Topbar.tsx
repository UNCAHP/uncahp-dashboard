'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { FreshnessReport } from '@/lib/queries';
import type { SyncStatus } from '@/lib/syncStatus';
import { syncStatusAction } from '@/app/actions/sync';
import { DateRangePicker } from '@/components/DateRangePicker';
import { cn } from '@/lib/utils';

function relative(hours: number | null) {
  if (hours == null) return 'unknown';
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// While the daily sync runs, check its progress often; otherwise now and then, so a page
// left open at 06:00 UTC still notices the sync start.
const POLL_RUNNING_MS = 15_000;
const POLL_IDLE_MS = 120_000;

// Follows the daily sync: shows progress while it runs and refreshes the page's data once
// every client has finished, so nobody has to guess whether the numbers are complete.
function useSyncStatus(initial: SyncStatus) {
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const wasRunning = useRef(initial.running);

  // A server render (navigation, refresh) brings a newer status: take it.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) { setSeen(initial); setStatus(initial); }

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const next = await syncStatusAction();
        if (stopped) return;
        setStatus(next);
        if (wasRunning.current && !next.running) {
          toast.success('Sync finished: the data is up to date');
          router.refresh();
        }
        wasRunning.current = next.running;
      } catch { /* offline or signed out: try again next tick */ }
    };
    const id = setInterval(tick, status.running ? POLL_RUNNING_MS : POLL_IDLE_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [status.running, router]);

  return status;
}

export function Topbar({
  title,
  subtitle,
  freshness,
  syncStatus,
  since,
  until,
  view,
  client,
  funnel,
}: {
  title: string;
  subtitle?: string | null;
  freshness: FreshnessReport;
  syncStatus: SyncStatus;
  since: string;
  until: string;
  view?: string;
  client?: string;
  funnel?: string;
}) {
  const sync = useSyncStatus(syncStatus);
  const stale = freshness.is_stale;
  const waiting = sync.pending.length ? `Still syncing: ${sync.pending.join(', ')}` : 'Starting…';

  return (
    <div className="sticky top-0 z-10 border-b border-border bg-bg/80 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="h-5 w-1 rounded-full bg-pink" />
          <span className="truncate text-sm font-medium text-fg">{title}</span>
          {subtitle && <span className="truncate text-sm text-fg-muted">· {subtitle}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sync.running ? (
            <div
              className="flex items-center gap-2 rounded-lg border border-yellow/40 bg-yellow/5 px-3 py-1.5 text-xs text-yellow"
              title={waiting}
            >
              <Loader2 size={12} className="animate-spin" />
              <span>Syncing {sync.done}/{sync.total} clients</span>
            </div>
          ) : (
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
          )}

          <DateRangePicker since={since} until={until} view={view} client={client} funnel={funnel} />
        </div>
      </div>

      {sync.running && (
        <div role="status" className="flex items-center gap-3 border-t border-yellow/20 bg-yellow/5 px-8 py-2 text-xs text-yellow">
          <div className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-yellow/15">
            <div className="h-full rounded-full bg-yellow transition-[width] duration-500"
              style={{ width: `${sync.total ? Math.round((sync.done / sync.total) * 100) : 0}%` }} />
          </div>
          <span>
            Today&apos;s data is syncing ({sync.done} of {sync.total} clients done). Numbers may be incomplete
            until it finishes, usually a few minutes. This page updates itself when it&apos;s done.
          </span>
        </div>
      )}
    </div>
  );
}
