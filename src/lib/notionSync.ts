import { getActiveOffers, type Offer } from './offers';
import { getActiveClients } from './queries';

// ─── Live offers → a Notion database ─────────────────────────────────────────
// Keeps a "Live Offers" database on a Notion page up to date with what's live in every
// client's Meta ad account (the same data as the Offers page), so the team can read it in
// Notion without signing in to the dashboard.
//
// Setup: a Notion internal connection's token in NOTION_TOKEN, and that connection added
// to the page (⋯ → Connections). NOTION_PAGE_ID picks the page; it defaults to "Live Ads"
// in UNCAHP / Systems Records. The database is created on that page on the first run and
// found again by its title after that, so it can be moved around the page freely.
//
// One row per campaign, keyed by its Meta campaign ID. A row is updated in place, so any
// columns the team adds themselves (notes, owner…) are left alone. A campaign that stops
// is marked Ended rather than deleted, unless its client's ad account couldn't be read
// this time (then its rows are left as they were).

const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const DB_TITLE = 'Live Offers';
const DEFAULT_PAGE = '41392958c707801abdfcc4fe9e591ffa';

export type NotionSyncResult = { ok: boolean; created: number; updated: number; ended: number; error?: string; databaseUrl?: string };

type NotionPage = { id: string; properties: Record<string, { rich_text?: { plain_text: string }[]; select?: { name: string } | null }> };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Notion allows about 3 requests a second: space them out, and wait when told to.
async function notion<T>(token: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
    if (res.status === 429 && attempt < 5) {
      await sleep(Number(res.headers.get('retry-after') ?? '1') * 1000);
      continue;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (j as { message?: string }).message ?? `Notion ${res.status}`;
      if (res.status === 404 || res.status === 403) throw new Error(`${msg}. Is the "UNCAHP Dashboard" connection added to the Notion page (⋯ → Connections)?`);
      if (res.status === 401) throw new Error(`${msg}. NOTION_TOKEN is wrong or was revoked.`);
      throw new Error(msg);
    }
    await sleep(340);
    return j as T;
  }
}

const SCHEMA = {
  'Offer': { title: {} },
  'Client': { select: {} },
  'Setter': { select: {} },
  'Status': { select: { options: [{ name: 'Live', color: 'green' }, { name: 'Ended', color: 'gray' }] } },
  'Goes to': { select: { options: [{ name: 'Landing page', color: 'blue' }, { name: 'Instant form', color: 'purple' }, { name: 'Both', color: 'pink' }, { name: 'Other', color: 'gray' }] } },
  'Spend this month': { number: { format: 'pound' } },
  'Leads this month': { number: { format: 'number' } },
  'Cost per lead': { number: { format: 'pound' } },
  'Headline': { rich_text: {} },
  'Landing page': { url: {} },
  'Ad preview': { url: {} },
  'Ads running': { number: { format: 'number' } },
  'Live since': { date: {} },
  'Last synced': { date: {} },
  'Campaign ID': { rich_text: {} },
} as const;

async function findOrCreateDatabase(token: string, pageId: string): Promise<{ id: string; url: string }> {
  let cursor: string | undefined;
  do {
    const r = await notion<{ results: { id: string; type: string; child_database?: { title: string } }[]; next_cursor: string | null }>(
      token, `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    const hit = r.results.find(b => b.type === 'child_database' && b.child_database?.title === DB_TITLE);
    if (hit) {
      // Add any columns a newer version of this sync expects; existing ones are untouched.
      const db = await notion<{ url: string }>(token, `/databases/${hit.id}`, 'PATCH', { properties: SCHEMA });
      return { id: hit.id, url: db.url };
    }
    cursor = r.next_cursor ?? undefined;
  } while (cursor);

  const db = await notion<{ id: string; url: string }>(token, '/databases', 'POST', {
    parent: { type: 'page_id', page_id: pageId },
    title: [{ type: 'text', text: { content: DB_TITLE } }],
    is_inline: true,
    properties: SCHEMA,
  });
  return db;
}

async function allRows(token: string, dbId: string): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const r = await notion<{ results: NotionPage[]; next_cursor: string | null }>(token, `/databases/${dbId}/query`, 'POST',
      { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...r.results);
    cursor = r.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

const text = (s: string) => [{ type: 'text', text: { content: s.slice(0, 2000) } }];
const sel = (name: string | null) => (name ? { select: { name: name.replace(/,/g, ' ').slice(0, 100) } } : { select: null });
const url = (u: string | null | undefined) => ({ url: u && /^https?:\/\//.test(u) ? u : null });
const GOES_TO = { page: 'Landing page', form: 'Instant form', both: 'Both' } as const;

function properties(o: Offer, clientName: string, setter: string | null, now: string) {
  const landing = o.funnel?.pages[0]?.url ?? o.links[0] ?? null;
  return {
    'Offer': { title: text(o.name) },
    'Client': sel(clientName),
    'Setter': sel(setter),
    'Status': sel('Live'),
    'Goes to': sel(o.destination ? GOES_TO[o.destination] : 'Other'),
    'Spend this month': { number: Math.round(o.spend * 100) / 100 },
    'Leads this month': { number: o.leads },
    'Cost per lead': { number: o.leads ? Math.round((o.spend / o.leads) * 100) / 100 : null },
    'Headline': { rich_text: text(o.headlines[0] ?? '') },
    'Landing page': url(landing),
    'Ad preview': url(o.ads.find(a => a.previewUrl)?.previewUrl),
    'Ads running': { number: o.ads.length },
    'Live since': { date: o.createdAt ? { start: o.createdAt.slice(0, 10) } : null },
    'Last synced': { date: { start: now } },
    'Campaign ID': { rich_text: text(o.campaignId) },
  };
}

export async function syncOffersToNotion(): Promise<NotionSyncResult> {
  const token = process.env.NOTION_TOKEN;
  if (!token) return { ok: false, created: 0, updated: 0, ended: 0, error: 'NOTION_TOKEN is not set.' };
  const pageId = (process.env.NOTION_PAGE_ID || DEFAULT_PAGE).replace(/-/g, '');

  try {
    const today = new Date().toISOString().slice(0, 10);
    const range = { since: `${today.slice(0, 8)}01`, until: today, label: 'This month' };
    const [{ offers, errors }, clients] = await Promise.all([getActiveOffers(range), getActiveClients()]);
    const client = new Map(clients.map(c => [c.client_id, c]));
    const unreadable = new Set(errors.map(e => e.clientId));

    const db = await findOrCreateDatabase(token, pageId);
    const rows = await allRows(token, db.id);
    const byCampaign = new Map<string, NotionPage>();
    for (const r of rows) {
      const id = r.properties['Campaign ID']?.rich_text?.map(t => t.plain_text).join('').trim();
      if (id) byCampaign.set(id, r);
    }

    const now = new Date().toISOString();
    let created = 0, updated = 0, ended = 0;
    const live = new Set<string>();
    for (const o of offers) {
      live.add(o.campaignId);
      const c = client.get(o.clientId);
      const props = properties(o, c?.client_name ?? o.clientId, c?.csr_key ? c.csr_key[0].toUpperCase() + c.csr_key.slice(1) : 'Self booking', now);
      const row = byCampaign.get(o.campaignId);
      if (row) { await notion(token, `/pages/${row.id}`, 'PATCH', { properties: props }); updated++; }
      else { await notion(token, '/pages', 'POST', { parent: { database_id: db.id }, properties: props }); created++; }
    }

    // Campaigns no longer live → Ended. Skip clients whose ad account couldn't be read.
    const nameToId = new Map(clients.map(c => [c.client_name, c.client_id]));
    for (const [campaignId, row] of byCampaign) {
      if (live.has(campaignId) || row.properties['Status']?.select?.name !== 'Live') continue;
      const clientId = nameToId.get(row.properties['Client']?.select?.name ?? '');
      if (clientId && unreadable.has(clientId)) continue;
      await notion(token, `/pages/${row.id}`, 'PATCH', { properties: { 'Status': sel('Ended'), 'Last synced': { date: { start: now } } } });
      ended++;
    }

    return { ok: true, created, updated, ended, databaseUrl: db.url };
  } catch (e) {
    return { ok: false, created: 0, updated: 0, ended: 0, error: e instanceof Error ? e.message : 'Notion sync failed' };
  }
}
