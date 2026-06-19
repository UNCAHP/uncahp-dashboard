import { createClient } from '@supabase/supabase-js';

// Prefer the anon key (read-only via RLS policies). SERVICE_ROLE_KEY is kept as
// a fallback only so existing Vercel envs don't break during the swap — once
// SUPABASE_ANON_KEY is set everywhere, the service role key can be removed.
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set');
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
