import { t } from '../i18n.js';

// vault-autopilot's local HTTP endpoint. Port must match on both ends; it's
// only changeable as an escape hatch for port conflicts (welcome page → 高级).
export const DEFAULT_PORT = 17183;
export const clipUrl = (port) => `http://localhost:${port}/clip`;
export const pingUrl = (port) => `http://localhost:${port}/ping`;
export const CONNECT_FAIL_MSG = t('connect_fail');

export async function getPort() {
  const stored = await chrome.storage.local.get('sc_port');
  const n = parseInt(stored.sc_port, 10);
  return Number.isInteger(n) && n > 1024 && n < 65536 ? n : DEFAULT_PORT;
}

export async function httpPost(payload) {
  const port = await getPort();
  let resp;
  try {
    resp = await fetch(clipUrl(port), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
  } catch (_) {
    // Network-level failure or timeout: Obsidian closed / plugin disabled / stalled.
    throw new Error(CONNECT_FAIL_MSG);
  }
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error ? t('err_save_failed', [String(body.error)]) : t('err_save_failed_http', [String(resp.status)]));
  }
  return resp.json();
}

export async function pingAutopilot() {
  try {
    const port = await getPort();
    const resp = await fetch(pingUrl(port), { signal: AbortSignal.timeout(1500) });
    if (!resp.ok) return { connected: false };
    const body = await resp.json();
    if (body?.app === 'vault-autopilot') {
      // Once we have ever reached the plugin, "not detected" can no longer
      // mean "not installed"; the welcome page routes to troubleshooting.
      chrome.storage.local.set({ sc_ever_connected: true });
      return { connected: true, version: body.version };
    }
    return { connected: false };
  } catch (_) {
    return { connected: false };
  }
}

// ── Destination adapter interface（destinations/index.js 依赖这三个导出）──────
export const id = 'obsidian';
export const send = httpPost;
export const ping = pingAutopilot;
