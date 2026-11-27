"""The elevation tiles every map tool reads (code review P8): AWS Terrain Tiles, terrarium PNGs, one shared cache.

    tile_url(z, x, y)                 the tile's URL
    decode(r, g, b)                   metres: r·256 + g + b/256 − 32768 (scalars or numpy arrays)
    fetch_tile(z, x, y, …)            the cached file's path (tools/.cache/dem-<z>-<x>-<y>.png; also takes one from the
                                      old ~/.cache/bikefree-dem/<z>-<x>-<y>.png that build_terrain_grid.py used);
                                      downloads it once (citylib/net.py: offline mode refuses), notes it for provenance
    tile_heights(z, x, y, dtype)      the decoded 256 × 256 numpy array
    Sampler(z, …)(lat, lon)           bilinear height at a point (pixel centres at +0.5), as build_pgh.py,
                                      build_city.py and build_park_routes.py sampled it; nodata_fallback: a hole (a
                                      corner under NODATA_M) reads the next coarser zoom
"""
import math, os
from . import net, provenance
from .geo import global_px

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, 'tools', '.cache')
LEGACY = os.path.join(os.path.expanduser('~'), '.cache', 'bikefree-dem')
Z = 14
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
NODATA_M = -1000   # Terrain Tiles has holes: whole z14 tiles of -32768 m (near Valbonnais, France)
SOURCE = provenance.DEM_SOURCE


def tile_url(z, x, y):
    return URL.format(z=z, x=x, y=y)


def decode(r, g, b):
    return r * 256 + g + b / 256 - 32768


def tile_path(z, x, y, cache=None):
    return os.path.join(cache or CACHE, f'dem-{z}-{x}-{y}.png')


def fetch_tile(z, x, y, pause=0.0, timeout=60, headers=None, cache=None):
    path = tile_path(z, x, y, cache)
    if not os.path.exists(path):
        legacy = os.path.join(LEGACY, f'{z}-{x}-{y}.png')
        if cache is None and os.path.exists(legacy): path = legacy
        else: net.download(tile_url(z, x, y), path, pause=pause, timeout=timeout, headers=headers)
    provenance.used(path)
    return path


def tile_heights(z, x, y, dtype='float64', **kw):
    import numpy as np
    from PIL import Image
    a = np.asarray(Image.open(fetch_tile(z, x, y, **kw)).convert('RGB'), dtype=np.float64)
    return decode(a[..., 0], a[..., 1], a[..., 2]).astype(dtype, copy=False)


class Sampler:
    def __init__(self, z=Z, pause=0.0, timeout=60, headers=None, nodata_fallback=False, min_z=10):
        self.z, self.kw = z, {'pause': pause, 'timeout': timeout, 'headers': headers}
        self.nodata_fallback, self.min_z = nodata_fallback, min_z
        self.tiles = {}

    def rgb(self, z, tx, ty):
        key = (z, tx, ty)
        if key not in self.tiles:
            from PIL import Image
            self.tiles[key] = Image.open(fetch_tile(z, tx, ty, **self.kw)).convert('RGB').load()
        return self.tiles[key]

    def px(self, gx, gy, z=None):
        z = self.z if z is None else z
        r, g, b = self.rgb(z, int(gx // 256), int(gy // 256))[int(gx % 256), int(gy % 256)]
        return decode(r, g, b)

    def __call__(self, lat, lon, z=None):
        z = self.z if z is None else z
        fx, fy = global_px(lat, lon, z)
        x0, y0 = math.floor(fx - .5), math.floor(fy - .5)
        ax, ay = fx - .5 - x0, fy - .5 - y0
        h = [self.px(x0, y0, z), self.px(x0 + 1, y0, z), self.px(x0, y0 + 1, z), self.px(x0 + 1, y0 + 1, z)]
        if self.nodata_fallback and min(h) < NODATA_M and z > self.min_z:
            return self(lat, lon, z - 1)   # a hole in this zoom: the coarser tile has the ground
        return (h[0] * (1 - ax) * (1 - ay) + h[1] * ax * (1 - ay)
                + h[2] * (1 - ax) * ay + h[3] * ax * ay)
