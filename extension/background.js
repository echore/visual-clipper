// background.js — Screenshot Clipper service worker

const HOST = 'com.screenshot_clipper.host';

// ── Install → welcome ────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// ── Per-tab screenshot store (cleared after use) ─────────────────────────────
const pending = new Map(); // tabId → dataUrl

// ── Message router ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'startCapture') startCapture(msg.tabId, msg.windowId);
  if (msg.action === 'regionSelected') handleRegion(msg, sender.tab.id);
});

// ── Step 1: capture full tab screenshot, then show overlay ───────────────────
async function startCapture(tabId, windowId) {
  try {
    // Capture BEFORE overlay so overlay doesn't appear in the screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    pending.set(tabId, dataUrl);
    chrome.tabs.sendMessage(tabId, { action: 'showOverlay' });
  } catch (err) {
    console.error('[SC] captureVisibleTab failed:', err.message);
    // e.g. restricted page (chrome://) — silently ignore
  }
}

// ── Step 2: crop + native message ────────────────────────────────────────────
async function handleRegion(msg, tabId) {
  const dataUrl = pending.get(tabId);
  pending.delete(tabId);

  if (!dataUrl) {
    chrome.tabs.sendMessage(tabId, {
      action: 'captureResult', success: false, error: '截图已过期，请重试',
    });
    return;
  }

  let croppedB64;
  try {
    croppedB64 = await cropImage(dataUrl, msg.rect, msg.dpr);
  } catch (err) {
    chrome.tabs.sendMessage(tabId, {
      action: 'captureResult', success: false, error: '裁剪失败：' + err.message,
    });
    return;
  }

  let response;
  try {
    response = await nativeMessage({
      image_base64: croppedB64,
      source_url: msg.source_url,
      title: sanitize(msg.title),
    });
  } catch (err) {
    // Host not installed or crashed
    chrome.tabs.sendMessage(tabId, {
      action: 'captureResult', success: false,
      error: 'Host 未安装，请先运行 install.sh（' + err.message + '）',
    });
    return;
  }

  // Store result for popup history
  const entry = {
    success: response.success,
    note_path: response.note_path || '',
    error: response.error || '',
    title: msg.title,
    source_url: msg.source_url,
    time: Date.now(),
  };
  chrome.storage.local.get({ clip_history: [] }, ({ clip_history }) => {
    chrome.storage.local.set({
      clip_history: [entry, ...clip_history].slice(0, 20),
      last_result: entry,
    });
  });

  chrome.tabs.sendMessage(tabId, { action: 'captureResult', ...response });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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
        resolve(resp || { success: false, error: 'no response from host' });
      }
    });
  });
}

function sanitize(str) {
  return (str || '').replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}
