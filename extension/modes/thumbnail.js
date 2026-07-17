import { sanitize, notifyError, notifyNotice, notifySavedNotionInPage, detectPlatform, sendToContent } from './utils.js';
import { getActiveDestination } from './destinations/index.js';
import { t } from './i18n.js';

export async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const platform = detectPlatform(tab.url);

  // Get video metadata from page MAIN world (ytInitialPlayerResponse)
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (platform) => {
      const metaContent = (sel) => document.querySelector(sel)?.getAttribute('content') || null;
      const og = (key) => metaContent(`meta[property="${key}"]`) || metaContent(`meta[name="${key}"]`);

      // ── Generic Open Graph / Twitter-card layer (works on most sites) ──
      let title = (og('og:title') || og('twitter:title') || document.title.replace(/^\(\d+\)\s*/, '') || '')
        .replace(/(?:\s*[-|–_]\s*(?:YouTube|bilibili|哔哩哔哩|小红书|Twitter|X|Vimeo))+\s*$/i, '').trim();
      let thumbnail_url = og('og:image') || og('twitter:image');
      if (thumbnail_url && thumbnail_url.startsWith('//')) thumbnail_url = 'https:' + thumbnail_url;
      // Bilibili's og:image is a tiny resized variant (…hash.jpg@100w_100h_1c.png);
      // strip the @-suffix on hdslb CDN URLs to get the full-resolution cover.
      if (thumbnail_url && thumbnail_url.includes('hdslb.com')) thumbnail_url = thumbnail_url.split('@')[0];
      // NOTE: og:url and canonical are SPA-stale on YouTube too (previous video
      // after in-site nav). The youtube branch below overrides this from the URL.
      let video_url = og('og:url')
        || document.querySelector('link[rel="canonical"]')?.href
        || location.href;
      const source_name = og('og:site_name') || location.hostname;

      // ── Platform enrichment layer ──
      let video_id = null, channel = null, channel_handle = null, views = null, published_at = null;
      // "2009-10-24T23:57:33-07:00" keeps its literal date; bare numbers are
      // unix seconds (Bilibili) or milliseconds (Xiaohongshu).
      const toDay = (v) => {
        if (v == null) return null;
        const s = String(v).match(/^\d{4}-\d{2}-\d{2}/);
        if (s) return s[0];
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return null;
        const d = new Date(n < 1e12 ? n * 1000 : n);
        return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
      };

      if (platform === 'youtube') {
        // video_id + cover + title come straight from the URL / matching player
        // data — og:image and og:title are SPA-stale on YouTube (they keep the
        // PREVIOUS video after in-site navigation), which saved the wrong cover.
        video_id = new URLSearchParams(location.search).get('v');
        if (video_id) {
          thumbnail_url = `https://img.youtube.com/vi/${video_id}/maxresdefault.jpg`;
          video_url = `https://www.youtube.com/watch?v=${video_id}`; // fresh, not SPA-stale
        }
        const pr = window.ytInitialPlayerResponse;
        let vd = pr?.videoDetails?.videoId === video_id ? pr.videoDetails : null;
        if (vd) published_at = toDay(pr?.microformat?.playerMicroformatRenderer?.publishDate);
        if (!vd && video_id) {
          // In-site (SPA) navigation leaves ytInitialPlayerResponse and the previous
          // page's hidden DOM behind; ask the same-origin oEmbed endpoint instead.
          const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(video_url)}&format=json`)
            .then((r) => (r.ok ? r.json() : null)).catch(() => null);
          if (oe) vd = { title: oe.title, author: oe.author_name, authorUrl: oe.author_url };
        }
        if (!published_at && video_id) {
          // WEB is the only Innertube client that returns microformat (verified
          // 2026-07-17; iOS omits it). playabilityStatus is irrelevant for metadata.
          const ply = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00' } }, videoId: video_id }),
          }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
          published_at = toDay(ply?.microformat?.playerMicroformatRenderer?.publishDate);
        }
        if (vd?.title) title = vd.title;
        else { const dt = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube\s*$/i, '').trim(); if (dt) title = dt; }
        // Scoped to ytd-watch-flexy: an unscoped lookup can hit a hidden previous page's card.
        const channelEl = document.querySelector('ytd-watch-flexy ytd-channel-name yt-formatted-string a, ytd-watch-flexy #channel-name a');
        channel = vd?.author || channelEl?.textContent?.trim() || null;
        channel_handle = (vd?.authorUrl || channelEl?.href || '').match(/\/@([^/?]+)/)?.[0] || null;
        const v = parseInt(vd?.viewCount || '0', 10);
        if (v > 0) {
          views = new Intl.NumberFormat(chrome.i18n?.getUILanguage?.() || 'en', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
        }
      } else if (platform === 'bilibili') {
        video_id = location.href.match(/\/video\/(BV[\w]+)/)?.[1] || null;
        channel = document.querySelector('.up-name, .username')?.textContent?.trim() || null;
        published_at = toDay(window.__INITIAL_STATE__?.videoData?.pubdate);
      } else if (platform === 'xiaohongshu') {
        // og:image is a placeholder; the real cover/title/author live in __INITIAL_STATE__.
        const noteId = location.pathname.match(/\/(?:explore|discovery\/item)\/(\w+)/)?.[1];
        const note = window.__INITIAL_STATE__?.note?.noteDetailMap?.[noteId]?.note;
        if (note) {
          title = note.title || title;
          channel = note.user?.nickname || null;
          const cover = note.imageList?.[0]?.urlDefault || note.imageList?.[0]?.url;
          if (cover) thumbnail_url = cover.startsWith('http://') ? 'https://' + cover.slice(7) : cover;
          published_at = toDay(note.time);
        }
        video_id = noteId || video_id;
      }

      // Fallback id (used only for the cover filename) from host + path.
      if (!video_id) {
        video_id = (location.hostname + location.pathname)
          .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cover';
      }

      if (!title) title = source_name; // never POST a blank title (hostname is always present)
      if (!thumbnail_url) return null; // nothing to save on this page

      return { video_id, title, channel, channel_handle, thumbnail_url, source_name, views, video_url, published_at };
    },
    args: [platform],
  }).catch(() => null);

  const meta = results?.[0]?.result;
  if (!meta?.thumbnail_url) {
    notifyError(t('err_cover_none'));
    return;
  }

  let response;
  try {
    const dest = await getActiveDestination();
    response = await dest.send({
      mode: 'thumbnail',
      platform,
      video_id: meta.video_id,
      video_url: meta.video_url || tab.url,
      thumbnail_url: meta.thumbnail_url,
      title: sanitize(meta.title),
      source_name: meta.source_name || null,
      channel: meta.channel || null,
      channel_handle: meta.channel_handle || null,
      views: meta.views || null,
      ...(meta.published_at ? { published_at: meta.published_at } : {}),
      captured_at: new Date().toISOString(),
    });
  } catch (err) {
    notifyError(err.message?.includes('400') || err.message?.includes('404')
      ? t('err_cover_update')
      : (err.message || t('err_no_response')));
    return;
  }

  if (response.success) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    if (response.obsidianUrl) {
      sendToContent(tabId, { action: 'openObsidian', url: response.obsidianUrl }).catch(() => {});
    } else if (response.notionUrl) {
      notifySavedNotionInPage(tabId, response.notionUrl);
    }
    if (response.notice) notifyNotice(response.notice);
  } else {
    notifyError(response.error || t('err_cover_failed'));
  }
}
