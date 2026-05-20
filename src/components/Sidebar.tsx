'use client';

import Link from 'next/link';
import { useState } from 'react';
import { LayoutGrid, BarChart3, FlaskConical, Phone, Building2, Shield, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn } from '@/lib/utils';

type View = 'overview' | 'client' | 'funnel' | 'calls' | 'clients' | 'admin';

const NAV: Array<{ id: View; label: string; icon: typeof LayoutGrid }> = [
  { id: 'overview', label: 'Portfolio Overview', icon: LayoutGrid },
  { id: 'client', label: 'Client View', icon: BarChart3 },
  { id: 'funnel', label: 'Funnel Analytics', icon: FlaskConical },
  { id: 'calls', label: 'Call Tracking', icon: Phone },
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
}: {
  view: View;
  selectedClient?: string;
  since: string;
  until: string;
  clients: ClientOption[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = clients.filter(c => c.client_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <aside
      className={cn(
        'sticky top-0 flex h-screen shrink-0 flex-col border-r border-border bg-bg transition-all duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        {collapsed ? (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-pink text-[10px] font-bold text-black">UN</div>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink text-[10px] font-bold text-black">UN</div>
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
        {NAV.map(item => {
          const Icon = item.icon;
          const active = view === item.id;
          const href = buildHref({
            view: item.id,
            client: item.id === 'client' ? selectedClient : undefined,
            since,
            until,
          });
          return (
            <Link
              key={item.id}
              href={href}
              prefetch={false}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active ? 'bg-pink text-black' : 'text-fg hover:bg-surface hover:text-pink',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
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
              const active = view === 'client' && selectedClient === c.client_id;
              return (
                <Link
                  key={c.client_id}
                  href={buildHref({ view: 'client', client: c.client_id, since, until })}
                  prefetch={false}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                    active ? 'bg-pink text-black' : 'text-fg hover:bg-surface/60 hover:text-pink',
                  )}
                >
                  <div
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-fg-muted"
                    style={{ background: clientColor(c.client_id) }}
                  >
                    {clientInitials(c.client_name)}
                  </div>
                  <span className="truncate text-left">{c.client_name}</span>
                </Link>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-2 py-3 text-xs text-fg-dim">No clients match.</div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3">
            <div className="flex items-center gap-2 text-[10px] text-fg-dim">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green" />
              <span>Live · Meta + GHL</span>
            </div>
          </div>
        </>
      )}
    </aside>
  );
}
