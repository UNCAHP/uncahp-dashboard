import {
  PoundSterling, Users, TrendingDown, CreditCard, DollarSign, Sparkles,
  Percent, Eye, ShoppingCart,
} from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { KpiCardV2 } from '@/components/KpiCardV2';
import { FunnelStrip, type FunnelStripData } from '@/components/FunnelStrip';
import { ClientTableV2 } from '@/components/ClientTableV2';
import { FunnelBreakdown } from '@/components/FunnelBreakdown';
import { AdTable } from '@/components/AdTable';
import { PlaceholderView } from '@/components/PlaceholderView';
import { FunnelAnalyticsView } from '@/components/FunnelAnalyticsView';
import {
  defaultRange, getPortfolio, getAdAttribution, getClientList, getFunnelBreakdown, getFunnelList,
  type ClientRow, type Totals,
} from '@/lib/queries';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { formatGBP, formatNumber, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type View = 'overview' | 'client' | 'funnel' | 'calls' | 'clients' | 'admin';
type SearchParams = { days?: string; client?: string; view?: string; funnel?: string };

function parseView(v: string | undefined): View {
  const allowed: View[] = ['overview', 'client', 'funnel', 'calls', 'clients', 'admin'];
  return (allowed as string[]).includes(v ?? '') ? (v as View) : 'overview';
}

export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const days = Math.max(1, Math.min(365, Number(params.days) || 30));
  const range = defaultRange(days);
  const clientFilter = params.client?.trim() || undefined;
  const funnelFilter = params.funnel?.trim() || undefined;
  const view = parseView(params.view);

  // For Overview views we want portfolio totals (no client filter).
  // For Client view, scope to that client. Funnel view uses its own client selector.
  const scopedClient = view === 'client' ? clientFilter : undefined;
  const funnelClientId = view === 'funnel' ? clientFilter : undefined;

  // Ad attribution works for any client now (UTM matched by Meta ad ID value,
  // no per-client UTM-scheme rollout dependency).
  const adClientIds = scopedClient ? [scopedClient] : [];

  const [{ rows, totals, freshness }, adRows, clients, funnelBreakdown, funnelList, funnelAnalyticsBreakdown] = await Promise.all([
    getPortfolio(range, scopedClient),
    view === 'client' ? getAdAttribution(range, adClientIds) : Promise.resolve([]),
    getClientList(),
    view === 'client' && scopedClient
      ? getFunnelBreakdown(scopedClient, range)
      : Promise.resolve([]),
    view === 'funnel' ? getFunnelList() : Promise.resolve([]),
    view === 'funnel' && funnelClientId
      ? getFunnelBreakdown(funnelClientId, range)
      : Promise.resolve([]),
  ]);

  const selectedAnalyticsFunnel = funnelAnalyticsBreakdown.find(f => f.funnel_id === funnelFilter)
    ?? funnelAnalyticsBreakdown.find(f => !f.is_synthetic)
    ?? null;
  const funnelClientName = funnelClientId
    ? clients.find(c => c.client_id === funnelClientId)?.client_name ?? null
    : null;

  const activeClient = scopedClient ? clients.find(c => c.client_id === scopedClient) : null;

  const titles: Record<View, { title: string; subtitle: string | null }> = {
    overview: { title: 'Portfolio Overview', subtitle: `${rows.length} clients · ${range.label.toLowerCase()}` },
    client: { title: 'Client View', subtitle: activeClient?.client_name ?? 'No client selected' },
    funnel: { title: 'Funnel Analytics', subtitle: 'Aggregate funnel performance' },
    calls: { title: 'Call Tracking', subtitle: 'Inbound call performance and recordings' },
    clients: { title: 'Clients', subtitle: 'Manage client accounts and team access' },
    admin: { title: 'Admin Panel', subtitle: 'Team, integrations and workspace settings' },
  };

  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar view={view} selectedClient={scopedClient} days={days} clients={clients} />
      <main className="min-w-0 flex-1">
        <Topbar
          title={titles[view].title}
          subtitle={titles[view].subtitle}
          freshness={freshness}
          rangeLabel={`${range.since} → ${range.until}`}
          view={view}
          client={view === 'funnel' ? funnelClientId : scopedClient}
          funnel={funnelFilter}
          days={days}
        />
        {view === 'overview' && <OverviewView rows={rows} totals={totals} days={days} />}
        {view === 'client' && (
          activeClient ? (
            <ClientDetailView
              client={activeClient}
              rows={rows}
              totals={totals}
              funnelBreakdown={funnelBreakdown}
              adRows={adRows}
            />
          ) : (
            <NoClientSelected />
          )
        )}
        {view === 'funnel' && (
          <FunnelAnalyticsView
            funnelList={funnelList}
            funnel={selectedAnalyticsFunnel}
            funnelClientId={funnelClientId ?? null}
            funnelClientName={funnelClientName}
            selectedFunnelId={selectedAnalyticsFunnel?.funnel_id ?? null}
            days={days}
          />
        )}
        {view === 'calls' && <PlaceholderView title="Call Tracking" subtitle="Inbound call performance and recordings" />}
        {view === 'clients' && <PlaceholderView title="Clients" subtitle="Manage client accounts, contracts and team access" />}
        {view === 'admin' && <PlaceholderView title="Admin Panel" subtitle="Team, integrations and workspace settings" />}
      </main>
    </div>
  );
}

function HeroKpis({ totals }: { totals: Totals }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <KpiCardV2 label="Total Spend" value={formatGBP(totals.spend_gbp, { decimals: 0 })} icon={PoundSterling} hero />
      <KpiCardV2 label="Total Leads" value={formatNumber(totals.leads)} icon={Users} hero />
      <KpiCardV2
        label="Cost Per Lead"
        value={totals.cpl_gbp != null ? formatGBP(totals.cpl_gbp, { decimals: 2 }) : '—'}
        icon={TrendingDown}
        hero
      />
      <KpiCardV2 label="Deposits" value={formatNumber(totals.purchases)} icon={CreditCard} hero hint="Funnel-attributed deposits paid via GHL" />
      <KpiCardV2
        label="Revenue"
        value={totals.revenue_gbp != null ? formatGBP(totals.revenue_gbp, { decimals: 0 }) : '—'}
        icon={DollarSign}
        hero
        hint="Treatment revenue from the client's Profit Tracker"
      />
      <KpiCardV2
        label="ROAS"
        value={totals.roas != null ? `${totals.roas.toFixed(2)}x` : '—'}
        icon={Sparkles}
        hero
        hint="Revenue ÷ ad spend"
      />
    </div>
  );
}

function SecondaryKpis({ totals }: { totals: Totals }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCardV2 label="Conversion Rate" value={formatPercent(totals.conv_rate_pct, 1)} icon={Percent} />
      <KpiCardV2
        label="CAC (per Booking)"
        value={totals.cac_gbp != null ? formatGBP(totals.cac_gbp, { decimals: 2 }) : '—'}
        icon={Users}
      />
      <KpiCardV2 label="LP Views" value={formatNumber(totals.lp_views)} icon={Eye} />
      <KpiCardV2 label="Avg Order Value" value="—" icon={ShoppingCart} hint="Awaiting POS data" />
    </div>
  );
}

function buildFunnelStrip(totals: Totals): FunnelStripData {
  return {
    lp_views: totals.lp_views,
    leads: totals.leads,
    lp_leads: totals.lp_leads,
    lf_leads: totals.lf_leads,
    checkouts: totals.checkouts,
    deposits: totals.purchases,
    showed: null,
    treatment: null,
    revenue: totals.revenue_gbp,
  };
}

function OverviewView({ rows, totals, days }: { rows: ClientRow[]; totals: Totals; days: number }) {
  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Portfolio Overview</h1>
        <p className="mt-1 text-sm text-fg-muted">{rows.length} active clients · Meta Ads × GHL</p>
      </div>
      <HeroKpis totals={totals} />
      <SecondaryKpis totals={totals} />
      <FunnelStrip data={buildFunnelStrip(totals)} detailHref={`/?view=funnel&days=${days}`} />
      <ClientTableV2 rows={rows} days={days} />
    </div>
  );
}

function ClientDetailView({
  client,
  rows,
  totals,
  funnelBreakdown,
  adRows,
}: {
  client: { client_id: string; client_name: string };
  rows: ClientRow[];
  totals: Totals;
  funnelBreakdown: Awaited<ReturnType<typeof getFunnelBreakdown>>;
  adRows: Awaited<ReturnType<typeof getAdAttribution>>;
}) {
  // For client view, rows is already scoped to one client (or empty if no Meta data).
  const _row = rows[0];
  void _row;
  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center gap-4">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold text-fg-muted"
          style={{ background: clientColor(client.client_id) }}
        >
          {clientInitials(client.client_name)}
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">{client.client_name}</h1>
          <p className="mt-1 text-sm text-fg-muted">Meta Ads × GHL · scoped to this client</p>
        </div>
      </div>
      <HeroKpis totals={totals} />
      <SecondaryKpis totals={totals} />
      <FunnelStrip data={buildFunnelStrip(totals)} />
      <FunnelBreakdown funnels={funnelBreakdown} />
      {adRows.length > 0 && <AdTable rows={adRows} />}
    </div>
  );
}

function NoClientSelected() {
  return (
    <div className="p-8">
      <div className="rounded-xl border border-border bg-surface p-12 text-center">
        <div className="mb-3 text-sm text-fg-muted">Select a client from the sidebar to view their performance.</div>
      </div>
    </div>
  );
}
