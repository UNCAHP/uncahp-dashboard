// Content-only loading placeholder — the sidebar stays put; only the main data area
// (topbar + cards/numbers) shows the skeleton while a new date/view/funnel loads.

function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 motion-reduce:animate-none ${className}`} />;
}

export function ContentSkeleton() {
  return (
    <>
      {/* Topbar */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-8 py-4">
        <div className="space-y-2">
          <Bar className="h-3.5 w-40" />
          <Bar className="h-2.5 w-56" />
        </div>
        <div className="flex items-center gap-3">
          <Bar className="h-8 w-40 rounded-lg" />
          <Bar className="h-8 w-44 rounded-lg" />
        </div>
      </div>

      {/* Content */}
      <div className="space-y-6 p-8">
        <div className="space-y-2.5">
          <Bar className="h-8 w-64" />
          <Bar className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center gap-2.5">
                <Bar className="h-8 w-8 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Bar className="h-3.5 w-2/3" />
                  <Bar className="h-2.5 w-1/3" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <Bar className="h-14 rounded-lg" />
                <Bar className="h-14 rounded-lg" />
                <Bar className="h-14 rounded-lg" />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
                <Bar className="h-6" />
                <Bar className="h-6" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
