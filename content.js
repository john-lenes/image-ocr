'use strict';

/**
 * content.js — Content Script
 *
 * Injetado em todas as páginas. Serve como ponte entre a página e a extensão.
 * Funções:
 *  - Capturar imagens de elementos <canvas> (que não possuem srcUrl acessível)
 *  - Suporte futuro para seleção de área na tela
 *
 * Nota: A captura principal de imagens <img> é feita pelo background.js via fetch.
 * Este script é necessário para casos especiais (canvas, imagens dinâmicas).
 */

// ─── Handler de mensagens ─────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'CAPTURE_CANVAS': {
      // Captura um elemento <canvas> como data URL PNG
      captureCanvas(message.selector)
        .then(data  => sendResponse({ success: true,  data }))
        .catch(err  => sendResponse({ success: false, error: err.message }));
      return true; // Mantém canal aberto para resposta assíncrona
    }

    case 'GET_IMAGE_DATA_URL': {
      // Obtém o data URL de uma <img> via canvas (útil para imagens same-origin)
      getImageDataUrl(message.src)
        .then(data  => sendResponse({ success: true,  data }))
        .catch(err  => sendResponse({ success: false, error: err.message }));
      return true;
    }

    default:
      break;
  }
});

// ─── Funções auxiliares ───────────────────────────────────────────────────────

/**
 * Converte o conteúdo de um <canvas> para data URL PNG.
 * Lança erro se o canvas não for encontrado ou se estiver "contaminado" (tainted)
 * por conteúdo cross-origin (restrição de segurança do navegador).
 *
 * @param {string} selector — seletor CSS do canvas desejado
 * @returns {Promise<string>} data URL PNG
 */
async function captureCanvas(selector) {
  const canvas = document.querySelector(selector);

  if (!canvas) {
    throw new Error(`Elemento não encontrado: "${selector}"`);
  }

  if (canvas.tagName !== 'CANVAS') {
    throw new Error(`O elemento "${selector}" não é um <canvas>.`);
  }

  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    // Erro comum: canvas "contaminado" por imagens cross-origin
    throw new Error(
      'Não foi possível capturar o canvas (conteúdo cross-origin bloqueado pelo navegador).'
    );
  }
}

/**
 * Desenha uma imagem (referenciada por URL) em um canvas temporário e retorna
 * o data URL resultante. Funciona apenas para imagens same-origin ou com CORS
 * habilitado (crossOrigin = 'anonymous').
 *
 * @param {string} src — URL da imagem
 * @returns {Promise<string>} data URL PNG
 */
function getImageDataUrl(src) {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || img.width;
      canvas.height = img.naturalHeight || img.height;

      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(new Error('Canvas contaminado — imagem cross-origin sem CORS.'));
      }
    };

    img.onerror = () =>
      reject(new Error(`Falha ao carregar imagem: ${src}`));

    img.src = src;
  });
}
