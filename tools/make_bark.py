#!/usr/bin/env python3
"""Bark textures for the near 3D trunks (user, 24 Nov 2026, Camillus Forest: "focus on adding texture to tree trunks"
→ "3D trunk, crown stays card", "Small bark textures"): three tileable 512 px bark tiles and their normal maps, made
from noise here so the repo carries no photos.

    python3 tools/make_bark.py        # writes textures/bark-{maple,beech,hickory}.jpg and -n.png

  maple    sugar maple's grey-brown bark: long vertical plates split by dark furrows, curling at their edges, a little
           pale lichen
  beech    American beech: smooth elephant-grey, faint darker mottling and thin horizontal lines, a few eye-shaped
           branch scars
  hickory  shagbark / bitternut: long loose strips, deeper shadowed gaps between them, warmer grey-brown

Every tile wraps both ways (the noise is built in Fourier space, so it is periodic by construction).
"""
import os
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N = 512
rng = np.random.default_rng(1926)


def noise(sx, sy, seed=None):
    """Periodic noise: white noise filtered by an anisotropic Gaussian (sx, sy: feature size in px across / along)."""
    r = np.random.default_rng(seed) if seed is not None else rng
    w = r.standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None]; fx = np.fft.fftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * ((fx * sx) ** 2 + (fy * sy) ** 2))
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * g))
    out -= out.mean(); out /= out.std() + 1e-9
    return out


def warp(img, dx, dy):
    """Sample img (periodic) at (x + dx, y + dy), bilinear."""
    y, x = np.mgrid[0:N, 0:N].astype(float)
    X = (x + dx) % N; Y = (y + dy) % N
    x0 = np.floor(X).astype(int); y0 = np.floor(Y).astype(int); fx = X - x0; fy = Y - y0
    x1 = (x0 + 1) % N; y1 = (y0 + 1) % N
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x1] * fx * (1 - fy) + img[y1, x0] * (1 - fx) * fy + img[y1, x1] * fx * fy)


def normal_map(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5 * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return ((n * .5 + .5) * 255).astype(np.uint8)


def colorize(h, stops, extra=None):
    """h in [0, 1] → colour along the stops [(t, '#rrggbb')…]."""
    ts = np.array([t for t, _ in stops]); cs = np.array([[int(c[i:i + 2], 16) for i in (1, 3, 5)] for _, c in stops], float)
    out = np.stack([np.interp(h, ts, cs[:, k]) for k in range(3)], -1)
    if extra is not None: out = extra(out)
    return np.clip(out, 0, 255).astype(np.uint8)


def maple():
    # plates: vertical ridges (cells stretched along y), split by furrows; the furrows wander
    base = noise(10, 70, 1)
    wander = noise(30, 120, 2) * 9
    x = np.mgrid[0:N, 0:N][1].astype(float)
    ridges = np.abs(np.sin((x + wander) * 2 * np.pi * 7 / N + base * 1.3))   # ~7 plates across the tile
    plates = 1 - np.power(1 - ridges, 1.6)
    plates = plates * (.75 + .25 * (noise(8, 40, 7) * .5 + .5))          # plate surfaces are rough, not flat
    cracks = np.clip((noise(50, 5, 3) - 1.9) * 2, 0, 1)                    # a few soft breaks across the plates
    h = plates * (1 - .35 * cracks) + noise(3, 8, 4) * .06
    h = (h - h.min()) / (h.max() - h.min())
    lichen = np.clip((noise(6, 9, 5) - 1.9) * 1.2, 0, .55) * (h > .55)
    col = colorize(h, [(0, '#2b241f'), (.35, '#4a4038'), (.7, '#6d6357'), (1, '#8a8072')],
                   lambda c: c * (1 - lichen[..., None]) + np.array([150, 152, 132]) * lichen[..., None])
    col = (col * (.92 + .16 * (noise(40, 40, 6)[..., None] * .5 + .5))).clip(0, 255).astype(np.uint8)
    return col, normal_map(h, 5.5)


def beech():
    mott = noise(28, 22, 11)
    lines = np.sin(np.mgrid[0:N, 0:N][0] * 2 * np.pi * 34 / N + noise(40, 4, 12) * 1.5) * .5 + .5
    h = .5 + mott * .08 + (lines > .93) * -.12 + noise(2, 2, 13) * .03
    # a few eye-shaped branch scars
    yy, xx = np.mgrid[0:N, 0:N].astype(float)
    for cx, cy, s in [(110, 140, 1.0), (360, 330, .8), (240, 460, .7)]:
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d = ((xx - cx - ox) / (26 * s)) ** 2 + ((yy - cy - oy) / (11 * s)) ** 2
                h -= .35 * np.exp(-d * 3) - .18 * np.exp(-d * .9)
    h = (h - h.min()) / (h.max() - h.min())
    col = colorize(h, [(0, '#4e4c47'), (.45, '#8a8780'), (.7, '#9e9b93'), (1, '#b3b0a7')])
    blot = np.clip(noise(20, 30, 14) - .8, 0, 1)[..., None]
    col = (col * (1 - .25 * blot)).clip(0, 255).astype(np.uint8)
    return col, normal_map(h, 2.0)


def hickory():
    base = noise(6, 110, 21)
    wander = noise(40, 160, 22) * 6
    x = np.mgrid[0:N, 0:N][1].astype(float)
    strips = np.abs(np.sin((x + wander) * 2 * np.pi * 13 / N + base * 1.4))
    curl = np.clip(noise(30, 18, 23), 0, None) * .35   # strips peeling out
    h = np.power(strips, .5) + curl * strips + noise(2, 12, 24) * .07
    h = warp(h, noise(20, 50, 25) * 3, 0)
    h = (h - h.min()) / (h.max() - h.min())
    col = colorize(h, [(0, '#231c17'), (.3, '#3f352d'), (.65, '#6b5e50'), (1, '#8e8170')])
    return col, normal_map(h, 7.0)


def main():
    os.makedirs(os.path.join(ROOT, 'textures'), exist_ok=True)
    for name, fn in (('maple', maple), ('beech', beech), ('hickory', hickory)):
        col, nor = fn()
        Image.fromarray(col).save(os.path.join(ROOT, 'textures', f'bark-{name}.jpg'), quality=86, optimize=True)
        Image.fromarray(nor).save(os.path.join(ROOT, 'textures', f'bark-{name}-n.jpg'), quality=90, optimize=True)
        print(f'  textures/bark-{name}.jpg, bark-{name}-n.jpg')


if __name__ == '__main__':
    main()
