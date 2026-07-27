'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Search, ClipboardList } from 'lucide-react';
import type { Booking, BookingChannel } from '@/lib/bookingsAdmin';
import type { ClientOption } from '@/lib/queries';
import { setBookingChannel } from '@/app/actions/bookings';
import { InfoTip } from '@/components/InfoTip';
import { clientInitials, clientColor } from '@/lib/clientVisuals';
import { cn, formatGBP, formatNumber } from '@/lib/utils';

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

export function AllBookingsView({
  bookings, months, clients, clientId, month,
}: {
  bookings: Booking[];
  months: string[];
  clients: ClientOption[];
  clientId: string; // 'all' in this view
  month: string | null;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const goMonth = (m: string) => router.push(`/?view=bookings&month=${encodeURIComponent(m)}`);
  const goClient = (id: string) => router.push(id === 'all' ? '/?view=bookings' : `/?view=bookings&client=${encodeURIComponent(id)}`);

  const clientById = useMemo(() => new Map(clients.map(c => [c.client_id, c])), [clients]);
  const nameOf = (id: string) => clientById.get(id)?.client_name ?? id;

  // Grand totals + per-client roll-up (the Appointment Setting Tracker's summary row).
  const { totals, perClient } = useMemo(() => {
    const t = { count: 0, phone: 0, sms: 0, revenue: 0 };
    const by = new Map<string, { count: number; phone: number; sms: number; revenue: number }>();
    for (const b of bookings) {
      t.count++; t.revenue += b.total_revenue_gbp ?? 0;
      if (b.booking_channel === 'phone') t.phone++; else if (b.booking_channel === 'sms') t.sms++;
      const row = by.get(b.client_id) ?? { count: 0, phone: 0, sms: 0, revenue: 0 };
      row.count++; row.revenue += b.total_revenue_gbp ?? 0;
      if (b.booking_channel === 'phone') row.phone++; else if (b.booking_channel === 'sms') row.sms++;
      by.set(b.client_id, row);
    }
    const perClient = [...by.entries()].map(([id, v]) => ({ id, name: nameOf(id), ...v })).sort((a, b) => b.count - a.count);
    return { totals: t, perClient };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, clientById]);

  const marked = totals.phone + totals.sms;
  const phoneRatio = marked ? +((100 * totals.phone) / marked).toFixed(1) : null;

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter(b =>
      (b.patient_name ?? '').toLowerCase().includes(q) || nameOf(b.client_id).toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, search, clientById]);

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-fg">Bookings</h1>
          <p className="mt-1 text-sm text-fg-muted">All clients · SMS vs Phone. Pick a client to log or edit its bookings.</p>
        </div>
        <select value={clientId} onChange={e => goClient(e.target.value)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-fg focus:border-border-strong focus:outline-none">
          <option value="all">All clients</option>
          {clients.map(c => <option key={c.client_id} value={c.client_id}>{c.client_name}</option>)}
        </select>
      </div>

      {months.length > 0 && (
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
      )}

      {/* Grand totals — mirrors the sheet's SMS Total / Call Total / Total row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Bookings" value={formatNumber(totals.count)} />
        <Stat label="Phone" value={formatNumber(totals.phone)} tint="text-green" />
        <Stat label="SMS" value={formatNumber(totals.sms)} tint="text-pink" />
        <Stat label="Phone ratio" value={phoneRatio == null ? '—' : `${phoneRatio}%`}
          sub={marked ? `${marked} marked` : 'none marked yet'}
          info="Phone ÷ (Phone + SMS) across all marked bookings. Mark each booking's channel in the table below or on the client's Bookings page." />
        <Stat label="Revenue" value={formatGBP(totals.revenue)} />
      </div>

      {/* Per-client roll-up (the tracker's bottom row, live) */}
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <ClipboardList size={14} className="text-pink" />
          <span className="text-xs font-semibold uppercase tracking-wider text-fg-muted">By client · {fmtMonth(month)}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                <th className="px-5 py-2.5 text-left font-semibold">Client</th>
                <th className="px-3 py-2.5 text-right font-semibold">Bookings</th>
                <th className="px-3 py-2.5 text-right font-semibold">Phone</th>
                <th className="px-3 py-2.5 text-right font-semibold">SMS</th>
                <th className="px-3 py-2.5 text-right font-semibold">Phone %</th>
                <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {perClient.map(c => {
                const m = c.phone + c.sms;
                const r = m ? Math.round((100 * c.phone) / m) : null;
                return (
                  <tr key={c.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <ClientBadge client={clientById.get(c.id)} size="md" />
                        <span className="font-medium text-fg">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg">{c.count}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-green">{c.phone}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-pink">{c.sms}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-fg-muted">{r == null ? '—' : `${r}%`}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums text-fg">{formatGBP(c.revenue)}</td>
                  </tr>
                );
              })}
              {perClient.length === 0 && <tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-fg-dim">No bookings in {fmtMonth(month)}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full cross-client list — mark SMS/Phone inline */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-fg">All bookings <span className="font-normal text-fg-dim">· {list.length}</span></div>
          <div className="relative w-full max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-dim" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search patient or client…"
              className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-fg placeholder:text-fg-dim focus:border-border-strong focus:outline-none" />
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wider text-fg-muted">
                  <th className="px-3 py-2.5 text-left font-semibold">Client</th>
                  <th className="px-2 py-2.5 text-left font-semibold">Patient</th>
                  <th className="px-2 py-2.5 text-left font-semibold">Treatment</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Date</th>
                  <th className="px-2 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-2 py-2.5 text-center font-semibold">Channel</th>
                  <th className="px-2 py-2.5 text-left font-semibold">CSR</th>
                </tr>
              </thead>
              <tbody>
                {list.map(b => (
                  <tr key={b.id} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <ClientBadge client={clientById.get(b.client_id)} size="sm" />
                        <span className="text-xs text-fg-muted">{nameOf(b.client_id)}</span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5 font-medium text-fg">{b.patient_name ?? '—'}</td>
                    <td className="px-2 py-2.5 text-fg-muted"><span className="block max-w-[13rem] truncate" title={b.treatment ?? ''}>{b.treatment ?? '—'}</span></td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-fg-muted">{fmtDate(b.app_date, b.app_date_raw)}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums text-green">{b.total_revenue_gbp == null ? '—' : formatGBP(b.total_revenue_gbp, { decimals: 0 })}</td>
                    <td className="px-2 py-2.5 text-center"><ChannelSelect id={b.id} value={b.booking_channel} /></td>
                    <td className="px-2 py-2.5 text-fg-muted">{b.csr ?? '—'}</td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-fg-dim">No bookings match.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// Clinic logo, with the coloured-initials box as a fallback (matches funnel cards / sidebar).
function ClientBadge({ client, size }: { client?: ClientOption; size: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'h-5 w-5 rounded text-[8px]' : 'h-6 w-6 rounded-md text-[9px]';
  if (client?.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={client.logo_url} alt="" className={cn(box, 'shrink-0 border border-border object-cover')} />;
  }
  return (
    <div className={cn(box, 'flex shrink-0 items-center justify-center font-bold text-fg-muted')} style={{ background: clientColor(client?.client_id ?? '') }}>
      {clientInitials(client?.client_name ?? '?')}
    </div>
  );
}

function Stat({ label, value, sub, tint, info }: { label: string; value: string; sub?: string; tint?: string; info?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/30 p-4">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{label} {info && <InfoTip text={info} />}</div>
      <div className={cn('mt-1.5 font-mono text-xl font-bold tabular-nums', tint ?? 'text-fg')}>{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-fg-dim">{sub}</div>}
    </div>
  );
}

// Inline SMS/Phone marker (same behaviour as the per-client Bookings table).
function ChannelSelect({ id, value }: { id: string; value: BookingChannel | null }) {
  const [pending, start] = useTransition();
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value === '' ? null : (e.target.value as BookingChannel);
    start(async () => { await setBookingChannel(id, v); });
  };
  return (
    <span className="inline-flex items-center gap-1">
      {pending && <Loader2 size={11} className="animate-spin text-fg-dim" />}
      <select value={value ?? ''} onChange={onChange} disabled={pending}
        className={cn('rounded-md border bg-bg px-1.5 py-1 text-[11px] font-medium focus:border-border-strong focus:outline-none disabled:opacity-50',
          value === 'phone' ? 'border-green/40 text-green' : value === 'sms' ? 'border-pink/40 text-pink' : 'border-border text-fg-dim')}>
        <option value="">—</option>
        <option value="phone">Phone</option>
        <option value="sms">SMS</option>
      </select>
    </span>
  );
}
