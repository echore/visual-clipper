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
    remove: async (keys) => { for (const k of [].concat(keys)) delete globalThis.__stored[k]; },
  } },
  action: { setBadgeText: () => {}, setBadgeBackgroundColor: () => {} },
  notifications: { create: () => {} },
  i18n: { getMessage: makeGetMessage(new URL('../../_locales/en/messages.json', import.meta.url).pathname),
          getUILanguage: () => 'en' },
};

import { parsePageId, canonicalVideoUrl, notionRequest, ping, NOTION_VERSION, SECTION_TITLES, sectionTitleFor, chunkText, collectImages, payloadToBlocks, findSection, scanSections, resolveProps, videoEmbedUrl, ensureDataSource, findPageByUrl, createVideoPage, uploadImage, upsertSection, send } from './notion.js';

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
  test('429 honors Retry-After across several hits, then gives up with the rate error', async () => {
    const limited = { ok: false, status: 429, json: async () => ({}), headers: { get: (h) => h === 'Retry-After' ? '0.01' : null } };
    // Recovers on the last allowed attempt…
    let calls = mockFetch(({ n }) => n <= 3 ? limited : ok({ done: 1 }));
    expect(await notionRequest('/pages', { method: 'POST', token: 'T', body: {} })).toEqual({ done: 1 });
    expect(calls.length).toBe(4);
    // …and stops after the retry budget when the limit persists.
    calls = mockFetch(() => limited);
    await expect(notionRequest('/pages', { method: 'POST', token: 'T', body: {} })).rejects.toThrow(/rate|wait/i);
    expect(calls.length).toBe(4);
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
  const PAGE_URL = 'https://notion.so/p-0123456789abcdef0123456789abcdef';
  const TARGET = '0123456789abcdef0123456789abcdef';

  test('returns cached id and props without network', async () => {
    const calls = mockFetch(() => ok({}));
    const r = await ensureDataSource({ token: 'T', dataSourceId: 'DS1', props: { title: '标题', url: '网址', select: null, date: null } });
    expect(r).toEqual({ dsId: 'DS1', props: { title: '标题', url: '网址', select: null, date: null } });
    expect(calls.length).toBe(0);
  });

  test('cached id without cached props falls back to English defaults (pre-existing users)', async () => {
    const calls = mockFetch(() => ok({}));
    const r = await ensureDataSource({ token: 'T', dataSourceId: 'DS1', props: null });
    expect(r.props).toEqual({ title: 'Title', url: 'URL', select: 'Platform', date: 'Captured' });
    expect(calls.length).toBe(0);
  });

  test('plain page: creates database under it and caches the data source id', async () => {
    globalThis.__stored = {};
    const calls = mockFetch(({ url, init }) => {
      if (url.endsWith(`/databases/${TARGET}`) && init.method === 'GET') return err(404); // not a database
      if (url.includes('/blocks/') && init.method === 'GET') return ok({ results: [], has_more: false });
      if (url.endsWith('/databases') && init.method === 'POST')
        return ok({ id: 'DB1', data_sources: [{ id: 'DS9', name: 'Video Clips' }] });
      throw new Error('unhandled ' + url);
    });
    const r = await ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: PAGE_URL });
    expect(r.dsId).toBe('DS9');
    expect(r.props).toEqual({ title: 'Title', url: 'URL', select: 'Platform', date: 'Captured' });
    const create = calls.find((c) => c.init.method === 'POST');
    const body = JSON.parse(create.init.body);
    expect(create.url).toBe('https://api.notion.com/v1/databases');
    expect(body.parent).toEqual({ type: 'page_id', page_id: TARGET });
    expect(body.initial_data_source.properties.URL).toEqual({ url: {} });
    expect(globalThis.__stored.sc_notion_ds).toBe('DS9');
  });

  test('pasted link is a database (duplicated template): adopts its data source, creates nothing', async () => {
    globalThis.__stored = {};
    const calls = mockFetch(({ url, init }) => {
      if (url.endsWith(`/databases/${TARGET}`) && init.method === 'GET')
        return ok({ id: TARGET, data_sources: [{ id: 'DS_T' }] });
      if (url.endsWith('/data_sources/DS_T') && init.method === 'GET')
        return ok({ properties: { URL: { type: 'url' }, Title: { type: 'title' } } });
      throw new Error('unhandled ' + url);
    });
    const r = await ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: PAGE_URL });
    expect(r.dsId).toBe('DS_T');
    expect(calls.some((c) => c.init.method === 'POST')).toBe(false);
    expect(globalThis.__stored.sc_notion_ds).toBe('DS_T');
    expect(globalThis.__stored.sc_notion_props).toEqual({ title: 'Title', url: 'URL', select: null, date: null });
  });

  test('database link with wrong schema → localized bad-schema error, creates nothing', async () => {
    mockFetch(({ url, init }) => {
      if (url.endsWith(`/databases/${TARGET}`) && init.method === 'GET')
        return ok({ id: TARGET, data_sources: [{ id: 'DS_T' }] });
      if (url.endsWith('/data_sources/DS_T')) return ok({ properties: { URL: { type: 'rich_text' } } });
      throw new Error('unhandled ' + url);
    });
    await expect(ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: PAGE_URL }))
      .rejects.toThrow(/propert|属性/i);
  });

  test('page containing a duplicated Chinese template: adopts it and resolves Chinese property names', async () => {
    globalThis.__stored = {};
    mockFetch(({ url, init }) => {
      if (url.endsWith(`/databases/${TARGET}`) && init.method === 'GET') return err(404);
      if (url.includes('/blocks/') && init.method === 'GET')
        return ok({ results: [{ id: 'CDB', type: 'child_database', child_database: { title: '视频库' } }], has_more: false });
      if (url.endsWith('/databases/CDB') && init.method === 'GET') return ok({ id: 'CDB', data_sources: [{ id: 'DS_C' }] });
      if (url.endsWith('/data_sources/DS_C'))
        return ok({ properties: { '标题': { type: 'title' }, '平台': { type: 'select' }, '网址': { type: 'url' }, '采集时间': { type: 'date' } } });
      throw new Error('unhandled ' + url);
    });
    const r = await ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: PAGE_URL });
    expect(r.dsId).toBe('DS_C');
    expect(r.props).toEqual({ title: '标题', url: '网址', select: '平台', date: '采集时间' });
    expect(globalThis.__stored.sc_notion_ds).toBe('DS_C');
    expect(globalThis.__stored.sc_notion_props).toEqual({ title: '标题', url: '网址', select: '平台', date: '采集时间' });
  });

  test('page whose child database has wrong schema → falls through to creating our own', async () => {
    globalThis.__stored = {};
    mockFetch(({ url, init }) => {
      if (url.endsWith(`/databases/${TARGET}`) && init.method === 'GET') return err(404);
      if (url.includes('/blocks/') && init.method === 'GET')
        return ok({ results: [{ id: 'CDB', type: 'child_database', child_database: { title: 'Notes' } }], has_more: false });
      if (url.endsWith('/databases/CDB') && init.method === 'GET') return ok({ id: 'CDB', data_sources: [{ id: 'DS_C' }] });
      if (url.endsWith('/data_sources/DS_C')) return ok({ properties: { Name: { type: 'title' } } });
      if (url.endsWith('/databases') && init.method === 'POST') return ok({ id: 'DB1', data_sources: [{ id: 'DS_NEW' }] });
      throw new Error('unhandled ' + url);
    });
    expect((await ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: PAGE_URL })).dsId).toBe('DS_NEW');
  });

  test('no parent url → localized not-configured error', async () => {
    await expect(ensureDataSource({ token: 'T', dataSourceId: null, parentUrl: null })).rejects.toThrow();
  });
});

describe('findPageByUrl', () => {
  test('queries the data source by URL property', async () => {
    const calls = mockFetch(() => ok({ results: [{ id: 'PG1', url: 'https://www.notion.so/PG1' }] }));
    expect(await findPageByUrl({ token: 'T' }, 'DS9', 'https://v/1')).toEqual({ id: 'PG1', url: 'https://www.notion.so/PG1', hasCover: false });
    expect(calls[0].url).toBe('https://api.notion.com/v1/data_sources/DS9/query');
    const body = JSON.parse(calls[0].init.body);
    expect(body.filter).toEqual({ property: 'URL', url: { equals: 'https://v/1' } });
  });
  test('miss → null', async () => {
    mockFetch(() => ok({ results: [] }));
    expect(await findPageByUrl({ token: 'T' }, 'DS9', 'https://v/2')).toBeNull();
  });
  test('multiple url variants → or filter; duplicates collapse', async () => {
    const calls = mockFetch(() => ok({ results: [{ id: 'PG1', url: 'u', cover: { type: 'external' } }] }));
    const r = await findPageByUrl({ token: 'T' }, 'DS9', ['https://v/1', 'https://v/1?t=42', 'https://v/1']);
    expect(r.hasCover).toBe(true);
    expect(JSON.parse(calls[0].init.body).filter).toEqual({ or: [
      { property: 'URL', url: { equals: 'https://v/1' } },
      { property: 'URL', url: { equals: 'https://v/1?t=42' } },
    ] });
  });
});

describe('canonicalVideoUrl', () => {
  test('youtube variants collapse to watch?v=', () => {
    expect(canonicalVideoUrl('https://www.youtube.com/watch?v=abc&t=42s&list=PL1')).toBe('https://www.youtube.com/watch?v=abc');
    expect(canonicalVideoUrl('https://youtu.be/abc?si=xyz')).toBe('https://www.youtube.com/watch?v=abc');
    expect(canonicalVideoUrl('https://www.youtube.com/shorts/abc')).toBe('https://www.youtube.com/watch?v=abc');
  });
  test('bilibili keeps only the BV path', () => {
    expect(canonicalVideoUrl('https://www.bilibili.com/video/BV1xx?p=2&t=30')).toBe('https://www.bilibili.com/video/BV1xx');
  });
  test('xiaohongshu drops query; other urls only drop the hash', () => {
    expect(canonicalVideoUrl('https://www.xiaohongshu.com/explore/n1?xsec=q')).toBe('https://www.xiaohongshu.com/explore/n1');
    expect(canonicalVideoUrl('https://example.com/v?id=1#frag')).toBe('https://example.com/v?id=1');
  });
  test('garbage passes through', () => {
    expect(canonicalVideoUrl('not a url')).toBe('not a url');
    expect(canonicalVideoUrl(null)).toBeNull();
  });
});

describe('createVideoPage', () => {
  test('creates page with properties and external cover', async () => {
    const calls = mockFetch(() => ok({ id: 'PG2', url: 'https://www.notion.so/PG2' }));
    const pageId = await createVideoPage({ token: 'T' }, 'DS9', {
      mode: 'thumbnail', video_url: 'https://v/1', title: 'T1', platform: 'youtube',
      captured_at: '2026-07-13T00:00:00.000Z', thumbnail_url: 'https://img/c.jpg',
    });
    expect(pageId).toEqual({ id: 'PG2', url: 'https://www.notion.so/PG2' });
    const body = JSON.parse(calls[0].init.body);
    expect(body.parent).toEqual({ type: 'data_source_id', data_source_id: 'DS9' });
    expect(body.properties.URL).toEqual({ url: 'https://v/1' });
    expect(body.properties.Platform).toEqual({ select: { name: 'youtube' } });
    expect(body.cover).toEqual({ type: 'external', external: { url: 'https://img/c.jpg' } });
  });

  test('no captured_at → properties has no Captured key', async () => {
    const calls = mockFetch(() => ok({ id: 'PG3' }));
    await createVideoPage({ token: 'T' }, 'DS9', {
      mode: 'thumbnail', video_url: 'https://v/2', title: 'T2', platform: 'youtube',
    });
    const body = JSON.parse(calls[0].init.body);
    expect(body.properties).not.toHaveProperty('Captured');
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
  const e  = (blockId, t) => ({ id: blockId, type: 'embed', embed: { url: t ? `https://v/1?t=${t}` : 'https://v/1' } });
  const mockChildren = (children) => mockFetch(({ url, init }) => {
    if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET'))
      return ok({ results: children, has_more: false });
    if (init.method === 'DELETE' || init.method === 'PATCH') return ok({});
    throw new Error('unhandled ' + url);
  });

  test('replace mode (hook): deletes old content, inserts after heading', async () => {
    const calls = mockChildren([h2('H', 'Hook'), p('old1'), p('old2')]);
    await upsertSection({ token: 'T' }, 'PG', 'hook', [p('new')]);
    const deletes = calls.filter((c) => c.init.method === 'DELETE').map((c) => c.url);
    expect(deletes).toEqual(['https://api.notion.com/v1/blocks/old1', 'https://api.notion.com/v1/blocks/old2']);
    const patch = calls.find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(patch.init.body).position).toEqual({ type: 'after_block', after_block: { id: 'H' } });
  });

  test('missing section on an empty page: appends heading + content at page end', async () => {
    const calls = mockChildren([]);
    await upsertSection({ token: 'T' }, 'PG', 'keyframe', []);
    const body = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body);
    expect(body.position).toBeUndefined();
    expect(body.children[0].type).toBe('heading_2');
    expect(body.children[0].heading_2.rich_text[0].text.content).toBe('Keyframes'); // en stub locale
  });

  test('screenshots accumulate: appended after the last block, nothing deleted', async () => {
    const calls = mockChildren([h2('H', '截图'), p('c1'), p('c2')]);
    await upsertSection({ token: 'T' }, 'PG', 'screenshot', [p('new')]);
    expect(calls.filter((c) => c.init.method === 'DELETE')).toHaveLength(0);
    const patch = calls.find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(patch.init.body).position).toEqual({ type: 'after_block', after_block: { id: 'c2' } });
  });

  test('keyframes accumulate in clip-time order via the embed ?t= key', async () => {
    // Existing groups at t=10 and t=60; a t=30 capture lands between them.
    const calls = mockChildren([h2('H', 'Keyframes'), e('e10', 10), p('r10'), p('i10'), e('e60', 60), p('r60')]);
    await upsertSection({ token: 'T' }, 'PG', 'keyframe', [p('new')], 30);
    const patch = calls.find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(patch.init.body).position).toEqual({ type: 'after_block', after_block: { id: 'i10' } });
  });

  test('keyframe later than every existing group appends at the section end', async () => {
    const calls = mockChildren([h2('H', 'Keyframes'), e('e10', 10), p('r10')]);
    await upsertSection({ token: 'T' }, 'PG', 'keyframe', [p('new')], 90);
    const patch = calls.find((c) => c.init.method === 'PATCH');
    expect(JSON.parse(patch.init.body).position).toEqual({ type: 'after_block', after_block: { id: 'r10' } });
  });

  test('new section ranks below an existing one: inserted after its last block', async () => {
    // Page has Cover; a screenshot section belongs after it.
    const calls = mockChildren([h2('H', 'Cover'), p('c1')]);
    await upsertSection({ token: 'T' }, 'PG', 'screenshot', [p('new')]);
    const body = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body);
    expect(body.children[0].heading_2.rich_text[0].text.content).toBe('Screenshots');
    expect(body.position).toEqual({ type: 'after_block', after_block: { id: 'c1' } });
  });

  test('new section ranks above every existing one: inserted before them', async () => {
    // Keyframes exist; a hook section goes in front — after the page head
    // when there is one, at the very start when not.
    let calls = mockChildren([p('head'), h2('H', 'Keyframes'), p('k1')]);
    await upsertSection({ token: 'T' }, 'PG', 'hook', [p('new')]);
    let body = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body);
    expect(body.position).toEqual({ type: 'after_block', after_block: { id: 'head' } });

    calls = mockChildren([h2('H', 'Keyframes'), p('k1')]);
    await upsertSection({ token: 'T' }, 'PG', 'hook', [p('new')]);
    body = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body);
    expect(body.position).toEqual({ type: 'start' });
  });

  test('ordering anchors only on sections we own, not the user\'s own headings', async () => {
    const calls = mockChildren([h2('H1', 'Hook'), p('hk1'), h2('U1', 'My Notes'), p('n1'), h2('H2', 'Screenshots'), p('s1')]);
    await upsertSection({ token: 'T' }, 'PG', 'keyframe', [p('new')]);
    const body = JSON.parse(calls.find((c) => c.init.method === 'PATCH').init.body);
    expect(body.position).toEqual({ type: 'after_block', after_block: { id: 'hk1' } });
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
      if (url.endsWith('/query')) return ok({ results: [{ id: 'PG', url: 'https://www.notion.so/PG' }] });
      if (url.endsWith('/file_uploads')) return ok({ id: 'FU1' });
      if (url.endsWith('/FU1/send')) return ok({ status: 'uploaded' });
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    const r = await send({ mode: 'screenshot', url: 'https://v/1', title: 'T', platform: 'other',
      captured_at: '2026-07-13T00:00:00.000Z', image: 'aGk=' });
    expect(r).toEqual({ success: true, notionUrl: 'https://www.notion.so/PG' });
    expect(calls.some((c) => c.url.endsWith('/pages'))).toBe(false); // page existed, none created
  });

  test('looks up canonical + raw URL together; a created page stores the canonical form', async () => {
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DS' };
    const calls = mockFetch(({ url, init }) => {
      if (url.endsWith('/query')) return ok({ results: [] });
      if (url.endsWith('/pages') && init.method === 'POST') return ok({ id: 'PG', url: 'https://www.notion.so/PG' });
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    const raw = 'https://www.youtube.com/watch?v=abc&t=42s';
    const r = await send({ mode: 'thumbnail', video_url: raw, thumbnail_url: 'https://img/c.jpg', title: 'T', platform: 'youtube' });
    expect(r.success).toBe(true);
    const query = JSON.parse(calls.find((c) => c.url.endsWith('/query')).init.body);
    expect(query.filter).toEqual({ or: [
      { property: 'URL', url: { equals: 'https://www.youtube.com/watch?v=abc' } },
      { property: 'URL', url: { equals: raw } },
    ] });
    const create = JSON.parse(calls.find((c) => c.url.endsWith('/pages')).init.body);
    expect(create.properties.URL).toEqual({ url: 'https://www.youtube.com/watch?v=abc' });
  });

  test('existing page without a cover gets one backfilled from the capture', async () => {
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DS' };
    const calls = mockFetch(({ url, init }) => {
      if (url.startsWith('data:')) return { blob: async () => new Blob([new Uint8Array([1])], { type: 'image/png' }) };
      if (url.endsWith('/query')) return ok({ results: [{ id: 'PG', url: 'https://www.notion.so/PG', cover: null }] });
      if (url.endsWith('/file_uploads')) return ok({ id: 'FU1' });
      if (url.endsWith('/FU1/send')) return ok({ status: 'uploaded' });
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    await send({ mode: 'screenshot', url: 'https://v/1', title: 'T', image: 'aGk=', cover_url: 'https://img/c.jpg' });
    const patchPage = calls.find((c) => c.url.endsWith('/pages/PG') && c.init.method === 'PATCH');
    expect(JSON.parse(patchPage.init.body).cover).toEqual({ type: 'external', external: { url: 'https://img/c.jpg' } });
    expect(JSON.parse(patchPage.init.body).properties).toBeUndefined(); // cover only, title untouched
  });

  test('收藏封面 on an existing page refreshes its cover and title', async () => {
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DS' };
    const calls = mockFetch(({ url, init }) => {
      if (url.endsWith('/query')) return ok({ results: [{ id: 'PG', url: 'https://www.notion.so/PG', cover: { type: 'external' } }] });
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    await send({ mode: 'thumbnail', video_url: 'https://v/1', thumbnail_url: 'https://img/new.jpg', title: 'Tab Title', video_title: 'Real Title' });
    const patchPage = calls.find((c) => c.url.endsWith('/pages/PG') && c.init.method === 'PATCH');
    const body = JSON.parse(patchPage.init.body);
    expect(body.cover).toEqual({ type: 'external', external: { url: 'https://img/new.jpg' } });
    expect(body.properties.Title.title[0].text.content).toBe('Real Title');
  });

  test('stale data-source cache self-heals: 404 → re-derive from the pasted link → save lands', async () => {
    const PAGE_URL = 'https://notion.so/p-0123456789abcdef0123456789abcdef';
    const TARGET = '0123456789abcdef0123456789abcdef';
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DEAD', sc_notion_parent: PAGE_URL };
    const calls = mockFetch(({ url, init }) => {
      if (url.includes('/data_sources/DEAD/query')) return err(404); // cached ds is gone
      if (url.endsWith(`/databases/${TARGET}`) && init.method === 'GET') return err(404); // pasted link is a plain page
      if (url.includes(`/blocks/${TARGET}/children`)) return ok({ results: [], has_more: false }); // no child db → create one
      if (url.endsWith('/databases') && init.method === 'POST') return ok({ id: 'DB2', data_sources: [{ id: 'DS_NEW' }] });
      if (url.includes('/data_sources/DS_NEW/query')) return ok({ results: [] });
      if (url.endsWith('/pages') && init.method === 'POST') return ok({ id: 'PG', url: 'https://www.notion.so/PG' });
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') return ok({});
      throw new Error('unhandled ' + url);
    });
    const r = await send({ mode: 'screenshot', url: 'https://v/1', title: 'T' });
    expect(r.success).toBe(true);
    expect(globalThis.__stored.sc_notion_ds).toBe('DS_NEW'); // cache rebuilt
    expect(calls.some((c) => c.url.includes('/data_sources/DEAD/query'))).toBe(true);
  });

  test('pasted link gone too → actionable error, no infinite retry', async () => {
    const PAGE_URL = 'https://notion.so/p-0123456789abcdef0123456789abcdef';
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DEAD', sc_notion_parent: PAGE_URL };
    mockFetch(() => err(404)); // everything is gone
    const r = await send({ mode: 'screenshot', url: 'https://v/1', title: 'T' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/welcome|paste/i); // en stub locale copy
  });

  test('saves run one at a time: the second waits for the first to finish', async () => {
    globalThis.__stored = { sc_notion_token: 'T', sc_notion_ds: 'DS' };
    let release;
    const gate = new Promise((r) => { release = r; });
    const events = [];
    let queries = 0;
    mockFetch(async ({ url, init }) => {
      if (url.endsWith('/query')) {
        events.push(`query${++queries}`);
        if (queries === 1) await gate;
        return ok({ results: [{ id: 'PG', url: 'https://www.notion.so/PG' }] });
      }
      if (url.includes('/blocks/PG/children') && (!init.method || init.method === 'GET')) return ok({ results: [], has_more: false });
      if (init.method === 'PATCH') { events.push('write'); return ok({}); }
      throw new Error('unhandled ' + url);
    });
    const p1 = send({ mode: 'screenshot', url: 'https://v/1', title: 'T' });
    const p2 = send({ mode: 'screenshot', url: 'https://v/1', title: 'T' });
    release();
    await Promise.all([p1, p2]);
    // Without the mutex, query2 fires while save 1 is still gated (before its write).
    expect(events.indexOf('query2')).toBeGreaterThan(events.indexOf('write'));
  });
});

describe('resolveProps', () => {
  test('resolves by type regardless of names (Chinese template)', () => {
    expect(resolveProps({ '标题': { type: 'title' }, '网址': { type: 'url' }, '平台': { type: 'select' }, '采集时间': { type: 'date' } }))
      .toEqual({ title: '标题', url: '网址', select: '平台', date: '采集时间' });
  });
  test('select/date are optional', () => {
    expect(resolveProps({ Name: { type: 'title' }, Link: { type: 'url' } }))
      .toEqual({ title: 'Name', url: 'Link', select: null, date: null });
  });
  test('no url-typed property → null', () => {
    expect(resolveProps({ Name: { type: 'title' }, URL: { type: 'rich_text' } })).toBeNull();
    expect(resolveProps(undefined)).toBeNull();
  });
});

describe('createVideoPage with resolved Chinese props', () => {
  test('writes properties under resolved names and skips absent optional columns', async () => {
    const calls = mockFetch(() => ok({ id: 'PG9' }));
    await createVideoPage({ token: 'T' }, 'DS9',
      { mode: 'screenshot', url: 'https://v/9', title: 'T9', platform: 'youtube', captured_at: '2026-07-13T00:00:00.000Z' },
      { title: '标题', url: '网址', select: '平台', date: null });
    const body = JSON.parse(calls[0].init.body);
    expect(body.properties['标题'].title[0].text.content).toBe('T9');
    expect(body.properties['网址']).toEqual({ url: 'https://v/9' });
    expect(body.properties['平台']).toEqual({ select: { name: 'youtube' } });
    expect(Object.keys(body.properties)).toEqual(['标题', '网址', '平台']); // date column absent → not written
  });
});

describe('findPageByUrl with resolved props', () => {
  test('filters on the resolved url property name', async () => {
    const calls = mockFetch(() => ok({ results: [] }));
    await findPageByUrl({ token: 'T' }, 'DS9', 'https://v/9', { title: '标题', url: '网址', select: null, date: null });
    expect(JSON.parse(calls[0].init.body).filter.property).toBe('网址');
  });
});

describe('video embeds in hook/keyframe sections', () => {
  test('hook embeds the player at 0; keyframe player seeks to clip start', () => {
    const hook = payloadToBlocks({ mode: 'hook', url: 'https://www.youtube.com/watch?v=abc&t=49s', time_range: { start: 0, end: 15 } }, []);
    expect(hook[0]).toEqual({ object: 'block', type: 'embed', embed: { url: 'https://www.youtube.com/embed/abc?start=0' } });
    const kf = payloadToBlocks({ mode: 'keyframe', url: 'https://www.youtube.com/watch?v=abc', time_range: { start: 90, end: 95 } }, []);
    expect(kf[0].type).toBe('embed');
    expect(kf[0].embed.url).toBe('https://www.youtube.com/embed/abc?start=90');
  });
  test('bilibili uses the external player so the seek survives Notion unfurling and 续播', () => {
    // Raw tab URL junk (spm/vd_source) must not leak into the player URL.
    expect(videoEmbedUrl('https://www.bilibili.com/video/BV1x/?spm_id_from=333&vd_source=f06', 63.7))
      .toBe('https://player.bilibili.com/player.html?bvid=BV1x&page=1&t=63&autoplay=0&danmaku=0');
    // t=0 reads as "not set" and logged-in 续播 takes over — hooks pin t=1.
    expect(videoEmbedUrl('https://www.bilibili.com/video/BV1x', 0))
      .toBe('https://player.bilibili.com/player.html?bvid=BV1x&page=1&t=1&autoplay=0&danmaku=0');
  });
  test('videoEmbedUrl: unknown platforms keep the ?t= form; invalid urls pass through', () => {
    expect(videoEmbedUrl('https://x/y', 0)).toBe('https://x/y');
    expect(videoEmbedUrl('https://x/y', 30)).toBe('https://x/y?t=30');
    expect(videoEmbedUrl('not a url', 30)).toBe('not a url');
  });
});
