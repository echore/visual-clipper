import { buildTimestamps, sanitize, httpPost, notifyError, notifyNotice, ensureSendToContent, detectPlatform, getCoverUrl } from './utils.js';

export async function start(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const url = cleanVideoUrl(tab.url);
  const platform = detectPlatform(url);

  // Use current playback position as the Hook end point
  let endTime = 15;
  try {
    const timeResp = await ensureSendToContent(tabId, { action: 'getCurrentTime' });
    if (timeResp?.currentTime != null && timeResp.currentTime > 0) {
      endTime = Math.floor(timeResp.currentTime);
    }
  } catch (_) {}

  // ~1 frame per 3s, min 5, max 8 — oversample candidates, let content.js pick the best.
  const count = Math.max(5, Math.min(8, Math.ceil(endTime / 3)));
  const timestamps = buildTimestamps(0, endTime, Math.min(20, count * 3));
  let captureResp;
  try {
    captureResp = await ensureSendToContent(tabId, { action: 'captureVideoFrames', timestamps });
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
    meta = await ensureSendToContent(tabId, { action: 'getVideoMeta' }) || {};
  } catch (_) {}

  let transcript = null;
  try {
    if (platform === 'youtube') transcript = await fetchYouTubeTranscript(tabId, url, endTime);
    else if (platform === 'bilibili') transcript = await extractBilibiliTranscript(url, endTime);
  } catch (_) {}

  const cover_url = await getCoverUrl(tabId, platform);

  const payload = {
    mode: 'hook',
    url,
    title: sanitize(tab.title),
    platform,
    captured_at: new Date().toISOString(),
    frames: captureResp.frames,
    frames_select: count,
    video_title: meta.videoTitle || null,
    channel: meta.channel || null,
    time_range: { start: 0, end: endTime },
    ...(cover_url ? { cover_url } : {}),
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
    if (response.obsidianUrl) {
      ensureSendToContent(tabId, { action: 'openObsidian', url: response.obsidianUrl }).catch(() => {});
    }
    if (response.notice) notifyNotice(response.notice);
  } else {
    notifyError(response.error || 'Hook 分析失败，请重试');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function cleanVideoUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('si');
    return u.toString();
  } catch { return url; }
}

// ── Transcript extraction ──────────────────────────────────────────────────────

async function fetchYouTubeTranscript(tabId, videoUrl, endTime) {
  const videoId = new URL(videoUrl).searchParams.get('v');
  if (!videoId) return null;

  // Run inside the YouTube tab (content script context) so fetch uses the tab's
  // cookies and doesn't trigger extension host-permission prompts — same approach
  // as Obsidian Web Clipper / defuddle's YoutubeExtractor.
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (videoId, endTime) => {
      // iOS Innertube client: no POT required for subtitles (unlike web client)
      const playerData = await fetch(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'IOS', clientVersion: '20.10.3' } },
            videoId,
          }),
        }
      ).then(r => r.json()).catch(() => null);

      const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      if (!tracks.length) return null;

      const track = tracks.find(t => t.languageCode === 'en') || tracks[0];
      const data = await fetch(`${track.baseUrl}&fmt=json3`).then(r => r.json()).catch(() => null);
      if (!data) return null;

      const lookahead = 5;
      const events = (data.events || []).filter(e => e.segs);
      const inWindow = events.filter(e => e.tStartMs / 1000 <= endTime + lookahead);

      let cutIdx = -1;
      for (let i = inWindow.length - 1; i >= 0; i--) {
        if (inWindow[i].tStartMs / 1000 <= endTime) { cutIdx = i; break; }
      }
      if (cutIdx === -1) return null;

      const SENTENCE_END = /[.!?。！？]["']?\s*$/;
      if (!SENTENCE_END.test(inWindow[cutIdx].segs.map(s => s.utf8).join(''))) {
        for (let i = cutIdx + 1; i < inWindow.length; i++) {
          if (SENTENCE_END.test(inWindow[i].segs.map(s => s.utf8).join(''))) { cutIdx = i; break; }
        }
      }

      return inWindow.slice(0, cutIdx + 1)
        .map(e => e.segs.map(s => s.utf8).join(''))
        .join(' ').trim() || null;
    },
    args: [videoId, endTime],
  });

  return results?.[0]?.result || null;
}

async function extractBilibiliTranscript(url, endTime) {
  const playinfo = await fetch(url)
    .then(r => r.text())
    .then(html => {
      const start = html.indexOf('window.__playinfo__=');
      if (start === -1) return null;
      const jsonStart = html.indexOf('{', start);
      if (jsonStart === -1) return null;
      let depth = 0, i = jsonStart;
      for (; i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') { depth--; if (depth === 0) break; }
      }
      try { return JSON.parse(html.slice(jsonStart, i + 1)); } catch { return null; }
    })
    .catch(() => null);

  const subtitleUrl = playinfo?.data?.subtitle?.subtitles?.[0]?.subtitle_url;
  if (!subtitleUrl) return null;

  const subs = await fetch(`https:${subtitleUrl}`).then(r => r.json()).catch(() => null);
  if (!subs?.body) return null;
  return subs.body
    .filter(s => s.from <= endTime)
    .map(s => s.content)
    .join(' ').trim() || null;
}
