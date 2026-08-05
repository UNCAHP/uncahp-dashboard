'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getClientTags, getClientCampaigns, getClientTransactionSources,
  type TagOption, type CampaignOption, type SourceOption, type FunnelPageLink,
} from '@/lib/funnelAdmin';

export type ActionState = { ok: boolean; error?: string };

function field(fd: FormData, name: string): string | null {
  const v = (fd.get(name) ?? '').toString().trim();
  return v.length ? v : null;
}

// Pages arrive as a JSON string from a hidden input (the form builds the list client-side).
function parsePages(raw: string | null): FunnelPageLink[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p: unknown) => (p && typeof p === 'object' ? p as Record<string, unknown> : null))
      .filter((p): p is Record<string, unknown> => !!p)
      .map(p => ({ name: String(p.name ?? '').trim(), url: String(p.url ?? '').trim() }))
      .filter(p => p.name || p.url);
  } catch {
    return [];
  }
}

// Campaign ids arrive as a comma-separated hidden input.
function parseCsv(raw: string | null): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// Tags arrive as a JSON string array (comma-safe, since tags may contain commas).
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map(t => String(t).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function slugify(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

// Tracking config from the form. Two levels:
//   • first-party tracking ON, no split → single "default" bucket, split_status 'off'.
//     (backup landing-page-view/opt-in/deposit data, independent of Meta.)
//   • first-party tracking ON + split test → 2+ variants, split_status running/decided.
// Off entirely → no track_key.
function splitFields(fd: FormData): { track_key: string | null; variants: { key: string; label: string }[]; split_status: 'off' | 'running' | 'decided' } {
  const trackingEnabled = field(fd, 'tracking_enabled') === '1';
  const splitEnabled = field(fd, 'split_enabled') === '1';
  const track_key = slugify(field(fd, 'track_key') ?? '');

  const variants: { key: string; label: string }[] = [];
  try {
    const arr = JSON.parse(field(fd, 'variants') ?? '[]');
    if (Array.isArray(arr)) {
      const seen = new Set<string>();
      for (const v of arr) {
        if (!v || typeof v !== 'object') continue;
        const key = slugify(String((v as Record<string, unknown>).key ?? ''));
        const label = String((v as Record<string, unknown>).label ?? '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        variants.push({ key, label: label || key.toUpperCase() });
      }
    }
  } catch { /* ignore */ }

  if (!trackingEnabled || !track_key) {
    return { track_key: null, variants: [], split_status: 'off' };
  }
  if (splitEnabled && variants.length >= 2) {
    const statusRaw = field(fd, 'split_status') ?? 'running';
    const split_status = (['running', 'decided'].includes(statusRaw) ? statusRaw : 'running') as 'running' | 'decided';
    return { track_key, variants, split_status };
  }
  // Tracking only (measure) — one bucket, no test.
  return { track_key, variants: [{ key: 'default', label: 'All visitors' }], split_status: 'off' };
}

type SplitCfg = { track_key: string | null; variants: { key: string; label: string }[]; split_status: 'off' | 'running' | 'decided' };

function writeError(error: { message: string } | null): ActionState | null {
  if (!error) return null;
  if (/duplicate key|unique/i.test(error.message)) {
    return { ok: false, error: 'That split-test key is already used by another funnel — pick a different one.' };
  }
  return { ok: false, error: error.message };
}

// Write the funnel with split-test columns; if they don't exist yet (migration 0011 not
// run), retry without them so normal funnel creation/editing still works.
const MISSING_COL = /track_key|variants|split_status|schema cache|column/i;

async function insertFunnel(base: Record<string, unknown>, split: SplitCfg): Promise<ActionState | null> {
  let { error } = await supabaseAdmin.from('funnels').insert({ ...base, ...split });
  if (error && MISSING_COL.test(error.message)) ({ error } = await supabaseAdmin.from('funnels').insert(base));
  return writeError(error);
}

async function updateFunnel(id: string, base: Record<string, unknown>, split: SplitCfg): Promise<ActionState | null> {
  let { error } = await supabaseAdmin.from('funnels').update({ ...base, ...split }).eq('id', id);
  if (error && MISSING_COL.test(error.message)) ({ error } = await supabaseAdmin.from('funnels').update(base).eq('id', id));
  return writeError(error);
}

export async function createFunnelAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const client_id = field(fd, 'client_id');
    const name = field(fd, 'name');
    if (!client_id) return { ok: false, error: 'Pick a client for this funnel.' };
    if (!name) return { ok: false, error: 'Funnel name is required.' };

    const base = {
      client_id,
      name,
      status: 'active',
      optin_tags: parseTags(field(fd, 'optin_tags')),
      deposit_tags: parseTags(field(fd, 'deposit_tags')),
      deposit_sources: parseTags(field(fd, 'deposit_sources')),
      setter_sources: parseTags(field(fd, 'setter_sources')),
      meta_campaign_ids: parseCsv(field(fd, 'meta_campaign_ids')),
      pages: parsePages(field(fd, 'pages')),
    };
    const split = splitFields(fd);
    const err = await insertFunnel(base, split);
    if (err) return err;
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('createFunnelAction failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error creating funnel.' };
  }
}

export async function updateFunnelAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = field(fd, 'id');
    if (!id) return { ok: false, error: 'Missing funnel id.' };
    const client_id = field(fd, 'client_id');
    const name = field(fd, 'name');
    if (!client_id) return { ok: false, error: 'Pick a client for this funnel.' };
    if (!name) return { ok: false, error: 'Funnel name is required.' };

    const base = {
      client_id,
      name,
      optin_tags: parseTags(field(fd, 'optin_tags')),
      deposit_tags: parseTags(field(fd, 'deposit_tags')),
      deposit_sources: parseTags(field(fd, 'deposit_sources')),
      setter_sources: parseTags(field(fd, 'setter_sources')),
      meta_campaign_ids: parseCsv(field(fd, 'meta_campaign_ids')),
      pages: parsePages(field(fd, 'pages')),
    };
    const split = splitFields(fd);
    const err = await updateFunnel(id, base, split);
    if (err) return err;
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('updateFunnelAction failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error updating funnel.' };
  }
}

export async function setFunnelStatusAction(id: string, status: 'active' | 'archived'): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing funnel id.' };
  const { error } = await supabaseAdmin
    .from('funnels')
    .update({ status, archived_at: status === 'archived' ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

// Permanently remove a funnel from the dashboard registry. This deletes only the funnel
// configuration row — the underlying GHL/Meta data is untouched. Not reversible (unlike
// archiving, which just hides it under the Inactive tab).
export async function deleteFunnelAction(id: string): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing funnel id.' };
  const { error } = await supabaseAdmin.from('funnels').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

// Called from the form when a client is chosen, to populate the tag + campaign pickers.
export async function loadFunnelFormData(clientId: string): Promise<{ tags: TagOption[]; campaigns: CampaignOption[]; sources: SourceOption[] }> {
  if (!clientId) return { tags: [], campaigns: [], sources: [] };
  const [tags, campaigns, sources] = await Promise.all([
    getClientTags(clientId),
    getClientCampaigns(clientId),
    getClientTransactionSources(clientId),
  ]);
  return { tags, campaigns, sources };
}
