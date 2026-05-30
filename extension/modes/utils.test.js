// Mock Chrome APIs for test environment
globalThis.chrome = {
  tabs: { sendMessage: () => {} },
  storage: { local: { set: () => {} } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  notifications: { create: () => {} },
};

import { sanitize, formatTime, buildTimestamps, detectPlatform } from './utils.js';

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
