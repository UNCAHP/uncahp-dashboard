import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { syncSheetIfStale } from '@/lib/sheetBookingsSync';
import { requireUser, canView, firstAllowedView, type CurrentUser } from '@/lib/auth';
import { AdminPanel } from '@/components/AdminPanel';
import { getAdminUsers, getRoles } from '@/lib/userAdmin';
import {
  PoundSterling, Users, TrendingDown, UserCheck, DollarSign, Sparkles,
  Percent, Eye, ShoppingCart,
} from 'lucide-react';
import { Sidebar } from '@/components/Sidebar';
import { Fragment, Suspense } from 'react';
import { NavMain } from '@/components/NavProgress';
import { ContentLoader } from '@/components/ContentLoader';
import { Topbar } from '@/components/Topbar';
import { KpiCardV2 } from '@/components/KpiCardV2';
import { GaugeCard } from '@/components/GaugeCard';
import { FunnelStrip, type FunnelStripData } from '@/components/FunnelStrip';
import { ClientTableV2 } from '@/components/ClientTableV2';
import { CampaignExplorer } from '@/components/CampaignExplorer';
import { FunnelAnalyticsView } from '@/components/FunnelAnalyticsView';
import { CsrDashboardView, type CallOverviewRow, type CallDetail, type CsrKey, type CsrPart } from '@/components/CsrDashboardView';
import type { SetterCard, LeadEval } from '@/lib/csrMetrics';
import { getBookingsBoard, type BookingsBoard } from '@/lib/csrBookings';
import { BookingsView } from '@/components/BookingsView';
import { AllBookingsView } from '@/components/AllBookingsView';
import { KpisView } from '@/components/KpisView';
import { getSplitTests, type SplitTest } from '@/lib/splitTests';
import { getBookings, getBookingMonths, getMonthCost, getAllBookings, getAllBookingMonths, type Booking, type BookingMonthCost } from '@/lib/bookingsAdmin';
import { getCsrScorecard, getKpiMonths, getCsrDaily, getSheetSyncAgeHours, getCsrSpeedToLead, type CsrKpiRow, type CsrDayRow, type CsrSpeedRow } from '@/lib/kpis';
import { ClientsView } from '@/components/ClientsView';
import {
  defaultRange, getPortfolio, getCampaignExplorer, getClientList, getFunnelMetrics,
  type ClientRow, type Totals, type CampaignNode, type ClientOption,
} from '@/lib/queries';
import { getAdminClients } from '@/lib/clientAdmin';
import { getAdminFunnels } from '@/lib/funnelAdmin';
import { getClientSpeed, getClientSpeedRows, getSetterScorecard, evaluateLeads } from '@/lib/csrMetrics';
import { setterClients, CSR_SETTERS, CSR_MANAGES, TEAM_SPEED_EXCLUDES } from '@/lib/csrConstants';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { formatGBP, formatNumber, formatPercent } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type View = 'overview' | 'client' | 'funnel' | 'calls' | 'bookings' | 'kpis' | 'clients' | 'admin';
type SearchParams = { days?: string; since?: string; until?: string; client?: string; view?: string; funnel?: string; fstatus?: string; month?: string; csr?: string; part?: string };

function parseView(v: string | undefined): View {
  const allowed: View[] = ['overview', 'client', 'funnel', 'calls', 'bookings', 'kpis', 'clients', 'admin'];
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

// Range: explicit since/until wins; otherwise fall back to days (default 30).
function paramsRange(params: SearchParams) {
  if (isISODate(params.since) && isISODate(params.until)) {
    return { since: params.since, until: params.until, label: rangeLabel(params.since, params.until) };
  }
  return defaultRange(Math.max(1, Math.min(365, Number(params.days) || 30)));
}

// Shell: the sidebar renders immediately and stays put across navigations. The main data
// area sits in one Suspense boundary that is deliberately NOT keyed: the first load shows
// the skeleton, and after that a date/view/client/funnel change keeps the current view on
// screen (dimmed, under the progress bar — see NavProgress) until the next one is ready.
// MainContent keys its own output on the params, so each view still mounts fresh.
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await requireUser();
  const range = paramsRange(params);
  const view = parseView(params.view);

  // Page access. A page the user's role doesn't list sends them to the first one it does
  // (a CSR lands on the CSR Dashboard). The view's own data is never loaded for them.
  const reroute = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    redirect(`/?${p.toString()}`);
  };
  // Bookings is archived and has no role page of its own: admins only.
  if (!canView(user, view === 'bookings' ? 'admin' : view)) {
    const first = firstAllowedView(user);
    if (!first) redirect('/login?error=no-profile');
    reroute({ view: first === 'overview' ? undefined : first, since: params.since, until: params.until });
  }
  // CSR scope: a CSR sees the CSR Team view and their own dashboard, plus those of any
  // setters they manage (CSR_MANAGES), not other setters'. Their CSR Dashboard home shows
  // just those cards. Account detail stays open (accounts are on the Team view).
  const scope = csrScope(user);
  if (view === 'calls' && scope !== undefined) {
    const allowed = !params.csr || params.csr === 'team' || scope.includes(params.csr);
    if (!allowed && !params.client) reroute({ view: 'calls', csr: scope[0] ?? 'team', part: params.csr ? undefined : params.part, since: params.since, until: params.until });
  }

  const scopedClient = view === 'client' ? (params.client?.trim() || undefined) : undefined;
  const clients = await getClientList();
  return (
    <div className="flex min-h-screen bg-bg text-fg">
      <Sidebar view={view} selectedClient={scopedClient} since={range.since} until={range.until} clients={clients}
        pages={user.pages} userName={user.name || user.email} userRole={user.roleLabel} />
      <NavMain className="min-w-0 flex-1">
        <Suspense fallback={<ContentLoader />}>
          <MainContent params={params} clients={clients} user={user} />
        </Suspense>
      </NavMain>
    </div>
  );
}

// undefined = no restriction (admins and non-CSR roles). Otherwise the setter dashboards a
// CSR may see besides the team view: their own first, then any setters they manage. Empty
// for a CSR whose user isn't linked to a setter yet.
function csrScope(user: CurrentUser): string[] | undefined {
  if (user.isAdmin) return undefined;
  if (user.role !== 'csr' && !user.csrKey) return undefined;
  if (!user.csrKey) return [];
  return [user.csrKey, ...(CSR_MANAGES[user.csrKey] ?? []).filter(k => k !== user.csrKey)];
}

async function MainContent({ params, clients, user }: { params: SearchParams; clients: ClientOption[]; user: CurrentUser }) {
  const range = paramsRange(params);
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
  const callsClient = view === 'calls' ? clientFilter : undefined;

  const [{ rows, totals, freshness }, campaigns, adminClients, adminFunnels, splitTests] = await Promise.all([
    getPortfolio(range, scopedClient),
    view === 'client' && scopedClient
      ? getCampaignExplorer(scopedClient, range)
      : Promise.resolve([] as CampaignNode[]),
    view === 'clients' ? getAdminClients() : Promise.resolve([]),
    view === 'funnel' ? getAdminFunnels() : Promise.resolve([]),
    view === 'funnel' ? getSplitTests(range) : Promise.resolve([] as SplitTest[]),
  ]);

  // Split tests live inside Funnel Analytics — the snippet needs this dashboard's own
  // origin (where the tracking script is served from). Prefer an explicit TRACKING_ORIGIN
  // (set in prod) so the pasted snippet always points at the public domain, even when the
  // dashboard is viewed on localhost; otherwise fall back to the current request host.
  let splitBaseUrl = '';
  if (view === 'funnel') {
    const envOrigin = process.env.TRACKING_ORIGIN?.replace(/\/+$/, '');
    if (envOrigin) {
      splitBaseUrl = envOrigin;
    } else {
      const h = await headers();
      const host = h.get('host');
      const proto = h.get('x-forwarded-proto') ?? 'https';
      splitBaseUrl = host ? `${proto}://${host}` : '';
    }
  }

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

  // CSR Dashboard (the 'calls' view): the team and each setter, each with Bookings against
  // target and Speed to Lead, both opening a per-account breakdown. ?csr= picks whose
  // dashboard (team | setter key), ?part= the breakdown (bookings | stl), ?client= one
  // account's full Speed to Lead detail. Only B2C clients with an assigned, tracked setter
  // are measured for Speed to Lead; bookings cover every B2C client.
  const csrKeys = ['team', ...CSR_SETTERS.map(s => s.key)];
  const csrSel: CsrKey | null = csrKeys.includes(params.csr ?? '') ? params.csr! : null;
  const csrPart: CsrPart | null = csrSel && (params.part === 'bookings' || params.part === 'stl') ? params.part : null;
  let callsOverview: CallOverviewRow[] = [];
  let callsDetail: CallDetail | null = null;
  let callsSetters: SetterCard[] = [];
  let callsLeads: LeadEval[] = [];
  let csrBookings: BookingsBoard | null = null;
  if (view === 'calls') {
    const measured = setterClients(clients).map(c => ({ client_id: c.client_id, csr: c.csr_key ?? null }));
    const detailClient = callsClient ? clients.find(c => c.client_id === callsClient) : undefined;
    if (detailClient) {
      callsDetail = { client: detailClient, speed: await getClientSpeed(detailClient.client_id, range) };
    } else {
      // One evaluation of every lead feeds the team rows, the setter cards and the lead lists.
      const needsSpeed = csrPart !== 'bookings';
      const leads = needsSpeed ? await evaluateLeads(measured, range) : [];
      // The Team view leaves out the leads of setters excluded from the team rate, and their
      // accounts unless a colleague answered leads there while covering.
      const teamLeads = leads.filter(l => !TEAM_SPEED_EXCLUDES.includes(l.responsible));
      const [allRows, setters, board] = await Promise.all([
        needsSpeed ? getClientSpeedRows(measured, range, teamLeads) : Promise.resolve([]),
        needsSpeed ? getSetterScorecard(measured, range, leads) : Promise.resolve([]),
        csrPart !== 'stl' ? getBookingsBoard(clients, range.since, range.until) : Promise.resolve(null),
      ]);
      const byId = new Map(clients.map(c => [c.client_id, c]));
      const rows = allRows.filter(r => !(r.csr && TEAM_SPEED_EXCLUDES.includes(r.csr) && r.leads + r.selfBooked === 0));
      callsOverview = rows.map(r => ({ client: byId.get(r.client_id)!, row: r })).filter(r => !!r.client);
      callsSetters = setters;
      csrBookings = board;
      // Setters log bookings all day; refresh the sheet in the background once the data is
      // over 15 minutes old. This load shows what's stored; the next one shows the update.
      if (board?.available) {
        const age = board.syncAgeHours;
        after(async () => { await syncSheetIfStale(age); });
      }
      // Only the breakdown lists individual leads; send just the ones it can show.
      if (csrPart === 'stl') callsLeads = csrSel === 'team' ? teamLeads : leads.filter(l => l.responsible === csrSel);
    }
  }

  // Bookings — one page. Default = all-clients overview; pick a client to log for it.
  const bookingSel = view === 'bookings' ? params.client?.trim() : undefined;
  const bookingsAllMode = !bookingSel || bookingSel === 'all';
  const bookingsClient = bookingsAllMode ? 'all' : bookingSel!;
  let bookings: Booking[] = [];
  let allBookings: Booking[] = [];
  let bookingMonths: string[] = [];
  let bookingMonthCost: BookingMonthCost | null = null;
  let bookingsMonth: string | null = null;
  if (view === 'bookings') {
    if (bookingsAllMode) {
      bookingMonths = await getAllBookingMonths();
      bookingsMonth = params.month === 'all' ? null : (params.month ?? bookingMonths[0] ?? null);
      allBookings = await getAllBookings(bookingsMonth);
    } else {
      bookingMonths = await getBookingMonths(bookingsClient);
      bookingsMonth = params.month === 'all' ? null : (params.month ?? bookingMonths[0] ?? null);
      [bookings, bookingMonthCost] = await Promise.all([
        getBookings(bookingsClient, bookingsMonth),
        bookingsMonth ? getMonthCost(bookingsClient, bookingsMonth) : Promise.resolve(null),
      ]);
    }
  }
  const bookingsClientName = bookingsAllMode ? 'All clients' : (clients.find(c => c.client_id === bookingsClient)?.client_name ?? 'Client');

  // KPIs (consolidated, per-person, cross-client). Month-scoped.
  let kpiRows: CsrKpiRow[] = [];
  let kpiMonths: string[] = [];
  let kpiMonth: string | null = null;
  let kpiDaily: Record<string, CsrDayRow[]> = {};
  let kpiSyncAgeHours: number | null = null;
  let kpiSpeed: CsrSpeedRow[] = [];
  if (view === 'kpis') {
    kpiMonths = await getKpiMonths();
    kpiMonth = params.month && params.month !== 'all' ? params.month : (kpiMonths[0] ?? null);
    [kpiRows, kpiDaily, kpiSyncAgeHours, kpiSpeed] = await Promise.all([getCsrScorecard(kpiMonth), getCsrDaily(kpiMonth), getSheetSyncAgeHours(), getCsrSpeedToLead(kpiMonth)]);
  }

  // Admin Panel: the people with access and what each role can open.
  const adminData = view === 'admin' ? { users: await getAdminUsers(), roles: await getRoles() } : null;

  const activeClient = scopedClient ? clients.find(c => c.client_id === scopedClient) : null;
  const callsClientName = callsClient ? clients.find(c => c.client_id === callsClient)?.client_name : null;

  const titles: Record<View, { title: string; subtitle: string | null }> = {
    overview: { title: 'Portfolio Overview', subtitle: `${rows.length} clients · ${range.label.toLowerCase()}` },
    client: { title: 'Client View', subtitle: activeClient?.client_name ?? 'No client selected' },
    funnel: { title: 'Funnel Analytics', subtitle: 'Aggregate funnel performance' },
    calls: { title: 'CSR Dashboard', subtitle: callsClientName ?? (csrSel ? (csrSel === 'team' ? 'CSR Team' : CSR_SETTERS.find(s => s.key === csrSel)?.label ?? null) : 'Bookings and Speed to Lead') },
    bookings: { title: 'Bookings', subtitle: bookingsClientName },
    kpis: { title: 'KPIs', subtitle: 'Team performance by role' },
    clients: { title: 'Clients', subtitle: 'Manage client accounts and team access' },
    admin: { title: 'Admin Panel', subtitle: 'Team, integrations and workspace settings' },
  };

  return (
    <Fragment key={JSON.stringify(params)}>
      <Topbar
        title={titles[view].title}
        subtitle={titles[view].subtitle}
        freshness={freshness}
        since={range.since}
        until={range.until}
        view={view}
        client={view === 'funnel' ? funnelClientId : view === 'calls' ? callsClient : scopedClient}
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
            splitTests={splitTests}
            baseUrl={splitBaseUrl}
            funnelStatus={funnelStatus}
            selectedFunnelId={selectedFunnel?.id ?? null}
            since={range.since}
            until={range.until}
          />
        )}
        {view === 'calls' && (
          <CsrDashboardView
            visible={(() => { const scope = csrScope(user); return scope ? ['team', ...scope] : null; })()}
            csr={csrSel}
            part={csrPart}
            overview={callsOverview}
            detail={callsDetail}
            setters={callsSetters}
            leads={callsLeads}
            bookings={csrBookings ?? EMPTY_BOARD(range.until)}
            clients={clients}
            since={range.since}
            until={range.until}
          />
        )}
        {view === 'bookings' && (
          bookingsAllMode ? (
            <AllBookingsView
              bookings={allBookings}
              months={bookingMonths}
              clients={clients}
              clientId="all"
              month={bookingsMonth}
            />
          ) : (
            <BookingsView
              bookings={bookings}
              months={bookingMonths}
              monthCost={bookingMonthCost}
              clients={clients}
              clientId={bookingsClient}
              month={bookingsMonth}
            />
          )
        )}
        {view === 'kpis' && <KpisView rows={kpiRows} months={kpiMonths} month={kpiMonth} daily={kpiDaily} syncAgeHours={kpiSyncAgeHours} speed={kpiSpeed} />}
        {view === 'clients' && <ClientsView clients={adminClients} />}
        {view === 'admin' && adminData && <AdminPanel users={adminData.users} roles={adminData.roles} currentUserId={user.id} />}
    </Fragment>
  );
}

// Stand-in for the bookings board on screens that don't show bookings.
const EMPTY_BOARD = (until: string): BookingsBoard => ({
  available: true, since: until, until, weekSince: until, daysIntoWeek: 1, accounts: [], setters: {}, unmatched: [], syncAgeHours: null,
});

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
