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
    hint.textContent = chrome.i18n.getMessage('ct_drag_hint');

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
    hint.textContent = chrome.i18n.getMessage('ct_saving');

    // Safety: reset to idle if background never replies (crash / connection loss)
    const safetyTimer = setTimeout(() => {
      if (state === 'processing') {
        state = 'idle';
        hint.textContent = chrome.i18n.getMessage('ct_timeout');
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
  // Remove any listener left by a previous injection so a re-inject never doubles
  // up handlers (which made captures run twice → "select again" / Seek timeout).
  // Top-right "saved to Notion" toast: the jump is a link the user can
  // take or ignore. One toast at a time; rapid captures refresh it.
  function showNotionToast(url) {
    document.getElementById('ovc-notion-toast')?.remove();
    const box = document.createElement('div');
    box.id = 'ovc-notion-toast';
    box.style.cssText = 'position:fixed;right:16px;top:16px;z-index:2147483647;background:rgba(17,24,39,.92);color:#fff;padding:10px 14px;border-radius:10px;font:13px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center;';
    const label = document.createElement('span');
    label.textContent = chrome.i18n.getMessage('ct_saved_notion');
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = chrome.i18n.getMessage('ct_open_notion');
    link.style.cssText = 'color:#8ab4ff;text-decoration:none;font-weight:600;white-space:nowrap;';
    link.addEventListener('click', () => box.remove());
    box.append(label, link);
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 8000);
  }

  if (window.__SC_MSG_LISTENER__) { try { chrome.runtime.onMessage.removeListener(window.__SC_MSG_LISTENER__); } catch (_) {} }
  const __scMsgListener = (msg, _sender, sendResponse) => {
    if (msg.action === 'showOverlay') { show(msg.dataUrl); sendResponse({ ok: true }); return; }
    if (msg.action === 'cancelOverlay') { remove(); sendResponse({ ok: true }); return; }
    // Top-level navigation to obsidian:// triggers Chrome's "Open Obsidian?"
    // dialog (same as Obsidian Web Clipper); the page itself stays put because
    // the OS handles the custom protocol. Used by hook/keyframe/batch success.
    if (msg.action === 'openObsidian') { sendResponse({ ok: true }); if (msg.url) window.location.href = msg.url; return; }
    // Notion saves stay on the page: a small toast offers the jump as a link
    // the user can take or ignore (auto-opening tabs piled up duplicates).
    if (msg.action === 'notionSaved') { sendResponse({ ok: true }); if (msg.url) showNotionToast(msg.url); return; }
    if (msg.action === 'captureResult') {
      sendResponse({ ok: true });
      if (!hint) return;
      if (msg.success) {
        if (msg.obsidianUrl) window.location.href = msg.obsidianUrl;
        // Batch shots are queued, not saved — say so instead of naming a destination.
        hint.textContent = msg.queued
          ? chrome.i18n.getMessage('ct_queued', [String(msg.queued)])
          : chrome.i18n.getMessage(msg.notionUrl ? 'ct_saved_notion' : 'ct_saved');
        hint.style.background = 'rgba(34,197,94,.9)';
        setTimeout(remove, 2000);
      } else {
        hint.textContent = '✗ ' + (msg.error || chrome.i18n.getMessage('ct_save_failed'));
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
      console.log('[SC] content: captureVideoFrames received — starting capture');
      // Keep the background worker awake during capture + picker so its message
      // port can't close (a closed port made it retry → double-capture → Seek timeout).
      let keep = null, keepPing = null;
      try { keep = chrome.runtime.connect({ name: 'sc-keepalive' }); } catch (_) {}
      if (keep) keepPing = setInterval(() => { try { keep.postMessage({ t: Date.now() }); } catch (_) {} }, 20000);
      const respond = (resp) => {
        if (keepPing) clearInterval(keepPing);
        if (keep) { try { keep.disconnect(); } catch (_) {} }
        sendResponse(resp);
      };
      captureFrames(msg.timestamps, msg.minDiff).then(
        async ({ all, settled }) => {
          console.log('[SC] content: captured', settled.length, 'settled /', all.length, 'total — opening picker');
          // keyframe mode gets the 定格/全程 toggle (full arc); hook keeps the plain picker.
          const picked = msg.picker === 'toggle'
            ? await showFramePicker(settled, all)
            : await showFramePicker(settled);
          console.log('[SC] content: picker', picked ? `saved ${picked.length}` : 'cancelled', '— sending response');
          respond(picked ? { frames: picked } : { cancelled: true });
        },
        err => { console.warn('[SC] content: capture FAILED', err.message); respond({ error: err.message }); },
      );
      return true;
    }

    if (msg.action === 'getVideoMeta') {
      sendResponse(extractVideoMeta());
      return true;
    }

  };
  window.__SC_MSG_LISTENER__ = __scMsgListener;
  chrome.runtime.onMessage.addListener(__scMsgListener);

  // Capture candidate frames at `timestamps`, drop blank/near-black ones and
  // near-duplicates (frames closer than `minDiff` are treated as the same shot),
  // and return the remaining candidates for the picker. Lower minDiff = keep more.
  async function captureFrames(timestamps, minDiff = 16) {
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
        try { await seekTo(video, t); } catch (_) { continue; } // skip points that won't seek (buffering / ad)
        try {
          fctx.drawImage(video, 0, 0, w, h);
          sctx.drawImage(video, 0, 0, SW, SH);
        } catch (e) {
          throw new Error(chrome.i18n.getMessage('ct_no_frame_capture'));
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

    if (cands.length === 0) throw new Error(chrome.i18n.getMessage('ct_video_not_ready'));

    // Drop blank-ish frames (near black/white, or near-uniform color).
    const useful = cands.filter(c => c.mean > 16 && c.mean < 245 && c.variance > 40);
    const pool = useful.length ? useful : cands;
    // Drop near-duplicates so candidates are visually distinct (cap the count).
    // Scan latest→earliest so each cluster of similar frames keeps its LAST frame
    // (the settled shot where an animation/effect has finished) rather than the
    // first; then restore chronological order for display.
    const kept = [];
    for (let i = pool.length - 1; i >= 0; i--) {
      const c = pool[i];
      if (kept.length < 16 && kept.every(k => sigDiff(c.luma, k.luma) > minDiff)) kept.push(c);
    }
    kept.sort((a, b) => a.t - b.t);
    // Two sets for the picker: `settled` = one frame per distinct shot/effect
    // (定格), `all` = every sampled frame with blanks removed (全程 — preserves an
    // animation's full arc, including its opening, which `settled` collapses away).
    return {
      all: pool.map(c => c.data),
      settled: (kept.length ? kept : pool).map(c => c.data),
    };
  }

  // Show the candidate frames; user deselects the ones they don't want. Resolves
  // with the kept frames (base64[]), or null if cancelled. Only kept frames are
  // ever sent on to be saved — nothing unwanted touches the vault.
  // settledFrames = 定格 set (one frame per shot). allFrames (optional) = 全程 set
  // (every sampled frame, full arc); when supplied and larger, a 定格/全程 toggle
  // lets the user switch which set the grid shows. Resolves with the kept frames
  // (base64[]), or null if cancelled — only kept frames are ever sent on to save.
  function showFramePicker(settledFrames, allFrames) {
    return new Promise(resolve => {
      if (!settledFrames || settledFrames.length === 0) { resolve(settledFrames || []); return; }
      const hasToggle = Array.isArray(allFrames) && allFrames.length > settledFrames.length;
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;';
      const panel = document.createElement('div');
      panel.style.cssText = 'background:#1e1e1f;color:#fff;border-radius:12px;padding:20px;width:min(880px,92vw);max-height:90vh;overflow:auto;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px;';
      const title = document.createElement('div');
      title.textContent = chrome.i18n.getMessage('ct_picker_title');
      title.style.cssText = 'font-size:15px;font-weight:600;';
      head.appendChild(title);

      const bar = document.createElement('div');
      bar.style.cssText = 'margin-top:16px;display:flex;justify-content:flex-end;gap:10px;';
      const cancel = document.createElement('button');
      cancel.textContent = chrome.i18n.getMessage('ct_picker_cancel');
      cancel.style.cssText = 'padding:9px 18px;border-radius:8px;border:1px solid #555;background:transparent;color:#fff;cursor:pointer;font-size:14px;';
      const save = document.createElement('button');
      save.style.cssText = 'padding:9px 18px;border-radius:8px;border:none;background:#4f8cff;color:#fff;cursor:pointer;font-size:14px;';
      const finish = (result) => { ov.remove(); resolve(result); };
      cancel.onclick = () => finish(null);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:10px;';

      // Current frame set + its selection. render() rebuilds the grid; on every
      // (re)build all frames start selected, so toggling resets to "keep all".
      let frames = settledFrames;
      let selected = new Set();
      const render = () => {
        grid.innerHTML = '';
        selected = new Set(frames.map((_, i) => i));
        frames.forEach((f, i) => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:relative;cursor:pointer;border:3px solid #4f8cff;border-radius:8px;overflow:hidden;line-height:0;transition:opacity .1s;';
          const img = document.createElement('img');
          img.src = 'data:image/jpeg;base64,' + f;
          img.style.cssText = 'width:100%;display:block;';
          const tick = document.createElement('div');
          tick.textContent = '✓';
          tick.style.cssText = 'position:absolute;top:5px;right:6px;background:#4f8cff;color:#fff;border-radius:50%;width:22px;height:22px;text-align:center;line-height:22px;font-size:13px;';
          wrap.appendChild(img); wrap.appendChild(tick);
          wrap.onclick = () => {
            if (selected.has(i)) { selected.delete(i); wrap.style.borderColor = 'transparent'; wrap.style.opacity = '.35'; tick.style.display = 'none'; }
            else { selected.add(i); wrap.style.borderColor = '#4f8cff'; wrap.style.opacity = '1'; tick.style.display = 'block'; }
            save.textContent = chrome.i18n.getMessage('ct_picker_save', [String(selected.size)]);
            save.disabled = selected.size === 0;
          };
          grid.appendChild(wrap);
        });
        save.textContent = chrome.i18n.getMessage('ct_picker_save', [String(selected.size)]);
        save.disabled = selected.size === 0;
      };

      if (hasToggle) {
        const seg = document.createElement('div');
        seg.style.cssText = 'display:flex;border:1px solid #4f8cff;border-radius:8px;overflow:hidden;font-size:13px;flex:none;';
        const bSettled = document.createElement('button');
        const bAll = document.createElement('button');
        bSettled.textContent = chrome.i18n.getMessage('ct_picker_settled');
        bAll.textContent = chrome.i18n.getMessage('ct_picker_all');
        for (const b of [bSettled, bAll]) b.style.cssText = 'padding:6px 16px;border:none;background:transparent;color:#9ab;cursor:pointer;';
        const paint = () => {
          const on = frames === settledFrames;
          bSettled.style.background = on ? '#4f8cff' : 'transparent';  bSettled.style.color = on ? '#fff' : '#9ab';
          bAll.style.background = on ? 'transparent' : '#4f8cff';      bAll.style.color = on ? '#9ab' : '#fff';
        };
        bSettled.onclick = () => { if (frames !== settledFrames) { frames = settledFrames; paint(); render(); } };
        bAll.onclick = () => { if (frames !== allFrames) { frames = allFrames; paint(); render(); } };
        seg.appendChild(bSettled); seg.appendChild(bAll);
        head.appendChild(seg);
        paint();
      }

      save.onclick = () => finish(frames.filter((_, i) => selected.has(i)));
      bar.appendChild(cancel); bar.appendChild(save);
      panel.appendChild(head); panel.appendChild(grid); panel.appendChild(bar);
      ov.appendChild(panel);
      // Mount inside the fullscreen element when one is active — anything appended
      // to body is invisible while the player holds fullscreen (user had to ESC out
      // to see the picker). position:fixed still covers the viewport either way.
      (document.fullscreenElement || document.body).appendChild(ov);
      render();
    });
  }

  function sigDiff(a, b) {
    let d = 0;
    for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
    return d / a.length;
  }

  function seekTo(video, time) {
    return new Promise((resolve, reject) => {
      if (Math.abs(video.currentTime - time) < 0.05) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('Seek timeout')), 8000);
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
