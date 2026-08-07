/**
 * UNCAHP dashboard — Appointment Setting Tracker feed.
 *
 * Publishes the setter tabs of the tracker sheet as JSON so the dashboard can sync them
 * into Supabase (csr_sheet_bookings → the Confirmed bookings / Phone booking ratio KPIs).
 *
 * This exists because Google Cloud service-account keys are blocked by an org policy on
 * uncahp.com, so the dashboard can't authenticate to the Sheets API directly. Apps Script
 * runs as YOU, needs no Cloud project, and keeps the sheet private.
 *
 * It is a STANDALONE script (lives in your own Drive, not inside the spreadsheet), so it
 * only needs view access to a sheet someone else owns.
 *
 * ── Setup ────────────────────────────────────────────────────────────────────────────
 *  1. script.google.com → New project → paste this file over the default Code.gs.
 *  2. Fill in TOKEN below with a long random string (see README for a one-liner).
 *  3. Deploy → New deployment → type "Web app":
 *        Execute as:     Me
 *        Who has access: Anyone
 *     ("Anyone" means anyone with the URL can REACH it — the token is what actually
 *      guards it. Without this the dashboard's server can't call it at all.)
 *  4. Authorise when prompted (it asks for Sheets access; that's this script reading the
 *     tracker). Google will warn the app is unverified — "Advanced" → "Go to … (unsafe)"
 *     is expected for your own script.
 *  5. Copy the /exec URL → dashboard env var APPT_TRACKER_SCRIPT_URL.
 *     Copy TOKEN                → dashboard env var APPT_TRACKER_SCRIPT_TOKEN.
 *
 * Re-deploy after editing: Deploy → Manage deployments → edit → Version: New version.
 * (Editing the code alone does NOT update the live /exec URL.)
 */

// The Appointment Setting Tracker. Same id as in the sheet's URL.
var SHEET_ID = '1JpNSNkH5EJCbJ_j8o7ti9EZaWhNR2ffkyezCfkXY9Js';

// Shared secret — must match APPT_TRACKER_SCRIPT_TOKEN in Vercel. Replace this.
var TOKEN = 'PUT-A-LONG-RANDOM-STRING-HERE';

// Only tabs named like "Cathy - August 2026" carry per-setter data. Month-summary tabs
// ("August 2026 (24)") and legacy ones ("Cathy (3)") don't match and are left out.
var SETTER_TAB = /^.+?\s*-\s*[A-Za-z]+\s+\d{4}$/;

// How much of each tab to send: the header block (the dashboard locates the SMS/CALL Total
// columns by their header text) plus the "Days" totals row. The day-by-day and per-clinic
// detail stays in the sheet — the dashboard only stores month totals.
var HEADER_ROWS = 5;
var MAX_ROWS = 60;
var MAX_COLS = 80;

function doGet(e) {
  var given = (e && e.parameter && e.parameter.token) || '';
  if (!TOKEN || TOKEN.indexOf('PUT-A-LONG') === 0) {
    return json({ ok: false, error: 'script TOKEN not configured' });
  }
  if (given !== TOKEN) {
    return json({ ok: false, error: 'unauthorized' });
  }

  try {
    return json({ ok: true, tabs: readTabs() });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function readTabs() {
  var sheets = SpreadsheetApp.openById(SHEET_ID).getSheets();
  var out = [];

  for (var i = 0; i < sheets.length; i++) {
    var sh = sheets[i];
    var name = sh.getName();
    if (!SETTER_TAB.test(name.trim())) continue;

    var lastRow = Math.min(sh.getLastRow(), MAX_ROWS);
    var lastCol = Math.min(sh.getLastColumn(), MAX_COLS);
    if (lastRow < 2 || lastCol < 2) continue;

    var values = sh.getRange(1, 1, lastRow, lastCol).getValues();

    // Header block, then the totals row wherever it happens to sit (the sheet has 28–31
    // day rows depending on the month, so its position moves).
    var rows = values.slice(0, HEADER_ROWS);
    for (var r = HEADER_ROWS; r < values.length; r++) {
      if (String(values[r][0]).trim().toLowerCase() === 'days') { rows.push(values[r]); break; }
    }

    out.push({ name: name, rows: rows.map(clean) });
  }
  return out;
}

// Dates arrive as Date objects, which JSON.stringify would turn into timestamps. Nothing
// downstream reads the date column, so flatten them to strings and leave numbers alone.
function clean(row) {
  return row.map(function (cell) {
    if (cell instanceof Date) return cell.toISOString();
    return cell === '' ? null : cell;
  });
}

function json(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Run this from the Apps Script editor (Run → testRead) to check the script can see the
 * sheet before deploying. Logs the tab count and the first tab's totals row.
 */
function testRead() {
  var tabs = readTabs();
  Logger.log('setter tabs: ' + tabs.length);
  if (tabs.length) {
    Logger.log('first tab: ' + tabs[0].name);
    Logger.log('rows returned: ' + tabs[0].rows.length);
    Logger.log('totals row: ' + JSON.stringify(tabs[0].rows[tabs[0].rows.length - 1]));
  }
}
