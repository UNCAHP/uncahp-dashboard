import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const RADIUS = 42;
const ARC_LEN = Math.PI * RADIUS; // length of the top semicircle

/**
 * Semicircle gauge KPI card. The arc fills 0→1 in UNCAHP pink against a dim
 * track. `fillPct` is the value's progress toward its target.
 */
export function GaugeCard({
  label,
  value,
  fillPct,
  icon: Icon,
  hero = false,
  hint,
}: {
  label: string;
  value: string;
  fillPct: number;
  icon: LucideIcon;
  hero?: boolean;
  hint?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fillPct) ? fillPct : 0));

  return (
    <div
      className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong"
      title={hint}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">{label}</span>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2">
          <Icon size={13} className="text-fg-muted" />
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-[200px]">
        <svg viewBox="0 0 100 54" className="w-full">
          <path
            d="M 8 50 A 42 42 0 0 1 92 50"
            fill="none"
            stroke="var(--color-surface-2)"
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M 8 50 A 42 42 0 0 1 92 50"
            fill="none"
            stroke="var(--color-pink)"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={ARC_LEN}
            strokeDashoffset={ARC_LEN * (1 - pct)}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span
            className={cn(
              'font-extrabold tracking-tight text-fg tabular-nums',
              hero ? 'text-3xl' : 'text-2xl',
            )}
          >
            {value}
          </span>
        </div>
      </div>
    </div>
  );
}
