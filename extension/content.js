// content.js — Screenshot Clipper selection overlay
// Always present on every page (injected via manifest). Starts idle.
// Background sends {action:"showOverlay"} to activate.

(function () {
  // Guard: only one overlay at a time
  if (window.__SC_OVERLAY_ACTIVE__) return;

  let overlay, canvas, ctx, hint;
  let state = 'idle'; // 'idle' | 'selecting' | 'processing'
  let startX = 0, startY = 0, endX = 0, endY = 0;
  let pendingDataUrl = null; // screenshot held here until region is selected

  function show(dataUrl) {
    if (window.__SC_OVERLAY_ACTIVE__) return;
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
    if (!window.__SC_OVERLAY_ACTIVE__) return;
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
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
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'showOverlay') { show(msg.dataUrl); return; }
    if (msg.action === 'cancelOverlay') { remove(); return; }
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
    }
  });
})();
