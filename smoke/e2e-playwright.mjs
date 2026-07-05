#!/usr/bin/env node
// e2e-playwright.mjs — real end-to-end smoke test of the extension's onboarding
// chain: launches Chromium with the actual unpacked extension loaded (via
// --load-extension), against a real (mocked) vault-autopilot HTTP server
// (scripts/mock-autopilot.mjs), and drives welcome.html / popup.html as real
// pages inside the extension's origin.
//
// This exercises the FULL chain: welcome.js / popup.js -> modes/utils.js ->
// fetch() -> scripts/mock-autopilot.mjs (real child process, real sockets,
// real CORS preflight) -> back through the same DOM the user actually sees.
//
// Usage:
//   node smoke/e2e-playwright.mjs
// Requires: `npm install` run once inside smoke/ (installs playwright + browser
// binaries are shared from the playwright global cache; run
// `npx playwright install chromium` if the browser isn't present yet).
//
// Exits non-zero on any failing check. Always closes the browser context and
// kills the mock server child process before exiting (headed browsing, no
// leftover processes).

import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_PATH = path.join(ROOT, 'extension');
const MOCK_SCRIPT = path.join(ROOT, 'scripts/mock-autopilot.mjs');

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function startMock(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [MOCK_SCRIPT], {
      env: { ...process.env, MOCK_MODE: mode },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 3000;
    (async function poll() {
      try {
        const r = await fetch('http://127.0.0.1:17183/ping', { signal: AbortSignal.timeout(300) });
        if (r.ok) return resolve(child);
      } catch (_) { /* not up yet */ }
      if (Date.now() > deadline) { child.kill('SIGKILL'); return reject(new Error(`mock (${mode}) never came up`)); }
      setTimeout(poll, 100);
    })();
  });
}
const stopMock = (child) => new Promise((resolve) => {
  if (!child) return resolve();
  child.on('exit', resolve);
  child.kill('SIGTERM');
  setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) {} }, 1000);
});

async function main() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-smoke-ext-'));
  let context = null;
  let mock = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // MV3 service workers are unreliable under --headless=new + --load-extension
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 5000 });
    const extId = sw.url().split('/')[2];
    check('extension loaded and service worker registered', !!extId, `id=${extId}`);

    const page = context.pages()[0] || await context.newPage();

    // ── 1. welcome.html: mock DOWN -> red/disconnected state ──────────────────
    await page.goto(`chrome-extension://${extId}/welcome.html`);
    await page.waitForTimeout(1000); // let refreshStatus() finish its fetch
    {
      const cls = await page.getAttribute('#conn-check', 'class');
      const status = await page.textContent('#conn-status');
      const installGuideVisible = await page.isVisible('#install-guide');
      const testBlockVisible = await page.isVisible('#test-clip-block');
      check('welcome (down): red state class', cls.includes('bad'), cls);
      check('welcome (down): shows 未检测到', status.includes('未检测到'), status);
      check('welcome (down): install guide visible', installGuideVisible);
      check('welcome (down): test-clip block hidden', !testBlockVisible);
    }

    // ── 2. welcome.html: mock UP (ok) -> green/connected + test-clip block ────
    mock = await startMock('ok');
    await page.reload();
    await page.waitForTimeout(1000);
    {
      const cls = await page.getAttribute('#conn-check', 'class');
      const status = await page.textContent('#conn-status');
      const installGuideVisible = await page.isVisible('#install-guide');
      const testBlockVisible = await page.isVisible('#test-clip-block');
      check('welcome (up): green state class', cls.includes('ok'), cls);
      check('welcome (up): shows 已连接 + version', status.includes('已连接') && status.includes('mock'), status);
      check('welcome (up): install guide hidden', !installGuideVisible);
      check('welcome (up): test-clip block visible', testBlockVisible);
    }

    // ── 3. test-clip button click -> success message + correct obsidianUrl ────
    await page.click('#btn-test-clip');
    await page.waitForTimeout(600);
    {
      const resultText = await page.textContent('#test-result');
      const href = await page.getAttribute('#test-result a', 'href').catch(() => null);
      check('test-clip (ok): success message shown', resultText.includes('已保存'), resultText);
      check(
        'test-clip (ok): link href matches mock obsidianUrl',
        href === 'obsidian://open?vault=Mock&file=Clips%2FScreenshots%2Ftest.md',
        href,
      );
    }

    // ── 4. popup.html: mock UP -> green dot + 已连接 Obsidian ─────────────────
    {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      await popupPage.waitForTimeout(600);
      const cls = await popupPage.getAttribute('#conn-status', 'class');
      const text = await popupPage.textContent('#conn-text');
      check('popup (up): ok class', cls.includes('ok'), cls);
      check('popup (up): shows 已连接 Obsidian', text.includes('已连接 Obsidian'), text);
      await popupPage.close();
    }

    await stopMock(mock);
    mock = null;

    // ── 5. err500 mode: httpPost error mapping surfaces server reason ─────────
    mock = await startMock('err500');
    await page.reload();
    await page.waitForTimeout(1000);
    await page.click('#btn-test-clip');
    await page.waitForTimeout(600);
    {
      const resultText = await page.textContent('#test-result');
      check(
        'test-clip (err500): surfaces "保存失败：Error: mock disk full"',
        resultText.includes('保存失败：Error: mock disk full'),
        resultText,
      );
    }
    await stopMock(mock);
    mock = null;

    // ── 6. mock DOWN entirely: popup red/未连接 + CONNECT_FAIL_MSG on test-clip ─
    {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      await popupPage.waitForTimeout(600);
      const cls = await popupPage.getAttribute('#conn-status', 'class');
      const text = await popupPage.textContent('#conn-text');
      check('popup (down): bad class', cls.includes('bad'), cls);
      check('popup (down): shows 未连接', text.includes('未连接'), text);
      await popupPage.close();
    }
    await page.reload();
    await page.waitForTimeout(1000);
    // test-clip-block is display:none while disconnected, so click the button
    // directly via evaluate (bypasses Playwright's actionability/visibility check,
    // which is appropriate here — we're testing the underlying handler's error
    // mapping, not the block's hidden-while-disconnected visibility, already
    // covered by check #1 above).
    await page.evaluate(() => document.getElementById('btn-test-clip').click());
    await page.waitForTimeout(600);
    {
      const resultText = await page.textContent('#test-result');
      const CONNECT_FAIL_MSG =
        '没连上 Obsidian：请确认 Obsidian 开着、vault-autopilot 插件已启用。打开扩展弹窗底部「安装说明 / 帮助」可查看排查步骤。';
      check(
        'test-clip (down): surfaces exact CONNECT_FAIL_MSG',
        resultText.includes(CONNECT_FAIL_MSG),
        resultText,
      );
    }
  } catch (e) {
    check('unexpected exception during run', false, e.stack || e.message);
  } finally {
    await stopMock(mock);
    if (context) await context.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
