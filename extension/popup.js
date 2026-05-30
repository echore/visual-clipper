// popup.js

const btnScreenshot = document.getElementById('btn-screenshot');
const btnHook       = document.getElementById('btn-hook');
const btnKeyframe   = document.getElementById('btn-keyframe');
const keyframeHint  = document.getElementById('keyframe-hint');
const errorMsg      = document.getElementById('error-msg');

// ── Show stored error from previous clip attempt ──────────────────────────────
chrome.storage.local.get(['last_error', 'keyframe_in_time', 'keyframe_tab_id'], (stored) => {
  if (stored.last_error) {
    errorMsg.textContent = stored.last_error;
    errorMsg.style.display = 'block';
    chrome.storage.local.remove('last_error');
    chrome.action.setBadgeText({ text: '' });
  }

  // Restore keyframe state if In was already marked
  if (stored.keyframe_in_time !== undefined) {
    const inFormatted = formatTime(stored.keyframe_in_time);
    keyframeHint.textContent = `▶ In 已标记 ${inFormatted} — 定位到结束位置，再次点击标记 Out`;
    keyframeHint.style.display = 'block';
    btnKeyframe.classList.add('active');
    btnKeyframe.querySelector('.sub').textContent = `Out & Capture (In: ${inFormatted})`;
  }
});

// ── Detect video on active tab ────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { action: 'detectVideo' }, (resp) => {
    if (chrome.runtime.lastError) return; // content script not ready
    if (resp?.hasVideo) {
      btnHook.disabled = false;
      btnKeyframe.disabled = false;
    }
  });
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

// ── Video Keyframes ───────────────────────────────────────────────────────────
btnKeyframe.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const stored = await new Promise(resolve =>
    chrome.storage.local.get(['keyframe_in_time', 'keyframe_tab_id'], resolve)
  );

  if (stored.keyframe_in_time === undefined || stored.keyframe_tab_id !== tab.id) {
    // First click on this tab: Mark In
    chrome.tabs.sendMessage(tab.id, { action: 'getCurrentTime' }, (resp) => {
      if (resp?.currentTime == null) return;
      chrome.storage.local.set({ keyframe_in_time: resp.currentTime, keyframe_tab_id: tab.id });
      chrome.action.setBadgeText({ text: '▶' });
      chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    });
    window.close();
  } else {
    // Second click: Mark Out → capture
    chrome.tabs.sendMessage(tab.id, { action: 'getCurrentTime' }, (resp) => {
      if (resp?.currentTime == null) return;
      chrome.runtime.sendMessage({
        action: 'markOut',
        tabId: tab.id,
        inTime: stored.keyframe_in_time,
        currentTime: resp.currentTime,
        url: tab.url,
        title: tab.title,
        platform: detectPlatform(tab.url),
        videoTitle: null,
        channel: null,
      });
      chrome.storage.local.remove(['keyframe_in_time', 'keyframe_tab_id']);
      chrome.action.setBadgeText({ text: '' });
    });
    window.close();
  }
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
