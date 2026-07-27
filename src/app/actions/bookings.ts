'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import {
  bookingDedupeKey, normalizeName, asCcStatus, asChannel,
  type BookingDraft, type CcStatus, type BookingChannel,
} from '@/lib/bookingsAdmin';

export type ActionState = { ok: boolean; error?: string };

function field(fd: FormData, name: string): string | null {
  const v = (fd.get(name) ?? '').toString().trim();
  return v.length ? v : null;
}
function boolField(fd: FormData, name: string): boolean {
  const v = (fd.get(name) ?? '').toString().trim().toLowerCase();
  return v === '1' || v === 'on' || v === 'true' || v === 'yes';
}
function intField(fd: FormData, name: string): number | null {
  const v = field(fd, name);
  if (v == null) return null;
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? n : null;
}
function numField(fd: FormData, name: string): number | null {
  const v = field(fd, name);
  if (v == null) return null;
  const n = Number(v.replace(/[£,]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// yyyy-mm(-dd) → first of that month (yyyy-mm-01).
function monthFirst(s: string | null): string | null {
  if (!s || s.length < 7) return null;
  return `${s.slice(0, 7)}-01`;
}

// The one validation gate — reused by create, update and commit. Runs server-side
// regardless of client state, since treatment revenue is the unverifiable figure.
function validateDraft(d: BookingDraft): ActionState {
  if (!d.patient_name) return { ok: false, error: 'Patient name is required.' };
  if (!d.period_month) return { ok: false, error: 'Booking month is required.' };
  if (d.total_revenue_gbp == null || Number.isNaN(d.total_revenue_gbp)) {
    return { ok: false, error: 'Total revenue is required.' };
  }
  if (d.total_revenue_gbp < 0) return { ok: false, error: 'Total revenue cannot be negative.' };
  if (d.deposit_gbp != null && d.total_revenue_gbp < d.deposit_gbp) {
    return { ok: false, error: 'Total revenue cannot be less than the deposit.' };
  }
  return { ok: true };
}

function draftFromForm(fd: FormData): BookingDraft {
  const app_date = field(fd, 'app_date');
  const period_month = monthFirst(field(fd, 'period_month') ?? app_date);
  const cc = asCcStatus(field(fd, 'cc_status'));
  return {
    patient_name: field(fd, 'patient_name'),
    is_new: boolField(fd, 'is_new'),
    is_returning: boolField(fd, 'is_returning'),
    treatment_no: intField(fd, 'treatment_no'),
    treatment: field(fd, 'treatment'),
    treatment_truncated: boolField(fd, 'treatment_truncated'),
    source_note: field(fd, 'source_note'),
    csr: field(fd, 'csr'),
    practitioner: field(fd, 'practitioner'),
    app_date,
    app_date_raw: field(fd, 'app_date_raw') ?? app_date,
    period_month: period_month ?? '',
    deposit_gbp: numField(fd, 'deposit_gbp'),
    total_revenue_gbp: numField(fd, 'total_revenue_gbp'),
    cc_status: cc as CcStatus,
    cc_confidence: field(fd, 'cc_confidence') === 'high' ? 'high' : 'low',
    booking_channel: asChannel(field(fd, 'booking_channel')),
  };
}

// Editable columns shared by insert + update (excludes provenance/dedupe handled separately).
function draftColumns(clientId: string, d: BookingDraft) {
  return {
    client_id: clientId,
    patient_name: d.patient_name,
    patient_name_norm: normalizeName(d.patient_name),
    is_new: !!d.is_new,
    is_returning: !!d.is_returning,
    treatment_no: d.treatment_no,
    treatment: d.treatment,
    treatment_truncated: !!d.treatment_truncated,
    source_note: d.source_note,
    csr: d.csr,
    practitioner: d.practitioner,
    app_date: d.app_date,
    app_date_raw: d.app_date_raw,
    period_month: d.period_month,
    deposit_gbp: d.deposit_gbp,
    total_revenue_gbp: d.total_revenue_gbp,
    cc_status: d.cc_status,
    cc_confidence: d.cc_confidence,
    booking_channel: d.booking_channel,
    dedupe_key: bookingDedupeKey(clientId, d),
  };
}

// Quick inline update of a booking's channel (setters marking SMS vs Phone in the table).
export async function setBookingChannel(id: string, channel: BookingChannel | null): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing booking id.' };
  const { error } = await supabaseAdmin.from('bookings').update({ booking_channel: channel }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

// ─── Manual CRUD ─────────────────────────────────────────────────────────────

export async function createBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const client_id = field(fd, 'client_id');
    if (!client_id) return { ok: false, error: 'Missing client.' };
    const draft = draftFromForm(fd);
    const v = validateDraft(draft);
    if (!v.ok) return v;

    const { error } = await supabaseAdmin.from('bookings').insert({
      ...draftColumns(client_id, draft),
      entry_source: 'manual',
    });
    if (error) return { ok: false, error: error.message };
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('createBooking failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error creating booking.' };
  }
}

export async function updateBooking(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const id = field(fd, 'id');
    const client_id = field(fd, 'client_id');
    if (!id) return { ok: false, error: 'Missing booking id.' };
    if (!client_id) return { ok: false, error: 'Missing client.' };
    const draft = draftFromForm(fd);
    const v = validateDraft(draft);
    if (!v.ok) return v;

    // entry_source / import_batch_id are left untouched (provenance preserved).
    const { error } = await supabaseAdmin
      .from('bookings')
      .update(draftColumns(client_id, draft))
      .eq('id', id);
    if (error) {
      if (error.code === '23505') return { ok: false, error: 'That change would duplicate an existing booking.' };
      return { ok: false, error: error.message };
    }
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('updateBooking failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error updating booking.' };
  }
}

export async function deleteBooking(id: string): Promise<ActionState> {
  if (!id) return { ok: false, error: 'Missing booking id.' };
  const { error } = await supabaseAdmin.from('bookings').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/');
  return { ok: true };
}

// Monthly, manually-compounded service fee (month-level, not per booking).
export async function setMonthCost(_prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const client_id = field(fd, 'client_id');
    const period_month = monthFirst(field(fd, 'period_month'));
    if (!client_id) return { ok: false, error: 'Missing client.' };
    if (!period_month) return { ok: false, error: 'Missing month.' };
    const fee = numField(fd, 'service_fee_gbp') ?? 0;
    if (fee < 0) return { ok: false, error: 'Service fee cannot be negative.' };

    const { error } = await supabaseAdmin
      .from('booking_month_costs')
      .upsert({ client_id, period_month, service_fee_gbp: fee }, { onConflict: 'client_id,period_month' });
    if (error) return { ok: false, error: error.message };
    revalidatePath('/');
    return { ok: true };
  } catch (e) {
    console.error('setMonthCost failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'Unexpected error saving service fee.' };
  }
}
