import { supabaseAdmin } from './supabase';

// Swap one client's rows in a synced table for a fresh copy, without ever leaving the
// client with nothing.
//
// The syncs used to delete a client's rows and then insert the new ones. When an insert
// failed (the database is busiest at 06:00, when every client syncs at once), the delete
// had already gone through: on 23–24 Nov seven clients lost every Meta stat since August
// and the funnels showed 0 LP views. Now:
//   1. the rows being replaced are read and kept in memory,
//   2. they're deleted and the new rows inserted, each batch retried a few times,
//   3. if the new rows still can't be written, the partial write is removed and the old
//      rows are put back, and the error is returned.
// Works whatever unique constraints the table has, since old and new rows never coexist.

type Filter = { column: string; op: 'eq' | 'gte'; value: string };

const BATCH = 500;
const WAITS_MS = [0, 2000, 5000, 10000];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped(q: any, filters: Filter[]) {
  for (const f of filters) q = f.op === 'eq' ? q.eq(f.column, f.value) : q.gte(f.column, f.value);
  return q;
}

async function insertAll(table: string, rows: Record<string, unknown>[]): Promise<string | null> {
  for (let i = 0; i < rows.length; i += BATCH) {
    let last: string | null = null;
    for (const wait of WAITS_MS) {
      if (wait) await sleep(wait);
      const { error } = await supabaseAdmin.from(table).insert(rows.slice(i, i + BATCH));
      if (!error) { last = null; break; }
      last = error.message;
    }
    if (last) return last;
  }
  return null;
}

export async function replaceRows(table: string, filters: Filter[], rows: Record<string, unknown>[]): Promise<{ error: string | null }> {
  // 1. Keep what's there now.
  const old: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await scoped(supabaseAdmin.from(table).select('*'), filters).order('id').range(from, from + 999);
    if (error) return { error: `Reading current ${table} failed: ${error.message}` };
    old.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }

  // 2. Replace.
  const { error: delErr } = await scoped(supabaseAdmin.from(table).delete(), filters);
  if (delErr) return { error: `Clearing ${table} failed: ${delErr.message}` };
  const insErr = await insertAll(table, rows);
  if (!insErr) return { error: null };

  // 3. Couldn't write the new rows: put the old ones back.
  await scoped(supabaseAdmin.from(table).delete(), filters);
  const restoreErr = await insertAll(table, old);
  console.error(`[sync] ${table}: new rows failed (${insErr}); previous rows ${restoreErr ? `NOT restored: ${restoreErr}` : 'restored'}`);
  return { error: `Writing ${table} failed: ${insErr}${restoreErr ? ` — and restoring the previous rows failed: ${restoreErr}` : ' (previous data kept)'}` };
}
