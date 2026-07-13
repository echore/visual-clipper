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

// Locale-independent assertion helper: resolve the expected string inside the
// extension page itself, so checks pass under any browser UI language.
const msg = (page, key, subs = []) =>
  page.evaluate(([k, s]) => chrome.i18n.getMessage(k, s), [key, subs]);

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
      locale: 'zh-CN', // TODO(Task 8): remove once popup.js is localized (Task 6)
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--lang=zh-CN', // TODO(Task 8): remove once popup.js is localized (Task 6)
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
      const tryItVisible = await page.isVisible('#try-it');
      const dlHref = await page.getAttribute('#btn-download-zip', 'href');
      check('welcome (down): red state class', cls.includes('bad'), cls);
      check('welcome (down): disconnected copy', status === await msg(page, 'welcome_conn_bad'), status);
      check('welcome (down): install guide visible', installGuideVisible);
      check('welcome (down): try-it hidden', !tryItVisible);
      check('welcome (down): zip download href',
        dlHref === 'https://github.com/echore/vault-autopilot/releases/latest/download/vault-autopilot.zip', dlHref);
    }

    // ── 2. welcome.html: mock UP (ok) -> green/connected + try-it visible ─────
    mock = await startMock('ok');
    await page.reload();
    await page.waitForTimeout(1000);
    {
      const cls = await page.getAttribute('#conn-check', 'class');
      const status = await page.textContent('#conn-status');
      const installGuideVisible = await page.isVisible('#install-guide');
      const tryItVisible = await page.isVisible('#try-it');
      const tryHref = await page.getAttribute('#tryit-link', 'href');
      const uiLang = await page.evaluate(() => chrome.i18n.getUILanguage());
      const expectedHref = await msg(page, 'welcome_tryit_url');
      check('welcome (up): green state class', cls.includes('ok'), cls);
      check('welcome (up): connected copy + version',
        status === await msg(page, 'welcome_conn_ok', ['mock']), status);
      check('welcome (up): install guide hidden', !installGuideVisible);
      check('welcome (up): try-it visible', tryItVisible);
      check('welcome (up): try-it link matches locale catalog', tryHref === expectedHref, `${uiLang} → ${tryHref}`);
      check('welcome (up): try-it link is youtube or bilibili',
        /youtube\.com|bilibili\.com/.test(tryHref), tryHref);
    }

    // ── 4. popup.html: mock UP -> green dot + connected copy ──────────────────
    {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      await popupPage.waitForTimeout(600);
      const cls = await popupPage.getAttribute('#conn-status', 'class');
      const text = await popupPage.textContent('#conn-text');
      check('popup (up): ok class', cls.includes('ok'), cls);
      check('popup (up): shows connected copy', text === await msg(popupPage, 'popup_conn_ok'), text);
      await popupPage.close();
    }

    await stopMock(mock);
    mock = null;

    // ── 6. mock DOWN entirely: popup red/disconnected ──────────────────────────
    {
      const popupPage = await context.newPage();
      await popupPage.goto(`chrome-extension://${extId}/popup.html`);
      await popupPage.waitForTimeout(600);
      const cls = await popupPage.getAttribute('#conn-status', 'class');
      const text = await popupPage.textContent('#conn-text');
      check('popup (down): bad class', cls.includes('bad'), cls);
      check('popup (down): shows disconnected copy', text === await msg(popupPage, 'popup_conn_bad'), text);
      await popupPage.close();
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
