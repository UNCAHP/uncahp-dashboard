import { Sparkles } from 'lucide-react';

export function PlaceholderView({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-fg">{title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface p-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-pink/10">
          <Sparkles size={20} className="text-pink" />
        </div>
        <div className="mb-1 text-sm text-fg">Section placeholder</div>
        <div className="text-xs text-fg-muted">This view will be wired up next.</div>
      </div>
    </div>
  );
}
