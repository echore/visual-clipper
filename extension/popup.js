// popup.js

const SETTING_KEYS = { vault_name: '', notes_folder: '', assets_folder: '' };

// ── Load settings ─────────────────────────────────────────────────────────────
chrome.storage.local.get(SETTING_KEYS, (stored) => {
  document.getElementById('vault_name').value    = stored.vault_name;
  document.getElementById('notes_folder').value  = stored.notes_folder;
  document.getElementById('assets_folder').value = stored.assets_folder;
});

// ── Auto-save on any input change ─────────────────────────────────────────────
let _saveTimer = null;
function save() {
  chrome.storage.local.set({
    vault_name:    document.getElementById('vault_name').value.trim(),
    notes_folder:  document.getElementById('notes_folder').value.trim(),
    assets_folder: document.getElementById('assets_folder').value.trim(),
  });
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
const errorDiv = document.getElementById('settings-error');

clipBtn.addEventListener('click', async () => {
  errorDiv.style.display = 'none';
  clipBtn.disabled = true;
  clipBtn.textContent = '检查设置…';

  const settings = {
    action:        'validate',
    vault_name:    document.getElementById('vault_name').value.trim(),
    notes_folder:  document.getElementById('notes_folder').value.trim(),
    assets_folder: document.getElementById('assets_folder').value.trim(),
  };

  const ok = await new Promise(resolve => {
    chrome.runtime.sendNativeMessage('com.screenshot_clipper.host', settings, (resp) => {
      if (chrome.runtime.lastError) {
        errorDiv.textContent = 'Host 未安装，请先运行 install.sh';
        errorDiv.style.display = 'block';
        resolve(false);
        return;
      }
      if (!resp || !resp.valid) {
        errorDiv.textContent = resp?.error || '设置有误，请检查 Vault 和文件夹名称';
        errorDiv.style.display = 'block';
        resolve(false);
        return;
      }
      resolve(true);
    });
  });

  clipBtn.disabled = false;
  clipBtn.textContent = '✂ Clip 当前页面';
  if (!ok) return;

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
