'use client';

import { Fragment } from 'react';
import { Eye, MousePointerClick, Landmark, ArrowDown, ArrowRight } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';

// The LP views → opt-ins → deposits flow: three stage cards joined by "continue" connectors.
// Shared by the funnel detail view and each split test version so they read the same way.

export type Stage = {
  key: string;
  label: string;
  icon: typeof Eye;
  value: number | null;
  caption: string;
  breakdown?: { label: string; value: number }[];
};

export const STAGE_ICONS = { views: Eye, optins: MousePointerClick, deposits: Landmark } as const;

export function StageFlow({ stages, accent = 'pink', compact = false }: { stages: readonly Stage[]; accent?: 'pink' | 'green'; compact?: boolean }) {
  const top = stages[0].value && stages[0].value > 0 ? stages[0].value : Math.max(...stages.map(s => s.value ?? 0), 1);
  const share = (v: number | null) => (v == null ? null : Math.round((v / top) * 1000) / 10);
  // Stage-to-stage conversion (e.g. deposits / opt-ins), shown on the connector.
  const stepPct = (from: number | null, to: number | null) =>
    from == null || to == null || from === 0 ? null : Math.round((to / from) * 1000) / 10;

  return (
    <div className={cn('flex flex-col lg:flex-row lg:items-stretch', compact ? 'gap-2' : 'gap-3')}>
      {stages.map((s, i) => (
        <Fragment key={s.key}>
          <StageCard
            label={s.label}
            icon={s.icon}
            value={s.value}
            share={share(s.value)}
            widthPct={s.value == null ? 0 : Math.max(4, share(s.value) ?? 0)}
            caption={s.caption}
            breakdown={s.breakdown}
            accent={accent}
            compact={compact}
          />
          {i < stages.length - 1 && (
            <StageConnector
              pct={stepPct(s.value, stages[i + 1].value)}
              dropped={s.value != null && stages[i + 1].value != null ? s.value - (stages[i + 1].value as number) : null}
              accent={accent}
              compact={compact}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function StageCard({
  label, icon: Icon, value, share, widthPct, caption, breakdown, accent = 'pink', compact = false,
}: {
  label: string;
  icon: typeof Eye;
  value: number | null;
  share: number | null;
  widthPct: number;
  caption: string;
  breakdown?: { label: string; value: number }[];
  accent?: 'pink' | 'green';
  compact?: boolean;
}) {
  const iconColor = accent === 'green' ? 'text-green' : 'text-pink';
  const fill = accent === 'green' ? 'from-green/70 to-green' : 'from-pink/70 to-pink';
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col rounded-xl border border-border bg-surface-2/30', compact ? 'p-4' : 'p-5')}>
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2"><Icon size={15} className={iconColor} /></div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</span>
      </div>
      <div className={cn('flex items-baseline gap-2', compact ? 'mt-2' : 'mt-3')}>
        <span className={cn('font-mono font-bold tabular-nums text-fg', compact ? 'text-2xl' : 'text-3xl')}>{value == null ? '—' : formatNumber(value)}</span>
        {share != null && <span className="text-xs tabular-nums text-fg-dim">{share}%</span>}
      </div>
      {breakdown && (
        <div className="mt-2.5 flex gap-2">
          {breakdown.map(b => (
            <div key={b.label} className="flex flex-1 flex-col items-center gap-0.5 rounded-lg border border-border/60 bg-surface-2/40 px-2.5 py-2">
              <span className="text-[9px] font-medium uppercase tracking-wide text-fg-muted">{b.label}</span>
              <span className="font-mono text-base font-bold tabular-nums text-fg">{formatNumber(b.value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-1 truncate text-[11px] text-fg-dim" title={caption}>{caption}</div>
      <div className={cn('mt-auto', compact ? 'pt-3' : 'pt-4')}>
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div className={cn('h-full rounded-full bg-gradient-to-r transition-[width] duration-500', fill)} style={{ width: `${widthPct}%` }} />
        </div>
      </div>
    </div>
  );
}

export function StageConnector({ pct, dropped, accent = 'pink', compact = false }: { pct: number | null; dropped: number | null; accent?: 'pink' | 'green'; compact?: boolean }) {
  return (
    <div className={cn('flex shrink-0 items-center justify-center gap-2 lg:flex-col lg:gap-1', compact ? 'lg:w-16' : 'lg:w-24')}>
      <ArrowDown size={16} className="text-fg-dim lg:hidden" />
      <ArrowRight size={18} className="hidden text-fg-dim lg:block" />
      <div className="text-center">
        <div className={cn('text-sm font-bold', accent === 'green' ? 'text-green' : 'text-pink')}>{pct == null ? '—' : `${pct}%`}</div>
        <div className="text-[9px] uppercase tracking-wide text-fg-dim">continue</div>
        {dropped != null && dropped > 0 && <div className="text-[9px] text-fg-dim">−{formatNumber(dropped)}</div>}
      </div>
    </div>
  );
}
