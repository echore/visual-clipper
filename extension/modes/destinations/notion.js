// destinations/notion.js — Notion destination (PAT auth, data-source API 2026-03-11).
// The user's PAT and target page live in chrome.storage.local; nothing here
// ever logs the token.
import { t } from '../i18n.js';
import { formatTime } from '../utils.js';

export const id = 'notion';
export const NOTION_API = 'https://api.notion.com/v1';
export const NOTION_VERSION = '2026-03-11';

export async function getNotionConfig() {
  const s = await chrome.storage.local.get(['sc_notion_token', 'sc_notion_parent', 'sc_notion_ds']);
  return {
    token: s.sc_notion_token || null,
    parentUrl: s.sc_notion_parent || null,
    dataSourceId: s.sc_notion_ds || null,
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
export async function ensureDataSource(cfg) {
  if (cfg.dataSourceId) return cfg.dataSourceId;
  const pageId = parsePageId(cfg.parentUrl);
  if (!pageId) throw new Error(t('err_notion_not_configured'));
  const db = await notionRequest('/databases', { method: 'POST', token: cfg.token, body: {
    parent: { type: 'page_id', page_id: pageId },
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
  await chrome.storage.local.set({ sc_notion_ds: dsId });
  return dsId;
}

export async function findPageByUrl(cfg, dsId, url) {
  const r = await notionRequest(`/data_sources/${dsId}/query`, { method: 'POST', token: cfg.token, body: {
    filter: { property: 'URL', url: { equals: url } },
    page_size: 1,
  } });
  return r.results?.[0]?.id || null;
}

export async function createVideoPage(cfg, dsId, payload) {
  const url = payload.url || payload.video_url;
  const body = {
    parent: { type: 'data_source_id', data_source_id: dsId },
    properties: {
      Title:    { title: [{ type: 'text', text: { content: payload.video_title || payload.title || url } }] },
      URL:      { url },
      Platform: { select: { name: payload.platform || 'other' } },
      Captured: { date: { start: payload.captured_at } },
    },
  };
  const cover = payload.cover_url || payload.thumbnail_url;
  if (cover) body.cover = { type: 'external', external: { url: cover } };
  const page = await notionRequest('/pages', { method: 'POST', token: cfg.token, body });
  return page.id;
}
