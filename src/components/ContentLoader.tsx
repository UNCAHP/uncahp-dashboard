// First-load placeholder for the main data area, shaped like the page it stands in for
// (top bar, heading, summary strip, table) so the layout fills in rather than appearing.
// Later navigations never show this: the previous view stays up — see NavProgress.
const Bar = ({ className }: { className: string }) => <div className={`rounded-md bg-surface-2 ${className}`} />;

export function ContentLoader() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" role="status" aria-label="Loading">
      <div className="flex items-center justify-between border-b border-border px-8 py-4">
        <Bar className="h-5 w-48" />
        <Bar className="h-7 w-64" />
      </div>
      <div className="space-y-6 p-8">
        <div className="space-y-2">
          <Bar className="h-7 w-56" />
          <Bar className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-24 rounded-2xl border border-border bg-surface" />)}
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="space-y-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => <Bar key={i} className="h-5 w-full" />)}
          </div>
        </div>
      </div>
    </div>
  );
}
