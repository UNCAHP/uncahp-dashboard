import type * as Leaflet from 'leaflet';

// Shared Leaflet setup for the dashboard's maps (Client Map, Competitors). Browser only:
// pass in the Leaflet module the component loaded with `await import('leaflet')`.

export const escHtml = (s: string) =>
  s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// A dark map: OpenStreetMap's own tiles (free, no key; CARTO's now ask for one), darkened
// by the client-map-tiles CSS filter in globals.css. The container needs the client-map
// class for the popup and control styling.
export function createDarkMap(L: typeof Leaflet, el: HTMLElement, opts: Leaflet.MapOptions = {}): Leaflet.Map {
  const m = L.map(el, { zoomControl: true, attributionControl: true, scrollWheelZoom: true, ...opts });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    className: 'client-map-tiles',
    maxZoom: 19,
  }).addTo(m);
  return m;
}

// Points sharing a spot (two accounts at one postcode) spread round a small circle so
// each pin can still be clicked. Returns the position to draw each id at.
export function spreadPoints<T extends { lat: number; lng: number }>(items: T[], idOf: (t: T) => string): Map<string, [number, number]> {
  const groups = new Map<string, T[]>();
  for (const p of items) {
    const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out = new Map<string, [number, number]>();
  for (const g of groups.values()) {
    g.forEach((p, i) => {
      if (g.length === 1) { out.set(idOf(p), [p.lat, p.lng]); return; }
      const a = (2 * Math.PI * i) / g.length;
      out.set(idOf(p), [p.lat + 0.0012 * Math.sin(a), p.lng + 0.0019 * Math.cos(a)]);
    });
  }
  return out;
}
