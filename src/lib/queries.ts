import { supabase } from './supabase';

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
  const [spendData, leadsData, txnsData, txnsCoverage, funnelsData, revenueData, freshnessMeta, freshnessGhl] = await Promise.all([
    fetchAll<MetaRow>(buildMetaQ),
    fetchAll<ContactRow>(buildContactsQ),
    fetchAll<TxnRow>(buildTxnsQ),
    fetchAll<TxnCoverageRow>(buildTxnsCoverageQ),
    fetchAll<FunnelRow>(buildFunnelsQ),
    fetchAll<RevenueRow>(buildRevenueQ),
    metaFreshQ,
    ghlFreshQ,
  ]);

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

  // Build rows from union of all client_ids that appeared in spend
  const rows: ClientRow[] = [];
  for (const [client_id, m] of metaByClient.entries()) {
    const spend_gbp = m.spend_cents / 100;
    const leads = leadsByClient.get(client_id) ?? 0;
    const bookings = bookingsByClient.get(client_id) ?? 0;
    const revenue_gbp = revenueByClient.has(client_id) ? revenueByClient.get(client_id)! : null;
    rows.push({
      client_id,
      client_name: m.client_name,
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

export type ClientOption = { client_id: string; client_name: string };

export async function getClientList(): Promise<ClientOption[]> {
  // One row per client in meta_accounts (avoids the 1000-row default page limit
  // that bites when querying meta_daily_stats).
  const { data, error } = await supabase
    .from('meta_accounts')
    .select('client_id, client_name')
    .neq('client_id', 'UNCAHP_AGENCY')
    .order('client_name');
  if (error) throw error;
  const seen = new Set<string>();
  const out: ClientOption[] = [];
  for (const r of data ?? []) {
    if (!r.client_id || seen.has(r.client_id)) continue;
    seen.add(r.client_id);
    out.push({ client_id: r.client_id, client_name: r.client_name ?? r.client_id });
  }
  return out;
}
