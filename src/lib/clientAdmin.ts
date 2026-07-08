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
  created_at: string;
  archived_at: string | null;
};

function maskKey(key: string | null): string | null {
  if (!key) return null;
  const last = key.slice(-4);
  return `••••${last}`;
}

export async function getAdminClients(): Promise<AdminClientRow[]> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id, client_name, status, meta_ad_account_id, ghl_location_id, ghl_api_key, logo_url, notes, created_at, archived_at')
    .order('status', { ascending: true }) // active before archived
    .order('client_name', { ascending: true });

  if (error) throw error;

  return (data ?? []).map(r => ({
    id: r.id,
    client_name: r.client_name ?? '',
    status: (r.status === 'archived' ? 'archived' : 'active') as 'active' | 'archived',
    meta_ad_account_id: r.meta_ad_account_id ?? null,
    ghl_location_id: r.ghl_location_id ?? null,
    ghl_api_key_set: Boolean(r.ghl_api_key),
    ghl_api_key_hint: maskKey(r.ghl_api_key ?? null),
    logo_url: r.logo_url ?? null,
    notes: r.notes ?? null,
    created_at: r.created_at,
    archived_at: r.archived_at ?? null,
  }));
}
