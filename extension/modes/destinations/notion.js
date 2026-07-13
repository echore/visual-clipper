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
