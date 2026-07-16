import { buildTimestamps, sanitize, notifyError, notifyNotice, notifySavedNotionInPage, ensureSendToContent, detectPlatform, getCoverUrl } from './utils.js';
import { getActiveDestination } from './destinations/index.js';
import { t } from './i18n.js';

export function start(tabId) {
  // State is managed in chrome.storage.local by popup.js (Mark In click)
  // Nothing to do here on "startKeyframe" — popup.js handles Mark In storage directly
}

export async function markOut(tabId, outTime, inTime, url, title, platform, videoTitle, channel) {
  if (inTime == null) {
    notifyError(t('err_kf_no_in'));
    return;
  }

  const start = Math.min(inTime, outTime);
  const end   = Math.max(inTime, outTime);

  if (end - start < 0.1) {
    notifyError(t('err_kf_too_close'));
    return;
  }

  // Candidate count scales with the segment length: ~3 frames/sec, min 4, max 14.
  // Short clip → few candidates to pick from; long clip → more.
  const sampleN = Math.min(14, Math.max(4, Math.ceil((end - start) * 3)));
  const timestamps = buildTimestamps(start, end, sampleN);

  let captureResp;
  try {
    captureResp = await ensureSendToContent(tabId, { action: 'captureVideoFrames', timestamps, minDiff: 6, picker: 'toggle' });
  } catch (err) {
    notifyError(t('err_page_comm'));
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
    const dest = await getActiveDestination();
    response = await dest.send(payload);
  } catch (err) {
    notifyError(err.message || t('err_no_response'));
    return;
  }

  if (response.success) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
    if (response.obsidianUrl) {
      ensureSendToContent(tabId, { action: 'openObsidian', url: response.obsidianUrl }).catch(() => {});
    } else if (response.notionUrl) {
      notifySavedNotionInPage(tabId, response.notionUrl);
    }
    if (response.notice) notifyNotice(response.notice);
  } else {
    notifyError(response.error || t('err_kf_failed'));
  }
}
