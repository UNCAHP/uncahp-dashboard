import { AdRow } from '@/lib/queries';
import { formatGBP, formatNumber } from '@/lib/utils';

type Props = {
  rows: AdRow[];
};

export function AdTable({ rows }: Props) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-base font-medium text-fg">Per-Ad Attribution</h2>
        <p className="mt-1 text-xs text-fg-muted">
          Leads traced to the Meta ad via UTM (matched by ad ID). Coverage grows as each client&apos;s
          landing pages move onto the UTM-tagged funnels — ads with no traced leads fall back to Meta&apos;s pixel count.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-6 py-3 text-xs font-medium uppercase tracking-widest text-fg-muted">Client</th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-widest text-fg-muted">Ad</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Spend</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Leads</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">CPL</th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">Bookings</th>
              <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-widest text-fg-muted">CAC</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-fg-dim">
                  No ads with spend in this date range for rollout-complete clients.
                </td>
              </tr>
            ) : (
              rows.slice(0, 50).map(r => (
                <tr key={r.ad_id} className="border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
                  <td className="px-6 py-3 text-sm text-fg-muted">{r.client_name}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {r.creative_image_url ? (
                        <span
                          className="block h-10 w-10 shrink-0 rounded border border-border bg-cover bg-center"
                          style={{ backgroundImage: `url(${r.creative_image_url})` }}
                          aria-hidden
                        />
                      ) : (
                        <span className="block h-10 w-10 shrink-0 rounded border border-border bg-surface-2" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-fg">{r.ad_name ?? r.ad_id}</div>
                        {r.campaign_name ? (
                          <div className="truncate text-xs text-fg-dim">{r.campaign_name}</div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-fg">{formatGBP(r.spend_gbp, { decimals: 2 })}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-fg">{formatNumber(r.leads)}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-fg">{r.cpl_gbp != null ? formatGBP(r.cpl_gbp, { decimals: 2 }) : '—'}</td>
                  <td className="px-4 py-3 text-right font-mono text-sm tabular-nums text-fg">{formatNumber(r.bookings)}</td>
                  <td className="px-6 py-3 text-right font-mono text-sm tabular-nums text-fg">{r.cac_gbp != null ? formatGBP(r.cac_gbp, { decimals: 2 }) : '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
