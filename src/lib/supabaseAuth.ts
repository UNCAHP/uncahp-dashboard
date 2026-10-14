import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Supabase client that carries the signed-in user's session in cookies. Server-only, and
// only used for auth calls (sign in, sign out, who is this) — data reads stay on the
// service-role client in ./supabase. The anon key is the right key here; the service-role
// fallback mirrors ./supabase so environments without SUPABASE_ANON_KEY still work, and
// never reaches the browser because nothing here runs client-side.
export const AUTH_KEY = () => process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export async function createAuthClient() {
  const store = await cookies();
  return createServerClient(process.env.SUPABASE_URL!, AUTH_KEY(), {
    cookies: {
      getAll: () => store.getAll(),
      // Server Components can't write cookies; the proxy refreshes the session instead, so
      // a failed write there is expected and safe to ignore.
      setAll: list => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch { /* called from a Server Component */ }
      },
    },
  });
}
