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

// Single fetch wrapper: auth headers, JSON, localized errors, one 429 retry.
export async function notionRequest(path, { method = 'GET', token, body, form } = {}, _retried = false) {
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
  if (resp.status === 404) throw new Error(t('err_notion_target'));
  if (resp.status === 429) {
    if (_retried) throw new Error(t('err_notion_rate'));
    await new Promise((r) => setTimeout(r, 1200));
    return notionRequest(path, { method, token, body, form }, true);
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
      if (range) blocks.push(range);
      blocks.push(...uploadIds.map(imgUpload));
      if (payload.transcript) blocks.push(...chunkText(payload.transcript).map(para));
      break;
    case 'keyframe':
      if (range) blocks.push(range);
      blocks.push(...uploadIds.map(imgUpload));
      break;
  }
  return blocks;
}

const headingText = (b) => (b[b.type]?.rich_text || []).map((r) => r.plain_text ?? r.text?.content ?? '').join('').trim();

// Scan the page's top-level blocks for our mode's heading (either locale);
// content = every block after it until the next heading_2.
export function findSection(children, mode) {
  const titles = SECTION_TITLES[mode];
  let headingId = null;
  const contentIds = [];
  for (const b of children) {
    if (b.type === 'heading_2') {
      if (headingId) break;
      if (titles.includes(headingText(b))) headingId = b.id;
      continue;
    }
    if (headingId) contentIds.push(b.id);
  }
  return headingId ? { headingId, contentIds } : null;
}

// ── Database / page management ───────────────────────────────────────────────
// Properties are resolved by TYPE, never by name, so databases in any language
// work (标题/网址/平台/采集时间 as happily as Title/URL/Platform/Captured).
// The only hard requirement is one url-typed property — findPageByUrl's upsert
// key. Select (platform) and date (captured) are used when present, skipped
// when not. Resolved names are cached in sc_notion_props next to the ds id.
export const DEFAULT_PROPS = { title: 'Title', url: 'URL', select: 'Platform', date: 'Captured' };

export function resolveProps(properties) {
  const byType = (type) => Object.keys(properties || {}).find((k) => properties[k]?.type === type) || null;
  const title = byType('title');
  const url = byType('url');
  if (!title || !url) return null;
  return { title, url, select: byType('select'), date: byType('date') };
}

// Fetch a data source's schema and resolve its properties; null = unusable.
async function probeSchema(cfg, dsId) {
  try {
    const ds = await notionRequest(`/data_sources/${dsId}`, { token: cfg.token });
    return resolveProps(ds.properties);
  } catch (_) { return null; }
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
  if (cfg.dataSourceId) return { dsId: cfg.dataSourceId, props: cfg.props || DEFAULT_PROPS };
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

export async function findPageByUrl(cfg, dsId, url, props = DEFAULT_PROPS) {
  const r = await notionRequest(`/data_sources/${dsId}/query`, { method: 'POST', token: cfg.token, body: {
    filter: { property: props.url, url: { equals: url } },
    page_size: 1,
  } });
  const page = r.results?.[0];
  return page ? { id: page.id, url: page.url } : null;
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

export async function upsertSection(cfg, pageId, mode, blocks) {
  const children = await listChildren(cfg, pageId);
  const section = findSection(children, mode);
  if (section) {
    for (const blockId of section.contentIds) {
      await notionRequest(`/blocks/${blockId}`, { method: 'DELETE', token: cfg.token });
    }
    await notionRequest(`/blocks/${pageId}/children`, { method: 'PATCH', token: cfg.token,
      body: { children: blocks, after: section.headingId } });
  } else {
    const heading = { object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: sectionTitleFor(mode) } }] } };
    await notionRequest(`/blocks/${pageId}/children`, { method: 'PATCH', token: cfg.token,
      body: { children: [heading, ...blocks] } });
  }
}

// The adapter entry point: same response contract as obsidian's httpPost —
// resolves { success, error? } so mode files can keep their handling as-is.
export async function send(payload) {
  const cfg = await getNotionConfig();
  if (!cfg.token || (!cfg.dataSourceId && !cfg.parentUrl)) {
    return { success: false, error: t('err_notion_not_configured') };
  }
  try {
    const { dsId, props } = await ensureDataSource(cfg);
    const url = payload.url || payload.video_url;
    let page = await findPageByUrl(cfg, dsId, url, props);
    if (!page) page = await createVideoPage(cfg, dsId, payload, props);
    const uploadIds = [];
    for (const img of collectImages(payload)) {
      uploadIds.push(await uploadImage(cfg, img));   // serial on purpose: Notion ~3 req/s
    }
    await upsertSection(cfg, page.id, payload.mode, payloadToBlocks(payload, uploadIds));
    // notionUrl is the Notion-mode counterpart of vault-autopilot's obsidianUrl:
    // modes open it so the user lands on the note they just saved to.
    return { success: true, ...(page.url ? { notionUrl: page.url } : {}) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
