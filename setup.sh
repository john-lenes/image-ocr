#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
# setup.sh — Prepara a extensão OCR para uso no Chrome
#
# O que este script faz:
#   1. Baixa os arquivos do Tesseract.js (engine OCR) da CDN jsDelivr
#   2. Gera os ícones PNG da extensão via Python
#
# Requisitos: bash, curl, python3
# Uso: bash setup.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Cores para output ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
BLU='\033[0;34m'
NC='\033[0m'  # No Color

info()    { echo -e "${BLU}▸${NC} $*"; }
success() { echo -e "${GRN}✓${NC} $*"; }
warn()    { echo -e "${YLW}⚠${NC} $*"; }
error()   { echo -e "${RED}✗${NC} $*" >&2; }

# ── Verificar dependências ────────────────────────────────────────────────────
require() {
  command -v "$1" >/dev/null 2>&1 || {
    error "Dependência não encontrada: '$1'. Instale e tente novamente."
    exit 1
  }
}

require curl
require python3

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   OCR Extension — Setup"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Configuração ──────────────────────────────────────────────────────────────

# Versão do Tesseract.js — verifique https://github.com/naptha/tesseract.js
# para a versão mais recente antes de atualizar.
TESS_VERSION="5.1.1"

# Arquivos da biblioteca principal (tesseract.js/dist)
CDN_MAIN="https://cdn.jsdelivr.net/npm/tesseract.js@${TESS_VERSION}/dist"

# Arquivos do core WASM (pacote separado: tesseract.js-core)
# O worker.min.js carrega o WASM deste pacote em tempo de execução.
CDN_CORE="https://cdn.jsdelivr.net/npm/tesseract.js-core@${TESS_VERSION}"

# Arquivos principais
MAIN_FILES=(
  "tesseract.min.js"
  "worker.min.js"
)

# Arquivos WASM core:
#  simd.wasm.js  — SIMD (padrão em Chrome moderno ≥ v91)
#  .wasm.js      — fallback sem SIMD (compatibilidade)
CORE_FILES=(
  "tesseract-core-simd.wasm.js"
  "tesseract-core.wasm.js"
)

# ── Criar diretórios ──────────────────────────────────────────────────────────
mkdir -p libs icons

# ── Download do Tesseract.js ──────────────────────────────────────────────────
echo ""
info "Baixando Tesseract.js v${TESS_VERSION}…"
echo ""

FAILED=0

# Função utilitária de download
download_file() {
  local url="$1"
  local dest="$2"
  local label="$3"

  printf "  ↓ %-44s " "${label}"

  if curl --fail --silent --location \
          --connect-timeout 30 \
          --max-time 180 \
          --output "${dest}" \
          "${url}"; then
    SIZE=$(wc -c < "${dest}" | tr -d ' ')
    printf "${GRN}OK${NC} (%'d bytes)\n" "${SIZE}"
    return 0
  else
    printf "${RED}FALHA${NC}\n"
    warn "Não foi possível baixar: ${url}"
    FAILED=$((FAILED + 1))
    return 1
  fi
}

echo "  [biblioteca principal]"
for file in "${MAIN_FILES[@]}"; do
  download_file "${CDN_MAIN}/${file}" "libs/${file}" "${file}"
done

echo ""
echo "  [WASM core — tesseract.js-core@${TESS_VERSION}]"
for file in "${CORE_FILES[@]}"; do
  download_file "${CDN_CORE}/${file}" "libs/${file}" "${file}"
done

echo ""
if [ "${FAILED}" -gt 0 ]; then
  warn "${FAILED} arquivo(s) falharam. Verifique sua conexão e tente novamente."
  warn "A extensão pode não funcionar sem os arquivos WASM."
  echo ""
fi

# ── Gerar ícones ──────────────────────────────────────────────────────────────
info "Gerando ícones PNG…"
echo ""

python3 generate_icons.py | sed 's/^/  /'

# ── Verificação final ─────────────────────────────────────────────────────────
echo ""
info "Verificando estrutura de arquivos…"
echo ""

REQUIRED_FILES=(
  "manifest.json"
  "background.js"
  "content.js"
  "popup/popup.html"
  "popup/popup.css"
  "popup/popup.js"
  "libs/tesseract.min.js"
  "libs/worker.min.js"
  "icons/icon16.png"
  "icons/icon48.png"
  "icons/icon128.png"
)

ALL_OK=1
for f in "${REQUIRED_FILES[@]}"; do
  if [ -f "${f}" ]; then
    printf "  ${GRN}✓${NC} %s\n" "${f}"
  else
    printf "  ${RED}✗${NC} %s  ${YLW}(ausente)${NC}\n" "${f}"
    ALL_OK=0
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "${ALL_OK}" -eq 1 ]; then
  success "Setup concluído! Todos os arquivos estão presentes."
else
  warn "Setup concluído com avisos. Verifique os arquivos ausentes acima."
fi

echo ""
echo "  Próximos passos para instalar no Chrome:"
echo ""
echo "  1. Abra  chrome://extensions"
echo "  2. Ative o 'Modo do desenvolvedor' (canto superior direito)"
echo "  3. Clique em 'Carregar sem compactação'"
echo "  4. Selecione esta pasta: $(pwd)"
echo "  5. Acesse qualquer página com imagens e"
echo "     clique com o botão direito sobre uma imagem."
echo "  6. Selecione 'Extrair texto da imagem'."
echo ""
echo "  Nota: Na primeira extração, o Tesseract.js precisará baixar os"
echo "  dados de idioma (~10MB). As extrações seguintes usarão o cache."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
