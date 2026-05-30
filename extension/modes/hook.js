import { buildTimestamps, sanitize, httpPost, notifyError, sendToContent, detectPlatform } from './utils.js';

export async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url;
  const platform = detectPlatform(url);

  // Capture 8 frames from 0s to 15s
  const timestamps = buildTimestamps(0, 15, 8);
  let captureResp;
  try {
    captureResp = await sendToContent(tabId, { action: 'captureVideoFrames', timestamps });
  } catch (err) {
    notifyError('无法与页面通信，请刷新后重试');
    return;
  }

  if (captureResp.error) {
    notifyError(captureResp.error);
    return;
  }

  // Get video metadata from page
  let meta = {};
  try {
    meta = await sendToContent(tabId, { action: 'getVideoMeta' }) || {};
  } catch (_) {}

  // Attempt transcript extraction (best-effort, never blocks)
  let transcript = null;
  try {
    transcript = await extractTranscript(url, platform);
  } catch (_) {}

  const payload = {
    mode: 'hook',
    url,
    title: sanitize(tab.title),
    platform,
    captured_at: new Date().toISOString(),
    frames: captureResp.frames,
    video_title: meta.videoTitle || null,
    channel: meta.channel || null,
    time_range: { start: 0, end: 15 },
    ...(transcript ? { transcript } : {}),
  };

  let response;
  try {
    response = await httpPost(payload);
  } catch (err) {
    notifyError('vault-autopilot 无响应，请确认 Obsidian 已开启且插件已启用');
    return;
  }

  if (response.success) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } else {
    notifyError(response.error || 'Hook 分析失败，请重试');
  }
}

// ── Transcript extraction (best-effort) ────────────────────────────────────────

async function extractTranscript(url, platform) {
  if (platform === 'youtube') {
    const videoId = new URL(url).searchParams.get('v');
    if (!videoId) return null;
    const resp = await fetch(
      `https://www.youtube.com/api/timedtext?lang=zh-Hans&v=${videoId}&fmt=json3`,
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const events = data.events || [];
    const text = events
      .filter(e => e.segs)
      .map(e => e.segs.map(s => s.utf8).join(''))
      .join(' ')
      .trim();
    return text || null;
  }

  if (platform === 'bilibili') {
    const playinfo = await fetch(url)
      .then(r => r.text())
      .then(html => {
        const m = html.match(/window\.__playinfo__\s*=\s*(\{.+?\})\s*<\/script>/s);
        return m ? JSON.parse(m[1]) : null;
      })
      .catch(() => null);

    const subtitleUrl = playinfo?.data?.subtitle?.subtitles?.[0]?.subtitle_url;
    if (!subtitleUrl) return null;

    const subs = await fetch(`https:${subtitleUrl}`).then(r => r.json()).catch(() => null);
    if (!subs?.body) return null;
    return subs.body.map(s => s.content).join(' ').trim() || null;
  }

  return null;
}
