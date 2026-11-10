import { supabaseAdmin } from './supabase';
import { getActiveClients } from './queries';

// ─── Client Map: where every active client's clinic is ───────────────────────
// The address is the one on the client's GHL sub-account (Settings → Business Profile),
// read with the client's GHL key and cached for a day. The postcode is turned into a map
// position with postcodes.io (free, UK only, no key), cached for 30 days. Nothing is
// stored: fix an address in GHL and the pin moves within a day. A client whose GHL key
// can't read its location, or whose postcode isn't recognised, is listed as not on the map.

const GHL = 'https://services.leadconnectorhq.com';
const DAY = 86_400;

export type ClientPin = {
  client_id: string;
  client_name: string;
  logo_url: string | null;
  csr_key: string | null;
  segment: 'b2c' | 'b2b';
  address: string;
  city: string;
  postcode: string;
  lat: number;
  lng: number;
  approx: boolean;   // placed by the postcode district only (full postcode not recognised)
};

export type ClientMapData = {
  pins: ClientPin[];
  missing: { client_id: string; client_name: string; reason: string }[];
};

type GhlLocation = { address?: string; city?: string; postalCode?: string; country?: string };

async function ghlLocation(locationId: string, key: string): Promise<GhlLocation | null> {
  try {
    const r = await fetch(`${GHL}/locations/${locationId}`, {
      headers: { Authorization: `Bearer ${key}`, Version: '2021-07-28' },
      next: { revalidate: DAY },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { location?: GhlLocation };
    return j.location ?? null;
  } catch {
    return null;
  }
}

type Point = { lat: number; lng: number; approx: boolean };

async function geocode(postcode: string): Promise<Point | null> {
  const pc = postcode.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!pc) return null;
  const get = async (path: string) => {
    try {
      const r = await fetch(`https://api.postcodes.io${path}`, { next: { revalidate: 30 * DAY } });
      if (!r.ok) return null;
      const j = (await r.json()) as { result?: { latitude?: number | null; longitude?: number | null } };
      const { latitude, longitude } = j.result ?? {};
      return typeof latitude === 'number' && typeof longitude === 'number' ? { lat: latitude, lng: longitude } : null;
    } catch {
      return null;
    }
  };
  const full = await get(`/postcodes/${encodeURIComponent(pc)}`);
  if (full) return { ...full, approx: false };
  // A mistyped or brand-new postcode: fall back to its district ("SS9 1AE" → "SS9").
  const outcode = pc.split(' ')[0];
  const area = outcode && outcode !== pc ? await get(`/outcodes/${encodeURIComponent(outcode)}`) : null;
  return area ? { ...area, approx: true } : null;
}

export async function getClientMap(): Promise<ClientMapData> {
  const clients = await getActiveClients();
  const ids = clients.map(c => c.client_id);
  const { data: keys } = await supabaseAdmin
    .from('ghl_api_keys')
    .select('location_id, api_key, is_active')
    .in('location_id', ids);
  // Prefer the active key; a switched-off one can often still read the business address.
  const keyFor = new Map<string, string>();
  for (const k of (keys ?? []) as { location_id: string; api_key: string | null; is_active: boolean }[]) {
    if (!k.api_key) continue;
    if (k.is_active || !keyFor.has(k.location_id)) keyFor.set(k.location_id, k.api_key);
  }

  const results = await Promise.all(clients.map(async c => {
    const key = keyFor.get(c.client_id);
    if (!key) return { c, reason: 'No GHL key on file' };
    const loc = await ghlLocation(c.client_id, key);
    if (!loc) return { c, reason: "GHL key can't read the business address" };
    const postcode = (loc.postalCode ?? '').trim();
    if (!postcode) return { c, reason: 'No postcode in GHL' };
    const pt = await geocode(postcode);
    if (!pt) return { c, reason: `Postcode "${postcode}" not recognised` };
    const pin: ClientPin = {
      client_id: c.client_id,
      client_name: c.client_name,
      logo_url: c.logo_url ?? null,
      csr_key: c.csr_key ?? null,
      segment: c.segment ?? 'b2c',
      address: (loc.address ?? '').trim(),
      city: (loc.city ?? '').trim(),
      postcode: postcode.toUpperCase(),
      ...pt,
    };
    return { c, pin };
  }));

  const pins: ClientPin[] = [];
  const missing: ClientMapData['missing'] = [];
  for (const r of results) {
    if ('pin' in r && r.pin) pins.push(r.pin);
    else missing.push({ client_id: r.c.client_id, client_name: r.c.client_name, reason: 'reason' in r ? r.reason ?? '' : '' });
  }
  return { pins, missing };
}
