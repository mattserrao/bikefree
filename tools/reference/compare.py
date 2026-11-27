#!/usr/bin/env python3
"""A matched shot against its photo, in numbers (user, 27 Nov 2026: prove each change with evidence).

Both pictures are split the same way — sky (the bright region joined to the top edge) and land — and each part is
measured in CIELAB:
  L50, L05–L95   brightness: median and spread (the land's spread is its contrast)
  C, hue         colourfulness (chroma) and the mean hue angle
  dE             the distance between the two pictures' mean colours, per part (CIEDE2000)
  detail         fine-detail energy: the share of the land's luminance variance in its finest band (a Laplacian
                 pyramid's top level, the picture first scaled to 640 px wide, so lens and resolution count less)
  skyFrac        how much of the frame is sky (a check the view matched)
The photo's exposure is the camera's, so brightness is compared after scaling both lands to the same median; the
render's own median is kept too.

  python3 tools/reference/compare.py <shots.json> [--sheet out.jpg]   → adds 'stats' to each shot, prints a table
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage import color

W0 = 640


def load(p):
    im = Image.open(p).convert('RGB')
    im = im.resize((W0, round(W0 * im.height / im.width)), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255


def sky_mask(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = (r + g + b) / 3
    sky = ((b >= r - .02) & (lum > .42)) | ((lum > .82) & (np.abs(r - b) < .08))
    lab, _ = ndimage.label(sky)
    top = set(np.unique(lab[0])) - {0}
    return ndimage.binary_opening(np.isin(lab, list(top)), iterations=2)


def part(lab, m):
    if m.sum() < 50: return None
    L, a, b = lab[..., 0][m], lab[..., 1][m], lab[..., 2][m]
    C = np.hypot(a, b)
    return {'L50': float(np.median(L)), 'L05': float(np.percentile(L, 5)), 'L95': float(np.percentile(L, 95)),
            'C': float(np.mean(C)), 'hue': float(np.degrees(np.arctan2(np.mean(b), np.mean(a))) % 360), 'lab': [float(np.mean(L)), float(np.mean(a)), float(np.mean(b))]}


def detail(rgb, m):
    y = rgb @ np.array([.2126, .7152, .0722], np.float32)
    blur = ndimage.gaussian_filter(y, 1.2)
    hi = (y - blur)[m]
    return float(np.var(hi) / (np.var(y[m]) + 1e-6))


def stats(p):
    rgb = load(p); sky = sky_mask(rgb); land = ~sky
    lab = color.rgb2lab(rgb)
    return {'sky': part(lab, sky), 'land': part(lab, land), 'detail': detail(rgb, land), 'skyFrac': float(sky.mean())}


def de(a, b):
    return float(color.deltaE_ciede2000(np.array(a['lab']), np.array(b['lab']))) if a and b else None


def compare(photo, render):
    P, R = stats(photo), stats(render)
    out = {'photo': P, 'render': R}
    if P['land'] and R['land']:
        k = P['land']['L50'] / max(R['land']['L50'], 1)   # (exposure: the render's land scaled to the photo's median)
        out['land'] = {'dE': de(P['land'], R['land']), 'contrastPhoto': P['land']['L95'] - P['land']['L05'], 'contrastRender': (R['land']['L95'] - R['land']['L05']) * k,
                       'chromaPhoto': P['land']['C'], 'chromaRender': R['land']['C'], 'hueDiff': (R['land']['hue'] - P['land']['hue'] + 180) % 360 - 180,
                       'detailPhoto': P['detail'], 'detailRender': R['detail'], 'exposure': 1 / k}
    if P['sky'] and R['sky']:
        out['sky'] = {'dE': de(P['sky'], R['sky']), 'L50Photo': P['sky']['L50'], 'L50Render': R['sky']['L50'], 'chromaPhoto': P['sky']['C'], 'chromaRender': R['sky']['C'], 'hueDiff': (R['sky']['hue'] - P['sky']['hue'] + 180) % 360 - 180}
    out['skyFrac'] = [P['skyFrac'], R['skyFrac']]
    return out


def sheet(shots, path, ref_dir):
    tiles = []
    for s in shots:
        a = Image.open(os.path.join(ref_dir, s['photo'])).convert('RGB'); a.thumbnail((640, 640))
        b = Image.open(s['render']).convert('RGB'); b = b.resize((a.width, a.height))
        t = Image.new('RGB', (a.width * 2 + 8, a.height + 46), 'white'); t.paste(a, (0, 0)); t.paste(b, (a.width + 8, 0))
        d = ImageDraw.Draw(t); c = s.get('stats', {})
        ln = c.get('land', {}); sk = c.get('sky', {})
        d.text((4, a.height + 3), f"{s['photo'][:60]}  |  land dE {ln.get('dE', 0):.1f}  contrast {ln.get('contrastPhoto', 0):.0f}/{ln.get('contrastRender', 0):.0f}  chroma {ln.get('chromaPhoto', 0):.0f}/{ln.get('chromaRender', 0):.0f}  hue {ln.get('hueDiff', 0):+.0f}", fill='black')
        d.text((4, a.height + 18), f"detail {ln.get('detailPhoto', 0):.3f}/{ln.get('detailRender', 0):.3f}  |  sky dE {sk.get('dE') or 0:.1f}  L {sk.get('L50Photo', 0):.0f}/{sk.get('L50Render', 0):.0f}  chroma {sk.get('chromaPhoto', 0):.0f}/{sk.get('chromaRender', 0):.0f}  skyFrac {c.get('skyFrac', [0, 0])[0]:.2f}/{c.get('skyFrac', [0, 0])[1]:.2f}", fill='black')
        d.text((4, a.height + 32), 'photo (left) / render (right) — values photo/render', fill='gray')
        tiles.append(t)
    Wd = max(t.width for t in tiles); out = Image.new('RGB', (Wd, sum(t.height for t in tiles)), 'white'); y = 0
    for t in tiles: out.paste(t, (0, y)); y += t.height
    out.save(path, quality=88)


if __name__ == '__main__':
    path = sys.argv[1]
    shots = json.load(open(path))
    ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for s in shots:
        if not os.path.exists(s['render']): continue
        ref = os.path.join(ROOT, 'tools', '.cache', 'ref', s['map'], s['photo'])
        s['stats'] = compare(ref, s['render'])
        ln, sk = s['stats'].get('land', {}), s['stats'].get('sky', {})
        print(f"{s['photo'][:44]:44s} land dE {ln.get('dE', 0):5.1f} contrast {ln.get('contrastPhoto', 0):4.0f}/{ln.get('contrastRender', 0):4.0f} chroma {ln.get('chromaPhoto', 0):4.0f}/{ln.get('chromaRender', 0):4.0f} hue {ln.get('hueDiff', 0):+4.0f} detail {ln.get('detailPhoto', 0):.3f}/{ln.get('detailRender', 0):.3f} | sky dE {sk.get('dE') or 0:5.1f} chroma {sk.get('chromaPhoto', 0):3.0f}/{sk.get('chromaRender', 0):3.0f}")
    json.dump(shots, open(path, 'w'), indent=1)
    if '--sheet' in sys.argv:
        sheet([s for s in shots if os.path.exists(s['render'])], sys.argv[sys.argv.index('--sheet') + 1], os.path.join(ROOT, 'tools', '.cache', 'ref', shots[0]['map']))
