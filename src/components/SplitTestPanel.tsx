'use client';

import { useState, type ReactNode } from 'react';
import { Trophy, Copy, Check, SplitSquareHorizontal, Info, Radio, Gauge, Hourglass } from 'lucide-react';
import { setSplitTestStatus, declareSplitWinner, reopenSplitTest } from '@/app/actions/splitTests';
import type { SplitTest, VariantStat } from '@/lib/splitTests';
import { cn, formatNumber, formatPercent } from '@/lib/utils';

// The Split Test panel shown on a funnel's detail view: a verdict + confidence-to-95%
// read, a head-to-head of each version as its own funnel, and the config to paste.
export function SplitTestPanel({ test, baseUrl }: { test: SplitTest; baseUrl: string }) {
  const primaryLabel = test.primaryMetric === 'deposit' ? 'deposit' : 'opt-in';
  const leader = test.variants.find(v => v.key === test.leaderKey);
  const winner = test.winnerKey ? test.variants.find(v => v.key === test.winnerKey) : undefined;
  const decided = test.status === 'decided' && !!winner;
  const hasData = test.totalViews > 0;

  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><SplitSquareHorizontal size={16} className="text-pink" /></div>
          <div>
            <div className="text-sm font-semibold text-fg">Split test</div>
            <div className="text-[11px] text-fg-dim">{decided
              ? 'Winner declared'
              : `${formatNumber(test.totalViews)} ${test.totalViews === 1 ? 'visitor' : 'visitors'} · comparing ${primaryLabel} rate`}</div>
          </div>
        </div>
        {decided ? <DecidedControl funnelId={test.funnelId} /> : <StatusControl funnelId={test.funnelId} status={test.status} />}
      </div>

      {decided && winner ? (
        <DecidedFlow test={test} winner={winner} primaryLabel={primaryLabel} />
      ) : hasData ? (
        <>
          <Verdict test={test} leader={leader} primaryLabel={primaryLabel} />
          <div className={cn('mt-4 grid gap-3', test.variants.length > 2 ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2')}>
            {test.variants.map(v => (
              <VersionColumn
                key={v.key}
                v={v}
                funnelId={test.funnelId}
                primaryMetric={test.primaryMetric}
                isWinner={test.callable && v.key === test.leaderKey}
                isLeader={!test.callable && v.key === test.leaderKey && !!test.runnerUpKey}
                recommended={!!test.leaderKey && v.key === test.leaderKey}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-bg px-6 py-9 text-center">
          <Hourglass size={22} className="mx-auto mb-2 text-fg-dim" />
          <div className="text-sm font-medium text-fg">Waiting for the first visitors</div>
          <p className="mx-auto mt-1 max-w-sm text-xs text-fg-muted">Add the config below to your funnel. As soon as people land, each version&apos;s funnel appears here.</p>
        </div>
      )}

      <SnippetBar baseUrl={baseUrl} trackKey={test.trackKey} variantKeys={decided ? ['default'] : test.variants.map(v => v.key)} split={!decided} />
    </div>
  );
}

// After a winner is called: the funnel collapses back to a single flow for the winning version.
function DecidedFlow({ test, winner, primaryLabel }: { test: SplitTest; winner: VariantStat; primaryLabel: string }) {
  const heroRate = test.primaryMetric === 'deposit' ? winner.depositRate : winner.optinRate;
  return (
    <div>
      <div className="rounded-xl border border-green/40 bg-green/10 p-4">
        <div className="flex items-start gap-3">
          <Trophy size={18} className="mt-px shrink-0 text-green" />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-green"><span className="font-bold">{winner.label} won</span></div>
            <div className="mt-0.5 text-xs text-green/90">
              {test.upliftPct != null && test.upliftPct > 0 ? <>{formatPercent(test.upliftPct, 0)} higher {primaryLabel} rate · </> : null}
              this version is your funnel now
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-bg p-4">
        <div className="flex items-baseline gap-1.5">
          <span className="font-mono text-3xl font-bold tabular-nums text-fg">{heroRate != null ? formatPercent(heroRate * 100, 1) : '—'}</span>
          <span className="text-[11px] text-fg-dim">{primaryLabel} rate · {winner.label}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
          <StageStat label="Views" value={winner.views} />
          <StageStat label="Opt-ins" value={winner.optins} rate={winner.optinRate} />
          <StageStat label="Deposits" value={winner.deposits} rate={winner.depositRate} accent="pink" />
        </div>
      </div>
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

type Tone = 'green' | 'yellow' | 'muted';

// The headline read: winner / too close / gathering, plus a meter showing how far the
// confidence is from the 95% needed to call it.
function Verdict({ test, leader, primaryLabel }: { test: SplitTest; leader?: VariantStat; primaryLabel: string }) {
  const state: 'won' | 'running' | 'gathering' =
    test.callable ? 'won' : (test.leaderKey && test.runnerUpKey) ? 'running' : 'gathering';
  const tone: Tone = state === 'won' ? 'green' : state === 'running' ? 'yellow' : 'muted';
  const Icon = state === 'won' ? Trophy : state === 'running' ? Gauge : Hourglass;

  const box = { green: 'border-green/40 bg-green/10', yellow: 'border-yellow/40 bg-yellow/10', muted: 'border-border bg-bg' }[tone];
  const head = { green: 'text-green', yellow: 'text-yellow', muted: 'text-fg' }[tone];
  const subC = { green: 'text-green/90', yellow: 'text-yellow/90', muted: 'text-fg-muted' }[tone];

  let headline: ReactNode, sub: ReactNode;
  if (state === 'won' && leader) {
    headline = <><span className="font-bold">{leader.label}</span> wins</>;
    sub = <>{test.upliftPct != null && test.upliftPct > 0 ? <>{formatPercent(test.upliftPct, 0)} higher {primaryLabel} rate · </> : null}safe to call it now</>;
  } else if (state === 'running') {
    headline = <span className="font-bold">Too close to call</span>;
    sub = <>{leader ? <><span className="font-medium">{leader.label}</span> is ahead, but not yet certain — </> : null}keep it running</>;
  } else {
    headline = <span className="font-bold">Gathering data</span>;
    sub = <>Needs visits on both versions before a winner can show</>;
  }

  return (
    <div className={cn('rounded-xl border p-4', box)}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={cn('mt-px shrink-0', head)} />
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm', head)}>{headline}</div>
          <div className={cn('mt-0.5 text-xs', subC)}>{sub}</div>
        </div>
      </div>
      <ConfidenceMeter pct={test.confidencePct} tone={tone} />
    </div>
  );
}

// Confidence toward the 95% threshold, with a tick marking the line to cross.
function ConfidenceMeter({ pct, tone }: { pct: number | null; tone: Tone }) {
  const val = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  const fill = { green: 'bg-green', yellow: 'bg-yellow', muted: 'bg-fg/30' }[tone];
  return (
    <div className="mt-3.5">
      <div className="relative h-2 overflow-hidden rounded-full bg-border">
        <div className={cn('h-full rounded-full transition-[width] duration-500 ease-out', fill)} style={{ width: `${val}%` }} />
        <div className="absolute inset-y-0 w-px bg-fg/40" style={{ left: '95%' }} aria-hidden="true" />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] tabular-nums text-fg-dim">
        <span>{pct == null ? 'Needs both versions' : `${Math.round(val)}% confident`}</span>
        <span>95% to call it</span>
      </div>
    </div>
  );
}

// One version: the primary-metric rate as the hero, then the raw funnel counts —
// views → opt-ins → deposits — with each stage's conversion rate beneath it.
function VersionColumn({ v, funnelId, primaryMetric, isWinner, isLeader, recommended }: { v: VariantStat; funnelId: string; primaryMetric: 'deposit' | 'optin'; isWinner: boolean; isLeader: boolean; recommended: boolean }) {
  const heroRate = primaryMetric === 'deposit' ? v.depositRate : v.optinRate;
  const heroLabel = primaryMetric === 'deposit' ? 'deposit rate' : 'opt-in rate';
  return (
    <div className={cn('flex flex-col rounded-xl border p-4', isWinner ? 'border-green/50 bg-green/5' : 'border-border bg-bg')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-fg">{v.label}</span>
        {isWinner ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green"><Trophy size={11} /> Winner</span>
        ) : isLeader ? (
          <span className="rounded-full bg-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-fg-dim">Leading</span>
        ) : null}
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={cn('font-mono text-3xl font-bold tabular-nums', isWinner ? 'text-green' : 'text-fg')}>
          {heroRate != null ? formatPercent(heroRate * 100, 1) : '—'}
        </span>
        <span className="text-[11px] text-fg-dim">{heroLabel}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
        <StageStat label="Views" value={v.views} />
        <StageStat label="Opt-ins" value={v.optins} rate={v.optinRate} />
        <StageStat label="Deposits" value={v.deposits} rate={v.depositRate} accent={isWinner ? 'green' : 'pink'} />
      </div>

      <DeclareButton funnelId={funnelId} variantKey={v.key} variantLabel={v.label} recommended={recommended} />
    </div>
  );
}

function DeclareButton({ funnelId, variantKey, variantLabel, recommended }: { funnelId: string; variantKey: string; variantLabel: string; recommended: boolean }) {
  const [pending, setPending] = useState(false);
  const declare = async () => {
    if (!window.confirm(`Declare ${variantLabel} the winner?\n\nThis ends the test and shows the funnel as a single flow. You can reopen it later.`)) return;
    setPending(true);
    await declareSplitWinner(funnelId, variantKey);
    setPending(false);
  };
  return (
    <button
      onClick={declare}
      disabled={pending}
      className={cn(
        'mt-3 w-full rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50',
        recommended
          ? 'bg-green/15 text-green hover:bg-green/25'
          : 'border border-border text-fg-muted hover:border-border-strong hover:text-fg',
      )}
    >
      {pending ? 'Declaring…' : recommended ? 'Declare winner' : 'Make this the winner'}
    </button>
  );
}

function DecidedControl({ funnelId }: { funnelId: string }) {
  const [pending, setPending] = useState(false);
  const reopen = async () => { setPending(true); await reopenSplitTest(funnelId); setPending(false); };
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full border border-green/40 bg-green/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green">Decided</span>
      <button
        onClick={reopen}
        disabled={pending}
        className="rounded-lg border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50"
      >
        {pending ? 'Reopening…' : 'Reopen test'}
      </button>
    </div>
  );
}

function StageStat({ label, value, rate, accent }: { label: string; value: number; rate?: number | null; accent?: 'green' | 'pink' }) {
  const valColor = accent === 'green' ? 'text-green' : accent === 'pink' ? 'text-pink' : 'text-fg';
  return (
    <div className="px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={cn('mt-0.5 font-mono text-base font-bold tabular-nums', valColor)}>{formatNumber(value)}</div>
      <div className="text-[10px] tabular-nums text-fg-dim">{rate != null ? `${formatPercent(rate * 100, 1)} of views` : ' '}</div>
    </div>
  );
}

// Running ⇄ Paused. "Decided" isn't a manual option — it's reached by declaring a winner.
function StatusControl({ funnelId, status }: { funnelId: string; status: 'off' | 'running' | 'decided' }) {
  const [pending, setPending] = useState(false);
  const running = status === 'running';
  const toggle = async () => {
    setPending(true);
    await setSplitTestStatus(funnelId, running ? 'off' : 'running');
    setPending(false);
  };
  return (
    <button
      onClick={toggle}
      disabled={pending}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-50',
        running ? 'border-green/40 bg-green/15 text-green hover:bg-green/25' : 'border-border bg-bg text-fg-dim hover:text-fg',
      )}
      title={running ? 'Pause the test' : 'Resume the test'}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', running ? 'bg-green' : 'bg-fg-dim')} />
      {running ? 'Running' : 'Paused'}
    </button>
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
