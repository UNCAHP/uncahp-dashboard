// Competitors: the parts the browser needs too (no server imports). See ./competitors.

export const MAX_PAGES = 8;
export const SEARCH_CREDITS = 4; // up to 15 results
export const PAGE_CREDITS = 5; // 1 to scrape + 4 for JSON extraction
export const SCAN_CREDITS_MAX = SEARCH_CREDITS + MAX_PAGES * PAGE_CREDITS;

export const TREATMENT_PRESETS = [
  'Laser hair removal',
  'HIFU',
  'CO2 laser',
  'Skin analysis',
  'Tattoo removal',
  'Pigmentation treatment',
  'HydraFacial',
  'Body sculpting',
  'Emsella',
  'Morpheus8',
  'Microneedling',
  'Chemical peel',
  'Anti-wrinkle injections',
  'Dermal fillers',
];

export const RADIUS_OPTIONS = [5, 10, 25] as const;

export type CompetitorPrice = {
  id: string;
  clinic_name: string;
  website: string | null;
  source_url: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  distance_miles: number | null;
  label: string | null;
  price_gbp: number | null;
  price_text: string | null;
  kind: string | null;
  is_main: boolean;
  notes: string | null;
};

export type CompetitorScan = {
  id: string;
  client_id: string;
  treatment: string;
  town: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  radius_miles: number;
  our_price_gbp: number | null;
  status: 'done' | 'error';
  error: string | null;
  pages_read: number;
  credits_used: number | null;
  created_by: string | null;
  created_at: string;
  clinics: number;              // distinct clinics with a price
  median_gbp: number | null;
};

export type CompetitorScanDetail = CompetitorScan & { prices: CompetitorPrice[] };

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// A clinic's comparison price: the one the page marks as its standard full session
// (full face for a face treatment, a single session of LHR...). Without one, the cheapest
// single-session or "from" price, else the cheapest of anything. Small add-ons (one scar,
// a patch test) would understate a clinic, which is why the marked one wins.
export function headline(prices: { price_gbp: number | null; kind: string | null; is_main?: boolean | null }[]): number | null {
  const val = (p: { price_gbp: number | null }) => (typeof p.price_gbp === 'number' && p.price_gbp > 0 ? p.price_gbp : null);
  const main = prices.filter(p => p.is_main).map(val).filter((n): n is number => n != null);
  if (main.length) return Math.min(...main);
  const sessions = prices.filter(p => p.kind === 'single' || p.kind === 'from').map(val).filter((n): n is number => n != null);
  if (sessions.length) return Math.min(...sessions);
  const any = prices.map(val).filter((n): n is number => n != null);
  return any.length ? Math.min(...any) : null;
}
