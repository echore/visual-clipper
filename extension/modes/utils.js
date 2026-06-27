// Endpoint — must match vault-autopilot's configured port
export const VAULT_AUTOPILOT_URL = 'http://localhost:27183/clip';

export function sanitize(str) {
  return (str || '').replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
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

export async function httpPost(payload) {
  const resp = await fetch(VAULT_AUTOPILOT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) throw new Error(`vault-autopilot returned ${resp.status}`);
  return resp.json();
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
