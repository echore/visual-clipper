// background.js — Screenshot Clipper service worker

const HOST = 'com.screenshot_clipper.host';

// ── Install → welcome ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// ── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'startCapture') startCapture(msg.tabId, msg.windowId);
  if (msg.action === 'regionSelected') handleRegion(msg, sender.tab.id);
});

// ── Step 1: capture full tab screenshot, pass dataUrl to content script ──────
async function startCapture(tabId, windowId) {
  try {
    // Capture BEFORE overlay so overlay doesn't appear in the screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    // Pass dataUrl directly to content script — avoids service worker memory issues
    chrome.tabs.sendMessage(tabId, { action: 'showOverlay', dataUrl }, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn('[SC] content script not ready — refresh the page first');
      }
    });
  } catch (err) {
    console.error('[SC] captureVisibleTab failed:', err.message);
    // e.g. restricted page (chrome://) — silently ignore
  }
}

// ── Step 2: crop + native message ────────────────────────────────────────────
async function handleRegion(msg, tabId) {
  // dataUrl comes from content script (which held it since showOverlay)
  const dataUrl = msg.dataUrl;

  if (!dataUrl) {
    chrome.tabs.sendMessage(tabId, {
      action: 'captureResult', success: false, error: '截图数据丢失，请重试',
    });
    notifyError('截图数据丢失，请重试');
    return;
  }

  let croppedB64;
  try {
    croppedB64 = await cropImage(dataUrl, msg.rect, msg.dpr);
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      action: 'captureResult', success: false, error: '裁剪失败，请重试',
    });
    notifyError('裁剪失败，请重试');
    return;
  }

  const settings = await new Promise(resolve =>
    chrome.storage.local.get({ vault_name: '', notes_folder: '', assets_folder: '' }, resolve)
  );

  let response;
  try {
    response = await nativeMessage({
      image_base64: croppedB64,
      source_url: msg.source_url,
      title: sanitize(msg.title),
      vault_name:    settings.vault_name    || undefined,
      notes_folder:  settings.notes_folder  || undefined,
      assets_folder: settings.assets_folder || undefined,
    });
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      action: 'captureResult', success: false,
      error: 'Host 未安装，请先运行 install.sh',
    });
    notifyError('Host 未安装，请先运行 install.sh');
    return;
  }

  chrome.tabs.sendMessage(tabId, { action: 'captureResult', ...response });

  if (response.success && response.note_path) {
    chrome.tabs.create({ url: buildObsidianUrl(settings.vault_name, response.note_path) });
  } else if (!response.success) {
    notifyError(response.error || '截图处理失败，请重试');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function notifyError(errMsg) {
  chrome.storage.local.set({ last_error: errMsg });
  chrome.action.setBadgeText({ text: '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#E53E3E' });
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'Screenshot Clipper 处理失败',
    message: errMsg,
  });
}

function buildObsidianUrl(vaultName, notePath) {
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(notePath)}`;
}

async function cropImage(dataUrl, rect, dpr) {
  // createImageBitmap with source rect handles the DPR scaling automatically
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
  // btoa is available in service workers
  let b = '';
  for (let i = 0; i < bytes.length; i++) b += String.fromCharCode(bytes[i]);
  return btoa(b);
}

function nativeMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage(HOST, msg, (resp) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp || { success: false, error: 'Host 无响应' });
      }
    });
  });
}

function sanitize(str) {
  return (str || '').replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}
