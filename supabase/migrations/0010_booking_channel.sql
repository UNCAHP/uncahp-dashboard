-- Booking channel — how the appointment was set: by phone call or by SMS.
-- Set manually by the setter per booking. Powers the "Phone booking ratio" CSR KPI
-- (phone ÷ (phone + sms)) and replaces the separate Appointment Setting Tracker sheet.
-- Nullable: existing/legacy rows are unset until a setter marks them.
--
-- Run once in the Supabase SQL Editor after 0009.

alter table public.bookings
  add column if not exists booking_channel text
    check (booking_channel in ('sms', 'phone'));
