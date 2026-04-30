'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, X } from 'lucide-react';
import { ClientOption } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function ClientFilter({ clients, activeClientId }: { clients: ClientOption[]; activeClientId?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  function pick(clientId: string | null) {
    const next = new URLSearchParams(params.toString());
    if (clientId) next.set('client', clientId);
    else next.delete('client');
    router.push(next.toString() ? `/?${next.toString()}` : '/');
    setOpen(false);
    setSearch('');
  }

  const active = clients.find((c) => c.client_id === activeClientId);
  const filtered = search
    ? clients.filter((c) => c.client_name.toLowerCase().includes(search.toLowerCase()))
    : clients;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm transition-colors',
          'hover:border-border-strong focus:border-pink focus:outline-none',
          active ? 'text-fg' : 'text-fg-muted',
        )}
      >
        <span>{active ? active.client_name : 'All clients'}</span>
        {active ? (
          <X
            size={14}
            className="text-fg-dim hover:text-fg"
            onClick={(e) => { e.stopPropagation(); pick(null); }}
          />
        ) : (
          <ChevronDown size={14} className="text-fg-dim" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-border bg-surface shadow-2xl">
          <div className="border-b border-border p-2">
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full rounded bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none placeholder:text-fg-dim"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            <li>
              <button
                type="button"
                onClick={() => pick(null)}
                className={cn(
                  'w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2',
                  !active ? 'text-pink' : 'text-fg-muted',
                )}
              >
                All clients
              </button>
            </li>
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-fg-dim">No matches</li>
            ) : (
              filtered.map((c) => (
                <li key={c.client_id}>
                  <button
                    type="button"
                    onClick={() => pick(c.client_id)}
                    className={cn(
                      'w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-2',
                      c.client_id === activeClientId ? 'text-pink' : 'text-fg',
                    )}
                  >
                    {c.client_name}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
