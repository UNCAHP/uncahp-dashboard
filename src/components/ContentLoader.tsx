import { Loader2 } from 'lucide-react';

// Loading placeholder for the main data area — the sidebar stays put; only the content
// (topbar + numbers) is replaced by a centered spinner while a new date/view/funnel loads.
export function ContentLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-pink motion-reduce:animate-none" aria-label="Loading" />
    </div>
  );
}
