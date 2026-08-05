import { buildSplitScript } from '@/lib/splitScript';

// Serves the split-test snippet (split.js). Funnels load it with:
//   <script src="https://<dashboard>/api/track/script" data-funnel="salon-house-hifu"></script>
// The collector URL is the sibling /api/track on this same origin, injected at serve time
// so the pasted tag never needs a hard-coded URL.
export const dynamic = 'force-dynamic';

export function GET(req: Request) {
  const collector = new URL('/api/track', req.url).toString();
  return new Response(buildSplitScript(collector), {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Cache at the CDN but let it refresh within the hour; funnels don't need instant edits.
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
