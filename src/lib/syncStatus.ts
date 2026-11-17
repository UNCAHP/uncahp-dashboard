import { supabaseAdmin } from './supabase';

// ─── Is the daily sync running right now? ────────────────────────────────────
// Backed by sync_runs / sync_run_clients (migration 0025). The cron dispatcher opens a
// run; each client's sync marks itself started and finished. Everything here fails soft:
// if the tables don't exist yet, or a write fails, the sync carries on and the dashboard
// simply shows no "syncing" state.

// A client sync can take up to ~13 min (sync-client maxDuration 800s). Past this, a run
// with unfinished clients is treated as over, so a crashed sync can't keep the banner up.
const RUN_WINDOW_MS = 20 * 60_000;

export type SyncStatus = {
  running: boolean;
  startedAt: string | null;
  total: number;
  done: number;
  pending: string[];        // client names still syncing
};

const IDLE: SyncStatus = { running: false, startedAt: null, total: 0, done: 0, pending: [] };

export async function startSyncRun(total: number): Promise<string | null> {
  const { data, error } = await supabaseAdmin.from('sync_runs').insert({ clients_total: total }).select('id').single();
  if (error) { console.warn('[sync] could not record run:', error.message); return null; }
  return (data as { id: string }).id;
}

export async function markClientStarted(runId: string | null, clientId: string, clientName: string | null) {
  if (!runId) return;
  const { error } = await supabaseAdmin.from('sync_run_clients')
    .upsert({ run_id: runId, client_id: clientId, client_name: clientName, started_at: new Date().toISOString(), finished_at: null, ok: null, error: null });
  if (error) console.warn('[sync] could not mark client started:', error.message);
}

export async function markClientFinished(runId: string | null, clientId: string, ok: boolean, err: string | null) {
  if (!runId) return;
  const { error } = await supabaseAdmin.from('sync_run_clients')
    .update({ finished_at: new Date().toISOString(), ok, error: err })
    .eq('run_id', runId)
    .eq('client_id', clientId);
  if (error) console.warn('[sync] could not mark client finished:', error.message);
}

export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    const since = new Date(Date.now() - RUN_WINDOW_MS).toISOString();
    const { data: run } = await supabaseAdmin.from('sync_runs')
      .select('id, started_at, clients_total')
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!run) return IDLE;
    const r = run as { id: string; started_at: string; clients_total: number };
    const { data: rows } = await supabaseAdmin.from('sync_run_clients')
      .select('client_id, client_name, finished_at')
      .eq('run_id', r.id);
    const list = (rows ?? []) as { client_id: string; client_name: string | null; finished_at: string | null }[];
    const done = list.filter(x => x.finished_at).length;
    const pending = list.filter(x => !x.finished_at).map(x => x.client_name ?? x.client_id);
    const total = Math.max(r.clients_total, list.length);
    return { running: done < total, startedAt: r.started_at, total, done, pending };
  } catch {
    return IDLE;
  }
}
