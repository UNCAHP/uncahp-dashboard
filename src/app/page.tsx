import { Suspense } from 'react';
import {
  PoundSterling, Users, TrendingDown, UserCheck, DollarSign, Sparkles,
  Percent, Eye, ShoppingCart,
} from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { DashboardSkeleton } from '@/components/DashboardSkeleton';
import { Topbar } from '@/components/Topbar';
import { KpiCardV2 } from '@/components/KpiCardV2';
import { GaugeCard } from '@/components/GaugeCard';
import { FunnelStrip, type FunnelStripData } from '@/components/FunnelStrip';
import { ClientTableV2 } from '@/components/ClientTableV2';
import { CampaignExplorer } from '@/components/CampaignExplorer';
import { PlaceholderView } from '@/components/PlaceholderView';
import { FunnelAnalyticsView } from '@/components/FunnelAnalyticsView';
import { ClientsView } from '@/components/ClientsView';
import {
  defaultRange, getPortfolio, getCampaignExplorer, getClientList, getFunnelMetrics,
  type ClientRow, type Totals, type CampaignNode,
} from '@/lib/queries';
import { getAdminClients } from '@/lib/clientAdmin';
import { getAdminFunnels } from '@/lib/funnelAdmin';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { formatGBP, formatNumber, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type View = 'overview' | 'client' | 'funnel' | 'calls' | 'clients' | 'admin';
type SearchParams = { days?: string; since?: string; until?: string; client?: string; view?: string; funnel?: string; fstatus?: string };

function parseView(v: string | undefined): View {
  const allowed: View[] = ['overview', 'client', 'funnel', 'calls', 'clients', 'admin'];
  return (allowed as string[]).includes(v ?? '') ? (v as View) : 'overview';
}

const isISODate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function rangeLabel(since: string, until: string): string {
  const fmt = (s: string) => {
    const [, m, d] = s.split('-');
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1];
    return `${Number(d)} ${mon}`;
  };
  return `${fmt(since)} – ${fmt(until)}`;
}

// Thin wrapper: a keyed Suspense boundary so the skeleton shows on the first load AND
// on every navigation (date/view/client/funnel change re-keys → re-suspends → skeleton).
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  return (
    <Suspense key={JSON.stringify(params)} fallback={<DashboardSkeleton />}>
      <Dashboard params={params} />
    </Suspense>
  );
}

async function Dashboard({ params }: { params: SearchParams }) {
  // Range: explicit since/until wins; otherwise fall back to days (default 30).
  let range;
  if (isISODate(params.since) && isISODate(params.until)) {
    range = { since: params.since, until: params.until, label: rangeLabel(params.since, params.until) };
  } else {
    range = defaultRange(Math.max(1, Math.min(365, Number(params.days) || 30)));
  }
  const clientFilter = params.client?.trim() || undefined;
  const funnelFilter = params.funnel?.trim() || undefined;
  const view = parseView(params.view);
  const rangeDays = Math.max(
    1,
    Math.round((Date.parse(range.until) - Date.parse(range.since)) / 86_400_000) + 1,
  );

  // For Overview views we want portfolio totals (no client filter).
  // For Client view, scope to that client. Funnel view uses its own client selector.
  const scopedClient = view === 'client' ? clientFilter : undefined;
  const funnelClientId = view === 'funnel' ? clientFilter : undefined;

  const [{ rows, totals, freshness }, campaigns, clients, adminClients, adminFunnels] = await Promise.all([
    getPortfolio(range, scopedClient),
    view === 'client' && scopedClient
      ? getCampaignExplorer(scopedClient, range)
      : Promise.resolve([] as CampaignNode[]),
    getClientList(),
    view === 'clients' ? getAdminClients() : Promise.resolve([]),
    view === 'funnel' ? getAdminFunnels() : Promise.resolve([]),
  ]);

  // Funnel Analytics. Default view = overview of all active funnels (grouped by
  // client, or scoped to the selected client). Drilling into a specific funnel
  // (?funnel=) shows its detailed LP Views → Opt-ins → Deposits breakdown.
  const funnelStatus = params.fstatus === 'archived' ? 'archived' : 'active';
  const statusFunnels = adminFunnels.filter(f => f.status === funnelStatus);
  const clientFunnels = funnelClientId ? statusFunnels.filter(f => f.client_id === funnelClientId) : [];
  const selectedFunnel = funnelFilter ? adminFunnels.find(f => f.id === funnelFilter) ?? null : null;
  const funnelsToShow = view === 'funnel'
    ? (selectedFunnel ? [selectedFunnel] : (funnelClientId ? clientFunnels : statusFunnels))
    : [];
  const funnelMetricsList = await Promise.all(funnelsToShow.map(f => getFunnelMetrics(f, range)));

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
      <Sidebar view={view} selectedClient={scopedClient} since={range.since} until={range.until} clients={clients} />
      <main className="min-w-0 flex-1">
        <Topbar
          title={titles[view].title}
          subtitle={titles[view].subtitle}
          freshness={freshness}
          since={range.since}
          until={range.until}
          view={view}
          client={view === 'funnel' ? funnelClientId : scopedClient}
          funnel={funnelFilter}
        />
        {view === 'overview' && <OverviewView rows={rows} totals={totals} rangeDays={rangeDays} since={range.since} until={range.until} />}
        {view === 'client' && (
          activeClient ? (
            <ClientDetailView
              client={activeClient}
              totals={totals}
              rangeDays={rangeDays}
              campaigns={campaigns}
            />
          ) : (
            <NoClientSelected />
          )
        )}
        {view === 'funnel' && (
          <FunnelAnalyticsView
            clients={clients}
            adminFunnels={adminFunnels}
            metricsList={funnelMetricsList}
            funnelStatus={funnelStatus}
            selectedFunnelId={selectedFunnel?.id ?? null}
            since={range.since}
            until={range.until}
          />
        )}
        {view === 'calls' && <PlaceholderView title="Call Tracking" subtitle="Inbound call performance and recordings" />}
        {view === 'clients' && <ClientsView clients={adminClients} />}
        {view === 'admin' && <PlaceholderView title="Admin Panel" subtitle="Team, integrations and workspace settings" />}
      </main>
    </div>
  );
}

// Placeholder portfolio targets (monthly). Per-client targets + ad budgets will
// come from the client-config panel — for now these drive the gauge fills so the
// dials are visible. Volume targets scale with the selected range; ratio targets
// (CPL, ROAS) don't.
const MONTHLY_TARGETS = { spend: 35000, leads: 5000, cpl: 8, patients: 200, revenue: 90000, roas: 5 };

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

function HeroKpis({ totals, rangeDays }: { totals: Totals; rangeDays: number }) {
  const scale = rangeDays / 30;
  const fill = {
    spend: clamp01(totals.spend_gbp / (MONTHLY_TARGETS.spend * scale)),
    leads: clamp01(totals.leads / (MONTHLY_TARGETS.leads * scale)),
    // CPL: lower is better — fill = target / actual.
    cpl: clamp01(totals.cpl_gbp ? MONTHLY_TARGETS.cpl / totals.cpl_gbp : 0),
    patients: clamp01(totals.bookings / (MONTHLY_TARGETS.patients * scale)),
    revenue: clamp01((totals.revenue_gbp ?? 0) / (MONTHLY_TARGETS.revenue * scale)),
    roas: clamp01((totals.roas ?? 0) / MONTHLY_TARGETS.roas),
  };
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <GaugeCard label="Total Spend" value={formatGBP(totals.spend_gbp, { decimals: 0 })} fillPct={fill.spend} icon={PoundSterling} hero />
      <GaugeCard label="Total Leads" value={formatNumber(totals.leads)} fillPct={fill.leads} icon={Users} hero />
      <GaugeCard
        label="Cost Per Lead"
        value={totals.cpl_gbp != null ? formatGBP(totals.cpl_gbp, { decimals: 2 }) : '—'}
        fillPct={fill.cpl}
        icon={TrendingDown}
        hero
      />
      <GaugeCard label="Patients" value={formatNumber(totals.bookings)} fillPct={fill.patients} icon={UserCheck} hero hint="Patients booked — contacts tagged 'booked' in GHL" />
      <GaugeCard
        label="Revenue"
        value={totals.revenue_gbp != null ? formatGBP(totals.revenue_gbp, { decimals: 0 }) : '—'}
        fillPct={fill.revenue}
        icon={DollarSign}
        hero
        hint="Treatment revenue from the client's Profit Tracker"
      />
      <GaugeCard
        label="ROAS"
        value={totals.roas != null ? `${totals.roas.toFixed(2)}x` : '—'}
        fillPct={fill.roas}
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

function OverviewView({ rows, totals, rangeDays, since, until }: { rows: ClientRow[]; totals: Totals; rangeDays: number; since: string; until: string }) {
  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-fg">Portfolio Overview</h1>
        <p className="mt-1 text-sm text-fg-muted">{rows.length} active clients · Meta Ads × GHL</p>
      </div>
      <HeroKpis totals={totals} rangeDays={rangeDays} />
      <SecondaryKpis totals={totals} />
      <FunnelStrip data={buildFunnelStrip(totals)} detailHref={`/?view=funnel&since=${since}&until=${until}`} />
      <ClientTableV2 rows={rows} since={since} until={until} />
    </div>
  );
}

function ClientDetailView({
  client,
  totals,
  rangeDays,
  campaigns,
}: {
  client: { client_id: string; client_name: string; logo_url?: string | null };
  totals: Totals;
  rangeDays: number;
  campaigns: CampaignNode[];
}) {
  return (
    <div className="space-y-6 p-8">
      <div className="flex items-center gap-4">
        {client.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={client.logo_url} alt="" className="h-12 w-12 rounded-xl border border-border object-cover" />
        ) : (
          <div
            className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold text-fg-muted"
            style={{ background: clientColor(client.client_id) }}
          >
            {clientInitials(client.client_name)}
          </div>
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">{client.client_name}</h1>
          <p className="mt-1 text-sm text-fg-muted">Meta Ads × GHL · scoped to this client</p>
        </div>
      </div>
      <HeroKpis totals={totals} rangeDays={rangeDays} />
      <SecondaryKpis totals={totals} />
      <CampaignExplorer campaigns={campaigns} />
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
