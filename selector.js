'use strict';

/**
 * selector.js — Overlay de seleção de região na tela
 *
 * Injetado via chrome.scripting.executeScript() pelo service worker.
 * Cria um overlay fullscreen sobre a página onde o usuário pode arrastar
 * um retângulo para definir a região que deseja submeter ao OCR.
 *
 * Ao confirmar (mouseup), envia SELECTION_DONE ao service worker com:
 *   rect: { x, y, w, h }  — coordenadas CSS pixels (relativas ao viewport)
 *   dpr : devicePixelRatio — para o SW converter para pixels físicos ao recortar
 *
 * Esc envia SELECTION_CANCELLED e remove o overlay.
 */

(function () {
  'use strict';

  // Evitar dupla injeção
  if (document.getElementById('__ocr_selector__')) return;

  // ── Estado interno ────────────────────────────────────────────────────────

  let isDrawing = false;
  let startX = 0, startY = 0, endX = 0, endY = 0;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ── Overlay principal ─────────────────────────────────────────────────────

  const overlay = document.createElement('div');
  overlay.id = '__ocr_selector__';

  // Posição fixed para cobrir o viewport mesmo com scroll
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100vw',
    'height:100vh',
    'z-index:2147483646',
    'cursor:crosshair',
    'user-select:none',
    '-webkit-user-select:none',
  ].join(';');

  // ── SVG para a máscara escura + retângulo de seleção ─────────────────────

  const NS  = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('xmlns', NS);
  svg.setAttribute('width',  '100%');
  svg.setAttribute('height', '100%');
  svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible';

  // Definição do clip path: buraco (transparente) na área selecionada.
  // A máscara cobre tudo de escuro exceto o retângulo de seleção.
  const defs    = document.createElementNS(NS, 'defs');
  const clipId  = '__ocr_clip__';

  const clipPath = document.createElementNS(NS, 'clipPath');
  clipPath.setAttribute('id', clipId);

  // Retângulo externo (toda a tela) com regra "evenodd" cria o buraco
  const clipFull = document.createElementNS(NS, 'rect');
  clipFull.setAttribute('x', '0');
  clipFull.setAttribute('y', '0');
  clipFull.setAttribute('width',  vw);
  clipFull.setAttribute('height', vh);

  const clipHole = document.createElementNS(NS, 'rect');  // atualizado no drag
  clipPath.appendChild(clipFull);
  clipPath.appendChild(clipHole);
  defs.appendChild(clipPath);
  svg.appendChild(defs);

  // Camada escura que cobre a tela (exceto seleção) — usando clipPath evenodd
  const darkMask = document.createElementNS(NS, 'rect');
  darkMask.setAttribute('x', '0');
  darkMask.setAttribute('y', '0');
  darkMask.setAttribute('width',  vw);
  darkMask.setAttribute('height', vh);
  darkMask.setAttribute('fill',   'rgba(0,0,0,0.45)');
  // Sem clipPath no início — a tela inteira é escurecida

  // Retângulo de seleção (contorno azul)
  const selRect = document.createElementNS(NS, 'rect');
  selRect.setAttribute('fill',            'rgba(0,122,255,0.08)');
  selRect.setAttribute('stroke',          '#007AFF');
  selRect.setAttribute('stroke-width',    '2');
  selRect.setAttribute('stroke-dasharray','8 4');
  selRect.setAttribute('rx',              '2');

  // 4 retângulos de máscara (mais simples e confiável que clipPath evenodd)
  const mkTop  = makeMaskRect();
  const mkBot  = makeMaskRect();
  const mkLeft = makeMaskRect();
  const mkRight= makeMaskRect();

  svg.appendChild(darkMask);
  svg.appendChild(mkTop);
  svg.appendChild(mkBot);
  svg.appendChild(mkLeft);
  svg.appendChild(mkRight);
  svg.appendChild(selRect);
  overlay.appendChild(svg);

  // ── Tooltip de instrução ──────────────────────────────────────────────────

  const tip = document.createElement('div');
  tip.id = '__ocr_tip__';
  tip.style.cssText = [
    'position:fixed',
    'top:18px',
    'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(0,0,0,0.85)',
    'color:#fff',
    'padding:9px 20px',
    'border-radius:9px',
    'font:500 13px/-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'letter-spacing:0.2px',
    'white-space:nowrap',
    'pointer-events:none',
    'z-index:2147483647',
    'box-shadow:0 4px 16px rgba(0,0,0,0.35)',
    'transition:opacity 0.15s',
  ].join(';');
  tip.innerHTML = '✂&nbsp; Arraste para selecionar a área &nbsp;·&nbsp; <span style="opacity:0.65">Esc para cancelar</span>';

  // Indicador de dimensões (aparece durante o drag)
  const sizeLabel = document.createElement('div');
  sizeLabel.style.cssText = [
    'position:fixed',
    'background:rgba(0,0,0,0.75)',
    'color:#fff',
    'padding:3px 8px',
    'border-radius:4px',
    'font:12px/1.4 monospace',
    'pointer-events:none',
    'z-index:2147483647',
    'display:none',
  ].join(';');

  // ── Montar no DOM ─────────────────────────────────────────────────────────

  // Usar documentElement para suportar páginas sem <body> acessível
  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(tip);
  document.documentElement.appendChild(sizeLabel);

  // ── Funções auxiliares ────────────────────────────────────────────────────

  function makeMaskRect() {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('fill', 'rgba(0,0,0,0.45)');
    return r;
  }

  /** Atualiza as 4 máscaras ao redor do retângulo de seleção. */
  function updateMasks(x, y, w, h) {
    // Esconder máscara "global" quando já temos as 4 partes
    darkMask.setAttribute('fill', 'none');

    // Topo
    setRect(mkTop,   0,     0,     vw,       y);
    // Esquerda (linha do meio)
    setRect(mkLeft,  0,     y,     x,        h);
    // Direita (linha do meio)
    setRect(mkRight, x + w, y,     vw-x-w,   h);
    // Base
    setRect(mkBot,   0,     y + h, vw,       vh - y - h);
  }

  function setRect(el, x, y, w, h) {
    el.setAttribute('x',      Math.max(0, x));
    el.setAttribute('y',      Math.max(0, y));
    el.setAttribute('width',  Math.max(0, w));
    el.setAttribute('height', Math.max(0, h));
  }

  /** Atualiza o retângulo de seleção e a label de dimensões. */
  function updateSelection() {
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    selRect.setAttribute('x',      x);
    selRect.setAttribute('y',      y);
    selRect.setAttribute('width',  w);
    selRect.setAttribute('height', h);

    updateMasks(x, y, w, h);

    // Atualizar label de dimensões
    if (w > 20 && h > 20) {
      sizeLabel.style.display  = 'block';
      sizeLabel.textContent    = `${Math.round(w)} × ${Math.round(h)} px`;
      // Posicionar abaixo-direita da seleção (com padding de segurança)
      const lx = Math.min(endX + 6, vw - 90);
      const ly = Math.min(endY + 6, vh - 30);
      sizeLabel.style.left = `${lx}px`;
      sizeLabel.style.top  = `${ly}px`;
    }
  }

  // ── Eventos do mouse ──────────────────────────────────────────────────────

  overlay.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    isDrawing = true;
    startX = endX = e.clientX;
    startY = endY = e.clientY;

    // Resetar seleção anterior
    selRect.setAttribute('width',  '0');
    selRect.setAttribute('height', '0');
    darkMask.setAttribute('fill', 'rgba(0,0,0,0.45)');
    [mkTop, mkBot, mkLeft, mkRight].forEach(r => r.setAttribute('fill', 'none'));
  }, true);

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    endX = e.clientX;
    endY = e.clientY;
    updateSelection();
  }, true);

  overlay.addEventListener('mouseup', (e) => {
    if (!isDrawing || e.button !== 0) return;
    isDrawing = false;

    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);

    if (w < 8 || h < 8) {
      // Clique simples ou seleção muito pequena — reiniciar
      selRect.setAttribute('width',  '0');
      selRect.setAttribute('height', '0');
      darkMask.setAttribute('fill', 'rgba(0,0,0,0.45)');
      [mkTop, mkBot, mkLeft, mkRight].forEach(r => r.setAttribute('fill', 'none'));
      sizeLabel.style.display = 'none';
      return;
    }

    cleanup();

    chrome.runtime.sendMessage({
      type: 'SELECTION_DONE',
      rect: { x, y, w, h },
      dpr:  window.devicePixelRatio || 1,
    });
  }, true);

  // ── Cancelar com Esc ──────────────────────────────────────────────────────

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
      chrome.runtime.sendMessage({ type: 'SELECTION_CANCELLED' });
    }
  }

  document.addEventListener('keydown', onKeyDown, { capture: true });

  // ── Limpeza geral ─────────────────────────────────────────────────────────

  function cleanup() {
    overlay.remove();
    tip.remove();
    sizeLabel.remove();
    document.removeEventListener('keydown', onKeyDown, { capture: true });
  }

})();
