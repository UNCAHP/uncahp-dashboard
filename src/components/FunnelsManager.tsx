'use client';

import { useActionState, useEffect, useId, useState, useTransition } from 'react';
import { Plus, X, Loader2, FlaskConical, Trash2, Link2 } from 'lucide-react';
import type { ClientOption } from '@/lib/queries';
import type { AdminFunnel, FunnelPageLink, TagOption, CampaignOption } from '@/lib/funnelAdmin';
import { createFunnelAction, updateFunnelAction, loadFunnelFormData, type ActionState } from '@/app/actions/funnels';
import { cn } from '@/lib/utils';

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none';

export function FunnelFormModal({
  initial, clients, onClose,
}: {
  initial: AdminFunnel | null;
  clients: ClientOption[];
  onClose: () => void;
}) {
  const action = initial ? updateFunnelAction : createFunnelAction;
  const [state, formAction, submitting] = useActionState<ActionState, FormData>(action, { ok: false });

  const [clientId, setClientId] = useState(initial?.client_id ?? '');
  const [optinTags, setOptinTags] = useState<string[]>(initial?.optin_tags ?? []);
  const [depositTags, setDepositTags] = useState<string[]>(initial?.deposit_tags ?? []);
  const [campaignIds, setCampaignIds] = useState<string[]>(initial?.meta_campaign_ids ?? []);
  const [pages, setPages] = useState<FunnelPageLink[]>(initial?.pages ?? []);

  const [tags, setTags] = useState<TagOption[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [loadingData, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const data = await loadFunnelFormData(clientId);
      setTags(data.tags);
      setCampaigns(data.campaigns);
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
        <input type="hidden" name="meta_campaign_ids" value={campaignIds.join(',')} />
        <input type="hidden" name="pages" value={JSON.stringify(pages)} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client" required>
            <select value={clientId} onChange={e => setClientId(e.target.value)} required className={inputCls}>
              <option value="" disabled>Select a client…</option>
              {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
            </select>
          </Field>
          <Field label="Funnel name" required>
            <input name="name" defaultValue={initial?.name ?? ''} required placeholder="e.g. HIFU £99 Offer" className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Opt-in tags" hint={clientId ? 'Contacts with ANY of these tags count as an opt-in' : 'Pick a client first'}>
            <TagMultiSelect value={optinTags} onChange={setOptinTags} options={tags} placeholder="e.g. lead complete" disabled={!clientId} />
          </Field>
          <Field label="Deposit tags" hint={clientId ? 'Contacts with ANY of these tags count as a deposit' : 'Pick a client first'}>
            <TagMultiSelect value={depositTags} onChange={setDepositTags} options={tags} placeholder="e.g. deposit paid" disabled={!clientId} />
          </Field>
        </div>

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

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10">
      <div className="fixed inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl">
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
