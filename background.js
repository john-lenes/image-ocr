'use strict';

/**
 * background.js — Service Worker (Manifest V3)
 *
 * Fluxo de seleção de região na tela:
 *  1. Popup envia START_CAPTURE com o tabId da aba ativa
 *  2. SW tira screenshot via captureVisibleTab()
 *  3. SW injeta selector.js na aba (overlay de seleção)
 *  4. Usuário arrasta um retângulo → selector.js envia SELECTION_DONE
 *  5. SW recorta a região com OffscreenCanvas
 *  6. SW armazena a imagem e abre o popup
 *  7. Popup executa OCR e exibe o resultado
 *
 * Estados em chrome.storage.local:
 *   ocrStatus    : 'idle' | 'selecting' | 'ready' | 'error'
 *   ocrImageData : string | null  (data URL da região recortada)
 *   ocrError     : string | null
 *   ocrTimestamp : number
 */

// ─── Estado efêmero do Service Worker ────────────────────────────────────────
// Armazenado em variável de módulo para não sobrecarregar chrome.storage com
// screenshots que podem passar de 5 MB.

let pendingScreenshot   = null;   // data URL JPEG do screenshot completo
let pendingCaptureTabId = null;   // aba onde o seletor está ativo

// ─── Handler de mensagens ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case 'START_CAPTURE': {
      handleStartCapture(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(e  => sendResponse({ ok: false, error: e.message }));
      return true; // manter canal aberto para resposta assíncrona
    }

    case 'CANCEL_CAPTURE': {
      handleCancelCapture(message.tabId)
        .then(() => sendResponse({ ok: true }))
        .catch(()  => sendResponse({ ok: false }));
      return true;
    }

    case 'SELECTION_DONE': {
      const { rect, dpr } = message;
      const tabId = sender.tab?.id ?? pendingCaptureTabId;
      handleSelectionDone(rect, dpr, tabId);
      return false;
    }

    case 'SELECTION_CANCELLED': {
      pendingScreenshot   = null;
      pendingCaptureTabId = null;
      chrome.storage.local.set({ ocrStatus: 'idle' });
      broadcast({ type: 'SELECTION_CANCELLED' });
      return false;
    }

    default:
      break;
  }
});

// ─── Handlers principais ──────────────────────────────────────────────────────

/**
 * Tira screenshot do tab, armazena em memória e injeta o seletor visual.
 * @param {number} tabId
 */
async function handleStartCapture(tabId) {
  // Screenshot antes de injetar o overlay para capturar a página limpa
  const dataUrl = await chrome.tabs.captureVisibleTab(null, {
    format:  'jpeg',
    quality: 92,
  });

  pendingScreenshot   = dataUrl;
  pendingCaptureTabId = tabId;

  await chrome.storage.local.set({
    ocrStatus:    'selecting',
    ocrImageData: null,
    ocrError:     null,
    ocrTimestamp: Date.now(),
  });

  // Injetar seletor na aba (não precisa estar em web_accessible_resources)
  await chrome.scripting.executeScript({
    target: { tabId },
    files:  ['selector.js'],
  });
}

/**
 * Remove overlay e restaura estado idle.
 * @param {number} tabId
 */
async function handleCancelCapture(tabId) {
  pendingScreenshot   = null;
  pendingCaptureTabId = null;

  await chrome.storage.local.set({ ocrStatus: 'idle' });

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        document.getElementById('__ocr_selector__')?.remove();
        document.getElementById('__ocr_tip__')?.remove();
      },
    });
  } catch (_) {}
}

/**
 * Recebe coordenadas, recorta o screenshot e notifica o popup.
 * @param {{ x:number, y:number, w:number, h:number }} rect — CSS pixels
 * @param {number} dpr — devicePixelRatio
 * @param {number} tabId
 */
async function handleSelectionDone(rect, dpr, tabId) {
  if (!pendingScreenshot) {
    const msg = 'Screenshot perdido — service worker foi reiniciado. Tente novamente.';
    await chrome.storage.local.set({ ocrStatus: 'error', ocrError: msg });
    broadcast({ type: 'OCR_ERROR', error: msg });
    tryOpenPopup();
    return;
  }

  try {
    const cropped = await cropScreenshot(pendingScreenshot, rect, dpr);
    pendingScreenshot   = null;
    pendingCaptureTabId = null;

    await chrome.storage.local.set({
      ocrStatus:    'ready',
      ocrImageData: cropped,
      ocrTimestamp: Date.now(),
    });

    // Badge para guiar o usuário caso openPopup() falhe
    try {
      chrome.action.setBadgeText({ text: 'OCR', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#007AFF', tabId });
    } catch (_) {}

    broadcast({ type: 'OCR_IMAGE_READY' });
    tryOpenPopup();

  } catch (err) {
    const msg = err?.message || 'Erro ao processar seleção.';
    console.error('[OCR SW] Erro ao recortar screenshot:', msg);
    await chrome.storage.local.set({ ocrStatus: 'error', ocrError: msg });
    broadcast({ type: 'OCR_ERROR', error: msg });
    tryOpenPopup();
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

/**
 * Recorta uma região do screenshot usando OffscreenCanvas.
 * OffscreenCanvas está disponível em Service Workers no Chrome.
 *
 * @param {string} dataUrl — screenshot JPEG completo
 * @param {{ x, y, w, h }} rect — região em CSS pixels
 * @param {number} dpr — para converter para pixels físicos
 * @returns {Promise<string>} data URL PNG da região recortada
 */
async function cropScreenshot(dataUrl, rect, dpr) {
  const { x, y, w, h } = rect;

  // Converter CSS pixels → pixels físicos
  const sx = Math.round(x * dpr);
  const sy = Math.round(y * dpr);
  const sw = Math.round(w * dpr);
  const sh = Math.round(h * dpr);

  if (sw < 4 || sh < 4) {
    throw new Error('Seleção muito pequena. Arraste uma área maior.');
  }

  const response = await fetch(dataUrl);
  const blob     = await response.blob();
  const bitmap   = await createImageBitmap(blob);

  // Garantir que a seleção não ultrapasse os limites da imagem
  const clampedSw = Math.min(sw, bitmap.width  - sx);
  const clampedSh = Math.min(sh, bitmap.height - sy);

  if (clampedSw < 1 || clampedSh < 1) {
    throw new Error('Região selecionada fora dos limites da tela capturada.');
  }

  const canvas = new OffscreenCanvas(clampedSw, clampedSh);
  const ctx    = canvas.getContext('2d');
  ctx.drawImage(bitmap, sx, sy, clampedSw, clampedSh, 0, 0, clampedSw, clampedSh);

  const outBlob     = await canvas.convertToBlob({ type: 'image/png' });
  const arrayBuffer = await outBlob.arrayBuffer();
  return `data:image/png;base64,${arrayBufferToBase64(arrayBuffer)}`;
}

/**
 * ArrayBuffer → base64 em chunks para evitar stack overflow.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes     = new Uint8Array(buffer);
  let   binary    = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Abre o popup programaticamente (Chrome 99+).
 * Falha silenciosamente — o badge guia o usuário.
 */
async function tryOpenPopup() {
  try {
    await chrome.action.openPopup();
  } catch (_) {
    // openPopup() tem suporte limitado; o badge laranja guia o usuário.
  }
}

/**
 * Envia mensagem para o popup (se estiver aberto). Erros suprimidos.
 * @param {object} message
 */
function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

// ─── Inicialização ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ ocrStatus: 'idle' });
  console.log('[OCR v2] Extensão instalada — modo de seleção de região ativo.');
});
