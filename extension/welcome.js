import { pingAutopilot, getPort, DEFAULT_PORT } from './modes/utils.js';
import { t, localizeDocument } from './modes/i18n.js';

localizeDocument();

const connCheck    = document.getElementById('conn-check');
const connStatus   = document.getElementById('conn-status');
const connDetail   = document.getElementById('conn-detail');
const installGuide = document.getElementById('install-guide');
const tryIt        = document.getElementById('try-it');

async function refreshStatus() {
  const { connected, version } = await pingAutopilot();
  connCheck.classList.toggle('ok', connected);
  connCheck.classList.toggle('bad', !connected);
  installGuide.style.display = connected ? 'none' : 'block';
  tryIt.style.display = connected ? 'block' : 'none';
  if (connected) {
    connStatus.textContent = t('welcome_conn_ok', [version]);
    connDetail.textContent = t('welcome_conn_ok_detail');
  } else {
    const port = await getPort();
    connStatus.textContent = t('welcome_conn_bad');
    connDetail.textContent = t('welcome_conn_bad_detail', [String(port)]);
  }
}
refreshStatus();
// Don't poll while page is hidden; resume immediately when tab becomes visible
setInterval(() => { if (!document.hidden) refreshStatus(); }, 3000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });

// ── Advanced: port escape hatch ───────────────────────────────────────────────
const portInput = document.getElementById('port-input');
const portSaved = document.getElementById('port-saved');
getPort().then(p => { portInput.value = p; });
document.getElementById('btn-save-port').addEventListener('click', async () => {
  const n = parseInt(portInput.value, 10);
  if (!Number.isInteger(n) || n <= 1024 || n >= 65536) {
    portSaved.textContent = t('welcome_port_invalid');
    return;
  }
  if (n === DEFAULT_PORT) await chrome.storage.local.remove('sc_port');
  else await chrome.storage.local.set({ sc_port: n });
  portSaved.textContent = t('welcome_port_saved');
  refreshStatus();
});
