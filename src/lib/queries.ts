import { supabase, supabaseAdmin } from './supabase';
import type { AdminFunnel, FunnelPageLink } from './funnelAdmin';

export type DateRange = {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
  label: string; // human-readable
};

export function defaultRange(days = 30): DateRange {
  const until = new Date();
  const since = new Date();
  since.setDate(since.getDate() - days);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return {
    since: fmt(since),
    until: fmt(until),
    label: `Last ${days} days`,
  };
}

export type ClientRow = {
  client_id: string;
  client_name: string;
  logo_url?: string | null;
  spend_gbp: number;
  lp_views: number;
  lp_leads: number;   // Meta offsite_conversion.fb_pixel_lead — LP form submits
  lf_leads: number;   // Meta onsite_conversion.lead_grouped — Instant Form (no LP)
  leads: number;      // GHL contacts (all sources)
  checkouts: number;
  purchases: number;
  bookings: number;
  cpl_gbp: number | null;
  conv_rate_pct: number | null;
  cac_gbp: number | null;
  // Revenue from the client's Profit Tracker (null = no tracker connected yet):
  revenue_gbp: number | null;
  roas: number | null;
  // LP funnel rates (use LP leads, not all leads):
  lead_optin_rate_pct: number | null;
  deposit_start_rate_pct: number | null;
  deposit_collection_rate_pct: number | null;
};

export type Totals = {
  spend_gbp: number;
  lp_views: number;
  lp_leads: number;
  lf_leads: number;
  leads: number;
  checkouts: number;
  purchases: number;
  bookings: number;
  cpl_gbp: number | null;
  conv_rate_pct: number | null;
  cac_gbp: number | null;
  revenue_gbp: number | null;
  roas: number | null;
  lead_optin_rate_pct: number | null;
  deposit_start_rate_pct: number | null;
  deposit_collection_rate_pct: number | null;
};

type MetaAction = { action_type?: string; value?: string };

// Supabase REST API caps responses at 1,000 rows by default. This helper paginates
// any query builder via .range() until we get a partial page (signalling end of data).
// All time-bucketed queries against meta_daily_stats / ghl_contacts / ghl_opportunities
// MUST go through this — we have 6,000+ rows in 30 days for Meta alone.
async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  let from = 0;
  // Hard cap to prevent runaway loops if a query goes wrong.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// GHL contact custom fields arrive as {id, value} with no field name, and most
// location tokens lack the scope to read field definitions. So we identify the
// ad-attribution field by VALUE: a Meta ad ID is an 18-digit number unique to
// meta_ads. Any custom field whose value matches a known ad id IS the utm_content.
function matchAdId(metadata: unknown, adIds: Set<string>): string | null {
  const cf = (metadata as { customFields?: Array<{ value?: unknown }> } | null)?.customFields;
  if (!Array.isArray(cf)) return null;
  for (const f of cf) {
    const v = f?.value;
    if (typeof v === 'string' && adIds.has(v)) return v;
  }
  return null;
}

function extractAction(actions: unknown, type: string): number {
  if (!actions) return 0;
  let arr: MetaAction[] | null = null;
  if (typeof actions === 'string') {
    try { arr = JSON.parse(actions); } catch { return 0; }
  } else if (Array.isArray(actions)) {
    arr = actions as MetaAction[];
  }
  if (!arr) return 0;
  const found = arr.find((a) => a?.action_type === type);
  return found?.value ? Number(found.value) || 0 : 0;
}

export type FreshnessReport = {
  meta_synced_at: string | null;
  ghl_synced_at: string | null;
  hours_since_meta: number | null;
  hours_since_ghl: number | null;
  is_stale: boolean;
};

export async function getPortfolio(
  range: DateRange,
  clientFilter?: string,
): Promise<{ rows: ClientRow[]; totals: Totals; freshness: FreshnessReport }> {
  type MetaRow = { client_id: string; client_name: string | null; spend_cents: number | null; leads: number | null; purchases: number | null; actions: unknown };
  type ContactRow = { location_id: string; tags: unknown };

  const buildMetaQ = () => {
    let q = supabase
      .from('meta_daily_stats')
      .select('client_id, client_name, spend_cents, leads, purchases, actions')
      .gte('date', range.since)
      .lte('date', range.until)
      .neq('client_id', 'UNCAHP_AGENCY');
    if (clientFilter) q = q.eq('client_id', clientFilter);
    return q;
  };
  const buildContactsQ = () => {
    let q = supabase
      .from('ghl_contacts')
      .select('location_id, tags')
      .gte('date_added', `${range.since}T00:00:00Z`)
      .lte('date_added', `${range.until}T23:59:59Z`);
    if (clientFilter) q = q.eq('location_id', clientFilter);
    return q;
  };
  const buildTxnsQ = () => {
    let q = supabase
      .from('ghl_transactions')
      .select('location_id, amount_cents, contact_source_id, entity_source_id')
      .eq('status', 'succeeded')
      .gte('charge_created_at', `${range.since}T00:00:00Z`)
      .lte('charge_created_at', `${range.until}T23:59:59Z`);
    if (clientFilter) q = q.eq('location_id', clientFilter);
    return q;
  };
  const buildFunnelsQ = () => {
    let q = supabase.from('ghl_funnels').select('location_id, source_id');
    if (clientFilter) q = q.eq('location_id', clientFilter);
    return q;
  };
  // Revenue from Profit Tracker entries, attributed by effective_date.
  const buildRevenueQ = () => {
    let q = supabase
      .from('profit_tracker_entries')
      .select('location_id, total_revenue_gbp')
      .gte('effective_date', range.since)
      .lte('effective_date', range.until);
    if (clientFilter) q = q.eq('location_id', clientFilter);
    return q;
  };
  // Locations that have GHL transactions synced at all (any date) — used to know
  // whether to trust a 0 count from GHL, or fall back to Meta pixel for that client.
  const buildTxnsCoverageQ = () => {
    let q = supabase.from('ghl_transactions').select('location_id').limit(1000);
    if (clientFilter) q = q.eq('location_id', clientFilter);
    return q;
  };

  // Freshness should reflect data actually in view: scope to filter.
  let metaFreshQ = supabase
    .from('meta_daily_stats')
    .select('_synced_at')
    .order('_synced_at', { ascending: false })
    .limit(1);
  let ghlFreshQ = supabase
    .from('ghl_contacts')
    .select('_synced_at')
    .order('_synced_at', { ascending: false })
    .limit(1);
  if (clientFilter) {
    metaFreshQ = metaFreshQ.eq('client_id', clientFilter);
    ghlFreshQ = ghlFreshQ.eq('location_id', clientFilter);
  } else {
    // Portfolio view: scope to user's actual clients (exclude any non-portfolio location_ids).
    metaFreshQ = metaFreshQ.neq('client_id', 'UNCAHP_AGENCY');
  }

  type TxnRow = {
    location_id: string;
    amount_cents: number | null;
    contact_source_id: string | null;
    entity_source_id: string | null;
  };
  type TxnCoverageRow = { location_id: string };
  type FunnelRow = { location_id: string; source_id: string };
  type RevenueRow = { location_id: string; total_revenue_gbp: number | null };
  const [spendData, leadsData, txnsData, txnsCoverage, funnelsData, revenueData, freshnessMeta, freshnessGhl, activeClients] = await Promise.all([
    fetchAll<MetaRow>(buildMetaQ),
    fetchAll<ContactRow>(buildContactsQ),
    fetchAll<TxnRow>(buildTxnsQ),
    fetchAll<TxnCoverageRow>(buildTxnsCoverageQ),
    fetchAll<FunnelRow>(buildFunnelsQ),
    fetchAll<RevenueRow>(buildRevenueQ),
    metaFreshQ,
    ghlFreshQ,
    getActiveClients(),
  ]);

  // Strict allowlist: the registry is the source of truth. Only active clients (by
  // GHL location id) appear, and their name/logo come from the registry.
  const registry = new Map(activeClients.map(c => [c.client_id, c]));

  // Revenue per client (only clients with a connected Profit Tracker appear).
  const revenueByClient = new Map<string, number>();
  for (const r of revenueData) {
    if (r.total_revenue_gbp == null) continue;
    revenueByClient.set(r.location_id, (revenueByClient.get(r.location_id) ?? 0) + Number(r.total_revenue_gbp));
  }

  // Funnel IDs per client — used to count "purchases" as funnel-attributed only.
  const funnelIdsByClient = new Map<string, Set<string>>();
  for (const f of funnelsData) {
    const set = funnelIdsByClient.get(f.location_id) ?? new Set<string>();
    set.add(f.source_id);
    funnelIdsByClient.set(f.location_id, set);
  }

  // Per-client funnel-attributed purchase counts (succeeded transactions whose
  // entity_source_id matches a known funnel for that client).
  const ghlPurchasesByClient = new Map<string, number>();
  for (const t of txnsData) {
    const funnels = funnelIdsByClient.get(t.location_id);
    if (!funnels || !t.entity_source_id || !funnels.has(t.entity_source_id)) continue;
    ghlPurchasesByClient.set(t.location_id, (ghlPurchasesByClient.get(t.location_id) ?? 0) + 1);
  }
  const clientsWithGhlTxnCoverage = new Set<string>();
  for (const r of txnsCoverage) clientsWithGhlTxnCoverage.add(r.location_id);

  // Aggregate spend + funnel events per client (from meta_daily_stats)
  type MetaAccum = {
    spend_cents: number;
    client_name: string;
    lp_views: number;
    lp_leads: number;
    lf_leads: number;
    checkouts: number;
    purchases: number;
  };
  const metaByClient = new Map<string, MetaAccum>();
  for (const r of spendData) {
    const cur = metaByClient.get(r.client_id) ?? {
      spend_cents: 0, client_name: r.client_name ?? '',
      lp_views: 0, lp_leads: 0, lf_leads: 0, checkouts: 0, purchases: 0,
    };
    cur.spend_cents += r.spend_cents ?? 0;
    cur.client_name = r.client_name ?? cur.client_name;
    cur.lp_views += extractAction(r.actions, 'landing_page_view');
    cur.lp_leads += extractAction(r.actions, 'offsite_conversion.fb_pixel_lead');
    cur.lf_leads += extractAction(r.actions, 'onsite_conversion.lead_grouped');
    cur.checkouts += extractAction(r.actions, 'initiate_checkout');
    // Meta pixel purchases — kept as a fallback when no GHL transaction coverage
    cur.purchases += (r.purchases ?? extractAction(r.actions, 'purchase')) || 0;
    metaByClient.set(r.client_id, cur);
  }
  // Override purchases with GHL transactions (ground truth) for clients whose
  // GHL transactions are synced. Pixel-only clients keep their Meta count.
  for (const [client_id, m] of metaByClient.entries()) {
    if (clientsWithGhlTxnCoverage.has(client_id)) {
      m.purchases = ghlPurchasesByClient.get(client_id) ?? 0;
    }
  }

  // GHL leads + bookings per location, both from contacts created in range.
  // A "booking" is a contact carrying the `booked` tag — the conversion signal
  // set by each client's GHL workflow when a lead books an appointment.
  const leadsByClient = new Map<string, number>();
  const bookingsByClient = new Map<string, number>();
  for (const r of leadsData) {
    leadsByClient.set(r.location_id, (leadsByClient.get(r.location_id) ?? 0) + 1);
    const tags = Array.isArray(r.tags) ? (r.tags as unknown[]) : [];
    if (tags.some(t => typeof t === 'string' && t.toLowerCase() === 'booked')) {
      bookingsByClient.set(r.location_id, (bookingsByClient.get(r.location_id) ?? 0) + 1);
    }
  }

  // Build rows from clients that appeared in spend AND are active in the registry.
  const rows: ClientRow[] = [];
  for (const [client_id, m] of metaByClient.entries()) {
    const reg = registry.get(client_id);
    if (!reg) continue; // not an active registered client → hidden
    const spend_gbp = m.spend_cents / 100;
    const leads = leadsByClient.get(client_id) ?? 0;
    const bookings = bookingsByClient.get(client_id) ?? 0;
    const revenue_gbp = revenueByClient.has(client_id) ? revenueByClient.get(client_id)! : null;
    rows.push({
      client_id,
      client_name: reg.client_name || m.client_name,
      logo_url: reg.logo_url ?? null,
      spend_gbp,
      lp_views: m.lp_views,
      lp_leads: m.lp_leads,
      lf_leads: m.lf_leads,
      leads,
      checkouts: m.checkouts,
      purchases: m.purchases,
      bookings,
      cpl_gbp: leads > 0 ? +(spend_gbp / leads).toFixed(2) : null,
      conv_rate_pct: leads > 0 ? +((100 * bookings) / leads).toFixed(2) : null,
      cac_gbp: bookings > 0 ? +(spend_gbp / bookings).toFixed(2) : null,
      revenue_gbp,
      roas: revenue_gbp != null && spend_gbp > 0 ? +(revenue_gbp / spend_gbp).toFixed(2) : null,
      lead_optin_rate_pct: m.lp_views > 0 ? +((100 * m.lp_leads) / m.lp_views).toFixed(2) : null,
      deposit_start_rate_pct: m.lp_leads > 0 ? +((100 * m.checkouts) / m.lp_leads).toFixed(2) : null,
      deposit_collection_rate_pct: m.checkouts > 0 ? +((100 * m.purchases) / m.checkouts).toFixed(2) : null,
    });
  }
  rows.sort((a, b) => b.spend_gbp - a.spend_gbp);

  // Totals
  const totalSpend = rows.reduce((s, r) => s + r.spend_gbp, 0);
  const totalLpViews = rows.reduce((s, r) => s + r.lp_views, 0);
  const totalLpLeads = rows.reduce((s, r) => s + r.lp_leads, 0);
  const totalLfLeads = rows.reduce((s, r) => s + r.lf_leads, 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  const totalCheckouts = rows.reduce((s, r) => s + r.checkouts, 0);
  const totalPurchases = rows.reduce((s, r) => s + r.purchases, 0);
  const totalBookings = rows.reduce((s, r) => s + r.bookings, 0);
  // Revenue total: null unless at least one client has Profit Tracker data in range.
  const revenueRows = rows.filter(r => r.revenue_gbp != null);
  const totalRevenue = revenueRows.length > 0
    ? revenueRows.reduce((s, r) => s + (r.revenue_gbp ?? 0), 0)
    : null;
  const totals: Totals = {
    spend_gbp: totalSpend,
    lp_views: totalLpViews,
    lp_leads: totalLpLeads,
    lf_leads: totalLfLeads,
    leads: totalLeads,
    checkouts: totalCheckouts,
    purchases: totalPurchases,
    bookings: totalBookings,
    cpl_gbp: totalLeads > 0 ? +(totalSpend / totalLeads).toFixed(2) : null,
    conv_rate_pct: totalLeads > 0 ? +((100 * totalBookings) / totalLeads).toFixed(2) : null,
    cac_gbp: totalBookings > 0 ? +(totalSpend / totalBookings).toFixed(2) : null,
    revenue_gbp: totalRevenue,
    roas: totalRevenue != null && totalSpend > 0 ? +(totalRevenue / totalSpend).toFixed(2) : null,
    lead_optin_rate_pct: totalLpViews > 0 ? +((100 * totalLpLeads) / totalLpViews).toFixed(2) : null,
    deposit_start_rate_pct: totalLpLeads > 0 ? +((100 * totalCheckouts) / totalLpLeads).toFixed(2) : null,
    deposit_collection_rate_pct: totalCheckouts > 0 ? +((100 * totalPurchases) / totalCheckouts).toFixed(2) : null,
  };

  // Freshness
  const metaSync = freshnessMeta.data?.[0]?._synced_at ?? null;
  const ghlSync = freshnessGhl.data?.[0]?._synced_at ?? null;
  const now = Date.now();
  const hours = (ts: string | null) => (ts ? (now - new Date(ts).getTime()) / 3_600_000 : null);
  const metaHours = hours(metaSync);
  const ghlHours = hours(ghlSync);
  const freshness: FreshnessReport = {
    meta_synced_at: metaSync,
    ghl_synced_at: ghlSync,
    hours_since_meta: metaHours,
    hours_since_ghl: ghlHours,
    is_stale: (metaHours ?? 0) > 48 || (ghlHours ?? 0) > 48,
  };

  return { rows, totals, freshness };
}

// ─── Per-ad attribution (Maldon, Skin Heal — UTM rollout complete) ───────────

export type AdRow = {
  client_name: string;
  ad_id: string;
  ad_name: string | null;
  campaign_name: string | null;
  creative_image_url: string | null;
  spend_gbp: number;
  leads: number;
  bookings: number;
  cpl_gbp: number | null;
  cac_gbp: number | null;
};

export async function getAdAttribution(
  range: DateRange,
  clientIds: string[],
): Promise<AdRow[]> {
  if (clientIds.length === 0) return [];

  // Per-ad spend + leads from meta_daily_stats (paginated — 6,000+ rows in 30d)
  type StatRow = { ad_source_id: string | null; client_id: string; client_name: string | null; spend_cents: number | null; leads: number | null };
  const stats = await fetchAll<StatRow>(() =>
    supabase
      .from('meta_daily_stats')
      .select('ad_source_id, client_id, client_name, spend_cents, leads')
      .gte('date', range.since)
      .lte('date', range.until)
      .in('client_id', clientIds),
  );

  // Per-ad metadata
  const adIds = Array.from(new Set(stats.map((r) => r.ad_source_id).filter(Boolean) as string[]));
  if (adIds.length === 0) return [];

  type AdMeta = { source_id: string; name: string | null; creative_name: string | null; image_url: string | null; campaign_source_id: string | null };
  const ads = await fetchAll<AdMeta>(() =>
    supabase
      .from('meta_ads')
      .select('source_id, name, creative_name, image_url, campaign_source_id')
      .in('source_id', adIds),
  );

  type Campaign = { source_id: string; name: string | null };
  const campaignIds = Array.from(new Set(ads.map((a) => a.campaign_source_id).filter(Boolean) as string[]));
  const campaigns = campaignIds.length === 0 ? [] : await fetchAll<Campaign>(() =>
    supabase.from('meta_campaigns').select('source_id, name').in('source_id', campaignIds),
  );

  const adById = new Map((ads ?? []).map(a => [a.source_id, a]));
  const campaignById = new Map(campaigns.map((c) => [c.source_id, c.name]));

  // Aggregate per ad
  type AdAccum = { client_name: string; spend_cents: number; pixel_leads: number };
  const accum = new Map<string, AdAccum>();
  for (const r of stats) {
    if (!r.ad_source_id) continue;
    const cur = accum.get(r.ad_source_id) ?? { client_name: r.client_name ?? '', spend_cents: 0, pixel_leads: 0 };
    cur.spend_cents += r.spend_cents ?? 0;
    cur.pixel_leads += r.leads ?? 0;
    accum.set(r.ad_source_id, cur);
  }

  // GHL contacts attributed to this ad — match on customFields utm_content (paginated)
  type ContactRow = { source_id: string; location_id: string; metadata: unknown };
  const contacts = await fetchAll<ContactRow>(() =>
    supabase
      .from('ghl_contacts')
      .select('source_id, location_id, metadata')
      .in('location_id', clientIds)
      .gte('date_added', `${range.since}T00:00:00Z`)
      .lte('date_added', `${range.until}T23:59:59Z`),
  );

  const adIdSet = new Set(adById.keys());
  const leadsByAdId = new Map<string, number>();
  for (const c of contacts) {
    const adId = matchAdId(c.metadata, adIdSet);
    if (adId) leadsByAdId.set(adId, (leadsByAdId.get(adId) ?? 0) + 1);
  }

  // Bookings per ad — same UTM trace via ghl_opportunities → contact_id (paginated)
  type WonOpp = { contact_id: string | null };
  const wonOpps = await fetchAll<WonOpp>(() =>
    supabase
      .from('ghl_opportunities')
      .select('contact_id')
      .in('location_id', clientIds)
      .eq('status', 'won')
      .gte('created_at', `${range.since}T00:00:00Z`)
      .lte('created_at', `${range.until}T23:59:59Z`),
  );
  const wonContactIds = new Set<string>();
  for (const o of wonOpps) {
    if (o.contact_id) wonContactIds.add(o.contact_id);
  }

  const bookingsByAdId = new Map<string, number>();
  for (const c of contacts) {
    const adId = matchAdId(c.metadata, adIdSet);
    if (!adId) continue;
    if (wonContactIds.has(c.source_id)) {
      bookingsByAdId.set(adId, (bookingsByAdId.get(adId) ?? 0) + 1);
    }
  }

  const out: AdRow[] = [];
  for (const [adId, { client_name, spend_cents, pixel_leads }] of accum.entries()) {
    const ad = adById.get(adId);
    const leads = leadsByAdId.get(adId) ?? pixel_leads;
    const bookings = bookingsByAdId.get(adId) ?? 0;
    const spend_gbp = spend_cents / 100;
    out.push({
      client_name,
      ad_id: adId,
      ad_name: ad?.name ?? ad?.creative_name ?? null,
      campaign_name: ad?.campaign_source_id ? campaignById.get(ad.campaign_source_id) ?? null : null,
      creative_image_url: ad?.image_url ?? null,
      spend_gbp,
      leads,
      bookings,
      cpl_gbp: leads > 0 ? +(spend_gbp / leads).toFixed(2) : null,
      cac_gbp: bookings > 0 ? +(spend_gbp / bookings).toFixed(2) : null,
    });
  }
  out.sort((a, b) => b.spend_gbp - a.spend_gbp);
  return out;
}

// Rollout-complete client IDs (from reference/utm-rollout-sop.md status table)
export const ROLLOUT_COMPLETE_CLIENT_IDS = [
  'gxKykshbOOV8B0ZiXNJH', // Maldon Skin Clinic
  'uoVWSipG848b4HyWePeW', // Skin and Heal
];

// ─── Funnel breakdown (Funnel → Step → Variation, with deposit data) ─────────

export type FunnelPage = {
  page_id: string;
  page_name: string;
  page_url: string | null;
  deposits: number;
  amount_gbp: number;
};

export type FunnelStep = {
  step_id: string;
  step_name: string;
  step_sequence: number | null;
  has_variations: boolean;
  pages: FunnelPage[];
  step_deposits: number;       // includes unattributed (page_id=null) transactions
  step_amount_gbp: number;
};

export type FunnelBreakdown = {
  funnel_id: string;
  funnel_name: string;
  total_deposits: number;
  total_amount_gbp: number;
  steps: FunnelStep[];
  is_synthetic?: boolean;  // true for the catch-all "Non-funnel payments" entry
};

export async function getFunnelBreakdown(
  clientId: string,
  range: DateRange,
): Promise<FunnelBreakdown[]> {
  type FunnelRow = { source_id: string; name: string | null };
  type PageRow = {
    source_id: string;
    funnel_source_id: string;
    step_id: string;
    step_name: string | null;
    step_sequence: number | null;
    step_split: boolean | null;
    step_url: string | null;
    name: string | null;
  };
  type TxnRow = {
    entity_source_id: string | null;
    entity_source_name: string | null;
    step_id: string | null;
    page_id: string | null;
    amount_cents: number | null;
  };

  const [funnels, pages, txns] = await Promise.all([
    fetchAll<FunnelRow>(() =>
      supabase
        .from('ghl_funnels')
        .select('source_id, name')
        .eq('location_id', clientId),
    ),
    fetchAll<PageRow>(() =>
      supabase
        .from('ghl_funnel_pages')
        .select('source_id, funnel_source_id, step_id, step_name, step_sequence, step_split, step_url, name')
        .eq('location_id', clientId),
    ),
    fetchAll<TxnRow>(() =>
      supabase
        .from('ghl_transactions')
        .select('entity_source_id, entity_source_name, step_id, page_id, amount_cents')
        .eq('location_id', clientId)
        .eq('status', 'succeeded')
        .gte('charge_created_at', `${range.since}T00:00:00Z`)
        .lte('charge_created_at', `${range.until}T23:59:59Z`),
    ),
  ]);

  if (funnels.length === 0) return [];

  // Aggregate transactions
  type Counter = { deposits: number; amount_cents: number };
  const byPage = new Map<string, Counter>();
  const byStep = new Map<string, Counter>(); // key: `${funnelId}::${stepId}`
  const byFunnel = new Map<string, Counter>();
  const inc = (m: Map<string, Counter>, k: string, cents: number | null) => {
    const cur = m.get(k) ?? { deposits: 0, amount_cents: 0 };
    cur.deposits += 1;
    cur.amount_cents += cents ?? 0;
    m.set(k, cur);
  };
  for (const t of txns) {
    if (t.page_id) inc(byPage, t.page_id, t.amount_cents);
    if (t.entity_source_id && t.step_id) inc(byStep, `${t.entity_source_id}::${t.step_id}`, t.amount_cents);
    if (t.entity_source_id) inc(byFunnel, t.entity_source_id, t.amount_cents);
  }

  // Group pages by funnel → step
  const stepsByFunnel = new Map<string, Map<string, PageRow[]>>();
  for (const p of pages) {
    const fmap = stepsByFunnel.get(p.funnel_source_id) ?? new Map<string, PageRow[]>();
    const list = fmap.get(p.step_id) ?? [];
    list.push(p);
    fmap.set(p.step_id, list);
    stepsByFunnel.set(p.funnel_source_id, fmap);
  }

  const out: FunnelBreakdown[] = [];
  for (const f of funnels) {
    const stepMap = stepsByFunnel.get(f.source_id) ?? new Map<string, PageRow[]>();
    const steps: FunnelStep[] = [];
    for (const [stepId, stepPages] of stepMap.entries()) {
      const first = stepPages[0];
      const stepCounter = byStep.get(`${f.source_id}::${stepId}`) ?? { deposits: 0, amount_cents: 0 };
      steps.push({
        step_id: stepId,
        step_name: first.step_name ?? '(unnamed step)',
        step_sequence: first.step_sequence ?? null,
        has_variations: stepPages.length > 1 || !!first.step_split,
        pages: stepPages.map(p => {
          const pc = byPage.get(p.source_id) ?? { deposits: 0, amount_cents: 0 };
          return {
            page_id: p.source_id,
            page_name: p.name ?? '(unnamed page)',
            page_url: p.step_url ?? null,
            deposits: pc.deposits,
            amount_gbp: pc.amount_cents / 100,
          };
        }),
        step_deposits: stepCounter.deposits,
        step_amount_gbp: stepCounter.amount_cents / 100,
      });
    }
    steps.sort((a, b) => (a.step_sequence ?? 999) - (b.step_sequence ?? 999));
    const fc = byFunnel.get(f.source_id) ?? { deposits: 0, amount_cents: 0 };
    out.push({
      funnel_id: f.source_id,
      funnel_name: f.name ?? '(unnamed funnel)',
      total_deposits: fc.deposits,
      total_amount_gbp: fc.amount_cents / 100,
      steps,
    });
  }
  // Funnels with any activity first; then anything that has structure but no deposits
  // Bucket transactions whose entity_source_id doesn't match any known funnel
  // (one-step order forms, direct payment links, etc.) so totals reconcile.
  const knownFunnelIds = new Set(funnels.map(f => f.source_id));
  const orphanByEntity = new Map<string, { name: string; deposits: number; amount_cents: number }>();
  for (const t of txns) {
    if (t.entity_source_id && knownFunnelIds.has(t.entity_source_id)) continue;
    const key = t.entity_source_id ?? '__null__';
    const cur = orphanByEntity.get(key) ?? {
      name: t.entity_source_name ?? 'Direct / one-off payment',
      deposits: 0, amount_cents: 0,
    };
    cur.deposits += 1;
    cur.amount_cents += t.amount_cents ?? 0;
    orphanByEntity.set(key, cur);
  }
  if (orphanByEntity.size > 0) {
    const orphanSteps: FunnelStep[] = [];
    let totalDeposits = 0;
    let totalAmountCents = 0;
    for (const [, info] of orphanByEntity.entries()) {
      orphanSteps.push({
        step_id: '__orphan__',
        step_name: info.name,
        step_sequence: null,
        has_variations: false,
        pages: [],
        step_deposits: info.deposits,
        step_amount_gbp: info.amount_cents / 100,
      });
      totalDeposits += info.deposits;
      totalAmountCents += info.amount_cents;
    }
    out.push({
      funnel_id: '__non_funnel__',
      funnel_name: 'Non-funnel payments',
      total_deposits: totalDeposits,
      total_amount_gbp: totalAmountCents / 100,
      steps: orphanSteps,
      is_synthetic: true,
    });
  }

  out.sort((a, b) => b.total_deposits - a.total_deposits || a.funnel_name.localeCompare(b.funnel_name));
  return out;
}

// ─── Registry funnel metrics (LP Views → Opt-ins → Deposits) ─────────────────
// The new tracking model: LP views from Meta landing_page_view (for the funnel's
// mapped campaigns), opt-ins + deposits from GHL contact tags (ANY tag matches).

export type FunnelMetrics = {
  funnel_id: string;
  funnel_name: string;
  client_id: string;
  lp_views: number | null;        // null when no campaigns are mapped
  optins: number;
  deposits: number;
  optin_rate_pct: number | null;   // opt-ins ÷ LP views
  deposit_rate_pct: number | null; // deposits ÷ opt-ins
  pages: FunnelPageLink[];
  optin_tags: string[];
  deposit_tags: string[];
  deposit_sources: string[];
  meta_campaign_count: number;
};

export async function getFunnelMetrics(funnel: AdminFunnel, range: DateRange): Promise<FunnelMetrics> {
  // LP views from Meta landing_page_view for the mapped campaigns.
  let lp_views: number | null = null;
  if (funnel.meta_campaign_ids.length > 0) {
    type StatRow = { actions: unknown };
    const rows = await fetchAll<StatRow>(() =>
      supabase
        .from('meta_daily_stats')
        .select('actions')
        .in('campaign_source_id', funnel.meta_campaign_ids)
        .gte('date', range.since)
        .lte('date', range.until),
    );
    lp_views = rows.reduce((s, r) => s + extractAction(r.actions, 'landing_page_view'), 0);
  }

  // Opt-ins: contacts carrying ALL the funnel's opt-in tags, CREATED in range. Matches a
  // GHL "Tag Is [...] AND Created Between [...]" smart list exactly. Deduplicated per
  // contact (a lead who enquires multiple times counts once). Net-new only — a contact
  // created in an earlier period is not re-counted here even if it re-engages.
  let optins = 0;
  if (funnel.optin_tags.length > 0) {
    const need = funnel.optin_tags.map(t => t.toLowerCase());
    type ContactRow = { tags: unknown };
    const contacts = await fetchAll<ContactRow>(() =>
      supabase
        .from('ghl_contacts')
        .select('tags')
        .eq('location_id', funnel.client_id)
        .gte('date_added', `${range.since}T00:00:00Z`)
        .lte('date_added', `${range.until}T23:59:59Z`),
    );
    for (const c of contacts) {
      const t = Array.isArray(c.tags) ? c.tags.map(x => String(x).toLowerCase()) : [];
      if (need.every(w => t.includes(w))) optins++;
    }
  }

  // Deposits: succeeded transactions in range whose SOURCE (GHL's payment "Source",
  // e.g. "LP - £50 Skin Analysis") is one this funnel counts. Dated by the charge and
  // attributed by source — so it isolates THIS offer's deposits from the client's
  // other offers that share a generic deposit tag.
  let deposits = 0;
  const sourceSet = new Set(funnel.deposit_sources.map(s => s.toLowerCase()));
  if (sourceSet.size > 0) {
    type TxnRow = { contact_source_id: string | null; entity_source_name: string | null };
    const txns = await fetchAll<TxnRow>(() =>
      supabase
        .from('ghl_transactions')
        .select('contact_source_id, entity_source_name')
        .eq('location_id', funnel.client_id)
        .eq('status', 'succeeded')
        .gte('charge_created_at', `${range.since}T00:00:00Z`)
        .lte('charge_created_at', `${range.until}T23:59:59Z`),
    );
    const counted = new Set<string>();
    for (const t of txns) {
      const src = (t.entity_source_name ?? '').toLowerCase();
      if (sourceSet.has(src) && t.contact_source_id) counted.add(t.contact_source_id);
    }
    deposits = counted.size;
  }

  const rate = (n: number, d: number | null) => (d && d > 0 ? +((100 * n) / d).toFixed(2) : null);
  return {
    funnel_id: funnel.id,
    funnel_name: funnel.name,
    client_id: funnel.client_id,
    lp_views,
    optins,
    deposits,
    optin_rate_pct: rate(optins, lp_views),
    deposit_rate_pct: rate(deposits, optins),
    pages: funnel.pages,
    optin_tags: funnel.optin_tags,
    deposit_tags: funnel.deposit_tags,
    deposit_sources: funnel.deposit_sources,
    meta_campaign_count: funnel.meta_campaign_ids.length,
  };
}

export type FunnelListItem = {
  client_id: string;
  client_name: string;
  funnel_id: string;
  funnel_name: string;
};

export async function getFunnelList(): Promise<FunnelListItem[]> {
  type Row = { source_id: string; location_id: string; name: string | null };
  const funnels = await fetchAll<Row>(() =>
    supabase.from('ghl_funnels').select('source_id, location_id, name'),
  );
  if (funnels.length === 0) return [];
  const clientIds = Array.from(new Set(funnels.map(f => f.location_id)));
  const { data: accounts } = await supabase
    .from('meta_accounts')
    .select('client_id, client_name')
    .in('client_id', clientIds);
  const nameById = new Map<string, string>();
  for (const a of accounts ?? []) nameById.set(a.client_id, a.client_name ?? a.client_id);
  return funnels
    .map(f => ({
      client_id: f.location_id,
      client_name: nameById.get(f.location_id) ?? f.location_id,
      funnel_id: f.source_id,
      funnel_name: f.name ?? '(unnamed funnel)',
    }))
    .sort((a, b) =>
      a.client_name.localeCompare(b.client_name) || a.funnel_name.localeCompare(b.funnel_name),
    );
}

export type ClientOption = { client_id: string; client_name: string; logo_url?: string | null };

// Active clients from the registry (the source of truth). client_id here is the
// GHL location id — the canonical key the rest of the app joins on. Only clients
// with a linked ghl_location_id are returned, since without it there's no data to
// join. Archived clients are excluded everywhere by design (strict allowlist).
export async function getActiveClients(): Promise<ClientOption[]> {
  // clients is RLS-locked → must use the service-role client.
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('client_name, ghl_location_id, logo_url')
    .eq('status', 'active')
    .not('ghl_location_id', 'is', null)
    .order('client_name');
  if (error) throw error;
  return (data ?? []).map(r => ({
    client_id: r.ghl_location_id as string,
    client_name: r.client_name ?? (r.ghl_location_id as string),
    logo_url: r.logo_url ?? null,
  }));
}

export async function getClientList(): Promise<ClientOption[]> {
  return getActiveClients();
}

// ─── Campaign Explorer (Campaign → Ad Set → Ad tree, with metrics) ───────────

export type CampaignMetrics = {
  spend_gbp: number;
  impressions: number;
  clicks: number;
  ctr_pct: number | null;
  cpc_gbp: number | null;
  cpm_gbp: number | null;
  leads: number;
  cpl_gbp: number | null;
  lp_bookings: number;          // Meta pixel purchases — deposit paid in the funnel
  cost_lp_booking_gbp: number | null;
  bookings: number;             // GHL 'booked' tag — all bookings
  conv_rate_pct: number | null;
  cac_gbp: number | null;
  roi: number | null; // null until revenue is attributed per ad
};

export type AdNode = CampaignMetrics & {
  id: string;
  name: string;
  status: string;
  creative_name: string | null;
  image_url: string | null;
  video_url: string | null;
  headline: string | null;
  primary_text: string | null;
  cta: string | null;
};
export type AdsetNode = CampaignMetrics & {
  id: string;
  name: string;
  status: string;
  ads: AdNode[];
};
export type CampaignNode = CampaignMetrics & {
  id: string;
  name: string;
  status: string;
  objective: string | null;
  adsets: AdsetNode[];
};

type RawMetrics = { spend_cents: number; clicks: number; impressions: number; leads: number; lp_bookings: number; bookings: number };

function computeMetrics(r: RawMetrics): CampaignMetrics {
  const spend = r.spend_cents / 100;
  return {
    spend_gbp: spend,
    impressions: r.impressions,
    clicks: r.clicks,
    ctr_pct: r.impressions > 0 ? +((100 * r.clicks) / r.impressions).toFixed(2) : null,
    cpc_gbp: r.clicks > 0 ? +(spend / r.clicks).toFixed(2) : null,
    cpm_gbp: r.impressions > 0 ? +((spend / r.impressions) * 1000).toFixed(2) : null,
    leads: r.leads,
    cpl_gbp: r.leads > 0 ? +(spend / r.leads).toFixed(2) : null,
    lp_bookings: r.lp_bookings,
    cost_lp_booking_gbp: r.lp_bookings > 0 ? +(spend / r.lp_bookings).toFixed(2) : null,
    bookings: r.bookings,
    conv_rate_pct: r.leads > 0 ? +((100 * r.bookings) / r.leads).toFixed(2) : null,
    cac_gbp: r.bookings > 0 ? +(spend / r.bookings).toFixed(2) : null,
    roi: null,
  };
}

function sumRaw(parts: RawMetrics[]): RawMetrics {
  return parts.reduce<RawMetrics>(
    (a, p) => ({
      spend_cents: a.spend_cents + p.spend_cents,
      clicks: a.clicks + p.clicks,
      impressions: a.impressions + p.impressions,
      leads: a.leads + p.leads,
      lp_bookings: a.lp_bookings + p.lp_bookings,
      bookings: a.bookings + p.bookings,
    }),
    { spend_cents: 0, clicks: 0, impressions: 0, leads: 0, lp_bookings: 0, bookings: 0 },
  );
}

export async function getCampaignExplorer(
  clientId: string,
  range: DateRange,
): Promise<CampaignNode[]> {
  type StatRow = { ad_source_id: string | null; spend_cents: number | null; clicks: number | null; impressions: number | null; leads: number | null; purchases: number | null };
  type CampRow = { source_id: string; name: string | null; status: string | null; objective: string | null };
  type AdsetRow = { source_id: string; campaign_source_id: string | null; name: string | null; status: string | null };
  type AdRow = {
    source_id: string; adset_source_id: string | null; campaign_source_id: string | null;
    name: string | null; status: string | null; creative_name: string | null;
    image_url: string | null; video_url: string | null; headline: string | null;
    primary_text: string | null; call_to_action: string | null;
  };
  type ContactRow = { metadata: unknown; tags: unknown };

  const [stats, campaigns, adsets, ads, contacts] = await Promise.all([
    fetchAll<StatRow>(() =>
      supabase
        .from('meta_daily_stats')
        .select('ad_source_id, spend_cents, clicks, impressions, leads, purchases')
        .eq('client_id', clientId)
        .gte('date', range.since)
        .lte('date', range.until),
    ),
    fetchAll<CampRow>(() =>
      supabase.from('meta_campaigns').select('source_id, name, status, objective').eq('client_id', clientId),
    ),
    fetchAll<AdsetRow>(() =>
      supabase.from('meta_adsets').select('source_id, campaign_source_id, name, status').eq('client_id', clientId),
    ),
    fetchAll<AdRow>(() =>
      supabase
        .from('meta_ads')
        .select('source_id, adset_source_id, campaign_source_id, name, status, creative_name, image_url, video_url, headline, primary_text, call_to_action')
        .eq('client_id', clientId),
    ),
    fetchAll<ContactRow>(() =>
      supabase
        .from('ghl_contacts')
        .select('metadata, tags')
        .eq('location_id', clientId)
        .gte('date_added', `${range.since}T00:00:00Z`)
        .lte('date_added', `${range.until}T23:59:59Z`),
    ),
  ]);

  // Per-ad spend/clicks/impressions/pixel-leads/pixel-purchases from Meta.
  const statByAd = new Map<string, { spend_cents: number; clicks: number; impressions: number; pixelLeads: number; purchases: number }>();
  for (const s of stats) {
    if (!s.ad_source_id) continue;
    const a = statByAd.get(s.ad_source_id) ?? { spend_cents: 0, clicks: 0, impressions: 0, pixelLeads: 0, purchases: 0 };
    a.spend_cents += s.spend_cents ?? 0;
    a.clicks += s.clicks ?? 0;
    a.impressions += s.impressions ?? 0;
    a.pixelLeads += s.leads ?? 0;
    a.purchases += s.purchases ?? 0;
    statByAd.set(s.ad_source_id, a);
  }

  // GHL leads + bookings per ad, traced via the UTM ad-id custom field value.
  const adIdSet = new Set(ads.map(a => a.source_id));
  const ghlLeadsByAd = new Map<string, number>();
  const bookingsByAd = new Map<string, number>();
  for (const c of contacts) {
    const adId = matchAdId(c.metadata, adIdSet);
    if (!adId) continue;
    ghlLeadsByAd.set(adId, (ghlLeadsByAd.get(adId) ?? 0) + 1);
    const tags = Array.isArray(c.tags) ? (c.tags as unknown[]) : [];
    if (tags.some(t => typeof t === 'string' && t.toLowerCase() === 'booked')) {
      bookingsByAd.set(adId, (bookingsByAd.get(adId) ?? 0) + 1);
    }
  }

  // Build ad nodes (+ keep their raw metrics for roll-up).
  const adRaw = new Map<string, RawMetrics>();
  const adNodeById = new Map<string, AdNode>();
  const adsByAdset = new Map<string, string[]>();
  for (const a of ads) {
    const st = statByAd.get(a.source_id) ?? { spend_cents: 0, clicks: 0, impressions: 0, pixelLeads: 0, purchases: 0 };
    // Prefer UTM-traced GHL leads; fall back to Meta pixel leads.
    const leads = ghlLeadsByAd.get(a.source_id) ?? st.pixelLeads;
    const raw: RawMetrics = {
      spend_cents: st.spend_cents,
      clicks: st.clicks,
      impressions: st.impressions,
      leads,
      lp_bookings: st.purchases,
      bookings: bookingsByAd.get(a.source_id) ?? 0,
    };
    adRaw.set(a.source_id, raw);
    adNodeById.set(a.source_id, {
      id: a.source_id,
      name: a.name ?? a.creative_name ?? '(unnamed ad)',
      status: a.status ?? 'UNKNOWN',
      creative_name: a.creative_name,
      image_url: a.image_url,
      video_url: a.video_url,
      headline: a.headline,
      primary_text: a.primary_text,
      cta: a.call_to_action,
      ...computeMetrics(raw),
    });
    const key = a.adset_source_id ?? '__no_adset__';
    adsByAdset.set(key, [...(adsByAdset.get(key) ?? []), a.source_id]);
  }

  // Build adset nodes.
  const adsetNodeById = new Map<string, AdsetNode>();
  const adsetRawById = new Map<string, RawMetrics>();
  const adsetsByCampaign = new Map<string, string[]>();
  for (const s of adsets) {
    const adIds = adsByAdset.get(s.source_id) ?? [];
    const adNodes = adIds.map(id => adNodeById.get(id)!).filter(Boolean);
    adNodes.sort((x, y) => y.spend_gbp - x.spend_gbp);
    const raw = sumRaw(adIds.map(id => adRaw.get(id)!).filter(Boolean));
    adsetRawById.set(s.source_id, raw);
    adsetNodeById.set(s.source_id, {
      id: s.source_id,
      name: s.name ?? '(unnamed ad set)',
      status: s.status ?? 'UNKNOWN',
      ads: adNodes,
      ...computeMetrics(raw),
    });
    const key = s.campaign_source_id ?? '__no_campaign__';
    adsetsByCampaign.set(key, [...(adsetsByCampaign.get(key) ?? []), s.source_id]);
  }

  // Build campaign nodes. Include a campaign if it spent in range or is ACTIVE.
  const out: CampaignNode[] = [];
  for (const c of campaigns) {
    const adsetIds = adsetsByCampaign.get(c.source_id) ?? [];
    const adsetNodes = adsetIds.map(id => adsetNodeById.get(id)!).filter(Boolean);
    adsetNodes.sort((x, y) => y.spend_gbp - x.spend_gbp);
    const raw = sumRaw(adsetIds.map(id => adsetRawById.get(id)!).filter(Boolean));
    if (raw.spend_cents === 0 && (c.status ?? '') !== 'ACTIVE') continue;
    out.push({
      id: c.source_id,
      name: c.name ?? '(unnamed campaign)',
      status: c.status ?? 'UNKNOWN',
      objective: c.objective,
      adsets: adsetNodes,
      ...computeMetrics(raw),
    });
  }
  out.sort((a, b) => b.spend_gbp - a.spend_gbp);
  return out;
}
