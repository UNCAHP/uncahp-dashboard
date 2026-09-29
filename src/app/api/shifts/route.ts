import { supabaseAdmin } from '@/lib/supabase';

// Shift intake for Viktor (the third-party Slack CSR bot). After the morning Start of Day
// check-in it POSTs each setter's hours here; we upsert into csr_shifts. This sits in
// front of the DB deliberately — Viktor gets a revocable secret scoped to this one
// endpoint, not a Supabase key — and it tolerates the loose time formats setters type.
//
//   POST /api/shifts
//   Authorization: Bearer <SHIFTS_API_SECRET>
//   Body: one row or an array of rows —
//     { "date": "2026-09-24", "csr_name": "Cathy", "shift_start": "8:00", "shift_end": "18:00" }
//     { "date": "2026-09-28", "csr_name": "Alexis", "off": true }
//
// Times are London local. Accepted forms: "8", "8:30", "8.30", "08:30", "6pm", "6:30pm".
// An end hour ≤ 12 with no am/pm is read as afternoon ("8-6" ⇒ 08:00–18:00).

export const dynamic = 'force-dynamic';

type Row = { date: string; csr_name: string; shift_start?: string | null; shift_end?: string | null; off?: boolean };

function parseTime(raw: unknown, assumePm: boolean): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? '0');
  const ap = m[3];
  if (h > 23 || min > 59) return null;
  if (ap === 'pm' && h < 12) h += 12;
  else if (ap === 'am' && h === 12) h = 0;
  else if (!ap && assumePm && h <= 12 && h !== 12) h += 12;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

function parseRow(r: unknown): { row: Record<string, unknown> } | { error: string } {
  if (!r || typeof r !== 'object') return { error: 'row must be an object' };
  const x = r as Row;
  const date = String(x.date ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: `bad date "${x.date}" (want YYYY-MM-DD)` };
  const csr_name = String(x.csr_name ?? '').trim();
  if (!csr_name) return { error: 'csr_name is required' };
  const csr_key = csr_name.split(/\s+/)[0].toLowerCase();

  const off = x.off === true || /^(not in|off)$/i.test(String(x.shift_start ?? '').trim());
  let shift_start: string | null = null, shift_end: string | null = null;
  if (!off) {
    shift_start = parseTime(x.shift_start, false);
    shift_end = parseTime(x.shift_end, true);
    if (!shift_start || !shift_end) return { error: `bad times "${x.shift_start}"–"${x.shift_end}" for ${csr_name} on ${date}` };
    if (shift_end <= shift_start) return { error: `shift ends before it starts (${shift_start}–${shift_end}) for ${csr_name} on ${date}` };
  }
  return { row: { shift_date: date, csr_key, csr_name, shift_start, shift_end, off, source: 'viktor', raw: x } };
}

export async function POST(req: Request) {
  const secret = process.env.SHIFTS_API_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'SHIFTS_API_SECRET not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: 'body must be JSON' }, { status: 400 }); }
  const items = Array.isArray(body) ? body : [body];
  if (items.length === 0 || items.length > 500) return Response.json({ ok: false, error: 'send 1–500 rows' }, { status: 400 });

  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  items.forEach((it, i) => {
    const p = parseRow(it);
    if ('error' in p) errors.push(`row ${i}: ${p.error}`); else rows.push(p.row);
  });
  if (rows.length === 0) return Response.json({ ok: false, error: 'no valid rows', errors }, { status: 400 });

  const { error } = await supabaseAdmin.from('csr_shifts').upsert(rows, { onConflict: 'csr_key,shift_date' });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, written: rows.length, rejected: errors.length, errors });
}
