import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;

// Anon client for public data reads (meta_*, ghl_* have RLS read policies).
// SERVICE_ROLE_KEY is kept as a fallback only so existing Vercel envs don't break
// during the swap — once SUPABASE_ANON_KEY is set everywhere, it wins.
const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

// Service-role client for ADMIN operations only: the RLS-locked registry tables
// (clients, funnels), all writes, and Storage uploads. Server-side only — the
// service-role key must never reach the browser. Falls back to the anon client if
// the key isn't set, in which case those admin/registry features will fail with
// permission errors (set SUPABASE_SERVICE_ROLE_KEY to enable them).
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabaseAdmin = serviceKey
  ? createClient(url, serviceKey, { auth: { persistSession: false } })
  : supabase;
