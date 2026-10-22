#!/usr/bin/env python3
"""Rasterise the 1venue mark (navy "1" + house outline) into PWA icons. Requires Pillow."""
import os
from PIL import Image, ImageDraw
OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
NAVY, WHITE = (23, 37, 84, 255), (255, 255, 255, 255)

def stroke(d, pts, w, s, ox, oy, col):
    P = [(ox + x * s, oy + y * s) for x, y in pts]
    d.line(P, fill=col, width=round(w * s), joint='curve')
    r = w * s / 2
    for x, y in (P[0], P[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=col)

def mark(size, fg, bg, pad=0.0, radius=0.22):
    S = size * 4
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg: d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * radius), fill=bg)
    inner = S * (1 - 2 * pad); s = inner / 160; o = S * pad
    stroke(d, [(36, 54), (62, 34), (62, 122)], 16, s, o, o, fg)
    stroke(d, [(88, 36), (128, 62), (128, 118), (88, 118), (88, 98)], 5.5, s, o, o, fg)
    return im.resize((size, size), Image.LANCZOS)

os.makedirs(OUT, exist_ok=True)
mark(32, NAVY, WHITE, .06).save(f'{OUT}/icon-32.png')
mark(192, NAVY, WHITE, .1).save(f'{OUT}/icon-192.png')
mark(512, NAVY, WHITE, .1).save(f'{OUT}/icon-512.png')
mark(512, WHITE, NAVY, .2, radius=0).save(f'{OUT}/maskable-512.png')
mark(180, NAVY, WHITE, .12, radius=0).save(f'{OUT}/apple-touch-icon.png')
print('icons written to', os.path.abspath(OUT))
