import { supabaseAdmin } from './supabase';
import { replaceRows } from './replaceRows';
import { hasUnqualifiedTag, SPEED_SKIP_STAGES, stageKey } from './csrConstants';

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
  source?: string; tags?: string[]; dateAdded?: string; dateUpdated?: string; city?: string; country?: string;
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

// Opportunities newest first, with their stage names, back to OPP_DAYS ago. Best-effort:
// if the opportunities scope is off or a page fails, whatever was read is used.
const OPP_DAYS = 100;
type OppStage = { contactId: string | null; name: string; pipelineId: string; changedAt: string | null };
export async function getStages(locationId: string, key: string): Promise<OppStage[]> {
  const { status, j } = await ghlGet(`${V2}/opportunities/pipelines?locationId=${locationId}`, key);
  if (status !== 200) { console.warn(`[sync] ${locationId} pipelines ${status}: ${errMsg(j)}`); return []; }
  const names = new Map<string, string>();
  for (const pl of (j.pipelines ?? []) as { stages?: { id: string; name: string }[] }[])
    for (const st of pl.stages ?? []) names.set(st.id, st.name);

  const cutoff = new Date(Date.now() - OPP_DAYS * 86_400_000).toISOString();
  const out: OppStage[] = [];
  let next = `${V2}/opportunities/search?location_id=${locationId}&limit=100`;
  for (let guard = 0; guard < 200; guard++) {
    const r = await ghlGet(next, key);
    if (r.status !== 200) { console.warn(`[sync] ${locationId} opportunities ${r.status}: ${errMsg(r.j)}`); break; }
    const batch = (r.j.opportunities ?? []) as { contactId?: string; pipelineId?: string; pipelineStageId?: string; lastStageChangeAt?: string; createdAt?: string }[];
    for (const o of batch) out.push({
      contactId: o.contactId ?? null,
      name: names.get(o.pipelineStageId ?? '') ?? '',
      pipelineId: o.pipelineId ?? '',
      changedAt: o.lastStageChangeAt ?? o.createdAt ?? null,
    });
    const meta = (r.j.meta ?? {}) as { startAfter?: number; startAfterId?: string };
    const oldest = batch.at(-1)?.createdAt;
    if (batch.length < 100 || !meta.startAfterId || (oldest && oldest < cutoff)) break;
    next = `${V2}/opportunities/search?location_id=${locationId}&limit=100&startAfter=${meta.startAfter}&startAfterId=${meta.startAfterId}`;
  }
  return out;
}

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

  // What Speed to Lead needs to know about each contact, carried over from earlier syncs:
  //   unqualifiedSeenAt: when the "unqualified" tag was first seen (GHL doesn't date tags)
  //   stageSkip:         { manual | unqualified → when the lead was moved into that stage }
  type Kept = { unqualifiedSeenAt?: string; stageSkip?: Record<string, string> };
  const kept = new Map<string, Kept>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from('ghl_contacts')
      .select('source_id, seen:metadata->>unqualifiedSeenAt, skip:metadata->stageSkip')
      .eq('location_id', locationId)
      .or('metadata->>unqualifiedSeenAt.not.is.null,metadata->stageSkip.not.is.null')
      .order('id')
      .range(from, from + 999);
    if (error) { console.warn('[sync] earlier Speed to Lead dates not read:', error.message); break; }
    for (const r of (data ?? []) as { source_id: string; seen: string | null; skip: Record<string, string> | null }[])
      kept.set(r.source_id, { unqualifiedSeenAt: r.seen ?? undefined, stageSkip: r.skip ?? undefined });
    if (!data || data.length < 1000) break;
  }

  // Pipeline stage of each contact's newest opportunity, from the last ~100 days.
  const stages = await getStages(locationId, key);
  const stageOf = new Map<string, { name: string; pipelineId: string; changedAt: string | null }>();
  for (const o of stages) if (o.contactId && !stageOf.has(o.contactId)) stageOf.set(o.contactId, o);

  const speedMeta = (c: GhlContact) => {
    const prev = kept.get(c.id) ?? {};
    const out: Kept = {};
    if (hasUnqualifiedTag(c.tags)) out.unqualifiedSeenAt = prev.unqualifiedSeenAt ?? now;
    const skip = { ...(prev.stageSkip ?? {}) };
    const st = stageOf.get(c.id);
    const k = stageKey(st?.name);
    if (st && SPEED_SKIP_STAGES.includes(k) && !skip[k]) skip[k] = st.changedAt ?? now;
    if (Object.keys(skip).length) out.stageSkip = skip;
    return out;
  };

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
    pipeline_stage: stageOf.get(c.id)?.name ?? null,
    pipeline_id: stageOf.get(c.id)?.pipelineId ?? null,
    date_added: c.dateAdded ?? null,
    last_activity: null,
    metadata: {
      city: c.city ?? null, country: c.country ?? null, customFields: c.customFields ?? [],
      dateUpdated: c.dateUpdated ?? null,
      ...speedMeta(c),
    },
    _synced_at: now,
  }));

  // Full pull succeeded → safe to replace this client's contacts.
  // Old rows are put back if the new ones can't be written (see replaceRows).
  const { error: repC } = await replaceRows('ghl_contacts', [{ column: 'location_id', op: 'eq', value: locationId }], contactRows);
  if (repC) return { ok: false, error: repC };

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
    const { error: repT } = await replaceRows('ghl_transactions', [{ column: 'location_id', op: 'eq', value: locationId }], txRows);
    if (!repT) txCount = txRows.length;
  }

  return { ok: true, contacts: contactRows.length, transactions: txCount };
}
