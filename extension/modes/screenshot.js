import { sanitize, httpPost, notifyError } from './utils.js';

export async function start(tabId, windowId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    chrome.tabs.sendMessage(tabId, { action: 'showOverlay', dataUrl }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[OVC] content script not ready — refresh the page first');
      }
    });
  } catch (err) {
    console.error('[OVC] captureVisibleTab failed:', err.message);
  }
}

export async function handleRegion(msg, tabId) {
  if (!msg.dataUrl) {
    chrome.tabs.sendMessage(tabId, { action: 'captureResult', success: false, error: '截图数据丢失，请重试' });
    notifyError('截图数据丢失，请重试');
    return;
  }

  let croppedB64;
  try {
    croppedB64 = await cropImage(msg.dataUrl, msg.rect, msg.dpr);
  } catch (err) {
    chrome.tabs.sendMessage(tabId, { action: 'captureResult', success: false, error: '裁剪失败，请重试' });
    notifyError('裁剪失败，请重试');
    return;
  }

  // Batch mode: queue the image, don't send yet
  const stored = await new Promise(r =>
    chrome.storage.local.get(['screenshot_batch_mode', 'screenshot_queue'], r)
  );
  if (stored.screenshot_batch_mode) {
    const queue = stored.screenshot_queue || [];
    queue.push({ image: croppedB64, url: msg.source_url, title: sanitize(msg.title) });
    await new Promise(r => chrome.storage.local.set({ screenshot_queue: queue }, r));
    chrome.action.setBadgeText({ text: String(queue.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    chrome.tabs.sendMessage(tabId, { action: 'captureResult', success: true });
    return;
  }

  // Single mode: send immediately
  let response;
  try {
    response = await httpPost({
      mode: 'screenshot',
      url: msg.source_url,
      title: sanitize(msg.title),
      platform: 'other',
      captured_at: new Date().toISOString(),
      image: croppedB64,
    });
  } catch (err) {
    const errMsg = 'vault-autopilot 无响应，请确认 Obsidian 已开启且插件已启用';
    chrome.tabs.sendMessage(tabId, { action: 'captureResult', success: false, error: errMsg });
    notifyError(errMsg);
    return;
  }

  chrome.tabs.sendMessage(tabId, { action: 'captureResult', ...response });
  if (response.success) {
    chrome.action.setBadgeText({ text: '' });
  } else {
    notifyError(response.error || '截图处理失败，请重试');
  }
}

export async function analyzeBatch(queue) {
  if (!queue.length) return;
  let response;
  try {
    response = await httpPost({
      mode: 'screenshot',
      images: queue.map(item => item.image),
      url: queue[0].url,
      title: queue[0].title,
      captured_at: new Date().toISOString(),
    });
  } catch (err) {
    notifyError('vault-autopilot 无响应，请确认 Obsidian 已开启且插件已启用');
    return;
  }
  if (response.success) {
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 3000);
  } else {
    notifyError(response.error || '截图处理失败，请重试');
  }
}

async function cropImage(dataUrl, rect, dpr) {
  const resp = await fetch(dataUrl);
  const blob = await resp.blob();
  const sx = Math.round(rect.x * dpr);
  const sy = Math.round(rect.y * dpr);
  const sw = Math.max(1, Math.round(rect.width * dpr));
  const sh = Math.max(1, Math.round(rect.height * dpr));
  const bitmap = await createImageBitmap(blob, sx, sy, sw, sh);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  const outBlob = await canvas.convertToBlob({ type: 'image/png' });
  const buf = await outBlob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let b = '';
  for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}
