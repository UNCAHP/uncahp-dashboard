import { supabaseAdmin } from './supabase';

// Row shape returned to the UI. NOTE: the raw ghl_api_key is never included — only
// whether one is set and a short masked hint. The secret stays server-side.
export type AdminClientRow = {
  id: string;
  client_name: string;
  status: 'active' | 'archived';
  meta_ad_account_id: string | null;
  ghl_location_id: string | null;
  ghl_api_key_set: boolean;
  ghl_api_key_hint: string | null; // e.g. "••••4a2f"
  logo_url: string | null;
  notes: string | null;
  segment: 'b2c' | 'b2b';
  created_at: string;
  archived_at: string | null;
};

function maskKey(key: string | null): string | null {
  if (!key) return null;
  const last = key.slice(-4);
  return `••••${last}`;
}

export async function getAdminClients(): Promise<AdminClientRow[]> {
  const base = 'id, client_name, status, meta_ad_account_id, ghl_location_id, ghl_api_key, logo_url, notes, created_at, archived_at';
  const q = (sel: string) => supabaseAdmin
    .from('clients')
    .select(sel)
    .order('status', { ascending: true }) // active before archived
    .order('client_name', { ascending: true });
  // segment arrives with migration 0017; fall back without it so the page still loads before it's run.
  let res = await q(base + ', segment');
  if (res.error) res = await q(base);
  if (res.error) throw res.error;
  const data = (res.data ?? []) as unknown as Record<string, unknown>[];

  return data.map(r => ({
    id: r.id as string,
    client_name: (r.client_name as string) ?? '',
    status: (r.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
    meta_ad_account_id: (r.meta_ad_account_id as string | null) ?? null,
    ghl_location_id: (r.ghl_location_id as string | null) ?? null,
    ghl_api_key_set: Boolean(r.ghl_api_key),
    ghl_api_key_hint: maskKey((r.ghl_api_key as string | null) ?? null),
    logo_url: (r.logo_url as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    segment: (r.segment === 'b2b' ? 'b2b' : 'b2c') as 'b2c' | 'b2b',
    created_at: r.created_at as string,
    archived_at: (r.archived_at as string | null) ?? null,
  }));
}
