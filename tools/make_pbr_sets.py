#!/usr/bin/env python3
"""The PBR surface sets (fidelity plan, step 5): seamless 1024 px tiles, two images a set.

  <set>-albedo.png   sRGB colour (A: height, for height-based blending between sets)
  <set>-nra.png      linear: R,G the tangent-space normal's x,y (z rebuilt in the shader), B roughness, A ambient occlusion

Sets: asphalt-new, asphalt-worn, asphalt-patched, concrete, gravel, dirt-path, cobble, turf, leaf-litter, rock.
Procedural (no download needed). To use photo-sourced CC0 sets instead (ambientCG, Poly Haven), drop the same two
images per set into textures/src/ under the same names: tools/build_textures.mjs takes whatever is there.
Writes textures/src/<set>-albedo.png and textures/src/<set>-nra.png (sources: not committed; the KTX2 files are).
    python3 tools/make_pbr_sets.py [set …]
"""
import sys, os
import numpy as np
from PIL import Image

N = 1024
OUT = os.path.join(os.path.dirname(__file__), '..', 'textures', 'src')

def noise(rng, scale, octaves=5, persist=.5):
    """Seamless fbm value noise in [0, 1]."""
    out = np.zeros((N, N)); amp = 1.; tot = 0.
    y, x = np.mgrid[0:N, 0:N] / N
    for o in range(octaves):
        cells = int(scale * 2 ** o)
        lat = rng.random((cells, cells))
        X = x * cells; Y = y * cells
        x0 = np.floor(X).astype(int); y0 = np.floor(Y).astype(int); fx = X - x0; fy = Y - y0
        fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy)
        a = lat[y0 % cells, x0 % cells]; b = lat[y0 % cells, (x0 + 1) % cells]
        c = lat[(y0 + 1) % cells, x0 % cells]; d = lat[(y0 + 1) % cells, (x0 + 1) % cells]
        out += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy); tot += amp; amp *= persist
    return out / tot

def blur(a, r):
    """Seamless box blur (wraps), radius r px, twice (≈ gaussian)."""
    for _ in range(2):
        for ax in (0, 1):
            acc = np.zeros_like(a)
            for k in range(-r, r + 1): acc += np.roll(a, k, axis=ax)
            a = acc / (2 * r + 1)
    return a

def stones(rng, count, rmin, rmax, h=1.):
    """Seamless field of rounded stones: height map and an id map (for per-stone colour)."""
    H = np.zeros((N, N)); ID = np.zeros((N, N))
    for k in range(count):
        cx, cy = rng.random(2) * N; r = rmin + (rmax - rmin) * rng.random() ** 2
        x0, x1, y0, y1 = int(cx - r - 1), int(cx + r + 2), int(cy - r - 1), int(cy + r + 2)
        ys, xs = np.mgrid[y0:y1, x0:x1]
        e = 1 + .35 * (rng.random() - .5)
        d = np.sqrt(((xs - cx) / e) ** 2 + ((ys - cy) * e) ** 2) / r
        dome = np.clip(1 - d * d, 0, None) ** .6 * h * (r / rmax) ** .5
        sub = H[ys % N, xs % N]; upd = dome > sub
        H[ys[upd] % N, xs[upd] % N] = dome[upd]; ID[ys[upd] % N, xs[upd] % N] = rng.random()
    return H, ID

def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1); n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n

def ao_from_height(h, r=6, k=2.5):
    return np.clip(1 - np.clip(blur(h, r) - h, 0, None) * k, 0, 1)

def mix(c0, c1, t): t = t[..., None]; return np.array(c0) * (1 - t) + np.array(c1) * t
def srgb(c): return np.clip(c, 0, 1) ** (1 / 2.2)   # (colours authored linear-ish, stored sRGB)

def save(name, albedo, height, n, rough, ao):
    os.makedirs(OUT, exist_ok=True)
    a = np.concatenate([srgb(albedo), np.clip(height, 0, 1)[..., None]], -1)
    Image.fromarray((a * 255 + .5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'{name}-albedo.png'), optimize=True)
    rough = np.broadcast_to(rough, height.shape); ao = np.broadcast_to(ao, height.shape)
    nra = np.stack([n[..., 0] * .5 + .5, n[..., 1] * .5 + .5, np.clip(rough, 0, 1), np.clip(ao, 0, 1)], -1)
    Image.fromarray((nra * 255 + .5).astype(np.uint8), 'RGBA').save(os.path.join(OUT, f'{name}-nra.png'), optimize=True)
    print('  ', name)

def asphalt(rng, wear=0., patched=False, name='asphalt-new'):
    agg, aid = stones(rng, 9000, 1.2, 3.4)
    fine = noise(rng, 64, 3)
    tar = noise(rng, 6, 4)
    h = agg * .55 + fine * .25 + tar * .2
    base = mix([.055, .055, .06], [.085, .085, .09], tar)
    stone = mix([.16, .155, .15], [.3, .29, .28], aid)
    exposed = np.clip(agg * (1.2 + wear * 2.5) - .25, 0, 1)
    col = base * (1 - exposed[..., None]) + stone * exposed[..., None]
    col *= (.85 + .3 * fine)[..., None]
    rough = .78 + .15 * fine - .2 * exposed * wear
    if wear > 0:
        stains = np.clip((noise(rng, 3, 4) - .55) * 4, 0, 1)
        col = col * (1 - .35 * stains[..., None]) + np.array([.11, .105, .1]) * .35 * stains[..., None] * wear
        cracks = np.clip(1 - np.abs(noise(rng, 5, 5) - .5) * 70, 0, 1) * (noise(rng, 2, 2) > .45)
        h = h - cracks * .5 * wear; col *= (1 - .5 * cracks * wear)[..., None]
        # sealed cracks: thin glossy tar lines
        seal = np.clip(1 - np.abs(noise(rng, 4, 5) - .5) * 160, 0, 1) * (noise(rng, 2, 3) > .5)
        col = col * (1 - seal[..., None]) + np.array([.03, .03, .032]) * seal[..., None]; rough = rough * (1 - seal) + .35 * seal
    if patched:
        pm = noise(rng, 2, 3); patch = (pm > .62).astype(float); patch = blur(patch, 2)
        col = col * (1 - patch[..., None]) + mix([.04, .04, .045], [.06, .06, .065], fine) * patch[..., None]
        rough = rough * (1 - patch) + .72 * patch
    n = normal_from_height(h, 6); ao = ao_from_height(h, 4, 3)
    save(name, col, h, n, rough, ao)

def concrete(rng):
    h = noise(rng, 32, 5) * .6 + noise(rng, 4, 3) * .4
    col = mix([.42, .41, .39], [.56, .55, .52], noise(rng, 3, 4)) * (.9 + .2 * noise(rng, 96, 2))[..., None]
    joint = ((np.mgrid[0:N, 0:N][1] % 512) < 5).astype(float)
    col *= (1 - .45 * joint)[..., None]; h -= joint * .4
    save('concrete', col, h, normal_from_height(h, 3), .85 + .1 * noise(rng, 16, 3), ao_from_height(h, 3, 2))

def gravel(rng):
    H, ID = stones(rng, 14000, 2, 8)
    dust = noise(rng, 48, 3)
    h = H * .8 + dust * .2
    col = mix([.36, .33, .29], [.58, .55, .5], ID) * (H > .05)[..., None] + mix([.3, .27, .23], [.4, .37, .32], dust) * (H <= .05)[..., None]
    save('gravel', col, h, normal_from_height(h, 8), .9 - .1 * H, ao_from_height(h, 5, 4))

def dirt(rng):
    h = noise(rng, 8, 6) * .7 + stones(rng, 2500, 1.5, 4)[0] * .3
    col = mix([.24, .17, .11], [.4, .3, .2], noise(rng, 5, 5)) * (.85 + .3 * noise(rng, 80, 2))[..., None]
    save('dirt-path', col, h, normal_from_height(h, 5), .92, ao_from_height(h, 5, 3))

def cobble(rng):
    y, x = np.mgrid[0:N, 0:N]; s = 64
    row = (y // (s // 1.5)).astype(int); off = (row % 2) * s / 2
    cx = ((x + off) % s) / s - .5; cy = (y % (s // 1.5)) / (s / 1.5) - .5
    d = np.maximum(np.abs(cx) * 1.1, np.abs(cy) * 1.25)
    h = np.clip(1 - (d / .5) ** 6, 0, 1) * (.8 + .2 * noise(rng, 16, 3))
    sid = ((x + off) // s + row * 37) % 97 / 97
    col = mix([.25, .22, .2], [.42, .36, .32], sid * .7 + noise(rng, 24, 3) * .3) * (h > .1)[..., None] + np.array([.16, .15, .13]) * (h <= .1)[..., None]
    save('cobble', col, h, normal_from_height(h, 5), .8 - .15 * h, ao_from_height(h, 6, 3))

def turf(rng):
    blades = noise(rng, 256, 2) * .6 + noise(rng, 64, 3) * .4
    clumps = noise(rng, 6, 4)
    h = blades * .7 + clumps * .3
    col = mix([.07, .12, .03], [.2, .3, .08], blades * .6 + clumps * .4)
    dry = np.clip((noise(rng, 3, 4) - .5) * 3, 0, 1)
    col = col * (1 - .5 * dry[..., None]) + np.array([.32, .3, .12]) * .5 * dry[..., None]
    save('turf', col, h, normal_from_height(h, 4), .9, ao_from_height(h, 3, 2.5))

def litter(rng):
    H, ID = stones(rng, 6000, 3, 11, .6)
    soil = noise(rng, 16, 4)
    h = H + soil * .2
    leaf = mix([.35, .12, .04], [.62, .42, .12], ID)
    col = leaf * (H > .03)[..., None] + mix([.12, .08, .05], [.2, .14, .08], soil) * (H <= .03)[..., None]
    save('leaf-litter', col, h, normal_from_height(h, 5), .85, ao_from_height(h, 5, 4))

def rock(rng):
    h = noise(rng, 3, 7, .55)
    strata = np.sin((np.mgrid[0:N, 0:N][0] / N * 2 * np.pi * 9) + noise(rng, 4, 3) * 6) * .5 + .5
    h = h * .7 + strata * .3
    col = mix([.3, .29, .27], [.55, .53, .5], h) * (.85 + .3 * noise(rng, 64, 2))[..., None]
    lichen = np.clip((noise(rng, 8, 4) - .62) * 5, 0, 1)
    col = col * (1 - lichen[..., None]) + np.array([.42, .45, .3]) * lichen[..., None]
    save('rock', col, h, normal_from_height(h, 7), .8, ao_from_height(h, 8, 2.5))

SETS = {
    'asphalt-new': lambda r: asphalt(r, 0, False, 'asphalt-new'),
    'asphalt-worn': lambda r: asphalt(r, 1, False, 'asphalt-worn'),
    'asphalt-patched': lambda r: asphalt(r, .7, True, 'asphalt-patched'),
    'concrete': concrete, 'gravel': gravel, 'dirt-path': dirt, 'cobble': cobble, 'turf': turf, 'leaf-litter': litter, 'rock': rock,
}
if __name__ == '__main__':
    names = sys.argv[1:] or list(SETS)
    for k in names: SETS[k](np.random.default_rng(sum(map(ord, k)) * 7919))   # (seeded by name: the same tiles every run)
