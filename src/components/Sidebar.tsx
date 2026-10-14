'use client';

import { NavLink, useNav } from '@/components/NavProgress';
import { useState } from 'react';
import { LayoutGrid, BarChart3, FlaskConical, Phone, Target, Building2, Shield, ChevronLeft, ChevronRight, Search, LogOut } from 'lucide-react';
import { signOutAction } from '@/app/actions/auth';
import type { ClientOption } from '@/lib/queries';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/Tooltip';

type View = 'overview' | 'client' | 'funnel' | 'calls' | 'bookings' | 'kpis' | 'clients' | 'admin';

const NAV: Array<{ id: View; label: string; icon: typeof LayoutGrid }> = [
  { id: 'overview', label: 'Portfolio Overview', icon: LayoutGrid },
  { id: 'client', label: 'Client View', icon: BarChart3 },
  { id: 'funnel', label: 'Funnel Analytics', icon: FlaskConical },
  { id: 'calls', label: 'CSR Dashboard', icon: Phone },
  // Bookings is archived for now — hidden from the nav, but the page, its data, and the
  // bookings feed into the KPI scorecard all still work. Reachable at /?view=bookings, and
  // un-archiving is just restoring this line:
  //   { id: 'bookings', label: 'Bookings', icon: CalendarCheck },
  { id: 'kpis', label: 'KPIs', icon: Target },
  { id: 'clients', label: 'Clients', icon: Building2 },
  { id: 'admin', label: 'Admin Panel', icon: Shield },
];

function buildHref(params: { view?: View; client?: string; since: string; until: string }) {
  const p = new URLSearchParams();
  if (params.view && params.view !== 'overview') p.set('view', params.view);
  if (params.client) p.set('client', params.client);
  p.set('since', params.since);
  p.set('until', params.until);
  return `/?${p.toString()}`;
}

export function Sidebar({
  view,
  selectedClient,
  since,
  until,
  clients,
  pages,
  userName,
  userRole,
}: {
  view: View;
  selectedClient?: string;
  since: string;
  until: string;
  clients: ClientOption[];
  pages: string[];      // the pages this user's role can open — only those are listed
  userName: string;
  userRole: string;
}) {
  const nav = NAV.filter(item => pages.includes(item.id));
  const showClients = pages.includes('client');
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = clients.filter(c => c.client_name.toLowerCase().includes(search.toLowerCase()));

  // The clicked item lights up at once, while its page is still loading.
  const { target } = useNav();
  const navHrefs = nav.map(item => buildHref({ view: item.id, client: item.id === 'client' ? selectedClient : undefined, since, until }));
  const clientHref = (id: string) => buildHref({ view: 'client', client: id, since, until });
  const jumping = !!target && (navHrefs.includes(target) || clients.some(c => clientHref(c.client_id) === target));

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg transition-[width] duration-200 ease-(--ease-out)',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        {collapsed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/UNCAHP%20LOGO.png" alt="UNCAHP" className="mx-auto h-8 w-8 object-contain" />
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/UNCAHP%20LOGO.png" alt="UNCAHP" className="h-9 w-9 object-contain" />
              <div>
                <div className="text-sm font-bold leading-tight text-fg">UNCAHP</div>
                <div className="text-[9px] uppercase tracking-widest text-fg">Client Dashboard</div>
              </div>
            </div>
            <button onClick={() => setCollapsed(true)} className="text-fg-dim hover:text-fg" aria-label="Collapse sidebar">
              <ChevronLeft size={16} />
            </button>
          </>
        )}
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="mx-auto mt-2 text-fg-dim hover:text-fg"
          aria-label="Expand sidebar"
        >
          <ChevronRight size={16} />
        </button>
      )}

      <nav className="space-y-1 p-3">
        {nav.map(item => {
          const Icon = item.icon;
          const href = buildHref({
            view: item.id,
            client: item.id === 'client' ? selectedClient : undefined,
            since,
            until,
          });
          const active = jumping ? target === href : view === item.id;
          return (
            <NavLink
              key={item.id}
              href={href}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-pink text-black' : 'text-fg hover:bg-surface hover:text-pink',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {!collapsed && showClients && (
        <>
          <div className="px-4 pb-2 pt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-fg">
              Clients ({clients.length})
            </div>
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search clients..."
                className="w-full rounded-lg border border-border bg-surface py-1.5 pl-7 pr-2 text-xs text-fg placeholder:text-fg-muted focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>

          <div className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
            {filtered.map(c => {
              const href = clientHref(c.client_id);
              const active = jumping ? target === href : view === 'client' && selectedClient === c.client_id;
              return (
                <NavLink
                  key={c.client_id}
                  href={href}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                    active ? 'bg-pink text-black' : 'text-fg hover:bg-surface/60 hover:text-pink',
                  )}
                >
                  {c.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.logo_url} alt="" className="h-6 w-6 shrink-0 rounded-md border border-border object-cover" />
                  ) : (
                    <div
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-fg-muted"
                      style={{ background: clientColor(c.client_id) }}
                    >
                      {clientInitials(c.client_name)}
                    </div>
                  )}
                  <Tooltip label={c.client_name} className="text-left">{c.client_name}</Tooltip>
                </NavLink>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-xs text-fg-dim">No clients match.</div>
            )}
          </div>

        </>
      )}

      {/* Who's signed in, pinned to the bottom. */}
      <div className={cn('mt-auto flex items-center gap-2 border-t border-border', collapsed ? 'justify-center px-2 py-3' : 'px-4 py-3')}>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-fg">{userName}</div>
            <div className="text-[10px] text-fg-dim">{userRole}</div>
          </div>
        )}
        <form action={signOutAction}>
          <Tooltip label="Sign out" always>
            <button type="submit" aria-label="Sign out" className="rounded-md p-1.5 text-fg-dim transition-colors hover:bg-surface hover:text-pink">
              <LogOut size={14} />
            </button>
          </Tooltip>
        </form>
      </div>
    </aside>
  );
}
