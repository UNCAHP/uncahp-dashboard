'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X, Loader2, CalendarCheck, CalendarDays, List, Trash2, Pencil, Check } from 'lucide-react';
import type { Booking, BookingMonthCost, BookingChannel } from '@/lib/bookingsAdmin';
import type { ClientOption } from '@/lib/queries';
import {
  createBooking, updateBooking, deleteBooking, setMonthCost, setBookingChannel, type ActionState,
} from '@/app/actions/bookings';
import { InfoTip } from '@/components/InfoTip';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

const inputCls =
  'w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (iso: string | null): string => {
  if (!iso) return 'All months';
  const [y, m] = iso.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? '?'} ${y}`;
};
const fmtDate = (iso: string | null, raw: string | null): string => {
  if (iso) { const [, m, d] = iso.split('-'); return `${Number(d)} ${MONTH_NAMES[Number(m) - 1] ?? ''}`.trim(); }
  return raw ?? '—';
};
// When the booking was logged into the dashboard (created_at).
const fmtAdded = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const fmtAddedFull = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
export function BookingsView({
  bookings, months, monthCost, clients, clientId, month,
}: {
  bookings: Booking[];
  months: string[];
  monthCost: BookingMonthCost | null;
  clients: ClientOption[];
  clientId: string;
  month: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Booking | 'new' | null>(null);
  const [mode, setMode] = useState<'table' | 'calendar'>('table');

  const goMonth = (m: string) => router.push(`/?view=bookings&client=${encodeURIComponent(clientId)}&month=${encodeURIComponent(m)}`);
  // Switching client resets the month so it defaults to that client's latest; 'all' → overview.
  const goClient = (id: string) => router.push(id === 'all' ? '/?view=bookings' : `/?view=bookings&client=${encodeURIComponent(id)}`);

  const totals = useMemo(() => {
    const deposits = bookings.reduce((n, b) => n + (b.deposit_gbp ?? 0), 0);
    const revenue = bookings.reduce((n, b) => n + (b.total_revenue_gbp ?? 0), 0);
    const newCount = bookings.filter(b => b.is_new).length;
    return { deposits, revenue, newCount, returning: bookings.length - newCount };
  }, [bookings]);

  const profit = month
    ? totals.revenue - (monthCost?.service_fee_gbp ?? 0)
    : null; // profit only makes sense within a single month (ad spend joins later)

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Bookings</h1>
          <p className="mt-1 text-sm text-fg-muted">Every appointment logged, with deposit, revenue, CSR and practitioner.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={clientId} onChange={e => goClient(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg focus:border-border-strong focus:outline-none">
            <option value="all">All clients</option>
            {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
          </select>
          <button onClick={() => setEditing('new')}
            className="inline-flex items-center gap-2 rounded-lg bg-pink px-3.5 py-2 text-sm font-semibold text-black transition-colors hover:bg-pink-soft">
            <Plus size={16} /> Add booking
          </button>
        </div>
      </div>

      {/* Month filter + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {months.length > 0 ? (
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface p-0.5">
            {months.map(m => (
              <button key={m} onClick={() => goMonth(m)}
                className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', month === m ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
                {fmtMonth(m)}
              </button>
            ))}
            <button onClick={() => goMonth('all')}
              className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition-colors', month === null ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
              All
            </button>
          </div>
        ) : <div />}
        <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
          <button onClick={() => setMode('table')}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', mode === 'table' ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
            <List size={13} /> Table
          </button>
          <button onClick={() => setMode('calendar')}
            className={cn('inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors', mode === 'calendar' ? 'bg-pink text-black' : 'text-fg-muted hover:text-fg')}>
            <CalendarDays size={13} /> Calendar
          </button>
        </div>
      </div>

      {/* Month summary strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Bookings" value={formatNumber(bookings.length)} sub={`${totals.newCount} new · ${totals.returning} ret.`} />
        <Stat label="Deposits" value={formatGBP(totals.deposits)} tint="text-pink" />
        <Stat label="Revenue" value={formatGBP(totals.revenue)} tint="text-green" info="Treatment revenue is entered by hand (no system verifies it) — validated on save." />
        <MonthCostStat key={`mc-${month ?? 'all'}`} clientId={clientId} month={month} monthCost={monthCost} />
        <Stat label="Profit" value={profit == null ? '—' : formatGBP(profit)} tint={profit != null && profit < 0 ? 'text-red' : 'text-fg'}
          info="Revenue − service fee for the selected month. Ad spend joins in a later phase; shown per-month only." />
      </div>

      {/* Calendar view */}
      {mode === 'calendar' && (
        month
          ? <BookingsCalendar bookings={bookings} month={month} onEdit={b => setEditing(b)} />
          : <div className="rounded-2xl border border-border bg-surface p-10 text-center text-sm text-fg-dim">Pick a single month to see the calendar.</div>
      )}

      {/* Bookings table */}
      {mode === 'table' && (
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2.5 text-left font-semibold">Patient</th>
                <th className="px-2 py-2.5 text-left font-semibold">Type</th>
                <th className="px-2 py-2.5 text-left font-semibold">Treatment</th>
                <th className="px-2 py-2.5 text-left font-semibold">Source</th>
                <th className="px-2 py-2.5 text-right font-semibold">Date</th>
                <th className="px-2 py-2.5 text-right font-semibold">Added</th>
                <th className="px-2 py-2.5 text-right font-semibold">Deposit</th>
                <th className="px-2 py-2.5 text-right font-semibold">Revenue</th>
                <th className="px-2 py-2.5 text-center font-semibold">Channel</th>
                <th className="px-2 py-2.5 text-left font-semibold">CSR</th>
                <th className="px-2 py-2.5 text-left font-semibold">Practitioner</th>
                <th className="px-2 py-2.5 text-right font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <BookingRow key={b.id} b={b} onEdit={() => setEditing(b)} />
              ))}
              {bookings.length === 0 && (
                <tr><td colSpan={12} className="px-3 py-12 text-center text-sm text-fg-dim">
                  No bookings in {fmtMonth(month)} yet. Use <span className="font-medium text-fg">Add booking</span> to log one.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {editing && (
        <BookingFormModal
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          clientId={clientId}
          defaultMonth={month}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub, tint, info }: { label: string; value: string; sub?: string; tint?: string; info?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/30 p-4">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        {label} {info && <InfoTip text={info} />}
      </div>
      <div className={cn('mt-1.5 font-mono text-xl font-bold tabular-nums', tint ?? 'text-fg')}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-fg-dim">{sub}</div>}
    </div>
  );
}

// Inline-editable monthly service fee (month-level, manual).
function MonthCostStat({ clientId, month, monthCost }: { clientId: string; month: string | null; monthCost: BookingMonthCost | null }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(setMonthCost, { ok: false });
  // Keyed on month at the call site, so a fresh initial value is picked up per month.
  const [val, setVal] = useState(monthCost?.service_fee_gbp != null ? String(monthCost.service_fee_gbp) : '');

  if (!month) {
    return <Stat label="Service fee" value="—" info="Pick a single month to set its service fee (it's monthly, not per booking)." />;
  }
  return (
    <div className="rounded-xl border border-border bg-surface-2/30 p-4">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
        Service fee <InfoTip text="Entered manually per month (compounded) — not per booking. Feeds Profit = revenue − service fee." />
      </div>
      <form action={formAction} className="mt-1.5 flex items-center gap-1.5">
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="period_month" value={month} />
        <span className="font-mono text-sm text-fg-muted">£</span>
        <input name="service_fee_gbp" value={val} onChange={e => setVal(e.target.value)} inputMode="decimal" placeholder="0"
          className="w-20 rounded border border-border bg-bg px-2 py-1 font-mono text-sm tabular-nums text-fg focus:border-border-strong focus:outline-none" />
        <button type="submit" disabled={pending} className="rounded border border-border p-1 text-fg-muted transition-colors hover:text-pink disabled:opacity-50" aria-label="Save service fee">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
      </form>
      {state.error && <div className="mt-1 text-[10px] text-red">{state.error}</div>}
    </div>
  );
}

// Inline SMS/Phone toggle — setters mark how each appointment was set. Saves on change.
function ChannelCell({ id, value }: { id: string; value: BookingChannel | null }) {
  const [pending, start] = useTransition();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value === '' ? null : (e.target.value as BookingChannel);
    start(async () => { await setBookingChannel(id, v); });
  };
  return (
    <select value={value ?? ''} onChange={onChange} disabled={pending}
      className={cn('rounded-md border bg-bg px-1.5 py-1 text-[11px] font-medium focus:border-border-strong focus:outline-none disabled:opacity-50',
        value === 'phone' ? 'border-green/40 text-green' : value === 'sms' ? 'border-pink/40 text-pink' : 'border-border text-fg-dim')}>
      <option value="">—</option>
      <option value="phone">Phone</option>
      <option value="sms">SMS</option>
    </select>
  );
}

function BookingRow({ b, onEdit }: { b: Booking; onEdit: () => void }) {
  const [pending, start] = useTransition();
  const onDelete = () => {
    if (!window.confirm(`Delete ${b.patient_name ?? 'this booking'}? This can't be undone.`)) return;
    start(async () => { await deleteBooking(b.id); });
  };
  return (
    <tr className={cn('border-b border-border/50 last:border-0', pending && 'opacity-50')}>
      <td className="px-3 py-2.5 font-medium text-fg">{b.patient_name ?? '—'}</td>
      <td className="px-2 py-2.5">
        <div className="flex gap-1">
          {b.is_new && <span className="rounded bg-green/15 px-1.5 py-0.5 text-[9px] font-semibold text-green">N</span>}
          {b.is_returning && <span className="rounded bg-pink/15 px-1.5 py-0.5 text-[9px] font-semibold text-pink">R</span>}
          {b.treatment_no != null && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[9px] font-semibold text-fg-muted">T{b.treatment_no}</span>}
        </div>
      </td>
      <td className="px-2 py-2.5 text-fg-muted">
        <span className="inline-flex items-center gap-1">
          <span className="max-w-[14rem] truncate" title={b.treatment ?? ''}>{b.treatment ?? '—'}</span>
          {b.treatment_truncated && <span className="text-yellow" title="Name was truncated in the source — verify">…</span>}
        </span>
      </td>
      <td className="px-2 py-2.5 text-fg-dim">{b.source_note ?? '—'}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-fg-muted">{fmtDate(b.app_date, b.app_date_raw)}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-fg-dim" title={fmtAddedFull(b.created_at)}>{fmtAdded(b.created_at)}</td>
      <td className="px-2 py-2.5 text-right tabular-nums text-fg-muted">{b.deposit_gbp == null ? '—' : formatGBP(b.deposit_gbp, { decimals: 0 })}</td>
      <td className="px-2 py-2.5 text-right font-mono tabular-nums text-green">{b.total_revenue_gbp == null ? '—' : formatGBP(b.total_revenue_gbp, { decimals: 0 })}</td>
      <td className="px-2 py-2.5 text-center"><ChannelCell id={b.id} value={b.booking_channel} /></td>
      <td className="px-2 py-2.5 text-fg-muted">{b.csr ?? '—'}</td>
      <td className="px-2 py-2.5 text-fg-muted">{b.practitioner ?? '—'}</td>
      <td className="px-2 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <button onClick={onEdit} className="rounded p-1 text-fg-dim transition-colors hover:text-pink" aria-label="Edit"><Pencil size={13} /></button>
          <button onClick={onDelete} disabled={pending} className="rounded p-1 text-fg-dim transition-colors hover:text-red disabled:opacity-50" aria-label="Delete">
            {pending ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Calendar view ───────────────────────────────────────────────────────────
// Month grid keyed by appointment date (day-level — there's no time-of-day). Bookings
// logged this month but scheduled in another month spill into a note below the grid.
function BookingsCalendar({ bookings, month, onEdit }: { bookings: Booking[]; month: string; onEdit: (b: Booking) => void }) {
  const [y, mo] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const firstWeekday = (new Date(Date.UTC(y, mo - 1, 1)).getUTCDay() + 6) % 7; // Mon = 0

  const byDay = new Map<number, Booking[]>();
  const spill: Booking[] = [];
  const undated: Booking[] = [];
  for (const b of bookings) {
    if (!b.app_date) { undated.push(b); continue; }
    const [by2, bm, bd] = b.app_date.split('-').map(Number);
    if (by2 === y && bm === mo) { const a = byDay.get(bd) ?? []; a.push(b); byDay.set(bd, a); }
    else spill.push(b);
  }

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const firstName = (n: string | null) => (n ?? '—').split(' ')[0];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-[11px] text-fg-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green" /> New</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-pink" /> Returning</span>
        <span className="text-fg-dim">· click a name to edit</span>
      </div>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border">
          {WD.map(d => <div key={d} className="px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const list = d ? (byDay.get(d) ?? []) : [];
            return (
              <div key={i} className={cn('min-h-[108px] border-b border-r border-border/50 p-1.5', d ? '' : 'bg-surface-2/20')}>
                {d && (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-[11px] font-medium text-fg-dim">{d}</span>
                      {list.length > 0 && <span className="rounded bg-surface-2 px-1.5 text-[9px] font-semibold text-fg-muted">{list.length}</span>}
                    </div>
                    <div className="space-y-0.5">
                      {list.slice(0, 4).map(b => (
                        <button key={b.id} onClick={() => onEdit(b)} title={`${b.patient_name ?? ''} · ${b.treatment ?? ''}${b.total_revenue_gbp != null ? ` · ${formatGBP(b.total_revenue_gbp, { decimals: 0 })}` : ''}`}
                          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-fg transition-colors hover:bg-surface-2/60">
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', b.is_returning ? 'bg-pink' : 'bg-green')} />
                          <span className="truncate">{firstName(b.patient_name)}</span>
                        </button>
                      ))}
                      {list.length > 4 && <div className="px-1 text-[9px] text-fg-dim">+{list.length - 4} more</div>}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {(spill.length > 0 || undated.length > 0) && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3 text-xs text-fg-muted">
          {spill.length > 0 && <span>{spill.length} booking{spill.length === 1 ? '' : 's'} logged this month {spill.length === 1 ? 'is' : 'are'} scheduled in another month. </span>}
          {undated.length > 0 && <span>{undated.length} booking{undated.length === 1 ? '' : 's'} {undated.length === 1 ? 'has' : 'have'} no appointment date.</span>}
        </div>
      )}
    </div>
  );
}

// ─── Manual add/edit ─────────────────────────────────────────────────────────

function BookingFormModal({
  initial, clientId, defaultMonth, onClose,
}: {
  initial: Booking | null;
  clientId: string;
  defaultMonth: string | null;
  onClose: () => void;
}) {
  const action = initial ? updateBooking : createBooking;
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { ok: false });
  const monthValue = (initial?.period_month ?? defaultMonth ?? '').slice(0, 7); // yyyy-mm for <input type=month>

  useEffect(() => { if (state.ok) onClose(); }, [state.ok, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Modal title={initial ? 'Edit booking' : 'Add booking'} onClose={onClose}>
      <form action={formAction} className="space-y-4">
        {initial && <input type="hidden" name="id" value={initial.id} />}
        <input type="hidden" name="client_id" value={clientId} />

        <div className="grid grid-cols-2 gap-3">
          <Field label="Patient name" required>
            <input name="patient_name" defaultValue={initial?.patient_name ?? ''} className={inputCls} autoFocus />
          </Field>
          <Field label="Booking month" required hint="Which month's report this falls under">
            <input type="month" name="period_month" defaultValue={monthValue} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Treatment"><input name="treatment" defaultValue={initial?.treatment ?? ''} className={inputCls} /></Field>
          <Field label="Treatment #" hint="Nth session"><input name="treatment_no" type="number" min={1} defaultValue={initial?.treatment_no ?? ''} className={inputCls} /></Field>
          <Field label="Appt. date"><input type="date" name="app_date" defaultValue={initial?.app_date ?? ''} className={inputCls} /></Field>
        </div>

        <div className="flex items-center gap-5">
          <label className="flex items-center gap-2 text-xs font-medium text-fg">
            <input type="checkbox" name="is_new" value="1" defaultChecked={initial?.is_new ?? true} className="accent-pink" /> New patient
          </label>
          <label className="flex items-center gap-2 text-xs font-medium text-fg">
            <input type="checkbox" name="is_returning" value="1" defaultChecked={initial?.is_returning ?? false} className="accent-pink" /> Returning
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Deposit (£)"><input name="deposit_gbp" inputMode="decimal" defaultValue={initial?.deposit_gbp ?? 30} className={inputCls} /></Field>
          <Field label="Total revenue (£)" required hint="In-clinic total — the number no system verifies">
            <input name="total_revenue_gbp" inputMode="decimal" defaultValue={initial?.total_revenue_gbp ?? ''} className={inputCls} />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Booking channel" hint="How it was set">
            <select name="booking_channel" defaultValue={initial?.booking_channel ?? ''} className={inputCls}>
              <option value="">— not set</option>
              <option value="phone">Phone</option>
              <option value="sms">SMS</option>
            </select>
          </Field>
          <Field label="CSR"><input name="csr" defaultValue={initial?.csr ?? ''} className={inputCls} /></Field>
          <Field label="Practitioner"><input name="practitioner" defaultValue={initial?.practitioner ?? ''} className={inputCls} /></Field>
        </div>

        <Field label="Notes / source"><input name="source_note" defaultValue={initial?.source_note ?? ''} placeholder="Landing Page · RT · Booked Direct…" className={inputCls} /></Field>

        {state.error && <div className="rounded-lg border border-red/30 bg-red/10 px-3 py-2 text-xs text-red">{state.error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg-muted hover:text-fg">Cancel</button>
          <button type="submit" disabled={pending} className="inline-flex items-center gap-1.5 rounded-lg bg-pink px-4 py-2 text-sm font-semibold text-black hover:bg-pink-soft disabled:opacity-50">
            {pending && <Loader2 size={14} className="animate-spin" />} {initial ? 'Save changes' : 'Add booking'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Shared modal chrome ─────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70" onClick={onClose}>
      <div className="flex min-h-full items-center justify-center p-4">
        <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-pink/10"><CalendarCheck size={16} className="text-pink" /></div>
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
