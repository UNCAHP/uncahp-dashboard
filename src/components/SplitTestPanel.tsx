'use client';

import { useState, type ReactNode } from 'react';
import { Trophy, Copy, Check, SplitSquareHorizontal, Info, Radio } from 'lucide-react';
import { setSplitTestStatus } from '@/app/actions/splitTests';
import type { SplitTest, VariantStat } from '@/lib/splitTests';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

// The Split Test panel shown on a funnel's detail view: the snippet to paste, the live
// status control, and the per-version scoreboard with a "can you call it yet?" read.
export function SplitTestPanel({ test, baseUrl }: { test: SplitTest; baseUrl: string }) {
  const metricLabel = test.primaryMetric === 'deposit' ? 'deposit' : 'opt-in';
  const leader = test.variants.find(v => v.key === test.leaderKey);
  const maxRate = Math.max(
    ...test.variants.map(v => (test.primaryMetric === 'deposit' ? v.depositRate : v.optinRate) ?? 0),
    0.0001,
  );

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><SplitSquareHorizontal size={16} className="text-pink" /></div>
          <div>
            <div className="text-sm font-semibold text-fg">Split test</div>
            <div className="text-[11px] text-fg-dim">{formatNumber(test.totalViews)} visitors · comparing {metricLabel} rate</div>
          </div>
        </div>
        <StatusControl funnelId={test.funnelId} status={test.status} />
      </div>

      <CallBanner test={test} leader={leader} metricLabel={metricLabel} />

      <div className="mt-4 space-y-2.5">
        {test.variants.map(v => (
          <VariantRow key={v.key} v={v} metric={test.primaryMetric} maxRate={maxRate} isLeader={v.key === test.leaderKey && test.callable} />
        ))}
      </div>

      <SnippetBar baseUrl={baseUrl} trackKey={test.trackKey} variantKeys={test.variants.map(v => v.key)} split />
    </div>
  );
}

// Measure-only funnels (no A/B): show the accumulating first-party counts as a Meta backup.
export function TrackingPanel({ test, baseUrl, metaLpViews }: { test: SplitTest; baseUrl: string; metaLpViews: number | null }) {
  const views = test.totalViews;
  const optins = test.variants.reduce((s, v) => s + v.optins, 0);
  const deposits = test.variants.reduce((s, v) => s + v.deposits, 0);
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><Radio size={16} className="text-pink" /></div>
        <div>
          <div className="text-sm font-semibold text-fg">First-party tracking <span className="ml-1 rounded bg-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fg-dim">backup</span></div>
          <div className="text-[11px] text-fg-dim">Recorded directly from the funnel — building history to eventually replace Meta&apos;s numbers.</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="LP views" value={formatNumber(views)} />
        <Stat label="Opt-ins" value={formatNumber(optins)} sub={views ? formatPercent((optins / views) * 100, 1) : undefined} />
        <Stat label="Deposits" value={formatNumber(deposits)} sub={views ? formatPercent((deposits / views) * 100, 1) : undefined} accent />
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-bg px-3.5 py-2.5 text-xs text-fg-muted">
        <Info size={15} className="mt-px shrink-0" />
        <span>
          {views === 0
            ? 'No visits recorded yet — paste the snippet below and first-party data will start building here.'
            : <>Meta currently reports <span className="font-semibold text-fg">{metaLpViews == null ? '—' : formatNumber(metaLpViews)}</span> LP views for this funnel; you&apos;ve recorded <span className="font-semibold text-fg">{formatNumber(views)}</span> first-party. They won&apos;t match exactly — that&apos;s expected. Let it build over the coming months, then switch this funnel&apos;s source over.</>}
        </span>
      </div>

      <SnippetBar baseUrl={baseUrl} trackKey={test.trackKey} variantKeys={['default']} split={false} />
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg px-3.5 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-xl font-bold tabular-nums', accent ? 'text-pink' : 'text-fg')}>{value}</div>
      {sub && <div className="text-[10px] text-fg-dim">{sub} of views</div>}
    </div>
  );
}

function CallBanner({ test, leader, metricLabel }: { test: SplitTest; leader?: VariantStat; metricLabel: string }) {
  if (test.totalViews === 0) {
    return <Banner tone="neutral" icon={<Info size={16} className="shrink-0" />}>No visitors yet. Paste the snippet below into this funnel and results appear here automatically.</Banner>;
  }
  if (test.callable && leader) {
    return (
      <Banner tone="good" icon={<Trophy size={16} className="shrink-0" />}>
        <span className="font-semibold">{leader.label} wins.</span>{' '}
        {formatPercent(test.confidencePct, 0)} confident
        {test.upliftPct != null && test.upliftPct > 0 && <> · {formatPercent(test.upliftPct, 0)} higher {metricLabel} rate</>}
        {' '}— safe to call it.
      </Banner>
    );
  }
  if (test.leaderKey && test.runnerUpKey) {
    return (
      <Banner tone="warn">
        <span className="font-semibold">Too close to call.</span>{' '}
        {test.confidencePct != null ? <>{formatPercent(test.confidencePct, 0)} confident so far — </> : null}
        keep it running until you reach 95% confidence with at least ~30 visitors per version.
      </Banner>
    );
  }
  return <Banner tone="neutral" icon={<Info size={16} className="shrink-0" />}>Only one version has traffic so far — give it time to split.</Banner>;
}

function Banner({ tone, icon, children }: { tone: 'good' | 'warn' | 'neutral'; icon?: ReactNode; children: ReactNode }) {
  const styles = {
    good: 'border-green/40 bg-green/10 text-green',
    warn: 'border-yellow/40 bg-yellow/10 text-yellow',
    neutral: 'border-border bg-bg text-fg-muted',
  }[tone];
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm', styles)}>
      {icon}
      <span>{children}</span>
    </div>
  );
}

function VariantRow({ v, metric, maxRate, isLeader }: { v: VariantStat; metric: 'deposit' | 'optin'; maxRate: number; isLeader: boolean }) {
  const rate = (metric === 'deposit' ? v.depositRate : v.optinRate) ?? 0;
  const barPct = Math.max(2, Math.round((rate / maxRate) * 100));
  return (
    <div className={cn('rounded-lg border px-3.5 py-3', isLeader ? 'border-green/50 bg-green/5' : 'border-border bg-bg')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {isLeader && <Trophy size={13} className="text-green" />}
          <span className="text-sm font-semibold text-fg">{v.label}</span>
        </div>
        <div className="flex items-center gap-5 text-right">
          <Metric label="Visitors" value={formatNumber(v.views)} />
          <Metric label={`Opt-ins · ${formatNumber(v.optins)}`} value={v.optinRate != null ? formatPercent(v.optinRate * 100, 1) : '—'} />
          <Metric label={`Deposits · ${formatNumber(v.deposits)}`} value={v.depositRate != null ? formatPercent(v.depositRate * 100, 1) : '—'} />
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div className={cn('h-full rounded-full', isLeader ? 'bg-green' : 'bg-pink')} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[68px]">
      <div className="text-sm font-semibold tabular-nums text-fg">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-fg-dim">{label}</div>
    </div>
  );
}

function StatusControl({ funnelId, status }: { funnelId: string; status: 'off' | 'running' | 'decided' }) {
  const [pending, setPending] = useState(false);
  const set = async (next: 'off' | 'running' | 'decided') => {
    setPending(true);
    await setSplitTestStatus(funnelId, next);
    setPending(false);
  };
  const pill = {
    running: 'bg-green/15 text-green border-green/40',
    decided: 'bg-pink/15 text-pink border-pink/40',
    off: 'bg-border text-fg-dim border-border',
  }[status];
  return (
    <div className="flex items-center gap-2">
      <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', pill)}>
        {status === 'off' ? 'Paused' : status}
      </span>
      <select
        value={status}
        disabled={pending}
        onChange={e => set(e.target.value as 'off' | 'running' | 'decided')}
        className="rounded-lg border border-border bg-bg px-2 py-1 text-xs text-fg focus:border-border-strong focus:outline-none"
        aria-label="Test status"
      >
        <option value="running">Running</option>
        <option value="decided">Decided</option>
        <option value="off">Paused</option>
      </select>
    </div>
  );
}

function SnippetBar({ baseUrl, trackKey, variantKeys, split }: { baseUrl: string; trackKey: string; variantKeys: string[]; split: boolean }) {
  const config = `const UNCAHP_TRACK_URL = '${baseUrl}/api/track';\nconst UNCAHP_TRACK_KEY  = '${trackKey}';\nconst UNCAHP_VARIANTS   = [${variantKeys.map(k => `'${k}'`).join(', ')}];`;
  return (
    <div className="mt-4 rounded-lg border border-border bg-bg p-3">
      <CopyLine
        title="Funnel config"
        snippet={config}
        hint={split
          ? <>Add to the funnel&apos;s constants block. Claude wires the view / opt-in / deposit tracking and renders each version via <code className="rounded bg-surface px-1 font-mono">uncahpVariant()</code> from the funnel-builder spec.</>
          : <>Add to the funnel&apos;s constants block. Claude wires the view / opt-in / deposit tracking from the funnel-builder spec — nothing else to change.</>}
      />
    </div>
  );
}

function CopyLine({ title, snippet, hint }: { title: string; snippet: string; hint: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">{title}</span>
        <button onClick={copy} className="flex items-center gap-1.5 rounded-md bg-pink px-2.5 py-1 text-[11px] font-semibold text-black hover:opacity-90">
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="block overflow-x-auto whitespace-pre rounded bg-surface px-2 py-1.5 font-mono text-[11px] text-fg-muted">{snippet}</code>
      <p className="mt-1.5 text-[11px] text-fg-dim">{hint}</p>
    </div>
  );
}
