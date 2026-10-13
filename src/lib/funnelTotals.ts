import type { FunnelMetrics } from '@/lib/queries';
import type { SplitTest } from '@/lib/splitTests';

// Which numbers are a funnel's headline stage counts. Shared by the Funnel Analytics page
// and /api/funnel-analytics so the API always reports exactly what the dashboard shows.

// First-party totals to show as the funnel's own stage numbers, or null when Meta and GHL
// should stay the source. First-party takes over in two cases:
//   • a split test — Meta can't tell the versions' visitors apart, so the combined
//     first-party counts are the only figures that agree with the test panel;
//   • a tracked funnel with no Meta campaigns mapped (organic traffic) — there is no Meta
//     figure at all, so first-party is the only measurement it has.
// While a test is running the totals are every version combined. Once a winner is declared
// that version IS the funnel, so its numbers alone become the headline (`winner`).
export function splitTotals(test: SplitTest | null | undefined, metaCampaigns: number) {
  if (!test || test.totalViews === 0) return null;
  if (test.mode !== 'test' && metaCampaigns > 0) return null;
  const won = test.mode === 'test' && test.status === 'decided' ? test.variants.find(v => v.key === test.winnerKey) : undefined;
  if (won) {
    const r = test.ranged ? (test.ranged.byVariant[won.key] ?? { views: 0, optins: 0, deposits: 0 }) : { views: won.views, optins: won.optins, deposits: won.deposits };
    return { ...r, versions: test.variants.length, winner: (won.label || won.key) as string | null };
  }
  // Within the dashboard's date range when the loader supplied one; the test's whole
  // history otherwise.
  const r = test.ranged ?? {
    views: test.totalViews,
    optins: test.variants.reduce((s, v) => s + v.optins, 0),
    deposits: test.variants.reduce((s, v) => s + v.deposits, 0),
  };
  return { views: r.views, optins: r.optins, deposits: r.deposits, versions: test.variants.length, winner: null as string | null };
}

export function applySplitTotals(m: FunnelMetrics, test?: SplitTest): FunnelMetrics {
  const t = splitTotals(test, m.meta_campaign_count);
  if (!t) return m;
  const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);
  return {
    ...m,
    lp_views: t.views,
    optins: t.optins,
    deposits: t.deposits,
    deposits_direct: t.deposits,
    deposits_setter: 0,
    setter_sources: [],
    optin_rate_pct: rate(t.optins, t.views),
    deposit_rate_pct: rate(t.deposits, t.optins),
    deposit_rate_direct_pct: rate(t.deposits, t.optins),
  };
}
