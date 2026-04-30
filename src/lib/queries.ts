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
  type ContactRow = { location_id: string };
  type OppRow = { location_id: string };

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
      .select('location_id')
      .gte('date_added', `${range.since}T00:00:00Z`)
      .lte('date_added', `${range.until}T23:59:59Z`);
    if (clientFilter) q = q.eq('location_id', clientFilter);
    return q;
  };
  const buildOppsQ = () => {
    let q = supabase
      .from('ghl_opportunities')
      .select('location_id')
      .gte('created_at', `${range.since}T00:00:00Z`)
      .lte('created_at', `${range.until}T23:59:59Z`)
      .eq('status', 'won');
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

  const [spendData, leadsData, bookingsData, freshnessMeta, freshnessGhl] = await Promise.all([
    fetchAll<MetaRow>(buildMetaQ),
    fetchAll<ContactRow>(buildContactsQ),
    fetchAll<OppRow>(buildOppsQ),
    metaFreshQ,
    ghlFreshQ,
  ]);

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
    cur.purchases += (r.purchases ?? extractAction(r.actions, 'purchase')) || 0;
    metaByClient.set(r.client_id, cur);
  }

  // GHL leads per location
  const leadsByClient = new Map<string, number>();
  for (const r of leadsData) {
    leadsByClient.set(r.location_id, (leadsByClient.get(r.location_id) ?? 0) + 1);
  }

  // Bookings per location
  const bookingsByClient = new Map<string, number>();
  for (const r of bookingsData) {
    bookingsByClient.set(r.location_id, (bookingsByClient.get(r.location_id) ?? 0) + 1);
  }

  // Build rows from union of all client_ids that appeared in spend
  const rows: ClientRow[] = [];
  for (const [client_id, m] of metaByClient.entries()) {
    const spend_gbp = m.spend_cents / 100;
    const leads = leadsByClient.get(client_id) ?? 0;
    const bookings = bookingsByClient.get(client_id) ?? 0;
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
  type ContactRow = { id: string; location_id: string; metadata: unknown };
  const contacts = await fetchAll<ContactRow>(() =>
    supabase
      .from('ghl_contacts')
      .select('id, location_id, metadata')
      .in('location_id', clientIds)
      .gte('date_added', `${range.since}T00:00:00Z`)
      .lte('date_added', `${range.until}T23:59:59Z`),
  );

  const leadsByAdId = new Map<string, number>();
  for (const c of contacts) {
    const cf = (c.metadata as { customFields?: Array<{ key?: string; value?: string }> } | null)?.customFields ?? [];
    const utmContent = Array.isArray(cf) ? cf.find(f => f?.key === 'utm_content')?.value : null;
    if (utmContent && adById.has(utmContent)) {
      leadsByAdId.set(utmContent, (leadsByAdId.get(utmContent) ?? 0) + 1);
    }
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
    const cf = (c.metadata as { customFields?: Array<{ key?: string; value?: string }> } | null)?.customFields ?? [];
    const utmContent = Array.isArray(cf) ? cf.find(f => f?.key === 'utm_content')?.value : null;
    if (!utmContent || !adById.has(utmContent)) continue;
    if (wonContactIds.has(c.id)) {
      bookingsByAdId.set(utmContent, (bookingsByAdId.get(utmContent) ?? 0) + 1);
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
