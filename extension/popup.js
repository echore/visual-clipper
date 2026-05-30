// popup.js

// ── Load settings ─────────────────────────────────────────────────────────────
chrome.storage.local.get({ vault_name: '' }, ({ vault_name }) => {
  document.getElementById('vault_name').value = vault_name;
});

// ── Auto-save settings with fade hint ────────────────────────────────────────
let _saveTimer = null;
function save() {
  chrome.storage.local.set({ vault_name: document.getElementById('vault_name').value.trim() });
  const hint = document.getElementById('save-hint');
  hint.style.opacity = '1';
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { hint.style.opacity = '0'; }, 1500);
}
document.getElementById('vault_name').addEventListener('input', save);

// ── Clip button ───────────────────────────────────────────────────────────────
document.getElementById('clip-btn').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'startCapture', tabId: tab.id, windowId: tab.windowId });
  window.close(); // close popup so user can see the overlay on the page
});

// ── Recent history ────────────────────────────────────────────────────────────
chrome.storage.local.get({ clip_history: [] }, ({ clip_history }) => {
  const list = document.getElementById('history-list');
  if (clip_history.length === 0) {
    list.innerHTML = '<span class="history-empty">还没有 Clip 记录</span>';
    return;
  }
  list.innerHTML = clip_history.slice(0, 8).map(({ title, note_path, success, time }) => {
    const date = new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit' });
    const dotClass = success ? 'dot-ok' : 'dot-err';
    const label = title || note_path || '未知标题';
    return `<div class="history-item" data-path="${note_path || ''}">
      <div class="history-dot ${dotClass}"></div>
      <div class="history-text">
        <div class="history-title">${escHtml(label)}</div>
        <div class="history-time">${date}</div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.history-item[data-path]').forEach(el => {
    el.addEventListener('click', () => {
      const p = el.dataset.path;
      if (!p) return;
      chrome.storage.local.get({ vault_name: '' }, ({ vault_name }) => {
        if (!vault_name) return;
        const uri = 'obsidian://open?vault=' + encodeURIComponent(vault_name)
          + '&file=' + encodeURIComponent(p);
        chrome.tabs.create({ url: uri });
      });
    });
  });
});

document.getElementById('open-welcome').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
