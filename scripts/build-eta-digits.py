#!/usr/bin/env python3
"""Gera os algarismos do número grande da tela do ponto (assets/common.r/eta/).

- eta/<tema>-<faixa>-<d>.png: algarismo d na cor da faixa (ETA_BANDS), com contorno
  leve (THEMES.<tema>.outline), só os algarismos que a faixa usa (utils/eta-digits.js
  digitsByBand);
- eta/<tema>-min.png: "min" em negrito na cor do texto, com o mesmo contorno;
- utils/eta-digits-data.js: altura, base e larguras (px físicos da tela de 466).

PNG indexado (paleta de 16 cores com alpha): o build do Zepp converte para o formato
do relógio (8 bits por pixel), então o que pesa é a área de cada imagem.

Fontes (SIL Open Font License 1.1; só as imagens geradas vão no app):
- Archivo Black (Omnibus-Type), algarismos:
  https://github.com/google/fonts/tree/main/ofl/archivoblack
- Inter ExtraBold (Rasmus Andersson), "min": https://github.com/rsms/inter

Uso: python3 scripts/build-eta-digits.py ArchivoBlack-Regular.ttf [Inter-ExtraBold.otf]
Requer Pillow e o Node (lê as cores de utils/colors.js).
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'assets', 'common.r', 'eta')
DATA = os.path.join(ROOT, 'utils', 'eta-digits-data.js')

SCREEN = 466  # Active 3 Premium (px físicos); o design é 480
K = SCREEN / 480
STROKE = 3  # contorno (px físicos)
MIN_STROKE = 2
COLORS = 16  # paleta de cada PNG


def spec():
    js = """
import { THEMES, ETA_BANDS, BUS_ICON_SLUGS } from './utils/colors.js'
import { digitsByBand, ETA_FONT } from './utils/eta-digits.js'
const digits = digitsByBand()
console.log(JSON.stringify({
  font: ETA_FONT,
  themes: Object.fromEntries(['dark', 'light'].map((t) => [t, { text: THEMES[t].text, outline: THEMES[t].outline }])),
  bands: BUS_ICON_SLUGS.map((slug, i) => ({ slug, dark: ETA_BANDS[i].dark, light: ETA_BANDS[i].light, digits: digits[slug] }))
}))
"""
    out = subprocess.run(['node', '--no-warnings', '--input-type=module', '-e', js], cwd=ROOT, check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def rgb(v):
    return ((v >> 16) & 255, (v >> 8) & 255, v & 255)


def render(text, font, fill, outline, stroke, top, bottom):
    """Texto com contorno, recortado na horizontal à tinta e na vertical a [top, bottom)
    (relativos à origem do texto, iguais para todos os algarismos)."""
    l, _, r, _ = font.getbbox(text, stroke_width=stroke)
    pad = stroke + 4
    h = bottom - top
    im = Image.new('RGBA', (r - l + 2 * pad, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.text((pad - l, -top), text, font=font, fill=rgb(fill) + (255,), stroke_width=stroke, stroke_fill=rgb(outline) + (255,))
    x0, _, x1, _ = im.getchannel('A').getbbox()
    return im.crop((x0, 0, x1, h))


def save(im, path):
    q = im.quantize(colors=COLORS, method=Image.Quantize.FASTOCTREE)
    q.save(path, optimize=True)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    digit_font_path = sys.argv[1]
    min_font_path = sys.argv[2] if len(sys.argv) > 2 else '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'
    s = spec()
    size = round(s['font'] * K)
    font = ImageFont.truetype(digit_font_path, size)
    min_font = ImageFont.truetype(min_font_path, round(34 * K))
    # Faixa vertical comum a todos os algarismos (mesma base em todas as imagens).
    boxes = [font.getbbox(str(d), stroke_width=STROKE) for d in range(10)]
    top = min(b[1] for b in boxes)
    bottom = max(b[3] for b in boxes)
    ascent = font.getmetrics()[0]
    _, mt, _, mb = min_font.getbbox('min', stroke_width=MIN_STROKE)
    min_ascent = min_font.getmetrics()[0]

    widths = [render(str(d), font, 0, 0, STROKE, top, bottom).size[0] for d in range(10)]
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.png'):
            os.remove(os.path.join(OUT, f))
    for theme, t in s['themes'].items():
        for band in s['bands']:
            for d in band['digits']:
                im = render(str(d), font, band[theme], t['outline'], STROKE, top, bottom)
                save(im, os.path.join(OUT, f"{theme}-{band['slug']}-{d}.png"))
        im = render('min', min_font, t['text'], t['outline'], MIN_STROKE, mt, mb)
        save(im, os.path.join(OUT, f'{theme}-min.png'))
        min_w = im.size[0]

    data = {
        'k': 'K',
        'h': bottom - top,
        'base': ascent - top,
        'widths': widths,
        'min': {'w': min_w, 'h': mb - mt, 'base': min_ascent - mt},
    }
    body = json.dumps(data, separators=(', ', ': ')).replace('"K"', '466 / 480')
    body = body.replace('"', '')
    with open(DATA, 'w') as fh:
        fh.write('// Gerado por scripts/build-eta-digits.py: não edite à mão.\n')
        fh.write('// Tamanhos em px físicos da tela de 466 (k = físicos por px de design).\n')
        fh.write(f'export const ETA_DIGIT_DATA = {body}\n')
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    pixels = sum(Image.open(os.path.join(OUT, f)).size[0] * Image.open(os.path.join(OUT, f)).size[1] for f in os.listdir(OUT))
    print(f'{len(os.listdir(OUT))} PNGs, {total} bytes, {pixels} pixels')


if __name__ == '__main__':
    main()
