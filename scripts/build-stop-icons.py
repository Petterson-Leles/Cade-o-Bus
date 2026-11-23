#!/usr/bin/env python3
"""Gera os ícones grandes dos pontos no mapa da tela do ponto (assets/common.r/stop/).

- stop/move-<tema>.png: estação MOVE/BRT, círculo cheio na cor de destaque do tema
  (THEMES.<tema>.chip) com um "M" bem grosso (chipText) e contorno fino na cor do
  fundo (bg);
- stop/central-<tema>.png: estação central (São Gabriel, Pampulha...), hexágono de
  ponta para cima na cor de destaque, com a frente de um ônibus (chipText) e contorno
  na cor do fundo.

O losango dos pontos de rua é desenhado no CANVAS (page/detail/index.page.js).
Tamanhos em px de design em shared/stop-icons.js STOP_ICON_SIZE; aqui já em px
físicos da tela de 466 (o IMG usa o tamanho exato, sem auto_scale). PNG indexado
(16 cores com alpha), como os algarismos (scripts/build-eta-digits.py).

Uso: python3 scripts/build-stop-icons.py (requer Pillow e o Node).
"""
import json
import math
import os
import subprocess

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'common.r', 'stop')
SCREEN = 466
SS = 16  # superamostragem
COLORS = 16

# "M" grosso num quadro 24 x 24 (o mesmo M_PATH de shared/stop-icons-svg.js).
M_POLY = [(5.2, 17.4), (5.2, 6.6), (8.8, 6.6), (12, 11.4), (15.2, 6.6), (18.8, 6.6), (18.8, 17.4),
          (15.4, 17.4), (15.4, 12.1), (12, 16.6), (8.6, 12.1), (8.6, 17.4)]


def spec():
    js = """
import { THEMES } from './utils/colors.js'
import { STOP_ICON_SIZE } from './shared/stop-icons.js'
console.log(JSON.stringify({
  size: STOP_ICON_SIZE,
  themes: Object.fromEntries(['dark', 'light'].map((t) => [t, { bg: THEMES[t].bg, chip: THEMES[t].chip, ink: THEMES[t].chipText }]))
}))
"""
    out = subprocess.run(['node', '--no-warnings', '--input-type=module', '-e', js], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def rgba(v):
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255, 255)


def phys(design):
    return round(design * SCREEN / 480)


def finish(im, size, path):
    im = im.resize((size, size), Image.LANCZOS)
    q = im.quantize(colors=COLORS, method=Image.Quantize.FASTOCTREE)
    q.save(path, optimize=True)


def move_icon(size, c, path):
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    edge = 1.3 * SS  # contorno na cor do fundo (px físicos)
    d.ellipse([0, 0, S - 1, S - 1], fill=rgba(c['bg']))
    d.ellipse([edge, edge, S - 1 - edge, S - 1 - edge], fill=rgba(c['chip']))
    k = S / 24
    # "M" um tico menor que o quadro (fica com folga no círculo).
    f = 0.95
    pts = [((x - 12) * f * k + S / 2, (y - 12) * f * k + S / 2) for x, y in M_POLY]
    d.polygon(pts, fill=rgba(c['ink']))
    finish(im, size, path)


def bus(d, cx, cy, s, ink, hole):
    k = s / 24
    ox, oy = cx - s / 2, cy - s / 2
    P = lambda x, y: (ox + x * k, oy + y * k)
    def rect(x, y, w, h, r, col):
        d.rounded_rectangle([P(x, y), P(x + w, y + h)], radius=r * k, fill=col)
    rect(4, 3, 16, 15, 3, ink)
    rect(6.5, 6, 11, 4.5, 1, hole)
    for x in (8, 16):
        d.ellipse([P(x - 1.4, 15 - 1.4), P(x + 1.4, 15 + 1.4)], fill=hole)
    rect(6, 18, 3, 3, 1, ink)
    rect(15, 18, 3, 3, 1, ink)


def hexagon(cx, cy, r):
    return [(cx + r * math.cos(-math.pi / 2 + j * math.pi / 3), cy + r * math.sin(-math.pi / 2 + j * math.pi / 3)) for j in range(6)]


def central_icon(size, c, path):
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    R = S / 2 - 0.5 * SS
    edge = 1.6 * SS
    d.polygon(hexagon(S / 2, S / 2, R), fill=rgba(c['bg']))
    d.polygon(hexagon(S / 2, S / 2, R - edge / math.cos(math.pi / 6)), fill=rgba(c['chip']))
    bus(d, S / 2, S / 2, S * 0.62, rgba(c['ink']), rgba(c['chip']))
    finish(im, size, path)


def main():
    sp = spec()
    os.makedirs(OUT, exist_ok=True)
    for theme, c in sp['themes'].items():
        move_icon(phys(sp['size']['move']), c, os.path.join(OUT, f'move-{theme}.png'))
        central_icon(phys(sp['size']['central']), c, os.path.join(OUT, f'central-{theme}.png'))
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)), 'bytes')


if __name__ == '__main__':
    main()
