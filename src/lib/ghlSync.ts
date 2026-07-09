import { supabaseAdmin } from './supabase';

// Direct GHL → Supabase sync for a single client, using that client's Private
// Integration Token (pit-…) stored in ghl_api_keys. Mirrors what the external pipeline
// writes into ghl_contacts / ghl_transactions, so a freshly-added client can pull its
// contacts + deposits on demand instead of waiting for the daily run.
//
// Non-destructive on failure: contacts are fully fetched into memory first, and only
// replaced once the whole pull succeeds. Transactions are best-effort (the payments
// scope may be off) and only replaced when they were actually fetched.

const V2 = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

export type GhlSyncResult = {
  ok: boolean;
  error?: string;
  contacts?: number;
  transactions?: number;
};

type GhlContact = {
  id: string; firstName?: string; lastName?: string; email?: string; phone?: string;
  source?: string; tags?: string[]; dateAdded?: string; city?: string; country?: string;
  customFields?: unknown[];
};
type GhlTxn = {
  _id: string; contactId?: string; contactName?: string; contactEmail?: string;
  currency?: string; amount?: number; status?: string; entityType?: string;
  entitySourceType?: string; entitySourceId?: string; entitySourceName?: string;
  entitySourceSubType?: string; chargeId?: string; liveMode?: boolean;
  createdAt?: string; chargeSnapshot?: { created?: number };
};

async function ghlGet(url: string, key: string): Promise<{ status: number; j: Record<string, unknown> }> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Version: VERSION } });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}
const errMsg = (j: Record<string, unknown>) => (j.message ?? j.msg ?? 'error') as string;

export async function syncClientGhl(locationId: string): Promise<GhlSyncResult> {
  if (!locationId) return { ok: false, error: 'Missing client id.' };

  const { data: keyRow } = await supabaseAdmin
    .from('ghl_api_keys')
    .select('api_key')
    .eq('location_id', locationId)
    .maybeSingle();
  const key = keyRow?.api_key;
  if (!key) return { ok: false, error: 'No GHL key enrolled for this client.' };

  const now = new Date().toISOString();

  // ── Contacts: full pull, cursor pagination (fetch all before writing) ──
  const contacts: GhlContact[] = [];
  let startAfter: string | null = null;
  let startAfterId: string | null = null;
  let guard = 0;
  for (;;) {
    let url = `${V2}/contacts/?locationId=${locationId}&limit=100`;
    if (startAfterId) url += `&startAfterId=${startAfterId}`;
    if (startAfter) url += `&startAfter=${startAfter}`;
    const { status, j } = await ghlGet(url, key);
    if (status !== 200) return { ok: false, error: `GHL contacts ${status}: ${errMsg(j)}` };
    const batch = (j.contacts ?? []) as GhlContact[];
    contacts.push(...batch);
    const meta = (j.meta ?? {}) as { startAfter?: string; startAfterId?: string };
    if (batch.length < 100 || !meta.startAfterId || guard++ > 300) break;
    startAfter = meta.startAfter ?? null;
    startAfterId = meta.startAfterId ?? null;
  }

  const contactRows = contacts.map(c => ({
    id: crypto.randomUUID(),
    source_id: c.id,
    location_id: locationId,
    first_name: c.firstName ?? null,
    last_name: c.lastName ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    source: c.source ?? null,
    tags: Array.isArray(c.tags) ? c.tags : [],
    pipeline_stage: null,
    pipeline_id: null,
    date_added: c.dateAdded ?? null,
    last_activity: null,
    metadata: { city: c.city ?? null, country: c.country ?? null, customFields: c.customFields ?? [] },
    _synced_at: now,
  }));

  // Full pull succeeded → safe to replace this client's contacts.
  const { error: delC } = await supabaseAdmin.from('ghl_contacts').delete().eq('location_id', locationId);
  if (delC) return { ok: false, error: `Clearing contacts failed: ${delC.message}` };
  for (let i = 0; i < contactRows.length; i += 500) {
    const { error } = await supabaseAdmin.from('ghl_contacts').insert(contactRows.slice(i, i + 500));
    if (error) return { ok: false, error: `Writing contacts failed: ${error.message}` };
  }

  // ── Transactions: offset pagination, best-effort (payments scope may be off) ──
  const txns: GhlTxn[] = [];
  let offset = 0;
  let txnOk = true;
  for (;;) {
    const { status, j } = await ghlGet(`${V2}/payments/transactions?altId=${locationId}&altType=location&limit=100&offset=${offset}`, key);
    if (status !== 200) { txnOk = false; break; }
    const batch = (j.data ?? []) as GhlTxn[];
    txns.push(...batch);
    offset += batch.length;
    const total = (j.totalCount as number) ?? 0;
    if (batch.length < 100 || offset >= total || offset > 20000) break;
  }

  let txCount = 0;
  if (txnOk && txns.length > 0) {
    const cents = (v: unknown) => (v == null ? 0 : Math.round(Number(v) * 100));
    const txRows = txns.map(t => ({
      id: crypto.randomUUID(),
      source_id: t._id,
      location_id: locationId,
      contact_source_id: t.contactId ?? null,
      contact_name: t.contactName ?? null,
      contact_email: t.contactEmail ?? null,
      amount_cents: cents(t.amount),
      currency: t.currency ?? null,
      status: t.status ?? null,
      entity_type: t.entityType ?? null,
      entity_source_type: t.entitySourceType ?? null,
      entity_source_id: t.entitySourceId ?? null,
      entity_source_name: t.entitySourceName ?? null,
      step_id: null,
      page_id: null,
      charge_id: t.chargeId ?? null,
      charge_created_at: t.createdAt ?? (t.chargeSnapshot?.created ? new Date(t.chargeSnapshot.created * 1000).toISOString() : null),
      metadata: { liveMode: t.liveMode ?? null, entitySourceSubType: t.entitySourceSubType ?? null },
      _synced_at: now,
    }));
    const { error: delT } = await supabaseAdmin.from('ghl_transactions').delete().eq('location_id', locationId);
    if (!delT) {
      let wrote = true;
      for (let i = 0; i < txRows.length && wrote; i += 500) {
        const { error } = await supabaseAdmin.from('ghl_transactions').insert(txRows.slice(i, i + 500));
        if (error) wrote = false;
      }
      if (wrote) txCount = txRows.length;
    }
  }

  return { ok: true, contacts: contactRows.length, transactions: txCount };
}
