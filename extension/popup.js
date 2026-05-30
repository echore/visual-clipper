// popup.js

const SETTING_KEYS = { vault_name: '', notes_folder: '', assets_folder: '' };

// ── Shared UI refs ────────────────────────────────────────────────────────────
const errorDiv = document.getElementById('settings-error');

// ── Load settings ─────────────────────────────────────────────────────────────
chrome.storage.local.get(SETTING_KEYS, (stored) => {
  document.getElementById('vault_name').value    = stored.vault_name;
  document.getElementById('notes_folder').value  = stored.notes_folder;
  document.getElementById('assets_folder').value = stored.assets_folder;
});

// ── Show stored error from previous clip attempt (if any) ─────────────────────
chrome.storage.local.get(['last_error'], ({ last_error }) => {
  if (last_error) {
    errorDiv.textContent = last_error;
    errorDiv.style.display = 'block';
    chrome.storage.local.remove('last_error');
    chrome.action.setBadgeText({ text: '' });
  }
});

// ── Auto-save ─────────────────────────────────────────────────────────────────
let _saveTimer = null;
function save() {
  chrome.storage.local.set({
    vault_name:    document.getElementById('vault_name').value.trim(),
    notes_folder:  document.getElementById('notes_folder').value.trim(),
    assets_folder: document.getElementById('assets_folder').value.trim(),
  });
  errorDiv.style.display = 'none';
  const hint = document.getElementById('save-hint');
  hint.style.opacity = '1';
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => { hint.style.opacity = '0'; }, 1500);
}
['vault_name', 'notes_folder', 'assets_folder'].forEach(id => {
  document.getElementById(id).addEventListener('input', save);
});

// ── Clip button ───────────────────────────────────────────────────────────────
const clipBtn = document.getElementById('clip-btn');

clipBtn.addEventListener('click', async () => {
  errorDiv.style.display = 'none';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  chrome.runtime.sendMessage({ action: 'startCapture', tabId: tab.id, windowId: tab.windowId });
  window.close();
});

// ── Help link ─────────────────────────────────────────────────────────────────
document.getElementById('open-welcome').addEventListener('click', e => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});
