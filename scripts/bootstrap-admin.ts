// One-off: give the first admin access to the dashboard.
//
//   npx tsx --tsconfig tsconfig.json scripts/bootstrap-admin.ts <email> <dashboard-origin> <out-file>
//
// Creates the Supabase Auth account if needed, makes it an admin in user_profiles, and
// writes a one-time sign-in link to <out-file> (not the terminal — the link is a sign-in
// credential). Open it to choose a password. After this, invite everyone else from the
// Admin Panel. Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
import { writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const [email, originArg, outFile] = process.argv.slice(2);
  if (!email || !originArg || !outFile) throw new Error('usage: bootstrap-admin.ts <email> <origin> <out-file>');
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  let res = await db.auth.admin.generateLink({ type: 'invite', email });
  let type = 'invite';
  if (res.error && /already|registered|exists/i.test(res.error.message)) {
    res = await db.auth.admin.generateLink({ type: 'recovery', email });
    type = 'recovery';
  }
  if (res.error || !res.data.user) throw new Error(res.error?.message ?? 'no user');

  const { error } = await db.from('user_profiles').upsert(
    { user_id: res.data.user.id, email: email.toLowerCase(), role_key: 'admin', active: true },
    { onConflict: 'user_id' },
  );
  if (error) throw new Error(error.message);

  const link = `${originArg.replace(/\/+$/, '')}/auth/confirm?token_hash=${encodeURIComponent(res.data.properties.hashed_token)}&type=${type}`;
  writeFileSync(outFile, link + '\n', { mode: 0o600 });
  console.log(`${email} is an admin (${type} link written to ${outFile}).`);
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
