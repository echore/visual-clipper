import { makeGetMessage } from '../../../scripts/chrome-i18n-stub.mjs';

// Mock Chrome APIs for test environment
globalThis.__stored = {};
globalThis.chrome = {
  tabs: { sendMessage: () => {} },
  storage: { local: {
    set: (obj) => Object.assign(globalThis.__stored, obj),
    get: async (keys) => {
      const src = globalThis.__stored;
      if (typeof keys === 'string') return { [keys]: src[keys] };
      const out = {};
      for (const k of keys) out[k] = src[k];
      return out;
    },
  } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  notifications: { create: () => {} },
  i18n: { getMessage: makeGetMessage(new URL('../../_locales/en/messages.json', import.meta.url).pathname),
          getUILanguage: () => 'en' },
};

import { parsePageId, notionRequest, ping, NOTION_VERSION } from './notion.js';

const ok  = (json) => ({ ok: true,  status: 200, json: async () => json });
const err = (status) => ({ ok: false, status, json: async () => ({ message: 'x' }) });

function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url, init }); return handler({ url, init, n: calls.length }); };
  return calls;
}

describe('parsePageId', () => {
  test('extracts 32-hex id from notion page URL', () => {
    expect(parsePageId('https://www.notion.so/My-Page-0123456789abcdef0123456789abcdef')).toBe('0123456789abcdef0123456789abcdef');
  });
  test('handles dashed UUID and query string', () => {
    expect(parsePageId('https://notion.so/x-01234567-89ab-cdef-0123-456789abcdef?v=1')).toBe('0123456789abcdef0123456789abcdef');
  });
  test('returns null for garbage', () => {
    expect(parsePageId('https://example.com/')).toBeNull();
    expect(parsePageId(null)).toBeNull();
  });
});

describe('notionRequest', () => {
  test('sets auth + version headers, returns json', async () => {
    const calls = mockFetch(() => ok({ hello: 1 }));
    const r = await notionRequest('/users/me', { token: 'T' });
    expect(r).toEqual({ hello: 1 });
    expect(calls[0].url).toBe('https://api.notion.com/v1/users/me');
    expect(calls[0].init.headers['Authorization']).toBe('Bearer T');
    expect(calls[0].init.headers['Notion-Version']).toBe(NOTION_VERSION);
  });
  test('401 → localized auth error', async () => {
    mockFetch(() => err(401));
    await expect(notionRequest('/users/me', { token: 'T' })).rejects.toThrow(/token/i);
  });
  test('404 → localized target error', async () => {
    mockFetch(() => err(404));
    await expect(notionRequest('/pages/x', { token: 'T' })).rejects.toThrow();
  });
  test('429 retries once then succeeds', async () => {
    const calls = mockFetch(({ n }) => n === 1 ? err(429) : ok({ done: 1 }));
    const r = await notionRequest('/pages', { method: 'POST', token: 'T', body: {} });
    expect(r).toEqual({ done: 1 });
    expect(calls.length).toBe(2);
  });
  test('network failure → localized network error', async () => {
    globalThis.fetch = async () => { throw new Error('boom'); };
    await expect(notionRequest('/users/me', { token: 'T' })).rejects.toThrow();
  });
});

describe('ping', () => {
  test('no token → not connected, no fetch', async () => {
    const calls = mockFetch(() => ok({}));
    await chrome.storage.local.set({ sc_notion_token: undefined });
    globalThis.__stored = {};
    expect(await ping()).toEqual({ connected: false });
    expect(calls.length).toBe(0);
  });
  test('valid token → connected', async () => {
    globalThis.__stored = { sc_notion_token: 'T' };
    mockFetch(() => ok({ object: 'user' }));
    expect(await ping()).toEqual({ connected: true });
  });
});
