// popup.js

const btnScreenshot   = document.getElementById('btn-screenshot');
const btnHook         = document.getElementById('btn-hook');
const btnKeyframe     = document.getElementById('btn-keyframe');
const btnThumbnail    = document.getElementById('btn-thumbnail');
const keyframeHint    = document.getElementById('keyframe-hint');
const errorMsg        = document.getElementById('error-msg');
const batchToggle     = document.getElementById('batch-toggle');
const btnBatchAnalyze = document.getElementById('btn-batch-analyze');
const batchCountEl    = document.getElementById('batch-count');

// ── Show stored error from previous clip attempt ──────────────────────────────
chrome.storage.local.get(['last_error', 'last_notice', 'keyframe_in_time', 'keyframe_tab_id', 'screenshot_batch_mode', 'screenshot_queue'], (stored) => {
  if (stored.last_error) {
    errorMsg.textContent = stored.last_error;
    errorMsg.style.display = 'block';
    chrome.storage.local.remove('last_error');
    chrome.action.setBadgeText({ text: '' });
  } else if (stored.last_notice) {
    errorMsg.textContent = stored.last_notice;
    errorMsg.style.color = '#6366f1'; // notice, not an error
    errorMsg.style.display = 'block';
    chrome.storage.local.remove('last_notice');
    chrome.action.setBadgeText({ text: '' });
  }

  // Restore batch mode state
  batchToggle.checked = stored.screenshot_batch_mode || false;
  const queue = stored.screenshot_queue || [];
  if (queue.length > 0) {
    batchCountEl.textContent = queue.length;
    btnBatchAnalyze.style.display = 'inline-block';
  }

  // Show active state if keyframe mark is in progress
  if (stored.keyframe_in_time !== undefined) {
    btnKeyframe.classList.add('active');
    btnKeyframe.querySelector('.sub').textContent = `已标记 ${formatTime(stored.keyframe_in_time)} · 点击打开`;
  }
});

// ── Detect video on active tab ────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  detectVideo(tab);
});

function detectVideo(tab) {
  chrome.tabs.sendMessage(tab.id, { action: 'detectVideo' }, (resp) => {
    if (chrome.runtime.lastError) {
      // content.js isn't on this tab (e.g. it predates the extension reload), so
      // the video buttons would stay disabled forever. Inject it, then retry once.
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
        .then(() => chrome.tabs.sendMessage(tab.id, { action: 'detectVideo' }, (resp2) => {
          if (!chrome.runtime.lastError) enableForVideo(tab, resp2);
        }))
        .catch(() => {}); // restricted page — nothing we can do, leave buttons disabled
      return;
    }
    enableForVideo(tab, resp);
  });
}

function enableForVideo(tab, resp) {
  if (!resp?.hasVideo) return;
  btnHook.disabled = false;
  btnKeyframe.disabled = false;
  // Thumbnail only on YouTube/Bilibili video pages
  if (/youtube\.com\/watch|bilibili\.com\/video/.test(tab.url)) {
    btnThumbnail.disabled = false;
  }
  chrome.tabs.sendMessage(tab.id, { action: 'getCurrentTime' }, (timeResp) => {
    if (chrome.runtime.lastError) return;
    const t = timeResp?.currentTime;
    if (t != null) {
      document.getElementById('hook-sub').textContent =
        `已追踪 0:00 ~ ${formatTime(t)}  点击截取到当前位置`;
    }
  });
}

// ── Batch mode toggle ─────────────────────────────────────────────────────────
batchToggle.addEventListener('change', () => {
  chrome.storage.local.set({ screenshot_batch_mode: batchToggle.checked });
});

// ── Batch analyze ─────────────────────────────────────────────────────────────
btnBatchAnalyze.addEventListener('click', async () => {
  const stored = await new Promise(r => chrome.storage.local.get(['screenshot_queue'], r));
  const queue = stored.screenshot_queue || [];
  if (!queue.length) return;
  chrome.runtime.sendMessage({ action: 'analyzeBatch', queue });
  chrome.storage.local.remove('screenshot_queue');
  chrome.action.setBadgeText({ text: '' });
  window.close();
});

// ── Screenshot ────────────────────────────────────────────────────────────────
btnScreenshot.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'startCapture', tabId: tab.id, windowId: tab.windowId });
  window.close();
});

// ── Hook Analysis ─────────────────────────────────────────────────────────────
btnHook.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'startHook', tabId: tab.id });
  window.close();
});

// ── Thumbnail save ────────────────────────────────────────────────────────────
btnThumbnail.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'saveThumbnail', tabId: tab.id });
  window.close();
});

// ── Video Keyframes → open Side Panel ────────────────────────────────────────
btnKeyframe.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
  window.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  if (/bilibili\.com/.test(url)) return 'bilibili';
  return 'other';
}

// ── Help link ─────────────────────────────────────────────────────────────────
document.getElementById('open-welcome').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
