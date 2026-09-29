-- Assigned setter (CSR) per client — mirrors the "CSR" column on the Notion Active Clients
-- board. Lowercased first name, matching csr_shifts.csr_key / csr_sheet_*.setter_key.
-- Null = no dedicated setter (Notion's "Self Booking").
--
-- Speed to Lead uses it to decide whose shift a client's leads are measured against:
-- the assigned setter's, or — when they're off that day — whoever else was on shift
-- (cover). Idempotent — run once in the Supabase SQL Editor.

alter table public.clients add column if not exists csr_key text;

-- Seed from the Notion "Active Clients" board (CSR column) as of 29 Sep 2026.
-- Registry names differ slightly from Notion in a few places (Dr. Libby, HiTech, Pulse).
update public.clients set csr_key = 'alexis' where client_name in (
  'Maldon Skin Clinic', 'Salon House', 'The Skin Collective', 'Ayadi Clinic',
  'Emzi Skin Clinic', 'TAG Aesthetics (Nadia)', 'The Confidence Clinic'
);
update public.clients set csr_key = 'maddie' where client_name in (
  'Skin and Heal', 'HiTech Aesthetics', 'TAG Aesthetics (April)', 'Teri Aesthetics',
  'Treat Medi Spa', 'Evavas Medical Cosmetics'
);
update public.clients set csr_key = 'cathy' where client_name in (
  'Pulse Laser Aesthetic Clinic', 'Samantha Rose Laser Clinic', 'Dr. Libby Clinic',
  'Laser Light Clinic', 'Radiance Medispa', 'Sciene London', 'The Clinical Beauty Room',
  'Moss Aesthetics', 'Face Addict Aesthetics'
);
-- Self booking (no dedicated setter): Pure Skin Clinic, Allure — csr_key stays null.
