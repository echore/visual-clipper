import { pingAutopilot, httpPost, getPort, DEFAULT_PORT } from './modes/utils.js';

const connCheck   = document.getElementById('conn-check');
const connStatus  = document.getElementById('conn-status');
const connDetail  = document.getElementById('conn-detail');
const installGuide = document.getElementById('install-guide');
const testBlock   = document.getElementById('test-clip-block');

async function refreshStatus() {
  const { connected, version } = await pingAutopilot();
  connCheck.classList.toggle('ok', connected);
  connCheck.classList.toggle('bad', !connected);
  installGuide.style.display = connected ? 'none' : 'block';
  testBlock.style.display = connected ? 'block' : 'none';
  if (connected) {
    connStatus.textContent = `🟢 已连接 vault-autopilot v${version}`;
    connDetail.textContent = '一切就绪，可以开始用了。';
  } else {
    const port = await getPort();
    connStatus.textContent = '🔴 未检测到 vault-autopilot';
    connDetail.textContent = `请确认：① Obsidian 开着 ② vault-autopilot 插件已安装并启用 ③ 端口一致（当前扩展用 ${port}）。装好后本页会自动变绿。`;
  }
}
refreshStatus();
setInterval(refreshStatus, 3000);

// ── Test clip: make the folder structure tangible within 30 seconds ───────────
// 1×1 transparent PNG — enough to exercise the whole save pipeline.
const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

document.getElementById('btn-test-clip').addEventListener('click', async () => {
  const btn = document.getElementById('btn-test-clip');
  const result = document.getElementById('test-result');
  btn.disabled = true;
  result.textContent = '发送中…';
  try {
    const resp = await httpPost({
      mode: 'screenshot',
      images: [TINY_PNG],
      url: 'https://example.com',
      title: '欢迎使用 Obsidian Visual Clipper',
    });
    result.innerHTML = '✅ 已保存！';
    if (resp.obsidianUrl) {
      const a = document.createElement('a');
      a.href = resp.obsidianUrl;
      a.textContent = '在 Obsidian 中打开这条笔记 →';
      result.append(' ', a);
    }
  } catch (e) {
    result.textContent = `❌ ${e.message}`;
  } finally {
    btn.disabled = false;
  }
});

// ── Advanced: port escape hatch ───────────────────────────────────────────────
const portInput = document.getElementById('port-input');
const portSaved = document.getElementById('port-saved');
getPort().then(p => { portInput.value = p; });
document.getElementById('btn-save-port').addEventListener('click', async () => {
  const n = parseInt(portInput.value, 10);
  if (!Number.isInteger(n) || n <= 1024 || n >= 65536) {
    portSaved.textContent = '端口需在 1025–65535 之间';
    return;
  }
  await chrome.storage.local.set({ sc_port: n === DEFAULT_PORT ? undefined : n });
  if (n === DEFAULT_PORT) await chrome.storage.local.remove('sc_port');
  portSaved.textContent = '已保存';
  refreshStatus();
});
