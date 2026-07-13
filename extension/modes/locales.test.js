import { readFileSync } from 'node:fs';

const load = (loc) =>
  JSON.parse(readFileSync(new URL(`../_locales/${loc}/messages.json`, import.meta.url)));

describe('locale catalogs', () => {
  test('en and zh_CN have identical key sets', () => {
    const en = load('en'); const zh = load('zh_CN');
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });
  test('placeholders match between locales', () => {
    const en = load('en'); const zh = load('zh_CN');
    for (const k of Object.keys(en)) {
      expect(Object.keys(zh[k].placeholders || {}).sort())
        .toEqual(Object.keys(en[k].placeholders || {}).sort());
    }
  });
  test('every message is non-empty', () => {
    for (const loc of ['en', 'zh_CN'])
      for (const [k, v] of Object.entries(load(loc)))
        expect({ key: `${loc}/${k}`, empty: v.message.trim().length === 0 })
          .toEqual({ key: `${loc}/${k}`, empty: false });
  });
});
