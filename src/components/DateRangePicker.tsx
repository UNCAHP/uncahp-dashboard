'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
const disp = (d: Date) => `${d.getDate()} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();
const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

type Preset = { label: string; range: () => [Date, Date] };
const PRESETS: Preset[] = [
  { label: 'Today', range: () => [today(), today()] },
  { label: 'Yesterday', range: () => [addDays(today(), -1), addDays(today(), -1)] },
  { label: 'Last 7 Days', range: () => [addDays(today(), -6), today()] },
  { label: 'Last 14 Days', range: () => [addDays(today(), -13), today()] },
  { label: 'Last 28 Days', range: () => [addDays(today(), -27), today()] },
  { label: 'Last 30 Days', range: () => [addDays(today(), -29), today()] },
  { label: 'Last 90 Days', range: () => [addDays(today(), -89), today()] },
  { label: 'This Month', range: () => [startOfMonth(today()), today()] },
  { label: 'Last Month', range: () => {
    const s = addMonths(startOfMonth(today()), -1);
    return [s, new Date(s.getFullYear(), s.getMonth() + 1, 0)];
  } },
  { label: 'This Year', range: () => [new Date(today().getFullYear(), 0, 1), today()] },
  { label: 'All Time', range: () => [new Date(2024, 0, 1), today()] },
];

type Props = {
  since: string;
  until: string;
  view?: string;
  client?: string;
  funnel?: string;
};

export function DateRangePicker({ since, until, view, client, funnel }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<Date | null>(parse(since));
  const [end, setEnd] = useState<Date | null>(parse(until));
  const [leftMonth, setLeftMonth] = useState<Date>(addMonths(startOfMonth(parse(until)), -1));
  const ref = useRef<HTMLDivElement>(null);

  function cancel() {
    setStart(parse(since));
    setEnd(parse(until));
    setLeftMonth(addMonths(startOfMonth(parse(until)), -1));
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cancel();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function pickDay(d: Date) {
    if (!start || (start && end)) {
      setStart(d);
      setEnd(null);
    } else if (d < start) {
      setEnd(start);
      setStart(d);
    } else {
      setEnd(d);
    }
  }

  function applyPreset(p: Preset) {
    const [s, e] = p.range();
    setStart(s);
    setEnd(e);
    setLeftMonth(addMonths(startOfMonth(e), -1));
  }

  function apply() {
    if (!start || !end) return;
    const p = new URLSearchParams();
    if (view && view !== 'overview') p.set('view', view);
    if (client) p.set('client', client);
    if (funnel) p.set('funnel', funnel);
    p.set('since', iso(start));
    p.set('until', iso(end));
    router.push(`/?${p.toString()}`);
    setOpen(false);
  }

  const triggerLabel = `${disp(parse(since))} → ${disp(parse(until))}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => (open ? cancel() : setOpen(true))}
        className="inline-flex items-center gap-1.5 rounded-lg border border-pink/30 bg-pink/10 px-3 py-1.5 text-xs font-medium text-pink transition-colors hover:bg-pink/15"
      >
        <Calendar size={12} />
        {triggerLabel}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex overflow-hidden rounded-xl border border-border-strong bg-surface shadow-2xl shadow-black/60">
          {/* Presets */}
          <div className="w-36 shrink-0 border-r border-border py-2">
            {PRESETS.map(p => (
              <button
                key={p.label}
                type="button"
                onClick={() => applyPreset(p)}
                className="block w-full px-4 py-2 text-left text-xs text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Calendars */}
          <div className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setLeftMonth(addMonths(leftMonth, -1))}
                className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                onClick={() => setLeftMonth(addMonths(leftMonth, 1))}
                className="rounded p-1 text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                <ChevronRight size={16} />
              </button>
            </div>
            <div className="flex gap-6">
              <MonthGrid base={leftMonth} start={start} end={end} onPick={pickDay} />
              <MonthGrid base={addMonths(leftMonth, 1)} start={start} end={end} onPick={pickDay} />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-fg-muted">
                {start ? disp(start) : '—'} {' – '} {end ? disp(end) : '—'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={cancel}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-fg-muted hover:text-fg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={!start || !end}
                  className="rounded-lg bg-pink px-3 py-1.5 text-xs font-semibold text-black transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MonthGrid({
  base,
  start,
  end,
  onPick,
}: {
  base: Date;
  start: Date | null;
  end: Date | null;
  onPick: (d: Date) => void;
}) {
  const year = base.getFullYear();
  const month = base.getMonth();
  const startPad = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  const todayKey = dayKey(today());

  return (
    <div className="w-56">
      <div className="mb-2 text-center text-sm font-semibold text-fg">
        {MON[month]} {year}
      </div>
      <div className="mb-1 grid grid-cols-7 gap-0.5">
        {DOW.map(d => (
          <div key={d} className="text-center text-[10px] font-medium uppercase text-fg-dim">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = dayKey(d);
          const isStart = start && k === dayKey(start);
          const isEnd = end && k === dayKey(end);
          const inRange = start && end && k > dayKey(start) && k < dayKey(end);
          const isFuture = k > todayKey;
          return (
            <button
              key={i}
              type="button"
              disabled={isFuture}
              onClick={() => onPick(d)}
              className={cn(
                'flex h-8 items-center justify-center rounded text-xs tabular-nums transition-colors',
                isStart || isEnd
                  ? 'bg-pink font-semibold text-black'
                  : inRange
                    ? 'bg-pink/20 text-fg'
                    : isFuture
                      ? 'cursor-not-allowed text-fg-dim/50'
                      : 'text-fg hover:bg-surface-2',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
