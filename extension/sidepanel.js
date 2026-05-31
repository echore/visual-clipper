let tabId = null;
let inTime = null;
let tickInterval = null;

// ── Init: get active tab ───────────────────────────────────────────────────────
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  if (!tab) return;
  tabId = tab.id;

  // Check for existing in-progress mark (tab refreshed mid-flow)
  chrome.storage.local.get(['keyframe_in_time', 'keyframe_tab_id'], (stored) => {
    if (stored.keyframe_in_time !== undefined && stored.keyframe_tab_id === tabId) {
      inTime = stored.keyframe_in_time;
      showStep2();
    }
  });

  detectVideo();
  startTick();
});

// ── Video detection ────────────────────────────────────────────────────────────
function detectVideo() {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action: 'detectVideo' }, (resp) => {
    if (chrome.runtime.lastError || !resp?.hasVideo) {
      document.getElementById('no-video').style.display = 'block';
      document.getElementById('step1').style.display = 'none';
      document.getElementById('step2').style.display = 'none';
    }
  });
}

// ── Live time tick ─────────────────────────────────────────────────────────────
function startTick() {
  tickInterval = setInterval(() => {
    if (!tabId) return;
    chrome.tabs.sendMessage(tabId, { action: 'getCurrentTime' }, (resp) => {
      if (chrome.runtime.lastError || resp?.currentTime == null) return;
      const t = resp.currentTime;
      document.getElementById('current-time-1').textContent = fmt(t);
      document.getElementById('current-time-2').textContent = fmt(t);
      if (inTime !== null) {
        const dur = Math.max(0, t - inTime);
        document.getElementById('duration').textContent = fmt(dur);
      }
    });
  }, 500);
}

// ── Mark start ─────────────────────────────────────────────────────────────────
document.getElementById('btn-mark-start').addEventListener('click', () => {
  if (!tabId) return;
  chrome.tabs.sendMessage(tabId, { action: 'getCurrentTime' }, (resp) => {
    if (chrome.runtime.lastError || resp?.currentTime == null) return;
    inTime = resp.currentTime;
    chrome.storage.local.set({ keyframe_in_time: inTime, keyframe_tab_id: tabId });
    chrome.action.setBadgeText({ text: '▶' });
    chrome.action.setBadgeBackgroundColor({ color: '#6366f1' });
    showStep2();
  });
});

// ── Capture ────────────────────────────────────────────────────────────────────
document.getElementById('btn-capture').addEventListener('click', () => {
  if (!tabId || inTime === null) return;
  chrome.tabs.sendMessage(tabId, { action: 'getCurrentTime' }, (resp) => {
    if (chrome.runtime.lastError || resp?.currentTime == null) return;
    // TODO: trigger actual capture via background
    chrome.runtime.sendMessage({
      action: 'markOut',
      tabId,
      inTime,
      currentTime: resp.currentTime,
    });
    clearMark();
  });
});

// ── Cancel ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-cancel').addEventListener('click', clearMark);

// ── Helpers ────────────────────────────────────────────────────────────────────
function showStep2() {
  document.getElementById('step1').style.display = 'none';
  document.getElementById('step2').style.display = 'block';
  document.getElementById('step2').classList.add('active');
  document.getElementById('start-badge').textContent = `开始：${fmt(inTime)}`;
}

function clearMark() {
  inTime = null;
  chrome.storage.local.remove(['keyframe_in_time', 'keyframe_tab_id']);
  chrome.action.setBadgeText({ text: '' });
  document.getElementById('step2').style.display = 'none';
  document.getElementById('step1').style.display = 'block';
}

function fmt(seconds) {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
