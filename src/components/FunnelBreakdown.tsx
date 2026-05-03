'use client';

import { useState } from 'react';
import { ChevronRight, GitBranch, FlaskConical } from 'lucide-react';
import { FunnelBreakdown as FunnelBreakdownData, FunnelStep } from '@/lib/queries';
import { formatGBP, formatNumber, cn } from '@/lib/utils';

export function FunnelBreakdown({ funnels }: { funnels: FunnelBreakdownData[] }) {
  if (funnels.length === 0) {
    return (
      <section className="mb-10">
        <SectionHeader />
        <div className="rounded-xl border border-border bg-surface p-6 text-sm text-fg-muted">
          No GHL funnels synced for this client yet. Funnels appear once the GHL Private Integration
          Token has <span className="font-mono">funnels.readonly</span> +{' '}
          <span className="font-mono">payments/transactions.readonly</span> scopes and the next sync runs.
        </div>
      </section>
    );
  }

  return (
    <section className="mb-10">
      <SectionHeader />
      <div className="space-y-3">
        {funnels.map(f => (
          <FunnelCard key={f.funnel_id} funnel={f} />
        ))}
      </div>
    </section>
  );
}

function SectionHeader() {
  return (
    <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-fg-muted">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-pink" />
      Funnel Breakdown
    </div>
  );
}

function FunnelCard({ funnel }: { funnel: FunnelBreakdownData }) {
  const [open, setOpen] = useState(funnel.total_deposits > 0);
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border bg-surface',
        funnel.is_synthetic ? 'border-dashed border-border-strong' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-surface-2"
      >
        <ChevronRight
          size={16}
          className={cn('text-fg-dim transition-transform', open && 'rotate-90')}
        />
        <div className="min-w-0 flex-1">
          <div className={cn('font-medium', funnel.is_synthetic ? 'text-fg-muted' : 'text-fg')}>
            {funnel.funnel_name}
          </div>
          <div className="text-xs text-fg-muted">
            {funnel.is_synthetic
              ? 'Direct payment links / one-step order forms not tied to a funnel'
              : `${funnel.steps.length} steps · ${funnel.steps.filter(s => s.has_variations).length} with A/B`}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg tabular-nums text-fg">
            {formatNumber(funnel.total_deposits)}
          </div>
          <div className="text-xs text-fg-muted">deposits</div>
        </div>
        <div className="w-24 text-right">
          <div className="font-mono text-lg tabular-nums text-pink">
            {formatGBP(funnel.total_amount_gbp, { decimals: 0 })}
          </div>
          <div className="text-xs text-fg-muted">collected</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-border">
          {funnel.steps.map(step => (
            <StepRow key={step.step_id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: FunnelStep }) {
  return (
    <div className="border-b border-border/50 last:border-0">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="font-mono text-xs text-fg-dim w-6">
          {step.step_sequence != null ? String(step.step_sequence).padStart(2, '0') : '—'}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="truncate text-sm text-fg">{step.step_name}</div>
          {step.has_variations && (
            <span
              className="inline-flex items-center gap-1 rounded bg-pink/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-pink"
              title="A/B test running on this step"
            >
              <GitBranch size={10} /> A/B
            </span>
          )}
        </div>
        <div className="w-20 text-right font-mono text-sm tabular-nums text-fg">
          {step.step_deposits > 0 ? formatNumber(step.step_deposits) : <span className="text-fg-dim">—</span>}
        </div>
        <div className="w-24 text-right font-mono text-sm tabular-nums text-fg">
          {step.step_amount_gbp > 0 ? formatGBP(step.step_amount_gbp, { decimals: 0 }) : <span className="text-fg-dim">—</span>}
        </div>
      </div>

      {step.pages.length > 1 && (
        <div className="bg-surface-2/50 px-5 pb-3">
          {step.pages.map(p => (
            <div key={p.page_id} className="flex items-center gap-3 py-1.5 pl-9">
              <FlaskConical size={11} className="text-fg-dim" />
              <div className="flex-1 truncate text-xs text-fg-muted">{p.page_name}</div>
              <div className="w-20 text-right font-mono text-xs tabular-nums text-fg-muted">
                {p.deposits > 0 ? formatNumber(p.deposits) : <span className="text-fg-dim">—</span>}
              </div>
              <div className="w-24 text-right font-mono text-xs tabular-nums text-fg-muted">
                {p.amount_gbp > 0 ? formatGBP(p.amount_gbp, { decimals: 0 }) : <span className="text-fg-dim">—</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
