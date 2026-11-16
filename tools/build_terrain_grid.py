#!/usr/bin/env python3
"""Bake real elevation around a route into a bundled height grid ("bikefree-terrain-grid-1").

Used by the Big Sur hero map: the stylized renderer draws the real landform (sea cliffs,
the Bixby Creek gorge, Hurricane Point) from this grid, offline, with no tile requests.
Pittsburgh uses it too (inland: "rivers" mode), for Mount Washington's bluff and the hills to the horizon.

  python3 tools/build_terrain_grid.py bigsur
  python3 tools/build_terrain_grid.py pittsburgh

Reads   routes/parks/<id>.gpx, routes/scenes/<id>.json ("terrainBuild": settings)
Writes  routes/scenes/<id>-terrain.json
Source  AWS Terrain Tiles (terrarium, z14 ≈ 8 m), cached in ~/.cache/bikefree-dem

Layout
  coarse  one grid over the whole box (route + pad), 40 m (every 4th fine sample)
  fine    10 m blocks of 64×64 cells, only where a block lies within `fineM` of the road
  heights uint16 (h - base) / scale, stored as wrapping differences along each row, base64;
          ocean floor clamped to `floorM`
  water   (inland "rivers" mode) a 20 m river mask over the whole box, as run lengths [value, run, …]:
          the hydro-flattened river surfaces (dead flat, near the city's water level) connected to the
          rivers the city's own data maps. The city's land grid covers only the middle of the box.
"""
import base64, io, json, math, os, re, sys, urllib.request
from pathlib import Path

import numpy as np
from scipy import ndimage
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path.home() / '.cache' / 'bikefree-dem'
Z = 14
BASE, SCALE = -100.0, 0.1


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    r = math.radians(lat)
    y = (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n
    return x, y


def fetch(z, x, y):
    path = CACHE / f'{z}-{x}-{y}.png'
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
        with urllib.request.urlopen(url, timeout=60) as r: path.write_bytes(r.read())
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


class Mosaic:
    """Bilinear elevation lookup over a block of z14 tiles."""
    def __init__(self, north, west, south, east):
        x0, y0 = tile_xy(north, west, Z); x1, y1 = tile_xy(south, east, Z)
        self.tx0, self.ty0 = int(x0), int(y0)
        nx, ny = int(x1) - self.tx0 + 1, int(y1) - self.ty0 + 1
        self.h = np.zeros((ny * 256, nx * 256))
        print(f'  {nx * ny} terrain tiles (z{Z})')
        for j in range(ny):
            for i in range(nx):
                self.h[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = fetch(Z, self.tx0 + i, self.ty0 + j)

    def sample(self, lat, lon):
        lat, lon = np.asarray(lat, float), np.asarray(lon, float)
        x, y = tile_xy_vec(lat, lon)
        px, py = (x - self.tx0) * 256 - .5, (y - self.ty0) * 256 - .5
        px = np.clip(px, 0, self.h.shape[1] - 1.001); py = np.clip(py, 0, self.h.shape[0] - 1.001)
        i, j = px.astype(int), py.astype(int); a, b = px - i, py - j
        H = self.h
        return (H[j, i] * (1 - a) + H[j, i + 1] * a) * (1 - b) + (H[j + 1, i] * (1 - a) + H[j + 1, i + 1] * a) * b


def tile_xy_vec(lat, lon):
    n = 2 ** Z
    r = np.radians(lat)
    return (lon + 180) / 360 * n, (1 - np.log(np.tan(r) + 1 / np.cos(r)) / np.pi) / 2 * n


def pack(h, floor):
    """Quantize, then store each row as differences along the row (small numbers: compresses ~3× better)."""
    q = np.clip(np.round((np.maximum(h, floor) - BASE) / SCALE), 0, 65535).astype(np.int64)
    d = np.diff(q, axis=-1, prepend=0)
    return base64.b64encode((d & 0xFFFF).astype('<u2').tobytes()).decode()


def main():
    rid = sys.argv[1] if len(sys.argv) > 1 else 'bigsur'
    scene = json.loads((ROOT / f'routes/scenes/{rid}.json').read_text())
    cfg = {'padM': 6000, 'coarseM': 40, 'fineM': 900, 'fineCellM': 10, 'floorM': -45, 'seaBelowM': 3.0, **scene.get('terrainBuild', {})}
    gpx = (ROOT / scene.get('terrainBuild', {}).get('gpx', f'routes/parks/{rid}.gpx')).read_text()
    pts = np.array([(float(a), float(b)) for a, b in re.findall(r'lat="([\d.-]+)" lon="([\d.-]+)"', gpx)])
    lat0 = pts[:, 0].mean()
    mlat, mlon = 111320.0, 111320.0 * math.cos(math.radians(lat0))
    pad = cfg['padM']
    north, south = pts[:, 0].max() + pad / mlat, pts[:, 0].min() - pad / mlat
    west, east = pts[:, 1].min() - pad / mlon, pts[:, 1].max() + pad / mlon
    print(f'{rid}: box {north:.4f} {west:.4f} → {south:.4f} {east:.4f}')
    M = Mosaic(north, west, south, east)

    # One 10 m master raster over the box, then fix the sea: the source fills the near-shore ocean
    # with flat 0–3 m "land". Sea = low ground connected to the open ocean (west edge); it gets a
    # gently shelving sea floor so the water shader can shade shallows and break surf on the shore.
    fm = cfg['fineCellM']
    fnx, fny = int((east - west) * mlon / fm) + 1, int((north - south) * mlat / fm) + 1
    east, south = west + (fnx - 1) * fm / mlon, north - (fny - 1) * fm / mlat
    LO, LA = np.meshgrid(west + np.arange(fnx) * fm / mlon, north - np.arange(fny) * fm / mlat)
    H = M.sample(LA, LO)
    if cfg.get('rivers'):
        water = rivers(H, LA, LO, scene, cfg)
        finish(rid, cfg, pts, gpx, M, H, north, west, south, east, fnx, fny, mlat, mlon, water)
        return
    if cfg.get('lakes'):
        del LA, LO
        ids, lakes = find_lakes(H, cfg, north, west, mlat, mlon)
        finish(rid, cfg, pts, gpx, M, H, north, west, south, east, fnx, fny, mlat, mlon, ids, lakes)
        return
    low = H < cfg['seaBelowM']
    lab, _ = ndimage.label(low)
    edge = np.unique(lab[:, 0]); edge = edge[edge > 0]
    sea = np.isin(lab, edge)
    sea = ndimage.binary_closing(ndimage.binary_opening(sea, iterations=2), iterations=2)
    sea[:, 0] = True
    # islands of flat fill out at sea (rectangular source seams) are sea too; real rocks stand tall
    land, n = ndimage.label(~sea)
    tall = ndimage.maximum(H, land, index=np.arange(1, n + 1))
    sizes = ndimage.sum(np.ones_like(H), land, index=np.arange(1, n + 1))
    main = 1 + int(np.argmax(sizes))
    drop = [i + 1 for i in range(n) if i + 1 != main and tall[i] < 12]
    sea |= np.isin(land, drop)
    offshore = ndimage.distance_transform_edt(sea) * fm
    noise = ndimage.gaussian_filter(np.random.default_rng(7).standard_normal(H.shape), 12) * 30
    floor = -(1.2 + np.minimum(offshore * .055 + np.maximum(noise, -1), -cfg['floorM'] - 1.2))
    H = np.where(sea, np.minimum(floor, -0.6), np.maximum(H, 0.4))
    print(f'  master {fnx}×{fny} @ {fm} m; sea {sea.mean() * 100:.0f}% of the box')
    finish(rid, cfg, pts, gpx, M, H, north, west, south, east, fnx, fny, mlat, mlon, None)


def rivers(H, LA, LO, scene, cfg):
    """Inland: rivers are the dead-flat surfaces near the city's water level that touch its mapped rivers."""
    city = json.loads((ROOT / scene['cityData']).read_text())
    level = city['waterLevelM']
    g, L = city['grid'], city['land']
    land = np.zeros(L['nx'] * L['ny'], np.uint8)
    k = 0
    for v, n in zip(L['rle'][0::2], L['rle'][1::2]): land[k:k + n] = v; k += n
    land = land.reshape(L['ny'], L['nx'])
    # city land cell under each master cell (or -1 outside the city's box)
    u = np.round((LO - g['west']) / (g['east'] - g['west']) * (L['nx'] - 1)).astype(int)
    v = np.round((g['north'] - LA) / (g['north'] - g['south']) * (L['ny'] - 1)).astype(int)
    inside = (u >= 0) & (v >= 0) & (u < L['nx']) & (v < L['ny'])
    mapped = np.zeros(H.shape, bool)
    mapped[inside] = land[v[inside], u[inside]] == 3
    span = ndimage.maximum_filter(H, 5) - ndimage.minimum_filter(H, 5)
    flat = (span < cfg.get('flatM', .35)) & (np.abs(H - level) < cfg.get('poolsM', 5))
    flat = ndimage.binary_opening(flat, iterations=2) | mapped
    lab, _ = ndimage.label(flat)
    keep = np.unique(lab[mapped]); keep = keep[keep > 0]
    water = np.isin(lab, keep)
    # the next pools up and down the rivers (beyond the locks) aren't connected: any large surface that is
    # dead flat (hydro-flattened water) within a few metres of the city's level is river too
    pool = (span < .12) & (np.abs(H - level) < cfg.get('otherPoolsM', 9))
    plab, n = ndimage.label(ndimage.binary_opening(pool, iterations=2))
    if n:
        size = ndimage.sum(np.ones_like(H), plab, index=np.arange(1, n + 1))
        big = np.flatnonzero(size >= cfg.get('poolCells', 2000)) + 1
        water |= np.isin(plab, big)
    water = ndimage.binary_closing(water, iterations=3)
    water[inside] = mapped[inside]   # inside the city's box its own (OSM) rivers are the truth
    print(f'  rivers: {water.mean() * 100:.1f}% of the box is water (level {level} m)')
    return water


def find_lakes(H, cfg, north, west, mlat, mlon):
    """Inland mountains: lakes are the hydro-flattened surfaces — connected, dead-flat areas that sit in a
    basin (the ground rises all round). Each gets its own level. Returns a lake-id raster (0 = land) and the list."""
    fm = cfg['fineCellM']
    span = ndimage.maximum_filter(H, 3) - ndimage.minimum_filter(H, 3)
    flat = ndimage.binary_opening(span < cfg.get('flatM', .08), iterations=1)
    lab, n = ndimage.label(flat)
    if not n: return np.zeros(H.shape, np.uint8), []
    size = ndimage.sum(np.ones_like(H), lab, index=np.arange(1, n + 1)) * fm * fm / 1e4   # hectares
    names = cfg.get('lakeNames', [])
    ids, lakes = np.zeros(H.shape, np.uint8), []
    for k in np.argsort(-size):
        if size[k] < cfg.get('minLakeHa', 4) or len(lakes) >= 250: break
        comp = lab == k + 1
        ys, xs = np.nonzero(comp)
        y0, y1, x0, x1 = max(ys.min() - 12, 0), ys.max() + 13, max(xs.min() - 12, 0), xs.max() + 13
        sub, hs = comp[y0:y1, x0:x1], H[y0:y1, x0:x1]
        level = float(np.median(hs[sub]))
        sub = ndimage.binary_dilation(sub, iterations=2) & (np.abs(hs - level) < .2)
        ring = ndimage.binary_dilation(sub, iterations=8) & ~ndimage.binary_dilation(sub, iterations=3)
        if ring.any() and np.mean(hs[ring] > level + .25) < .6: continue   # a flat field or river, not a basin
        sub = ndimage.binary_closing(sub, iterations=2) & (hs < level + .6)
        ids[y0:y1, x0:x1][sub & (ids[y0:y1, x0:x1] == 0)] = len(lakes) + 1
        lat, lon = north - ys.mean() * fm / mlat, west + xs.mean() * fm / mlon
        lake = {'id': len(lakes) + 1, 'level': round(level, 2), 'areaHa': round(float(sub.sum() * fm * fm / 1e4), 1),
                'lat': round(lat, 5), 'lon': round(lon, 5)}
        for name, la, lo in names:
            if math.hypot((la - lat) * mlat, (lo - lon) * mlon) < cfg.get('nameRadiusM', 2500) and not any(l.get('name') == name for l in lakes):
                lake['name'] = name; break
        lakes.append(lake)
    print(f'  lakes: {len(lakes)} ({(ids > 0).mean() * 100:.1f}% of the box)')
    for l in lakes[:12]: print(f"    {l.get('name', '(unnamed)'):24s} {l['areaHa']:8.1f} ha  level {l['level']:7.1f} m")
    return ids, lakes


def finish(rid, cfg, pts, gpx, M, H, north, west, south, east, fnx, fny, mlat, mlon, water, lakes=None):
    fm = cfg['fineCellM']

    # coarse grid (every k-th master sample)
    k = max(1, round(cfg['coarseM'] / fm))
    coarse = H[::k, ::k]
    cny, cnx = coarse.shape
    print(f'  coarse {cnx}×{cny} @ {k * fm} m, {coarse.min():.0f}–{coarse.max():.0f} m')

    # fine blocks near the road (blocks share their edge row/column)
    B = 64
    bnx, bny = (fnx - 2) // B + 1, (fny - 2) // B + 1
    Hp = np.pad(H, ((0, bny * B + 1 - fny), (0, bnx * B + 1 - fnx)), mode='edge')
    rx = (pts[::3, 1] - west) * mlon; rz = (north - pts[::3, 0]) * mlat
    blocks, data = [], []
    for bj in range(bny):
        for bi in range(bnx):
            cx, cz = (bi + .5) * B * fm, (bj + .5) * B * fm
            d = np.min(np.maximum(np.abs(rx - cx) - B * fm / 2, 0) ** 2 + np.maximum(np.abs(rz - cz) - B * fm / 2, 0) ** 2)
            if math.sqrt(d) > cfg['fineM']: continue
            blocks.append(bj * bnx + bi)
            data.append(Hp[bj * B:bj * B + B + 1, bi * B:bi * B + B + 1])
    fine = np.stack(data)
    print(f'  fine {len(blocks)} blocks of {B}×{B} @ {fm} m ({len(blocks) * (B * fm / 1000) ** 2:.0f} km²)')

    out = {
        'format': 'bikefree-terrain-grid-1', 'rowDelta': True,
        'attribution': 'Elevation: AWS Terrain Tiles (USGS 3DEP, NOAA and others)',
        'north': north, 'west': west, 'south': south, 'east': east,
        'base': BASE, 'scale': SCALE, 'floorM': cfg['floorM'],
        'coarse': {'nx': cnx, 'ny': cny, 'step': k, 'h': pack(coarse, cfg['floorM'])},
        'fine': {'cellM': fm, 'block': B, 'bnx': bnx, 'bny': bny, 'nx': fnx, 'ny': fny,
                 'blocks': blocks, 'h': pack(fine, cfg['floorM'])},
    }
    if lakes is not None:
        # lake ids on a 20 m raster (run lengths); the lake bed is pressed down at load time
        w = water[::2, ::2].astype(int).ravel()
        edges = np.flatnonzero(np.diff(w)) + 1
        starts = np.concatenate([[0], edges]); runs = np.diff(np.concatenate([starts, [len(w)]]))
        out['lakes'] = {'cellM': fm * 2, 'nx': water[::2, ::2].shape[1], 'ny': water[::2, ::2].shape[0],
                        'rle': [int(x) for pair in zip(w[starts], runs) for x in pair], 'list': lakes}
    elif water is not None:
        w = water[::2, ::2].astype(int).ravel() if fm == 10 else water.astype(int).ravel()
        edges = np.flatnonzero(np.diff(w)) + 1
        starts = np.concatenate([[0], edges]); runs = np.diff(np.concatenate([starts, [len(w)]]))
        out['water'] = {'cellM': fm * 2 if fm == 10 else fm, 'nx': water[::2, ::2].shape[1] if fm == 10 else fnx,
                        'ny': water[::2, ::2].shape[0] if fm == 10 else fny,
                        'rle': [int(x) for pair in zip(w[starts], runs) for x in pair]}
    path = ROOT / f'routes/scenes/{rid}-terrain.json'
    path.write_text(json.dumps(out, separators=(',', ':')))
    print(f'  wrote {path.relative_to(ROOT)} ({path.stat().st_size / 1e6:.1f} MB)')

    # Report spans where the real ground drops well below the road: bridges to add to the scene.
    r = np.array([(float(a), float(b), float(c)) for a, b, c in re.findall(r'lat="([\d.-]+)" lon="([\d.-]+)"><ele>([\d.-]+)', gpx)])
    g = M.sample(r[:, 0], r[:, 1])   # raw source (before the sea fix)
    dist = np.concatenate([[0], np.cumsum(np.hypot(np.diff(r[:, 0]) * mlat, np.diff(r[:, 1]) * mlon))])
    low = (r[:, 2] - g) > 8
    k = 0
    while k < len(low):
        if low[k]:
            e = k
            while e + 1 < len(low) and low[e + 1]: e += 1
            print(f'  ground below road {dist[k]:.0f}–{dist[e]:.0f} m (max {np.max(r[k:e + 1, 2] - g[k:e + 1]):.0f} m) at {r[k, 0]:.5f},{r[k, 1]:.5f}')
            k = e + 1
        else: k += 1


if __name__ == '__main__':
    main()
