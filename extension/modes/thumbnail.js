import { sanitize, httpPost, notifyError, detectPlatform, sendToContent } from './utils.js';

export async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const platform = detectPlatform(tab.url);

  // Get video metadata from page MAIN world (ytInitialPlayerResponse)
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (platform) => {
      const metaContent = (sel) => document.querySelector(sel)?.getAttribute('content') || null;
      const og = (key) => metaContent(`meta[property="${key}"]`) || metaContent(`meta[name="${key}"]`);

      // ── Generic Open Graph / Twitter-card layer (works on most sites) ──
      let title = (og('og:title') || og('twitter:title') || document.title || '')
        .replace(/\s*[-|–]\s*(YouTube|bilibili|哔哩哔哩|Twitter|X|Vimeo)\s*$/i, '').trim();
      let thumbnail_url = og('og:image') || og('twitter:image');
      if (thumbnail_url && thumbnail_url.startsWith('//')) thumbnail_url = 'https:' + thumbnail_url;
      const video_url = og('og:url')
        || document.querySelector('link[rel="canonical"]')?.href
        || location.href;
      const source_name = og('og:site_name') || location.hostname;

      // ── Platform enrichment layer ──
      let video_id = null, channel = null, channel_handle = null, views = null;

      if (platform === 'youtube') {
        video_id = new URLSearchParams(location.search).get('v');
        // Prefer og:image (YouTube already points it at the best available res);
        // maxresdefault.jpg 404s to a gray placeholder when that size doesn't exist.
        if (video_id && !thumbnail_url) thumbnail_url = `https://img.youtube.com/vi/${video_id}/maxresdefault.jpg`;
        const pr = window.ytInitialPlayerResponse;
        const vd = pr?.videoDetails?.videoId === video_id ? pr.videoDetails : null;
        const channelEl = document.querySelector('ytd-channel-name yt-formatted-string a, #channel-name a');
        channel = vd?.author || channelEl?.textContent?.trim() || null;
        channel_handle = (channelEl?.href || '').match(/\/@([^/?]+)/)?.[0] || null;
        const v = parseInt(vd?.viewCount || '0', 10);
        if (v >= 1_000_000) views = `${(v / 1_000_000).toFixed(1)}百万`;
        else if (v >= 10_000) views = `${(v / 10_000).toFixed(1)}万`;
        else if (v > 0) views = String(v);
      } else if (platform === 'bilibili') {
        video_id = location.href.match(/\/video\/(BV[\w]+)/)?.[1] || null;
        channel = document.querySelector('.up-name, .username')?.textContent?.trim() || null;
      }

      // Fallback id (used only for the cover filename) from host + path.
      if (!video_id) {
        video_id = (location.hostname + location.pathname)
          .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'cover';
      }

      if (!title) title = source_name; // never POST a blank title (hostname is always present)
      if (!thumbnail_url) return null; // nothing to save on this page

      return { video_id, title, channel, channel_handle, thumbnail_url, source_name, views, video_url };
    },
    args: [platform],
  }).catch(() => null);

  const meta = results?.[0]?.result;
  if (!meta?.thumbnail_url) {
    notifyError('此页面没有可收藏的封面');
    return;
  }

  let response;
  try {
    response = await httpPost({
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
      captured_at: new Date().toISOString(),
    });
  } catch (err) {
    notifyError(err.message?.includes('400') || err.message?.includes('404')
      ? '封面收藏需要更新 vault-autopilot 插件'
      : 'vault-autopilot 无响应，请确认 Obsidian 已开启且插件已启用');
    return;
  }

  if (response.success) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    if (response.obsidianUrl) {
      sendToContent(tabId, { action: 'openObsidian', url: response.obsidianUrl }).catch(() => {});
    }
  } else {
    notifyError(response.error || '封面收藏失败，请重试');
  }
}
