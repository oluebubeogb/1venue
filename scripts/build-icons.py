#!/usr/bin/env python3
"""Rasterise public/brand/logo.svg (and mark-white.svg) into PWA icons.

Uses cairosvg if installed, otherwise rsvg-convert or Inkscape.
The mark is centred with padding on a solid background, matching the previous
icon set: navy/brand on white (rounded app icons; square Apple/maskable) and
white on brand for the maskable 512.
"""
import os
import io
import shutil
import subprocess
import sys

from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BRAND = os.path.join(ROOT, 'public', 'brand')
OUT = os.path.join(ROOT, 'public', 'icons')
BLUE = (0, 62, 168, 255)       # #003EA8, sampled from the source mark
WHITE = (255, 255, 255, 255)

def render_svg(path, size):
    """Return a size×size RGBA image of the SVG on a transparent background."""
    try:
        import cairosvg
        png = cairosvg.svg2png(url=path, output_width=size, output_height=size)
        return Image.open(io.BytesIO(png)).convert('RGBA')
    except Exception:
        pass
    rsvg = shutil.which('rsvg-convert')
    if rsvg:
        png = subprocess.check_output([rsvg, '-w', str(size), '-h', str(size), path])
        return Image.open(io.BytesIO(png)).convert('RGBA')
    ink = shutil.which('inkscape')
    if ink:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            dest = f.name
        try:
            subprocess.check_call([ink, path, '-w', str(size), '-h', str(size), '-o', dest],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return Image.open(dest).convert('RGBA')
        finally:
            os.unlink(dest)
    sys.exit('Need cairosvg, rsvg-convert, or Inkscape to rasterise the logo SVG.')

def mark(size, fg_svg, bg, pad=0.0, radius=0.22):
    """Composite the mark onto a solid background, generated at 4× then downsampled."""
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if bg:
        d = ImageDraw.Draw(im)
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=bg)
    inner = int(round(S * (1 - 2 * pad)))
    logo = render_svg(fg_svg, inner)
    # Centre; if the renderer didn't give an exact size, contain it.
    if logo.size != (inner, inner):
        logo.thumbnail((inner, inner), Image.LANCZOS)
    ox = (S - logo.size[0]) // 2
    oy = (S - logo.size[1]) // 2
    im.alpha_composite(logo, (ox, oy))
    return im.resize((size, size), Image.LANCZOS)

def main():
    os.makedirs(OUT, exist_ok=True)
    logo = os.path.join(BRAND, 'logo.svg')
    white = os.path.join(BRAND, 'mark-white.svg')
    mark(32, logo, WHITE, 0.06).save(f'{OUT}/icon-32.png')
    mark(192, logo, WHITE, 0.10).save(f'{OUT}/icon-192.png')
    mark(512, logo, WHITE, 0.10).save(f'{OUT}/icon-512.png')
    mark(512, white, BLUE, 0.20, radius=0).save(f'{OUT}/maskable-512.png')
    mark(180, logo, WHITE, 0.12, radius=0).save(f'{OUT}/apple-touch-icon.png')
    print('icons written to', os.path.abspath(OUT))

if __name__ == '__main__':
    main()
