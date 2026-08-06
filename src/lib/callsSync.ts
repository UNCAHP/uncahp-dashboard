import { supabaseAdmin } from './supabase';

// Pull GHL call events into csr_calls for the Call Tracking / Speed-to-Lead KPIs.
//
// GHL has no "list all calls" endpoint — calls are messages inside conversations. So we
// sweep conversations newest-first (they're ordered by last activity), stop once we pass
// the window, and pull each recent conversation's TYPE_CALL messages. This captures ALL
// dials in the window (needed for setter activity), not just calls to new leads.
// Upserts on the GHL message id, so re-running is safe.

const V2 = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

export type CallsSyncResult = {
  ok: boolean;
  error?: string;
  calls?: number;
  conversationsScanned?: number;
};

type GhlUser = { id: string; name?: string; firstName?: string; lastName?: string };
type Conversation = { id: string; contactId?: string; lastMessageDate?: string };
type Message = {
  id: string; messageType?: string; direction?: string; status?: string;
  dateAdded?: string; userId?: string; contactId?: string;
  meta?: { call?: { duration?: number } };
};

async function get(url: string, key: string): Promise<Record<string, unknown>> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Version: VERSION } });
  try { return (await r.json()) as Record<string, unknown>; } catch { return {}; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// GHL's /conversations/{id}/messages endpoint intermittently returns a TRANSIENT 401 under
// concurrent load, even when the token has the scope. Retry a few times with backoff before
// letting a 401 stand — otherwise a momentary blip gets misreported as a permanent
// "missing View Conversation Messages scope" and the client's calls are wrongly skipped.
async function getMessages(url: string, key: string): Promise<Record<string, unknown>> {
  let j: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    j = await get(url, key);
    if ((j.statusCode as number) !== 401) return j;
    if (attempt < 2) await sleep(250 * (attempt + 1)); // 250ms, 500ms — quick retries, ~0.75s max
  }
  return j; // still 401 after 3 tries → caller can treat it as a genuine scope gap
}

export async function syncClientCalls(locationId: string, days = 30): Promise<CallsSyncResult> {
  if (!locationId) return { ok: false, error: 'Missing client id.' };

  const { data: keyRow } = await supabaseAdmin
    .from('ghl_api_keys').select('api_key').eq('location_id', locationId).maybeSingle();
  const key = keyRow?.api_key;
  if (!key) return { ok: false, error: 'No GHL key enrolled for this client.' };

  // CSR names, so each call row can carry the name without a join.
  const uj = await get(`${V2}/users/?locationId=${locationId}`, key);
  if (uj.error || (uj.statusCode as number) === 401) return { ok: false, error: 'GHL users: not authorized (check token scopes).' };
  const users = (uj.users ?? []) as GhlUser[];
  const userName = new Map(users.map(u => [u.id, u.name || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()]));

  const sinceMs = Date.now() - days * 86_400_000;
  const now = new Date().toISOString();

  // Conversations active in the window (newest-first). Stop once we pass the window.
  const convIds: string[] = [];
  let cursor: string | null = null;
  let convScanned = 0;
  outer: for (let page = 0; page < 200; page++) {
    const url = `${V2}/conversations/search?locationId=${locationId}&limit=100${cursor ? `&startAfterDate=${cursor}` : ''}`;
    const j = await get(url, key);
    const cs = (j.conversations ?? []) as Conversation[];
    if (cs.length === 0) break;
    for (const c of cs) {
      convScanned++;
      const last = c.lastMessageDate ? Date.parse(c.lastMessageDate) : 0;
      if (last && last < sinceMs) break outer; // ordered desc → everything after is older
      convIds.push(c.id);
    }
    cursor = cs[cs.length - 1]?.lastMessageDate ?? null;
    if (cs.length < 100 || !cursor) break;
  }

  // Pull each recent conversation's CALL messages (the ?type filter keeps responses tiny).
  // Concurrency-limited to stay under GHL's ~10 req/s ceiling. Even so, a busy client's
  // full 30-day history is minutes of requests — the daily cron uses a short window so it
  // stays fast and csr_calls accumulates over time.
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const CONC = 5;
  for (let i = 0; i < convIds.length; i += CONC) {
    const batch = convIds.slice(i, i + CONC);
    const results = await Promise.all(batch.map(convId =>
      getMessages(`${V2}/conversations/${convId}/messages?type=TYPE_CALL`, key)));
    // Reading a conversation's messages needs its own scope ("View Conversation Messages" /
    // conversations/message.readonly). A token can pass the conversations *search* above but
    // still get 401 here. getMessages() already retried transient 401s, so a 401 that
    // survives here is a genuine missing-scope gap — surface it so it's fixable.
    if (results.some(mj => (mj.statusCode as number) === 401)) {
      return { ok: false, error: "GHL token is missing the 'View Conversation Messages' scope — add it to this client's Private Integration Token, then sync again." };
    }
    for (const mj of results) {
      const msgs = ((mj.messages as { messages?: Message[] })?.messages ?? []) as Message[];
      for (const m of msgs) {
        if (String(m.messageType ?? '').toUpperCase() !== 'TYPE_CALL') continue;
        if (!m.id || seen.has(m.id)) continue;
        if (m.dateAdded && Date.parse(m.dateAdded) < sinceMs) continue;
        seen.add(m.id);
        rows.push({
          location_id: locationId,
          source_id: m.id,
          contact_source_id: m.contactId ?? null,
          user_id: m.userId ?? null,
          user_name: m.userId ? (userName.get(m.userId) ?? null) : null,
          direction: m.direction ?? null,
          status: m.status ?? null,
          duration_sec: m.meta?.call?.duration ?? null,
          call_at: m.dateAdded ?? null,
          _synced_at: now,
        });
      }
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('csr_calls').upsert(rows.slice(i, i + 500), { onConflict: 'source_id' });
    if (error) return { ok: false, error: `Writing calls failed: ${error.message}` };
  }

  return { ok: true, calls: rows.length, conversationsScanned: convScanned };
}
