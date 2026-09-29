// Client-safe CSR KPI constants — no server/supabase imports, so client components can
// use these without pulling the DB client into the browser bundle.

export const SPEED_TO_LEAD_MINUTES = 30;

// Confirmed bookings + Phone booking ratio on the CSR scorecard. These no longer come from
// the (archived) in-dashboard booking log — they're synced daily from the Appointment
// Setting Tracker sheet into csr_sheet_bookings. Set to false to park both columns as
// "not tracked" again, e.g. if the sheet stops being maintained.
export const BOOKINGS_KPIS_ENABLED = true;

// The appointment setters, keyed the way csr_shifts / csr_sheet_* key them (lowercased
// first name). Used by the client form's "Assigned setter" picker.
export const CSR_SETTERS: { key: string; label: string }[] = [
  { key: 'cathy', label: 'Cathy' },
  { key: 'alexis', label: 'Alexis' },
  { key: 'maddie', label: 'Maddie' },
];

// Which clients Speed to Lead is measured for: B2C clients with a dedicated setter.
// Self-booking clients (no csr_key) book themselves, so a phone-response KPI doesn't
// apply. Before migration 0019 has run nobody has a csr_key yet — in that case keep
// every B2C client rather than silently measuring none.
export function setterClients<T extends { segment?: 'b2c' | 'b2b'; csr_key?: string | null }>(clients: T[]): T[] {
  const b2c = clients.filter(c => c.segment !== 'b2b');
  const assigned = b2c.filter(c => !!c.csr_key);
  return assigned.length ? assigned : b2c;
}
