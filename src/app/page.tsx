import { PoundSterling, Users, CalendarCheck, TrendingUp, Target, Banknote } from 'lucide-react';
import { KpiTile } from '@/components/KpiTile';
import { ClientTable } from '@/components/ClientTable';
import { AdTable } from '@/components/AdTable';
import { RangePicker } from '@/components/RangePicker';
import { FreshnessBadge } from '@/components/FreshnessBadge';
import { FunnelSection } from '@/components/FunnelSection';
import { ClientFilter } from '@/components/ClientFilter';
import { defaultRange, getPortfolio, getAdAttribution, getClientList, ROLLOUT_COMPLETE_CLIENT_IDS } from '@/lib/queries';
import { formatGBP, formatNumber, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type SearchParams = { days?: string; client?: string };

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const days = Math.max(1, Math.min(365, Number(params.days) || 30));
  const range = defaultRange(days);
  const clientFilter = params.client?.trim() || undefined;

  // Per-ad attribution still scoped to UTM-rollout-complete clients,
  // unless the user has filtered to a specific client.
  const adClientIds = clientFilter
    ? (ROLLOUT_COMPLETE_CLIENT_IDS.includes(clientFilter) ? [clientFilter] : [])
    : ROLLOUT_COMPLETE_CLIENT_IDS;

  const [{ rows, totals, freshness }, adRows, clients] = await Promise.all([
    getPortfolio(range, clientFilter),
    getAdAttribution(range, adClientIds),
    getClientList(),
  ]);

  const activeClient = clientFilter ? clients.find((c) => c.client_id === clientFilter) : null;

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-10">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-pink">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-pink" />
            UNCAHP · LP Funnel
          </div>
          <h1 className="mt-2 text-3xl font-semibold text-fg">
            {activeClient ? activeClient.client_name : 'Portfolio Overview'}
          </h1>
          <p className="mt-1 text-sm text-fg-muted">
            {activeClient ? '1 client' : `${rows.length} clients`} · {range.label.toLowerCase()} ({range.since} → {range.until})
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <FreshnessBadge freshness={freshness} />
          <ClientFilter clients={clients} activeClientId={clientFilter} />
          <RangePicker activeDays={days} clientFilter={clientFilter} />
        </div>
      </header>

      <section className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label="Total Spend"
          value={formatGBP(totals.spend_gbp, { decimals: 0 })}
          icon={<PoundSterling size={16} />}
        />
        <KpiTile
          label="Total Leads"
          value={formatNumber(totals.leads)}
          icon={<Users size={16} />}
        />
        <KpiTile
          label="Cost Per Lead"
          value={totals.cpl_gbp != null ? formatGBP(totals.cpl_gbp, { decimals: 2 }) : '—'}
          icon={<TrendingUp size={16} />}
        />
        <KpiTile
          label="Bookings"
          value={formatNumber(totals.bookings)}
          icon={<CalendarCheck size={16} />}
          hint="GHL opportunities with status='won'"
        />
        <KpiTile
          label="Conversion Rate"
          value={formatPercent(totals.conv_rate_pct, 1)}
          icon={<Target size={16} />}
        />
        <KpiTile
          label="CAC (Cost Per Booking)"
          value={totals.cac_gbp != null ? formatGBP(totals.cac_gbp, { decimals: 2 }) : '—'}
          icon={<Banknote size={16} />}
        />
      </section>

      <FunnelSection totals={totals} />

      <section className="mb-10">
        <ClientTable rows={rows} />
      </section>

      <section>
        <AdTable rows={adRows} />
      </section>

      <footer className="mt-12 border-t border-border pt-6 text-xs text-fg-dim">
        <p>
          Data from Supabase · Meta Ads (spend, pixel leads) + GHL (lead capture, opportunity status). Bookings = GHL
          opportunities marked <span className="font-mono">won</span>; per-client booking signal config will refine this once configured.
          Per-ad attribution requires UTM rollout — currently complete for Maldon, Skin Heal.
        </p>
      </footer>
    </main>
  );
}
