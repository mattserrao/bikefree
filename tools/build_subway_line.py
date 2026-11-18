#!/usr/bin/env python3
"""The line of Pittsburgh's subway segment (North Side to Gateway): one cycle path beside the T's real tracks.

    python3 tools/build_subway_line.py

Writes tools/city/pittsburgh-subway.line.gpx (10 m chords, exact: the subway area's config copies it as its NS>GW
leg, build_city.py `samplesOf`) and the `underground` block of tools/city/pittsburgh-subway.json (its ranges in
the line's metres: underground, escalators, platforms, the river crossing), and prints the synthetic way for the
router. Geometry (PLAN "Subway: North Side to Gateway"):
  NS (Mazeroski Way & W General Robinson St, on the core's A>B) — Mazeroski Way north, Reedsdale St west, into
  Red Lot 5A — an escalator down beside the T's curve towards the river (the North Side platform at its foot) —
  the tunnel beside the tracks (the T's alignment from OSM, offset to the right) under the Allegheny — the Gateway
  platform — an escalator up into the Gateway Station headhouse — across Liberty Ave and the slip road to
  GW (Stanwix St & Forbes Ave, on the core's B>E).
"""
import glob, json, math, os, re, sys
import xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_city import hv, elevation, ROOT   # noqa: E402

OFFSET = 6.0          # the path's centre this far right of the tracks' midline (riding NS → GW)
ESC_LEN, ESC_DROP = 48.0, 13.5   # each escalator: length along it, height it climbs
PLATFORM = 60.0       # level platform at each escalator's foot
LOW = 199.0           # the tunnel's floor under the river
MAX_G = .032          # the tunnel's grades
C = (40.447677, -80.007652)   # NS: Mazeroski Way & W General Robinson St
GWN = (40.441108, -80.004009)  # GW: Stanwix St & Forbes Ave
KX, KY = 111319.49 * math.cos(math.radians(C[0])), 111319.49
xy = lambda la, lo: ((lo - C[1]) * KX, (la - C[0]) * KY)
ll = lambda x, y: (C[0] + y / KY, C[1] + x / KX)


import functools


@functools.lru_cache(None)
def core():
    t = open(os.path.join(ROOT, 'routes/cities/pittsburgh.gpx')).read()
    P = [(float(a), float(b), float(c)) for a, b, c in re.findall(r'lat="([-\d.]+)" lon="([-\d.]+)"><ele>([-\d.]+)', t)]
    Q = [P[0]]
    for q in P[1:]:
        if hv(Q[-1], q) > .5: Q.append(q)   # (the app drops points this close)
    cum = [0.0]
    for a, b in zip(Q, Q[1:]): cum.append(cum[-1] + hv(a, b))
    # the app's samples: every 10 m along the chords (js/gpx.js buildRoute), where the network's junctions sit
    S, j = [], 0
    for i in range(int(cum[-1] // 10) + 1):
        d = i * 10.0
        while j < len(Q) - 2 and cum[j + 1] < d: j += 1
        f = (d - cum[j]) / max(1e-9, cum[j + 1] - cum[j])
        S.append(tuple(Q[j][c] + (Q[j + 1][c] - Q[j][c]) * f for c in range(3)))
    def pick(q, lo, hi):
        k = min(range(lo // 10, hi // 10 + 1), key=lambda i: hv(S[i], q))
        return k, k * 10, S[k]
    return pick(C, 21020, 22020), pick(GWN, 400, 3490)


@functools.lru_cache(None)
def rails():
    nodes, ways = {}, {}
    for f in glob.glob(os.path.join(ROOT, 'tools/.cache/osm-pittsburgh/t_*.osm')):
        r = ET.parse(f).getroot()
        for n in r.iter('node'): nodes[n.get('id')] = (float(n.get('lat')), float(n.get('lon')))
        for w in r.iter('way'):
            if w.get('id') in ('557202014', '663076344', '663076342', '663076345', '663076343', '557202015'):
                ways[w.get('id')] = [nd.get('ref') for nd in w.iter('nd')]
    pts = lambda ids, rev=False: [xy(*nodes[i]) for w in ids for i in (ways[w][::-1] if rev else ways[w])]
    A = pts(['557202014', '663076344', '663076342'])
    B = pts(['557202015', '663076343', '663076345'])[::-1]
    return dedupe(A), dedupe(B)


def dedupe(p):
    out = [p[0]]
    for q in p[1:]:
        if math.hypot(q[0] - out[-1][0], q[1] - out[-1][1]) > .3: out.append(q)
    return out


def resample(p, step):
    out, carry = [p[0]], 0.0
    for a, b in zip(p, p[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1]); d = step - carry
        while d <= L:
            out.append((a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L)); d += step
        carry = L - (d - step)
    if math.hypot(p[-1][0] - out[-1][0], p[-1][1] - out[-1][1]) > step * .3: out.append(p[-1])
    return out


def nearest_on(p, q):
    best = None
    for a, b in zip(p, p[1:]):
        dx, dy = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dy * dy or 1e-9
        t = max(0, min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2))
        c = (a[0] + dx * t, a[1] + dy * t); d = math.hypot(c[0] - q[0], c[1] - q[1])
        if best is None or d < best[0]: best = (d, c)
    return best[1]


def smooth(p, w):
    return [p[i] if i in (0, len(p) - 1) else tuple(sum(p[k][j] for k in range(max(0, i - w), min(len(p), i + w + 1))) / (min(len(p), i + w + 1) - max(0, i - w)) for j in (0, 1)) for i in range(len(p))]


@functools.lru_cache(None)
def offset_curve():
    A, B = rails()
    A2 = resample(A, 2.0)
    mid = smooth([((q[0] + c[0]) / 2, (q[1] + c[1]) / 2) for q in A2 for c in [nearest_on(B, q)]], 6)
    O = []
    for i, q in enumerate(mid):
        a, b = mid[max(0, i - 3)], mid[min(len(mid) - 1, i + 3)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
        O.append((q[0] + dy / L * OFFSET, q[1] - dx / L * OFFSET))   # right of the way south
    return resample(smooth(O, 4), 1.0)


def arclen(p):
    s = [0.0]
    for a, b in zip(p, p[1:]): s.append(s[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    return s


def at(p, s, u):
    k = max(0, min(len(p) - 2, next((i for i in range(len(s) - 1) if s[i + 1] >= u), len(s) - 2)))
    f = (u - s[k]) / max(1e-9, s[k + 1] - s[k])
    return (p[k][0] + (p[k + 1][0] - p[k][0]) * f, p[k][1] + (p[k + 1][1] - p[k][1]) * f)


def fillet(pts, fixed, r=7.0):
    """Round each free corner with an arc of radius ≤ r (never more than half of either leg)."""
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        u = (a[0] - b[0], a[1] - b[1]); v = (c[0] - b[0], c[1] - b[1])
        lu, lv = math.hypot(*u), math.hypot(*v)
        cosang = max(-1, min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))
        turn = math.pi - math.acos(cosang)
        if fixed[i] or turn < math.radians(4): out.append(b); continue
        t = min(r * math.tan(turn / 2), lu * .45, lv * .45)
        p0 = (b[0] + u[0] / lu * t, b[1] + u[1] / lu * t); p1 = (b[0] + v[0] / lv * t, b[1] + v[1] / lv * t)
        n = max(3, int(math.degrees(turn) / 6))
        for k in range(n + 1):   # a quadratic Bézier through the corner: close to the arc
            f = k / n
            out.append(((1 - f) ** 2 * p0[0] + 2 * (1 - f) * f * b[0] + f * f * p1[0], (1 - f) ** 2 * p0[1] + 2 * (1 - f) * f * b[1] + f * f * p1[1]))
    out.append(pts[-1])
    return dedupe(out)


def build(turn_lon):
    (kn, mn, NS), (kg, mg, GW) = core()
    O = offset_curve(); So = arclen(O)
    # the North Side escalator: its foot on the offset curve where it passes General Robinson's latitude, along the
    # curve's direction there; the Gateway escalator: its top in the headhouse (lat ≈ 40.44160), its foot on the curve
    def u_at_lat(lat):
        y = xy(lat, C[1])[1]
        return min(range(len(O)), key=lambda i: abs(O[i][1] - y))
    ub = So[u_at_lat(40.44772)]
    tb = (at(O, So, ub + 3)[0] - at(O, So, ub - 3)[0], at(O, So, ub + 3)[1] - at(O, So, ub - 3)[1]); L = math.hypot(*tb); tb = (tb[0] / L, tb[1] / L)
    Eb = at(O, So, ub); Et = (Eb[0] - tb[0] * ESC_LEN, Eb[1] - tb[1] * ESC_LEN)
    ug = So[u_at_lat(40.44160 + ESC_LEN * .98 / KY)]
    tg = (at(O, So, ug + 3)[0] - at(O, So, ug - 3)[0], at(O, So, ug + 3)[1] - at(O, So, ug - 3)[1]); L = math.hypot(*tg); tg = (tg[0] / L, tg[1] / L)
    Gb = at(O, So, ug); Gt = (Gb[0] + tg[0] * ESC_LEN, Gb[1] + tg[1] * ESC_LEN)
    # surface, NS side: Mazeroski Way north, Reedsdale St west to the lot, into the escalator's lead-in
    maz = [xy(40.447758, -80.007678), xy(40.448183, -80.007816), xy(40.448223, -80.007829)]
    reed_y = xy(40.448214, -80.008274)[1]
    T1 = (xy(40.4482, turn_lon)[0], reed_y - 1)
    lead = (Et[0] - tb[0] * 9, Et[1] - tb[1] * 9)
    north = [xy(*NS[:2])] + maz + [xy(40.448214, -80.008274), T1, lead]
    fixed = [True] + [False] * (len(north) - 2) + [True]
    north = fillet(north, fixed, 8.0)
    # surface, GW side: out of the headhouse south across Liberty Ave onto the slip road to Stanwix & Forbes
    out_lead = (Gt[0] + tg[0] * 7, Gt[1] + tg[1] * 7)
    slip0, gw = xy(40.441357, -80.004224), xy(*GW[:2])
    sx = (out_lead[0], gw[1] + (slip0[1] - gw[1]) * .62)
    j = (slip0[0] + (gw[0] - slip0[0]) * .38, sx[1])
    south = [Gt, out_lead, j, gw]
    south = fillet(south, [True, True, False, True], 9.0)
    tunnel = [q for q in O if ub <= So[O.index(q)] <= ug] if False else [O[i] for i in range(len(O)) if ub < So[i] < ug]
    path = dedupe(north + [Et, Eb] + tunnel + [Gb, Gt] + south[1:])
    s = arclen(path)
    key = {}
    for name, q in (('esc1_top', Et), ('esc1_bot', Eb), ('esc2_bot', Gb), ('esc2_top', Gt)):
        key[name] = s[min(range(len(path)), key=lambda i: math.hypot(path[i][0] - q[0], path[i][1] - q[1]))]
    return path, s, key, NS, GW, mn, mg


def profile(path, s, key, NS, GW):
    """Heights along the dense path: ground on the surface (eased from the core's junction heights), the escalators
    straight, the platforms level, the tunnel down to LOW under the river at ≤ MAX_G and back up."""
    g = [elevation(*ll(*q)) for q in path]
    t1, b1, b2, t2 = key['esc1_top'], key['esc1_bot'], key['esc2_bot'], key['esc2_top']
    top1 = sum(g[i] for i in range(len(s)) if abs(s[i] - t1) < 6) / max(1, sum(1 for i in range(len(s)) if abs(s[i] - t1) < 6))
    top2 = sum(g[i] for i in range(len(s)) if abs(s[i] - t2) < 6) / max(1, sum(1 for i in range(len(s)) if abs(s[i] - t2) < 6))
    p1, p2 = top1 - ESC_DROP, top2 - ESC_DROP
    z = []
    for i, u in enumerate(s):
        if u <= t1: z.append(NS[2] + (top1 - NS[2]) * u / t1)
        elif u <= b1: z.append(top1 + (p1 - top1) * (u - t1) / (b1 - t1))
        elif u >= t2: z.append(top2 + (GW[2] - top2) * (u - t2) / (s[-1] - t2))
        elif u >= b2: z.append(p2 + (top2 - p2) * (u - b2) / (t2 - b2))
        else:
            down = max(p1 - (u - b1 - PLATFORM) * MAX_G, LOW) if u > b1 + PLATFORM else p1
            up = max(p2 - (b2 - PLATFORM - u) * MAX_G, LOW) if u < b2 - PLATFORM else p2
            z.append(max(down, up) if u > b1 + PLATFORM and u < b2 - PLATFORM else (p1 if u <= b1 + PLATFORM else p2))
    # soften the tunnel's knees (not the escalators'): ±12 m average between the escalators' feet
    zz = z[:]
    for i, u in enumerate(s):
        if b1 + 6 < u < b2 - 6:
            ks = [k for k in range(max(0, i - 12), min(len(s), i + 13)) if b1 <= s[k] <= b2]
            zz[i] = sum(z[k] for k in ks) / len(ks)
    return zz, g


def chords10(path, z):
    """Points every 10 m along the path, each chord exactly 10 m as the app measures it (haversine), then the end."""
    L = [ll(*q) for q in path]
    pt = lambda k, f: (L[k][0] + (L[k + 1][0] - L[k][0]) * f, L[k][1] + (L[k + 1][1] - L[k][1]) * f)
    out, zs, k, f0 = [L[0]], [z[0]], 0, 0.0
    while True:
        cur = out[-1]
        while k < len(L) - 1 and hv(cur, L[k + 1]) < 10: k += 1; f0 = 0.0
        if k >= len(L) - 1: break
        lo, hi = f0, 1.0   # the distance from cur grows along this segment from f0 (cur is behind it or on it)
        for _ in range(50):
            m = (lo + hi) / 2
            (lo, hi) = (lo, m) if hv(cur, pt(k, m)) >= 10 else (m, hi)
        out.append(pt(k, hi)); zs.append(z[k] + (z[k + 1] - z[k]) * hi); f0 = hi
    return out, zs, hv(out[-1], L[-1])


def main():
    # the turn off Reedsdale St into the lot: moved east or west until the line is a whole number of 10 m chords
    def err(lon):
        path, s, key, NS, GW, mn, mg = build(lon)
        z, g = profile(path, s, key, NS, GW)
        last = chords10(path, z)[2]
        return min(last, 10 - last)
    lon = min((-80.00885 + 0.00045 * i / 60 for i in range(61)), key=err)
    for span in (0.0000075, 0.000001):
        lon = min((lon + span * (i - 10) / 10 for i in range(21)), key=err)
    path, s, key, NS, GW, mn, mg = build(lon)
    z, g = profile(path, s, key, NS, GW)
    pts, zs, last = chords10(path, z)
    if last > 5: pts.append(ll(*path[-1])); zs.append(GW[2])   # the last chord
    else: pts[-1] = ll(*path[-1]); zs[-1] = GW[2]
    lls = list(pts)
    lls[0], lls[-1] = NS[:2], GW[:2]
    total = sum(hv(a, b) for a, b in zip(lls, lls[1:]))
    print(f'subway line: {len(lls)} points, {total:.2f} m (turn off Reedsdale at {lon:.6f}); NS core {mn} m, GW core {mg} m')
    # depth check over the tunnel (between the escalators' tops): ground over the path
    gl = [elevation(*q) for q in pts]
    um = [10 * i for i in range(len(pts))]
    t1, b1, b2, t2 = key['esc1_top'], key['esc1_bot'], key['esc2_bot'], key['esc2_top']
    cover = [gl[i] - zs[i] for i in range(len(pts)) if b1 + 5 < um[i] < b2 - 5]
    river = [um[i] for i in range(len(pts)) if gl[i] < 218.3 and b1 < um[i] < b2]
    print(f'  escalators {t1:.0f}–{b1:.0f} and {b2:.0f}–{t2:.0f} m; cover over the tunnel ≥ {min(cover):.1f} m; '
          f'river {min(river):.0f}–{max(river):.0f} m; floor {min(zs):.1f} m')
    out = os.path.join(ROOT, 'tools/city/pittsburgh-subway.line.gpx')
    with open(out, 'w') as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="bikefree" xmlns="http://www.topografix.com/GPX/1/1">\n'
                '  <trk><name>Pittsburgh subway: North Side to Gateway (the cycle path beside the T)</name><trkseg>\n')
        for (la, lo_), e in zip(lls, zs): f.write(f'    <trkpt lat="{la:.6f}" lon="{lo_:.6f}"><ele>{e:.1f}</ele></trkpt>\n')
        f.write('  </trkseg></trk>\n</gpx>\n')
    # the line's metres (its chords: the app's) of each part
    meta = {
        'gpx': 'tools/city/pittsburgh-subway.line.gpx', 'lengthM': round(total),
        'underground': [round(t1), round(t2)],
        'conveyors': [{'fromM': round(t1), 'toM': round(b1), 'mps': 3.0, 'label': 'Escalator', 'dir': 'down', 'name': 'North Side'},
                      {'fromM': round(b2), 'toM': round(t2), 'mps': 3.0, 'label': 'Escalator', 'dir': 'up', 'name': 'Gateway'}],
        'platforms': [{'name': 'North Side', 'fromM': round(b1), 'toM': round(b1 + PLATFORM)}, {'name': 'Gateway', 'fromM': round(b2 - PLATFORM), 'toM': round(b2)}],
        'river': [min(river), max(river)],
        'synthetic': [[round(la, 6), round(lo_, 6)] for la, lo_ in lls],
    }
    cfgp = os.path.join(ROOT, 'tools/city/pittsburgh-subway.json')
    if os.path.exists(cfgp):
        cfg = json.load(open(cfgp))
        cfg['underground'] = {k: v for k, v in meta.items() if k != 'synthetic'}
        json.dump(cfg, open(cfgp, 'w'), indent=1, ensure_ascii=False); open(cfgp, 'a').write('\n')
    json.dump(meta, open('/tmp/subway-line-meta.json', 'w'))
    print('  ', json.dumps({k: v for k, v in meta.items() if k != 'synthetic'}))


if __name__ == '__main__':
    main()
