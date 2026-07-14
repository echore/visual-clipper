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

import { getActiveDestination } from './index.js';

describe('getActiveDestination', () => {
  test('defaults to obsidian when unset', async () => {
    globalThis.__stored = {};
    expect((await getActiveDestination()).id).toBe('obsidian');
  });
  test('routes to notion when selected', async () => {
    globalThis.__stored = { sc_destination: 'notion' };
    expect((await getActiveDestination()).id).toBe('notion');
  });
  test('unknown value falls back to obsidian', async () => {
    globalThis.__stored = { sc_destination: 'craft' };
    expect((await getActiveDestination()).id).toBe('obsidian');
  });
});
