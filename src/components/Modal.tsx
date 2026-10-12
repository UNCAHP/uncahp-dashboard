'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// The one dialog shell: dimmed backdrop, centred panel that settles in from just under
// full size. Closes on Escape or a press on the backdrop, locks page scroll while open,
// takes focus on open and hands it back on close. Rendered at the document root so it
// sits above everything (and isn't dimmed with the page during a navigation).
export function Modal({
  title,
  icon: Icon,
  size = '2xl',
  onClose,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  size?: 'md' | 'lg' | '2xl';
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // Leave focus alone if something inside already claimed it (an autoFocus button).
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close.current(); } };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    // A press that starts on the backdrop closes; one that starts inside (e.g. dragging a
    // text selection out of a field) doesn't.
    <div className="modal-backdrop fixed inset-0 z-[150] overflow-y-auto bg-black/70" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex min-h-full items-center justify-center p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          className={cn(
            'modal-panel w-full rounded-2xl border border-border bg-surface shadow-2xl outline-none',
            size === 'md' ? 'max-w-md' : size === 'lg' ? 'max-w-lg' : 'max-w-2xl',
          )}
        >
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2.5">
              {Icon && <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><Icon size={16} className="text-pink" /></div>}
              <h2 className="text-base font-semibold text-fg">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
