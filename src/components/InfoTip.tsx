'use client';

import { useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';

// A small "ⓘ" that reveals an explanation on hover. Fixed-positioned so it's never
// clipped by table/overflow parents; wraps long text (unlike the truncation Tooltip).
export function InfoTip({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130), y: r.bottom + 6 });
  };

  return (
    <>
      <span
        ref={ref}
        onMouseEnter={show}
        onMouseLeave={() => setPos(null)}
        className={cn('inline-flex cursor-help items-center align-middle text-fg-dim transition-colors hover:text-fg', className)}
      >
        <Info size={12} />
      </span>
      {pos && (
        <span
          className="pointer-events-none fixed z-[100] w-56 -translate-x-1/2 rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-fg shadow-lg"
          style={{ left: pos.x, top: pos.y }}
        >
          {text}
        </span>
      )}
    </>
  );
}
