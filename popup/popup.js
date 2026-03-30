'use strict';

/**
 * popup.js — Lógica da interface do popup (v2 — seleção de região)
 *
 * Fluxo:
 *  1. Popup abre → lê ocrStatus do chrome.storage.local
 *  2. idle      → mostra botão "Selecionar área"
 *  3. selecting → mostra "Aguardando seleção…" + botão cancelar
 *  4. ready     → executa OCR na região recortada → mostra resultado
 *  5. error     → exibe mensagem de erro com opção de tentar novamente
 */

// ─── Referências DOM ──────────────────────────────────────────────────────────

const UI = {
  panels: {
    idle:      document.getElementById('state-idle'),
    selecting: document.getElementById('state-selecting'),
    loading:   document.getElementById('state-loading'),
    result:    document.getElementById('state-result'),
    error:     document.getElementById('state-error'),
  },

  loadingDetail: document.getElementById('loading-detail'),
  progressFill:  document.getElementById('progress-fill'),
  progressTrack: document.getElementById('progress-track'),
  progressPct:   document.getElementById('progress-pct'),

  resultText:   document.getElementById('result-text'),
  copyFeedback: document.getElementById('copy-feedback'),

  errorMessage: document.getElementById('error-message'),

  imagePreviewSec: document.getElementById('image-preview-section'),
  imagePreview:    document.getElementById('image-preview'),

  btnCapture:       document.getElementById('btn-capture'),
  btnCancelCapture: document.getElementById('btn-cancel-capture'),
  btnCopy:          document.getElementById('btn-copy'),
  btnDownload:      document.getElementById('btn-download'),
  btnNew:           document.getElementById('btn-new'),
  btnRetry:         document.getElementById('btn-retry'),
  btnReset:         document.getElementById('btn-reset'),
  langSelect:       document.getElementById('lang-select'),
};

// ─── Estado interno ───────────────────────────────────────────────────────────

let activeWorker = null;

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showPanel(name) {
  Object.entries(UI.panels).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

function setProgress(pct, detail) {
  const clamped = Math.max(0, Math.min(100, pct));
  UI.progressFill.style.width = `${clamped}%`;
  UI.progressTrack.setAttribute('aria-valuenow', clamped);
  UI.progressPct.textContent  = `${Math.round(clamped)}%`;
  if (detail !== undefined) UI.loadingDetail.textContent = detail;
}

function showImagePreview(dataUrl) {
  if (!dataUrl) return;
  UI.imagePreview.src = dataUrl;
  UI.imagePreviewSec.classList.remove('hidden');
}

function hideImagePreview() {
  UI.imagePreviewSec.classList.add('hidden');
  UI.imagePreview.src = '';
}

function resetCaptureButton() {
  UI.btnCapture.disabled   = false;
  UI.btnCapture.textContent = '';
  // Recriar conteúdo do botão (SVG + texto)
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M17 13v2.5A1.5 1.5 0 0 1 15.5 17H13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M7 10h6M10 7v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  `;
  UI.btnCapture.appendChild(svg);
  UI.btnCapture.appendChild(document.createTextNode(' Selecionar área'));
}

// ─── Engine OCR (Tesseract.js) ────────────────────────────────────────────────

async function runOCR(imageData, lang) {
  if (activeWorker) {
    try { await activeWorker.terminate(); } catch (_) {}
    activeWorker = null;
  }

  setProgress(0, 'Iniciando engine OCR…');

  // workerBlobURL: false → worker criado em chrome-extension:// (não como blob:null)
  // Assim o worker pode fazer fetch() de chrome-extension:// URLs diretamente.
  const workerPath = chrome.runtime.getURL('libs/worker.min.js');
  const corePath   = chrome.runtime.getURL('libs');
  const langPath   = chrome.runtime.getURL('libs/tessdata');

  const worker = await Tesseract.createWorker(lang, 1, {
    workerPath,
    workerBlobURL: false,
    corePath,
    langPath,
    cacheMethod: 'none',  // não tenta gravar em IndexedDB (falha em extensões)
    gzip: true,
    logger: handleTesseractLog,
  });

  activeWorker = worker;

  try {
    const { data } = await worker.recognize(imageData);
    return data.text.trim();
  } finally {
    try { await worker.terminate(); } catch (_) {}
    activeWorker = null;
  }
}

function handleTesseractLog(m) {
  switch (m.status) {
    case 'loading tesseract core':
      setProgress(5,  'Carregando engine OCR…');  break;
    case 'initializing tesseract':
      setProgress(15, 'Inicializando Tesseract…'); break;
    case 'loading language traineddata':
      setProgress(25, 'Carregando dados de idioma…'); break;
    case 'initializing api':
      setProgress(35, 'Inicializando API…'); break;
    case 'recognizing text':
      setProgress(40 + Math.round(m.progress * 60), 'Reconhecendo texto…'); break;
    default:
      if (m.status) UI.loadingDetail.textContent = m.status;
  }
}

// ─── Processamento principal ──────────────────────────────────────────────────

async function processImage(imageData) {
  showPanel('loading');
  setProgress(0, 'Preparando…');
  showImagePreview(imageData);

  const lang = UI.langSelect.value;

  try {
    const text = await runOCR(imageData, lang);
    UI.resultText.value = text;
    showPanel('result');
    if (!text) {
      UI.resultText.placeholder = 'Nenhum texto detectado nesta área.';
    }
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
  } catch (err) {
    console.error('[OCR] Erro durante OCR:', err);
    // Extrair mensagem mesmo quando err não é um Error padrão
    const rawMsg = err?.message
      || (typeof err === 'string' ? err : null)
      || err?.status
      || (err ? JSON.stringify(err).slice(0, 120) : null);
    UI.errorMessage.textContent = buildFriendlyError(rawMsg);
    showPanel('error');
  }
}

// ─── Mensagens de erro amigáveis ──────────────────────────────────────────────

function buildFriendlyError(msg) {
  if (!msg) return 'Ocorreu um erro desconhecido. Tente novamente.';

  if (/screenshot perdido|service worker/i.test(msg))
    return 'O processo foi interrompido. Clique em "Selecionar área" novamente.';

  if (/muito pequena/i.test(msg))
    return 'A área selecionada é muito pequena. Arraste uma região maior.';

  if (/traineddata/i.test(msg))
    return 'Falha ao baixar dados de idioma. Verifique sua conexão.';

  if (/networkerror|failed to fetch|network request failed/i.test(msg))
    return 'Falha de rede. Verifique sua conexão com a internet.';

  if (/cannot access|cannot be scripted|no tab/i.test(msg))
    return 'Esta página não permite captura de tela (chrome://, extensões, PDF). Tente em uma página web normal.';

  return msg;
}

// ─── Listeners de mensagens do service worker ─────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'OCR_IMAGE_READY':
      chrome.storage.local.get('ocrImageData').then(({ ocrImageData }) => {
        if (ocrImageData) processImage(ocrImageData);
      });
      break;

    case 'OCR_ERROR':
      UI.errorMessage.textContent = buildFriendlyError(msg.error);
      showPanel('error');
      break;

    case 'SELECTION_CANCELLED':
      // Retornar ao estado idle quando o usuário pressionar Esc na página
      resetCaptureButton();
      showPanel('idle');
      break;
  }
});

// ─── Botão: Selecionar área ───────────────────────────────────────────────────

UI.btnCapture.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id) {
      UI.errorMessage.textContent =
        'Não foi possível identificar a aba ativa. Tente novamente.';
      showPanel('error');
      return;
    }

    // Verificar se é uma aba que permite scripting (não chrome://, etc.)
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url === 'about:blank') {
      UI.errorMessage.textContent =
        'Esta página não permite captura de tela. Navegue até uma página web normal e tente novamente.';
      showPanel('error');
      return;
    }

    // Feedback visual
    UI.btnCapture.disabled    = true;
    UI.btnCapture.textContent = 'Iniciando…';

    const response = await chrome.runtime.sendMessage({
      type:  'START_CAPTURE',
      tabId: tab.id,
    });

    if (response?.ok) {
      // Fechar popup para o usuário poder interagir com a página
      window.close();
    } else {
      resetCaptureButton();
      UI.errorMessage.textContent =
        buildFriendlyError(response?.error) || 'Falha ao iniciar a captura.';
      showPanel('error');
    }
  } catch (err) {
    resetCaptureButton();
    UI.errorMessage.textContent = buildFriendlyError(err?.message);
    showPanel('error');
  }
});

// ─── Botão: Cancelar seleção ──────────────────────────────────────────────────

UI.btnCancelCapture.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.runtime.sendMessage({ type: 'CANCEL_CAPTURE', tabId: tab?.id });
  } catch (_) {
    await chrome.storage.local.set({ ocrStatus: 'idle' });
  }
  resetCaptureButton();
  showPanel('idle');
});

// ─── Botão: Copiar texto ──────────────────────────────────────────────────────

UI.btnCopy.addEventListener('click', async () => {
  const text = UI.resultText.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    UI.resultText.select();
    document.execCommand('copy');
  }
  UI.copyFeedback.classList.remove('hidden');
  setTimeout(() => UI.copyFeedback.classList.add('hidden'), 2500);
});

// ─── Botão: Download .txt ─────────────────────────────────────────────────────

UI.btnDownload.addEventListener('click', () => {
  const text = UI.resultText.value;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `ocr-${Date.now()}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ─── Botão: Nova captura ──────────────────────────────────────────────────────

UI.btnNew.addEventListener('click', async () => {
  await chrome.storage.local.set({
    ocrStatus: 'idle', ocrImageData: null, ocrError: null,
  });
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
  hideImagePreview();
  resetCaptureButton();
  showPanel('idle');
});

// ─── Botão: Tentar novamente ──────────────────────────────────────────────────

UI.btnRetry.addEventListener('click', async () => {
  const { ocrImageData } = await chrome.storage.local.get('ocrImageData');
  if (ocrImageData) {
    await processImage(ocrImageData);
  } else {
    showPanel('idle');
  }
});

// ─── Botão: Voltar (do estado de erro) ───────────────────────────────────────

UI.btnReset.addEventListener('click', async () => {
  await chrome.storage.local.set({ ocrStatus: 'idle' });
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
  hideImagePreview();
  resetCaptureButton();
  showPanel('idle');
});

// ─── Persistir preferência de idioma ─────────────────────────────────────────

UI.langSelect.addEventListener('change', () => {
  chrome.storage.local.set({ preferredLang: UI.langSelect.value });
});

chrome.storage.local.get('preferredLang').then(({ preferredLang }) => {
  if (preferredLang) {
    const opt = UI.langSelect.querySelector(`option[value="${preferredLang}"]`);
    if (opt) UI.langSelect.value = preferredLang;
  }
});

// ─── Inicialização ────────────────────────────────────────────────────────────

async function init() {
  const { ocrStatus, ocrImageData, ocrError, ocrTimestamp } =
    await chrome.storage.local.get([
      'ocrStatus', 'ocrImageData', 'ocrError', 'ocrTimestamp',
    ]);

  // Expirar estado com mais de 5 minutos
  const FIVE_MINUTES = 5 * 60 * 1000;
  if (ocrTimestamp && Date.now() - ocrTimestamp > FIVE_MINUTES) {
    await chrome.storage.local.set({ ocrStatus: 'idle' });
    showPanel('idle');
    return;
  }

  switch (ocrStatus) {
    case 'ready':
      if (ocrImageData) {
        await processImage(ocrImageData);
      } else {
        showPanel('idle');
      }
      break;

    case 'selecting':
      // Seleção em andamento — mostrar painel de espera
      showPanel('selecting');
      break;

    case 'error':
      UI.errorMessage.textContent = buildFriendlyError(ocrError);
      showPanel('error');
      break;

    default:
      showPanel('idle');
  }
}

init().catch((err) => {
  console.error('[OCR] Falha na inicialização:', err);
  UI.errorMessage.textContent = buildFriendlyError(err?.message);
  showPanel('error');
});
