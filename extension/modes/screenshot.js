import { sanitize, httpPost, notifyError, notifyNotice, sendToContent } from './utils.js';

export async function start(tabId, windowId) {
  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    console.error('[OVC] captureVisibleTab failed:', err.message);
    notifyError('截图失败，请重试');
    return;
  }

  const sendOverlay = () => new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { action: 'showOverlay', dataUrl }, () => {
      resolve(!chrome.runtime.lastError);
    });
  });

  // First try: content.js may already be present.
  if (await sendOverlay()) return;

  // Tab predates the extension install/reload — inject content.js, then retry.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch (err) {
    // Chrome forbids injecting into restricted pages (other extensions' pages,
    // chrome://, the web store, …), so region-select is impossible here. But the
    // full visible tab is already captured — save that whole image instead.
    console.warn('[OVC] cannot inject here, saving full page instead:', err.message);
    await saveFullCapture(tabId, dataUrl);
    return;
  }
  if (!(await sendOverlay())) {
    notifyError('无法在此页面截图，请刷新页面后重试');
  }
}

// Fallback for pages where a content script can't run: there's no region overlay,
// so we save the entire visible capture we already have.
async function saveFullCapture(tabId, dataUrl) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch (_) { tab = {}; }

  let response;
  try {
    response = await httpPost({
      mode: 'screenshot',
      url: tab.url || '',
      title: sanitize(tab.title || '截图'),
      platform: 'other',
      captured_at: new Date().toISOString(),
      image: dataUrl.split(',')[1],
    });
  } catch (err) {
    notifyError('vault-autopilot 无响应，请确认 Obsidian 已开启且插件已启用');
    return;
  }

  if (!response.success) {
    notifyError(response.error || '截图处理失败，请重试');
    return;
  }

  notifyNotice('此页面受浏览器限制，无法框选，已为你保存整页截图到 Obsidian。');
  // This page can't host a content script, so trigger the deep link from the tab
  // itself — Obsidian handles the protocol, the page stays put. Same "Open Obsidian?"
  // dialog as normal pages, just initiated via the extension API instead of page JS.
  if (response.obsidianUrl) {
    chrome.tabs.update(tabId, { url: response.obsidianUrl }).catch(() => {});
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
    if (response.obsidianUrl) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id != null) {
        sendToContent(tab.id, { action: 'openObsidian', url: response.obsidianUrl }).catch(() => {});
      }
    }
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
