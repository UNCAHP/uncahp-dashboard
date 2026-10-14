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
//     monthly totals row.
//   • From October 2026 each clinic pair is labelled MAN / LP (setter-made vs booked on the
//     landing page) and the summary columns read MAN Total / LP Total. Older tabs say
//     SMS / CALL. Both layouts parse; the kind is recorded so nothing reads one as the other.
//
// Stored: month totals (csr_sheet_bookings), day totals (csr_sheet_daily) and every
// non-empty account cell (csr_sheet_client_daily, for the CSR Dashboard's per-account view).
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
  accountRowsWritten?: number;
  accountNote?: string;       // why per-account rows weren't written, if they weren't
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

// phone/sms are the SMS / CALL layout's split, manual/lp the MAN / LP one; whichever the
// tab doesn't use is 0 (phone/sms) or null (manual/lp).
export type TabTotals = { phone: number; sms: number; total: number; manual: number | null; lp: number | null };

/**
 * Where a tab keeps its month-summary columns, and which layout it uses.
 *
 * Every row — each day and the "Days" totals row — carries its figures in these same
 * columns, so the monthly, daily and per-account extraction all key off this one lookup.
 * Located by header text, never by position: the column count varies with the clinics.
 */
type SummaryCols = {
  kind: 'manlp' | 'smscall';
  aCol: number;          // MAN Total, or SMS Total
  bCol: number;          // LP Total,  or CALL Total
  totalCol: number;
  headerIdx: number;     // the row holding the clinic names
};

function summaryColumns(grid: SheetGrid): SummaryCols | null {
  for (let r = 0; r < Math.min(grid.length, 5); r++) {
    const row = grid[r];
    if (!row) continue;
    let man = -1, lp = -1, sms = -1, call = -1, totalCol = -1;
    row.forEach((cell, i) => {
      const t = cellText(cell).toLowerCase();
      if (t === 'man total') man = i;
      else if (t === 'lp total') lp = i;
      else if (t === 'sms total') sms = i;
      else if (t === 'call total') call = i;
      else if (t === 'total' && totalCol < 0) totalCol = i;
    });
    if (totalCol < 0) continue;
    if (man >= 0 && lp >= 0) return { kind: 'manlp', aCol: man, bCol: lp, totalCol, headerIdx: r };
    if (sms >= 0 && call >= 0) return { kind: 'smscall', aCol: sms, bCol: call, totalCol, headerIdx: r };
    // Older tabs (e.g. "Cathy - May 2026") label the summary columns just SMS / CALL. They
    // still sit immediately left of Total — but only trust that when those two cells really
    // say SMS and CALL, otherwise we'd read the last clinic's pair as the month total.
    if (totalCol >= 2 && cellText(row[totalCol - 2]).toLowerCase() === 'sms' && cellText(row[totalCol - 1]).toLowerCase() === 'call') {
      return { kind: 'smscall', aCol: totalCol - 2, bCol: totalCol - 1, totalCol, headerIdx: r };
    }
    return null;
  }
  return null;
}

// One row's figures in the summary columns, split the way the tab's layout splits them.
function rowFigures(row: SheetGrid[number], cols: SummaryCols): TabTotals {
  const a = cellNum(row[cols.aCol]);
  const b = cellNum(row[cols.bCol]);
  // Prefer the sheet's own Total; fall back to the sum if that cell is empty.
  const totalCell = row[cols.totalCol];
  const total = cellText(totalCell) === '' ? a + b : cellNum(totalCell);
  return cols.kind === 'manlp'
    ? { phone: 0, sms: 0, total, manual: a, lp: b }
    : { phone: b, sms: a, total, manual: null, lp: null };
}

/**
 * Pull the monthly totals out of one setter tab's grid, from its "Days" totals row.
 * Returns null if the summary columns or that row can't be found, so a restructured tab is
 * skipped rather than written as zeroes — a wrong 0 would score against the setter's KPI
 * as a real miss.
 */
export function extractTotals(grid: SheetGrid): TabTotals | null {
  const cols = summaryColumns(grid);
  if (!cols) return null;

  const totalsRow = grid.find(row => cellText(row?.[0]).toLowerCase() === 'days');
  if (!totalsRow) return null;

  const t = rowFigures(totalsRow, cols);
  // A month with bookings but nothing in either split column means we located the wrong
  // columns. Skip rather than store it.
  const split = cols.kind === 'manlp' ? (t.manual ?? 0) + (t.lp ?? 0) : t.phone + t.sms;
  if (t.total > 0 && split === 0) return null;
  return t;
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

export type DayTotals = TabTotals & { day: number };

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

    out.push({ day, ...rowFigures(row, cols) });
  }
  return out;
}

export type AccountCell = { day: number; account: string; manual: number | null; lp: number | null; total: number };

/**
 * Every non-empty account cell of a tab: per day, per clinic, its two figures.
 *
 * The clinic names sit on the header row, one per merged pair of columns; the row below
 * labels the pair (MAN / LP or SMS / CALL). Pairs are read by those labels rather than by
 * order, so a pair entered the other way round still lands in the right field.
 */
export function extractAccounts(grid: SheetGrid): AccountCell[] {
  const cols = summaryColumns(grid);
  if (!cols) return [];
  const header = grid[cols.headerIdx] ?? [];
  const labels = grid[cols.headerIdx + 1] ?? [];

  type Pair = { account: string; manCol: number; lpCol: number };
  const pairs: Pair[] = [];
  const end = Math.min(cols.aCol, cols.bCol);
  for (let i = 2; i < end; i++) {
    const account = cellText(header[i]);
    if (!account) continue;
    const l0 = cellText(labels[i]).toLowerCase();
    // MAN / SMS is the first of the pair in every tab so far; swap if the labels say otherwise.
    const firstIsB = l0 === 'lp' || l0 === 'call';
    pairs.push({ account, manCol: firstIsB ? i + 1 : i, lpCol: firstIsB ? i : i + 1 });
  }

  const out: AccountCell[] = [];
  let seen = 0;
  for (const row of grid) {
    const label = cellText(row?.[0]).toLowerCase();
    if (label === 'days') break;
    if (!WEEKDAYS.includes(label)) continue;
    seen++;
    const day = dayOfMonth(row[1]) ?? seen;
    if (day < 1 || day > 31) continue;
    for (const p of pairs) {
      const a = cellNum(row[p.manCol]);
      const b = cellNum(row[p.lpCol]);
      if (a + b === 0) continue;
      out.push(cols.kind === 'manlp'
        ? { day, account: p.account, manual: a, lp: b, total: a + b }
        : { day, account: p.account, manual: null, lp: null, total: a + b });
    }
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
  const accountRows: Array<Record<string, unknown>> = [];
  const tabMonths: Array<{ setter_key: string; period_month: string }> = [];
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
      manual_bookings: totals.manual,
      lp_bookings: totals.lp,
      source_tab: t.name,
      _synced_at: syncedAt,
    });

    const ym = t.parsed.periodMonth.slice(0, 7);
    // Days beyond the month's length can't be real (a stray row below the grid), so drop
    // them rather than letting Postgres reject the whole batch on an invalid date.
    const lastDay = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    tabMonths.push({ setter_key: key, period_month: t.parsed.periodMonth });
    for (const c of extractAccounts(t.rows)) {
      if (c.day > lastDay) continue;
      accountRows.push({
        setter_key: key,
        period_month: t.parsed.periodMonth,
        booking_date: `${ym}-${String(c.day).padStart(2, '0')}`,
        account: c.account,
        manual_bookings: c.manual,
        lp_bookings: c.lp,
        total_bookings: c.total,
        source_tab: t.name,
        _synced_at: syncedAt,
      });
    }
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

  // manual_bookings / lp_bookings arrive with migration 0020; until it's run, write the
  // rows without them so the month totals keep syncing.
  let monthRows = rows;
  for (let i = 0; i < monthRows.length; i += 500) {
    let { error } = await supabaseAdmin
      .from('csr_sheet_bookings')
      .upsert(monthRows.slice(i, i + 500), { onConflict: 'setter_key,period_month' });
    if (error && /manual_bookings|lp_bookings/.test(error.message) && monthRows === rows) {
      monthRows = rows.map(({ manual_bookings: _m, lp_bookings: _l, ...r }) => { void _m; void _l; return r; });
      ({ error } = await supabaseAdmin
        .from('csr_sheet_bookings')
        .upsert(monthRows.slice(i, i + 500), { onConflict: 'setter_key,period_month' }));
    }
    if (error) return { ok: false, error: `upsert failed: ${error.message}` };
  }

  for (let i = 0; i < dailyRows.length; i += 500) {
    const { error } = await supabaseAdmin
      .from('csr_sheet_daily')
      .upsert(dailyRows.slice(i, i + 500), { onConflict: 'setter_key,booking_date' });
    if (error) return { ok: false, error: `daily upsert failed: ${error.message}` };
  }

  const accounts = await writeAccountRows(tabMonths, accountRows);

  return {
    ok: true,
    ...accounts,
    tabsMatched: matched.length,
    rowsUpserted: rows.length,
    dailyRowsUpserted: dailyRows.length,
    months: [...new Set(rows.map(r => String(r.period_month)))].sort().reverse().slice(0, 6),
    skipped,
  };
}

// Replace each synced tab's account cells wholesale: delete that setter's month, then
// insert what the sheet holds now, so a cell cleared in the sheet disappears here too.
// The table arrives with migration 0020; before that, report it and carry on.
async function writeAccountRows(
  tabMonths: Array<{ setter_key: string; period_month: string }>,
  rows: Array<Record<string, unknown>>,
): Promise<{ accountRowsWritten?: number; accountNote?: string }> {
  for (const t of tabMonths) {
    const { error } = await supabaseAdmin
      .from('csr_sheet_client_daily')
      .delete()
      .eq('setter_key', t.setter_key)
      .eq('period_month', t.period_month);
    if (error) return { accountNote: `per-account rows not written: ${error.message}` };
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabaseAdmin.from('csr_sheet_client_daily').insert(rows.slice(i, i + 500));
    if (error) return { accountNote: `per-account insert failed: ${error.message}` };
  }
  return { accountRowsWritten: rows.length };
}
