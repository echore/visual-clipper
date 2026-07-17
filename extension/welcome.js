import { pingAutopilot, getPort, DEFAULT_PORT } from './modes/destinations/obsidian.js';
import { ping as notionPing, parsePageId } from './modes/destinations/notion.js';
import { t, localizeDocument } from './modes/i18n.js';
import { applyDestinationView, normalizeDestination, resolveConnView } from './welcome-ui.js';

localizeDocument();

const connCheck    = document.getElementById('conn-check');
const connStatus   = document.getElementById('conn-status');
const connDetail   = document.getElementById('conn-detail');
const installGuide = document.getElementById('install-guide');
const tryItObsidian = document.getElementById('try-it');
const tryItNotion   = document.getElementById('try-it-notion');
const setupTriage  = document.getElementById('setup-triage');
const troubleGuide = document.getElementById('troubleshoot-guide');
const troubleKnown = document.getElementById('trouble-known');
const troublePort  = document.getElementById('trouble-port');
let renderedDest = null;

async function getDest() {
  const { sc_destination } = await chrome.storage.local.get('sc_destination');
  return normalizeDestination(sc_destination);
}

async function refreshStatus() {
  const dest = await getDest();
  applyDestinationView(document, dest);
  if (renderedDest !== dest) {
    connCheck.classList.remove('ok', 'bad');
    connStatus.textContent = t(dest === 'notion' ? 'welcome_conn_checking_notion' : 'welcome_conn_checking');
    connDetail.textContent = '';
    renderedDest = dest;
  }
  if (dest === 'notion') {
    const { connected } = await notionPing();
    connCheck.classList.toggle('ok', connected);
    connCheck.classList.toggle('bad', !connected);
    installGuide.hidden = true;
    tryItObsidian.hidden = true;
    tryItNotion.hidden = !connected;
    connStatus.textContent = t(connected ? 'welcome_conn_ok_notion' : 'welcome_conn_bad_notion');
    connDetail.textContent = '';
    return;
  }
  const { connected, version } = await pingAutopilot();
  connCheck.classList.toggle('ok', connected);
  connCheck.classList.toggle('bad', !connected);
  tryItNotion.hidden = true;
  if (connected) {
    // A later disconnect should route straight to troubleshooting.
    await chrome.storage.local.remove('sc_setup_choice');
    setObsidianView('green');
    connStatus.textContent = t('welcome_conn_ok', [version]);
    connDetail.textContent = t('welcome_conn_ok_detail');
    return;
  }
  const port = await getPort();
  const { sc_ever_connected, sc_setup_choice } = await chrome.storage.local.get(['sc_ever_connected', 'sc_setup_choice']);
  const view = resolveConnView({ connected, everConnected: !!sc_ever_connected, choice: sc_setup_choice });
  setObsidianView(view, { everConnected: !!sc_ever_connected, port });
  connStatus.textContent = t('welcome_conn_bad');
  connDetail.textContent = t('welcome_conn_waiting', [String(port)]);
}

function setObsidianView(view, opts = {}) {
  setupTriage.hidden   = view !== 'triage';
  troubleGuide.hidden  = view !== 'troubleshoot';
  installGuide.hidden  = view !== 'install';
  tryItObsidian.hidden = view !== 'green';
  if (view === 'troubleshoot') {
    troubleKnown.hidden = !opts.everConnected;
    troublePort.textContent = t('welcome_trouble_s3', [String(opts.port)]);
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

// Triage: the user tells us which situation they are in; we remember it.
async function chooseSetupPath(choice) {
  await chrome.storage.local.set({ sc_setup_choice: choice });
  refreshStatus();
}
document.getElementById('btn-triage-first').addEventListener('click', () => chooseSetupPath('install'));
document.getElementById('btn-triage-installed').addEventListener('click', () => chooseSetupPath('troubleshoot'));
document.getElementById('lnk-show-install').addEventListener('click', (e) => { e.preventDefault(); chooseSetupPath('install'); });
document.getElementById('lnk-show-trouble').addEventListener('click', (e) => { e.preventDefault(); chooseSetupPath('troubleshoot'); });
// External-protocol navigation launches the app and leaves this page in place.
document.getElementById('btn-open-obsidian').addEventListener('click', () => { window.location.href = 'obsidian://'; });

// Destination radios
getDest().then((d) => { document.getElementById(`dest-${d}`).checked = true; });
for (const radio of document.querySelectorAll('input[name="dest"]')) {
  radio.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ sc_destination: e.target.value });
    refreshStatus();
  });
}

// Notion config: save & test
chrome.storage.local.get(['sc_notion_token', 'sc_notion_parent']).then((s) => {
  if (s.sc_notion_token) document.getElementById('notion-token').value = s.sc_notion_token;
  if (s.sc_notion_parent) document.getElementById('notion-parent').value = s.sc_notion_parent;
});
document.getElementById('btn-notion-save').addEventListener('click', async () => {
  const token = document.getElementById('notion-token').value.trim();
  const parent = document.getElementById('notion-parent').value.trim();
  const status = document.getElementById('notion-config-status');
  if (!parsePageId(parent)) {
    status.textContent = t('welcome_notion_invalid_parent');
    status.classList.add('bad');
    status.classList.remove('ok');
    return;
  }
  const prev = await chrome.storage.local.get('sc_notion_parent');
  if (prev.sc_notion_parent !== parent) await chrome.storage.local.remove(['sc_notion_ds', 'sc_notion_props']); // 换父页面 → 旧库缓存作废
  await chrome.storage.local.set({ sc_notion_token: token, sc_notion_parent: parent });
  const { connected } = await notionPing();
  status.textContent = t(connected ? 'welcome_notion_ok' : 'welcome_notion_bad');
  status.classList.toggle('ok', connected);
  status.classList.toggle('bad', !connected);
  refreshStatus();
});

// Guide screenshots are optional: slots stay hidden until the image file
// actually loads, so a missing guide/*.png never shows a broken image.
for (const img of document.querySelectorAll('img.shot')) {
  const altKey = img.dataset.i18nAlt;
  if (altKey) img.alt = t(altKey);
  img.addEventListener('load', () => { img.style.display = 'block'; });
  if (img.complete && img.naturalWidth > 0) img.style.display = 'block';
}
