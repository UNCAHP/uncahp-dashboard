// Bearer check for the read-only reporting endpoints (/api/speed-to-lead and
// /api/funnel-analytics). Two keys are accepted:
//   REPORTS_API_SECRET  read-only: opens these two endpoints and nothing else. This is the
//                       one to hand to a reporting job.
//   SHIFTS_API_SECRET   the original integration key, which can also write shifts through
//                       /api/shifts. Still accepted here so existing callers keep working.
// /api/shifts does NOT use this helper and never accepts the read-only key.
// Returns null when the request is allowed, otherwise the error response to send back.
export function rejectUnlessReader(req: Request): Response | null {
  const keys = [process.env.REPORTS_API_SECRET, process.env.SHIFTS_API_SECRET].filter((k): k is string => !!k);
  if (keys.length === 0) return Response.json({ ok: false, error: 'No API secret configured' }, { status: 503 });
  const header = req.headers.get('authorization');
  if (!header || !keys.some(k => header === `Bearer ${k}`)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
