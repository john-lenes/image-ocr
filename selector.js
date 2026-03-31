'use strict';

/**
 * selector.js — Overlay de seleção de região (SnapText OCR)
 *
 * Injetado via chrome.scripting.executeScript() pelo service worker.
 * Overlay fullscreen semi-transparente com buraco na área selecionada.
 * Esc → cancela. Mouseup com área válida → envia SELECTION_DONE.
 */

(function () {
  'use strict';

  if (document.getElementById('__snaptext_selector__')) return;

  // ── Estado ────────────────────────────────────────────────────────────────
  let isDrawing = false;
  let startX = 0, startY = 0, endX = 0, endY = 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const MIN_SIZE = 20; // px mínimos para considerar seleção válida

  // ── Container principal ───────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__snaptext_selector__';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'cursor:crosshair', 'user-select:none', '-webkit-user-select:none',
  ].join(';');

  // ── SVG: máscara escura + buraco na seleção ───────────────────────────────
  const NS  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none';

  const defs   = document.createElementNS(NS, 'defs');
  const mask   = document.createElementNS(NS, 'mask');
  mask.id = '__snaptext_mask__';

  // Fundo branco da máscara (escurece tudo)
  const maskBg = document.createElementNS(NS, 'rect');
  maskBg.setAttribute('x', '0'); maskBg.setAttribute('y', '0');
  maskBg.setAttribute('width', '100%'); maskBg.setAttribute('height', '100%');
  maskBg.setAttribute('fill', 'white');

  // Buraco preto = área que ficará transparente (a seleção)
  const maskHole = document.createElementNS(NS, 'rect');
  maskHole.setAttribute('fill', 'black');

  mask.appendChild(maskBg);
  mask.appendChild(maskHole);
  defs.appendChild(mask);
  svg.appendChild(defs);

  // Overlay escurecido (preto semi-transparente)
  const darkOverlay = document.createElementNS(NS, 'rect');
  darkOverlay.setAttribute('x', '0'); darkOverlay.setAttribute('y', '0');
  darkOverlay.setAttribute('width', '100%'); darkOverlay.setAttribute('height', '100%');
  darkOverlay.setAttribute('fill', 'rgba(0,0,0,0.55)');
  darkOverlay.setAttribute('mask', 'url(#__snaptext_mask__)');
  svg.appendChild(darkOverlay);

  // Borda azul da seleção
  const selBorder = document.createElementNS(NS, 'rect');
  selBorder.setAttribute('fill', 'none');
  selBorder.setAttribute('stroke', '#3b82f6');
  selBorder.setAttribute('stroke-width', '2');
  selBorder.setAttribute('rx', '2');
  selBorder.style.display = 'none';
  svg.appendChild(selBorder);

  // Cantos da seleção (4 L-shapes via polylines)
  const cornerSize = 12;
  const corners = ['tl','tr','bl','br'].map(() => {
    const pl = document.createElementNS(NS, 'polyline');
    pl.setAttribute('fill', 'none');
    pl.setAttribute('stroke', '#3b82f6');
    pl.setAttribute('stroke-width', '3');
    pl.setAttribute('stroke-linecap', 'round');
    pl.style.display = 'none';
    svg.appendChild(pl);
    return pl;
  });
  const [cTL, cTR, cBL, cBR] = corners;

  overlay.appendChild(svg);

  // ── Label de dimensões ────────────────────────────────────────────────────
  const sizeLabel = document.createElement('div');
  sizeLabel.style.cssText = [
    'position:absolute', 'pointer-events:none', 'display:none',
    'background:rgba(0,0,0,0.75)', 'color:#fff', 'font:bold 12px/1 monospace',
    'padding:3px 7px', 'border-radius:4px', 'white-space:nowrap',
    'box-shadow:0 1px 4px rgba(0,0,0,.5)',
  ].join(';');
  overlay.appendChild(sizeLabel);

  // ── Dica inicial ──────────────────────────────────────────────────────────
  const hint = document.createElement('div');
  hint.textContent = 'Arraste para selecionar a área · Esc para cancelar';
  hint.style.cssText = [
    'position:absolute', 'bottom:28px', 'left:50%', 'transform:translateX(-50%)',
    'background:rgba(0,0,0,0.72)', 'color:#fff',
    'font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif',
    'padding:9px 18px', 'border-radius:8px', 'pointer-events:none',
    'box-shadow:0 2px 8px rgba(0,0,0,.5)', 'white-space:nowrap',
    'letter-spacing:.01em',
  ].join(';');
  overlay.appendChild(hint);

  document.documentElement.appendChild(overlay);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function getRect() {
    const x = Math.round(Math.min(startX, endX));
    const y = Math.round(Math.min(startY, endY));
    const w = Math.round(Math.abs(endX - startX));
    const h = Math.round(Math.abs(endY - startY));
    return { x, y, w, h };
  }

  function updateSVG() {
    const { x, y, w, h } = getRect();

    // Buraco na máscara
    maskHole.setAttribute('x', x);  maskHole.setAttribute('y', y);
    maskHole.setAttribute('width', w); maskHole.setAttribute('height', h);

    // Borda
    selBorder.setAttribute('x', x); selBorder.setAttribute('y', y);
    selBorder.setAttribute('width', w); selBorder.setAttribute('height', h);
    selBorder.style.display = w > 0 && h > 0 ? '' : 'none';

    // Cantos
    const cs = cornerSize;
    cTL.setAttribute('points', `${x+cs},${y} ${x},${y} ${x},${y+cs}`);
    cTR.setAttribute('points', `${x+w-cs},${y} ${x+w},${y} ${x+w},${y+cs}`);
    cBL.setAttribute('points', `${x+cs},${y+h} ${x},${y+h} ${x},${y+h-cs}`);
    cBR.setAttribute('points', `${x+w-cs},${y+h} ${x+w},${y+h} ${x+w},${y+h-cs}`);
    corners.forEach(c => c.style.display = w > 0 && h > 0 ? '' : 'none');

    // Dimensão
    if (w > MIN_SIZE && h > MIN_SIZE) {
      sizeLabel.textContent = `${w} × ${h}`;
      const dpr = window.devicePixelRatio || 1;
      sizeLabel.title = `${Math.round(w*dpr)} × ${Math.round(h*dpr)} px reais`;

      // Posicionar o label sempre visível
      let lx = x + w + 6;
      let ly = y;
      if (lx + 80 > vw) lx = x - 78;
      if (ly + 22 > vh) ly = vh - 28;
      sizeLabel.style.left = lx + 'px';
      sizeLabel.style.top  = ly + 'px';
      sizeLabel.style.display = '';
    } else {
      sizeLabel.style.display = 'none';
    }
  }

  function cleanup() {
    overlay.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup',   onMouseUp);
    document.removeEventListener('keydown',   onKeyDown);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  // ── Eventos ───────────────────────────────────────────────────────────────
  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    isDrawing = true;
    startX = endX = e.clientX;
    startY = endY = e.clientY;
    hint.style.display = 'none';
    updateSVG();
  }

  function onMouseMove(e) {
    if (!isDrawing) return;
    endX = Math.min(Math.max(e.clientX, 0), vw);
    endY = Math.min(Math.max(e.clientY, 0), vh);
    updateSVG();
  }

  function onMouseUp(e) {
    if (!isDrawing) return;
    isDrawing = false;
    endX = Math.min(Math.max(e.clientX, 0), vw);
    endY = Math.min(Math.max(e.clientY, 0), vh);

    const rect = getRect();
    cleanup();

    if (rect.w < MIN_SIZE || rect.h < MIN_SIZE) {
      chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
      return;
    }

    chrome.runtime.sendMessage({
      type: 'SELECTION_DONE',
      rect,
      dpr: window.devicePixelRatio || 1,
    });
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cleanup();
      chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
    }
  }

  overlay.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup',   onMouseUp);
  document.addEventListener('keydown',   onKeyDown);

})();
