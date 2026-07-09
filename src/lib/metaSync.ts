import { supabaseAdmin } from './supabase';

// Direct Meta → Supabase sync for a single client, using the agency system-user token
// (META_ACCESS_TOKEN). This mirrors what the external pipeline writes into
// meta_daily_stats / meta_campaigns, so a freshly-added client (or a stale one) can be
// pulled on demand instead of waiting for the daily 02:00 UTC run.
//
// Writes are keyed by the GHL location id (the canonical client_id), and scoped to the
// one client + a rolling window, so they're idempotent and never touch other clients.

const GRAPH = 'https://graph.facebook.com/v21.0';
const BACKFILL_DAYS = 90;

export type MetaSyncResult = {
  ok: boolean;
  error?: string;
  days?: number;
  statRows?: number;
  campaigns?: number;
  spend_gbp?: number;
  lp_views?: number;
  leads?: number;
};

type MetaAction = { action_type: string; value: string };
type Insight = {
  ad_id?: string; adset_id?: string; campaign_id?: string;
  date_start?: string; spend?: string; impressions?: string; clicks?: string;
  reach?: string; frequency?: string; ctr?: string; cpc?: string; cpm?: string; cpp?: string;
  actions?: MetaAction[];
};
type Campaign = { id: string; name?: string; status?: string; objective?: string };

// Follow Graph API cursor pagination until exhausted (or a sane page cap).
async function graphPaged<T>(startUrl: string, cap = 50): Promise<{ data: T[]; error?: string }> {
  const out: T[] = [];
  let url: string | null = startUrl;
  let pages = 0;
  while (url && pages < cap) {
    const res = await fetch(url);
    const j: { data?: T[]; error?: { message?: string }; paging?: { next?: string } } = await res.json();
    if (j.error) return { data: out, error: j.error.message ?? 'Meta API error' };
    out.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
    pages++;
  }
  return { data: out };
}

const cents = (v: unknown) => (v == null ? null : Math.round(Number(v) * 100));
const int = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));
const flt = (v: unknown) => (v == null ? null : Number(v));
const actVal = (arr: MetaAction[] | undefined, t: string) => {
  const f = (arr ?? []).find(a => a.action_type === t);
  return f?.value ? Number(f.value) || 0 : 0;
};

export async function syncClientMeta(ghlLocationId: string): Promise<MetaSyncResult> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return { ok: false, error: 'META_ACCESS_TOKEN is not set on the server.' };
  if (!ghlLocationId) return { ok: false, error: 'Missing client id.' };

  const { data: client, error: cErr } = await supabaseAdmin
    .from('clients')
    .select('client_name, meta_ad_account_id, ghl_location_id')
    .eq('ghl_location_id', ghlLocationId)
    .maybeSingle();
  if (cErr) return { ok: false, error: cErr.message };
  if (!client) return { ok: false, error: 'Client not found in the registry.' };
  if (!client.meta_ad_account_id) return { ok: false, error: 'This client has no Meta ad account id set.' };

  const acct = 'act_' + String(client.meta_ad_account_id).replace(/^act_/, '');
  const until = new Date();
  const since = new Date(until.getTime() - BACKFILL_DAYS * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const timeRange = encodeURIComponent(JSON.stringify({ since: day(since), until: day(until) }));
  const now = new Date().toISOString();

  // ── Insights: one row per ad per day (matches the pipeline's granularity) ──
  const fields = 'ad_id,adset_id,campaign_id,spend,impressions,clicks,reach,frequency,ctr,cpc,cpm,cpp,actions';
  const insUrl = `${GRAPH}/${acct}/insights?level=ad&time_increment=1&time_range=${timeRange}&fields=${fields}&limit=500&access_token=${token}`;
  const ins = await graphPaged<Insight>(insUrl);
  if (ins.error) return { ok: false, error: `Meta insights: ${ins.error}` };

  const rows = ins.data.map(r => ({
    id: crypto.randomUUID(),
    ad_source_id: r.ad_id ?? null,
    adset_source_id: r.adset_id ?? null,
    campaign_source_id: r.campaign_id ?? null,
    account_source_id: acct,
    client_id: client.ghl_location_id,
    client_name: client.client_name,
    date: r.date_start,
    spend_cents: cents(r.spend) ?? 0,
    impressions: int(r.impressions),
    clicks: int(r.clicks),
    reach: r.reach == null ? null : int(r.reach),
    frequency: flt(r.frequency),
    ctr: flt(r.ctr),
    cpc_cents: cents(r.cpc),
    cpm_cents: cents(r.cpm),
    cpp_cents: cents(r.cpp),
    leads: actVal(r.actions, 'lead'),
    purchases: actVal(r.actions, 'purchase'),
    purchase_value_cents: null,
    cpl_cents: null,
    roas: null,
    // Stored as a JSON *string* — the dashboard's extractAction() parses either form,
    // and the pipeline stores it stringified, so we match it exactly.
    actions: r.actions ? JSON.stringify(r.actions) : null,
    _synced_at: now,
  }));

  // Replace this client's window: idempotent, and scoped so no other client is touched.
  const { error: delErr } = await supabaseAdmin
    .from('meta_daily_stats')
    .delete()
    .eq('client_id', client.ghl_location_id)
    .gte('date', day(since));
  if (delErr) return { ok: false, error: `Clearing old stats failed: ${delErr.message}` };

  for (let i = 0; i < rows.length; i += 500) {
    const { error: insErr } = await supabaseAdmin.from('meta_daily_stats').insert(rows.slice(i, i + 500));
    if (insErr) return { ok: false, error: `Writing stats failed: ${insErr.message}` };
  }

  // ── Campaigns: powers the funnel campaign-mapping picker + explorer names.
  // Best-effort — a failure here shouldn't fail the whole sync. ──
  let campaigns = 0;
  const campUrl = `${GRAPH}/${acct}/campaigns?fields=id,name,status,objective&limit=500&access_token=${token}`;
  const camp = await graphPaged<Campaign>(campUrl);
  if (!camp.error) {
    const campRows = camp.data.map(c => ({
      id: crypto.randomUUID(),
      source_id: c.id,
      account_source_id: acct,
      client_id: client.ghl_location_id,
      client_name: client.client_name,
      name: c.name ?? null,
      status: c.status ?? null,
      objective: c.objective ?? null,
      _synced_at: now,
    }));
    const { error: cDel } = await supabaseAdmin.from('meta_campaigns').delete().eq('client_id', client.ghl_location_id);
    if (!cDel) {
      let wrote = true;
      for (let i = 0; i < campRows.length && wrote; i += 500) {
        const { error } = await supabaseAdmin.from('meta_campaigns').insert(campRows.slice(i, i + 500));
        if (error) wrote = false;
      }
      if (wrote) campaigns = campRows.length;
    }
  }

  const spend_gbp = rows.reduce((s, r) => s + (r.spend_cents || 0), 0) / 100;
  const lp_views = ins.data.reduce((s, r) => s + actVal(r.actions, 'landing_page_view'), 0);
  const leads = rows.reduce((s, r) => s + (r.leads || 0), 0);
  return { ok: true, days: BACKFILL_DAYS, statRows: rows.length, campaigns, spend_gbp, lp_views, leads };
}
