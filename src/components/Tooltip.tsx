'use client';

import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Wraps a single line of text with `truncate`. On hover it shows the full value in
// a small popup — but only when the text is actually clipped. Uses fixed
// positioning so it's never cut off by a parent's overflow (tables, sidebar list).
export function Tooltip({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return; // not truncated → no popup
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 80), window.innerWidth - 80);
    setPos({ x, y: r.bottom + 6 });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} className={cn('block truncate', className)}>
        {children}
      </span>
      {pos && (
        <span
          className="pointer-events-none fixed z-[100] max-w-xs -translate-x-1/2 whitespace-nowrap rounded-md border border-border-strong bg-surface-2 px-2 py-1 text-xs text-fg shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          {label}
        </span>
      )}
    </>
  );
}
