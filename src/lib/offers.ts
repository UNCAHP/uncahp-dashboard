import { supabase, supabaseAdmin } from './supabase';
import { fetchAll, type DateRange } from './queries';
import type { FunnelPageLink } from './funnelAdmin';

// ─── Offers: every campaign that's live in a client's Meta ad account right now ─────────
// "Live" starts from Meta's own answer: a campaign with at least one ad whose
// effective_status is ACTIVE (the ad, its ad set and its campaign all on). Old campaigns
// can sit ACTIVE for years without delivering, so a campaign also has to have spent in
// the last RECENT_DAYS days, or have been created within them (the daily sync lags). The
// ads and their creatives are read straight from Meta with the agency system-user token
// (META_ACCESS_TOKEN), since thumbnail links are signed and expire. Spend and leads come
// from meta_daily_stats for the dashboard's date range, and the funnel's pages from
// funnels.meta_campaign_ids.

const GRAPH = 'https://graph.facebook.com/v21.0';
const RECENT_DAYS = 7;
const AD_FIELDS = [
  'id', 'name', 'campaign_id', 'campaign{created_time}', 'preview_shareable_link',
  'creative.thumbnail_width(600).thumbnail_height(600){thumbnail_url,image_url,title,body,object_type,object_story_spec,asset_feed_spec}',
].join(',');

export type OfferAd = {
  id: string;
  name: string;
  thumb: string | null;
  video: boolean;
  previewUrl: string | null;  // Meta's shareable ad preview
};

export type Offer = {
  campaignId: string;
  clientId: string;
  name: string;
  createdAt: string | null;     // when the campaign was created in Meta
  destination: 'form' | 'page' | 'both' | null;   // instant form, landing page, or neither (awareness, messages)
  ads: OfferAd[];
  headlines: string[];
  bodies: string[];
  links: string[];              // landing pages the ads send people to
  funnel: { name: string; pages: FunnelPageLink[] } | null;
  spend: number;                // £ in range
  leads: number;                // Meta-reported leads in range
};

export type OffersResult = {
  offers: Offer[];
  errors: { clientId: string; message: string }[];
};

type Cta = { type?: string; value?: { link?: string; lead_gen_form_id?: string } };
type StoryData = { message?: string; title?: string; name?: string; link?: string; picture?: string; image_url?: string; call_to_action?: Cta };
type Creative = {
  thumbnail_url?: string; image_url?: string; title?: string; body?: string; object_type?: string;
  object_story_spec?: { video_data?: StoryData; link_data?: StoryData & { child_attachments?: StoryData[] }; template_data?: StoryData };
  asset_feed_spec?: { bodies?: { text?: string }[]; titles?: { text?: string }[]; link_urls?: { website_url?: string }[]; videos?: unknown[] };
};
type MetaAd = { id: string; name?: string; campaign_id?: string; campaign?: { created_time?: string }; preview_shareable_link?: string; creative?: Creative };

const clean = (s: string | undefined) => (s ?? '').trim();
// Instant-form ads carry a lead form id, and Meta fills their link with an fb.me
// placeholder. Messenger and other Facebook links aren't landing pages either.
const isFormLink = (u: string) => /^https?:\/\/fb\.me\/?$/i.test(u);
const isFacebookLink = (u: string) => /^https?:\/\/([a-z]+\.)?(fb\.me|fb\.com|facebook\.com)\b/i.test(u);

// What one creative says and where it sends people.
function readCreative(c: Creative | undefined) {
  const out = { headlines: [] as string[], bodies: [] as string[], links: [] as string[], form: false, video: false, image: null as string | null };
  if (!c) return out;
  const s = c.object_story_spec;
  const story = s?.video_data ?? s?.link_data ?? s?.template_data;
  if (story) {
    out.bodies.push(clean(story.message));
    out.headlines.push(clean(story.title ?? story.name));
    const cta = story.call_to_action?.value;
    // An ad with a lead form sends people to the form. Its link is left over from the ad
    // it was copied from and is never used, so it isn't a landing page.
    if (cta?.lead_gen_form_id) out.form = true;
    else out.links.push(...[cta?.link, story.link].filter((l): l is string => !!l));
    out.image = story.image_url ?? story.picture ?? null;
  }
  if (s?.video_data) out.video = true;
  const f = c.asset_feed_spec;
  if (f) {
    out.bodies.push(...(f.bodies ?? []).map(b => clean(b.text)));
    out.headlines.push(...(f.titles ?? []).map(t => clean(t.text)));
    out.links.push(...(f.link_urls ?? []).map(l => clean(l.website_url)));
    if (f.videos?.length) out.video = true;
  }
  out.bodies.push(clean(c.body));
  out.headlines.push(clean(c.title));
  if (c.object_type === 'VIDEO') out.video = true;
  out.image = c.image_url ?? out.image;
  if (out.links.some(isFormLink)) out.form = true;
  out.links = out.links.filter(l => l && !isFacebookLink(l));
  return out;
}

async function liveAds(account: string, token: string): Promise<{ ads: MetaAd[]; error?: string }> {
  const acct = 'act_' + account.replace(/^act_/, '');
  const status = encodeURIComponent('["ACTIVE"]');
  let url: string | null = `${GRAPH}/${acct}/ads?fields=${encodeURIComponent(AD_FIELDS)}&effective_status=${status}&limit=100&access_token=${token}`;
  const ads: MetaAd[] = [];
  for (let page = 0; url && page < 10; page++) {
    // Cached briefly so flipping between pages doesn't refetch every account.
    const res: Response = await fetch(url, { next: { revalidate: 900 } });
    const j: { data?: MetaAd[]; error?: { message?: string }; paging?: { next?: string } } = await res.json();
    if (j.error) return { ads, error: j.error.message ?? 'Meta API error' };
    ads.push(...(j.data ?? []));
    url = j.paging?.next ?? null;
  }
  return { ads };
}

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];

// clientId narrows it to one client, so only that ad account is read from Meta.
export async function getActiveOffers(range: DateRange, clientId?: string): Promise<OffersResult> {
  const token = process.env.META_ACCESS_TOKEN;
  let clientsQ = supabaseAdmin
    .from('clients')
    .select('ghl_location_id, meta_ad_account_id')
    .eq('status', 'active')
    .not('ghl_location_id', 'is', null)
    .not('meta_ad_account_id', 'is', null);
  if (clientId) clientsQ = clientsQ.eq('ghl_location_id', clientId);
  const { data: clients, error } = await clientsQ;
  if (error) throw error;
  if (!token) return { offers: [], errors: [{ clientId: '', message: 'META_ACCESS_TOKEN is not set on the server.' }] };

  const accounts = (clients ?? []) as { ghl_location_id: string; meta_ad_account_id: string }[];
  const recentSince = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [live, stats, recent, campaigns, funnels] = await Promise.all([
    Promise.all(accounts.map(async a => ({ clientId: a.ghl_location_id, ...(await liveAds(String(a.meta_ad_account_id), token)) }))),
    fetchAll<{ campaign_source_id: string | null; spend_cents: number | null; leads: number | null }>(() =>
      supabase.from('meta_daily_stats')
        .select('campaign_source_id, spend_cents, leads')
        .gte('date', range.since)
        .lte('date', range.until)
        .order('date')),
    fetchAll<{ campaign_source_id: string | null }>(() =>
      supabase.from('meta_daily_stats')
        .select('campaign_source_id')
        .gte('date', recentSince)
        .gt('spend_cents', 0)
        .order('date')),
    supabaseAdmin.from('meta_campaigns').select('source_id, name'),
    supabaseAdmin.from('funnels').select('name, status, meta_campaign_ids, pages').eq('status', 'active'),
  ]);

  const perf = new Map<string, { spend: number; leads: number }>();
  for (const s of stats) {
    if (!s.campaign_source_id) continue;
    const p = perf.get(s.campaign_source_id) ?? { spend: 0, leads: 0 };
    p.spend += (s.spend_cents ?? 0) / 100;
    p.leads += s.leads ?? 0;
    perf.set(s.campaign_source_id, p);
  }
  const spentRecently = new Set(recent.map(r => r.campaign_source_id));
  const campInfo = new Map(((campaigns.data ?? []) as { source_id: string; name: string | null }[])
    .map(c => [c.source_id, c]));
  const funnelFor = new Map<string, { name: string; pages: FunnelPageLink[] }>();
  for (const f of (funnels.data ?? []) as { name: string; meta_campaign_ids: string[] | null; pages: unknown }[]) {
    const pages = Array.isArray(f.pages) ? (f.pages as FunnelPageLink[]).filter(p => p?.url) : [];
    for (const id of f.meta_campaign_ids ?? []) funnelFor.set(id, { name: f.name, pages });
  }

  const offers: Offer[] = [];
  const errors: OffersResult['errors'] = [];
  for (const acc of live) {
    if (acc.error) errors.push({ clientId: acc.clientId, message: acc.error });
    const byCampaign = new Map<string, MetaAd[]>();
    for (const ad of acc.ads) {
      if (!ad.campaign_id) continue;
      byCampaign.set(ad.campaign_id, [...(byCampaign.get(ad.campaign_id) ?? []), ad]);
    }
    for (const [campaignId, ads] of byCampaign) {
      const created = ads[0].campaign?.created_time?.slice(0, 10);
      if (!spentRecently.has(campaignId) && !(created && created >= recentSince)) continue;
      const read = ads.map(a => ({ ad: a, c: readCreative(a.creative) }));
      const form = read.some(r => r.c.form);
      const links = uniq(read.flatMap(r => r.c.links));
      const info = campInfo.get(campaignId);
      const p = perf.get(campaignId) ?? { spend: 0, leads: 0 };
      offers.push({
        campaignId,
        clientId: acc.clientId,
        name: info?.name ?? ads[0].name ?? campaignId,
        createdAt: ads[0].campaign?.created_time ?? null,
        destination: form && links.length ? 'both' : form ? 'form' : links.length ? 'page' : null,
        ads: read.map(({ ad, c }) => ({
          id: ad.id,
          name: ad.name ?? '',
          thumb: ad.creative?.thumbnail_url ?? c.image ?? null,
          video: c.video,
          previewUrl: ad.preview_shareable_link ?? null,
        })),
        headlines: uniq(read.flatMap(r => r.c.headlines)),
        bodies: uniq(read.flatMap(r => r.c.bodies)),
        links,
        funnel: funnelFor.get(campaignId) ?? null,
        spend: p.spend,
        leads: p.leads,
      });
    }
  }
  offers.sort((a, b) => b.spend - a.spend);
  return { offers, errors };
}
