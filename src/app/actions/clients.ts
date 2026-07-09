'use server';

import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { supabaseAdmin } from '@/lib/supabase';

export type ActionState = { ok: boolean; error?: string };

// Logos render at ≤48px, so 128px covers retina. Downscaling keeps the embedded image
// tiny (~5KB WebP) regardless of the source size.
const LOGO_MAX_DIMENSION = 128;

const MAX_LOGO_BYTES = 15 * 1024 * 1024; // 15MB source cap

// Trim a form field down to a non-empty string, or null.
function field(fd: FormData, name: string): string | null {
  const v = (fd.get(name) ?? '').toString().trim();
  return v.length ? v : null;
}

// Keep the GHL sync's enrollment table (ghl_api_keys) in step with the registry, so
// adding/editing/archiving a client here also enrols it in the GHL data pull — no
// separate manual step. Best-effort: a failure here never blocks the client save.
async function upsertGhlEnrollment(opts: {
  location_id: string | null;
  location_name?: string | null;
  api_key?: string | null;   // only set when a (new) key is provided
  is_active?: boolean;       // only set when it should change (create / archive / restore)
}) {
  const { location_id } = opts;
  if (!location_id) return;
  try {
    const { data: existing } = await supabaseAdmin
      .from('ghl_api_keys')
      .select('id')
      .eq('location_id', location_id)
      .maybeSingle();

    const patch: Record<string, unknown> = {};
    if (opts.location_name != null) patch.location_name = opts.location_name;
    if (opts.api_key) patch.api_key = opts.api_key;
    if (opts.is_active != null) patch.is_active = opts.is_active;

    if (existing) {
      if (Object.keys(patch).length) {
        await supabaseAdmin.from('ghl_api_keys').update(patch).eq('location_id', location_id);
      }
    } else if (opts.api_key) {
      // No row yet — only worth creating once we actually have a key to sync with.
      await supabaseAdmin.from('ghl_api_keys').insert({
        id: crypto.randomUUID(),
        location_id,
        location_name: opts.location_name ?? null,
        api_key: opts.api_key,
        is_active: opts.is_active ?? true,
      });
    }
  } catch (e) {
    console.error('ghl_api_keys enrollment failed:', e);
  }
}

// Process a logo into a compact data URI stored directly in the DB (clients.logo_url).
// Embedding the image inline avoids Supabase Storage's CDN propagation delay, which was
// leaving freshly-uploaded logos showing as broken until a later hard refresh. Returns
// { url: null } when no file was provided so callers leave the existing logo untouched.
async function handleLogoUpload(fd: FormData): Promise<{ url: string | null; error?: string }> {
  const logo = fd.get('logo');
  if (!(logo instanceof File) || logo.size === 0) return { url: null };

  if (!logo.type.startsWith('image/')) return { url: null, error: 'Logo must be an image file.' };
  if (logo.size > MAX_LOGO_BYTES) return { url: null, error: 'Logo must be under 15MB.' };

  const input = Buffer.from(await logo.arrayBuffer());

  // Vectors scale perfectly and are already tiny — embed as-is.
  if (logo.type === 'image/svg+xml') {
    return { url: `data:image/svg+xml;base64,${input.toString('base64')}` };
  }

  try {
    const out = await sharp(input)
      .resize(LOGO_MAX_DIMENSION, LOGO_MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    return { url: `data:image/webp;base64,${out.toString('base64')}` };
  } catch {
    return { url: null, error: 'Could not read that image — please try a different file.' };
  }
}

export async function createClientAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const client_name = field(fd, 'client_name');
    if (!client_name) return { ok: false, error: 'Client name is required.' };

    const logo = await handleLogoUpload(fd);
    if (logo.error) return { ok: false, error: logo.error };

    const ghl_location_id = field(fd, 'ghl_location_id');
    const ghl_api_key = field(fd, 'ghl_api_key');

    const { error } = await supabaseAdmin.from('clients').insert({
      client_name,
      status: 'active',
      meta_ad_account_id: field(fd, 'meta_ad_account_id'),
      ghl_location_id,
      ghl_api_key,
      logo_url: logo.url,
      notes: field(fd, 'notes'),
    });

    if (error) return { ok: false, error: error.message };
    await upsertGhlEnrollment({ location_id: ghl_location_id, location_name: client_name, api_key: ghl_api_key, is_active: true });
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('createClientAction failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error creating client.' };
  }
}

export async function updateClientAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = field(fd, 'id');
    if (!id) return { ok: false, error: 'Missing client id.' };

    const client_name = field(fd, 'client_name');
    if (!client_name) return { ok: false, error: 'Client name is required.' };

    const ghl_location_id = field(fd, 'ghl_location_id');
    const patch: Record<string, unknown> = {
      client_name,
      meta_ad_account_id: field(fd, 'meta_ad_account_id'),
      ghl_location_id,
      notes: field(fd, 'notes'),
    };

    // Only overwrite the GHL key when a new value is entered — leaving the field blank
    // keeps the existing key (the UI never receives the current one).
    const newKey = field(fd, 'ghl_api_key');
    if (newKey) patch.ghl_api_key = newKey;

    // Same for the logo: only replace it when a new file is uploaded.
    const logo = await handleLogoUpload(fd);
    if (logo.error) return { ok: false, error: logo.error };
    if (logo.url) patch.logo_url = logo.url;

    const { error } = await supabaseAdmin.from('clients').update(patch).eq('id', id);
    if (error) return { ok: false, error: error.message };
    await upsertGhlEnrollment({ location_id: ghl_location_id, location_name: client_name, api_key: newKey });
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('updateClientAction failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error updating client.' };
  }
}

export async function setClientStatusAction(id: string, status: 'active' | 'archived'): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing client id.' };

  const { data: row, error } = await supabaseAdmin
    .from('clients')
    .update({ status, archived_at: status === 'archived' ? new Date().toISOString() : null })
    .eq('id', id)
    .select('ghl_location_id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  // Archiving pauses the GHL pull for this location; restoring re-enables it.
  await upsertGhlEnrollment({ location_id: row?.ghl_location_id ?? null, is_active: status === 'active' });
  revalidatePath('/');
  return { ok: true };
}
