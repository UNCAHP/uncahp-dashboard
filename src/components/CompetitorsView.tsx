'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, Loader2, ScanSearch, Trash2, AlertTriangle } from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import {
  TREATMENT_PRESETS, RADIUS_OPTIONS, SCAN_CREDITS_MAX, headline,
  type CompetitorScan, type CompetitorScanDetail, type CompetitorPrice,
} from '@/lib/competitorsShared';
import { scanCompetitorsAction, deleteScanAction } from '@/app/actions/competitors';
import { NavLink } from '@/components/NavProgress';
import { useConfirm } from '@/components/Confirm';
import { createDarkMap, escHtml as esc, spreadPoints } from '@/lib/leafletMap';
import { cn, formatGBP } from '@/lib/utils';

// ─── Competitors ─────────────────────────────────────────────────────────────
// Scan what clinics near one of our clients charge for a treatment (Firecrawl, on demand,
// ~44 credits a scan), then compare: min / median / max against our price, every price
// found with its source page, and the clinics on a map around ours. Scans are saved;
// the sidebar's client list narrows the list to one client.

const KIND_LABEL: Record<string, string> = {
  single: 'Single session', from: 'From', course: 'Course', per_area: 'Per area', other: 'Other',
};
const CUSTOM = '__custom';

type ClinicRow = {
  clinic: string;
  website: string | null;
  source_url: string | null;
  distance: number | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  headline: number | null;
  compared: CompetitorPrice | null;   // the price the clinic is compared on
  prices: CompetitorPrice[];
};
type SortKey = 'price' | 'distance' | 'clinic';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function CompetitorsView({ scans, ready, scan, clients, client, since, until }: {
  scans: CompetitorScan[];
  ready: boolean;                       // false until migration 0024 has run
  scan: CompetitorScanDetail | null;
  clients: ClientOption[];
  client: string | null;
  since: string;
  until: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  const nameOf = (id: string) => clients.find(c => c.client_id === id)?.client_name ?? id;
  const href = (p: { client?: string | null; scan?: string }) => {
    const q = new URLSearchParams({ view: 'competitors' });
    if (p.client) q.set('client', p.client);
    if (p.scan) q.set('scan', p.scan);
    q.set('since', since);
    q.set('until', until);
    return `/?${q.toString()}`;
  };

  // ── Scan form ──
  const b2c = clients.filter(c => c.segment !== 'b2b');
  const [formClient, setFormClient] = useState(client ?? scan?.client_id ?? b2c[0]?.client_id ?? '');
  const [preset, setPreset] = useState(TREATMENT_PRESETS[0]);
  const [custom, setCustom] = useState('');
  const [radius, setRadius] = useState<number>(10);
  const [ourPrice, setOurPrice] = useState('');
  const treatment = preset === CUSTOM ? custom.trim() : preset;

  const runScan = () => {
    if (!formClient || !treatment) return;
    start(async () => {
      const id = toast.loading(`Scanning ${treatment} prices near ${nameOf(formClient)}…`, { description: 'Reading up to 8 clinic sites, about a minute.' });
      const res = await scanCompetitorsAction({
        clientId: formClient, treatment, radiusMiles: radius, ourPrice: ourPrice ? Number(ourPrice) : null,
      });
      if (res.ok) {
        toast.success('Scan saved', { id, description: undefined });
        router.push(href({ client, scan: res.id }));
      } else {
        toast.error('Scan failed', { id, description: res.error });
      }
    });
  };

  const remove = async (s: CompetitorScan) => {
    if (!(await confirm({ title: 'Delete this scan?', body: `${s.treatment} near ${nameOf(s.client_id)}, ${fmtDate(s.created_at)}. Its prices go too.`, confirmLabel: 'Delete', danger: true }))) return;
    const res = await deleteScanAction(s.id);
    if (res.ok) { toast.success('Scan deleted'); router.push(href({ client })); }
    else toast.error('Not deleted', { description: res.error });
  };

  if (!ready) {
    return (
      <div className="p-6">
        <div className="flex items-start gap-3 rounded-2xl border border-yellow/40 bg-yellow/5 p-5 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-yellow" />
          <div>
            <p className="font-semibold text-fg">Competitor scans aren&apos;t set up yet</p>
            <p className="mt-1 text-fg-muted">Run <code className="text-fg">supabase/migrations/0024_competitor_scans.sql</code> in the Supabase SQL editor, then reload.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 pt-4">
      {/* Scan form */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <div className="grid gap-3 md:grid-cols-[1.3fr_1.3fr_auto_0.8fr_auto] md:items-end">
          <Field label="Client">
            <select value={formClient} onChange={e => setFormClient(e.target.value)} className={inputCls}>
              {b2c.map(c => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </Field>
          <Field label="Treatment">
            <div className="flex gap-2">
              <select value={preset} onChange={e => setPreset(e.target.value)} className={cn(inputCls, preset === CUSTOM && 'w-32 shrink-0')}>
                {TREATMENT_PRESETS.map(t => <option key={t} value={t}>{t}</option>)}
                <option value={CUSTOM}>Other…</option>
              </select>
              {preset === CUSTOM && (
                <input autoFocus value={custom} onChange={e => setCustom(e.target.value)} placeholder="e.g. Profhilo" maxLength={80} className={inputCls} />
              )}
            </div>
          </Field>
          <Field label="Within">
            <div className="flex overflow-hidden rounded-lg border border-border">
              {RADIUS_OPTIONS.map(r => (
                <button key={r} type="button" onClick={() => setRadius(r)} aria-pressed={radius === r}
                  className={cn('px-3 py-2 text-sm', radius === r ? 'bg-pink/15 text-pink' : 'text-fg-muted hover:text-fg')}>{r} mi</button>
              ))}
            </div>
          </Field>
          <Field label="Our price (optional)">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-dim">£</span>
              <input value={ourPrice} onChange={e => setOurPrice(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="0" className={cn(inputCls, 'pl-7')} />
            </div>
          </Field>
          <button onClick={runScan} disabled={pending || !formClient || !treatment}
            className="inline-flex h-[38px] items-center justify-center gap-2 rounded-lg bg-pink px-4 text-sm font-semibold text-bg hover:bg-pink-soft disabled:opacity-50">
            {pending ? <Loader2 size={15} className="animate-spin" /> : <ScanSearch size={15} />}
            {pending ? 'Scanning…' : 'Scan'}
          </button>
        </div>
        <p className="mt-3 text-xs text-fg-dim">
          Searches the web for &ldquo;{treatment || 'treatment'} price {'<'}town{'>'}&rdquo; and reads up to 8 clinic sites. Up to {SCAN_CREDITS_MAX} Firecrawl credits a scan; results are saved.
        </p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        {/* Saved scans */}
        <aside className="h-fit overflow-hidden rounded-2xl border border-border bg-surface">
          <p className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wide text-fg-dim">
            Saved scans{client ? ` · ${nameOf(client)}` : ''}
          </p>
          {scans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">No scans yet. Pick a client and treatment above and press Scan.</p>
          ) : (
            <ul className="max-h-[640px] divide-y divide-border overflow-y-auto">
              {scans.map(s => {
                const on = scan?.id === s.id;
                return (
                  <li key={s.id}>
                    <NavLink href={href({ client, scan: s.id })} className={cn('block px-4 py-3 hover:bg-surface-hover', on && 'bg-pink/[0.06]')}>
                      <p className={cn('text-sm font-medium', on ? 'text-pink' : 'text-fg')}>{s.treatment}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{nameOf(s.client_id)} · {s.radius_miles} mi</p>
                      <p className="mt-0.5 text-xs text-fg-dim">
                        {fmtDate(s.created_at)} · {s.status === 'error' ? <span className="text-red">failed</span> : `${s.clinics} clinics · median ${formatGBP(s.median_gbp)}`}
                      </p>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Selected scan */}
        {scan ? <ScanDetail scan={scan} clientName={nameOf(scan.client_id)} onDelete={() => remove(scan)} /> : (
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border p-10 text-sm text-fg-muted">
            Run a scan to see competitor prices here.
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-pink/50 focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

// ─── One scan ────────────────────────────────────────────────────────────────
// Stacked, full width: summary tiles, the map, then one row per clinic. Each row shows the
// price it's compared on and what that price is for; the rest of its prices fold out.

function ScanDetail({ scan, clientName, onDelete }: { scan: CompetitorScanDetail; clientName: string; onDelete: () => void }) {
  const clinics = useMemo<ClinicRow[]>(() => {
    const by = new Map<string, CompetitorPrice[]>();
    for (const p of scan.prices) by.set(p.clinic_name, [...(by.get(p.clinic_name) ?? []), p]);
    return [...by.entries()].map(([clinic, prices]) => {
      const head = headline(prices);
      const sorted = [...prices].sort((a, b) => (a.price_gbp ?? 0) - (b.price_gbp ?? 0));
      return {
        clinic,
        website: prices[0].website,
        source_url: prices[0].source_url,
        distance: prices[0].distance_miles,
        postcode: prices[0].postcode,
        lat: prices[0].lat,
        lng: prices[0].lng,
        headline: head,
        compared: prices.find(p => p.is_main && p.price_gbp === head) ?? sorted.find(p => p.price_gbp === head) ?? null,
        prices: sorted,
      };
    });
  }, [scan.prices]);

  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'price', desc: false });
  const sortBy = (key: SortKey) => setSort(s => ({ key, desc: s.key === key ? !s.desc : false }));
  const rows = useMemo(() => {
    const val = (r: ClinicRow) => sort.key === 'price' ? r.headline : sort.key === 'distance' ? r.distance : r.clinic;
    return [...clinics].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;   // unknowns last, whichever way round
      if (y == null) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number);
      return sort.desc ? -c : c;
    });
  }, [clinics, sort]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (c: string) => setOpen(s => { const n = new Set(s); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  const heads = clinics.map(c => c.headline).filter((n): n is number => n != null);
  const min = heads.length ? Math.min(...heads) : null;
  const max = heads.length ? Math.max(...heads) : null;
  const med = scan.median_gbp;
  const vs = scan.our_price_gbp != null && med ? ((scan.our_price_gbp - med) / med) * 100 : null;

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-fg">{scan.treatment} near {clientName}</h2>
          <p className="text-sm text-fg-muted">
            Within {scan.radius_miles} miles of {[scan.town, scan.postcode].filter(Boolean).join(' ')} · scanned {fmtDate(scan.created_at)}
            {scan.created_by ? ` by ${scan.created_by.split('@')[0]}` : ''} · {scan.pages_read} sites read{scan.credits_used != null ? ` · ${scan.credits_used} credits` : ''}
          </p>
        </div>
        <button onClick={onDelete} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-red/50 hover:text-red">
          <Trash2 size={13} /> Delete scan
        </button>
      </div>

      {scan.status === 'error' && (
        <div className="flex items-start gap-2 rounded-xl border border-red/40 bg-red/5 p-4 text-sm text-fg">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-red" /> {scan.error || 'The scan failed.'}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Clinics with prices" value={String(clinics.length)} />
        <Tile label="Lowest" value={formatGBP(min)} />
        <Tile label="Median" value={formatGBP(med)} />
        <Tile label="Highest" value={formatGBP(max)} />
        <Tile label="Our price vs median"
          value={scan.our_price_gbp == null ? '—' : formatGBP(scan.our_price_gbp)}
          sub={vs == null ? (scan.our_price_gbp == null ? 'Not entered' : undefined) : `${vs > 0 ? '+' : ''}${vs.toFixed(0)}% ${vs > 0 ? 'above' : vs < 0 ? 'below' : 'at'} median`}
          tone={vs == null ? undefined : vs > 10 ? 'red' : vs < -10 ? 'green' : undefined} />
      </dl>

      {clinics.length === 0 && scan.status !== 'error' ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-fg-muted">
          No {scan.treatment} prices found within {scan.radius_miles} miles. Try a wider radius or a different name for the treatment.
        </div>
      ) : (
        <>
          <CompetitorMap scan={scan} clientName={clientName} clinics={clinics} />

          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <table className="w-full table-fixed text-sm">
              <colgroup>
                <col />
                <col className="w-[34%]" />
                <col className="w-28" />
                <col className="w-28" />
              </colgroup>
              <thead className="border-b border-border text-left text-xs text-fg-muted">
                <tr>
                  <SortTh k="clinic" sort={sort} sortBy={sortBy}>Clinic</SortTh>
                  <th className="px-4 py-2.5 font-semibold">Compared on</th>
                  <SortTh k="price" sort={sort} sortBy={sortBy} right>Price</SortTh>
                  <SortTh k="distance" sort={sort} sortBy={sortBy} right>Distance</SortTh>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map(r => {
                  const isOpen = open.has(r.clinic);
                  const others = r.prices.filter(p => p !== r.compared);
                  return (
                    <tr key={r.clinic} className="align-top">
                      <td className="px-4 py-3">
                        <p className="truncate font-medium text-fg" title={r.clinic}>{r.clinic}</p>
                        {r.source_url && (
                          <a href={r.source_url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex max-w-full items-center gap-1 text-xs text-pink hover:underline">
                            <span className="truncate">{r.website}</span> <ExternalLink size={11} className="shrink-0" />
                          </a>
                        )}
                        {others.length > 0 && (
                          <>
                            <button onClick={() => toggle(r.clinic)} className="mt-1.5 flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
                              <ChevronDown size={13} className={cn('transition-transform', isOpen && 'rotate-180')} />
                              {isOpen ? 'Hide other prices' : `${others.length} other price${others.length === 1 ? '' : 's'}`}
                            </button>
                            {isOpen && (
                              <ul className="mt-2 space-y-1 border-l border-border pl-3 text-xs">
                                {others.map(p => (
                                  <li key={p.id} className="text-fg-muted">
                                    <span className="font-mono text-fg">{p.price_text || formatGBP(p.price_gbp)}</span>
                                    {p.label && <> · {p.label}</>}
                                    {p.kind && p.kind !== 'single' && <span className="ml-1 rounded bg-surface-hover px-1 py-px text-[10px] text-fg-dim">{KIND_LABEL[p.kind] ?? p.kind}</span>}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-muted">
                        {r.compared ? (
                          <>
                            <p className="text-fg">{r.compared.label || '—'}</p>
                            {r.compared.kind && r.compared.kind !== 'single' && <p className="text-fg-dim">{KIND_LABEL[r.compared.kind] ?? r.compared.kind}</p>}
                            {r.compared.notes && <p className="mt-0.5 line-clamp-2 text-fg-dim">{r.compared.notes}</p>}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-base font-semibold tabular-nums text-fg">{formatGBP(r.headline)}</td>
                      <td className="px-4 py-3 text-right text-xs text-fg-muted">
                        {r.distance != null ? <span className="text-sm text-fg">{r.distance} mi</span> : <span className="text-fg-dim">unknown</span>}
                        {r.postcode && <span className="block text-fg-dim">{r.postcode}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-dim">
            Each clinic is compared on its standard full-session price, or its lowest session price if the page doesn&apos;t make one clear.
            Prices are read from the clinics&apos; own pages by AI, so open the source before quoting one.
          </p>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'red' | 'green' }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <dt className="text-[11px] text-fg-dim">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-fg">{value}</dd>
      {sub && <p className={cn('text-xs', tone === 'red' ? 'text-red' : tone === 'green' ? 'text-green' : 'text-fg-muted')}>{sub}</p>}
    </div>
  );
}

function SortTh({ k, sort, sortBy, right = false, children }: {
  k: SortKey; sort: { key: SortKey; desc: boolean }; sortBy: (k: SortKey) => void; right?: boolean; children: string;
}) {
  const on = sort.key === k;
  const Arrow = sort.desc ? ArrowDown : ArrowUp;
  return (
    <th className={cn('px-4 py-2.5 font-semibold', right && 'text-right')} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => sortBy(k)} className={cn('inline-flex items-center gap-1 hover:text-fg', on && 'text-fg', right && 'flex-row-reverse')}>
        {children} {on && <Arrow size={12} />}
      </button>
    </th>
  );
}

// ─── Map: our clinic and the competitors around it ───────────────────────────
// Pins are styled inline (not from globals.css) so they always render: our clinic is a
// labelled pink pin, each competitor a solid price tag.

const tagStyle = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;'
  + 'padding:3px 8px;border-radius:9999px;font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif;'
  + 'font-variant-numeric:tabular-nums;color:#fff;background:#18191d;border:1.5px solid #9ca3af;'
  + 'box-shadow:0 2px 10px rgb(0 0 0 / .6);cursor:pointer;';
const homeStyle = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;'
  + 'padding:3px 9px;border-radius:9999px;font:700 12px/1.2 ui-sans-serif,system-ui,sans-serif;'
  + 'color:#0f1014;background:#f472d0;border:1.5px solid #0f1014;'
  + 'box-shadow:0 0 0 4px rgb(244 114 208 / .3),0 2px 10px rgb(0 0 0 / .6);';

function CompetitorMap({ scan, clientName, clinics }: { scan: CompetitorScanDetail; clientName: string; clinics: ClinicRow[] }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const placed = useMemo(() => clinics.filter((c): c is ClinicRow & { lat: number; lng: number } => c.lat != null && c.lng != null), [clinics]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current || map.current) return;
      const m = createDarkMap(L, el.current, { scrollWheelZoom: false });
      const pts: [number, number][] = [];
      const tag = (html: string) => L.divIcon({ html, className: '', iconSize: [0, 0], iconAnchor: [0, 0] });
      if (scan.lat != null && scan.lng != null) {
        const home: [number, number] = [scan.lat, scan.lng];
        L.circle(home, { radius: scan.radius_miles * 1609.34, color: '#f472d0', weight: 1, opacity: 0.5, fillOpacity: 0.05, interactive: false }).addTo(m);
        L.marker(home, { icon: tag(`<div style="${homeStyle}">${esc(clientName)}</div>`), zIndexOffset: 1000, title: clientName }).addTo(m);
        pts.push(home);
      }
      const at = spreadPoints(placed, c => c.clinic);
      for (const c of placed) {
        const pos = at.get(c.clinic) ?? [c.lat, c.lng];
        L.marker(pos, { icon: tag(`<div style="${tagStyle}">${esc(formatGBP(c.headline))}</div>`), title: `${c.clinic} · ${formatGBP(c.headline)}`, riseOnHover: true })
          .bindPopup(`<div class="client-popup"><div class="name">${esc(c.clinic)}</div><div class="addr">${esc(formatGBP(c.headline))}${c.compared?.label ? ` · ${esc(c.compared.label)}` : ''}</div><div class="meta">${esc(c.postcode ?? '')}${c.distance != null ? ` · ${c.distance} mi` : ''}</div>${c.source_url ? `<div class="links"><a href="${esc(c.source_url)}" target="_blank" rel="noreferrer">Price page ↗</a></div>` : ''}</div>`, { closeButton: false })
          .addTo(m);
        pts.push(pos);
      }
      if (pts.length > 1) m.fitBounds(pts, { padding: [50, 70], maxZoom: 14 });
      else if (pts.length === 1) m.setView(pts[0], 12);
      else m.setView([54, -2.5], 6);
      map.current = m;
    })();
    return () => { cancelled = true; map.current?.remove(); map.current = null; };
  }, [scan, clientName, placed]);

  return (
    <div>
      <div className="h-[360px] overflow-hidden rounded-2xl border border-border">
        <div ref={el} className="client-map h-full w-full bg-surface" />
      </div>
      {clinics.length > placed.length && (
        <p className="mt-1.5 text-xs text-fg-dim">{clinics.length - placed.length} clinic{clinics.length - placed.length === 1 ? '' : 's'} not on the map (no postcode on the page).</p>
      )}
    </div>
  );
}
