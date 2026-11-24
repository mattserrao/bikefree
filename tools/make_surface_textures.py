#!/usr/bin/env python3
"""The scenery's surface detail textures (user, 24 Nov — Zwift parity, item 4: "allow small textures").

One 512 x 512 RGBA PNG, seamless (tiling), each channel a grey detail map around 0.5:
  R  asphalt: fine aggregate speckle, a few larger stones, faint tar streaks
  G  gravel: packed stone dust with pebbles of all sizes, their shaded undersides
  B  grass: a turf of fine blades, darker roots, a few lighter tips
  A  siding: clapboards (8 to the tile), each lapped board's shadow line and wood grain
The shaders multiply the scenery's own colour by 2 x the channel (the palettes stay as they are) and light the
channel's slopes from the sun. Writes textures/surface-detail.png.
    python3 tools/make_surface_textures.py
"""
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(2611)

def tile_noise(scale, octaves=4, persist=.5):
    """Seamless value noise in [0, 1]: fbm of periodic lattices."""
    out = np.zeros((N, N)); amp = 1.; tot = 0.
    for o in range(octaves):
        cells = scale * 2 ** o
        lat = rng.random((cells, cells))
        y, x = np.mgrid[0:N, 0:N] / N * cells
        x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int); fx = x - x0; fy = y - y0
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
        a = lat[y0 % cells, x0 % cells]; b = lat[y0 % cells, (x0 + 1) % cells]
        c = lat[(y0 + 1) % cells, x0 % cells]; d = lat[(y0 + 1) % cells, (x0 + 1) % cells]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy); tot += amp; amp *= persist
    return out / tot

def blobs(img, count, rmin, rmax, value_fn):
    """Round stones stamped on the tile (wrapping), each lit from the upper left."""
    yy, xx = np.mgrid[0:N, 0:N]
    for _ in range(count):
        cx, cy, r = rng.random() * N, rng.random() * N, rmin + (rmax - rmin) * rng.random() ** 2
        dx = (xx - cx + N / 2) % N - N / 2; dy = (yy - cy + N / 2) % N - N / 2
        d = np.sqrt(dx * dx + dy * dy) / r
        m = d < 1
        if not m.any(): continue
        shade = (-dx - dy)[m] / (r * 1.6)   # (lit from up-left)
        img[m] = value_fn() + shade * .18 - d[m] ** 4 * .12
        ring = (d >= 1) & (d < 1.25)
        img[ring] -= .08 * (1.25 - d[ring]) / .25   # (its shadow in the dust round it)
    return img

def norm(c, lo=.12, hi=.88):
    c = (c - c.mean()) / (c.std() + 1e-6) * .17 + .5
    return np.clip(c, lo, hi)

# asphalt: aggregate
asp = tile_noise(64, 3) * .4 + tile_noise(4, 3) * .3 + rng.random((N, N)) * .3
asp = blobs(asp, 900, 1, 3.2, lambda: .5 + rng.random() * .4)
asp += (tile_noise(4, 2) - .5) * .25
# gravel: dust and pebbles
grav = tile_noise(6, 3) * .35 + tile_noise(32, 4) * .4 + rng.random((N, N)) * .15
grav = blobs(grav, 1400, 1.5, 7, lambda: .35 + rng.random() * .5)
# grass: clumps and tufts that read from a few metres (the blades alone average away in the mipmaps), then blades
# 2–3 px wide over them, lighter at the tips
grass = tile_noise(6, 3) * .55 + tile_noise(24, 3) * .45
for _ in range(5000):
    x, y = rng.random() * N, rng.random() * N
    ang = rng.normal(-np.pi / 2, .5); length = 8 + rng.random() * 18
    v = .25 + rng.random() * .65; wide = 1 + int(rng.random() * 2)
    for k in range(int(length)):
        t = k / length
        for w in range(wide):
            px, py = int(x + np.cos(ang) * k + w) % N, int(y + np.sin(ang) * k) % N
            grass[py, px] = grass[py, px] * .35 + (v * (.55 + .55 * t)) * .65
# siding: 8 clapboards a tile, a shadow under each lap, a little grain
yy, xx = np.mgrid[0:N, 0:N]
board = (yy % (N // 8)) / (N // 8)
side = .62 - board * .12 - np.exp(-((board - 1) ** 2) / .0015) * .0
side = np.where(board > .93, .28, side)   # (the lap's shadow line)
side += (tile_noise(2, 2)[:, :] - .5) * .05 + (np.sin(xx / N * 2 * np.pi * 37 + tile_noise(8, 2) * 9) * .025)

img = np.stack([norm(asp), norm(grav), norm(grass), np.clip(side, .2, .8)], axis=-1)
Image.fromarray((img * 255).astype(np.uint8), 'RGBA').save('textures/surface-detail.png', optimize=True)
print('wrote textures/surface-detail.png', img.shape)
