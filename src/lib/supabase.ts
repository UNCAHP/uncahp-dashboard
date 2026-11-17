import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;

// Anon client for public data reads (meta_*, ghl_* have RLS read policies).
// SERVICE_ROLE_KEY is kept as a fallback only so existing Vercel envs don't break
// during the swap — once SUPABASE_ANON_KEY is set everywhere, it wins.
const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set');
}

// Reads that hit Postgres's statement timeout (code 57014) are retried after a short wait
// instead of failing the page. They happen when someone loads the dashboard while the
// daily sync is writing every client's data at once (06:00 UTC): the read queues behind
// the writes, runs out of time, and the whole page used to show an error. Only reads
// (GET/HEAD) are retried, so a write is never sent twice.
const RETRY_WAITS_MS = [1500, 4000, 8000];
const retryingFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  let res = await fetch(input, init);
  if (method !== 'GET' && method !== 'HEAD') return res;
  for (const wait of RETRY_WAITS_MS) {
    if (res.status < 500) return res;
    const body = await res.clone().text().catch(() => '');
    if (!body.includes('57014')) return res;
    await new Promise(r => setTimeout(r, wait));
    res = await fetch(input, init);
  }
  return res;
};

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
  global: { fetch: retryingFetch },
});

// Service-role client for ADMIN operations only: the RLS-locked registry tables
// (clients, funnels), all writes, and Storage uploads. Server-side only — the
// service-role key must never reach the browser. Falls back to the anon client if
// the key isn't set, in which case those admin/registry features will fail with
// permission errors (set SUPABASE_SERVICE_ROLE_KEY to enable them).
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = serviceKey
  ? createClient(url, serviceKey, { auth: { persistSession: false }, global: { fetch: retryingFetch } })
  : supabase;
