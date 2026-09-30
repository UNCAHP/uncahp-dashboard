// Client-safe CSR KPI constants — no server/supabase imports, so client components can
// use these without pulling the DB client into the browser bundle.

export const SPEED_TO_LEAD_MINUTES = 30;

// Speed to Lead standard (%): at or above it is on target, below it isn't. No tiers —
// beating it is simply good. One place to change; every view reads this.
export const SPEED_TARGET_PCT = 70;
export const SPEED_TARGET_TEXT = `Standard: ${SPEED_TARGET_PCT}% — at or above is on target.`;

// A contact only counts as a NEW LEAD for Speed to Lead if it carries a campaign REF tag,
// e.g. "dlc-ec-01-aug26" — <client>-<offer>-<nn>-<monYY>. That's what every ad / funnel
// enquiry gets on the way in. Untagged contacts (manual adds, imports) and campaign tags
// without the numbered slot (e.g. "reactivation-hifu-sep26") are not new enquiries.
export const REF_TAG_RE = /^[a-z0-9&]+-[a-z0-9]+-\d{2}-[a-z]{3}\d{2}$/i;
export const hasRefTag = (tags: unknown): boolean =>
  Array.isArray(tags) && tags.some(t => typeof t === 'string' && REF_TAG_RE.test(t.trim()));

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

// Setters whose Speed to Lead is NOT tracked (lowercased first name). Their assigned
// clients drop out of the measure, their shifts don't appear on the Shifts tab, and leads
// they'd be responsible for while covering aren't counted. Bookings KPIs are unaffected.
export const UNTRACKED_SETTERS: string[] = ['cathy'];
export const isTrackedSetter = (key: string | null | undefined): boolean =>
  !!key && !UNTRACKED_SETTERS.includes(key.toLowerCase());

// Which clients Speed to Lead is measured for: B2C clients with a dedicated setter.
// Self-booking clients (no csr_key) book themselves, so a phone-response KPI doesn't
// apply. Before migration 0019 has run nobody has a csr_key yet — in that case keep
// every B2C client rather than silently measuring none.
export function setterClients<T extends { segment?: 'b2c' | 'b2b'; csr_key?: string | null }>(clients: T[]): T[] {
  const b2c = clients.filter(c => c.segment !== 'b2b');
  const assigned = b2c.filter(c => !!c.csr_key);
  if (assigned.length === 0) return b2c;
  // Clients whose setter isn't tracked for Speed to Lead aren't measured either.
  return assigned.filter(c => isTrackedSetter(c.csr_key));
}
