import { supabaseAdmin } from './supabase';
import { clientLocation, geocode } from './clientMap';
import {
  MAX_PAGES, SEARCH_CREDITS, PAGE_CREDITS, median, headline,
  type CompetitorPrice, type CompetitorScan, type CompetitorScanDetail,
} from './competitorsShared';

export * from './competitorsShared';

// ─── Competitors: what clinics near a client charge for a treatment ──────────
// On demand only — each scan spends Firecrawl credits (FIRECRAWL_API_KEY):
//   1. SEARCH  "<treatment> price <town>" in the UK (2 credits for up to 10 results).
//   2. FILTER  the client's own site, duplicate domains and sites that aren't clinics
//              (directories, news, forums) are dropped before anything is paid for.
//   3. READ    each remaining page with Firecrawl's JSON extraction (5 credits a page):
//              the clinic's name, postcode and its prices for this treatment only.
//   4. PLACE   each clinic by postcode (postcodes.io) and drop those outside the radius.
// The scan and its prices are saved (competitor_scans / competitor_prices, 0024) so it's
// paid for once.

const FC = 'https://api.firecrawl.dev/v2';
const SEARCH_LIMIT = 10;
// Sites that list or review clinics rather than being one. Booking marketplaces
// (Treatwell, Fresha) stay in: their pages carry a real clinic's real prices.
const NOT_A_CLINIC = [
  'google.', 'facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'reddit.com', 'twitter.com', 'x.com',
  'linkedin.com', 'pinterest.', 'wikipedia.org', 'nhs.uk', 'yell.com', 'yelp.', 'tripadvisor.', 'trustpilot.com',
  'whatclinic.com', 'mumsnet.com', 'bbc.co.uk', 'theguardian.com', 'dailymail.co.uk', 'independent.co.uk',
  'telegraph.co.uk', 'thetimes.co.uk', 'cosmopolitan.com', 'vogue.co.uk', 'glamourmagazine.co.uk', 'amazon.',
  'groupon.', 'wowcher.', 'indeed.', 'gumtree.com', 'save-face.co.uk', 'jccp.org.uk', 'cqc.org.uk',
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const domainOf = (u: string): string => {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
};

function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ── Firecrawl ────────────────────────────────────────────────────────────────

type SearchHit = { url: string; title?: string; description?: string };

async function fc<T>(path: string, body: unknown, key: string, timeoutMs: number): Promise<T> {
  const r = await fetch(`${FC}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = (await r.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!r.ok || j.success === false) throw new Error(j.error || `Firecrawl ${path} failed (${r.status})`);
  return j;
}

async function search(query: string, key: string): Promise<{ hits: SearchHit[]; credits: number }> {
  const j = await fc<{ data?: { web?: SearchHit[] } | SearchHit[]; creditsUsed?: number }>('/search', {
    query, limit: SEARCH_LIMIT, country: 'GB', location: 'United Kingdom', sources: ['web'],
  }, key, 30_000);
  const d = j.data;
  return { hits: (Array.isArray(d) ? d : d?.web ?? []).filter(h => h?.url), credits: j.creditsUsed ?? SEARCH_CREDITS };
}

type Extracted = {
  clinic_name?: string | null;
  postcode?: string | null;
  is_clinic_page?: boolean;
  prices?: { label?: string | null; price_gbp?: number | null; price_text?: string | null; kind?: string | null; is_main?: boolean | null; notes?: string | null }[];
};

const SCHEMA = {
  type: 'object',
  properties: {
    clinic_name: { type: 'string', description: 'Name of the clinic or salon whose prices these are' },
    postcode: { type: 'string', description: "UK postcode of that clinic's address, if shown anywhere on the page" },
    is_clinic_page: { type: 'boolean', description: 'true if this page belongs to (or lists) one specific clinic offering treatments' },
    prices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'What the price is for, e.g. "Full face", "Underarms - single session", "Course of 6"' },
          price_gbp: { type: 'number', description: 'Price in pounds as a number, e.g. 199' },
          price_text: { type: 'string', description: 'The price exactly as written, e.g. "from £199"' },
          kind: { type: 'string', enum: ['single', 'from', 'course', 'per_area', 'other'] },
          is_main: { type: 'boolean', description: "true for exactly one price: the clinic's standard full session of this treatment that a typical customer would pay (e.g. full face for a face treatment, one session rather than a course). Not small add-ons, single scars or patch tests." },
          notes: { type: 'string', description: 'Offer terms, discounts, what is included' },
        },
        required: ['price_gbp'],
      },
    },
  },
  required: ['prices'],
};

async function readPrices(url: string, treatment: string, key: string): Promise<{ data: Extracted | null; credits: number }> {
  const prompt = `Extract this clinic's prices for ${treatment} only, in GBP. Leave out other treatments, ` +
    `prices for a different clinic, and finance or deposit amounts. Use kind "from" for "from £x" prices, ` +
    `"course" for packages of several sessions, "per_area" for per-area prices. Mark one price is_main: the ` +
    `standard full session a typical customer pays. Return an empty prices list if ` +
    `the page shows no ${treatment} prices.`;
  try {
    const j = await fc<{ data?: { json?: Extracted; metadata?: { creditsUsed?: number } } }>('/scrape', {
      url,
      formats: [{ type: 'json', schema: SCHEMA, prompt }],
      onlyMainContent: false,
      parsers: [],
      timeout: 45_000,
    }, key, 60_000);
    return { data: j.data?.json ?? null, credits: j.data?.metadata?.creditsUsed ?? PAGE_CREDITS };
  } catch {
    return { data: null, credits: PAGE_CREDITS };
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

export type ScanInput = { clientId: string; treatment: string; radiusMiles: number; ourPrice: number | null; by: string | null };

export async function runCompetitorScan(input: ScanInput): Promise<{ id: string }> {
  const treatment = input.treatment.trim().slice(0, 80);
  if (!treatment) throw new Error('Pick a treatment.');
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error('FIRECRAWL_API_KEY is not set on the server.');

  const where = await clientLocation(input.clientId);
  if (!where?.city && !where?.postcode) throw new Error("This client's address isn't readable in GHL, so there's no area to search.");
  const town = where.city || where.postcode.split(' ')[0];
  const home = where.point;
  const ownDomain = where.website ? domainOf(where.website.startsWith('http') ? where.website : `https://${where.website}`) : '';

  const scan = {
    client_id: input.clientId, treatment, town, postcode: where.postcode || null,
    lat: home?.lat ?? null, lng: home?.lng ?? null,
    radius_miles: input.radiusMiles, our_price_gbp: input.ourPrice, created_by: input.by,
  };

  let credits = SEARCH_CREDITS;
  let pagesRead = 0;
  try {
    const found = await search(`${treatment} price ${town}`, key);
    credits = found.credits;
    const hits = found.hits;
    const seen = new Set<string>();
    const pages = hits.filter(h => {
      const d = domainOf(h.url);
      if (!d || seen.has(d)) return false;
      if (ownDomain && (d === ownDomain || d.endsWith(`.${ownDomain}`))) return false;
      if (NOT_A_CLINIC.some(n => d.includes(n))) return false;
      seen.add(d);
      return true;
    }).slice(0, MAX_PAGES);

    const read = await Promise.all(pages.map(async h => ({ h, ...(await readPrices(h.url, treatment, key)) })));
    pagesRead = read.length;
    credits += read.reduce((n, r) => n + r.credits, 0);

    const rows: Omit<CompetitorPrice, 'id'>[] = [];
    for (const { h, data } of read) {
      if (!data || data.is_clinic_page === false) continue;
      const prices = (data.prices ?? []).filter(p => typeof p.price_gbp === 'number' && p.price_gbp > 0 && p.price_gbp < 50_000);
      if (!prices.length) continue;
      const postcode = (data.postcode ?? '').trim().toUpperCase() || null;
      const pt = postcode ? await geocode(postcode) : null;
      const dist = pt && home ? +miles(home, pt).toFixed(1) : null;
      if (dist != null && dist > input.radiusMiles) continue;
      const clinic = (data.clinic_name ?? '').trim() || h.title?.split(/[|\-–]/)[0].trim() || domainOf(h.url);
      for (const p of prices.slice(0, 12)) {
        rows.push({
          clinic_name: clinic.slice(0, 120),
          website: domainOf(h.url),
          source_url: h.url,
          postcode,
          lat: pt?.lat ?? null,
          lng: pt?.lng ?? null,
          distance_miles: dist,
          label: p.label?.slice(0, 160) ?? null,
          price_gbp: p.price_gbp ?? null,
          price_text: p.price_text?.slice(0, 80) ?? null,
          kind: ['single', 'from', 'course', 'per_area', 'other'].includes(p.kind ?? '') ? p.kind! : 'other',
          is_main: p.is_main === true,
          notes: p.notes?.slice(0, 300) ?? null,
        });
      }
    }

    const { data: saved, error } = await supabaseAdmin.from('competitor_scans')
      .insert({ ...scan, status: 'done', pages_read: pagesRead, credits_used: credits })
      .select('id').single();
    if (error) throw new Error(error.message);
    const id = (saved as { id: string }).id;
    if (rows.length) {
      const { error: pErr } = await supabaseAdmin.from('competitor_prices').insert(rows.map(r => ({ ...r, scan_id: id })));
      if (pErr) throw new Error(pErr.message);
    }
    return { id };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Scan failed';
    // A missing table means migration 0024 hasn't been run — nothing to save the error into.
    if (/competitor_(scans|prices)/.test(message) && /does not exist|schema cache/.test(message)) {
      throw new Error('Run migration 0024_competitor_scans.sql in Supabase first.');
    }
    await supabaseAdmin.from('competitor_scans')
      .insert({ ...scan, status: 'error', error: message.slice(0, 500), pages_read: pagesRead, credits_used: credits });
    throw new Error(message);
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

type ScanRow = Omit<CompetitorScan, 'clinics' | 'median_gbp'>;

function summarise(scan: ScanRow, prices: Pick<CompetitorPrice, 'clinic_name' | 'price_gbp' | 'kind' | 'is_main'>[]): CompetitorScan {
  const byClinic = new Map<string, typeof prices>();
  for (const p of prices) byClinic.set(p.clinic_name, [...(byClinic.get(p.clinic_name) ?? []), p]);
  const heads = [...byClinic.values()].map(headline).filter((n): n is number => n != null);
  return {
    ...scan,
    radius_miles: Number(scan.radius_miles),
    our_price_gbp: scan.our_price_gbp == null ? null : Number(scan.our_price_gbp),
    clinics: byClinic.size,
    median_gbp: median(heads),
  };
}

// Every saved scan, newest first (optionally one client's). Empty until 0024 has run.
export async function getCompetitorScans(clientId?: string): Promise<{ scans: CompetitorScan[]; ready: boolean }> {
  let q = supabaseAdmin.from('competitor_scans').select('*').order('created_at', { ascending: false }).limit(200);
  if (clientId) q = q.eq('client_id', clientId);
  const { data, error } = await q;
  if (error) return { scans: [], ready: false };
  const scans = (data ?? []) as ScanRow[];
  const ids = scans.map(s => s.id);
  const prices: (Pick<CompetitorPrice, 'clinic_name' | 'price_gbp' | 'kind' | 'is_main'> & { scan_id: string })[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data: p } = await supabaseAdmin.from('competitor_prices')
      .select('scan_id, clinic_name, price_gbp, kind, is_main').in('scan_id', ids.slice(i, i + 100)).limit(5000);
    prices.push(...((p ?? []) as typeof prices));
  }
  return { scans: scans.map(s => summarise(s, prices.filter(p => p.scan_id === s.id))), ready: true };
}

export async function getCompetitorScan(id: string): Promise<CompetitorScanDetail | null> {
  const { data: s } = await supabaseAdmin.from('competitor_scans').select('*').eq('id', id).maybeSingle();
  if (!s) return null;
  const { data: p } = await supabaseAdmin.from('competitor_prices').select('*').eq('scan_id', id);
  const prices = ((p ?? []) as CompetitorPrice[]).map(r => ({
    ...r,
    price_gbp: r.price_gbp == null ? null : Number(r.price_gbp),
    distance_miles: r.distance_miles == null ? null : Number(r.distance_miles),
  }));
  return { ...summarise(s as ScanRow, prices), prices };
}

export async function deleteCompetitorScan(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('competitor_scans').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
