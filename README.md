# OCR Image Extractor — Extensão Chrome

Extensão para Google Chrome que permite selecionar **qualquer região da tela** e extrair o texto contido nela usando OCR (Tesseract.js). Funciona em qualquer conteúdo visível: páginas web, formulários, sistemas ERP, janelas de diálogo, imagens dinâmicas, etc.

---

## Funcionalidades

- **Seleção livre de área**: arraste um retângulo sobre qualquer parte da tela para definir a região de captura
- **OCR local**: processamento 100% no navegador, sem enviar dados a servidores externos
- **Múltiplos idiomas**: Português (PT/BR), Inglês, Espanhol, Francês, Alemão, Italiano
- **Copiar para área de transferência** ou **baixar como `.txt`**
- **Prévia da região capturada** no popup
- **Barra de progresso** com etapas detalhadas do OCR

---

## Estrutura de arquivos

```
extesion image/
├── manifest.json              # Configuração MV3
├── background.js              # Service Worker (captura + recorte da região)
├── selector.js                # Overlay SVG injetado para seleção de área
├── popup/
│   ├── popup.html             # Interface do popup (5 estados)
│   ├── popup.css              # Estilo do popup
│   └── popup.js               # Lógica da UI + engine OCR
├── libs/
│   ├── tesseract.min.js       # Tesseract.js v5.1.1 (bundle principal)
│   ├── worker.min.js          # Worker do Tesseract.js
│   ├── tesseract-core-simd.wasm.js   # Core WASM (SIMD — mais rápido)
│   └── tesseract-core.wasm.js        # Core WASM (fallback)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── generate_icons.py          # Script para gerar os ícones
└── setup.sh                   # Script de instalação das libs
```

---

## Instalação

### 1. Preparar as bibliotecas

Execute o script de setup (requer Node.js):

```bash
chmod +x setup.sh && ./setup.sh
```

Ou instale manualmente:

```bash
npm install tesseract.js@5.1.1 tesseract.js-core@5.1.1

mkdir -p libs
cp node_modules/tesseract.js/dist/tesseract.min.js         libs/
cp node_modules/tesseract.js/dist/worker.min.js            libs/
cp node_modules/tesseract.js-core/tesseract-core-simd.wasm.js libs/
cp node_modules/tesseract.js-core/tesseract-core.wasm.js   libs/
```

### 2. Gerar os ícones

```bash
python3 generate_icons.py
```

### 3. Carregar no Chrome

1. Abra `chrome://extensions`
2. Ative o **Modo do desenvolvedor** (canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `extesion image/`

---

## Como usar

1. **Abra o popup**: clique no ícone da extensão na barra de ferramentas
2. **Selecione o idioma** do texto que deseja extrair
3. **Clique em "Selecionar área"**: o popup fecha e um overlay com cursor crosshair cobre a página
4. **Arraste** para selecionar a região com o texto desejado
5. O popup **reabre automaticamente** e inicia o OCR
   - Se não reabrir, observe o badge **`OCR`** em azul no ícone — clique nele para abrir
6. **Copie o texto** ou **baixe como `.txt`**

> **Dica**: pressione `Esc` durante a seleção para cancelar.

---

## Fluxo técnico

```
[Usuário clica "Selecionar área"]
        ↓
[popup.js → runtime.sendMessage({type: 'START_CAPTURE'})]
        ↓
[background.js (Service Worker)]
  1. captureVisibleTab() → captura screenshot JPEG da aba
  2. scripting.executeScript() → injeta selector.js na página
  3. Fecha o popup (window.close())
        ↓
[selector.js — overlay SVG fullscreen]
  - Usuário arrasta o retângulo de seleção
  - mouseup → sendMessage({type: 'SELECTION_DONE', rect, dpr})
        ↓
[background.js recebe SELECTION_DONE]
  1. Remove o overlay da página
  2. OffscreenCanvas → recorta a região do screenshot
  3. storage.local.set({ocrStatus: 'ready', ocrImageData: '<PNG base64>'})
  4. action.openPopup() (Chrome 99+) ou badge 'OCR' como fallback
        ↓
[popup.js ao abrir]
  - Lê ocrStatus='ready' → chama processImage()
  - Tesseract.js executa OCR local → exibe resultado
```

---

## Permissões utilizadas

| Permissão | Motivo |
|---|---|
| `tabs` | Identificar a aba ativa para captura |
| `activeTab` | Permissão para acesso temporário à aba |
| `scripting` | Injetar `selector.js` dinamicamente |
| `storage` | Persistir estado OCR e preferências |
| `<all_urls>` | Capturar em qualquer domínio |

> Nenhuma permissão de rede é solicitada para a captura — os dados de linguagem do Tesseract são baixados diretamente pelo popup via `tessdata.projectnaptha.com` e cacheados pelo navegador.

---

## Limitações conhecidas

- **Páginas restritas**: `chrome://`, `chrome-extension://`, PDFs nativos e `about:blank` não permitem injeção de scripts — uma mensagem de erro específica é exibida
- **Reabertura do popup**: `chrome.action.openPopup()` só funciona quando chamado a partir de um gesto do usuário (limitação do Chrome). O badge `OCR` serve como fallback visual
- **Qualidade do OCR**: depende da resolução e nitidez da região capturada; textos muito pequenos ou com baixo contraste podem ter precisão reduzida

---

## Dependências

| Biblioteca | Versão | Uso |
|---|---|---|
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 5.1.1 | Engine OCR principal |
| [tesseract.js-core](https://github.com/naptha/tesseract.js-core) | 5.1.1 | Módulos WASM do Tesseract |
