#!/usr/bin/env node
// run-smoke.mjs — smoke-test the extension's onboarding chain against the
// mock-autopilot server, without Chrome. Drives the real extension modules
// (extension/modes/utils.js) under Node with a chrome.storage stub, across
// three server states: down / ok / err500. Also statically checks that
// welcome.js and popup.js only reference DOM ids that exist in their HTML
// and only import names utils.js actually exports.
//
// Usage: node smoke/run-smoke.mjs   (exits non-zero on any failure)

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// chrome.storage stub must exist before utils.js is imported.
const stored = {};
globalThis.chrome = {
  storage: { local: {
    get: async (key) => (key ? { [key]: stored[key] } : { ...stored }),
    set: async (obj) => { Object.assign(stored, obj); },
    remove: async (key) => { delete stored[key]; },
  } },
};

const utils = await import(join(ROOT, 'extension/modes/utils.js'));
const { DEFAULT_PORT, getPort, httpPost, pingAutopilot, CONNECT_FAIL_MSG } = utils;

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function startMock(mode) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [join(ROOT, 'scripts/mock-autopilot.mjs')], {
      env: { ...process.env, MOCK_MODE: mode },
      stdio: 'ignore',
    });
    const deadline = Date.now() + 3000;
    (async function poll() {
      try {
        const r = await fetch('http://127.0.0.1:17183/ping', { signal: AbortSignal.timeout(300) });
        if (r.ok) return resolve(child);
      } catch (_) { /* not up yet */ }
      if (Date.now() > deadline) { child.kill(); return reject(new Error(`mock (${mode}) never came up`)); }
      setTimeout(poll, 100);
    })();
  });
}
const stopMock = (child) => new Promise((r) => { child.on('exit', r); child.kill(); });

// ── getPort behavior ───────────────────────────────────────────────────────────
check('getPort default', (await getPort()) === DEFAULT_PORT && DEFAULT_PORT === 17183);
stored.sc_port = 27999;
check('getPort stored valid', (await getPort()) === 27999);
stored.sc_port = 80;
check('getPort invalid falls back', (await getPort()) === 17183);
delete stored.sc_port;

// ── Server down ────────────────────────────────────────────────────────────────
{
  const ping = await pingAutopilot();
  check('down: pingAutopilot disconnected', ping.connected === false);
  const err = await httpPost({ mode: 'screenshot' }).then(() => null, (e) => e);
  check('down: httpPost maps to CONNECT_FAIL_MSG', err !== null && err.message === CONNECT_FAIL_MSG);
}

// ── Server up (ok) ─────────────────────────────────────────────────────────────
{
  const mock = await startMock('ok');
  const ping = await pingAutopilot();
  check('ok: pingAutopilot connected + version', ping.connected === true && ping.version === 'mock');
  const resp = await httpPost({ mode: 'screenshot', images: [], url: 'https://example.com', title: 'smoke' });
  check('ok: httpPost returns obsidianUrl', resp.success === true && String(resp.obsidianUrl).startsWith('obsidian://open?vault=Mock'));
  await stopMock(mock);
}

// ── Server up (err500) ─────────────────────────────────────────────────────────
{
  const mock = await startMock('err500');
  const err = await httpPost({ mode: 'screenshot' }).then(() => null, (e) => e);
  check('err500: httpPost surfaces server reason', err !== null && err.message === '保存失败：Error: mock disk full');
  await stopMock(mock);
}

// ── Static checks: DOM ids and imports ─────────────────────────────────────────
for (const [js, html] of [['extension/welcome.js', 'extension/welcome.html'], ['extension/popup.js', 'extension/popup.html']]) {
  const jsSrc = readFileSync(join(ROOT, js), 'utf8');
  const htmlSrc = readFileSync(join(ROOT, html), 'utf8');
  const ids = [...jsSrc.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  const missing = ids.filter((id) => !htmlSrc.includes(`id="${id}"`));
  check(`${js}: all ${ids.length} referenced DOM ids exist in ${html}`, missing.length === 0, missing.join(','));
  const imports = [...jsSrc.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]\.\/modes\/utils\.js['"]/g)]
    .flatMap((m) => m[1].split(',').map((s) => s.trim()).filter(Boolean));
  const bad = imports.filter((name) => !(name in utils));
  check(`${js}: all ${imports.length} utils.js imports exported`, bad.length === 0, bad.join(','));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
