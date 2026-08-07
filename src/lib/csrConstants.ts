// Client-safe CSR KPI constants — no server/supabase imports, so client components can
// use these without pulling the DB client into the browser bundle.

export const SPEED_TO_LEAD_MINUTES = 30;

// Confirmed bookings + Phone booking ratio on the CSR scorecard. These no longer come from
// the (archived) in-dashboard booking log — they're synced daily from the Appointment
// Setting Tracker sheet into csr_sheet_bookings. Set to false to park both columns as
// "not tracked" again, e.g. if the sheet stops being maintained.
export const BOOKINGS_KPIS_ENABLED = true;
