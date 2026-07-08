'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import {
  Plus, Pencil, Archive, ArchiveRestore, X, KeyRound, Building2, Loader2, ImageIcon,
} from 'lucide-react';
import type { AdminClientRow } from '@/lib/clientAdmin';
import {
  createClientAction, updateClientAction, setClientStatusAction, type ActionState,
} from '@/app/actions/clients';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/Tooltip';

type Tab = 'active' | 'archived';

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  } catch {
    return '—';
  }
}

export function ClientsView({ clients }: { clients: AdminClientRow[] }) {
  const [tab, setTab] = useState<Tab>('active');
  const [editing, setEditing] = useState<AdminClientRow | null>(null);
  const [adding, setAdding] = useState(false);

  const active = clients.filter(c => c.status === 'active');
  const archived = clients.filter(c => c.status === 'archived');
  const rows = tab === 'active' ? active : archived;

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Clients</h1>
          <p className="mt-1 text-sm text-fg-muted">Manage client accounts, status and API credentials</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft"
        >
          <Plus size={16} /> Add client
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {([['active', `Active (${active.length})`], ['archived', `Archived (${archived.length})`]] as const).map(
          ([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors',
                tab === id ? 'border-pink text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {label}
            </button>
          ),
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {['Client', 'Meta Ad Account', 'GHL Location', 'GHL API Key', 'Added', ''].map((h, i) => (
                  <th
                    key={h || i}
                    className={cn(
                      'px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-fg-muted',
                      i === 5 ? 'text-right' : 'text-left',
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-fg-dim">
                    {tab === 'active' ? 'No active clients yet. Add your first client to get started.' : 'No archived clients.'}
                  </td>
                </tr>
              ) : (
                rows.map(c => (
                  <ClientRowItem key={c.id} client={c} onEdit={() => setEditing(c)} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {adding && (
        <ClientFormModal
          mode="create"
          onClose={() => setAdding(false)}
        />
      )}
      {editing && (
        <ClientFormModal
          mode="edit"
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function ClientRowItem({ client: c, onEdit }: { client: AdminClientRow; onEdit: () => void }) {
  const [pending, startTransition] = useTransition();

  const toggleStatus = () => {
    const next = c.status === 'active' ? 'archived' : 'active';
    if (next === 'archived' && !window.confirm(`Archive "${c.client_name}"? They'll move to the Archived tab and can be restored anytime.`)) return;
    startTransition(async () => {
      await setClientStatusAction(c.id, next);
    });
  };

  return (
    <tr className="group border-b border-border/50 transition-colors last:border-0 hover:bg-surface-2">
      <td className="px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {c.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={c.logo_url}
              alt=""
              className="h-7 w-7 shrink-0 rounded-md border border-border object-cover"
            />
          ) : (
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-fg-muted"
              style={{ background: clientColor(c.id) }}
            >
              {clientInitials(c.client_name || '?')}
            </div>
          )}
          <Tooltip label={c.client_name} className="max-w-[220px] text-sm font-medium text-fg">
            {c.client_name}
          </Tooltip>
        </div>
      </td>
      <td className="px-5 py-3.5 font-mono text-xs text-fg-muted">
        {c.meta_ad_account_id
          ? <Tooltip label={c.meta_ad_account_id} className="max-w-[160px]">{c.meta_ad_account_id}</Tooltip>
          : '—'}
      </td>
      <td className="px-5 py-3.5 font-mono text-xs text-fg-muted">
        {c.ghl_location_id
          ? <Tooltip label={c.ghl_location_id} className="max-w-[160px]">{c.ghl_location_id}</Tooltip>
          : '—'}
      </td>
      <td className="px-5 py-3.5">
        {c.ghl_api_key_set ? (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-green/10 px-2 py-1 text-[11px] font-medium text-green">
            <KeyRound size={11} /> {c.ghl_api_key_hint}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 text-[11px] font-medium text-fg-dim">
            Not set
          </span>
        )}
      </td>
      <td className="px-5 py-3.5 text-xs text-fg-muted">{formatDate(c.created_at)}</td>
      <td className="px-5 py-3.5">
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-pink"
            aria-label="Edit client"
            title="Edit"
          >
            <Pencil size={15} />
          </button>
          <button
            onClick={toggleStatus}
            disabled={pending}
            className="rounded-md p-1.5 text-fg-muted transition-colors hover:bg-surface hover:text-fg disabled:opacity-50"
            aria-label={c.status === 'active' ? 'Archive client' : 'Restore client'}
            title={c.status === 'active' ? 'Archive' : 'Restore'}
          >
            {pending ? <Loader2 size={15} className="animate-spin" /> : c.status === 'active' ? <Archive size={15} /> : <ArchiveRestore size={15} />}
          </button>
        </div>
      </td>
    </tr>
  );
}

function ClientFormModal({
  mode,
  initial,
  onClose,
}: {
  mode: 'create' | 'edit';
  initial?: AdminClientRow;
  onClose: () => void;
}) {
  const action = mode === 'create' ? createClientAction : updateClientAction;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const [logoPreview, setLogoPreview] = useState<string | null>(initial?.logo_url ?? null);

  const onLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
    setLogoPreview(file ? URL.createObjectURL(file) : initial?.logo_url ?? null);
  };

  // Close automatically once the action succeeds.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10">
              <Building2 size={16} className="text-pink" />
            </div>
            <h2 className="text-base font-semibold text-fg">{mode === 'create' ? 'Add client' : 'Edit client'}</h2>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <form action={formAction} className="space-y-4 px-6 py-5">
          {mode === 'edit' && <input type="hidden" name="id" value={initial!.id} />}

          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-bg">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="Logo preview" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon size={20} className="text-fg-dim" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <Field label="Clinic logo" hint="PNG, JPG or SVG · up to 15MB">
                <input
                  name="logo"
                  type="file"
                  accept="image/*"
                  onChange={onLogoChange}
                  className="block w-full text-xs text-fg-muted file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-fg hover:file:bg-border"
                />
              </Field>
            </div>
          </div>

          <Field label="Client name" required>
            <input
              name="client_name"
              defaultValue={initial?.client_name ?? ''}
              required
              autoFocus
              placeholder="e.g. Radiance Skin Clinic"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Meta Ad Account ID">
              <input
                name="meta_ad_account_id"
                defaultValue={initial?.meta_ad_account_id ?? ''}
                placeholder="act_1234567890"
                className={inputCls}
              />
            </Field>
            <Field label="GHL Location ID">
              <input
                name="ghl_location_id"
                defaultValue={initial?.ghl_location_id ?? ''}
                placeholder="GHL sub-account id"
                className={inputCls}
              />
            </Field>
          </div>

          <Field
            label="GHL API Key"
            hint={mode === 'edit' && initial?.ghl_api_key_set ? 'A key is already set — leave blank to keep it.' : 'Stored securely; never shown in the browser again.'}
          >
            <input
              name="ghl_api_key"
              type="password"
              autoComplete="new-password"
              placeholder={mode === 'edit' && initial?.ghl_api_key_set ? '•••• leave blank to keep current' : 'Paste the sub-account API key'}
              className={inputCls}
            />
          </Field>

          <Field label="Notes">
            <textarea
              name="notes"
              defaultValue={initial?.notes ?? ''}
              rows={2}
              placeholder="Optional — plan, contract dates, anything useful"
              className={cn(inputCls, 'resize-none')}
            />
          </Field>

          {state.error && (
            <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{state.error}</div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-pink px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft disabled:opacity-60"
            >
              {pending && <Loader2 size={15} className="animate-spin" />}
              {mode === 'create' ? 'Add client' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none';

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
