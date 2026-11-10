'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Search, X, AlertTriangle } from 'lucide-react';
import type { ClientMapData, ClientPin } from '@/lib/clientMap';
import { CSR_SETTERS } from '@/lib/csrConstants';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn } from '@/lib/utils';

// ─── Client Map ──────────────────────────────────────────────────────────────
// Every active client's clinic on a map of the UK, from the address on its GHL
// sub-account. The list beside it filters by setter and searches by name or town;
// picking a client flies the map to it. Clients that couldn't be placed are listed
// with the reason, so the address can be fixed in GHL.

const setterLabel = (k: string | null) => (k ? CSR_SETTERS.find(s => s.key === k)?.label ?? k : 'No setter');

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// Clinics sharing a postcode (TAG's two accounts) would sit on one spot. Spread them
// round a small circle so each pin can be clicked.
function spread(pins: ClientPin[]): Map<string, [number, number]> {
  const groups = new Map<string, ClientPin[]>();
  for (const p of pins) {
    const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const out = new Map<string, [number, number]>();
  for (const g of groups.values()) {
    g.forEach((p, i) => {
      if (g.length === 1) { out.set(p.client_id, [p.lat, p.lng]); return; }
      const a = (2 * Math.PI * i) / g.length;
      out.set(p.client_id, [p.lat + 0.0012 * Math.sin(a), p.lng + 0.0019 * Math.cos(a)]);
    });
  }
  return out;
}

function pinHtml(p: ClientPin): string {
  const inner = p.logo_url
    ? `<img src="${esc(p.logo_url)}" alt="" />`
    : `<span style="background:${clientColor(p.client_id)}">${esc(clientInitials(p.client_name))}</span>`;
  return `<div class="client-pin">${inner}</div>`;
}

function popupHtml(p: ClientPin, since: string, until: string): string {
  const q = (view: string) => `/?view=${view}&client=${encodeURIComponent(p.client_id)}&since=${since}&until=${until}`;
  const addr = [p.address, p.city, p.postcode].filter(Boolean).map(esc).join(', ');
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.address, p.city, p.postcode].filter(Boolean).join(', '))}`;
  return `
    <div class="client-popup">
      <div class="name">${esc(p.client_name)}</div>
      <div class="addr">${addr}${p.approx ? ' <em>(approximate)</em>' : ''}</div>
      <div class="meta">${esc(setterLabel(p.csr_key))} · ${p.segment === 'b2b' ? 'B2B' : 'B2C'}</div>
      <div class="links">
        <a href="${q('client')}">Client View</a>
        <a href="${q('offers')}">Live ads</a>
        <a href="${maps}" target="_blank" rel="noreferrer">Google Maps ↗</a>
      </div>
    </div>`;
}

export function ClientMapView({ data, since, until }: { data: ClientMapData; since: string; until: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const [setter, setSetter] = useState<string>('all');
  const [q, setQ] = useState('');

  const setters = useMemo(() => {
    const keys = new Set(data.pins.map(p => p.csr_key ?? ''));
    return [...CSR_SETTERS.filter(s => keys.has(s.key)).map(s => s.key), ...(keys.has('') ? [''] : [])];
  }, [data.pins]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.pins
      .filter(p => setter === 'all' || (p.csr_key ?? '') === setter)
      .filter(p => !needle || [p.client_name, p.city, p.postcode, p.address].some(s => s.toLowerCase().includes(needle)))
      .sort((a, b) => a.client_name.localeCompare(b.client_name));
  }, [data.pins, setter, q]);

  // Build the map once; Leaflet touches window, so it's loaded in the browser only.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: true });
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(m);
      const at = spread(data.pins);
      for (const p of data.pins) {
        const icon = L.divIcon({ html: pinHtml(p), className: '', iconSize: [36, 36], iconAnchor: [18, 18], popupAnchor: [0, -18] });
        const mk = L.marker(at.get(p.client_id) ?? [p.lat, p.lng], { icon, title: p.client_name, riseOnHover: true })
          .bindPopup(popupHtml(p, since, until), { closeButton: false, maxWidth: 280 })
          .addTo(m);
        markers.current.set(p.client_id, mk);
      }
      if (data.pins.length) m.fitBounds(L.latLngBounds(data.pins.map(p => [p.lat, p.lng] as [number, number])), { padding: [40, 40], maxZoom: 11 });
      else m.setView([54, -2.5], 6);
      map.current = m;
    })();
    const markerMap = markers.current;
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      markerMap.clear();
    };
  }, [data.pins, since, until]);

  // The setter filter and search hide pins that don't match, and refit to what's left.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const ids = new Set(shown.map(p => p.client_id));
    for (const [id, mk] of markers.current) {
      if (ids.has(id)) { if (!m.hasLayer(mk)) mk.addTo(m); }
      else mk.remove();
    }
    if (shown.length && (setter !== 'all' || q.trim())) {
      m.fitBounds(shown.map(p => [p.lat, p.lng] as [number, number]), { padding: [60, 60], maxZoom: 12 });
    }
  }, [shown, setter, q]);

  const focus = (p: ClientPin) => {
    const m = map.current, mk = markers.current.get(p.client_id);
    if (!m || !mk) return;
    m.flyTo(mk.getLatLng(), Math.max(m.getZoom(), 13), { duration: 0.6 });
    mk.openPopup();
  };

  return (
    <div className="flex h-[calc(100vh-4.5rem)] min-h-[520px] gap-4 p-6 pt-4">
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-border">
        <div ref={el} className="client-map h-full w-full bg-surface" />
      </div>

      <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="space-y-3 border-b border-border p-4">
          <p className="text-sm text-fg-muted">
            <span className="font-semibold text-fg">{data.pins.length}</span> clinics on the map
            {data.missing.length > 0 && <> · <span className="text-yellow">{data.missing.length} not placed</span></>}
          </p>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Client, town or postcode"
              className="w-full rounded-lg border border-border bg-bg py-1.5 pl-8 pr-7 text-sm text-fg placeholder:text-fg-dim focus:border-pink/50 focus:outline-none" />
            {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-fg-dim hover:text-fg"><X size={13} /></button>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['all', ...setters].map(k => (
              <button key={k || 'none'} onClick={() => setSetter(k)} aria-pressed={setter === k}
                className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  setter === k ? 'border-pink/60 bg-pink/10 text-pink' : 'border-border text-fg-muted hover:text-fg')}>
                {k === 'all' ? 'All' : setterLabel(k || null)}
              </button>
            ))}
          </div>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.map(p => (
            <li key={p.client_id}>
              <button onClick={() => focus(p)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-hover">
                {p.logo_url
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={p.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-lg border border-border object-cover" />
                  : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-fg-muted" style={{ background: clientColor(p.client_id) }}>{clientInitials(p.client_name)}</span>}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-fg">{p.client_name}</span>
                  <span className="block truncate text-xs text-fg-muted">{[p.city, p.postcode].filter(Boolean).join(' · ')} · {setterLabel(p.csr_key)}</span>
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && <li className="px-2 py-6 text-center text-sm text-fg-muted">No clinics match.</li>}
        </ul>

        {data.missing.length > 0 && (
          <div className="max-h-48 overflow-y-auto border-t border-border p-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-fg-dim">
              <AlertTriangle size={12} className="text-yellow" /> Not on the map
            </p>
            <ul className="space-y-1.5">
              {data.missing.map(m => (
                <li key={m.client_id} className="text-xs">
                  <span className="font-medium text-fg">{m.client_name}</span>
                  <span className="block text-fg-dim">{m.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.pins.length === 0 && data.missing.length === 0 && (
          <p className="flex items-center gap-2 p-4 text-sm text-fg-muted"><MapPin size={14} /> No active clients.</p>
        )}
      </aside>
    </div>
  );
}
