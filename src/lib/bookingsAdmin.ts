import { createHash } from 'node:crypto';
import { supabaseAdmin } from './supabase';

// Read side + shared helpers for the native Bookings feature. Mirrors funnelAdmin.ts:
// typed rows + reads via supabaseAdmin (the tables are RLS-locked). All writes live in
// src/app/actions/bookings.ts.

export type CcStatus = 'paid' | 'pending' | 'no_show' | 'cancelled' | 'unknown';
export type CcConfidence = 'high' | 'low';
export type EntrySource = 'screenshot' | 'manual';
export type BookingChannel = 'sms' | 'phone';
export const asChannel = (v: unknown): BookingChannel | null =>
  v === 'sms' || v === 'phone' ? v : null;

// A saved booking row.
export type Booking = {
  id: string;
  client_id: string;
  patient_name: string | null;
  patient_name_norm: string | null;
  is_new: boolean;
  is_returning: boolean;
  treatment_no: number | null;
  treatment: string | null;
  treatment_truncated: boolean;
  source_note: string | null;
  csr: string | null;
  practitioner: string | null;
  contact_source_id: string | null;
  app_date: string | null;      // ISO yyyy-mm-dd
  app_date_raw: string | null;
  period_month: string;         // ISO yyyy-mm-01
  deposit_gbp: number | null;
  total_revenue_gbp: number | null;
  cc_status: CcStatus;
  cc_confidence: CcConfidence;
  booking_channel: BookingChannel | null;
  entry_source: EntrySource;
  import_batch_id: string | null;
  created_at: string;
  updated_at: string;
};

// A pre-commit row — produced by the screenshot extractor OR the edit form. No id /
// timestamps yet. `_rowIssues` carries extractor concerns surfaced in the preview.
export type BookingDraft = {
  patient_name: string | null;
  is_new: boolean;
  is_returning: boolean;
  treatment_no: number | null;
  treatment: string | null;
  treatment_truncated: boolean;
  source_note: string | null;
  csr: string | null;
  practitioner: string | null;
  app_date: string | null;
  app_date_raw: string | null;
  period_month: string;
  deposit_gbp: number | null;
  total_revenue_gbp: number | null;
  cc_status: CcStatus;
  cc_confidence: CcConfidence;
  booking_channel: BookingChannel | null;
  _rowIssues?: string[];
};

export type BookingMonthCost = {
  client_id: string;
  period_month: string;
  service_fee_gbp: number;
};

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const int = (v: unknown): number | null => (v == null || v === '' ? null : Math.trunc(Number(v)));

const CC_STATUSES: CcStatus[] = ['paid', 'pending', 'no_show', 'cancelled', 'unknown'];
export const asCcStatus = (v: unknown): CcStatus =>
  CC_STATUSES.includes(v as CcStatus) ? (v as CcStatus) : 'unknown';

// trim + lowercase — the same normalisation used for tag/source matching elsewhere.
export function normalizeName(name: string | null | undefined): string | null {
  const n = String(name ?? '').trim().toLowerCase();
  return n.length ? n : null;
}

const BOOKINGS_COLUMNS =
  'id, client_id, patient_name, patient_name_norm, is_new, is_returning, treatment_no, ' +
  'treatment, treatment_truncated, source_note, csr, practitioner, contact_source_id, ' +
  'app_date, app_date_raw, period_month, deposit_gbp, total_revenue_gbp, cc_status, ' +
  'cc_confidence, booking_channel, entry_source, import_batch_id, created_at, updated_at';

function mapBooking(r: Record<string, unknown>): Booking {
  return {
    id: String(r.id),
    client_id: String(r.client_id),
    patient_name: (r.patient_name as string) ?? null,
    patient_name_norm: (r.patient_name_norm as string) ?? null,
    is_new: !!r.is_new,
    is_returning: !!r.is_returning,
    treatment_no: int(r.treatment_no),
    treatment: (r.treatment as string) ?? null,
    treatment_truncated: !!r.treatment_truncated,
    source_note: (r.source_note as string) ?? null,
    csr: (r.csr as string) ?? null,
    practitioner: (r.practitioner as string) ?? null,
    contact_source_id: (r.contact_source_id as string) ?? null,
    app_date: (r.app_date as string) ?? null,
    app_date_raw: (r.app_date_raw as string) ?? null,
    period_month: String(r.period_month),
    deposit_gbp: num(r.deposit_gbp),
    total_revenue_gbp: num(r.total_revenue_gbp),
    cc_status: asCcStatus(r.cc_status),
    cc_confidence: r.cc_confidence === 'high' ? 'high' : 'low',
    booking_channel: asChannel(r.booking_channel),
    entry_source: r.entry_source === 'screenshot' ? 'screenshot' : 'manual',
    import_batch_id: (r.import_batch_id as string) ?? null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

// Bookings for a client, optionally scoped to a single month (yyyy-mm-01). Newest first.
export async function getBookings(clientId: string, month?: string | null): Promise<Booking[]> {
  if (!clientId) return [];
  let q = supabaseAdmin
    .from('bookings')
    .select(BOOKINGS_COLUMNS)
    .eq('client_id', clientId)
    .order('app_date', { ascending: false, nullsFirst: false })
    .order('patient_name', { ascending: true });
  if (month) q = q.eq('period_month', month);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(r => mapBooking(r as unknown as Record<string, unknown>));
}

// Distinct months (yyyy-mm-01) that have bookings for this client, newest first.
export async function getBookingMonths(clientId: string): Promise<string[]> {
  if (!clientId) return [];
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('period_month')
    .eq('client_id', clientId)
    .order('period_month', { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const m = (r as { period_month?: string }).period_month;
    if (m) seen.add(String(m));
  }
  return [...seen];
}

// Per-CSR KPI roll-up for a month: Confirmed bookings (paid a fee) + Phone booking ratio
// (phone ÷ marked). Credited to the CSR recorded on each booking.
export type CsrConfirmed = {
  csr: string;
  confirmed: number;   // paid a booking fee
  total: number;       // all bookings credited to this CSR
  phone: number;       // marked as a phone booking
  sms: number;         // marked as an SMS booking
};
export async function getCsrConfirmed(clientId: string, month: string | null): Promise<CsrConfirmed[]> {
  if (!clientId || !month) return [];
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('csr, deposit_gbp, booking_channel')
    .eq('client_id', clientId)
    .eq('period_month', month)
    .not('csr', 'is', null);
  if (error) throw error;
  const by = new Map<string, { confirmed: number; total: number; phone: number; sms: number }>();
  for (const r of data ?? []) {
    const csr = String((r as { csr?: string }).csr);
    const row = by.get(csr) ?? { confirmed: 0, total: 0, phone: 0, sms: 0 };
    row.total++;
    if ((r as { deposit_gbp?: number | null }).deposit_gbp != null) row.confirmed++;
    const ch = (r as { booking_channel?: string }).booking_channel;
    if (ch === 'phone') row.phone++;
    else if (ch === 'sms') row.sms++;
    by.set(csr, row);
  }
  return [...by.entries()]
    .map(([csr, v]) => ({ csr, ...v }))
    .sort((a, b) => b.confirmed - a.confirmed);
}

// Quick per-field channel update (inline in the table) — see actions/bookings.ts.

// ─── Cross-client (All Bookings page — migrating the Appointment Setting sheet) ─
export async function getAllBookings(month?: string | null): Promise<Booking[]> {
  let q = supabaseAdmin
    .from('bookings')
    .select(BOOKINGS_COLUMNS)
    .order('app_date', { ascending: false, nullsFirst: false })
    .limit(2000);
  if (month) q = q.eq('period_month', month);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(r => mapBooking(r as unknown as Record<string, unknown>));
}

export async function getAllBookingMonths(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('period_month')
    .order('period_month', { ascending: false });
  if (error) throw error;
  const seen = new Set<string>();
  for (const r of data ?? []) {
    const m = (r as { period_month?: string }).period_month;
    if (m) seen.add(String(m));
  }
  return [...seen];
}

export async function getMonthCost(clientId: string, month: string): Promise<BookingMonthCost | null> {
  if (!clientId || !month) return null;
  const { data, error } = await supabaseAdmin
    .from('booking_month_costs')
    .select('client_id, period_month, service_fee_gbp')
    .eq('client_id', clientId)
    .eq('period_month', month)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    client_id: String(data.client_id),
    period_month: String(data.period_month),
    service_fee_gbp: Number(data.service_fee_gbp ?? 0),
  };
}

// Stable natural key so re-importing the same screenshot upserts instead of duplicating.
// Keyed on the fields that identify a booking (client + patient + date + treatment no +
// deposit) — NOT on the noisy OCR fields (source_note, cc_status, practitioner), so a
// re-upload corrects those rather than creating a new row.
export function bookingDedupeKey(
  clientId: string,
  d: Pick<BookingDraft, 'patient_name' | 'app_date' | 'treatment_no' | 'deposit_gbp'>,
): string {
  const parts = [
    clientId,
    normalizeName(d.patient_name) ?? '',
    d.app_date ?? '',
    d.treatment_no == null ? '' : String(d.treatment_no),
    d.deposit_gbp == null ? '' : String(d.deposit_gbp),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
