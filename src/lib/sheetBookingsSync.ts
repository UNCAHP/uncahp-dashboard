import { supabaseAdmin } from './supabase';

// Sync of the "Appointment Setting Tracker" Google Sheet → csr_sheet_bookings.
//
// The sheet is read through an Apps Script web app (google-apps-script/appointment-tracker.gs)
// rather than the Sheets API: service-account keys are blocked by the
// iam.disableServiceAccountKeyCreation org policy on uncahp.com, so the dashboard has no way
// to authenticate to Google directly. The script runs as the sheet's viewer, needs no Cloud
// project, and returns just the header block + totals row of each setter tab as JSON.
//
// Parsing stays HERE rather than in the script so it lives in the repo, under review, and
// verified against all 49 real setter tabs.
//
// Sheet shape (verified against Cathy/Alexis/Maddie, July + August 2026):
//   • One tab per setter per month, named "<Setter> - <Month Year>" — "Cathy - August 2026".
//     Some older tabs omit the space before the dash ("Shorouk- February 2026") and one
//     has a typo in the month ("Janaury"), both of which the parsing below tolerates.
//   • Row 2 is the header: a merged pair of columns per clinic, then SMS Total, CALL Total,
//     Total, Average. Row 3 labels each pair SMS / CALL.
//   • Rows 4…34 are the days of the month; the row labelled "Days" in column A is the
//     monthly totals row. That row is the ONLY thing we store.
//   • Column count varies per tab (clinics come and go), so nothing here is positional —
//     the totals columns are located by their header text.
//
// There are also month-summary tabs ("August 2026 (24)") and legacy ones ("Cathy (3)");
// neither matches the setter-tab pattern, so both are skipped.

// One tab's cells as returned by the Apps Script: the header block plus the totals row.
export type SheetGrid = (string | number | boolean | null)[][];

export type SheetBookingsSyncResult = {
  ok: boolean;
  tabsMatched?: number;
  rowsUpserted?: number;
  dailyRowsUpserted?: number;
  months?: string[];
  skipped?: string[];
  error?: string;
};

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// "Cathy - August 2026" / "Shorouk- February 2026" → { setter, periodMonth }.
// Matched on the first three letters of the month so the sheet's "Janaury" typo still parses.
export function parseTabName(tab: string): { setter: string; periodMonth: string } | null {
  const m = /^(.+?)\s*-\s*([A-Za-z]+)\s+(\d{4})$/.exec(tab.trim());
  if (!m) return null;
  const setter = m[1].trim();
  const monthIdx = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (!setter || monthIdx < 0) return null;
  return { setter, periodMonth: `${m[3]}-${String(monthIdx + 1).padStart(2, '0')}-01` };
}

const cellText = (v: unknown): string => String(v ?? '').trim();
const cellNum = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

export type TabTotals = { phone: number; sms: number; total: number };

/**
 * Pull the monthly totals out of one setter tab's grid.
 *
 * Locates the "SMS Total" / "CALL Total" / "Total" columns by header text (their position
 * shifts with the clinic count) and reads them from the "Days" totals row. Returns null if
 * either can't be found, so a restructured tab is skipped rather than written as zeroes —
 * a wrong 0 would score against the setter's KPI as a real miss.
 */
type SummaryCols = { smsCol: number; callCol: number; totalCol: number };

/**
 * Locate the month-summary columns (SMS Total / CALL Total / Total) in the header block.
 * Every row — each day and the "Days" totals row — carries its figures in these same
 * columns, so both the monthly and the daily extraction key off this one lookup.
 */
function summaryColumns(grid: SheetGrid): SummaryCols | null {
  let smsCol = -1, callCol = -1, totalCol = -1;
  let headerRow: SheetGrid[number] | null = null;
  for (const row of grid.slice(0, 5)) {
    if (!row) continue;
    row.forEach((cell, i) => {
      const t = cellText(cell).toLowerCase();
      if (t === 'sms total') smsCol = i;
      else if (t === 'call total') callCol = i;
      else if (t === 'total' && totalCol < 0) totalCol = i;
    });
    if (totalCol >= 0) { headerRow = row; break; }
  }

  // Older tabs (e.g. "Cathy - May 2026") label the summary columns just SMS / CALL rather
  // than SMS Total / CALL Total. They still sit immediately left of Total, so fall back to
  // that position — but only when those two cells really do say SMS and CALL, otherwise
  // we'd be reading the last clinic's column pair as if it were the month total.
  if ((smsCol < 0 || callCol < 0) && totalCol >= 2 && headerRow) {
    const left = cellText(headerRow[totalCol - 2]).toLowerCase();
    const right = cellText(headerRow[totalCol - 1]).toLowerCase();
    if (left === 'sms' && right === 'call') { smsCol = totalCol - 2; callCol = totalCol - 1; }
  }
  if (smsCol < 0 || callCol < 0) return null;
  return { smsCol, callCol, totalCol };
}

export function extractTotals(grid: SheetGrid): TabTotals | null {
  const cols = summaryColumns(grid);
  if (!cols) return null;

  const totalsRow = grid.find(row => cellText(row?.[0]).toLowerCase() === 'days');
  if (!totalsRow) return null;

  const sms = cellNum(totalsRow[cols.smsCol]);
  const phone = cellNum(totalsRow[cols.callCol]);
  // Prefer the sheet's own Total; fall back to the sum if that column is missing.
  const total = cols.totalCol >= 0 ? cellNum(totalsRow[cols.totalCol]) : phone + sms;

  // A month with bookings but no phone/SMS split means we located the wrong columns.
  // Skip rather than store it — 0 phone bookings would read as a real KPI miss.
  if (total > 0 && phone + sms === 0) return null;
  return { phone, sms, total };
}

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Day-of-month from the sheet's date cell. Apps Script serialises a date cell to an ISO
// string in UTC, so a local midnight in a positive-offset zone (BST) lands on the PREVIOUS
// day — nudging by 12h before reading the date undoes that for any real-world offset.
// Excel-style serial numbers (days since 1899-12-30) are handled too, and anything
// unrecognised falls back to the row's position in the month.
function dayOfMonth(cell: unknown): number | null {
  if (typeof cell === 'number' && cell > 20000 && cell < 90000) {
    const ms = Date.UTC(1899, 11, 30) + cell * 86_400_000;
    return new Date(ms).getUTCDate();
  }
  const text = cellText(cell);
  if (!text) return null;
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed + 12 * 3_600_000).getUTCDate();
}

export type DayTotals = { day: number; phone: number; sms: number; total: number };

/**
 * One entry per day row of a setter tab: the day's bookings split phone (CALL) vs SMS.
 *
 * Day rows are the ones whose first cell is a weekday name, in sheet order, ending at the
 * "Days" totals row. Returns [] rather than null when a tab has no readable day rows — the
 * monthly total may still be perfectly good, and the daily view just shows nothing.
 */
export function extractDaily(grid: SheetGrid): DayTotals[] {
  const cols = summaryColumns(grid);
  if (!cols) return [];

  const out: DayTotals[] = [];
  let seen = 0;
  for (const row of grid) {
    const label = cellText(row?.[0]).toLowerCase();
    if (label === 'days') break;                 // totals row — stop
    if (!WEEKDAYS.includes(label)) continue;     // header/blank rows
    seen++;

    const day = dayOfMonth(row[1]) ?? seen;
    if (day < 1 || day > 31) continue;

    const sms = cellNum(row[cols.smsCol]);
    const phone = cellNum(row[cols.callCol]);
    const total = cols.totalCol >= 0 ? cellNum(row[cols.totalCol]) : phone + sms;
    out.push({ day, phone, sms, total });
  }
  return out;
}

type ScriptResponse = { ok?: boolean; error?: string; tabs?: Array<{ name?: string; rows?: SheetGrid }> };

/** Fetch the setter tabs from the Apps Script web app. */
async function fetchTabs(): Promise<Array<{ name: string; rows: SheetGrid }>> {
  const base = process.env.APPT_TRACKER_SCRIPT_URL?.trim();
  const token = process.env.APPT_TRACKER_SCRIPT_TOKEN?.trim();
  if (!base) throw new Error('APPT_TRACKER_SCRIPT_URL not set');
  if (!token) throw new Error('APPT_TRACKER_SCRIPT_TOKEN not set');

  const url = `${base}${base.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
  // Apps Script answers the /exec URL with a 302 to script.googleusercontent.com; fetch
  // follows that by default. Reading the sheet takes a few seconds, hence the long timeout.
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  const body = await res.text();
  if (!res.ok) throw new Error(`apps script ${res.status}: ${body.slice(0, 200)}`);

  let json: ScriptResponse;
  try {
    json = JSON.parse(body) as ScriptResponse;
  } catch {
    // An HTML body here means Google served a sign-in page — the deployment's access is
    // set to something narrower than "Anyone", so the request was never authenticated.
    throw new Error(`apps script returned non-JSON (check the deployment is "Anyone"): ${body.slice(0, 120)}`);
  }
  if (!json.ok) throw new Error(`apps script: ${json.error ?? 'unknown error'}`);

  return (json.tabs ?? [])
    .filter((t): t is { name: string; rows: SheetGrid } => !!t.name && Array.isArray(t.rows));
}

export async function syncSheetBookings(): Promise<SheetBookingsSyncResult> {
  const tabs = await fetchTabs();

  const matched = tabs
    .map(t => ({ ...t, parsed: parseTabName(t.name) }))
    .filter((t): t is { name: string; rows: SheetGrid; parsed: { setter: string; periodMonth: string } } => !!t.parsed);

  if (!matched.length) return { ok: false, error: `no "<Setter> - <Month Year>" tabs found among ${tabs.length}` };

  const rows: Array<Record<string, unknown>> = [];
  const dailyRows: Array<Record<string, unknown>> = [];
  const skipped: string[] = [];
  const syncedAt = new Date().toISOString();

  for (const t of matched) {
    const totals = extractTotals(t.rows);
    if (!totals) { skipped.push(t.name); continue; }
    const key = t.parsed.setter.split(/\s+/)[0].toLowerCase();
    const setter = t.parsed.setter.split(/\s+/)[0];

    rows.push({
      setter_key: key,
      setter,
      period_month: t.parsed.periodMonth,
      phone_bookings: totals.phone,
      sms_bookings: totals.sms,
      total_bookings: totals.total,
      source_tab: t.name,
      _synced_at: syncedAt,
    });

    const ym = t.parsed.periodMonth.slice(0, 7);
    // Days beyond the month's length can't be real (a stray row below the grid), so drop
    // them rather than letting Postgres reject the whole batch on an invalid date.
    const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    for (const d of extractDaily(t.rows)) {
      if (d.day > lastDay) continue;
      dailyRows.push({
        setter_key: key,
        setter,
        period_month: t.parsed.periodMonth,
        booking_date: `${ym}-${String(d.day).padStart(2, '0')}`,
        phone_bookings: d.phone,
        sms_bookings: d.sms,
        total_bookings: d.total,
        source_tab: t.name,
        _synced_at: syncedAt,
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('csr_sheet_bookings')
      .upsert(rows.slice(i, i + 500), { onConflict: 'setter_key,period_month' });
    if (error) return { ok: false, error: `upsert failed: ${error.message}` };
  }

  for (let i = 0; i < dailyRows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('csr_sheet_daily')
      .upsert(dailyRows.slice(i, i + 500), { onConflict: 'setter_key,booking_date' });
    if (error) return { ok: false, error: `daily upsert failed: ${error.message}` };
  }

  return {
    ok: true,
    tabsMatched: matched.length,
    rowsUpserted: rows.length,
    dailyRowsUpserted: dailyRows.length,
    months: [...new Set(rows.map(r => String(r.period_month)))].sort().reverse().slice(0, 6),
    skipped,
  };
}
