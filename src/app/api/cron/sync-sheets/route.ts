import { syncSheetBookings, type SheetBookingsSyncResult } from '@/lib/sheetBookingsSync';

// Pulls the Appointment Setting Tracker sheet into csr_sheet_bookings (the CSR scorecard's
// Confirmed bookings + Phone booking ratio). Unlike the per-client syncs this is a single
// global job — the sheet covers every setter across every clinic — so the daily dispatcher
// triggers it once alongside the client fan-out.
//
// Also safe to hit by hand when the sheet has just been updated and you don't want to wait
// for the 06:00 run.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const result = await syncSheetBookings().catch((e): SheetBookingsSyncResult => ({
    ok: false, error: e instanceof Error ? e.message : 'sheet sync error',
  }));

  console.log('[cron] sheet bookings:', JSON.stringify(result));
  return Response.json(result);
}
