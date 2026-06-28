// content.js — Screenshot Clipper selection overlay
// Always present on every page (injected via manifest). Starts idle.
// Background sends {action:"showOverlay"} to activate.

(function () {
  // Register the message listener once per document. injectContentScript() clears
  // this flag before re-injecting, so a freshly injected script always re-binds.
  if (window.__SC_BOUND__) return;
  window.__SC_BOUND__ = true;

  let overlay, canvas, ctx, hint;
  let state = 'idle'; // 'idle' | 'selecting' | 'processing'
  let startX = 0, startY = 0, endX = 0, endY = 0;
  let pendingDataUrl = null; // screenshot held here until region is selected

  function show(dataUrl) {
    // Trust the DOM, not the flag: an SPA re-render can detach the overlay without
    // remove() running, leaving the flag stuck and blocking the next capture.
    if (overlay && overlay.isConnected) return;
    window.__SC_OVERLAY_ACTIVE__ = true;
    pendingDataUrl = dataUrl || null;

    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;user-select:none;';

    canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.cssText = 'position:absolute;inset:0;';
    ctx = canvas.getContext('2d');

    hint = document.createElement('div');
    hint.style.cssText =
      'position:absolute;bottom:16px;left:50%;transform:translateX(-50%);' +
      'background:rgba(0,0,0,.75);color:#fff;padding:6px 16px;border-radius:20px;' +
      'font:13px/1.6 system-ui,sans-serif;pointer-events:none;white-space:nowrap;';
    hint.textContent = '拖拽选择区域  ·  ESC 取消';

    overlay.append(canvas, hint);
    document.body.appendChild(overlay);

    // Initial dim
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey, true);
    state = 'idle';
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const x = Math.min(startX, endX), y = Math.min(startY, endY);
    const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
    if (w < 2 || h < 2) return;

    // Punch hole in dim for selection
    ctx.clearRect(x, y, w, h);
    // Selection border
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // Tint selection
    ctx.fillStyle = 'rgba(99,102,241,.12)';
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
    // Size label
    const label = `${Math.round(w)} × ${Math.round(h)}`;
    ctx.font = 'bold 11px monospace';
    const lw = ctx.measureText(label).width + 10;
    ctx.fillStyle = '#6366f1';
    ctx.fillRect(x, Math.max(0, y - 22), lw, 22);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 5, Math.max(15, y - 6));
  }

  function remove() {
    document.removeEventListener('keydown', onKey, true);
    if (overlay) overlay.remove();
    window.__SC_OVERLAY_ACTIVE__ = false;
    pendingDataUrl = null;
    state = 'idle';
  }

  function onDown(e) {
    if (state !== 'idle') return;
    e.preventDefault();
    state = 'selecting';
    startX = endX = e.clientX;
    startY = endY = e.clientY;
  }

  function onMove(e) {
    if (state !== 'selecting') return;
    endX = e.clientX; endY = e.clientY;
    draw();
  }

  function onUp(e) {
    if (state !== 'selecting') return;
    endX = e.clientX; endY = e.clientY;
    const x = Math.min(startX, endX), y = Math.min(startY, endY);
    const w = Math.abs(endX - startX), h = Math.abs(endY - startY);
    if (w < 10 || h < 10) { state = 'idle'; draw(); return; }

    state = 'processing';
    hint.textContent = '正在保存，请稍候…';

    // Safety: reset to idle if background never replies (crash / connection loss)
    const safetyTimer = setTimeout(() => {
      if (state === 'processing') {
        state = 'idle';
        hint.textContent = '✗ 超时，请重试';
        hint.style.background = 'rgba(239,68,68,.85)';
      }
    }, 120000);

    chrome.runtime.sendMessage({
      action: 'regionSelected',
      rect: { x, y, width: w, height: h },
      dpr: window.devicePixelRatio || 1,
      source_url: location.href,
      title: document.title,
      dataUrl: pendingDataUrl,  // pass screenshot back to background
    }, () => clearTimeout(safetyTimer));
  }

  function onKey(e) {
    if (e.key === 'Escape') remove();
  }

  // Listen for messages from background
  // ── Video detection & frame capture ──────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'showOverlay') { show(msg.dataUrl); return; }
    if (msg.action === 'cancelOverlay') { remove(); return; }
    // Top-level navigation to obsidian:// triggers Chrome's "Open Obsidian?"
    // dialog (same as Obsidian Web Clipper); the page itself stays put because
    // the OS handles the custom protocol. Used by hook/keyframe/batch success.
    if (msg.action === 'openObsidian') { if (msg.url) window.location.href = msg.url; return; }
    if (msg.action === 'captureResult') {
      if (!hint) return;
      if (msg.success) {
        if (msg.obsidianUrl) window.location.href = msg.obsidianUrl;
        hint.textContent = '✓ 已保存到 Obsidian';
        hint.style.background = 'rgba(34,197,94,.9)';
        setTimeout(remove, 2000);
      } else {
        hint.textContent = '✗ ' + (msg.error || '保存失败，请重试');
        hint.style.background = 'rgba(239,68,68,.85)';
        state = 'idle'; // allow retry drag
      }
      return;
    }

    if (msg.action === 'detectVideo') {
      const video = document.querySelector('video');
      const hasCover = !!document.querySelector(
        'meta[property="og:image"], meta[name="og:image"], meta[name="twitter:image"]'
      );
      sendResponse({ hasVideo: !!video && video.readyState >= 1, hasCover });
      return true;
    }

    if (msg.action === 'getCurrentTime') {
      const video = document.querySelector('video');
      sendResponse({ currentTime: video ? video.currentTime : null });
      return true;
    }

    if (msg.action === 'captureVideoFrames') {
      captureFrames(msg.timestamps).then(
        frames => sendResponse({ frames }),
        err => sendResponse({ error: err.message }),
      );
      return true;
    }

    if (msg.action === 'getVideoMeta') {
      sendResponse(extractVideoMeta());
      return true;
    }

  });

  // Capture candidate frames at `timestamps`, drop blank/near-black ones and
  // near-duplicates, and return the remaining candidates. The plugin (AI selector
  // or a heuristic) picks the final few from these.
  async function captureFrames(timestamps) {
    const video = document.querySelector('video');
    if (!video) throw new Error('No video element found');

    const originalTime = video.currentTime;
    const wasPaused = video.paused;
    if (!wasPaused) video.pause();

    const w = video.videoWidth || 1280, h = video.videoHeight || 720;
    const full = document.createElement('canvas'); full.width = w; full.height = h;
    const fctx = full.getContext('2d');
    const SW = 32, SH = 18;                          // tiny canvas just for scoring
    const small = document.createElement('canvas'); small.width = SW; small.height = SH;
    const sctx = small.getContext('2d');

    const cands = [];
    try {
      for (const t of timestamps) {
        await seekTo(video, t);
        try {
          fctx.drawImage(video, 0, 0, w, h);
          sctx.drawImage(video, 0, 0, SW, SH);
        } catch (e) {
          throw new Error('此视频不支持帧捕获');
        }
        const px = sctx.getImageData(0, 0, SW, SH).data;
        const luma = new Float32Array(SW * SH);
        let sum = 0;
        for (let i = 0; i < luma.length; i++) {
          const l = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
          luma[i] = l; sum += l;
        }
        const mean = sum / luma.length;
        let variance = 0;
        for (let i = 0; i < luma.length; i++) variance += (luma[i] - mean) ** 2;
        variance /= luma.length;
        cands.push({ t, mean, variance, luma, data: full.toDataURL('image/jpeg', 0.85).split(',')[1] });
      }
    } finally {
      try { await seekTo(video, originalTime); } catch (_) {}
      if (!wasPaused) video.play();
    }

    // Drop blank-ish frames (near black/white, or near-uniform color).
    const useful = cands.filter(c => c.mean > 16 && c.mean < 245 && c.variance > 40);
    const pool = useful.length ? useful : cands;
    // Drop near-duplicates so candidates are visually distinct (cap the count).
    const kept = [];
    for (const c of pool) {
      if (kept.length < 12 && kept.every(k => sigDiff(c.luma, k.luma) > 16)) kept.push(c);
    }
    return (kept.length ? kept : pool).map(c => c.data);
  }

  function sigDiff(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
  }

  function seekTo(video, time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.05) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('Seek timeout')), 5000);
      video.onseeked = () => { clearTimeout(timeout); video.onseeked = null; resolve(); };
      video.currentTime = time;
    });
  }

  function extractVideoMeta() {
    const ytTitle = document.querySelector('h1.ytd-video-primary-info-renderer')?.textContent?.trim()
      || document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent?.trim();
    const ytChannel = document.querySelector('ytd-channel-name yt-formatted-string a')?.textContent?.trim();

    const biliTitle = document.querySelector('.video-title')?.textContent?.trim()
      || document.querySelector('h1.video-title')?.textContent?.trim();
    const biliChannel = document.querySelector('.up-name')?.textContent?.trim()
      || document.querySelector('.username')?.textContent?.trim();

    return {
      videoTitle: ytTitle || biliTitle || document.title,
      channel: ytChannel || biliChannel || null,
    };
  }
})();
