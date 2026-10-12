'use client';

import { useState } from 'react';
import type { FunnelDay } from '@/lib/queries';
import { cn } from '@/lib/utils';

// Opt-ins and deposits per day across the selected dates: two bars per day on one shared
// scale. Hovering (or focusing) a day reads its numbers out in the header; with nothing
// hovered the header shows the range totals.
const fmtDay = (iso: string, withWeekday = false) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withWeekday ? { weekday: 'short' } : {}) });

// A "nice" axis top: the smallest of 1/2/5 × 10ⁿ steps that gives at most four gridlines.
function axis(max: number) {
  if (max <= 4) return { top: Math.max(max, 1), step: 1 };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * pow).find(s => s >= raw)!;
  return { top: Math.ceil(max / step) * step, step };
}

export function FunnelDailyChart({ days, note }: { days: FunnelDay[]; note?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const totalOptins = days.reduce((s, d) => s + d.optins, 0);
  const totalDeposits = days.reduce((s, d) => s + d.deposits, 0);
  const { top, step } = axis(Math.max(0, ...days.map(d => Math.max(d.optins, d.deposits))));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const shown = hover != null ? days[hover] : null;
  // Roughly eight date labels however long the range is.
  const every = Math.max(1, Math.ceil(days.length / 8));

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-fg">Opt-ins and deposits by day</div>
          <div className="mt-0.5 text-[11px] text-fg-dim">{shown ? fmtDay(shown.date, true) : `${fmtDay(days[0].date)} to ${fmtDay(days[days.length - 1].date)}`}{!shown && note ? ` · ${note}` : ''}</div>
        </div>
        <div className="flex items-center gap-5">
          <Legend swatch="bg-pink" label="Opt-ins" value={shown ? shown.optins : totalOptins} />
          <Legend swatch="bg-green" label="Deposits" value={shown ? shown.deposits : totalDeposits} />
        </div>
      </div>

      {totalOptins + totalDeposits === 0 ? (
        <p className="mt-6 text-sm text-fg-muted">No opt-ins or deposits in these dates.</p>
      ) : (
        // The plot grows to fill the card, so it lines up with a taller neighbour.
        <div className="mt-5 flex flex-1 gap-3">
          <div className="flex flex-col">
            <div className="flex min-h-48 flex-1 flex-col-reverse justify-between text-right font-mono text-[10px] tabular-nums text-fg-dim">
              {ticks.map(t => <span key={t} className="leading-none">{t}</span>)}
            </div>
            <div className="mt-2 h-3" />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-48 flex-1" onMouseLeave={() => setHover(null)}>
              {ticks.map(t => (
                <div key={t} className={cn('pointer-events-none absolute inset-x-0 border-t', t === 0 ? 'border-border' : 'border-border/40')} style={{ bottom: `${(t / top) * 100}%` }} />
              ))}
              <div className="absolute inset-0 flex items-stretch">
                {days.map((d, i) => (
                  <button
                    key={d.date}
                    type="button"
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    aria-label={`${fmtDay(d.date, true)}: ${d.optins} opt-ins, ${d.deposits} deposits`}
                    className={cn('chart-day relative min-w-0 flex-1 transition-colors', hover === i && 'bg-surface-2')}
                  >
                    {/* Absolutely filled so the bars' percentage heights have a definite box to measure against. */}
                    <span className="absolute inset-0 flex items-end justify-center gap-px px-[8%]">
                      <span className={cn('w-1/2 max-w-3 rounded-t-sm bg-pink transition-opacity', hover != null && hover !== i && 'opacity-40')} style={{ height: `${(d.optins / top) * 100}%`, minHeight: d.optins ? 2 : 0 }} />
                      <span className={cn('w-1/2 max-w-3 rounded-t-sm bg-green transition-opacity', hover != null && hover !== i && 'opacity-40')} style={{ height: `${(d.deposits / top) * 100}%`, minHeight: d.deposits ? 2 : 0 }} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex">
              {days.map((d, i) => (
                <div key={d.date} className="relative h-3 min-w-0 flex-1">
                  {(i % every === 0) && <span className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-fg-dim">{fmtDay(d.date)}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ swatch, label, value }: { swatch: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn('h-2.5 w-2.5 rounded-sm', swatch)} />
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="font-mono text-sm font-bold tabular-nums text-fg">{value}</span>
    </div>
  );
}
