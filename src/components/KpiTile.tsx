import { cn } from '@/lib/utils';

type Props = {
  label: string;
  value: string;
  icon?: React.ReactNode;
  className?: string;
  hint?: string;
};

export function KpiTile({ label, value, icon, className, hint }: Props) {
  return (
    <div
      className={cn(
        'relative rounded-xl border border-border bg-surface p-6 transition-colors hover:bg-surface-2',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <span className="text-xs font-medium uppercase tracking-widest text-fg-muted">
          {label}
        </span>
        {icon ? <span className="text-fg-dim">{icon}</span> : null}
      </div>
      <div className="mt-4 font-mono text-4xl font-semibold tabular-nums text-fg">
        {value}
      </div>
      {hint ? (
        <div className="mt-2 text-xs text-fg-dim">{hint}</div>
      ) : null}
    </div>
  );
}
