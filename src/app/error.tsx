'use client';

import { AlertTriangle, RotateCcw } from 'lucide-react';

// Route-level error boundary. Without it, any uncaught server error — including one
// thrown by a server action — replaces the whole dashboard with Next's blank error page.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        <AlertTriangle size={24} className="mx-auto mb-3 text-yellow" />
        <div className="text-sm font-semibold text-fg">Something went wrong</div>
        <p className="mt-1 text-xs text-fg-muted">The dashboard hit a server error. Your data is untouched.</p>
        {error.digest && <div className="mt-2 font-mono text-[10px] text-fg-dim">ref {error.digest}</div>}
        <button onClick={reset} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-pink px-3 py-1.5 text-xs font-semibold text-black hover:opacity-90">
          <RotateCcw size={12} /> Try again
        </button>
      </div>
    </div>
  );
}
