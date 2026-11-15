#!/usr/bin/env python3
"""Bake real terrain and lakes for a scene from the AWS Terrain Tiles.

    python3 tools/build_scene_terrain.py route28

Writes routes/scenes/<id>.terrain.bin and the "terrainData" block (grid, lakes)
in routes/scenes/<id>.json. Needs internet the first time (tiles are cached in
tools/.cache) plus numpy, scipy and Pillow.

The USGS elevation behind the tiles is hydro-flattened: every lake is one exact
height. A connected flat area is a lake, its height is the water level, and its
edge is the shoreline — no map download needed, and the shorelines match the
aerial imagery and the real horizon that the app shows beyond 1.5 km.

Binary layout (little-endian), each a row-major W x H grid, row 0 = north:
  Int16  elevation, decimetres above BASE_M
  Int16  signed distance to the nearest lake shore, decimetres (negative = water), clamped to ±SDF_MAX_M
  Uint8  lake index + 1 of the nearest lake (0 = none within SDF_MAX_M)
"""
import json, math, os, re, sys
import numpy as np
from scipy import ndimage
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import build_park_routes as parks  # noqa: E402  (shares the DEM tile cache and downloader)

Z = 14
CELL_M = 30           # output grid
MARGIN_M = 2600       # corridor around the route
BASE_M = 0
SDF_MAX_M = 300
MIN_LAKE_HA = 3

# Names for the lakes the route passes, matched to the nearest detected lake at this level.
NAMES = {
    'route28': [
        ('Old Forge Pond', 43.7109, -74.9654), ('Fourth Lake', 43.7600, -74.8350),
        ('First, Second and Third Lake', 43.7194, -74.9169), ('Fifth Lake', 43.7530, -74.7930),
        ('Sixth and Seventh Lake', 43.7452, -74.7463),
        ('Eighth Lake', 43.7791, -74.7025), ('Limekiln Lake', 43.7125, -74.7994),
    ],
}


def mosaic(lat0, lat1, lon0, lon1):
    n = 2 ** Z
    tx = lambda lon: int((lon + 180) / 360 * n)
    def ty(lat):
        r = math.radians(lat)
        return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)
    x0, x1, y0, y1 = tx(lon0), tx(lon1), ty(lat1), ty(lat0)
    M = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), np.float64)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            parks.dem_tile(x, y)
            im = np.asarray(Image.open(os.path.join(parks.CACHE, f'dem-{Z}-{x}-{y}.png')).convert('RGB')).astype(np.float64)
            M[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = im[..., 0] * 256 + im[..., 1] + im[..., 2] / 256 - 32768
    return M, x0, y0


def pixel_of(lat, lon, x0, y0):
    n = 2 ** Z
    fx = (lon + 180) / 360 * n * 256 - x0 * 256
    r = np.radians(lat)
    fy = (1 - np.log(np.tan(r) + 1 / np.cos(r)) / math.pi) / 2 * n * 256 - y0 * 256
    return fx - .5, fy - .5


def main(key):
    gpx = open(os.path.join(ROOT, 'routes', 'parks', f'{key}.gpx')).read()
    pts = np.array([(float(a), float(b)) for a, b in re.findall(r'lat="([\d.-]+)" lon="([\d.-]+)"', gpx)])
    mid = pts[:, 0].mean()
    dlat, dlon = MARGIN_M / 111320, MARGIN_M / (111320 * math.cos(math.radians(mid)))
    lat0, lat1 = pts[:, 0].min() - dlat, pts[:, 0].max() + dlat
    lon0, lon1 = pts[:, 1].min() - dlon, pts[:, 1].max() + dlon
    M, x0, y0 = mosaic(lat0 - .01, lat1 + .01, lon0 - .01, lon1 + .01)
    px_m = 2 * math.pi * 6378137 * math.cos(math.radians(mid)) / 2 ** Z / 256

    # Lakes: connected, exactly flat areas
    gx = np.abs(np.diff(M, axis=1, append=M[:, -1:])); gy = np.abs(np.diff(M, axis=0, append=M[-1:, :]))
    gx2 = np.abs(np.diff(M, axis=1, prepend=M[:, :1])); gy2 = np.abs(np.diff(M, axis=0, prepend=M[:1, :]))
    flat = (np.maximum.reduce([gx, gy, gx2, gy2]) < .02)
    lab, count = ndimage.label(flat)
    areas = ndimage.sum(np.ones_like(M), lab, range(1, count + 1)) * px_m * px_m / 1e4
    lakes, water = [], np.zeros(M.shape, np.int16)
    for k in np.argsort(-areas):
        if areas[k] < MIN_LAKE_HA: break
        comp = lab == k + 1
        level = float(np.median(M[comp]))
        # include the shoreline pixels the strict flatness test dropped
        comp = ndimage.binary_dilation(comp, iterations=2) & (np.abs(M - level) < .15)
        # a lake sits in a basin; a flat field or a hydro-flattened river doesn't rise all round
        ring = ndimage.binary_dilation(comp, iterations=8) & ~ndimage.binary_dilation(comp, iterations=3)
        if np.mean(M[ring] > level + .25) < .6: continue
        ys, xs = np.nonzero(comp)
        n2 = 2 ** Z * 256
        lon_c = ((xs.mean() + x0 * 256 + .5) / n2) * 360 - 180
        lat_c = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ys.mean() + y0 * 256 + .5) / n2))))
        if not (lat0 <= lat_c <= lat1 and lon0 <= lon_c <= lon1): continue
        lakes.append({'level': round(level, 2), 'areaHa': round(float(comp.sum() * px_m * px_m / 1e4), 1), 'lat': round(lat_c, 5), 'lon': round(lon_c, 5)})
        water[comp & (water == 0)] = len(lakes)
    # name lakes
    for name, la, lo in NAMES.get(key, []):
        best = min(lakes, key=lambda l: (l['lat'] - la) ** 2 + ((l['lon'] - lo) * math.cos(math.radians(la))) ** 2, default=None)
        if best and 'name' not in best and math.hypot(best['lat'] - la, (best['lon'] - lo) * .72) < .02: best['name'] = name

    # Signed distance to shore (pixels → metres) and nearest lake
    inside = water > 0
    d_out, (iy, ix) = ndimage.distance_transform_edt(~inside, return_indices=True)
    d_in = ndimage.distance_transform_edt(inside)
    sdf = np.where(inside, -d_in, d_out) * px_m
    nearest = water[iy, ix]

    # Resample everything on a regular lat/lon grid
    W = int(round((lon1 - lon0) * 111320 * math.cos(math.radians(mid)) / CELL_M)) + 1
    H = int(round((lat1 - lat0) * 111320 / CELL_M)) + 1
    lats = np.linspace(lat1, lat0, H); lons = np.linspace(lon0, lon1, W)
    LO, LA = np.meshgrid(lons, lats)
    fx, fy = pixel_of(LA, LO, x0, y0)
    elev = ndimage.map_coordinates(M, [fy, fx], order=1, mode='nearest')
    s = ndimage.map_coordinates(sdf, [fy, fx], order=1, mode='nearest')
    ids = nearest[np.clip(np.round(fy).astype(int), 0, M.shape[0] - 1), np.clip(np.round(fx).astype(int), 0, M.shape[1] - 1)]
    ids = np.where(s < SDF_MAX_M, ids, 0)
    s = np.clip(s, -SDF_MAX_M, SDF_MAX_M)
    out = os.path.join(ROOT, 'routes', 'scenes', f'{key}.terrain.bin')
    with open(out, 'wb') as f:
        f.write(np.round((elev - BASE_M) * 10).astype('<i2').tobytes())
        f.write(np.round(s * 10).astype('<i2').tobytes())
        f.write(ids.astype(np.uint8).tobytes())
    used = sorted(set(ids.flatten().tolist()) - {0})
    scene_path = os.path.join(ROOT, 'routes', 'scenes', f'{key}.json')
    scene = json.load(open(scene_path))
    scene['terrainData'] = {
        'file': f'routes/scenes/{key}.terrain.bin', 'format': 'bikefree-terrain-1',
        'north': round(lat1, 6), 'south': round(lat0, 6), 'west': round(lon0, 6), 'east': round(lon1, 6),
        'width': W, 'height': H, 'baseM': BASE_M, 'sdfMaxM': SDF_MAX_M,
        'lakes': [{**lakes[i - 1], 'id': i} for i in used],
    }
    json.dump(scene, open(scene_path, 'w'), indent=2); open(scene_path, 'a').write('\n')
    print(f'{key}: {W}x{H} grid at {CELL_M} m, {os.path.getsize(out) / 1e6:.2f} MB, {len(used)} lakes near the route')
    for l in scene['terrainData']['lakes']:
        print(f"  {l.get('name', '(unnamed)'):30s} {l['areaHa']:7.1f} ha  level {l['level']:.2f} m  {l['lat']:.4f},{l['lon']:.4f}")


if __name__ == '__main__':
    for key in sys.argv[1:] or ['route28']:
        main(key)
