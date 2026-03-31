#!/usr/bin/env python3
"""
generate_icons.py
─────────────────
Gera os ícones PNG da extensão Chrome (16×16, 48×48, 128×128) usando
somente a biblioteca padrão do Python — sem dependências externas.

Desenha um ícone "OCR": lupa sobre linhas de texto, em azul (#007AFF)
sobre fundo branco.

Uso:
    python3 generate_icons.py
"""

import os
import struct
import zlib


# ─── Utilitários PNG ──────────────────────────────────────────────────────────

def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Codifica um chunk PNG conforme a especificação (RFC 2083)."""
    body = chunk_type + data
    crc  = zlib.crc32(body) & 0xFFFFFFFF
    return struct.pack('>I', len(data)) + body + struct.pack('>I', crc)


def build_png(pixels: list[list[tuple[int, int, int]]]) -> bytes:
    """
    Constrói um arquivo PNG RGB a partir de uma matriz de pixels.

    :param pixels: lista de linhas; cada linha é uma lista de tuplas (R, G, B)
    :returns: bytes do arquivo PNG
    """
    height = len(pixels)
    width  = len(pixels[0]) if height else 0

    # IHDR: largura, altura, bit-depth=8, color-type=2 (RGB), compressão, filtro, interlace
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr = _png_chunk(b'IHDR', ihdr_data)

    # IDAT: dados de imagem (filtro=0 «None» por linha + pixels RGB)
    raw = bytearray()
    for row in pixels:
        raw.append(0)           # tipo de filtro: None
        for r, g, b in row:
            raw += bytes([r, g, b])

    compressed = zlib.compress(bytes(raw), level=9)
    idat = _png_chunk(b'IDAT', compressed)

    # IEND
    iend = _png_chunk(b'IEND', b'')

    signature = b'\x89PNG\r\n\x1a\n'
    return signature + ihdr + idat + iend


# ─── Primitivas de desenho ────────────────────────────────────────────────────

def fill(pixels, x0, y0, x1, y1, color):
    """Preenche um retângulo com a cor dada."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            if 0 <= y < len(pixels) and 0 <= x < len(pixels[0]):
                pixels[y][x] = color


def draw_circle(pixels, cx, cy, r, color, thickness=1):
    """
    Desenha o contorno de um círculo usando o algoritmo de Bresenham.
    Preenche uma largura (espessura) de pixels para cada ponto.
    """
    for t in range(thickness):
        ri = r - t
        if ri <= 0:
            break

        x, y = ri, 0
        err  = 0

        while x >= y:
            for dx, dy in [(x, y), (y, x), (-x, y), (-y, x),
                           (x, -y), (y, -x), (-x, -y), (-y, -x)]:
                px, py = cx + dx, cy + dy
                if 0 <= py < len(pixels) and 0 <= px < len(pixels[0]):
                    pixels[py][px] = color

            y   += 1
            err += 1 + 2 * y
            if 2 * (err - x) + 1 > 0:
                x   -= 1
                err += 1 - 2 * x


def draw_line(pixels, x0, y0, x1, y1, color, thickness=1):
    """Traça uma linha entre dois pontos (Bresenham) com espessura."""
    dx = abs(x1 - x0)
    dy = abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy

    points = []
    while True:
        points.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0  += sx
        if e2 < dx:
            err += dx
            y0  += sy

    half = thickness // 2
    for px, py in points:
        for oy in range(-half, half + 1):
            for ox in range(-half, half + 1):
                ny, nx = py + oy, px + ox
                if 0 <= ny < len(pixels) and 0 <= nx < len(pixels[0]):
                    pixels[ny][nx] = color


def fill_circle(pixels, cx, cy, r, color):
    """Preenche um círculo."""
    for y in range(max(0, cy - r), min(len(pixels), cy + r + 1)):
        for x in range(max(0, cx - r), min(len(pixels[0]), cx + r + 1)):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2:
                pixels[y][x] = color


# ─── Geração do ícone ─────────────────────────────────────────────────────────

#: Azul principal da extensão (#3b82f6 — SnapText OCR)
BLUE   = (59, 130, 246)
#: Branco para elementos em foreground
WHITE  = (255, 255, 255)
#: Fundo do ícone
BG     = (59, 130, 246)   # fundo todo azul


def make_icon_pixels(size: int) -> list[list[tuple[int, int, int]]]:
    """
    Desenha o ícone (lupa + linhas de texto estilizadas) em escala `size`.
    Retorna a matriz de pixels.
    """
    # Inicializar com fundo azul
    pixels = [[BG for _ in range(size)] for _ in range(size)]

    s = size  # atalho

    # ── Linhas de texto estilizadas (3 linhas horizontais brancas) ──────────
    line_h   = max(1, round(s * 0.07))   # espessura das linhas
    margin_l = round(s * 0.12)           # margem esquerda
    margin_r = round(s * 0.55)           # as linhas não vão até a direita (lupa)

    y1 = round(s * 0.22)
    y2 = round(s * 0.38)
    y3 = round(s * 0.54)

    for (ya, yb) in [(y1, y1 + line_h),
                     (y2, y2 + line_h),
                     (y3, y3 + line_h)]:
        fill(pixels, margin_l, ya, margin_r, yb, WHITE)

    # ── Lupa ────────────────────────────────────────────────────────────────
    cx = round(s * 0.62)   # centro X da lupa
    cy = round(s * 0.42)   # centro Y da lupa
    r  = round(s * 0.22)   # raio da lupa (círculo externo)
    t  = max(1, round(s * 0.085))  # espessura do anel

    # Anel da lupa: círculo externo branco e interno azul
    fill_circle(pixels, cx, cy, r,     WHITE)
    fill_circle(pixels, cx, cy, r - t, BG)

    # Cabo da lupa (linha diagonal inferior direita)
    angle_start_x = cx + round((r - 1) * 0.68)
    angle_start_y = cy + round((r - 1) * 0.68)
    angle_end_x   = min(s - 2, cx + round(r * 1.6))
    angle_end_y   = min(s - 2, cy + round(r * 1.6))

    draw_line(
        pixels,
        angle_start_x, angle_start_y,
        angle_end_x,   angle_end_y,
        WHITE,
        thickness=max(2, round(s * 0.09)),
    )

    return pixels


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    os.makedirs('icons', exist_ok=True)

    sizes = [16, 48, 128]
    for size in sizes:
        pixels = make_icon_pixels(size)
        png    = build_png(pixels)
        path   = f'icons/icon{size}.png'

        with open(path, 'wb') as f:
            f.write(png)

        print(f'  ✓ {path}  ({size}×{size}, {len(png):,} bytes)')

    print('\nÍcones gerados com sucesso!')


if __name__ == '__main__':
    main()
