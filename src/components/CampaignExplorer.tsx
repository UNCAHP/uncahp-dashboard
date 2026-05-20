'use client';

import { useState } from 'react';
import { ChevronRight, ImageOff } from 'lucide-react';
import type { CampaignNode, AdsetNode, AdNode, CampaignMetrics } from '@/lib/queries';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

type StatusFilter = 'all' | 'active' | 'paused';

const METRIC_COLS = ['Spend', 'Clicks', 'CTR', 'Leads', 'CPL', 'Bookings', 'Conv', 'CAC', 'ROI'];

function passesFilter(status: string, filter: StatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'active') return status === 'ACTIVE';
  return status !== 'ACTIVE';
}

function StatusPill({ status }: { status: string }) {
  const active = status === 'ACTIVE';
  const archived = status === 'ARCHIVED';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider',
        active ? 'bg-green/10 text-green' : archived ? 'bg-surface-2 text-fg-dim' : 'bg-yellow/10 text-yellow',
      )}
    >
      <span className={cn('h-1 w-1 rounded-full', active ? 'bg-green' : archived ? 'bg-fg-dim' : 'bg-yellow')} />
      {active ? 'On' : archived ? 'Archived' : 'Off'}
    </span>
  );
}

function MetricCells({ m }: { m: CampaignMetrics }) {
  const cell = (content: React.ReactNode, className?: string) => (
    <div className={cn('w-[76px] shrink-0 text-right font-mono text-xs tabular-nums', className)}>{content}</div>
  );
  return (
    <>
      {cell(formatGBP(m.spend_gbp, { decimals: 0 }), 'text-fg')}
      {cell(formatNumber(m.clicks), 'text-fg-muted')}
      {cell(m.ctr_pct != null ? `${m.ctr_pct}%` : '—', 'text-fg-muted')}
      {cell(formatNumber(m.leads), 'text-fg')}
      {cell(m.cpl_gbp != null ? formatGBP(m.cpl_gbp, { decimals: 2 }) : '—', 'text-fg')}
      {cell(m.bookings > 0 ? formatNumber(m.bookings) : '—', 'text-pink')}
      {cell(m.conv_rate_pct != null ? `${m.conv_rate_pct}%` : '—', 'text-fg')}
      {cell(m.cac_gbp != null ? formatGBP(m.cac_gbp, { decimals: 2 }) : '—', 'text-fg')}
      {cell(m.roi != null ? `${m.roi.toFixed(2)}x` : '—', 'text-fg-dim')}
    </>
  );
}

export function CampaignExplorer({ campaigns }: { campaigns: CampaignNode[] }) {
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [openCampaigns, setOpenCampaigns] = useState<Set<string>>(new Set());
  const [openAdsets, setOpenAdsets] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const visibleCampaigns = campaigns.filter(c => passesFilter(c.status, filter));

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <div className="text-sm font-semibold text-fg">Campaigns</div>
          <div className="mt-0.5 text-xs text-fg-muted">
            Drill in: campaign → ad sets → ad creative. Leads &amp; bookings traced via UTM.
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-bg p-1">
          {(['all', 'active', 'paused'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                filter === f ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Column header */}
      <div className="flex items-center gap-3 border-b border-border px-5 py-2.5">
        <div className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
          Campaign / Ad Set / Ad
        </div>
        <div className="w-24 shrink-0 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Status</div>
        {METRIC_COLS.map(c => (
          <div key={c} className="w-[76px] shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
            {c}
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
            return (
              <div key={campaign.id} className="border-b border-border/50 last:border-0">
                {/* Campaign row */}
                <button
                  type="button"
                  onClick={() => toggle(openCampaigns, campaign.id, setOpenCampaigns)}
                  className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-2"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <ChevronRight
                      size={14}
                      className={cn('shrink-0 text-fg-dim transition-transform', cOpen && 'rotate-90')}
                    />
                    <span className="truncate text-sm font-medium text-fg">{campaign.name}</span>
                  </div>
                  <div className="w-24 shrink-0">
                    <StatusPill status={campaign.status} />
                  </div>
                  <MetricCells m={campaign} />
                </button>

                {cOpen && adsets.length === 0 && (
                  <div className="px-5 py-3 pl-12 text-xs text-fg-dim">No ad sets match this filter.</div>
                )}

                {cOpen &&
                  adsets.map(adset => {
                    const sOpen = openAdsets.has(adset.id);
                    const ads = adset.ads.filter(a => passesFilter(a.status, filter));
                    return (
                      <div key={adset.id} className="bg-surface-2/30">
                        {/* Ad set row */}
                        <button
                          type="button"
                          onClick={() => toggle(openAdsets, adset.id, setOpenAdsets)}
                          className="flex w-full items-center gap-3 px-5 py-2.5 pl-9 text-left transition-colors hover:bg-surface-2"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <ChevronRight
                              size={13}
                              className={cn('shrink-0 text-fg-dim transition-transform', sOpen && 'rotate-90')}
                            />
                            <span className="truncate text-xs text-fg-muted">{adset.name}</span>
                          </div>
                          <div className="w-24 shrink-0">
                            <StatusPill status={adset.status} />
                          </div>
                          <MetricCells m={adset} />
                        </button>

                        {sOpen && ads.length === 0 && (
                          <div className="px-5 py-2.5 pl-16 text-xs text-fg-dim">No ads match this filter.</div>
                        )}

                        {sOpen &&
                          ads.map(ad => <AdRow key={ad.id} ad={ad} />)}
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

function AdRow({ ad }: { ad: AdNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-border/30 px-5 py-2.5 pl-16">
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
          <div className="truncate text-xs font-medium text-fg">{ad.name}</div>
          {ad.headline && <div className="truncate text-[10px] text-fg-dim">{ad.headline}</div>}
        </div>
      </div>
      <div className="w-24 shrink-0">
        <StatusPill status={ad.status} />
      </div>
      <MetricCells m={ad} />
    </div>
  );
}
