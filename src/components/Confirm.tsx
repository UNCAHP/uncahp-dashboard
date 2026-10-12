'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { Modal } from '@/components/Modal';
import { cn } from '@/lib/utils';

// In-app replacement for window.confirm:
//   const confirm = useConfirm();
//   if (!(await confirm({ title: 'Delete booking?', body: '…', confirmLabel: 'Delete', danger: true }))) return;
type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // red confirm button, for anything that can't be undone
};

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(async () => false);

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>(resolve => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOpts(o);
  }), []);

  const answer = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <Modal title={opts.title} size="md" onClose={() => answer(false)}>
          {opts.body && <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{opts.body}</p>}
          <div className={cn('flex justify-end gap-2', opts.body && 'mt-6')}>
            <button type="button" onClick={() => answer(false)} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg-muted hover:border-border-strong hover:text-fg">
              {opts.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => answer(true)}
              className={cn('rounded-lg px-4 py-2 text-sm font-semibold', opts.danger ? 'bg-red text-white hover:bg-red/85' : 'bg-pink text-black hover:bg-pink-soft')}
            >
              {opts.confirmLabel ?? 'Confirm'}
            </button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
