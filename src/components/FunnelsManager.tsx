'use client';

import { useActionState, useEffect, useId, useState, useTransition } from 'react';
import { Plus, X, Loader2, FlaskConical, Trash2, Link2, SplitSquareHorizontal, Copy, Check } from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { AdminFunnel, FunnelPageLink, FunnelVariant, TagOption, CampaignOption, SourceOption } from '@/lib/funnelAdmin';
import { createFunnelAction, updateFunnelAction, loadFunnelFormData, type ActionState } from '@/app/actions/funnels';
import { cn } from '@/lib/utils';

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none';

// Sensible starting pages for a new funnel — names pre-filled, URLs left blank.
const DEFAULT_PAGES: FunnelPageLink[] = [
  { name: 'Landing Page', url: '' },
  { name: 'Deposit Page', url: '' },
  { name: 'Thank You Page', url: '' },
];

export function FunnelFormModal({
  initial, clients, baseUrl = '', onClose,
}: {
  initial: AdminFunnel | null;
  clients: ClientOption[];
  baseUrl?: string;
  onClose: () => void;
}) {
  const action = initial ? updateFunnelAction : createFunnelAction;
  const [state, formAction, submitting] = useActionState<ActionState, FormData>(action, { ok: false });

  const [clientId, setClientId] = useState(initial?.client_id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [optinTags, setOptinTags] = useState<string[]>(initial?.optin_tags ?? []);

  // First-party tracking config — optional. "Tracking on" records views/opt-ins/deposits
  // as a Meta backup; an A/B split test is an optional layer on top (2+ versions).
  const [trackingEnabled, setTrackingEnabled] = useState(!!initial?.track_key);
  const [splitEnabled, setSplitEnabled] = useState((initial?.variants?.length ?? 0) >= 2);
  const [trackKey, setTrackKey] = useState(initial?.track_key ?? '');
  const [variants, setVariants] = useState<FunnelVariant[]>(
    initial?.variants && initial.variants.length >= 2 ? initial.variants : [{ key: 'a', label: 'Version A' }, { key: 'b', label: 'Version B' }],
  );
  const [splitStatus, setSplitStatus] = useState<'running' | 'decided'>(initial?.split_status === 'decided' ? 'decided' : 'running');
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const enableTracking = () => {
    setTrackingEnabled(true);
    if (!trackKey && name) setTrackKey(slugify(name));
  };
  const setVariant = (i: number, patch: Partial<FunnelVariant>) => setVariants(vs => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const addVariant = () => setVariants(vs => [...vs, { key: '', label: '' }]);
  const removeVariant = (i: number) => setVariants(vs => vs.filter((_, j) => j !== i));
  const variantsSerialized = JSON.stringify(variants.map((v, i) => ({ key: v.key || String.fromCharCode(97 + i), label: v.label })));

  const [depositTags] = useState<string[]>(initial?.deposit_tags ?? []); // preserved, no longer edited
  const [depositSources, setDepositSources] = useState<string[]>(initial?.deposit_sources ?? []);
  const [setterSources, setSetterSources] = useState<string[]>(initial?.setter_sources ?? []);
  const [campaignIds, setCampaignIds] = useState<string[]>(initial?.meta_campaign_ids ?? []);
  const [pages, setPages] = useState<FunnelPageLink[]>(initial?.pages ?? DEFAULT_PAGES);

  const [tags, setTags] = useState<TagOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [loadingData, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const data = await loadFunnelFormData(clientId);
      setTags(data.tags);
      setCampaigns(data.campaigns);
      setSources(data.sources);
    });
  }, [clientId]);

  useEffect(() => { if (state.ok) onClose(); }, [state.ok, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggleCampaign = (id: string) =>
    setCampaignIds(cur => (cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]));
  const setPage = (i: number, patch: Partial<FunnelPageLink>) =>
    setPages(cur => cur.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPage = () => setPages(cur => [...cur, { name: '', url: '' }]);
  const removePage = (i: number) => setPages(cur => cur.filter((_, idx) => idx !== i));

  return (
    <Modal title={initial ? 'Edit funnel' : 'Add funnel'} onClose={onClose}>
      <form action={formAction} className="space-y-4">
        {initial && <input type="hidden" name="id" value={initial.id} />}
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="optin_tags" value={JSON.stringify(optinTags)} />
        <input type="hidden" name="deposit_tags" value={JSON.stringify(depositTags)} />
        <input type="hidden" name="deposit_sources" value={JSON.stringify(depositSources)} />
        <input type="hidden" name="setter_sources" value={JSON.stringify(setterSources)} />
        <input type="hidden" name="meta_campaign_ids" value={campaignIds.join(',')} />
        <input type="hidden" name="pages" value={JSON.stringify(pages)} />
        <input type="hidden" name="tracking_enabled" value={trackingEnabled ? '1' : ''} />
        <input type="hidden" name="split_enabled" value={splitEnabled ? '1' : ''} />
        <input type="hidden" name="track_key" value={trackKey} />
        <input type="hidden" name="variants" value={variantsSerialized} />
        <input type="hidden" name="split_status" value={splitStatus} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client" required>
            <select value={clientId} onChange={e => setClientId(e.target.value)} required className={inputCls}>
              <option value="" disabled>Select a client…</option>
              {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </Field>
          <Field label="Funnel name" required>
            <input name="name" value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. HIFU £99 Offer" className={inputCls} />
          </Field>
        </div>

        <Field label="Opt-in tags" hint={clientId ? 'Contacts with ALL of these tags count as an opt-in (matches a GHL "Tag Is" smart list)' : 'Pick a client first'}>
          <TagMultiSelect value={optinTags} onChange={setOptinTags} options={tags} placeholder="e.g. lead complete" disabled={!clientId} />
        </Field>

        <Field label="Deposit source(s)" hint="Payments from these GHL payment links count as this funnel's deposits. Links with no payments yet won't appear below — add them by name.">
          <SourceMultiSelect value={depositSources} onChange={setDepositSources} options={sources} clientId={clientId} loading={loadingData} />
        </Field>

        <Field label="Setter / phone payment source(s)" hint="Shared payment links your setters use over the phone. A payment here only counts as a deposit when the contact has ALL of this funnel's opt-in tags — proving the lead came from this funnel (Meta lead-form leads without those tags are excluded).">
          <SourceMultiSelect value={setterSources} onChange={setSetterSources} options={sources} clientId={clientId} loading={loadingData} />
        </Field>

        <Field label="Meta campaigns (LP views)" hint="Which campaigns feed this funnel's landing-page views">
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-bg p-2">
            {!clientId ? (
              <div className="px-1 py-2 text-xs text-fg-dim">Pick a client first.</div>
            ) : loadingData ? (
              <div className="flex items-center gap-2 px-1 py-2 text-xs text-fg-dim"><Loader2 size={13} className="animate-spin" /> Loading campaigns…</div>
            ) : campaigns.length === 0 ? (
              <div className="px-1 py-2 text-xs text-fg-dim">No Meta campaigns found for this client.</div>
            ) : (
              campaigns.map(c => (
                <label key={c.source_id} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-fg hover:bg-surface-2">
                  <input type="checkbox" checked={campaignIds.includes(c.source_id)} onChange={() => toggleCampaign(c.source_id)} className="accent-pink" />
                  <span className="truncate">{c.name}</span>
                  {c.status && c.status !== 'ACTIVE' && <span className="ml-auto shrink-0 text-[9px] uppercase text-fg-dim">{c.status}</span>}
                </label>
              ))
            )}
          </div>
        </Field>

        <Field label="Pages" hint="Ordered links to each page in the funnel">
          <div className="space-y-2">
            {pages.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={p.name} onChange={e => setPage(i, { name: e.target.value })} placeholder="Page name" className={cn(inputCls, 'w-2/5')} />
                <div className="relative flex-1">
                  <Link2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-dim" />
                  <input value={p.url} onChange={e => setPage(i, { url: e.target.value })} placeholder="https://…" className={cn(inputCls, 'pl-8')} />
                </div>
                <button type="button" onClick={() => removePage(i)} className="shrink-0 rounded-md p-2 text-fg-muted hover:bg-surface-2 hover:text-red" title="Remove page"><Trash2 size={15} /></button>
              </div>
            ))}
            <button type="button" onClick={addPage} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-fg-muted hover:border-border-strong hover:text-fg">
              <Plus size={13} /> Add page
            </button>
          </div>
        </Field>

        <div className="rounded-lg border border-border bg-bg/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pink/10"><SplitSquareHorizontal size={15} className="text-pink" /></div>
              <div>
                <div className="text-sm font-medium text-fg">First-party tracking</div>
                <div className="text-[11px] text-fg-dim">Record this funnel&apos;s views, opt-ins &amp; deposits directly — a backup to Meta you can switch to later.</div>
              </div>
            </div>
            {!trackingEnabled ? (
              <button type="button" onClick={enableTracking} className="shrink-0 rounded-lg border border-pink/40 bg-pink/10 px-3 py-1.5 text-xs font-semibold text-pink hover:bg-pink/15">
                Set up tracking
              </button>
            ) : (
              <button type="button" onClick={() => { setTrackingEnabled(false); setSplitEnabled(false); }} className="shrink-0 text-xs font-medium text-fg-dim hover:text-red">Turn off</button>
            )}
          </div>

          {trackingEnabled && (
            <div className="mt-4 space-y-3 border-t border-border pt-4">
              <Field label="Tracking key" hint="Used in the snippet — letters, numbers and dashes.">
                <input value={trackKey} onChange={e => setTrackKey(slugify(e.target.value))} placeholder="e.g. salon-house-hifu" className={cn(inputCls, 'font-mono')} />
              </Field>

              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg px-3 py-2.5">
                <input type="checkbox" checked={splitEnabled} onChange={e => setSplitEnabled(e.target.checked)} className="accent-pink" />
                <span className="text-xs font-medium text-fg">Run an A/B split test on this funnel</span>
                <span className="ml-auto text-[10px] text-fg-dim">optional</span>
              </label>

              {splitEnabled && (
                <div className="space-y-3 rounded-lg border border-border bg-bg/60 p-3">
                  <div>
                    <div className="mb-1.5 text-xs font-medium text-fg">Versions</div>
                    <div className="space-y-2">
                      {variants.map((v, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input value={v.key} onChange={e => setVariant(i, { key: slugify(e.target.value) })} placeholder={String.fromCharCode(97 + i)} className={cn(inputCls, 'w-16 text-center font-mono')} aria-label="Version key" />
                          <input value={v.label} onChange={e => setVariant(i, { label: e.target.value })} placeholder="e.g. Green button headline" className={cn(inputCls, 'flex-1')} aria-label="Version label" />
                          {variants.length > 2 && (
                            <button type="button" onClick={() => removeVariant(i)} className="shrink-0 rounded-md p-2 text-fg-muted hover:text-red" aria-label="Remove version"><X size={15} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={addVariant} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-pink hover:opacity-80"><Plus size={13} /> Add version</button>
                  </div>
                  <Field label="Status">
                    <select value={splitStatus} onChange={e => setSplitStatus(e.target.value as 'running' | 'decided')} className={inputCls}>
                      <option value="running">Running</option>
                      <option value="decided">Decided</option>
                    </select>
                  </Field>
                </div>
              )}

              <SnippetPreview
                baseUrl={baseUrl}
                trackKey={trackKey}
                variantKeys={splitEnabled ? variants.map((v, i) => v.key || String.fromCharCode(97 + i)) : ['default']}
                split={splitEnabled}
              />
            </div>
          )}
        </div>

        {state.error && <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{state.error}</div>}

        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3.5 py-2 text-sm font-medium text-fg-muted hover:text-fg">Cancel</button>
          <button type="submit" disabled={submitting} className="inline-flex items-center gap-2 rounded-lg bg-pink px-4 py-2 text-sm font-semibold text-black hover:bg-pink-soft disabled:opacity-60">
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {initial ? 'Save changes' : 'Add funnel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Live-generated tracking script for the split test — shown as the user fills the form
// so they can copy it straight away (also appears on the funnel's Split Test panel later).
function SnippetPreview({ baseUrl, trackKey, variantKeys, split }: { baseUrl: string; trackKey: string; variantKeys: string[]; split: boolean }) {
  const origin = baseUrl || 'https://your-dashboard';
  const key = trackKey || 'your-tracking-key';
  const ready = !!trackKey;
  const config = `const UNCAHP_TRACK_URL = '${origin}/api/track';\nconst UNCAHP_TRACK_KEY  = '${key}';\nconst UNCAHP_VARIANTS   = [${variantKeys.map(k => `'${k}'`).join(', ')}];`;
  return (
    <div className="space-y-3">
      <CopyRow
        title="Funnel config"
        snippet={config}
        ready={ready}
        hint={split
          ? <>Add to the funnel&apos;s constants block. Claude wires the view / opt-in / deposit tracking and renders each version via <code className="rounded bg-bg px-1 font-mono">uncahpVariant()</code> from the funnel-builder spec.</>
          : <>Add to the funnel&apos;s constants block. Claude wires the view / opt-in / deposit tracking from the funnel-builder spec.</>}
      />
      {!ready && <p className="text-[11px] text-fg-dim">Enter a tracking key above to finish the config.</p>}
    </div>
  );
}

function CopyRow({ title, snippet, hint, ready }: { title: string; snippet: string; hint: React.ReactNode; ready: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-fg">{title}</span>
        <button
          type="button"
          onClick={copy}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-md bg-pink px-2.5 py-1 text-[11px] font-semibold text-black hover:bg-pink-soft disabled:opacity-40"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}{copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <code className="block overflow-x-auto whitespace-pre rounded-lg border border-border bg-bg px-2.5 py-2 font-mono text-[11px] text-fg-muted">{snippet}</code>
      <p className="mt-1.5 text-[11px] text-fg-dim">{hint}</p>
    </div>
  );
}

function TagMultiSelect({
  value, onChange, options, placeholder, disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: TagOption[];
  placeholder: string;
  disabled?: boolean;
}) {
  const [input, setInput] = useState('');
  const listId = useId();

  const add = (raw: string) => {
    const tag = raw.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput('');
  };
  const remove = (tag: string) => onChange(value.filter(t => t !== tag));

  return (
    <div className={cn('rounded-lg border border-border bg-bg px-2 py-2', disabled && 'pointer-events-none opacity-50')}>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-pink/15 px-2 py-0.5 text-[11px] font-medium text-pink">
              {tag}
              <button type="button" onClick={() => remove(tag)} className="hover:text-fg" aria-label={`Remove ${tag}`}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input); } }}
        onBlur={() => add(input)}
        list={listId}
        disabled={disabled}
        placeholder={value.length ? 'Add another…' : placeholder}
        className="w-full bg-transparent px-1 text-sm text-fg placeholder:text-fg-dim focus:outline-none"
      />
      <datalist id={listId}>
        {options.filter(o => !value.includes(o.tag)).map(o => (
          <option key={o.tag} value={o.tag}>{`${o.tag} (${o.count})`}</option>
        ))}
      </datalist>
    </div>
  );
}

// Payment-source picker. Options come from transaction history, so a payment link with
// no payments yet won't be listed — the free-text input lets you add it by exact name.
function SourceMultiSelect({
  value, onChange, options, clientId, loading,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  options: SourceOption[];
  clientId: string;
  loading: boolean;
}) {
  const [input, setInput] = useState('');
  const known = new Set(options.map(o => o.source));
  const extras = value.filter(v => !known.has(v)); // manually added (not in txn history)

  const toggle = (s: string) =>
    onChange(value.includes(s) ? value.filter(x => x !== s) : [...value, s]);
  const add = (raw: string) => {
    const s = raw.trim();
    if (s && !value.includes(s)) onChange([...value, s]);
    setInput('');
  };

  return (
    <div className="rounded-lg border border-border bg-bg p-2">
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {!clientId ? (
          <div className="px-1 py-2 text-xs text-fg-dim">Pick a client first.</div>
        ) : loading ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-fg-dim"><Loader2 size={13} className="animate-spin" /> Loading payment sources…</div>
        ) : options.length === 0 && extras.length === 0 ? (
          <div className="px-1 py-2 text-xs text-fg-dim">No payment sources found yet — add one by name below.</div>
        ) : (
          <>
            {extras.map(s => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-fg hover:bg-surface-2">
                <input type="checkbox" checked onChange={() => toggle(s)} className="accent-pink" />
                <span className="truncate">{s}</span>
                <span className="ml-auto shrink-0 rounded bg-pink/15 px-1 text-[8px] font-medium uppercase tracking-wide text-pink">manual</span>
              </label>
            ))}
            {options.map(s => (
              <label key={s.source} className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs text-fg hover:bg-surface-2">
                <input type="checkbox" checked={value.includes(s.source)} onChange={() => toggle(s.source)} className="accent-pink" />
                <span className="truncate">{s.source}</span>
                <span className="ml-auto shrink-0 text-[9px] text-fg-dim">{s.count}</span>
              </label>
            ))}
          </>
        )}
      </div>
      {clientId && !loading && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(input); } }}
            onBlur={() => add(input)}
            placeholder="Add a source not listed (exact GHL payment-link name)…"
            className="w-full bg-transparent px-1 text-xs text-fg placeholder:text-fg-dim focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><FlaskConical size={16} className="text-pink" /></div>
              <h2 className="text-base font-semibold text-fg">{title}</h2>
            </div>
            <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="px-6 py-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-xs font-medium text-fg">{label}</span>
        {required && <span className="text-[10px] text-pink">required</span>}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11px] text-fg-dim">{hint}</p>}
    </label>
  );
}
