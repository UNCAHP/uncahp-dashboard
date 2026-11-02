'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ExternalLink, Play, Search, Megaphone, LayoutGrid, Rows3, ArrowDown, ArrowUp, Copy, X, ChevronRight,
} from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { Offer, OffersResult } from '@/lib/offers';
import type { FunnelPageLink } from '@/lib/funnelAdmin';
import { Modal } from '@/components/Modal';
import { NavLink } from '@/components/NavProgress';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

// ─── Offers: what's live in every client's Meta ad account ───────────────────
// One card per live campaign, grouped by client, or the same offers as one sortable
// table. The sidebar's client list narrows it to one account (?client=); any offer opens in full (every ad, every
// headline and copy variant with a copy button, and where the ads send people). Spend and
// leads are for the selected range. Read-only, so setters can check what a lead enquired
// about.

type Dest = 'all' | 'page' | 'form';
type Layout = 'cards' | 'table';
type SortKey = 'client' | 'offer' | 'spend' | 'leads' | 'cpl';

const LAYOUT_KEY = 'offers-layout';
const NEW_DAYS = 7;

const DEST_LABEL: Record<NonNullable<Offer['destination']>, string> = {
  page: 'Landing page',
  form: 'Instant form',
  both: 'Form + landing page',
};

const cplOf = (o: Offer) => (o.leads > 0 ? o.spend / o.leads : null);
const isNew = (o: Offer) => !!o.createdAt && Date.now() - Date.parse(o.createdAt) < NEW_DAYS * 86_400_000;
const pagesOf = (o: Offer): FunnelPageLink[] =>
  o.funnel?.pages.length ? o.funnel.pages : o.links.map(url => ({ name: 'Landing page', url }));

function copy(text: string, what: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error(`Couldn't copy the ${what.toLowerCase()}`),
  );
}

export function OffersView({ data, clients, client, rangeLabel, since, until }: {
  data: OffersResult; clients: ClientOption[]; client: string | null; rangeLabel: string; since: string; until: string;
}) {
  const [q, setQ] = useState('');
  const [dest, setDest] = useState<Dest>('all');
  const [layout, setLayoutState] = useState<Layout>('cards');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'spend', desc: true });
  const [openId, setOpenId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(clients.map(c => [c.client_id, c])), [clients]);
  const nameOf = (id: string) => byId.get(id)?.client_name ?? id;

  // Remember Cards / Table per browser.
  useEffect(() => {
    const saved = localStorage.getItem(LAYOUT_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved === 'cards' || saved === 'table') setLayoutState(saved);
  }, []);
  const setLayout = (l: Layout) => { setLayoutState(l); localStorage.setItem(LAYOUT_KEY, l); };

  // "/" jumps to search, as in most tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== '/' || t?.closest('input, textarea, [contenteditable]')) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.offers.filter(o => {
      if (dest === 'page' && o.destination !== 'page' && o.destination !== 'both') return false;
      if (dest === 'form' && o.destination !== 'form' && o.destination !== 'both') return false;
      if (!needle) return true;
      return [byId.get(o.clientId)?.client_name ?? '', o.name, ...o.headlines].some(s => s.toLowerCase().includes(needle));
    });
  }, [data.offers, q, dest, byId]);

  const groups = useMemo(() => {
    const map = new Map<string, Offer[]>();
    for (const o of shown) map.set(o.clientId, [...(map.get(o.clientId) ?? []), o]);
    return [...map.entries()]
      .map(([clientId, offers]) => ({ clientId, offers, spend: offers.reduce((s, o) => s + o.spend, 0) }))
      .sort((a, b) => b.spend - a.spend);
  }, [shown]);

  const rows = useMemo(() => {
    const val = (o: Offer): string | number | null =>
      sort.key === 'client' ? (byId.get(o.clientId)?.client_name ?? o.clientId).toLowerCase()
        : sort.key === 'offer' ? o.name.toLowerCase()
          : sort.key === 'cpl' ? cplOf(o)
            : o[sort.key];
    return [...shown].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === y) return b.spend - a.spend;
      if (x === null) return 1;            // no leads, no cost per lead: always last
      if (y === null) return -1;
      const c = x < y ? -1 : 1;
      return sort.desc ? -c : c;
    });
  }, [shown, sort, byId]);
  const sortBy = (key: SortKey) =>
    setSort(s => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'spend' || key === 'leads' }));

  const filtered = !!q.trim() || dest !== 'all';
  const clearAll = () => { setQ(''); setDest('all'); };
  const allClientsHref = `/?${new URLSearchParams({ view: 'offers', since, until })}`;
  const open = openId ? data.offers.find(o => o.campaignId === openId) ?? null : null;
  const failed = data.errors.map(e => byId.get(e.clientId)?.client_name ?? (e.clientId || null)).filter(Boolean);

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Controls */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
            <input ref={search} value={q} onChange={e => setQ(e.target.value)} placeholder="Search client, offer or headline"
              onKeyDown={e => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }}
              className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-14 text-sm text-fg placeholder:text-fg-dim focus:border-pink/50 focus:outline-none" />
            {q ? (
              <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-fg-dim hover:text-fg"><X size={14} /></button>
            ) : (
              <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 text-[10px] text-fg-dim">/</kbd>
            )}
          </label>
          <Segmented value={dest} onChange={setDest} label="Where the ads go"
            options={[['all', 'All'], ['page', 'Landing page'], ['form', 'Instant form']]} />
          <div className="ml-auto">
            <Segmented value={layout} onChange={setLayout} label="Layout"
              options={[['cards', 'Cards', LayoutGrid], ['table', 'Table', Rows3]]} />
          </div>
        </div>

        <p className="text-xs text-fg-dim">
          <span className="font-semibold text-fg-muted">{shown.length}</span> live {shown.length === 1 ? 'offer' : 'offers'}
          {client
            ? <> for <span className="font-semibold text-fg-muted">{nameOf(client)}</span> · <NavLink href={allClientsHref} className="font-medium text-pink hover:underline">All clients</NavLink></>
            : <>{' '}across <span className="font-semibold text-fg-muted">{groups.length}</span> {groups.length === 1 ? 'client' : 'clients'} · pick one in the sidebar to see just theirs</>}
          {' '}· spend and leads for {rangeLabel.toLowerCase()}
          {filtered && <> · <button onClick={clearAll} className="font-medium text-pink hover:underline">Clear filters</button></>}
        </p>
      </div>

      {shown.length === 0 && (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center text-sm text-fg-muted">
          {data.offers.length === 0 ? (client ? `${nameOf(client)} has no live offers right now.` : 'No offers are live in any client ad account right now.') : (
            <>No live offers match. <button onClick={clearAll} className="font-medium text-pink hover:underline">Clear filters</button></>
          )}
        </div>
      )}

      {layout === 'table' && rows.length > 0 && (
        <OffersTable rows={rows} nameOf={nameOf} byId={byId} sort={sort} sortBy={sortBy} onOpen={setOpenId} />
      )}

      {layout === 'cards' && groups.map(g => {
        const c = byId.get(g.clientId);
        return (
          <section key={g.clientId} aria-label={nameOf(g.clientId)}>
            <div className="mb-3 flex items-center gap-3">
              <ClientBadge c={c} id={g.clientId} />
              <h2 className="text-base font-bold tracking-tight text-fg">{nameOf(g.clientId)}</h2>
              <span className="text-xs text-fg-dim">{g.offers.length} live · {formatGBP(g.spend)}</span>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {g.offers.map(o => <OfferCard key={o.campaignId} o={o} onOpen={() => setOpenId(o.campaignId)} />)}
            </div>
          </section>
        );
      })}

      {failed.length > 0 && (
        <p className="border-t border-border pt-4 text-xs text-fg-dim">
          Couldn&apos;t read the ads for {failed.join(', ')}: Meta says the ad account hasn&apos;t given the agency access to its ads.
        </p>
      )}

      {open && <OfferDetail o={open} clientName={nameOf(open.clientId)} rangeLabel={rangeLabel} onClose={() => setOpenId(null)} />}
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

const THUMBS = 6;

function OfferCard({ o, onOpen }: { o: Offer; onOpen: () => void }) {
  const pages = pagesOf(o);
  const extra = o.ads.length - THUMBS;
  return (
    <article className="flex flex-col rounded-2xl border border-border bg-surface p-5 transition-colors hover:border-pink/40">
      <header className="flex items-start justify-between gap-3">
        <button onClick={onOpen} className="min-w-0 text-left">
          <h3 className="text-sm font-semibold leading-snug text-fg hover:text-pink">{o.name}</h3>
          {o.funnel && <p className="mt-0.5 truncate text-xs text-fg-muted">Funnel: {o.funnel.name}</p>}
        </button>
        <OfferTags o={o} />
      </header>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
        {o.ads.slice(0, THUMBS).map(ad => <AdThumb key={ad.id} ad={ad} />)}
        {extra > 0 && (
          <button onClick={onOpen} className="flex h-24 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-xs text-fg-muted hover:border-pink/50 hover:text-pink">+{extra}</button>
        )}
      </div>

      {(o.headlines[0] || o.bodies[0]) && (
        <div className="mt-4 text-sm">
          {o.headlines[0] && <p className="font-semibold text-fg">{o.headlines[0]}</p>}
          {o.bodies[0] && <p className="mt-1 line-clamp-3 whitespace-pre-line text-fg-muted">{o.bodies[0]}</p>}
        </div>
      )}

      {pages.length > 0 && <PageLinks pages={pages} className="mt-4" />}

      <div className="min-h-5 flex-1" />
      <div className="flex items-end justify-between gap-4 border-t border-border pt-4">
        <dl className="grid flex-1 grid-cols-3 gap-3">
          <Stat label="Spend" value={formatGBP(o.spend)} />
          <Stat label="Leads" value={formatNumber(o.leads)} />
          <Stat label="Cost per lead" value={formatGBP(cplOf(o), { decimals: 2 })} />
        </dl>
        <button onClick={onOpen} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-fg-muted hover:text-pink">
          Full offer <ChevronRight size={14} />
        </button>
      </div>
    </article>
  );
}

// ─── Table ───────────────────────────────────────────────────────────────────

function OffersTable({ rows, nameOf, byId, sort, sortBy, onOpen }: {
  rows: Offer[];
  nameOf: (id: string) => string;
  byId: Map<string, ClientOption>;
  sort: { key: SortKey; desc: boolean };
  sortBy: (k: SortKey) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="border-b border-border text-left text-xs text-fg-muted">
          <tr>
            <SortTh k="client" sort={sort} sortBy={sortBy}>Client</SortTh>
            <SortTh k="offer" sort={sort} sortBy={sortBy}>Offer</SortTh>
            <th className="px-3 py-2.5 font-semibold">Ads</th>
            <th className="px-3 py-2.5 font-semibold">Goes to</th>
            <SortTh k="spend" sort={sort} sortBy={sortBy} right>Spend</SortTh>
            <SortTh k="leads" sort={sort} sortBy={sortBy} right>Leads</SortTh>
            <SortTh k="cpl" sort={sort} sortBy={sortBy} right>Cost per lead</SortTh>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(o => {
            const pages = pagesOf(o);
            return (
              // The whole row opens the offer; links and thumbnails inside keep their own clicks.
              <tr key={o.campaignId} onClick={e => { if (!(e.target as HTMLElement).closest('a, button')) onOpen(o.campaignId); }}
                className="cursor-pointer align-middle transition-colors hover:bg-pink/[0.04]">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <ClientBadge c={byId.get(o.clientId)} id={o.clientId} />
                    <span className="font-medium text-fg">{nameOf(o.clientId)}</span>
                  </div>
                </td>
                <td className="max-w-[320px] px-3 py-3">
                  <button onClick={() => onOpen(o.campaignId)} className="text-left font-medium text-fg hover:text-pink">{o.name}</button>
                  {isNew(o) && <NewTag className="ml-2" />}
                  {o.headlines[0] && <p className="mt-0.5 truncate text-xs text-fg-muted" title={o.headlines[0]}>{o.headlines[0]}</p>}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-1.5">
                    {o.ads.slice(0, 3).map(ad => <AdThumb key={ad.id} ad={ad} size="sm" />)}
                    {o.ads.length > 3 && <span className="text-xs text-fg-dim">+{o.ads.length - 3}</span>}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <p className="text-xs text-fg-muted">{o.destination ? DEST_LABEL[o.destination] : '—'}</p>
                  {pages.length > 0 && <PageLinks pages={pages} className="mt-0.5" />}
                </td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-fg">{formatGBP(o.spend)}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-fg">{formatNumber(o.leads)}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-fg">{formatGBP(cplOf(o), { decimals: 2 })}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortTh({ k, sort, sortBy, right = false, children }: {
  k: SortKey; sort: { key: SortKey; desc: boolean }; sortBy: (k: SortKey) => void; right?: boolean; children: string;
}) {
  const on = sort.key === k;
  const Arrow = sort.desc ? ArrowDown : ArrowUp;
  return (
    <th className={cn('px-3 py-2.5 font-semibold', right && 'text-right')} aria-sort={on ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button onClick={() => sortBy(k)} className={cn('inline-flex items-center gap-1 hover:text-fg', on && 'text-fg', right && 'flex-row-reverse')}>
        {children} {on && <Arrow size={12} />}
      </button>
    </th>
  );
}

// ─── Full offer ──────────────────────────────────────────────────────────────

function OfferDetail({ o, clientName, rangeLabel, onClose }: { o: Offer; clientName: string; rangeLabel: string; onClose: () => void }) {
  const pages = pagesOf(o);
  return (
    <Modal title={`${clientName} · ${o.name}`} icon={Megaphone} onClose={onClose}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <OfferTags o={o} />
          {o.funnel && <span className="text-xs text-fg-muted">Funnel: {o.funnel.name}</span>}
        </div>

        <dl className="grid grid-cols-3 gap-3 rounded-xl border border-border bg-bg/40 p-4">
          <Stat label="Spend" value={formatGBP(o.spend)} />
          <Stat label="Leads" value={formatNumber(o.leads)} />
          <Stat label="Cost per lead" value={formatGBP(cplOf(o), { decimals: 2 })} />
          <p className="col-span-3 text-[11px] text-fg-dim">{rangeLabel} · leads as Meta reports them</p>
        </dl>

        {pages.length > 0 && (
          <DetailSection title="Where the ads send people">
            <ul className="space-y-1.5">
              {pages.map(p => (
                <li key={p.url} className="flex items-center gap-2 text-sm">
                  <span className="w-28 shrink-0 text-fg-muted">{p.name || 'Page'}</span>
                  <a href={p.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-pink hover:underline">{p.url.replace(/^https?:\/\//, '')}</a>
                  <IconButton label="Copy link" onClick={() => copy(p.url, 'Link')}><Copy size={13} /></IconButton>
                </li>
              ))}
            </ul>
          </DetailSection>
        )}
        {o.destination === 'form' && (
          <p className="text-sm text-fg-muted">People fill in an instant form inside Facebook or Instagram; there&apos;s no landing page.</p>
        )}

        <DetailSection title={`Ads (${o.ads.length})`} hint="Open one for Meta's preview">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {o.ads.map(ad => (
              <div key={ad.id} className="min-w-0">
                <AdThumb ad={ad} size="lg" />
                <p className="mt-1 truncate text-[11px] text-fg-dim" title={ad.name}>{ad.name}</p>
              </div>
            ))}
          </div>
        </DetailSection>

        {o.headlines.length > 0 && (
          <DetailSection title={o.headlines.length === 1 ? 'Headline' : `Headlines (${o.headlines.length})`}>
            <ul className="space-y-1">
              {o.headlines.map(h => (
                <li key={h} className="flex items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-bg/60">
                  <span className="text-sm font-medium text-fg">{h}</span>
                  <IconButton label="Copy headline" onClick={() => copy(h, 'Headline')}><Copy size={13} /></IconButton>
                </li>
              ))}
            </ul>
          </DetailSection>
        )}

        {o.bodies.length > 0 && (
          <DetailSection title={o.bodies.length === 1 ? 'Ad copy' : `Ad copy (${o.bodies.length} versions)`}>
            <div className="space-y-3">
              {o.bodies.map((b, i) => (
                <div key={b} className="rounded-xl border border-border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-dim">{o.bodies.length > 1 ? `Version ${i + 1}` : 'Primary text'}</span>
                    <button onClick={() => copy(b, 'Copy')} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-pink">
                      <Copy size={12} /> Copy text
                    </button>
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-fg-muted">{b}</p>
                </div>
              ))}
            </div>
          </DetailSection>
        )}
      </div>
    </Modal>
  );
}

function DetailSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{title}</h3>
        {hint && <span className="text-[11px] text-fg-dim">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

// ─── Shared bits ─────────────────────────────────────────────────────────────

function OfferTags({ o }: { o: Offer }) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {isNew(o) && <NewTag />}
      {o.destination && (
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-fg-muted">{DEST_LABEL[o.destination]}</span>
      )}
      <span className="text-[11px] text-fg-dim">{o.ads.length} {o.ads.length === 1 ? 'ad' : 'ads'}</span>
    </div>
  );
}

function NewTag({ className }: { className?: string }) {
  return <span className={cn('rounded-full bg-pink/15 px-2 py-0.5 text-[11px] font-semibold text-pink', className)} title={`Launched in the last ${NEW_DAYS} days`}>New</span>;
}

function AdThumb({ ad, size = 'md' }: { ad: Offer['ads'][number]; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'sm' ? 'h-10 w-10 rounded-md' : size === 'md' ? 'h-24 w-24 rounded-lg' : 'aspect-square w-full rounded-lg';
  return (
    <a href={ad.previewUrl ?? undefined} target="_blank" rel="noreferrer" title={`${ad.name} · open Meta's preview`}
      className={cn('group relative block shrink-0 overflow-hidden border border-border bg-bg', box)}>
      {ad.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={ad.thumb} alt={ad.name} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-fg-dim"><Megaphone size={size === 'sm' ? 14 : 18} /></span>
      )}
      {ad.video && size !== 'sm' && (
        <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white">
          <Play size={10} fill="currentColor" />
        </span>
      )}
    </a>
  );
}

function PageLinks({ pages, className }: { pages: FunnelPageLink[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-1.5', className)}>
      {pages.map(p => (
        <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-pink hover:underline">
          {p.name || 'Page'} <ExternalLink size={12} />
        </a>
      ))}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; label: string;
  options: ReadonlyArray<readonly [T, string, typeof LayoutGrid?]>;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-xs font-medium" role="group" aria-label={label}>
      {options.map(([v, text, Icon]) => (
        <button key={v} onClick={() => onChange(v)} aria-pressed={value === v}
          className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors', value === v ? 'bg-pink/15 text-pink' : 'text-fg-muted hover:text-fg')}>
          {Icon && <Icon size={14} />} {text}
        </button>
      ))}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className="shrink-0 rounded p-1 text-fg-dim hover:bg-bg hover:text-pink">
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-fg-dim">{label}</dt>
      <dd className="font-mono text-sm font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}

function ClientBadge({ c, id }: { c: ClientOption | undefined; id: string }) {
  const box = 'h-8 w-8 rounded-lg text-[10px]';
  if (c?.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.logo_url} alt="" className={cn(box, 'shrink-0 border border-border object-cover')} />;
  }
  return (
    <div className={cn(box, 'flex shrink-0 items-center justify-center font-bold text-fg-muted')} style={{ background: clientColor(id) }}>
      {clientInitials(c?.client_name ?? id)}
    </div>
  );
}
