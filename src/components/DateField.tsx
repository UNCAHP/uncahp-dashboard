'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// A single-date picker for forms, replacing <input type="date">.
//
// The native input renders in the BROWSER's locale, so a UK team on a US-defaulted browser
// reads 08/06/2026 as 8 June when it means 6 August. That ambiguity is unacceptable on a
// field that decides which week of data a result is measured against, so the date is always
// shown written out ("Thu 6 Aug 2026") and picked from a Monday-first calendar.
//
// The value travels in a hidden input as yyyy-mm-dd, so the server action is unchanged.

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Everything is handled in UTC — a date here is a calendar day, not an instant, and local
// midnight in a positive-offset zone would roll back a day when serialised.
const toISO = (d: Date): string => d.toISOString().slice(0, 10);
const parseISO = (s: string): Date => new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : toISO(new Date())}T12:00:00Z`);
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; };
const addMonths = (d: Date, n: number): Date => { const x = new Date(d); x.setUTCDate(1); x.setUTCMonth(x.getUTCMonth() + n); return x; };
const sameDay = (a: Date, b: Date): boolean => toISO(a) === toISO(b);

export const formatLongDate = (iso: string): string => {
  const d = parseISO(iso);
  return `${SHORT_DAY[d.getUTCDay()]} ${d.getUTCDate()} ${SHORT_MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

/** Monday-first grid of the 6 weeks covering a month. */
function monthGrid(month: Date): Date[] {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1, 12));
  const offset = (first.getUTCDay() + 6) % 7; // Sunday(0) → 6, Monday(1) → 0
  const start = addDays(first, -offset);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function DateField({ name, defaultValue, max }: {
  name: string;
  defaultValue?: string;
  /** Latest selectable day, yyyy-mm-dd. Days after it are disabled. */
  max?: string;
}) {
  const today = toISO(new Date());
  const [value, setValue] = useState<string>(defaultValue && /^\d{4}-\d{2}-\d{2}$/.test(defaultValue) ? defaultValue : today);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => addMonths(parseISO(defaultValue ?? today), 0));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selected = parseISO(value);
  const pick = (d: Date) => { setValue(toISO(d)); setMonth(addMonths(d, 0)); setOpen(false); };
  const disabled = (d: Date): boolean => !!max && toISO(d) > max;

  // Most log entries are written the same day or a day or two later, so those are one click.
  const quick: Array<{ label: string; date: Date }> = [
    { label: 'Today', date: parseISO(today) },
    { label: 'Yesterday', date: addDays(parseISO(today), -1) },
    { label: '1 week ago', date: addDays(parseISO(today), -7) },
  ];

  return (
    <div className="relative" ref={ref}>
      <input type="hidden" name={name} value={value} />
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-black/20 px-3 py-2 text-left text-sm text-fg transition-colors hover:border-border-strong focus:border-border-strong focus:outline-none"
      >
        <span className="inline-flex items-center gap-2">
          <CalendarDays size={14} className="text-fg-dim" />
          {formatLongDate(value)}
        </span>
        {value === today && <span className="text-[10px] uppercase tracking-wider text-fg-dim">today</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[17rem] overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-border px-2 py-2">
            <button type="button" onClick={() => setMonth(addMonths(month, -1))}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-white/5 hover:text-fg" aria-label="Previous month">
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs font-semibold text-fg">{MONTHS[month.getUTCMonth()]} {month.getUTCFullYear()}</span>
            <button type="button" onClick={() => setMonth(addMonths(month, 1))}
              className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-white/5 hover:text-fg" aria-label="Next month">
              <ChevronRight size={14} />
            </button>
          </div>

          <div className="px-2 pb-2 pt-1.5">
            <div className="grid grid-cols-7 gap-0.5">
              {DAY_NAMES.map(d => (
                <div key={d} className="py-1 text-center text-[9px] uppercase tracking-wider text-fg-dim">{d[0]}</div>
              ))}
              {monthGrid(month).map(d => {
                const outside = d.getUTCMonth() !== month.getUTCMonth();
                const isSel = sameDay(d, selected);
                const isToday = toISO(d) === today;
                const off = disabled(d);
                return (
                  <button
                    key={toISO(d)}
                    type="button"
                    disabled={off}
                    onClick={() => pick(d)}
                    className={cn(
                      'rounded-md py-1.5 text-center font-mono text-[11px] tabular-nums transition-colors',
                      isSel ? 'bg-pink font-bold text-black'
                        : off ? 'cursor-not-allowed text-fg-dim/40'
                        : outside ? 'text-fg-dim hover:bg-white/5'
                        : 'text-fg hover:bg-white/10',
                      !isSel && isToday && 'ring-1 ring-inset ring-pink/50',
                    )}
                  >
                    {d.getUTCDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex gap-1 border-t border-border px-2 py-2">
            {quick.map(q => (
              <button
                key={q.label}
                type="button"
                disabled={disabled(q.date)}
                onClick={() => pick(q.date)}
                className="flex-1 rounded-md px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-white/5 hover:text-fg disabled:opacity-40"
              >
                {q.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
