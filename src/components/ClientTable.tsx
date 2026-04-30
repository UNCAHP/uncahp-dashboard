import { ClientRow } from '@/lib/queries';
import { formatGBP, formatNumber, formatPercent, cn } from '@/lib/utils';

type Props = {
  rows: ClientRow[];
};

function valueClass(value: number | null, kind: 'conv' | 'cac') {
  if (value == null) return 'text-fg-dim';
  if (kind === 'conv') {
    if (value >= 10) return 'text-green';
    if (value >= 5) return 'text-yellow';
    return 'text-red';
  }
  // CAC: lower is better. Thresholds are heuristic for v1.
  if (value <= 150) return 'text-green';
  if (value <= 300) return 'text-yellow';
  return 'text-red';
}

export function ClientTable({ rows }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-base font-medium text-fg">All Clients</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-widest text-fg-muted">Client</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Spend</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">LP Views</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted" title="Leads via landing page form (Meta pixel offsite_conversion.fb_pixel_lead)">LP Leads</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted" title="Leads via Meta Instant Form (no LP visit)">LF Leads</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted" title="All leads in GHL (LP + LF + manual + imports)">All Leads</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">CPL</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Checkouts</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Purchases</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Bookings</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Conv Rate</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">CAC</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-6 py-12 text-center text-fg-dim">
                  No data for this date range.
                </td>
              </tr>
            ) : (
              rows.map(r => (
                <tr key={r.client_id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
                  <td className="px-6 py-4 text-sm font-medium text-fg">{r.client_name || r.client_id}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{formatGBP(r.spend_gbp, { decimals: 2 })}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{r.lp_views > 0 ? formatNumber(r.lp_views) : '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{r.lp_leads > 0 ? formatNumber(r.lp_leads) : '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{r.lf_leads > 0 ? formatNumber(r.lf_leads) : '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{formatNumber(r.leads)}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{r.cpl_gbp != null ? formatGBP(r.cpl_gbp, { decimals: 2 }) : '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{r.checkouts > 0 ? formatNumber(r.checkouts) : '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{r.purchases > 0 ? formatNumber(r.purchases) : '—'}</td>
                  <td className="px-4 py-4 text-right font-mono text-sm tabular-nums text-fg">{formatNumber(r.bookings)}</td>
                  <td className={cn('px-4 py-4 text-right font-mono text-sm tabular-nums', valueClass(r.conv_rate_pct, 'conv'))}>
                    {formatPercent(r.conv_rate_pct)}
                  </td>
                  <td className={cn('px-6 py-4 text-right font-mono text-sm tabular-nums', valueClass(r.cac_gbp, 'cac'))}>
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
