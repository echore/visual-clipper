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
};

import { sanitize, formatTime, buildTimestamps, detectPlatform, normalizeTranscript,
  DEFAULT_PORT, clipUrl, pingUrl, getPort, httpPost, CONNECT_FAIL_MSG } from './utils.js';

describe('sanitize', () => {
  test('removes forbidden filename characters', () => {
    expect(sanitize('hello/world:test')).toBe('hello world test');
  });
  test('collapses multiple spaces', () => {
    expect(sanitize('hello   world')).toBe('hello world');
  });
  test('trims and truncates to 100 chars', () => {
    expect(sanitize('  hi  ')).toBe('hi');
    expect(sanitize('a'.repeat(200)).length).toBe(100);
  });
  test('handles null/undefined', () => {
    expect(sanitize(null)).toBe('');
    expect(sanitize(undefined)).toBe('');
  });
});

describe('formatTime', () => {
  test('formats seconds to MM:SS', () => {
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(65)).toBe('01:05');
    expect(formatTime(3600)).toBe('60:00');
  });
  test('rounds to nearest second', () => {
    expect(formatTime(1.7)).toBe('00:02');
  });
});

describe('buildTimestamps', () => {
  test('returns count evenly spaced timestamps between start and end', () => {
    const ts = buildTimestamps(0, 15, 4);
    expect(ts).toHaveLength(4);
    expect(ts[0]).toBeCloseTo(0);
    expect(ts[3]).toBeCloseTo(15);
  });
  test('returns single timestamp when count is 1', () => {
    const ts = buildTimestamps(5, 5, 1);
    expect(ts).toEqual([5]);
  });
  test('8 timestamps across 0-15 gives correct spacing', () => {
    const ts = buildTimestamps(0, 15, 8);
    expect(ts).toHaveLength(8);
    expect(ts[1] - ts[0]).toBeCloseTo(15 / 7);
  });
});

describe('detectPlatform', () => {
  test('detects youtube', () => {
    expect(detectPlatform('https://www.youtube.com/watch?v=abc')).toBe('youtube');
    expect(detectPlatform('https://youtu.be/abc')).toBe('youtube');
  });
  test('detects bilibili', () => {
    expect(detectPlatform('https://www.bilibili.com/video/BV1xx')).toBe('bilibili');
  });
  test('returns other for unknown', () => {
    expect(detectPlatform('https://example.com/video')).toBe('other');
  });
});

describe('normalizeTranscript', () => {
  test('collapses YouTube json3 per-cue newlines into single spaces', () => {
    expect(normalizeTranscript('back to the \n channel. So, \n if you'))
      .toBe('back to the channel. So, if you');
  });
  test('strips non-speech caption tags', () => {
    expect(normalizeTranscript('again [Music] today')).toBe('again today');
    expect(normalizeTranscript('again [music] today')).toBe('again today');
    expect(normalizeTranscript('[Applause] welcome')).toBe('welcome');
  });
  test('leaves already-clean text (e.g. Bilibili) unchanged', () => {
    expect(normalizeTranscript('这是一句干净的字幕。')).toBe('这是一句干净的字幕。');
  });
  test('returns null for empty or null input', () => {
    expect(normalizeTranscript(null)).toBe(null);
    expect(normalizeTranscript('')).toBe(null);
    expect(normalizeTranscript('  [Music]  ')).toBe(null);
  });
});

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
    await expect(httpPost({ mode: 'screenshot' })).rejects.toThrow('保存失败：Error: disk full');
  });
});
