#!/usr/bin/env python3
"""Where a reference photo looks, from its skyline (user, 27 Nov 2026: matched shots against the real places).

Commons photos carry a place but rarely a heading or a lens. The land's own skyline gives both: the photo's sky is
found (the bright, blue-or-white region joined to the top edge), its lower edge read column by column as an elevation
angle; the DEM's horizon is traced from the photo's place, eye 1.6 m up, every 0.25°; then the heading, horizontal
field of view and pitch that line the two up best (a robust mean of the angle differences) are kept.

  python3 tools/reference/match_view.py <map> <photo file> [...]   → tools/reference/<map>-views.json (merged)
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from citylib.warp import Dem

dem = Dem()
KY = 110540.0


def horizon(lat, lon, eye=1.6, step=.25, maxM=30000):
    """The DEM's horizon elevation angle (rad) every `step` degrees of azimuth (0 = north, clockwise)."""
    kx = 111320 * math.cos(math.radians(lat))
    h0 = float(dem(np.array([lat]), np.array([lon]))[0]) + eye
    az = np.radians(np.arange(0, 360, step))
    d = np.concatenate([np.arange(30, 600, 15), np.arange(600, 4000, 40), np.arange(4000, maxM, 150)])
    A, D = np.meshgrid(az, d, indexing='ij')
    la = lat + D * np.cos(A) / KY; lo = lon + D * np.sin(A) / kx
    H = dem(la, lo)
    ang = np.arctan((H - h0 - D * D * .87 / (2 * 6.371e6)) / D)
    return np.max(ang, axis=1), h0


def skyline(path):
    """The photo's skyline: for each column, the row where the sky meets the land (None where it doesn't reach)."""
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32) / 255
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    lum = (r + g + b) / 3
    sky = ((b >= r - .02) & (lum > .42)) | ((lum > .82) & (np.abs(r - b) < .08))   # (blue sky, or white cloud)
    lab, _ = ndimage.label(sky)
    top = set(np.unique(lab[0])) - {0}
    sky = np.isin(lab, list(top))
    sky = ndimage.binary_opening(sky, iterations=2)
    H, W = sky.shape
    rows = np.full(W, -1.0)
    for x in range(W):
        col = sky[:, x]
        if not col[0]: continue
        k = np.argmin(col)   # (first non-sky pixel from the top)
        if col[k]: continue   # (all sky)
        rows[x] = k
    return rows, W, H


def match(path, lat, lon):
    rows, W, H = skyline(path)
    hz, h0 = horizon(lat, lon)
    xs = np.nonzero(rows >= 0)[0]
    if len(xs) < W * .3: return None
    best = (1e9, None)
    for hfov in np.arange(22, 78, 2.0):   # (24–90 mm equivalent; check each fit by eye: tools/reference/overlay)
        f = (W / 2) / math.tan(math.radians(hfov / 2))
        azc = np.degrees(np.arctan((xs - W / 2) / f))
        el = np.arctan((H / 2 - rows[xs]) / f)   # (photo elevation angle before pitch)
        for heading in np.arange(0, 360, 1.0):
            az = (heading + azc) % 360
            hzv = hz[(np.round(az / .25).astype(int)) % len(hz)]
            diff = el - hzv
            pitch = np.median(diff)   # (the pitch that lines them up best)
            # (the misfit in pixels — the reprojection error: in angles a narrow lens would always win)
            err = np.mean(np.abs(np.tan(el) - np.tan(hzv + pitch))) * f
            if err < best[0]: best = (err, (float(heading), float(hfov), float(math.degrees(-pitch))))
    # refine heading by 0.25°
    err0, (hd, hf, pt) = best
    f = (W / 2) / math.tan(math.radians(hf / 2))
    azc = np.degrees(np.arctan((xs - W / 2) / f)); el = np.arctan((H / 2 - rows[xs]) / f)
    for heading in np.arange(hd - 1, hd + 1, .25):
        hzv = hz[(np.round(((heading + azc) % 360) / .25).astype(int)) % len(hz)]
        diff = el - hzv; p = np.median(diff); e = np.mean(np.abs(np.tan(el) - np.tan(hzv + p))) * f
        if e < best[0]: best = (e, (float(heading % 360), hf, float(math.degrees(-p))))
    err, (heading, hfov, pitch) = best
    hzv = hz[(np.round(((heading + azc) % 360) / .25).astype(int)) % len(hz)]
    raw = float(np.mean(np.abs(el - hzv - np.median(el - hzv))))   # (degrees, for the record)
    return {'heading': round(heading, 2), 'hfov': hfov, 'vfov': round(math.degrees(2 * math.atan(math.tan(math.radians(hfov / 2)) * H / W)), 2),
            'pitch': round(pitch, 2), 'skylineErrDeg': round(math.degrees(raw), 3), 'fitPx': round(float(err), 1), 'skyCols': round(len(xs) / W, 2), 'eyeM': round(h0, 1), 'aspect': round(W / H, 4)}


if __name__ == '__main__':
    mid, files = sys.argv[1], sys.argv[2:]
    man = json.load(open(os.path.join(ROOT, 'tools', 'reference', f'{mid}-photos.json')))
    ph = {p['file']: p for sp in man['spots'] for p in sp['photos'] if p.get('file')}
    out_path = os.path.join(ROOT, 'tools', 'reference', f'{mid}-views.json')
    views = json.load(open(out_path)) if os.path.exists(out_path) else {}
    for f in files:
        p = ph[f]
        m = match(os.path.join(ROOT, 'tools', '.cache', 'ref', mid, f), p['lat'], p['lon'])
        print(f, m)
        if m: views[f] = {'lat': p['lat'], 'lon': p['lon'], **m, 'title': p['title'], 'license': p['license'], 'artist': p['artist'], 'page': p['page']}
    json.dump(views, open(out_path, 'w'), indent=1)
