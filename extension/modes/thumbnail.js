import { sanitize, httpPost, notifyError, detectPlatform, sendToContent } from './utils.js';

export async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const platform = detectPlatform(tab.url);

  // Get video metadata from page MAIN world (ytInitialPlayerResponse)
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (platform) => {
      if (platform === 'youtube') {
        // video_id from the URL — always correct for the page you're on.
        const videoId = new URLSearchParams(location.search).get('v');
        if (!videoId) return null;

        // ytInitialPlayerResponse is a SPA-cached blob that can be stale/empty
        // after in-site navigation — only trust it when it's for THIS video.
        const pr = window.ytInitialPlayerResponse;
        const vd = pr?.videoDetails?.videoId === videoId ? pr.videoDetails : null;

        const title = vd?.title
          || document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1')?.textContent?.trim()
          || document.title.replace(/\s*-\s*YouTube\s*$/, '').trim();

        const channelEl = document.querySelector('ytd-channel-name yt-formatted-string a, #channel-name a');
        const channel = vd?.author || channelEl?.textContent?.trim() || null;
        const handle = (channelEl?.href || '').match(/\/@([^/?]+)/)?.[0] || null;

        // view count: format as "27.8万" / "1.2百万"
        const views = parseInt(vd?.viewCount || '0', 10);
        let viewsStr = null;
        if (views >= 1_000_000) viewsStr = `${(views / 1_000_000).toFixed(1)}百万`;
        else if (views >= 10_000)  viewsStr = `${(views / 10_000).toFixed(1)}万`;
        else if (views > 0)        viewsStr = String(views);

        return {
          video_id: videoId,
          title,
          channel,
          channel_handle: handle,
          thumbnail_url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          views: viewsStr,
        };
      }

      if (platform === 'bilibili') {
        const bvMatch = location.href.match(/\/video\/(BV[\w]+)/);
        const bvid = bvMatch?.[1] || null;
        const title = document.querySelector('h1.video-title')?.textContent?.trim()
          || document.title;
        const channel = document.querySelector('.up-name, .username')?.textContent?.trim() || null;
        const thumb = document.querySelector('meta[property="og:image"]')?.content || null;
        return bvid ? { video_id: bvid, title, channel, channel_handle: null,
          thumbnail_url: thumb, views: null } : null;
      }

      return null;
    },
    args: [platform],
  }).catch(() => null);

  const meta = results?.[0]?.result;
  if (!meta?.video_id) {
    notifyError('无法获取视频信息，请刷新页面后重试');
    return;
  }

  let response;
  try {
    response = await httpPost({
      mode: 'thumbnail',
      platform,
      video_id: meta.video_id,
      video_url: tab.url,
      thumbnail_url: meta.thumbnail_url,
      title: sanitize(meta.title),
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
