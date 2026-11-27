#!/usr/bin/env python3
"""PLAN 7.8: the stadium rides and the stadium kit's layout, from tools/city/pittsburgh-stadiums.json.

    python3 tools/build_stadiums.py            # write the core's detours and every Pittsburgh scene's `stadiumKit`
    python3 tools/build_stadiums.py --check    # fail if either is stale

Each stadium's ride replaces a stretch of the core line (tools/build_city.py `detours`) with an authored path: a
polyline with rounded corners and helices (a spiral escalator up, a spiral ramp down) set on its straights. A helix
turns whole turns, so it comes back over the point it started from: the path around it is unchanged by its size,
which makes the ramp helix's radius the path's slack — tuned here so the new stretch keeps the line's 10 m phase
(build_city's rule: every sample after it stays where it was, a whole number of steps on). The same path, its
helices and the stadium's frame go to the scenes as `stadiumKit` (js/world/toolbox/structures/stadium.js), so every
area that sees a stadium draws the same one (the core rides it; the subway and the North Side carry it on their
aprons; the others see it across the river).
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUT = os.path.join(ROOT, 'tools', 'city', 'pittsburgh-stadiums.json')
CORE = os.path.join(ROOT, 'tools', 'city', 'pittsburgh.json')
R_E = 6371008.8
LAT0, LON0 = 40.4375, -79.9925      # the city's frame (every Pittsburgh scene's `origin`)
K = R_E * math.pi / 180
KX = K * math.cos(math.radians(LAT0))


from citylib.geo import hv   # (as js/gpx.js measures: code review P8, one copy)


def to_local(lat, lon): return ((lon - LON0) * KX, -(lat - LAT0) * K)
def to_ll(x, z): return (LAT0 - z / K, LON0 + x / KX)
def right_of(h): return (-h[1], h[0])   # x east, z south: the right of heading (hx, hz)


def build_path(det, slack_r=None):
    """The authored path: [(x, z)] every ~0.5 m, its metres, and its features (helices, keys) in path metres."""
    nodes = det['path']
    pts, items = [], []   # corner points (x, z, r) and the helices between them
    for n in nodes:
        if 'p' in n:
            p = n['p']
            xy = to_local(det[p]['lat'], det[p]['lon']) if isinstance(p, str) else tuple(p)
            pts.append({'xy': xy, 'r': n.get('r', 0), 'ele': n.get('ele'), 'helices': []})
        else:
            pts[-1]['helices'].append(dict(n['helix']))
    out, s = [pts[0]['xy']], [0.0]
    feats = []

    def go(to):
        a = out[-1]; d = math.hypot(to[0] - a[0], to[1] - a[1]); n = max(1, int(d / .5))
        for k in range(1, n + 1):
            out.append((a[0] + (to[0] - a[0]) * k / n, a[1] + (to[1] - a[1]) * k / n)); s.append(s[-1] + d / n)

    def helix(hx, head):
        R = slack_r if (hx.get('slack') or hx['role'] == 'ramp') and slack_r is not None else hx['R']
        side = hx.get('side', 1)
        c0 = out[-1]; rv = right_of(head)
        cen = (c0[0] + rv[0] * R * side, c0[1] + rv[1] * R * side)
        a0 = math.atan2(c0[1] - cen[1], c0[0] - cen[0])
        L = 2 * math.pi * R * hx['turns']; n = int(hx['turns'] * 360)   # (a fixed count: the path is continuous in R, so the phase solve converges)
        s0 = s[-1]
        for k in range(1, n + 1):
            a = a0 + side * 2 * math.pi * hx['turns'] * k / n
            out.append((cen[0] + R * math.cos(a), cen[1] + R * math.sin(a))); s.append(s0 + L * k / n)
        out[-1] = c0
        feats.append({**hx, 'R': R, 's0': s0, 's1': s[-1], 'cx': cen[0], 'cz': cen[1], 'a0': a0, 'hx': head[0], 'hz': head[1]})

    P = [q['xy'] for q in pts]
    tang = []   # per interior corner: (t_in, t_out, centre, side)
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        d1 = (b[0] - a[0], b[1] - a[1]); l1 = math.hypot(*d1); d1 = (d1[0] / l1, d1[1] / l1)
        d2 = (c[0] - b[0], c[1] - b[1]); l2 = math.hypot(*d2); d2 = (d2[0] / l2, d2[1] / l2)
        th = math.atan2(d1[0] * d2[1] - d1[1] * d2[0], d1[0] * d2[0] + d1[1] * d2[1])   # + = right turn (z south)
        r = pts[i]['r']; t = r * math.tan(abs(th) / 2)
        if t > min(l1, l2) * .5: raise SystemExit(f'corner {i} ({b}): radius {r} too big for its legs')
        tang.append(((b[0] - d1[0] * t, b[1] - d1[1] * t), (b[0] + d2[0] * t, b[1] + d2[1] * t), d1, d2, th, r))
    for i in range(len(P) - 1):
        a, b = P[i], P[i + 1]
        d = (b[0] - a[0], b[1] - a[1]); l = math.hypot(*d); head = (d[0] / l, d[1] / l)
        start = out[-1]
        end = tang[i][0] if i < len(tang) else b
        straight = math.hypot(end[0] - start[0], end[1] - start[1])
        for hx in pts[i]['helices']:
            at = hx.get('at', 0)
            if at > straight: raise SystemExit(f'helix {hx["name"]}: at {at} past its straight ({straight:.1f} m)')
            go((start[0] + head[0] * at, start[1] + head[1] * at))
            helix(hx, head)
        go(end)
        if i < len(tang):
            t_in, t_out, d1, d2, th, r = tang[i]
            side = 1 if th > 0 else -1
            rv = right_of(d1); cen = (t_in[0] + rv[0] * r * side, t_in[1] + rv[1] * r * side)
            a0 = math.atan2(t_in[1] - cen[1], t_in[0] - cen[0]); L = r * abs(th); n = max(1, int(L / .5)); s0 = s[-1]
            for k in range(1, n + 1):
                ang = a0 + th * k / n
                out.append((cen[0] + r * math.cos(ang), cen[1] + r * math.sin(ang))); s.append(s0 + L * k / n)
            out[-1] = t_out
            if pts[i + 1]['ele'] == 'rim': feats.append({'role': 'rimpt', 's0': s0 + L / 2})
    return out, s, feats


_GROUND = None
def ground(x, z):
    """The map's ground at (x, z) (the core's city grid, tools/build_city.py: bilinear)."""
    global _GROUND
    if _GROUND is None:
        import base64, array
        g = json.load(open(os.path.join(ROOT, 'routes', 'scenes', 'pittsburgh-city.json')))['grid']
        a = array.array('H'); a.frombytes(base64.b64decode(g['h']))
        if sys.byteorder != 'little': a.byteswap()
        _GROUND = (g, a)
    g, a = _GROUND
    la, lo = to_ll(x, z)
    fx = (lo - g['west']) / (g['east'] - g['west']) * (g['nx'] - 1); fy = (g['north'] - la) / (g['north'] - g['south']) * (g['ny'] - 1)
    i, j = int(fx), int(fy); u, v = fx - i, fy - j
    h = lambda r, c: g['base'] + a[r * g['nx'] + c] * g['scale']
    return (h(j, i) * (1 - u) + h(j, i + 1) * u) * (1 - v) + (h(j + 1, i) * (1 - u) + h(j + 1, i + 1) * u) * v


def heights(det, xy, s, feats):
    """Heights along the path: keys at the helices' ends (escalator: exact, carried; a ramp: eased), linear between.
    The escalator starts on the ground at its foot and rises to the concourse (`rimEle`); the ramp comes down to the
    ground where it ends (the map's ground, so the deck never dips under it), and the path runs on to the line —
    off the deck, on the ground (F354: never under it where the ground rises between the keys)."""
    S = s[-1]; rim = det['rimEle']
    hel = sorted([f for f in feats if 'turns' in f], key=lambda f: f['s0'])
    keys = [(0.0, det['from']['ele'], False)]
    for f in hel:
        foot = ground(f['cx'] + f['R'] * math.cos(f['a0']), f['cz'] + f['R'] * math.sin(f['a0'])) + .3
        if f['role'] == 'escalator': y0, y1 = foot, rim
        else: y0, y1 = rim, foot
        f['rise'] = round(y1 - y0, 2)
        keys.append((f['s0'], y0, f['role'] == 'escalator')); keys.append((f['s1'], y1, f['role'] == 'escalator'))
    keys.append((S, det['to']['ele'], False))
    def lin(u):
        for (a, ya, _), (b, yb, _) in zip(keys, keys[1:]):
            if a <= u <= b: return ya + (yb - ya) * (u - a) / max(1e-9, b - a)
        return keys[-1][1]
    E = [lin(u) for u in s]
    # ease the ramps' grade changes (not the escalators': carried, the grade isn't ridden) over easeM
    w = det.get('easeM', 40) / 2
    breaks = [u for (u, _, esc) in keys[1:-1] if not esc]
    out = E[:]
    for k, u in enumerate(s):
        for b in breaks:
            if abs(u - b) < w:
                # average of the line over [u - w, u + w] (a parabolic blend through the kink)
                out[k] = sum(lin(min(S, max(0, u + (j / 10 - 1) * w))) for j in range(21)) / 21
    # [F354] off the deck (the line to the escalator's foot, the ramp's foot to the line) the path keeps to the
    # ground: the straight run between the keys cut up to 4 m under the rise between Acrisure's ramp foot and the
    # riverfront. Each stretch is raised to the ground (+0.3 m, as the feet) under a grade cap (`groundGrade`, 8 %:
    # where the ground falls faster — the bank down to the riverfront — the path cuts into it rather than drop
    # off it), its ends held (the line's samples, the deck's feet), then smoothed over easeM (a window that
    # shrinks to the ends)
    G = det.get('groundGrade', 8) / 100
    sm = out[:]
    for lo_u, hi_u in ((0.0, hel[0]['s0']), (hel[-1]['s1'], S)):
        ks = [k for k in range(len(s)) if lo_u <= s[k] <= hi_u]
        if len(ks) < 3: continue
        F = {k: ground(*xy[k]) + .3 for k in ks}
        a_, b_ = ks[0], ks[-1]
        base = {}
        for k in ks:
            up = max(F[v] - G * abs(s[k] - s[v]) for v in ks)
            cap = min(out[a_] + G * (s[k] - s[a_]), out[b_] + G * (s[b_] - s[k]))
            base[k] = max(out[k], min(up, cap))
        for k in ks:
            h = min(w, s[k] - s[a_], s[b_] - s[k])
            if h < .5: sm[k] = base[k]; continue
            win = [base[j] for j in ks if abs(s[j] - s[k]) <= h]
            sm[k] = sum(win) / len(win)
    return sm


def walk_len(det, path):
    """build_city's chord walk (apply_detours.walk): the new stretch's length in the app's metres."""
    R_ = R_E * math.pi / 180
    rd = lambda p: (round(p[0], 6), round(p[1], 6))
    A, B = (det['from']['lat'], det['from']['lon']), (det['to']['lat'], det['to']['lon'])
    lat0_, lon0_ = A
    kx_ = R_ * math.cos(math.radians(lat0_))
    to_l = lambda la, lo: ((lo - lon0_) * kx_, (la - lat0_) * R_)
    to_g = lambda x, y: (lat0_ + y / R_, lon0_ + x / kx_)
    P = [to_l(la, lo) for la, lo in path]
    P[0], P[-1] = (0.0, 0.0), to_l(*B)
    out, k, cur, c = [], 0, P[0], 10.0
    while True:
        if math.hypot(P[-1][0] - cur[0], P[-1][1] - cur[1]) <= 15 and out: break
        while k < len(P) - 1 and math.hypot(P[k + 1][0] - cur[0], P[k + 1][1] - cur[1]) < c: k += 1
        if k >= len(P) - 1: break
        (ax, ay), (bx, by) = P[k], P[k + 1]
        fx, fy, dx, dy = ax - cur[0], ay - cur[1], bx - ax, by - ay
        a2, b2, c2 = dx * dx + dy * dy, 2 * (fx * dx + fy * dy), fx * fx + fy * fy - c * c
        t = max(0.0, min(1.0, (-b2 + math.sqrt(max(0.0, b2 * b2 - 4 * a2 * c2))) / (2 * a2)))
        cur = (ax + dx * t, ay + dy * t); out.append(cur); c = 10.0
    pts = [rd(to_g(*q)) for q in out] + [B]
    tot, prev = 0.0, A
    for q in pts: tot += hv(prev, q); prev = q
    return tot


def solve(st):
    det = st['detour']
    old = det['to']['m'] - det['from']['m']
    ramp = next(n['helix'] for n in det['path'] if 'helix' in n and n['helix']['role'] == 'ramp')
    def err(R):
        xy, s, feats = build_path(det, R)
        ll = [tuple(q[:2]) for q in written(det, xy, s, [0.0] * len(s))]   # (the points as written: build_city walks those)
        tot = walk_len(det, ll)
        return (tot - old + 5) % 10 - 5, tot
    # the slack: the ramp helix's radius (whole turns: the rest of the path doesn't move); start at the layout's
    # radius and find the nearest phase match (≈ 12.6 m of length per metre of radius per two turns)
    R = ramp['R']; e, tot = err(R)
    for _ in range(12):
        if abs(e) < .004: break
        dLdR = 2 * math.pi * ramp['turns']
        R2 = R - e / dLdR; e2, tot2 = err(R2)
        if abs(e2) > abs(e) and abs(e2) > 4: R2 = R - (e - 10 * (1 if e > 0 else -1)) / dLdR; e2, tot2 = err(R2)
        R, e, tot = R2, e2, tot2
    # the written points are rounded to 6 decimals (~0.1 m): the walk's length jitters by ±0.1 m with R, so finish
    # with a fine scan round the root for a radius whose rounded path lands within a few mm
    if abs(e) >= .004:
        best = (abs(e), R, e, tot)
        for k in range(1, 400):
            for R2 in (R + k * .0004, R - k * .0004):
                e2, tot2 = err(R2)
                if abs(e2) < best[0]: best = (abs(e2), R2, e2, tot2)
            if best[0] < .004: break
        _, R, e, tot = best
    if abs(e) > .01: raise SystemExit(f'{st["name"]}: no phase match ({e:+.3f} m)')
    xy, s, feats = build_path(det, R)
    E = heights(det, xy, s, feats)
    return {'R': R, 'xy': xy, 's': s, 'E': E, 'feats': feats, 'tot': tot, 'old': old}


def written(det, xy, s, E):
    """The detour's points as written: ~1 m apart (build_city walks them in 10 m chords and takes each sample's height
    from here), 7 decimals, its ends on the line's samples."""
    keep = [0]
    for k in range(1, len(s)):
        if s[k] - s[keep[-1]] >= 1 or k == len(s) - 1: keep.append(k)
    path = []
    for k in keep:
        la, lo = to_ll(*xy[k]); path.append([round(la, 7), round(lo, 7), round(E[k], 2)])
    path[0][:2] = [det['from']['lat'], det['from']['lon']]; path[-1][:2] = [det['to']['lat'], det['to']['lon']]
    return path


def deck_end(det, sol):
    """Where the way down meets the ground again (path metres): the deck runs from the escalator's foot to here."""
    ramp = [f for f in sol['feats'] if f.get('role') == 'ramp']
    return ramp[-1]['s1'] + 2


def detour_of(st, sol):
    det = st['detour']
    path = written(det, sol['xy'], sol['s'], sol['E'])
    hel = [f for f in sol['feats'] if 'turns' in f]
    esc = [f for f in hel if f['role'] == 'escalator']
    ramp = [f for f in hel if f['role'] == 'ramp']
    # the stretch off the ground (a deck: no ground pressed to it, no street furniture): the escalator's foot to
    # where the way down meets the ground again
    s_end = deck_end(det, sol)
    return {
        'name': st['name'], 'fromM': det['from']['m'], 'toM': det['to']['m'], 'kind': det.get('kind', 'trail'),
        'why': f'PLAN 7.8: {det["edge"]} rides through {st["name"]} (tools/build_stadiums.py from tools/city/pittsburgh-stadiums.json; do not edit by hand)',
        'conveyors': [{'fromU': round(f['s0'], 2), 'toU': round(f['s1'], 2), 'mps': f.get('mps', 3.0), 'label': f.get('label', 'Escalator'), 'name': f['name'], 'kind': 'stadium'} for f in esc],
        'decks': [{'fromU': round(esc[0]['s0'], 2), 'toU': round(s_end, 2), 'name': st['name'], 'structure': 'stadium'}],
        'path': path,
    }


def kit_of(st, sol):
    """The scene's view of a stadium: its ride's path (the deck the kit draws), helices and rim, in the city frame."""
    xy, E, s = sol['xy'], sol['E'], sol['s']
    hel = [f for f in sol['feats'] if 'turns' in f]
    pts, last = [], -99
    for k in range(len(s)):
        if s[k] - last >= 2 or k == len(s) - 1:
            pts.append(f'{xy[k][0]:.1f} {E[k]:.2f} {xy[k][1]:.1f} {s[k]:.1f}'); last = s[k]
    pts = ','.join(pts)   # "x y z u,…" (city frame metres; u: metres along the ride's path)
    rim = [f for f in hel]
    return {
        'name': st['name'], 'sport': st['sport'], 'lengthM': round(sol['tot'], 1),
        'path': pts,
        'helices': [{'role': f['role'], 'name': f['name'], 'x': round(f['cx'], 2), 'z': round(f['cz'], 2), 'R': round(f['R'], 3), 'turns': f['turns'],
                     'side': f.get('side', 1), 'a0': round(f['a0'], 5), 'y0': round(E[s.index(f['s0'])], 2), 'y1': round(E[s.index(f['s1'])], 2),
                     'u0': round(f['s0'], 1), 'u1': round(f['s1'], 1)} for f in rim],
        'rimEle': st['detour']['rimEle'],
        'deckU': [round(min(f['s0'] for f in hel if f['role'] == 'escalator'), 1), round(deck_end(st['detour'], sol), 1)],
        **{k: v for k, v in st.items() if k not in ('name', 'sport', 'detour')},
    }


def dump_like(path, obj, collapse=False):
    """Write obj as the file is already written (its indent and escaping), points of a detour path one per line."""
    old = open(path).read()
    fmt = next(((i, a) for i in (1, 2, 4) for a in (True, False) if json.dumps(json.load(open(path)), indent=i, ensure_ascii=a) + '\n' == old), None)
    if fmt is None:   # (a file with collapsed points: tools/city/*.json with detours) — the config's own indent
        fmt = (1, True) if '\n "' in old[:40] else (2, False)
    pts = {}
    def mark(o):
        if isinstance(o, dict): return {k: (['@@P%d@@' % (pts.__setitem__(len(pts), q) or len(pts) - 1) for q in v] if collapse and k == 'path' and isinstance(v, list) and v and isinstance(v[0], list) else mark(v)) for k, v in o.items()}
        if isinstance(o, list): return [mark(v) for v in o]
        return o
    txt = json.dumps(mark(obj), indent=fmt[0], ensure_ascii=fmt[1])
    for k, q in pts.items(): txt = txt.replace('"@@P%d@@"' % k, json.dumps(q))
    open(path, 'w').write(txt + '\n')


def main():
    check = '--check' in sys.argv
    lay = json.load(open(LAYOUT))
    sols = [(st, solve(st)) for st in lay['stadiums']]
    for st, sol in sols:
        print(f'{st["name"]}: {sol["old"]:.1f} m → {sol["tot"]:.1f} m (+{sol["tot"] - sol["old"]:.1f}), ramp R {sol["R"]:.3f} m')
        for f in sol['feats']:
            if 'turns' in f: print(f'  {f["role"]} {f["name"]}: {f["s0"]:.0f}–{f["s1"]:.0f} m, R {f["R"]:.2f}, centre ({f["cx"]:.0f}, {f["cz"]:.0f})')
    stale = []
    core = json.load(open(CORE))
    dets = [d for d in core.get('detours', []) if not d.get('why', '').startswith('PLAN 7.8')] + [detour_of(st, sol) for st, sol in sols]
    if core.get('detours') != dets:
        stale.append(CORE); core['detours'] = dets
        if not check: dump_like(CORE, core, collapse=True)
    kit = {'note': 'PLAN 7.8 (tools/build_stadiums.py: do not edit by hand)', 'origin': {'lat': LAT0, 'lon': LON0}, 'stadiums': [kit_of(st, sol) for st, sol in sols]}
    scenes = os.path.join(ROOT, 'routes', 'scenes')
    centres = [(sum(q[0] for q in st['ring']) / len(st['ring']), sum(q[1] for q in st['ring']) / len(st['ring'])) for st in lay['stadiums']]
    for f in sorted(os.listdir(scenes)):
        if not (f.startswith('pittsburgh') and f.endswith('.json') and not f.endswith('-city.json')): continue
        # only the areas whose grid holds the stadiums draw them (the others never see them); the kit replaces the
        # old blobs (`stadiumShapes`)
        cfg_p = os.path.join(ROOT, 'tools', 'city', f)
        g = json.load(open(cfg_p)).get('gridBbox') if os.path.exists(cfg_p) else None
        sees = g and any(g[1] < to_ll(*c)[0] < g[3] and g[0] < to_ll(*c)[1] < g[2] for c in centres)
        p = os.path.join(scenes, f); sc = json.load(open(p)); want = dict(sc)
        if sees: want.pop('stadiumShapes', None); want['stadiumKit'] = kit
        else: want.pop('stadiumKit', None)
        if want != sc:
            stale.append(p)
            if not check: dump_like(p, want)
    if check and stale: raise SystemExit('stale (run python3 tools/build_stadiums.py): ' + ', '.join(os.path.relpath(x, ROOT) for x in stale))
    print('wrote' if stale else 'up to date', *[os.path.relpath(x, ROOT) for x in stale])


if __name__ == '__main__':
    main()
