import { syncOffersToNotion } from '@/lib/notionSync';

// Live offers → the "Live Offers" database in Notion (see lib/notionSync). Vercel Cron,
// a few times a day so offers launched during the day show up the same day.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const res = await syncOffersToNotion();
  console.log('[cron] notion:', JSON.stringify(res));
  return Response.json(res, { status: res.ok ? 200 : 500 });
}
