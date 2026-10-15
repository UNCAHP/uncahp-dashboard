import { supabaseAdmin } from './supabase';
import type { ClientOption } from './queries';
import { getAssignmentHistory, ownerOn } from './csrAssignments';

// ─── CSR Dashboard: bookings per account against its monthly target ──────────
//
// Bookings come from the Appointment Setting Tracker sheet, cell by cell
// (csr_sheet_client_daily, synced by sheetBookingsSync). The sheet has one tab per setter
// per month ("Cathy - October 2026"), and that tab is the record of what that setter booked:
//   • Team view — every tab added together, per account.
//   • A setter's view — ONLY their own tab. Their assigned accounts (owner on the end date,
//     client_csr_assignments else clients.csr_key) are listed with the account's target;
//     accounts they booked for as cover are listed too, without a target. So a setter's
//     total always equals their tab's total.
//
// The period is the date range picked in the top bar, plus the Monday-started week that
// contains its end date. Targets are monthly (clients.monthly_booking_target) and are
// spread evenly over each month's days: a range's target is the sum of its days' shares
// (so "This Month" gets the target to date, and a range across two months gets a share of
// each). The weekly target is monthly × 7 ÷ days in the end date's month. "On track"
// compares bookings with the target pro rata up to today.

export type BookingCount = { total: number; manual: number; lp: number; split: number };
//   split = bookings whose MAN / LP split is known (tabs from October 2026 on); older
//   SMS / CALL tabs only give a total, so manual + lp can be less than total.

export type AccountBookings = {
  client_id: string;
  client_name: string;
  csr: string | null;
  target: number | null;          // monthly
  weekTarget: number | null;      // pro rata by day
  range: BookingCount;            // selected start → end date
  week: BookingCount;             // Monday → end date
  rangeTarget: number | null;     // the monthly target's share of the selected days
  rangePace: number | null;       // ...of the selected days up to today (= rangeTarget for past ranges)
  weekPace: number | null;        // weekly target pro rata to the end date
  cover?: boolean;                // setter view: an account they booked for that isn't theirs
};

export type BookingsBoard = {
  available: boolean;             // false until migration 0020 has run
  since: string;                  // selected start date
  until: string;                  // selected end date
  weekSince: string;              // the Monday of the end date's week
  daysIntoWeek: number;           // 1 (Monday) … 7
  accounts: AccountBookings[];    // every active B2C client, all tabs combined (Team view)
  setters: Record<string, AccountBookings[]>; // per setter: their own tab only (see header)
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

const daysInMonthOf = (day: string) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
// Share of a monthly target that falls on the days from `a` to `b` inclusive.
function targetShare(a: string, b: string): number {
  let share = 0;
  for (let t = Date.parse(`${a}T12:00:00Z`), end = Date.parse(`${b}T12:00:00Z`); t <= end; t += 86_400_000) {
    share += 1 / daysInMonthOf(iso(new Date(t)));
  }
  return share;
}
const londonToday = () => {
  const p = new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
};

export async function getBookingsBoard(clients: ClientOption[], since: string, until: string): Promise<BookingsBoard> {
  const end = new Date(`${until}T12:00:00Z`);
  const daysInMonth = daysInMonthOf(until);
  const daysIntoWeek = ((end.getUTCDay() + 6) % 7) + 1;
  const weekSince = iso(new Date(end.getTime() - (daysIntoWeek - 1) * 86_400_000));
  const from = weekSince < since ? weekSince : since;
  const today = londonToday();
  // Each target × these shares = the target for the range, and for the part of it up to today.
  const rangeShare = targetShare(since, until);
  const paceShare = since > today ? 0 : targetShare(since, until < today ? until : today);

  const b2c = clients.filter(c => c.segment !== 'b2b');
  const board: BookingsBoard = {
    available: true, since, until, weekSince, daysIntoWeek,
    accounts: [], setters: {}, unmatched: [], syncAgeHours: null,
  };

  const [cells, synced, history] = await Promise.all([
    supabaseAdmin
      .from('csr_sheet_client_daily')
      .select('setter_key, booking_date, account, manual_bookings, lp_bookings, total_bookings')
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
  // The same counts per setter tab, keyed `${setter}|${client}`.
  const sMonth = new Map<string, BookingCount>();
  const sWeek = new Map<string, BookingCount>();
  type Cell = { setter_key: string; booking_date: string; account: string; manual_bookings: number | null; lp_bookings: number | null; total_bookings: number };
  for (const r of (cells.data ?? []) as Cell[]) {
    const id = byKey.get(accountKey(r.account));
    const date = String(r.booking_date);
    if (!id) {
      if (date >= since) unmatched.set(r.account, (unmatched.get(r.account) ?? 0) + r.total_bookings);
      continue;
    }
    const sk = `${r.setter_key}|${id}`;
    if (date >= since) { add(month_, id, r); add(sMonth, sk, r); }
    if (date >= weekSince) { add(week_, id, r); add(sWeek, sk, r); }
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
      range: month_.get(c.client_id) ?? empty(),
      week: week_.get(c.client_id) ?? empty(),
      rangeTarget: target == null ? null : round1(target * rangeShare),
      rangePace: target == null ? null : round1(target * paceShare),
      weekPace: weekTarget == null ? null : round1((weekTarget * daysIntoWeek) / 7),
    };
  });

  // Each setter: their assigned accounts first (with targets), then any account their tab
  // has bookings for that isn't theirs (cover, no target).
  const setterKeys = new Set<string>([
    ...board.accounts.map(a => a.csr).filter((k): k is string => !!k),
    ...[...sMonth.keys(), ...sWeek.keys()].map(k => k.split('|')[0]),
  ]);
  for (const key of setterKeys) {
    const own = board.accounts.filter(a => a.csr === key).map(a => ({
      ...a,
      range: sMonth.get(`${key}|${a.client_id}`) ?? empty(),
      week: sWeek.get(`${key}|${a.client_id}`) ?? empty(),
    }));
    const ownIds = new Set(own.map(a => a.client_id));
    const coverIds = new Set([...sMonth.keys(), ...sWeek.keys()].filter(k => k.startsWith(`${key}|`)).map(k => k.split('|')[1]).filter(id => !ownIds.has(id)));
    const cover = board.accounts.filter(a => coverIds.has(a.client_id)).map(a => ({
      ...a,
      target: null, weekTarget: null, rangeTarget: null, rangePace: null, weekPace: null, cover: true,
      range: sMonth.get(`${key}|${a.client_id}`) ?? empty(),
      week: sWeek.get(`${key}|${a.client_id}`) ?? empty(),
    }));
    board.setters[key] = [...own, ...cover];
  }
  board.unmatched = [...unmatched].map(([account, total]) => ({ account, total })).sort((a, b) => b.total - a.total);
  return board;
}
