'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ClientRow } from '@/lib/queries';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn, formatGBP, formatNumber, formatPercent } from '@/lib/utils';

type SortKey = 'spend_gbp' | 'leads' | 'cpl_gbp' | 'purchases' | 'bookings' | 'revenue_gbp' | 'roas' | 'conv_rate_pct' | 'cac_gbp';

const HEADERS: Array<{ key: SortKey | 'name'; label: string; sortable: boolean; align: 'left' | 'right' }> = [
  { key: 'name', label: 'Client', sortable: false, align: 'left' },
  { key: 'spend_gbp', label: 'Spend', sortable: true, align: 'right' },
  { key: 'leads', label: 'Leads', sortable: true, align: 'right' },
  { key: 'cpl_gbp', label: 'CPL', sortable: true, align: 'right' },
  { key: 'purchases', label: 'Deposits', sortable: true, align: 'right' },
  { key: 'bookings', label: 'Bookings', sortable: true, align: 'right' },
  { key: 'revenue_gbp', label: 'Revenue', sortable: true, align: 'right' },
  { key: 'roas', label: 'ROAS', sortable: true, align: 'right' },
  { key: 'conv_rate_pct', label: 'Conv Rate', sortable: true, align: 'right' },
  { key: 'cac_gbp', label: 'CAC', sortable: true, align: 'right' },
];

function colorForConv(v: number | null) {
  if (v == null) return 'text-fg-dim';
  if (v >= 5) return 'text-green';
  if (v >= 3) return 'text-yellow';
  return 'text-red';
}
function colorForCac(v: number | null) {
  if (v == null) return 'text-fg-dim';
  if (v <= 150) return 'text-green';
  if (v <= 250) return 'text-yellow';
  return 'text-red';
}
function colorForRoas(v: number | null) {
  if (v == null) return 'text-fg-dim';
  if (v >= 5) return 'text-green';
  if (v >= 2) return 'text-yellow';
  return 'text-red';
}

export function ClientTableV2({ rows, days }: { rows: ClientRow[]; days: number }) {
  const [sortBy, setSortBy] = useState<SortKey>('spend_gbp');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = [...rows].sort((a, b) => {
    const av = (a[sortBy] ?? 0) as number;
    const bv = (b[sortBy] ?? 0) as number;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortBy(key); setSortDir('desc'); }
  };

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border p-5">
        <div>
          <div className="text-sm font-semibold text-fg">All Clients</div>
          <div className="mt-0.5 text-xs text-fg-muted">{rows.length} active · sorted by {HEADERS.find(h => h.key === sortBy)?.label}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              {HEADERS.map(h => (
                <th
                  key={h.key}
                  onClick={() => h.sortable && handleSort(h.key as SortKey)}
                  className={cn(
                    'px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-fg-muted',
                    h.align === 'right' ? 'text-right' : 'text-left',
                    h.sortable ? 'cursor-pointer hover:text-fg' : '',
                  )}
                >
                  <span className="inline-flex items-center gap-1">
                    {h.label}
                    {sortBy === h.key && <span className="text-[8px] text-pink">{sortDir === 'desc' ? '▼' : '▲'}</span>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={HEADERS.length} className="px-5 py-12 text-center text-fg-dim">
                  No data for this date range.
                </td>
              </tr>
            ) : (
              sorted.map(r => (
                <tr key={r.client_id} className="group border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
                  <td className="px-5 py-3.5">
                    <Link
                      href={`/?view=client&client=${r.client_id}&days=${days}`}
                      prefetch={false}
                      className="flex items-center gap-2.5"
                    >
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-bold text-fg-muted"
                        style={{ background: clientColor(r.client_id) }}
                      >
                        {clientInitials(r.client_name || r.client_id)}
                      </div>
                      <span className="text-sm text-fg group-hover:text-pink-soft">
                        {r.client_name || r.client_id}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-fg">{formatGBP(r.spend_gbp, { decimals: 2 })}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-fg">{formatNumber(r.leads)}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-fg">
                    {r.cpl_gbp != null ? formatGBP(r.cpl_gbp, { decimals: 2 }) : '—'}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-pink">{r.purchases > 0 ? formatNumber(r.purchases) : '—'}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-fg">{formatNumber(r.bookings)}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-sm tabular-nums text-fg">
                    {r.revenue_gbp != null ? formatGBP(r.revenue_gbp, { decimals: 0 }) : '—'}
                  </td>
                  <td className={cn('px-5 py-3.5 text-right font-mono text-sm font-semibold tabular-nums', colorForRoas(r.roas))}>
                    {r.roas != null ? `${r.roas.toFixed(2)}x` : '—'}
                  </td>
                  <td className={cn('px-5 py-3.5 text-right font-mono text-sm tabular-nums', colorForConv(r.conv_rate_pct))}>
                    {formatPercent(r.conv_rate_pct)}
                  </td>
                  <td className={cn('px-5 py-3.5 text-right font-mono text-sm tabular-nums', colorForCac(r.cac_gbp))}>
                    {r.cac_gbp != null ? formatGBP(r.cac_gbp, { decimals: 2 }) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
