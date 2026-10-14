'use client';

import { useActionState, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { UserPlus, Users, KeyRound, Copy, Check, Loader2, ShieldCheck } from 'lucide-react';
import { Modal } from '@/components/Modal';
import { useConfirm } from '@/components/Confirm';
import { inviteUserAction, resetLinkAction, updateUserAction, updateRolePagesAction, type UserActionState } from '@/app/actions/users';
import { PAGES, ADMIN_ROLE } from '@/lib/authPages';
import { CSR_SETTERS } from '@/lib/csrConstants';
import type { AdminUser, RoleRow } from '@/lib/userAdmin';
import { cn } from '@/lib/utils';

const selectCls = 'rounded-md border border-border bg-surface-2 px-2 py-1.5 text-xs text-fg disabled:opacity-50';
const inputCls = 'w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-fg-dim';

const ago = (iso: string | null) => {
  if (!iso) return 'Never';
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return 'Just now';
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function AdminPanel({ users, roles, currentUserId }: { users: AdminUser[]; roles: RoleRow[]; currentUserId: string }) {
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<{ email: string; url: string; kind: 'invite' | 'reset' } | null>(null);

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Admin Panel</h1>
          <p className="mt-1 text-sm text-fg-muted">Who can sign in, and which pages each role can open.</p>
        </div>
        <button onClick={() => setInviting(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-pink px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft">
          <UserPlus size={15} /> Invite someone
        </button>
      </div>

      <UsersTable users={users} roles={roles} currentUserId={currentUserId} onLink={setLink} />
      <RolesEditor roles={roles} />

      {inviting && <InviteModal roles={roles} onClose={() => setInviting(false)} onDone={(email, url) => { setInviting(false); setLink({ email, url, kind: 'invite' }); }} />}
      {link && <LinkModal {...link} onClose={() => setLink(null)} />}
    </div>
  );
}

// ─── People ──────────────────────────────────────────────────────────────────

function UsersTable({ users, roles, currentUserId, onLink }: {
  users: AdminUser[]; roles: RoleRow[]; currentUserId: string;
  onLink: (l: { email: string; url: string; kind: 'invite' | 'reset' }) => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

  const save = async (u: AdminUser, patch: Parameters<typeof updateUserAction>[1], done: string) => {
    setBusy(u.id);
    const res = await updateUserAction(u.id, patch);
    setBusy(null);
    if (res.ok) { toast.success(done); router.refresh(); } else toast.error('Not saved', { description: res.error });
  };
  const toggleActive = async (u: AdminUser) => {
    if (u.active && !(await confirm({ title: `Turn off ${u.name || u.email}?`, body: 'They’re signed out on their next click and can’t sign back in. You can turn them back on anytime.', confirmLabel: 'Turn off', danger: true }))) return;
    save(u, { active: !u.active }, u.active ? 'Access turned off' : 'Access turned back on');
  };
  const reset = async (u: AdminUser) => {
    setBusy(u.id);
    const res = await resetLinkAction(u.id);
    setBusy(null);
    if (res.ok && res.link) onLink({ email: u.email, url: res.link, kind: 'reset' });
    else toast.error('Couldn’t make a link', { description: res.error });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-sm font-semibold text-fg"><Users size={15} className="text-pink" /> People <span className="font-normal text-fg-dim">· {users.length}</span></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="px-5 py-2.5 text-left font-semibold">Person</th>
              <th className="px-3 py-2.5 text-left font-semibold">Role</th>
              <th className="px-3 py-2.5 text-left font-semibold">Setter</th>
              <th className="px-3 py-2.5 text-left font-semibold">Last sign-in</th>
              <th className="px-3 py-2.5 text-left font-semibold">Access</th>
              <th className="px-5 py-2.5 text-right font-semibold" />
            </tr>
          </thead>
          <tbody>
            {users.map(u => {
              const me = u.id === currentUserId;
              const pending = busy === u.id;
              return (
                <tr key={u.id} className={cn('border-b border-border/60 last:border-0', !u.active && 'text-fg-dim')}>
                  <td className="px-5 py-3">
                    <div className={cn('font-medium', u.active ? 'text-fg' : 'text-fg-dim')}>{u.name || u.email}{me && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-fg-dim">You</span>}</div>
                    {u.name && <div className="text-xs text-fg-muted">{u.email}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <select aria-label={`Role for ${u.email}`} value={u.role} disabled={pending || me}
                      onChange={e => save(u, { role: e.target.value }, 'Role updated')} className={selectCls}>
                      {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select aria-label={`Setter for ${u.email}`} value={u.csrKey ?? ''} disabled={pending}
                      onChange={e => save(u, { csrKey: e.target.value || null }, 'Setter updated')} className={selectCls}>
                      <option value="">—</option>
                      {CSR_SETTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-3 text-xs text-fg-muted">{u.passwordSet ? ago(u.lastSignIn) : <span className="text-yellow">Invite not used yet</span>}</td>
                  <td className="px-3 py-3">
                    <button onClick={() => toggleActive(u)} disabled={pending || me}
                      className={cn('rounded-md px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50', u.active ? 'bg-green/15 text-green hover:bg-green/25' : 'bg-border text-fg-muted hover:text-fg')}>
                      {u.active ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => reset(u)} disabled={pending}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:border-border-strong hover:text-fg disabled:opacity-50">
                      {pending ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />} {u.passwordSet ? 'Reset link' : 'New invite link'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Roles: which pages each can open ────────────────────────────────────────

function RolesEditor({ roles }: { roles: RoleRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = (r: RoleRow, page: string) => {
    const pages = r.pages.includes(page) ? r.pages.filter(p => p !== page) : [...r.pages, page];
    start(async () => {
      const res = await updateRolePagesAction(r.key, pages);
      if (res.ok) { toast.success(`${r.label} updated`); router.refresh(); } else toast.error('Not saved', { description: res.error });
    });
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 text-sm font-semibold text-fg">
        <ShieldCheck size={15} className="text-pink" /> Roles
        <span className="font-normal text-fg-dim">· tick the pages each role can open</span>
        {pending && <Loader2 size={13} className="ml-auto animate-spin text-fg-dim" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-muted">
              <th className="px-5 py-2.5 text-left font-semibold">Role</th>
              {PAGES.map(p => <th key={p.key} className="px-2 py-2.5 text-center font-semibold">{p.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {roles.map(r => (
              <tr key={r.key} className="border-b border-border/60 last:border-0">
                <td className="px-5 py-3 font-medium text-fg">{r.label}</td>
                {PAGES.map(p => {
                  const locked = r.key === ADMIN_ROLE && p.key === 'admin';
                  return (
                    <td key={p.key} className="px-2 py-3 text-center">
                      <input type="checkbox" aria-label={`${r.label}: ${p.label}`} checked={r.pages.includes(p.key)} disabled={pending || locked}
                        onChange={() => toggle(r, p.key)} className="h-4 w-4 accent-pink disabled:opacity-50" />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-fg-dim">CSRs see the CSR Team view and their own dashboard only, set by the Setter on their row. Admins always keep the Admin Panel.</p>
    </section>
  );
}

// ─── Invite ──────────────────────────────────────────────────────────────────

function InviteModal({ roles, onClose, onDone }: { roles: RoleRow[]; onClose: () => void; onDone: (email: string, url: string) => void }) {
  const router = useRouter();
  const [role, setRole] = useState('csr');
  const [email, setEmail] = useState('');
  const [state, action, pending] = useActionState(async (prev: UserActionState, fd: FormData) => {
    const res = await inviteUserAction(prev, fd);
    if (res.ok && res.link) { router.refresh(); onDone(String(fd.get('email')), res.link); }
    return res;
  }, { ok: false });

  return (
    <Modal title="Invite someone" icon={UserPlus} size="md" onClose={onClose}>
      <form action={action} className="space-y-4">
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-fg-muted">Email</span>
          <input name="email" type="email" required autoFocus value={email} onChange={e => setEmail(e.target.value)} className={inputCls} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-fg-muted">Name</span>
          <input name="name" placeholder="Optional" className={inputCls} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-fg-muted">Role</span>
          <select name="role" value={role} onChange={e => setRole(e.target.value)} className={inputCls}>
            {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select></label>
        {role === 'csr' && (
          <label className="block"><span className="mb-1.5 block text-xs font-medium text-fg-muted">Which setter are they?</span>
            <select name="csr_key" required className={inputCls} defaultValue="">
              <option value="" disabled>Choose…</option>
              {CSR_SETTERS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select></label>
        )}
        {state.error && <p role="alert" className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{state.error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">Cancel</button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-lg bg-pink px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft disabled:opacity-60">
            {pending && <Loader2 size={14} className="animate-spin" />} Create invite link
          </button>
        </div>
      </form>
    </Modal>
  );
}

// The one-time link to send. It's a sign-in credential: shown once, sent privately.
function LinkModal({ email, url, kind, onClose }: { email: string; url: string; kind: 'invite' | 'reset'; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { toast.error('Couldn’t copy. Select the link and copy it by hand.'); }
  };
  return (
    <Modal title={kind === 'invite' ? 'Invite ready' : 'Reset link ready'} icon={KeyRound} size="md" onClose={onClose}>
      <p className="text-sm text-fg-muted">Send this link to <span className="font-medium text-fg">{email}</span> in a private message. It signs them in once so they can choose a password, then stops working. It also expires after a short time, so send it now.</p>
      <div className="mt-4 flex items-stretch gap-2">
        <input readOnly value={url} onFocus={e => e.currentTarget.select()} className={cn(inputCls, 'font-mono text-xs')} aria-label="Sign-in link" />
        <button onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-pink px-3 text-sm font-semibold text-black transition-colors hover:bg-pink-soft">
          {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg-muted transition-colors hover:text-fg">Done</button>
      </div>
    </Modal>
  );
}
