// vault-autopilot's local HTTP endpoint. Port must match on both ends; it's
// only changeable as an escape hatch for port conflicts (welcome page → 高级).
export const DEFAULT_PORT = 17183;
export const clipUrl = (port) => `http://localhost:${port}/clip`;
export const pingUrl = (port) => `http://localhost:${port}/ping`;
export const CONNECT_FAIL_MSG =
  '没连上 Obsidian：请确认 Obsidian 开着、vault-autopilot 插件已启用。打开扩展弹窗底部「安装说明 / 帮助」可查看排查步骤。';

export async function getPort() {
  const stored = await chrome.storage.local.get('sc_port');
  const n = parseInt(stored.sc_port, 10);
  return Number.isInteger(n) && n > 1024 && n < 65536 ? n : DEFAULT_PORT;
}

export function sanitize(str) {
  return (str || '').replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// Unify transcript text across all platforms into one clean format:
// drop non-speech caption tags ([Music], [Applause], ...) and collapse the
// per-cue line wraps (YouTube json3 ASR embeds a "\n" seg at every wrap).
export function normalizeTranscript(text) {
  if (!text) return null;
  return text
    .replace(/\[[^\]]*\]/g, ' ')   // [Music] / [music] / [Applause] → gone
    .replace(/\s+/g, ' ')          // \n and extra whitespace → single space
    .trim() || null;
}

export function formatTime(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

// Returns `count` evenly spaced timestamps from `start` to `end` (inclusive).
export function buildTimestamps(start, end, count) {
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, i) => start + (i / (count - 1)) * (end - start));
}

export function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/bilibili\.com/.test(url)) return 'bilibili';
  if (/xiaohongshu\.com/.test(url)) return 'xiaohongshu';
  return 'other';
}

export function sendToContent(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

// (Re)inject content.js. First clears stale guard flags so the fresh script
// re-binds its message listener and the overlay can show again — SPA re-renders
// and extension reloads can leave those flags set with no live script behind them.
export async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: () => { try { delete window.__SC_BOUND__; window.__SC_OVERLAY_ACTIVE__ = false; } catch (_) {} },
  }).catch(() => {});
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

// Send to content.js. If it isn't there yet (first interaction / slow page /
// after a reload), inject it and poll until its listener is ready, then send —
// so the FIRST click works instead of needing a second.
// Important: if the error is "message port closed", the script DID run but the
// reply was lost; re-sending would double-run (e.g. capture twice), so we don't.
export async function ensureSendToContent(tabId, msg) {
  const tag = msg.action || 'msg';
  try {
    return await sendToContent(tabId, msg);
  } catch (e) {
    if (/message port closed/i.test(e.message || '')) {
      console.warn(`[SC] "${tag}" port closed — NOT re-sending (it may have run)`);
      throw e;
    }
    console.warn(`[SC] "${tag}" not reachable (${e.message}) — injecting + polling`);
    try { await injectContentScript(tabId); } catch (_) {}
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 120));
      try {
        const r = await sendToContent(tabId, msg);
        console.log(`[SC] "${tag}" ok after inject (try ${i + 1})`);
        return r;
      } catch (_) { /* not ready yet — keep polling */ }
    }
    throw new Error(`内容脚本未就绪：${tag}`);
  }
}

// Runs in the page (MAIN world) — returns the best cover image URL for this page.
function extractCoverUrl(platform) {
  const m = (sel) => document.querySelector(sel)?.getAttribute('content') || null;
  const og = (k) => m(`meta[property="${k}"]`) || m(`meta[name="${k}"]`);
  if (platform === 'youtube') {
    const id = new URLSearchParams(location.search).get('v');
    if (id) return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`;
  }
  if (platform === 'xiaohongshu') {
    const noteId = location.pathname.match(/\/(?:explore|discovery\/item)\/(\w+)/)?.[1];
    const note = window.__INITIAL_STATE__?.note?.noteDetailMap?.[noteId]?.note;
    const cover = note?.imageList?.[0]?.urlDefault || note?.imageList?.[0]?.url;
    if (cover) return cover.startsWith('http://') ? 'https://' + cover.slice(7) : cover;
  }
  let img = og('og:image') || og('twitter:image');
  if (img && img.startsWith('//')) img = 'https:' + img;
  if (img && img.includes('hdslb.com')) img = img.split('@')[0];
  return img || null;
}

// Best-effort: get the video/post cover URL so a note always has a gallery cover.
export async function getCoverUrl(tabId, platform) {
  try {
    const r = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: extractCoverUrl, args: [platform],
    });
    return r?.[0]?.result || null;
  } catch (_) { return null; }
}

export async function httpPost(payload) {
  const port = await getPort();
  let resp;
  try {
    resp = await fetch(clipUrl(port), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (_) {
    // Network-level failure: Obsidian closed / plugin disabled / port mismatch.
    throw new Error(CONNECT_FAIL_MSG);
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ? `保存失败：${body.error}` : `保存失败（HTTP ${resp.status}）`);
  }
  return resp.json();
}

export async function pingAutopilot() {
  try {
    const port = await getPort();
    const resp = await fetch(pingUrl(port), { signal: AbortSignal.timeout(1500) });
    if (!resp.ok) return { connected: false };
    const body = await resp.json();
    return body?.app === 'vault-autopilot'
      ? { connected: true, version: body.version }
      : { connected: false };
  } catch (_) {
    return { connected: false };
  }
}

export function notifyError(errMsg) {
  chrome.storage.local.set({ last_error: errMsg });
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' });
  chrome.notifications.create('ovc-error', {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Obsidian Visual Clipper 处理失败',
    message: errMsg,
  });
}

// Non-error notice surfaced inside the popup (same slot as errors, calmer color)
// plus a badge so the user notices to open it — used for graceful fallbacks the
// user should know about, e.g. saving a full page when region-select isn't possible.
export function notifyNotice(message) {
  chrome.storage.local.set({ last_notice: message });
  chrome.action.setBadgeText({ text: '✓' });
  chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
}
