#!/usr/bin/env node
// mock-autopilot.mjs — zero-dependency mock of the vault-autopilot HTTP contract.
//
// The real vault-autopilot plugin runs an HTTP server inside Obsidian on
// 127.0.0.1:17183. This mock implements just enough of that contract to smoke-
// test the Chrome extension's onboarding chain (welcome page, popup, test clip)
// without Obsidian.
//
// Usage:
//   node scripts/mock-autopilot.mjs                 # MOCK_MODE=ok (default)
//   MOCK_MODE=err500 node scripts/mock-autopilot.mjs
//
// Modes:
//   ok      GET /ping  -> 200 {"app":"vault-autopilot","version":"mock"}
//           POST /clip -> 200 {"success":true,"obsidianUrl":"obsidian://open?vault=Mock&file=Clips%2FScreenshots%2Ftest.md"}
//   err500  GET /ping  -> 200 (still connected, so the test-clip UI is reachable)
//           POST /clip -> 500 {"success":false,"error":"Error: mock disk full"}
//
// "Server down" is not a mode — for that test case, simply don't run this script.
//
// CORS: echoes back any chrome-extension:// Origin and allows GET/POST/OPTIONS,
// matching what a Chrome extension page needs for cross-origin fetch.

import http from 'node:http';

const PORT = 17183;
const HOST = '127.0.0.1';
const MODE = process.env.MOCK_MODE || 'ok';

if (!['ok', 'err500'].includes(MODE)) {
  console.error(`[mock-autopilot] unknown MOCK_MODE "${MODE}" (expected ok|err500)`);
  process.exit(1);
}

const OBSIDIAN_URL = 'obsidian://open?vault=Mock&file=Clips%2FScreenshots%2Ftest.md';

function corsHeaders(req) {
  const origin = req.headers.origin;
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  // Echo back extension origins (and any origin, for test harness convenience).
  if (origin && origin.startsWith('chrome-extension://')) h['Access-Control-Allow-Origin'] = origin;
  else if (origin) h['Access-Control-Allow-Origin'] = origin;
  else h['Access-Control-Allow-Origin'] = '*';
  return h;
}

function sendJson(req, res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...corsHeaders(req) });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/ping') {
    sendJson(req, res, 200, { app: 'vault-autopilot', version: 'mock' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/clip') {
    // Drain the body so the client isn't left hanging, then reply per mode.
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (MODE === 'err500') {
        sendJson(req, res, 500, { success: false, error: 'Error: mock disk full' });
      } else {
        sendJson(req, res, 200, { success: true, obsidianUrl: OBSIDIAN_URL });
      }
    });
    return;
  }

  sendJson(req, res, 404, { success: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-autopilot] listening on http://${HOST}:${PORT} (MOCK_MODE=${MODE})`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
