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

export async function createFunnelAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const client_id = field(fd, 'client_id');
    const name = field(fd, 'name');
    if (!client_id) return { ok: false, error: 'Pick a client for this funnel.' };
    if (!name) return { ok: false, error: 'Funnel name is required.' };

    const { error } = await supabaseAdmin.from('funnels').insert({
      client_id,
      name,
      status: 'active',
      optin_tags: parseTags(field(fd, 'optin_tags')),
      deposit_tags: parseTags(field(fd, 'deposit_tags')),
      deposit_sources: parseTags(field(fd, 'deposit_sources')),
      setter_sources: parseTags(field(fd, 'setter_sources')),
      meta_campaign_ids: parseCsv(field(fd, 'meta_campaign_ids')),
      pages: parsePages(field(fd, 'pages')),
    });
    if (error) return { ok: false, error: error.message };
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

    const { error } = await supabaseAdmin.from('funnels').update({
      client_id,
      name,
      optin_tags: parseTags(field(fd, 'optin_tags')),
      deposit_tags: parseTags(field(fd, 'deposit_tags')),
      deposit_sources: parseTags(field(fd, 'deposit_sources')),
      setter_sources: parseTags(field(fd, 'setter_sources')),
      meta_campaign_ids: parseCsv(field(fd, 'meta_campaign_ids')),
      pages: parsePages(field(fd, 'pages')),
    }).eq('id', id);
    if (error) return { ok: false, error: error.message };
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
