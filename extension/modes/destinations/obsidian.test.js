import { makeGetMessage } from '../../../scripts/chrome-i18n-stub.mjs';

// Mock Chrome APIs for test environment
globalThis.__stored = {};
globalThis.chrome = {
  tabs: { sendMessage: () => {} },
  storage: { local: {
    set: (obj) => Object.assign(globalThis.__stored, obj),
    get: async () => ({ ...globalThis.__stored }),
  } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  notifications: { create: () => {} },
  i18n: { getMessage: makeGetMessage(new URL('../../_locales/en/messages.json', import.meta.url).pathname),
          getUILanguage: () => 'en' },
};

import { DEFAULT_PORT, clipUrl, pingUrl, getPort, httpPost, CONNECT_FAIL_MSG } from './obsidian.js';

describe('port handling', () => {
  beforeEach(() => { globalThis.__stored = {}; });
  test('default port is 17183', () => {
    expect(DEFAULT_PORT).toBe(17183);
  });
  test('clipUrl and pingUrl build from port', () => {
    expect(clipUrl(17183)).toBe('http://localhost:17183/clip');
    expect(pingUrl(9999)).toBe('http://localhost:9999/ping');
  });
  test('getPort falls back to default when unset or invalid', async () => {
    expect(await getPort()).toBe(17183);
    globalThis.__stored.sc_port = 80;          // below 1024 → invalid
    expect(await getPort()).toBe(17183);
    globalThis.__stored.sc_port = 'abc';
    expect(await getPort()).toBe(17183);
  });
  test('getPort returns stored valid port', async () => {
    globalThis.__stored.sc_port = 27999;
    expect(await getPort()).toBe(27999);
  });
});

describe('httpPost error mapping', () => {
  beforeEach(() => { globalThis.__stored = {}; });
  test('network failure maps to human-readable connect message', async () => {
    globalThis.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(httpPost({ mode: 'screenshot' })).rejects.toThrow(CONNECT_FAIL_MSG);
  });
  test('HTTP 500 surfaces server-provided reason', async () => {
    globalThis.fetch = async () => ({
      ok: false, status: 500,
      json: async () => ({ success: false, error: 'Error: disk full' }),
    });
    await expect(httpPost({ mode: 'screenshot' })).rejects.toThrow('Save failed: Error: disk full');
  });
});
