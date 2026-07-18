// destinations/notion.js — Notion destination (PAT auth, data-source API 2026-03-11).
// The user's PAT and target page live in chrome.storage.local; nothing here
// ever logs the token.
import { t } from '../i18n.js';
import { formatTime } from '../utils.js';

export const id = 'notion';
export const NOTION_API = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2026-03-11';

export async function getNotionConfig() {
  const s = await chrome.storage.local.get(['sc_notion_token', 'sc_notion_parent', 'sc_notion_ds', 'sc_notion_props']);
  return {
    token: s.sc_notion_token || null,
    parentUrl: s.sc_notion_parent || null,
    dataSourceId: s.sc_notion_ds || null,
    props: s.sc_notion_props || null,
  };
}

// Accepts a pasted Notion page URL (dashed UUID or bare 32-hex) → page id.
export function parsePageId(url) {
  const m = (url || '').replace(/-/g, '').match(/([0-9a-f]{32})(?=[?#/]|$)/i);
  return m ? m[1].toLowerCase() : null;
}

// One video = one Notion page, but the modes reach send() with slightly
// different URLs for the same video (raw tab URL with &t=/&list=, cleaned
// og:url, …). The upsert key is this canonical form — the same idea as
// vault-autopilot's videoKey().
export function canonicalVideoUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/')[1];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (host.endsWith('youtube.com')) {
      const id = u.searchParams.get('v') || (u.pathname.match(/^\/shorts\/([\w-]+)/) || [])[1];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (host.endsWith('bilibili.com')) {
      const bv = (u.pathname.match(/\/video\/(BV\w+)/) || [])[1];
      if (bv) return `https://www.bilibili.com/video/${bv}`;
    }
    if (host.endsWith('xiaohongshu.com')) return u.origin + u.pathname;
    u.hash = '';
    return u.toString();
  } catch (_) { return url; }
}

// Single fetch wrapper: auth headers, JSON, localized errors, 429 backoff.
export async function notionRequest(path, { method = 'GET', token, body, form } = {}, _retried = 0) {
  let resp;
  try {
    resp = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        ...(form ? {} : { 'Content-Type': 'application/json' }),
      },
      body: form || (body ? JSON.stringify(body) : undefined),
    });
  } catch (_) {
    throw new Error(t('err_notion_network'));
  }
  if (resp.status === 401 || resp.status === 403) throw new Error(t('err_notion_auth'));
  if (resp.status === 404) {
    // code lets send() distinguish "target gone" (stale cache → self-heal)
    // from other failures.
    const e = new Error(t('err_notion_target'));
    e.code = 404;
    throw e;
  }
  if (resp.status === 429) {
    if (_retried >= 3) throw new Error(t('err_notion_rate'));
    // Notion says how long to back off (Retry-After, seconds); fall back to a
    // growing delay. Capped — a long timer risks the service worker being
    // torn down mid-wait.
    const hinted = parseFloat(resp.headers?.get?.('Retry-After'));
    const waitMs = Math.min(hinted > 0 ? hinted * 1000 : 1200 * (_retried + 1), 15000);
    await new Promise((r) => setTimeout(r, waitMs));
    return notionRequest(path, { method, token, body, form }, _retried + 1);
  }
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => null);
    throw new Error(t('err_save_failed', [String(errBody?.message || resp.status)]));
  }
  return resp.json();
}

export async function ping() {
  const cfg = await getNotionConfig();
  if (!cfg.token) return { connected: false };
  try {
    await notionRequest('/users/me', { token: cfg.token });
    return { connected: true };
  } catch (_) {
    return { connected: false };
  }
}

// /users/me only proves the token; it says nothing about whether the user
// finished the share step (page ••• → Connections). Touch the pasted target
// itself so save-and-test catches the missing share before the first clip
// does. The link may be a database (duplicated template) or a plain page.
export async function verifyParentAccess(cfg) {
  const id = parsePageId(cfg.parentUrl);
  if (!id) return false;
  for (const path of [`/databases/${id}`, `/pages/${id}`]) {
    try { await notionRequest(path, { token: cfg.token }); return true; } catch (_) {}
  }
  return false;
}

// ── Content mapping ───────────────────────────────────────────────────────────
// Section headings are CONTENT written into the user's Notion page, not UI
// chrome — and upsert matching must recognize BOTH locales at once (the user
// may switch browser language between captures), which chrome.i18n cannot
// provide. So they live here as constants instead of _locales.
export const SECTION_TITLES = {
  screenshot: ['Screenshots', '截图'],
  thumbnail:  ['Cover', '封面'],
  hook:       ['Hook', '开场 Hook'],
  keyframe:   ['Keyframes', '关键帧'],
};

// Canonical order of sections in the page, whatever order they're captured in
// (mirrors vault-autopilot's KINDS rank). Keyframes and screenshots accumulate
// across captures; cover and hook hold one current version.
export const SECTION_ORDER = ['thumbnail', 'hook', 'keyframe', 'screenshot'];
const APPEND_MODES = ['keyframe', 'screenshot'];

export function sectionTitleFor(mode) {
  const lang = globalThis.chrome?.i18n?.getUILanguage?.() || 'en';
  return SECTION_TITLES[mode][lang.startsWith('zh') ? 1 : 0];
}

// Notion caps rich_text.text.content at 2000 chars; stay under it.
export function chunkText(text, size = 1900) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

export function collectImages(payload) {
  if (payload.mode === 'screenshot') return payload.images || (payload.image ? [payload.image] : []);
  if (payload.mode === 'hook' || payload.mode === 'keyframe') return payload.frames || [];
  return [];
}

const para = (content) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } });
const imgUpload = (fid) => ({ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: fid } } });
const imgExternal = (url) => ({ object: 'block', type: 'image', image: { type: 'external', external: { url } } });
const embed = (url) => ({ object: 'block', type: 'embed', embed: { url } });

// Hook / keyframe sections open with the video player, mirroring
// vault-autopilot's buildVideoEmbed. Platform embed players take the start
// time as their own parameter — a plain video URL with ?t= gets unfurled by
// Notion into its player and the seek is dropped (bilibili's 记忆续播 then
// resumes wherever the user last watched instead of the clip start).
export function videoEmbedUrl(url, startSeconds) {
  const s = Math.floor(startSeconds || 0);
  const canonical = canonicalVideoUrl(url);
  try {
    const u = new URL(canonical);
    const host = u.hostname.replace(/^www\./, '');
    if (host.endsWith('youtube.com')) {
      const id = u.searchParams.get('v');
      if (id) return `https://www.youtube.com/embed/${id}?start=${s}`;
    }
    if (host.endsWith('bilibili.com')) {
      const id = (u.pathname.match(/\/video\/(BV\w+)/) || [])[1];
      // autoplay=0: several embeds in one page would all start at once;
      // danmaku=0 keeps replays clean. (Same params as vault-autopilot.)
      // t is floored at 1: the player treats t=0 as "not set" and a logged-in
      // viewer then resumes from watch history instead of the video opening.
      if (id) return `https://player.bilibili.com/player.html?bvid=${id}&page=1&t=${Math.max(s, 1)}&autoplay=0&danmaku=0`;
    }
    if (!s) return canonical;
    u.searchParams.set('t', String(s));
    return u.toString();
  } catch (_) { return url; }
}

export function payloadToBlocks(payload, uploadIds = []) {
  const blocks = [];
  const range = payload.time_range
    ? para(`${formatTime(payload.time_range.start)} – ${formatTime(payload.time_range.end)}`) : null;
  switch (payload.mode) {
    case 'screenshot':
      blocks.push(...uploadIds.map(imgUpload));
      break;
    case 'thumbnail': {
      const metaLine = [payload.channel, payload.views].filter(Boolean).join(' · ');
      if (metaLine) blocks.push(para(metaLine));
      blocks.push(imgExternal(payload.thumbnail_url));
      break;
    }
    case 'hook':
      if (payload.url) blocks.push(embed(videoEmbedUrl(payload.url, 0)));
      if (range) blocks.push(range);
      blocks.push(...uploadIds.map(imgUpload));
      if (payload.transcript) blocks.push(...chunkText(payload.transcript).map(para));
      break;
    case 'keyframe':
      if (payload.url) blocks.push(embed(videoEmbedUrl(payload.url, payload.time_range?.start)));
      if (range) blocks.push(range);
      blocks.push(...uploadIds.map(imgUpload));
      break;
  }
  return blocks;
}

const headingText = (b) => (b[b.type]?.rich_text || []).map((r) => r.plain_text ?? r.text?.content ?? '').join('').trim();

function modeOfHeading(text) {
  for (const m of SECTION_ORDER) if (SECTION_TITLES[m].includes(text)) return m;
  return null;
}

// Group the page's top-level blocks into sections: a heading_2 starts one,
// everything until the next heading_2 is its content. mode = null for headings
// we don't own (user content) — kept so ordering can insert around them.
export function scanSections(children) {
  const sections = [];
  let cur = null;
  for (const b of children) {
    if (b.type === 'heading_2') {
      cur = { mode: modeOfHeading(headingText(b)), headingId: b.id, blocks: [] };
      sections.push(cur);
    } else if (cur) {
      cur.blocks.push(b);
    }
  }
  return sections;
}

// Our mode's heading (either locale) + its content block ids.
export function findSection(children, mode) {
  const s = scanSections(children).find((x) => x.mode === mode);
  return s ? { headingId: s.headingId, contentIds: s.blocks.map((b) => b.id) } : null;
}

// Where a NEW section belongs: after the last block of the closest
// lower-ranked section we own, else before the first section we own, else at
// the page end (null → no position parameter, Notion's default).
function insertPositionFor(children, mode) {
  const ours = scanSections(children).filter((s) => s.mode !== null);
  if (!ours.length) return null;
  const rank = SECTION_ORDER.indexOf(mode);
  let prev = null;
  for (const s of ours) {
    const r = SECTION_ORDER.indexOf(s.mode);
    if (r < rank && (!prev || r >= SECTION_ORDER.indexOf(prev.mode))) prev = s;
  }
  if (prev) {
    const last = prev.blocks.length ? prev.blocks[prev.blocks.length - 1] : { id: prev.headingId };
    return { type: 'after_block', after_block: { id: last.id } };
  }
  const idx = children.findIndex((b) => b.id === ours[0].headingId);
  if (idx <= 0) return { type: 'start' };
  return { type: 'after_block', after_block: { id: children[idx - 1].id } };
}

// Each keyframe group opens with the video embed seeked via ?t= — that query
// param doubles as the machine-readable sort key, so accumulated keyframes
// stay in clip-time order no matter when they were captured (same as
// vault-autopilot sorting motion sections by startSeconds).
function keyframeStart(block) {
  if (block.type !== 'embed') return null;
  try {
    const q = new URL(block.embed?.url || '').searchParams;
    // t= on bilibili player / legacy plain URLs, start= on youtube embeds.
    return parseInt(q.get('t') ?? q.get('start') ?? '0', 10) || 0;
  } catch (_) { return null; }
}

function keyframeAnchor(section, startSeconds) {
  let anchor = section.headingId;
  for (const b of section.blocks) {
    const s = keyframeStart(b);
    if (s !== null && s > startSeconds) break;
    anchor = b.id;
  }
  return anchor;
}

// ── Database / page management ───────────────────────────────────────────────
// Properties are resolved by TYPE, never by name, so databases in any language
// work (标题/网址/平台/采集时间 as happily as Title/URL/Platform/Captured).
// The only hard requirement is one url-typed property — findPageByUrl's upsert
// key. Select (platform) and date (captured) are used when present, skipped
// when not. Resolved names are cached in sc_notion_props next to the ds id.
export const DEFAULT_PROPS = { title: 'Title', url: 'URL', select: 'Platform', date: 'Captured', published: 'Published' };

export function resolveProps(properties) {
  const keys = Object.keys(properties || {});
  // `Published` is the one column we create ourselves, so it alone resolves by
  // exact name; everything else stays type-resolved so non-English databases
  // keep working (and Published never doubles as the captured-date column).
  const published = keys.find((k) => k === DEFAULT_PROPS.published && properties[k]?.type === 'date') || null;
  const byType = (type) => keys.find((k) => properties[k]?.type === type && k !== published) || null;
  const title = byType('title');
  const url = byType('url');
  if (!title || !url) return null;
  return { title, url, select: byType('select'), date: byType('date'), published };
}

// Fetch a data source's schema and resolve its properties; null = unusable.
async function probeSchema(cfg, dsId) {
  try {
    const ds = await notionRequest(`/data_sources/${dsId}`, { token: cfg.token });
    return resolveProps(ds.properties);
  } catch (_) { return null; }
}

// Databases adopted before the Published column existed (or cached props from
// an older version): add the column once, best-effort, and refresh the cache.
// A clip must never fail because this couldn't run.
async function ensurePublishedProp(cfg, dsId, props) {
  if (props.published) return props;
  try {
    let ds = await notionRequest(`/data_sources/${dsId}`, { token: cfg.token });
    const existing = ds?.properties?.[DEFAULT_PROPS.published];
    // A user-owned column already named Published but not date-typed: PATCHing
    // would silently convert their data. Leave it alone and skip the feature.
    if (existing && existing.type !== 'date') return props;
    if (!existing) {
      await notionRequest(`/data_sources/${dsId}`, { method: 'PATCH', token: cfg.token,
        body: { properties: { [DEFAULT_PROPS.published]: { date: {} } } } });
      ds = await notionRequest(`/data_sources/${dsId}`, { token: cfg.token });
    }
    const next = resolveProps(ds?.properties);
    if (next?.published) {
      const merged = { ...props, published: next.published };
      await chrome.storage.local.set({ sc_notion_props: merged });
      return merged;
    }
  } catch (_) {}
  return props;
}

// Is this id a database? Returns its first usable data source (+ resolved
// props), or { isDatabase: true, dsId: null } for a database we can't use.
async function probeDatabase(cfg, id) {
  let db;
  try {
    db = await notionRequest(`/databases/${id}`, { token: cfg.token });
  } catch (_) {
    return { isDatabase: false, dsId: null, props: null };
  }
  for (const src of db.data_sources || []) {
    const props = await probeSchema(cfg, src.id);
    if (props) return { isDatabase: true, dsId: src.id, props };
  }
  return { isDatabase: true, dsId: null, props: null };
}

// Page pasted instead: adopt the first usable child database on it
// (the duplicated-template case), or null so the caller creates one.
async function adoptChildDatabase(cfg, pageId) {
  try {
    for (const b of await listChildren(cfg, pageId)) {
      if (b.type !== 'child_database') continue;
      const { dsId, props } = await probeDatabase(cfg, b.id);
      if (dsId) return { dsId, props };
    }
  } catch (_) {}
  return null;
}

export async function ensureDataSource(cfg) {
  // No cached props (pre-Published-column installs): claim published only after
  // ensurePublishedProp has verified/added the column — the database behind a
  // bare cached id may predate it, and writing a nonexistent property 400s.
  if (cfg.dataSourceId) return { dsId: cfg.dataSourceId, props: cfg.props || { ...DEFAULT_PROPS, published: null } };
  const targetId = parsePageId(cfg.parentUrl);
  if (!targetId) throw new Error(t('err_notion_not_configured'));

  // The pasted link may be a database itself (a duplicated template).
  const probe = await probeDatabase(cfg, targetId);
  let adopted;
  if (probe.isDatabase) {
    if (!probe.dsId) throw new Error(t('err_notion_bad_schema'));
    adopted = { dsId: probe.dsId, props: probe.props };
  } else {
    adopted = await adoptChildDatabase(cfg, targetId);
  }

  if (!adopted) {
    // Plain page with no usable database on it: create our own.
    const db = await notionRequest('/databases', { method: 'POST', token: cfg.token, body: {
      parent: { type: 'page_id', page_id: targetId },
      title: [{ type: 'text', text: { content: 'Video Clips' } }],
      initial_data_source: { properties: {
        Title:    { title: {} },
        URL:      { url: {} },
        Platform: { select: {} },
        Captured: { date: {} },
        Published: { date: {} },
      } },
    } });
    let dsId = db.data_sources?.[0]?.id;
    if (!dsId) {
      // Older response shape safety net: retrieve the database for its sources.
      const full = await notionRequest(`/databases/${db.id}`, { token: cfg.token });
      dsId = full.data_sources?.[0]?.id;
    }
    adopted = { dsId, props: DEFAULT_PROPS };
  }

  await chrome.storage.local.set({ sc_notion_ds: adopted.dsId, sc_notion_props: adopted.props });
  return adopted;
}

// `url` may be a single URL or an array (canonical + raw) — pages saved before
// canonicalization store the raw form, and they must keep matching.
export async function findPageByUrl(cfg, dsId, url, props = DEFAULT_PROPS) {
  const urls = [...new Set([].concat(url).filter(Boolean))];
  const filters = urls.map((u) => ({ property: props.url, url: { equals: u } }));
  const r = await notionRequest(`/data_sources/${dsId}/query`, { method: 'POST', token: cfg.token, body: {
    filter: filters.length === 1 ? filters[0] : { or: filters },
    page_size: 1,
  } });
  const page = r.results?.[0];
  return page ? { id: page.id, url: page.url, hasCover: !!page.cover } : null;
}

export async function createVideoPage(cfg, dsId, payload, props = DEFAULT_PROPS) {
  const url = payload.url || payload.video_url;
  const body = {
    parent: { type: 'data_source_id', data_source_id: dsId },
    properties: {
      [props.title]: { title: [{ type: 'text', text: { content: payload.video_title || payload.title || url } }] },
      [props.url]:   { url },
      ...(props.select ? { [props.select]: { select: { name: payload.platform || 'other' } } } : {}),
      ...(props.date && payload.captured_at ? { [props.date]: { date: { start: payload.captured_at } } } : {}),
      ...(props.published && payload.published_at ? { [props.published]: { date: { start: payload.published_at } } } : {}),
    },
  };
  const cover = payload.cover_url || payload.thumbnail_url;
  if (cover) body.cover = { type: 'external', external: { url: cover } };
  const page = await notionRequest('/pages', { method: 'POST', token: cfg.token, body });
  return { id: page.id, url: page.url };
}

// ── Image upload (Direct Upload API; ≤20MB single-part, plenty for clips) ────
export async function uploadImage(cfg, imageData) {
  const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/png;base64,${imageData}`;
  const blob = await (await fetch(dataUrl)).blob();
  const fu = await notionRequest('/file_uploads', { method: 'POST', token: cfg.token, body: {
    mode: 'single_part', filename: 'clip.png', content_type: blob.type || 'image/png',
  } });
  const form = new FormData();
  form.append('file', blob, 'clip.png');
  await notionRequest(`/file_uploads/${fu.id}/send`, { method: 'POST', token: cfg.token, form });
  return fu.id;
}

async function listChildren(cfg, pageId) {
  const all = [];
  let cursor = null;
  do {
    const q = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100';
    const r = await notionRequest(`/blocks/${pageId}/children${q}`, { token: cfg.token });
    all.push(...(r.results || []));
    cursor = r.has_more ? r.next_cursor : null;
  } while (cursor);
  return all;
}

export async function upsertSection(cfg, pageId, mode, blocks, startSeconds = 0) {
  const children = await listChildren(cfg, pageId);
  const section = scanSections(children).find((s) => s.mode === mode);

  if (section && APPEND_MODES.includes(mode)) {
    // Accumulate: screenshots append at the end, keyframes keep clip-time order.
    const anchor = mode === 'keyframe'
      ? keyframeAnchor(section, startSeconds)
      : (section.blocks.length ? section.blocks[section.blocks.length - 1].id : section.headingId);
    await notionRequest(`/blocks/${pageId}/children`, { method: 'PATCH', token: cfg.token,
      body: { children: blocks, position: { type: 'after_block', after_block: { id: anchor } } } });
    return;
  }

  if (section) {
    // Replace: cover/hook hold one current version.
    for (const b of section.blocks) {
      await notionRequest(`/blocks/${b.id}`, { method: 'DELETE', token: cfg.token });
    }
    await notionRequest(`/blocks/${pageId}/children`, { method: 'PATCH', token: cfg.token,
      body: { children: blocks, position: { type: 'after_block', after_block: { id: section.headingId } } } });
    return;
  }

  const heading = { object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: sectionTitleFor(mode) } }] } };
  const position = insertPositionFor(children, mode);
  await notionRequest(`/blocks/${pageId}/children`, { method: 'PATCH', token: cfg.token,
    body: { children: [heading, ...blocks], ...(position ? { position } : {}) } });
}

// Existing pages: 收藏封面 explicitly refreshes the gallery cover + title; any
// other capture backfills a missing cover (vault-autopilot's ensureCover
// equivalent). Best-effort — a failed refresh never fails the clip.
async function refreshPageMeta(cfg, page, payload, props) {
  const cover = payload.thumbnail_url || payload.cover_url;
  const body = {};
  if (payload.mode === 'thumbnail') {
    if (cover) body.cover = { type: 'external', external: { url: cover } };
    const title = payload.video_title || payload.title;
    if (title) body.properties = { [props.title]: { title: [{ type: 'text', text: { content: title } }] } };
    if (payload.published_at && props.published) {
      body.properties = { ...(body.properties || {}), [props.published]: { date: { start: payload.published_at } } };
    }
  } else if (!page.hasCover && cover) {
    body.cover = { type: 'external', external: { url: cover } };
  }
  if (!Object.keys(body).length) return;
  try {
    await notionRequest(`/pages/${page.id}`, { method: 'PATCH', token: cfg.token, body });
  } catch (_) {}
}

// The adapter entry point: same response contract as obsidian's httpPost —
// resolves { success, error? } so mode files can keep their handling as-is.
// Saves run one at a time: two concurrent saves of the same video would both
// miss findPageByUrl and both create a page, breaking "one video = one page".
let sendChain = Promise.resolve();
export function send(payload) {
  const run = sendChain.then(() => doSend(payload));
  sendChain = run.then(() => {}, () => {});
  return run;
}

async function clipOnce(cfg, payload) {
  let { dsId, props } = await ensureDataSource(cfg);
  if (payload.published_at) props = await ensurePublishedProp(cfg, dsId, props);
  const rawUrl = payload.url || payload.video_url;
  const url = canonicalVideoUrl(rawUrl);
  let page = await findPageByUrl(cfg, dsId, [url, rawUrl], props);
  if (!page) page = await createVideoPage(cfg, dsId, { ...payload, url }, props);
  else await refreshPageMeta(cfg, page, payload, props);
  const uploadIds = [];
  for (const img of collectImages(payload)) {
    uploadIds.push(await uploadImage(cfg, img));   // serial on purpose: Notion ~3 req/s
  }
  await upsertSection(cfg, page.id, payload.mode, payloadToBlocks(payload, uploadIds),
    Math.floor(payload.time_range?.start || 0));
  // notionUrl is the Notion-mode counterpart of vault-autopilot's obsidianUrl:
  // modes surface it so the user can jump to the note they just saved to.
  return { success: true, ...(page.url ? { notionUrl: page.url } : {}) };
}

async function doSend(payload) {
  const cfg = await getNotionConfig();
  if (!cfg.token || (!cfg.dataSourceId && !cfg.parentUrl)) {
    return { success: false, error: t('err_notion_not_configured') };
  }
  try {
    return await clipOnce(cfg, payload);
  } catch (err) {
    // 404 with a cached data source id: the library that id points at is gone
    // (deleted, or the user switched templates). The pasted page link is still
    // the source of truth — drop the stale cache and re-derive from it once,
    // invisibly. Only when that also fails does the user see the error.
    if (err.code === 404 && cfg.dataSourceId && cfg.parentUrl) {
      await chrome.storage.local.remove(['sc_notion_ds', 'sc_notion_props']);
      try {
        return await clipOnce({ ...cfg, dataSourceId: null, props: null }, payload);
      } catch (err2) {
        return { success: false, error: err2.message };
      }
    }
    return { success: false, error: err.message };
  }
}
