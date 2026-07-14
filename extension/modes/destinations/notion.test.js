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

import { parsePageId, notionRequest, ping, NOTION_VERSION, SECTION_TITLES, sectionTitleFor, chunkText, collectImages, payloadToBlocks, findSection, ensureDataSource, findPageByUrl, createVideoPage, uploadImage, upsertSection, send } from './notion.js';

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

describe('chunkText', () => {
  test('splits long text under Notion 2000-char rich_text limit', () => {
    const chunks = chunkText('a'.repeat(4000));
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 1900)).toBe(true);
    expect(chunks.join('')).toBe('a'.repeat(4000));
  });
});

describe('collectImages', () => {
  test('screenshot single/batch', () => {
    expect(collectImages({ mode: 'screenshot', image: 'B64' })).toEqual(['B64']);
    expect(collectImages({ mode: 'screenshot', images: ['a', 'b'] })).toEqual(['a', 'b']);
  });
  test('hook/keyframe use frames; thumbnail uploads nothing', () => {
    expect(collectImages({ mode: 'hook', frames: ['f1'] })).toEqual(['f1']);
    expect(collectImages({ mode: 'keyframe', frames: ['f1', 'f2'] })).toEqual(['f1', 'f2']);
    expect(collectImages({ mode: 'thumbnail', thumbnail_url: 'http://x/y.jpg' })).toEqual([]);
  });
});

describe('payloadToBlocks', () => {
  test('screenshot → one image block per upload id', () => {
    const blocks = payloadToBlocks({ mode: 'screenshot', image: 'B' }, ['fid1']);
    expect(blocks).toEqual([{ object: 'block', type: 'image', image: { type: 'file_upload', file_upload: { id: 'fid1' } } }]);
  });
  test('thumbnail → meta paragraph + external image', () => {
    const blocks = payloadToBlocks({ mode: 'thumbnail', thumbnail_url: 'http://x/y.jpg', channel: 'Chan', views: '1.2M' }, []);
    expect(blocks[0].type).toBe('paragraph');
    expect(blocks[0].paragraph.rich_text[0].text.content).toBe('Chan · 1.2M');
    expect(blocks[1].image.external.url).toBe('http://x/y.jpg');
  });
  test('hook → time range + images + chunked transcript', () => {
    const blocks = payloadToBlocks(
      { mode: 'hook', time_range: { start: 0, end: 15 }, transcript: 't'.repeat(2500) }, ['f1']);
    expect(blocks[0].paragraph.rich_text[0].text.content).toBe('00:00 – 00:15');
    expect(blocks[1].image.file_upload.id).toBe('f1');
    expect(blocks.length).toBe(4); // 1 para + 1 img + 2 transcript chunks
  });
  test('keyframe → time range + images', () => {
    const blocks = payloadToBlocks({ mode: 'keyframe', time_range: { start: 60, end: 65 } }, ['f1', 'f2']);
    expect(blocks.length).toBe(3);
  });
});

describe('findSection', () => {
  const h2 = (blockId, text) => ({ id: blockId, type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: text }, plain_text: text }] } });
  const p  = (blockId) => ({ id: blockId, type: 'paragraph', paragraph: { rich_text: [] } });

  test('finds section content between our heading and the next heading', () => {
    const children = [h2('a', 'Keyframes'), p('b'), p('c'), h2('d', 'Screenshots'), p('e')];
    expect(findSection(children, 'keyframe')).toEqual({ headingId: 'a', contentIds: ['b', 'c'] });
  });
  test('matches the zh_CN variant too', () => {
    const children = [h2('a', '截图'), p('b')];
    expect(findSection(children, 'screenshot')).toEqual({ headingId: 'a', contentIds: ['b'] });
  });
  test('returns null when the section is absent', () => {
    expect(findSection([h2('a', 'Hook'), p('b')], 'screenshot')).toBeNull();
  });
});

describe('ensureDataSource', () => {
  test('returns cached id without network', async () => {
    const calls = mockFetch(() => ok({}));
    expect(await ensureDataSource({ token: 'T', dataSourceId: 'DS1' })).toBe('DS1');
    expect(calls.length).toBe(0);
  });
  test('creates database under parent page and caches the data source id', async () => {
    globalThis.__stored = {};
    const calls = mockFetch(() => ok({ id: 'DB1', data_sources: [{ id: 'DS9', name: 'Video Clips' }] }));
    const ds = await ensureDataSource({ token: 'T', dataSourceId: null,
      parentUrl: 'https://notion.so/p-0123456789abcdef0123456789abcdef' });
    expect(ds).toBe('DS9');
    const body = JSON.parse(calls[0].init.body);
    expect(calls[0].url).toBe('https://api.notion.com/v1/databases');
    expect(body.parent).toEqual({ type: 'page_id', page_id: '0123456789abcdef0123456789abcdef' });
    expect(body.initial_data_source.properties.URL).toEqual({ url: {} });
    expect(globalThis.__stored.sc_notion_ds).toBe('DS9');
  });
  test('no parent url → localized not-configured error', async () => {
    await expect(ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: null })).rejects.toThrow();
  });
});

describe('findPageByUrl', () => {
  test('queries the data source by URL property', async () => {
    const calls = mockFetch(() => ok({ results: [{ id: 'PG1' }] }));
    expect(await findPageByUrl({ token: 'T' }, 'DS9', 'https://v/1')).toBe('PG1');
    expect(calls[0].url).toBe('https://api.notion.com/v1/data_sources/DS9/query');
    const body = JSON.parse(calls[0].init.body);
    expect(body.filter).toEqual({ property: 'URL', url: { equals: 'https://v/1' } });
  });
  test('miss → null', async () => {
    mockFetch(() => ok({ results: [] }));
    expect(await findPageByUrl({ token: 'T' }, 'DS9', 'https://v/2')).toBeNull();
  });
});

describe('createVideoPage', () => {
  test('creates page with properties and external cover', async () => {
    const calls = mockFetch(() => ok({ id: 'PG2' }));
    const pageId = await createVideoPage({ token: 'T' }, 'DS9', {
      mode: 'thumbnail', video_url: 'https://v/1', title: 'T1', platform: 'youtube',
      captured_at: '2026-07-13T00:00:00.000Z', thumbnail_url: 'https://img/c.jpg',
    });
    expect(pageId).toBe('PG2');
    const body = JSON.parse(calls[0].init.body);
    expect(body.parent).toEqual({ type: 'data_source_id', data_source_id: 'DS9' });
    expect(body.properties.URL).toEqual({ url: 'https://v/1' });
    expect(body.properties.Platform).toEqual({ select: { name: 'youtube' } });
    expect(body.cover).toEqual({ type: 'external', external: { url: 'https://img/c.jpg' } });
  });
});

describe('uploadImage', () => {
  test('create → send → returns file upload id', async () => {
    const calls = mockFetch(({ url }) => {
      if (url.startsWith('data:')) return { blob: async () => new Blob([new Uint8Array([1, 2])], { type: 'image/png' }) };
      if (url.endsWith('/file_uploads')) return ok({ id: 'FU1', upload_url: 'x' });
      if (url.endsWith('/file_uploads/FU1/send')) return ok({ id: 'FU1', status: 'uploaded' });
      throw new Error('unhandled ' + url);
    });
    expect(await uploadImage({ token: 'T' }, 'aGVsbG8=')).toBe('FU1');
    const sendCall = calls.find((c) => c.url.endsWith('/send'));
    expect(sendCall.init.body).toBeInstanceOf(FormData);
    expect(sendCall.init.headers['Content-Type']).toBeUndefined(); // FormData sets its own boundary
  });
});

describe('upsertSection', () => {
  const h2 = (blockId, text) => ({ id: blockId, type: 'heading_2', heading_2: { rich_text: [{ plain_text: text, type: 'text', text: { content: text } }] } });
  const p  = (blockId) => ({ id: blockId, type: 'paragraph', paragraph: { rich_text: [] } });

  test('existing section: deletes old content, appends after heading', async () => {
    const calls = mockFetch(({ url, init }) => {
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET'))
        return ok({ results: [h2('H', 'Screenshots'), p('old1'), p('old2')], has_more: false });
      if (init.method === 'DELETE') return ok({});
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    await upsertSection({ token: 'T' }, 'PG', 'screenshot', [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } }]);
    const deletes = calls.filter((c) => c.init.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['https://api.notion.com/v1/blocks/old1', 'https://api.notion.com/v1/blocks/old2']);
    const patch = calls.find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(patch.init.body).after).toBe('H');
  });

  test('missing section: appends heading + content at page end', async () => {
    const calls = mockFetch(({ init }) => {
      if (!init.method || init.method === 'GET') return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled');
    });
    await upsertSection({ token: 'T' }, 'PG', 'keyframe', []);
    const body = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body);
    expect(body.after).toBeUndefined();
    expect(body.children[0].type).toBe('heading_2');
    expect(body.children[0].heading_2.rich_text[0].text.content).toBe('Keyframes'); // en stub locale
  });
});

describe('send', () => {
  test('not configured → { success: false, error }, no throw', async () => {
    globalThis.__stored = {};
    const calls = mockFetch(() => { throw new Error('must not fetch'); });
    const r = await send({ mode: 'screenshot', url: 'https://v/1', image: 'x' });
    expect(r.success).toBe(false);
    expect(typeof r.error).toBe('string');
    expect(calls.length).toBe(0);
  });

  test('full happy path: ensure ds → find page → upload → upsert', async () => {
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DS' };
    const calls = mockFetch(({ url, init }) => {
      if (url.startsWith('data:')) return { blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) };
      if (url.endsWith('/query')) return ok({ results: [{ id: 'PG' }] });
      if (url.endsWith('/file_uploads')) return ok({ id: 'FU1' });
      if (url.endsWith('/FU1/send')) return ok({ status: 'uploaded' });
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    const r = await send({ mode: 'screenshot', url: 'https://v/1', title: 'T', platform: 'other',
      captured_at: '2026-07-13T00:00:00.000Z', image: 'aGk=' });
    expect(r).toEqual({ success: true });
    expect(calls.some((c) => c.url.endsWith('/pages'))).toBe(false); // page existed, none created
  });
});
