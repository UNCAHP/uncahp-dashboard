import { defaultRange, getClientList, getFunnelMetrics } from '@/lib/queries';
import { getAdminFunnels } from '@/lib/funnelAdmin';
import { getSplitTests } from '@/lib/splitTests';
import { splitTotals, applySplitTotals } from '@/lib/funnelTotals';

// Read-only Funnel Analytics for Viktor (the Slack bot), so its reports use the same numbers
// the dashboard shows. Same bearer secret as /api/shifts and /api/speed-to-lead.
//
//   GET /api/funnel-analytics?since=YYYY-MM-DD&until=YYYY-MM-DD[&client=<ghl location id>][&funnel=<funnel id>][&status=active|archived|all][&daily=1]
//   Authorization: Bearer <SHIFTS_API_SECRET>
//
// Defaults: the last 30 days (the dashboard's default range), active funnels only.
// `from` / `to` are accepted as aliases of `since` / `until`. `daily=1` adds each funnel's
// opt-ins and deposits per day.
//
// Each funnel's lp_views / optins / deposits are its headline stage numbers exactly as the
// Funnel Analytics page shows them for that range — see `source` for where they come from:
//   meta_ghl     LP views from the mapped Meta campaigns; opt-ins from GHL contacts carrying
//                all the funnel's opt-in tags; deposits from GHL payments.
//   first_party  the funnel's own page tracking (a split test, or a funnel with no Meta
//                campaigns mapped). `winner` names the version shown once a test is decided.
// `meta` is the ad side (spend, CPL, cost per deposit...) and is null when no campaigns are
// mapped. Its cost-per figures always divide by the GHL opt-ins and deposits (`ghl`).

export const dynamic = 'force-dynamic';

const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: Request) {
  const secret = process.env.SHIFTS_API_SECRET;
  if (!secret) return Response.json({ ok: false, error: 'SHIFTS_API_SECRET not configured' }, { status: 503 });
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const q = new URL(req.url).searchParams;
  const sinceParam = q.get('since') ?? q.get('from');
  const untilParam = q.get('until') ?? q.get('to');
  if ((sinceParam && !isDate(sinceParam)) || (untilParam && !isDate(untilParam))) {
    return Response.json({ ok: false, error: 'Dates must be YYYY-MM-DD' }, { status: 400 });
  }
  const fallback = defaultRange(30);
  const since = sinceParam ?? fallback.since;
  const until = untilParam ?? (sinceParam ? sinceParam : fallback.until);
  if (until < since) return Response.json({ ok: false, error: '`until` is before `since`' }, { status: 400 });
  const range = { since, until, label: `${since} to ${until}` };

  const clientFilter = q.get('client')?.trim() || null;
  const funnelFilter = q.get('funnel')?.trim() || null;
  const status = (q.get('status')?.trim().toLowerCase() || 'active') as string;
  if (!['active', 'archived', 'all'].includes(status)) {
    return Response.json({ ok: false, error: '`status` must be active, archived or all' }, { status: 400 });
  }
  const wantDaily = ['1', 'true'].includes(q.get('daily')?.trim().toLowerCase() ?? '');

  const [funnels, clients, tests] = await Promise.all([getAdminFunnels(), getClientList(), getSplitTests(range)]);
  const clientName = new Map(clients.map(c => [c.client_id, c.client_name]));
  const testByFunnel = new Map(tests.map(t => [t.funnelId, t]));

  const chosen = funnels.filter(f =>
    (funnelFilter ? f.id === funnelFilter : status === 'all' || f.status === status) &&
    (!clientFilter || f.client_id === clientFilter));
  if (funnelFilter && chosen.length === 0) return Response.json({ ok: false, error: 'No funnel with that id' }, { status: 404 });

  const rows = await Promise.all(chosen.map(async f => {
    const raw = await getFunnelMetrics(f, range);
    const test = testByFunnel.get(f.id);
    const fp = splitTotals(test, raw.meta_campaign_count);
    const m = applySplitTotals(raw, test);
    return {
      funnel_id: f.id,
      funnel_name: f.name,
      client_id: f.client_id,
      client_name: clientName.get(f.client_id) ?? null,
      status: f.status,
      source: fp ? 'first_party' : 'meta_ghl',
      winner: fp?.winner ?? null,
      lp_views: m.lp_views,
      optins: m.optins,
      deposits: m.deposits,
      deposits_funnel: m.deposits_direct,
      deposits_phone: m.deposits_setter,
      optin_rate_pct: m.optin_rate_pct,              // opt-ins ÷ LP views
      deposit_rate_pct: m.deposit_rate_direct_pct,   // funnel deposits ÷ opt-ins
      conversion_rate_pct: m.deposit_rate_pct,       // all deposits ÷ opt-ins
      meta: raw.meta,
      ghl: { optins: raw.optins, deposits: raw.deposits, deposits_funnel: raw.deposits_direct, deposits_phone: raw.deposits_setter },
      optin_tags: f.optin_tags,
      deposit_sources: f.deposit_sources,
      phone_sources: f.setter_sources,
      meta_campaigns_mapped: raw.meta_campaign_count,
      split_test: test && test.mode === 'test' ? { status: test.status, versions: test.variants.length, winner: fp?.winner ?? null } : null,
      ...(wantDaily ? { daily: raw.daily } : {}),
    };
  }));

  rows.sort((a, b) => (a.client_name ?? '').localeCompare(b.client_name ?? '') || a.funnel_name.localeCompare(b.funnel_name));
  const sum = (k: 'optins' | 'deposits') => rows.reduce((s, r) => s + r[k], 0);
  const spend = rows.reduce((s, r) => s + (r.meta?.spend ?? 0), 0);
  return Response.json({
    ok: true,
    since,
    until,
    status: funnelFilter ? null : status,
    totals: { funnels: rows.length, lp_views: rows.reduce((s, r) => s + (r.lp_views ?? 0), 0), optins: sum('optins'), deposits: sum('deposits'), meta_spend: +spend.toFixed(2) },
    funnels: rows,
  });
}
