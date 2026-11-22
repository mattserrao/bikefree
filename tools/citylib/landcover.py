"""Land cover from ESA WorldCover 10 m (2021, v200): what the ground really is across a rural map — fields, pasture
and hay, forest, wetland, built-up land, water — for the maps OSM's land use leaves mostly blank (SKAN, user 22 Nov:
"There is a lot of farmland, forests, rural housing, then villages / towns. Ensure these are accurate").

    from citylib.landcover import worldcover_window
    codes, sample = worldcover_window(south, west, north, east)   # sample(lat, lon) -> WorldCover class

WorldCover's 3° × 3° tiles (cloud-optimised GeoTIFFs, 1024 px tiles, deflate) are fetched once into
tools/.cache/worldcover and only the 1024 px blocks the box touches are decoded (tifffile).
Classes: 10 tree cover, 20 shrubland, 30 grassland, 40 cropland, 50 built-up, 60 bare / sparse, 70 snow, 80 water,
90 herbaceous wetland, 95 mangroves, 100 moss.
© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0).
"""
import math, os, urllib.request
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, 'tools', '.cache', 'worldcover')
URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif'
RES = 1 / 12000   # degrees per pixel
ATTRIBUTION = 'Land cover: ESA WorldCover 10 m 2021 v200 (CC BY 4.0)'


def _tile_name(lat, lon):
    la, lo = math.floor(lat / 3) * 3, math.floor(lon / 3) * 3
    return f'{"N" if la >= 0 else "S"}{abs(la):02d}{"E" if lo >= 0 else "W"}{abs(lo):03d}', la + 3, lo


def _fetch(name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'ESA_WorldCover_10m_2021_v200_{name}_Map.tif')
    if not os.path.exists(path):
        print(f'  WorldCover: fetching {name} (~90 MB, once)')
        with urllib.request.urlopen(URL.format(name), timeout=600) as r, open(path + '.part', 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
        os.replace(path + '.part', path)
    return path


def _read(path, top, left, r0, r1, c0, c1):
    """Rows r0..r1, cols c0..c1 (pixels from the tile's top-left) of a WorldCover tile, decoding only the blocks hit."""
    import tifffile
    with tifffile.TiffFile(path) as t:
        p = t.pages[0]
        tw, tl = p.tilewidth, p.tilelength
        per_row = (p.shape[1] + tw - 1) // tw
        out = np.zeros((r1 - r0, c1 - c0), np.uint8)
        fh = t.filehandle
        for bj in range(r0 // tl, (r1 - 1) // tl + 1):
            for bi in range(c0 // tw, (c1 - 1) // tw + 1):
                k = bj * per_row + bi
                fh.seek(p.dataoffsets[k]); data = fh.read(p.databytecounts[k])
                block = p.decode(data, k)[0].reshape(tl, tw)
                y0, x0 = bj * tl, bi * tw
                ya, yb = max(r0, y0), min(r1, y0 + tl); xa, xb = max(c0, x0), min(c1, x0 + tw)
                out[ya - r0:yb - r0, xa - c0:xb - c0] = block[ya - y0:yb - y0, xa - x0:xb - x0]
    return out


def worldcover_window(south, west, north, east):
    """The classes over the box (rows north → south) and a nearest-pixel sampler sample(lat, lon) (0 outside)."""
    tiles = {}
    for la in (south, north):
        for lo in (west, east): tiles[_tile_name(la, lo)[0]] = _tile_name(la, lo)
    top0, left0 = math.ceil(north / RES) * RES, math.floor(west / RES) * RES
    ny, nx = int(round((top0 - south) / RES)) + 1, int(round((east - left0) / RES)) + 1
    codes = np.zeros((ny, nx), np.uint8)
    for name, top, left in tiles.values():
        path = _fetch(name)
        # this tile's part of the window, in the tile's pixels and the window's
        r0, c0 = max(0, int(round((top - top0) / RES))), max(0, int(round((left0 - left) / RES)))
        r1, c1 = min(36000, int(round((top - south) / RES)) + 1), min(36000, int(round((east - left) / RES)) + 1)
        if r1 <= r0 or c1 <= c0: continue
        block = _read(path, top, left, r0, r1, c0, c1)
        wr, wc = int(round((top - r0 * RES - top0) / -RES)), int(round((left + c0 * RES - left0) / RES))
        codes[wr:wr + block.shape[0], wc:wc + block.shape[1]] = block[:ny - wr, :nx - wc]
    def sample(lat, lon):
        lat, lon = np.asarray(lat), np.asarray(lon)
        r = np.clip(((top0 - lat) / RES).astype(int), 0, ny - 1); c = np.clip(((lon - left0) / RES).astype(int), 0, nx - 1)
        return codes[r, c]
    return codes, sample
