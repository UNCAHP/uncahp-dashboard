'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ImageOff, SlidersHorizontal, X } from 'lucide-react';
import type { CampaignNode, AdNode, CampaignMetrics } from '@/lib/queries';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

type StatusFilter = 'all' | 'active';
type MetricKey =
  | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'cpm'
  | 'leads' | 'cpl' | 'lp_bookings' | 'cost_lp_booking' | 'bookings' | 'conv' | 'cac' | 'roi';

const METRICS: { key: MetricKey; label: string; short?: string; get: (m: CampaignMetrics) => string; pink?: boolean }[] = [
  { key: 'spend', label: 'Spend', get: m => formatGBP(m.spend_gbp, { decimals: 0 }) },
  { key: 'impressions', label: 'Impressions', short: 'Impr.', get: m => formatNumber(m.impressions) },
  { key: 'clicks', label: 'Clicks', get: m => formatNumber(m.clicks) },
  { key: 'ctr', label: 'CTR', get: m => (m.ctr_pct != null ? `${m.ctr_pct}%` : '—') },
  { key: 'cpc', label: 'CPC', get: m => (m.cpc_gbp != null ? formatGBP(m.cpc_gbp, { decimals: 2 }) : '—') },
  { key: 'cpm', label: 'CPM', get: m => (m.cpm_gbp != null ? formatGBP(m.cpm_gbp, { decimals: 2 }) : '—') },
  { key: 'leads', label: 'Leads', get: m => formatNumber(m.leads) },
  { key: 'cpl', label: 'CPL', get: m => (m.cpl_gbp != null ? formatGBP(m.cpl_gbp, { decimals: 2 }) : '—') },
  { key: 'lp_bookings', label: 'LP Bookings', short: 'LP Bkgs', get: m => (m.lp_bookings > 0 ? formatNumber(m.lp_bookings) : '—'), pink: true },
  { key: 'cost_lp_booking', label: 'Cost / LP Booking', short: 'Cost/LP', get: m => (m.cost_lp_booking_gbp != null ? formatGBP(m.cost_lp_booking_gbp, { decimals: 2 }) : '—') },
  { key: 'bookings', label: 'Total Bookings', short: 'Total Bkgs', get: m => (m.bookings > 0 ? formatNumber(m.bookings) : '—'), pink: true },
  { key: 'conv', label: 'Conv', get: m => (m.conv_rate_pct != null ? `${m.conv_rate_pct}%` : '—') },
  { key: 'cac', label: 'CAC', get: m => (m.cac_gbp != null ? formatGBP(m.cac_gbp, { decimals: 2 }) : '—') },
  { key: 'roi', label: 'ROI', get: m => (m.roi != null ? `${m.roi.toFixed(2)}x` : '—') },
];

const BUILT_IN_PRESETS: { name: string; cols: MetricKey[] }[] = [
  { name: 'Default', cols: ['spend', 'clicks', 'ctr', 'leads', 'cpl', 'lp_bookings', 'cost_lp_booking', 'bookings', 'conv', 'cac', 'roi'] },
  { name: 'Performance', cols: ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm'] },
  { name: 'Conversions', cols: ['spend', 'leads', 'cpl', 'lp_bookings', 'cost_lp_booking', 'bookings', 'conv', 'cac', 'roi'] },
  { name: 'Funnel', cols: ['impressions', 'clicks', 'ctr', 'leads', 'cpl', 'lp_bookings', 'bookings', 'conv'] },
];

const COLS_KEY = 'uncahp_campaign_cols';
const PRESETS_KEY = 'uncahp_campaign_presets';

function passesFilter(status: string, filter: StatusFilter) {
  return filter === 'all' || status === 'ACTIVE';
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  const archived = status === 'ARCHIVED';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        active ? 'bg-green/10 text-green' : archived ? 'bg-surface-2 text-fg-dim' : 'bg-red/10 text-red',
      )}
    >
      <span className={cn('h-1 w-1 rounded-full', active ? 'bg-green' : archived ? 'bg-fg-dim' : 'bg-red')} />
      {active ? 'On' : archived ? 'Archived' : 'Off'}
    </span>
  );
}

function StatusToggle({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  const seg = (v: StatusFilter, label: string, activeClass: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={cn(
        'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
        value === v ? activeClass : 'text-fg-dim hover:text-fg-muted',
      )}
    >
      {label}
    </button>
  );
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-bg p-0.5">
      {seg('active', 'On', 'bg-green/20 text-green')}
      {seg('all', 'All', 'bg-surface-2 text-fg')}
    </div>
  );
}

function MetricCells({ m, cols }: { m: CampaignMetrics; cols: MetricKey[] }) {
  // Level differentiation is done by row opacity (see brightness logic below),
  // so cells use one uniform colour.
  return (
    <>
      {METRICS.filter(d => cols.includes(d.key)).map(d => (
        <div
          key={d.key}
          className={cn(
            'w-[76px] shrink-0 text-center font-mono text-xs font-medium tabular-nums',
            d.pink ? 'text-pink' : 'text-fg',
          )}
        >
          {d.get(m)}
        </div>
      ))}
    </>
  );
}

export function CampaignExplorer({ campaigns }: { campaigns: CampaignNode[] }) {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set());

  const [cols, setCols] = useState<MetricKey[]>(BUILT_IN_PRESETS[0].cols);
  const [customPresets, setCustomPresets] = useState<{ name: string; cols: MetricKey[] }[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const colsRef = useRef<HTMLDivElement>(null);

  // Load saved column choice + custom presets.
  useEffect(() => {
    try {
      const c = localStorage.getItem(COLS_KEY);
      if (c) {
        const parsed = JSON.parse(c) as MetricKey[];
        const valid = parsed.filter(k => METRICS.some(d => d.key === k));
        if (valid.length) setCols(valid);
      }
      const p = localStorage.getItem(PRESETS_KEY);
      if (p) setCustomPresets(JSON.parse(p));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!colsOpen) return;
    const h = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [colsOpen]);

  function applyCols(next: MetricKey[]) {
    // Keep METRICS order, always keep at least Spend.
    const ordered = METRICS.map(d => d.key).filter(k => next.includes(k));
    const final = ordered.length ? ordered : (['spend'] as MetricKey[]);
    setCols(final);
    try { localStorage.setItem(COLS_KEY, JSON.stringify(final)); } catch { /* ignore */ }
  }

  function toggleCol(k: MetricKey) {
    applyCols(cols.includes(k) ? cols.filter(c => c !== k) : [...cols, k]);
  }

  function saveCustomPreset() {
    const name = presetName.trim();
    if (!name) return;
    const next = [...customPresets.filter(p => p.name !== name), { name, cols }];
    setCustomPresets(next);
    setPresetName('');
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  function deleteCustomPreset(name: string) {
    const next = customPresets.filter(p => p.name !== name);
    setCustomPresets(next);
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const visibleCampaigns = campaigns.filter(c => passesFilter(c.status, filter));
  const shownMetrics = METRICS.filter(d => cols.includes(d.key));

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <div className="text-sm font-semibold text-fg">Campaigns</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            Drill in: campaign → ad sets → ad creative. Leads &amp; bookings traced via UTM.
          </div>
        </div>

        {/* Columns dropdown */}
        <div className="relative" ref={colsRef}>
          <button
            type="button"
            onClick={() => setColsOpen(o => !o)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-bg px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
          >
            <SlidersHorizontal size={13} />
            Columns
          </button>
          {colsOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-border-strong bg-surface p-3 shadow-2xl shadow-black/60">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-dim">Presets</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {BUILT_IN_PRESETS.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => applyCols(p.cols)}
                    className="rounded-md border border-border bg-bg px-2 py-1 text-[11px] text-fg-muted hover:border-border-strong hover:text-fg"
                  >
                    {p.name}
                  </button>
                ))}
                {customPresets.map(p => (
                  <span
                    key={p.name}
                    className="inline-flex items-center gap-1 rounded-md border border-pink/30 bg-pink/10 px-2 py-1 text-[11px] text-pink"
                  >
                    <button type="button" onClick={() => applyCols(p.cols)}>{p.name}</button>
                    <button type="button" onClick={() => deleteCustomPreset(p.name)} className="hover:text-fg">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>

              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-fg-dim">Metrics</div>
              <div className="mb-3 grid grid-cols-2 gap-x-2 gap-y-1">
                {METRICS.map(d => (
                  <label key={d.key} className="flex cursor-pointer items-center gap-2 text-xs text-fg">
                    <input
                      type="checkbox"
                      checked={cols.includes(d.key)}
                      onChange={() => toggleCol(d.key)}
                      className="accent-pink"
                    />
                    {d.label}
                  </label>
                ))}
              </div>

              <div className="flex items-center gap-1.5 border-t border-border pt-2.5">
                <input
                  value={presetName}
                  onChange={e => setPresetName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveCustomPreset()}
                  placeholder="Save current as preset…"
                  className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none"
                />
                <button
                  type="button"
                  onClick={saveCustomPreset}
                  disabled={!presetName.trim()}
                  className="rounded-md bg-pink px-2.5 py-1 text-xs font-semibold text-black disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Column header */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <div className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Campaign / Ad Set / Ad
        </div>
        <div className="flex w-[150px] shrink-0 justify-center">
          <StatusToggle value={filter} onChange={setFilter} />
        </div>
        {shownMetrics.map(d => (
          <div key={d.key} className="w-[76px] shrink-0 text-center text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            {d.short ?? d.label}
          </div>
        ))}
      </div>

      <div className="overflow-x-auto">
        {visibleCampaigns.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-fg-dim">No campaigns match this filter.</div>
        ) : (
          visibleCampaigns.map(campaign => {
            const cOpen = openCampaigns.has(campaign.id);
            const adsets = campaign.adsets.filter(s => passesFilter(s.status, filter));
            // Brightness: the deepest open level is full; parents dim as you drill in.
            const hasOpenAdset = adsets.some(s => openAdsets.has(s.id));
            const campaignOpacity = !cOpen ? '' : hasOpenAdset ? 'opacity-50' : 'opacity-75';
            return (
              <div key={campaign.id} className="border-b border-border last:border-0">
                <button
                  type="button"
                  onClick={() => toggle(openCampaigns, campaign.id, setOpenCampaigns)}
                  className={cn(
                    'flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors',
                    cOpen ? 'bg-surface-2' : 'bg-surface-2/60 hover:bg-surface-2',
                    campaignOpacity,
                  )}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ChevronRight
                      size={15}
                      className={cn('shrink-0 text-fg-muted transition-transform', cOpen && 'rotate-90')}
                    />
                    <span className="rounded bg-pink/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-pink">
                      Campaign
                    </span>
                    <span className="truncate text-sm font-semibold text-fg">{campaign.name}</span>
                  </div>
                  <div className="flex w-[150px] shrink-0 justify-center">
                    <StatusPill status={campaign.status} />
                  </div>
                  <MetricCells m={campaign} cols={cols} />
                </button>

                {cOpen && adsets.length === 0 && (
                  <div className="bg-bg px-5 py-3 pl-12 text-xs text-fg-dim">No ad sets match this filter.</div>
                )}

                {cOpen &&
                  adsets.map(adset => {
                    const sOpen = openAdsets.has(adset.id);
                    const ads = adset.ads.filter(a => passesFilter(a.status, filter));
                    return (
                      <div key={adset.id} className="border-t border-border/60 bg-bg">
                        <button
                          type="button"
                          onClick={() => toggle(openAdsets, adset.id, setOpenAdsets)}
                          className={cn(
                            'flex w-full items-center gap-3 border-l-2 border-border-strong px-5 py-2.5 pl-8 text-left transition-colors hover:bg-surface',
                            sOpen && 'opacity-75',
                          )}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <ChevronRight
                              size={13}
                              className={cn('shrink-0 text-fg-dim transition-transform', sOpen && 'rotate-90')}
                            />
                            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fg-muted">
                              Ad Set
                            </span>
                            <span className="truncate text-xs font-medium text-fg-muted">{adset.name}</span>
                          </div>
                          <div className="flex w-[150px] shrink-0 justify-center">
                            <StatusPill status={adset.status} />
                          </div>
                          <MetricCells m={adset} cols={cols} />
                        </button>

                        {sOpen && ads.length === 0 && (
                          <div className="px-5 py-2.5 pl-20 text-xs text-fg-dim">No ads match this filter.</div>
                        )}

                        {sOpen && ads.map(ad => <AdRow key={ad.id} ad={ad} cols={cols} />)}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AdRow({ ad, cols }: { ad: AdNode; cols: MetricKey[] }) {
  return (
    <div className="flex items-center gap-3 border-t border-border/40 border-l-2 border-l-border px-5 py-2.5 pl-14">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {ad.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ad.image_url}
            alt=""
            className="h-10 w-10 shrink-0 rounded-md border border-border object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2">
            <ImageOff size={14} className="text-fg-dim" />
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-fg-dim">
              Ad
            </span>
            <span className="truncate text-xs text-fg-muted">{ad.name}</span>
          </div>
          {ad.headline && <div className="mt-0.5 truncate text-[10px] text-fg-dim">{ad.headline}</div>}
        </div>
      </div>
      <div className="flex w-[150px] shrink-0 justify-center">
        <StatusPill status={ad.status} />
      </div>
      <MetricCells m={ad} cols={cols} />
    </div>
  );
}
