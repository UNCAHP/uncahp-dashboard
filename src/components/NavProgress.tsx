'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ComponentProps, type MouseEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// In-app navigation that keeps the current view on screen while the next one loads.
// Every date / tab / client change goes through `navigate`, which runs the route change
// in a transition: the old content stays (dimmed) under a thin progress bar instead of
// being swapped for a spinner.
// `target` is the href being loaded (null when idle), so the control that was clicked can
// show itself as selected straight away rather than when the data lands.
const NavContext = createContext<{ navigate: (href: string) => void; pending: boolean; target: string | null }>({ navigate: () => {}, pending: false, target: null });

export const useNav = () => useContext(NavContext);

export function NavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [href, setHref] = useState<string | null>(null);
  const navigate = useCallback((to: string) => { setHref(to); start(() => router.push(to)); }, [router]);
  const value = useMemo(() => ({ navigate, pending, target: pending ? href : null }), [navigate, pending, href]);
  return (
    <NavContext.Provider value={value}>
      {pending && <div className="nav-progress" role="progressbar" aria-label="Loading" />}
      {children}
    </NavContext.Provider>
  );
}

// The data area. Dims while a navigation is in flight.
export function NavMain({ children, className }: { children: ReactNode; className?: string }) {
  const { pending } = useNav();
  return <main className={cn('nav-main', className)} data-pending={pending || undefined} aria-busy={pending}>{children}</main>;
}

// A <Link> that reports its navigation to the progress bar. Modified clicks (new tab,
// new window) are left to the browser.
export function NavLink({ href, onClick, ...rest }: Omit<ComponentProps<typeof Link>, 'href'> & { href: string }) {
  const { navigate } = useNav();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };
  return <Link href={href} prefetch={false} onClick={handle} {...rest} />;
}
