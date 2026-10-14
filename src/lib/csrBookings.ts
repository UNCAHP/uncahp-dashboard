import { supabaseAdmin } from './supabase';
import type { ClientOption } from './queries';
import { getAssignmentHistory, ownerOn } from './csrAssignments';

// ─── CSR Dashboard: bookings per account against its monthly target ──────────
//
// Bookings come from the Appointment Setting Tracker sheet, cell by cell
// (csr_sheet_client_daily, synced daily by sheetBookingsSync). An account's bookings are
// everything logged against it on ANY setter's tab — cover bookings count towards the
// account's target, because the target belongs to the account. A setter's view lists the
// accounts assigned to them on the end date (client_csr_assignments, else clients.csr_key).
//
// The period is the calendar month and the Monday-started week that contain the selected
// end date, each counted up to that date. Targets are monthly (clients.monthly_booking_target);
// the weekly one is pro rata by day: monthly × 7 ÷ days in the month. "On track" compares
// bookings so far with the target pro rata to the end date.

export type BookingCount = { total: number; manual: number; lp: number; split: number };
//   split = bookings whose MAN / LP split is known (tabs from October 2026 on); older
//   SMS / CALL tabs only give a total, so manual + lp can be less than total.

export type AccountBookings = {
  client_id: string;
  client_name: string;
  csr: string | null;
  target: number | null;          // monthly
  weekTarget: number | null;      // pro rata by day
  month: BookingCount;            // 1st of the month → end date
  week: BookingCount;             // Monday → end date
  monthPace: number | null;       // target pro rata to the end date
  weekPace: number | null;        // weekly target pro rata to the end date
};

export type BookingsBoard = {
  available: boolean;             // false until migration 0020 has run
  month: string;                  // yyyy-mm-01
  until: string;                  // the end date counted up to
  weekSince: string;              // that week's Monday
  daysInMonth: number;
  dayOfMonth: number;
  daysIntoWeek: number;           // 1 (Monday) … 7
  accounts: AccountBookings[];    // every active B2C client, matched or not
  unmatched: { account: string; total: number }[]; // sheet columns no client matched
  syncAgeHours: number | null;
};

const empty = (): BookingCount => ({ total: 0, manual: 0, lp: 0, split: 0 });

// Sheet headers and registry names differ in small ways ("Dr Libby Clinic" vs "Dr. Libby
// Clinic", "Pulse Laser Clinic" vs "Pulse Laser Aesthetic Clinic", "TAG April" vs "TAG
// Aesthetics (April)", "TERÍ" vs "Teri"). Compare on letters and digits only, with accents
// and the generic business words dropped.
const FILLER = /\b(clinic|clinics|aesthetic|aesthetics|medical|cosmetics|the)\b/g;
export const accountKey = (name: string): string =>
  name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ').replace(FILLER, ' ').replace(/[^a-z0-9]/g, '');

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function getBookingsBoard(clients: ClientOption[], until: string): Promise<BookingsBoard> {
  const end = new Date(`${until}T12:00:00Z`);
  const y = end.getUTCFullYear(), m = end.getUTCMonth();
  const month = `${until.slice(0, 7)}-01`;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const dayOfMonth = end.getUTCDate();
  const daysIntoWeek = ((end.getUTCDay() + 6) % 7) + 1;
  const weekSince = iso(new Date(end.getTime() - (daysIntoWeek - 1) * 86_400_000));
  const from = weekSince < month ? weekSince : month;

  const b2c = clients.filter(c => c.segment !== 'b2b');
  const board: BookingsBoard = {
    available: true, month, until, weekSince, daysInMonth, dayOfMonth, daysIntoWeek,
    accounts: [], unmatched: [], syncAgeHours: null,
  };

  const [cells, synced, history] = await Promise.all([
    supabaseAdmin
      .from('csr_sheet_client_daily')
      .select('booking_date, account, manual_bookings, lp_bookings, total_bookings')
      .gte('booking_date', from)
      .lte('booking_date', until)
      .limit(10_000),
    supabaseAdmin.from('csr_sheet_bookings').select('_synced_at').order('_synced_at', { ascending: false }).limit(1),
    getAssignmentHistory(),
  ]);
  const at = (synced.data ?? [])[0]?._synced_at as string | undefined;
  board.syncAgeHours = at ? (Date.now() - Date.parse(at)) / 3_600_000 : null;
  if (cells.error) board.available = false;

  const byKey = new Map(b2c.map(c => [accountKey(c.client_name), c.client_id]));
  const month_ = new Map<string, BookingCount>();
  const week_ = new Map<string, BookingCount>();
  const unmatched = new Map<string, number>();
  const add = (map: Map<string, BookingCount>, id: string, r: { manual_bookings: number | null; lp_bookings: number | null; total_bookings: number }) => {
    const c = map.get(id) ?? empty();
    c.total += r.total_bookings;
    if (r.manual_bookings != null || r.lp_bookings != null) {
      c.manual += r.manual_bookings ?? 0;
      c.lp += r.lp_bookings ?? 0;
      c.split += (r.manual_bookings ?? 0) + (r.lp_bookings ?? 0);
    }
    map.set(id, c);
  };
  type Cell = { booking_date: string; account: string; manual_bookings: number | null; lp_bookings: number | null; total_bookings: number };
  for (const r of (cells.data ?? []) as Cell[]) {
    const id = byKey.get(accountKey(r.account));
    const date = String(r.booking_date);
    if (!id) {
      if (date >= month) unmatched.set(r.account, (unmatched.get(r.account) ?? 0) + r.total_bookings);
      continue;
    }
    if (date >= month) add(month_, id, r);
    if (date >= weekSince) add(week_, id, r);
  }

  const round1 = (n: number) => Math.round(n * 10) / 10;
  board.accounts = b2c.map(c => {
    const target = c.monthly_booking_target ?? null;
    const weekTarget = target == null ? null : round1((target * 7) / daysInMonth);
    return {
      client_id: c.client_id,
      client_name: c.client_name,
      csr: (() => { const o = ownerOn(history, c.client_id, until); return o === undefined ? c.csr_key ?? null : o; })(),
      target,
      weekTarget,
      month: month_.get(c.client_id) ?? empty(),
      week: week_.get(c.client_id) ?? empty(),
      monthPace: target == null ? null : round1((target * dayOfMonth) / daysInMonth),
      weekPace: weekTarget == null ? null : round1((weekTarget * daysIntoWeek) / 7),
    };
  });
  board.unmatched = [...unmatched].map(([account, total]) => ({ account, total })).sort((a, b) => b.total - a.total);
  return board;
}
