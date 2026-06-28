import { buildTimestamps, sanitize, httpPost, notifyError, notifyNotice, ensureSendToContent, detectPlatform, getCoverUrl } from './utils.js';

export function start(tabId) {
  // State is managed in chrome.storage.local by popup.js (Mark In click)
  // Nothing to do here on "startKeyframe" — popup.js handles Mark In storage directly
}

export async function markOut(tabId, outTime, inTime, url, title, platform, videoTitle, channel) {
  if (inTime == null) {
    notifyError('未找到 In 标记，请重新标记');
    return;
  }

  const start = Math.min(inTime, outTime);
  const end   = Math.max(inTime, outTime);

  if (end - start < 0.1) {
    notifyError('In 和 Out 时间太接近，请重新标记');
    return;
  }

  // Keyframe segments are short — sample densely (~4/s, min 12) so the user has
  // plenty to pick from across the effect's progression.
  const sampleN = Math.min(20, Math.max(12, Math.ceil((end - start) * 4)));
  const timestamps = buildTimestamps(start, end, sampleN);

  let captureResp;
  try {
    captureResp = await ensureSendToContent(tabId, { action: 'captureVideoFrames', timestamps, minDiff: 6 });
  } catch (err) {
    notifyError('无法与页面通信，请刷新后重试');
    return;
  }

  if (captureResp.error) {
    notifyError(captureResp.error);
    return;
  }

  if (captureResp.cancelled || !captureResp.frames || captureResp.frames.length === 0) {
    return; // user cancelled the picker — save nothing
  }

  // Get video metadata (best-effort)
  let meta = {};
  try {
    meta = await ensureSendToContent(tabId, { action: 'getVideoMeta' }) || {};
  } catch (_) {}

  const resolvedPlatform = platform || detectPlatform(url);
  const cover_url = await getCoverUrl(tabId, resolvedPlatform);

  const payload = {
    mode: 'keyframe',
    url,
    title: sanitize(title),
    platform: resolvedPlatform,
    captured_at: new Date().toISOString(),
    frames: captureResp.frames,
    frames_select: captureResp.frames.length, // user already picked — save all
    video_title: meta.videoTitle || videoTitle || null,
    channel: meta.channel || channel || null,
    time_range: { start, end },
    ...(cover_url ? { cover_url } : {}),
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
    notifyError(response.error || '关键帧捕获失败，请重试');
  }
}
