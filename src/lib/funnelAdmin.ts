import { supabaseAdmin } from './supabase';

export type FunnelPageLink = { name: string; url: string };
export type FunnelVariant = { key: string; label: string };

export type AdminFunnel = {
  id: string;
  client_id: string; // ghl_location_id
  name: string;
  status: 'active' | 'archived';
  optin_tags: string[];
  deposit_tags: string[];
  deposit_sources: string[]; // GHL transaction source names that count as deposits
  setter_sources: string[];  // shared setter/phone payment sources; counted only when the contact has ALL opt-in tags
  meta_campaign_ids: string[];
  pages: FunnelPageLink[];
  // Split test (A/B). track_key is the snippet's data-funnel slug; empty = no test set up.
  track_key: string | null;
  variants: FunnelVariant[];
  split_status: 'off' | 'running' | 'decided';
  created_at: string;
  archived_at: string | null;
};

function normalizePages(raw: unknown): FunnelPageLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map(p => ({ name: String(p.name ?? ''), url: String(p.url ?? '') }))
    .filter(p => p.name || p.url);
}

export function normalizeVariants(raw: unknown): FunnelVariant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object')
    .map(v => ({ key: String(v.key ?? '').trim(), label: String(v.label ?? '').trim() }))
    .filter(v => v.key)
    .map(v => ({ key: v.key, label: v.label || v.key.toUpperCase() }));
}

export async function getAdminFunnels(): Promise<AdminFunnel[]> {
  const withSplit = 'id, client_id, name, status, optin_tags, deposit_tags, deposit_sources, setter_sources, meta_campaign_ids, pages, track_key, variants, split_status, created_at, archived_at';
  const base = 'id, client_id, name, status, optin_tags, deposit_tags, deposit_sources, setter_sources, meta_campaign_ids, pages, created_at, archived_at';
  const first = await supabaseAdmin
    .from('funnels').select(withSplit)
    .order('status', { ascending: true }).order('name', { ascending: true });
  let data = first.data;
  // Before migration 0011 the split columns don't exist — fall back to the base columns
  // so the funnel page keeps working (funnels just show no test until the migration runs).
  if (first.error) {
    const fb = await supabaseAdmin
      .from('funnels').select(base)
      .order('status', { ascending: true }).order('name', { ascending: true });
    if (fb.error) throw fb.error;
    data = fb.data as typeof data;
  }
  return (data ?? []).map(r => ({
    id: r.id,
    client_id: r.client_id,
    name: r.name ?? '',
    status: (r.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
    optin_tags: Array.isArray(r.optin_tags) ? r.optin_tags : [],
    deposit_tags: Array.isArray(r.deposit_tags) ? r.deposit_tags : [],
    deposit_sources: Array.isArray(r.deposit_sources) ? r.deposit_sources : [],
    setter_sources: Array.isArray(r.setter_sources) ? r.setter_sources : [],
    meta_campaign_ids: Array.isArray(r.meta_campaign_ids) ? r.meta_campaign_ids : [],
    pages: normalizePages(r.pages),
    track_key: (r as { track_key?: string | null }).track_key ?? null,
    variants: normalizeVariants((r as { variants?: unknown }).variants),
    split_status: (['running', 'decided'].includes(String((r as { split_status?: string }).split_status))
      ? (r as { split_status?: string }).split_status
      : 'off') as 'off' | 'running' | 'decided',
    created_at: r.created_at,
    archived_at: r.archived_at ?? null,
  }));
}

// Distinct GHL contact tags for a client (location), most-used first — powers the
// opt-in / deposit tag pickers. Sampled from recent contacts; the form also allows
// free-text so a rare tag can still be entered.
export type TagOption = { tag: string; count: number };
export async function getClientTags(clientId: string): Promise<TagOption[]> {
  const { data, error } = await supabaseAdmin
    .from('ghl_contacts')
    .select('tags')
    .eq('location_id', clientId)
    .limit(1000);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const tags = Array.isArray(r.tags) ? r.tags : [];
    for (const t of tags) {
      if (typeof t === 'string' && t.trim()) {
        const k = t.trim();
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

// Distinct succeeded-transaction source names for a client — powers the deposit-source
// picker. These are GHL's payment "Source" values (e.g. "LP - £50 Skin Analysis").
export type SourceOption = { source: string; count: number };
export async function getClientTransactionSources(clientId: string): Promise<SourceOption[]> {
  const { data, error } = await supabaseAdmin
    .from('ghl_transactions')
    .select('entity_source_name')
    .eq('location_id', clientId)
    .eq('status', 'succeeded')
    .limit(5000);
  if (error) throw error;
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const s = typeof r.entity_source_name === 'string' ? r.entity_source_name.trim() : '';
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

// Active Meta campaigns for a client — powers the campaign-mapping picker.
export type CampaignOption = { source_id: string; name: string; status: string | null };
export async function getClientCampaigns(clientId: string): Promise<CampaignOption[]> {
  const { data, error } = await supabaseAdmin
    .from('meta_campaigns')
    .select('source_id, name, status')
    .eq('client_id', clientId)
    .eq('status', 'ACTIVE')
    .order('name');
  if (error) throw error;
  return (data ?? []).map(r => ({
    source_id: r.source_id,
    name: r.name ?? r.source_id,
    status: r.status ?? null,
  }));
}
