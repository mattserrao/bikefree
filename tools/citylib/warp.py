"""A map's build-time warp (Out West, user 26 Nov 2026: "cut the empty middle out of the long roads so the landmarks
come sooner"; plan in the Project doc claude/out-west-squeeze-plan.md).

The config's "warp" cuts stretches out of the area's corridor lines (tools/city/<id>-area-lines.json):

    "warp": { "center": [lat, lon], "captureM": 3000, "blendM": 350,
              "captureByLine": { "<line>": 6500 },
              "trimLines": { "<line>": km },              # the line ends there (the corridor beyond is not built)
              "cuts": [ { "line": "<line>", "fromKm": 2.0, "toKm": 6.0 }, … ] }

Every point of the real world is owned by the corridor line nearest it (within that line's capture) or by nothing (the
town, the open land between corridors: never moved). A point owned by a line at arc length s is:
  removed     if s falls inside one of that line's cuts
  moved       by the sum of the cuts behind it — on its own line (those that end before s) and on the lines it hangs
              from (a line starting on another, e.g. Hancock Road off US 89, carries that line's shift where it starts)
Each cut's shift is rigid: the far side moves by P(from) − P(to), so the road meets itself, and down by the road's
height change across the cut, so the heights meet too. The ground is then sampled back (inverse), the seams between
differently-moved pieces blended over `blendM`.

Used by tools/build_pgh.py (OSM nodes, area lines, heights, ground), tools/pgh_city.py (OSM, land cover, heights),
tools/outwest_heroes.py and tools/outwest_warp.py (heroes, businesses, rides).
"""
import json, math, os, glob
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE = os.path.join(ROOT, 'tools', '.cache')
DEM_Z = 14
_WARPS = {}


def load(city):
    """The city's Warp (cached), or None when its config has no warp."""
    if city in _WARPS: return _WARPS[city]
    path = os.path.join(ROOT, 'tools', 'city', f'{city}.json')
    cfg = json.load(open(path)) if os.path.exists(path) else {}
    w = Warp(city, cfg) if cfg.get('warp') else None
    _WARPS[city] = w
    return w


# ------------------------------------------------------------------ the DEM, vectorised (AWS terrarium tiles, z14)
class Dem:
    def __init__(self):
        self.tiles = {}

    def _tile(self, tx, ty):
        if (tx, ty) not in self.tiles:
            path = os.path.join(CACHE, f'dem-{DEM_Z}-{tx}-{ty}.png')
            if not os.path.exists(path):
                import urllib.request
                req = urllib.request.Request(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{DEM_Z}/{tx}/{ty}.png', headers={'User-Agent': 'bikefree-warp/0.1'})
                open(path, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
            a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float64)
            self.tiles[(tx, ty)] = (a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768).astype(np.float32)
        return self.tiles[(tx, ty)]

    def px(self, gx, gy):
        gx, gy = np.asarray(gx, np.int64), np.asarray(gy, np.int64)
        out = np.zeros(gx.shape, np.float32)
        tx, ty = gx // 256, gy // 256
        key = tx * 100000 + ty
        for k in np.unique(key):
            m = key == k
            out[m] = self._tile(int(k // 100000), int(k % 100000))[gy[m] % 256, gx[m] % 256]
        return out

    def __call__(self, lat, lon):
        lat, lon = np.asarray(lat, np.float64), np.asarray(lon, np.float64)
        n = 2 ** DEM_Z
        fx = (lon + 180) / 360 * n * 256
        lr = np.radians(lat)
        fy = (1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n * 256
        x0, y0 = np.floor(fx - .5), np.floor(fy - .5)
        ax, ay = fx - .5 - x0, fy - .5 - y0
        return (self.px(x0, y0) * (1 - ax) * (1 - ay) + self.px(x0 + 1, y0) * ax * (1 - ay)
                + self.px(x0, y0 + 1) * (1 - ax) * ay + self.px(x0 + 1, y0 + 1) * ax * ay)


class Warp:
    def __init__(self, city, cfg):
        W = cfg['warp']
        self.city, self.cfg, self.W = city, cfg, W
        self.lat0, self.lon0 = W['center']
        self.kx, self.ky = 111320 * math.cos(math.radians(self.lat0)), 110540
        self.capture = W.get('captureM', 3000)
        self.blendM = W.get('blendM', 350)
        self.dem = Dem()
        src = json.load(open(os.path.join(ROOT, 'tools', 'city', cfg['area']['lines'])))
        trim = W.get('trimLines', {})
        self.lines = []   # { name, pts [(x, y)], s [cumulative m] }
        for ln in src['lines']:
            pts = [self.xy(a, o) for a, o in ln['pts']]
            s = [0.0]
            for i in range(1, len(pts)): s.append(s[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
            if ln['name'] in trim:
                k = next((i for i, v in enumerate(s) if v > trim[ln['name']] * 1000), len(s))
                pts, s = pts[:max(2, k)], s[:max(2, k)]
            self.lines.append({'name': ln['name'], 'pts': np.array(pts), 's': np.array(s), 'cap': W.get('captureByLine', {}).get(ln['name'], self.capture)})
        self.by_name = {l['name']: i for i, l in enumerate(self.lines)}
        # dense samples (every 20 m) of every line, for the nearest-line lookups
        P, S, L = [], [], []
        for i, l in enumerate(self.lines):
            for k in range(len(l['pts']) - 1):
                a, b = l['pts'][k], l['pts'][k + 1]
                seg = l['s'][k + 1] - l['s'][k]
                n = max(1, int(seg // 20))
                for j in range(n):
                    t = j / n; P.append(a + (b - a) * t); S.append(l['s'][k] + seg * t); L.append(i)
            P.append(l['pts'][-1]); S.append(l['s'][-1]); L.append(i)
        self.P, self.S, self.L = np.array(P), np.array(S), np.array(L)
        self.tree = cKDTree(self.P)
        self.caps = np.array([l['cap'] for l in self.lines])
        # where each line hangs from another (its first point within 400 m of another line, outside the town)
        self.parent = {}
        for i, l in enumerate(self.lines):
            p0 = l['pts'][0]
            if math.hypot(*p0) < 2600: continue
            d, j = cKDTree(self.P[self.L != i]).query(p0)
            if d < 400:
                idx = np.nonzero(self.L != i)[0][j]
                self.parent[i] = (int(self.L[idx]), float(self.S[idx]))
        # the cuts: per line, sorted; each with its rigid shift and height change
        self.cuts = {i: [] for i in range(len(self.lines))}
        for c in W.get('cuts', []):
            i = self.by_name[c['line']]
            # (snapped to the line's own points, which lie on the road: the shift then takes the road onto itself)
            sv = self.lines[i]['s']
            s0 = float(sv[np.argmin(np.abs(sv - c['fromKm'] * 1000))]); s1 = float(sv[np.argmin(np.abs(sv - c['toKm'] * 1000))])
            p0, p1 = self.at(i, s0), self.at(i, s1)
            h0, h1 = (float(v) for v in self.dem(*self.ll(np.array([p0[0], p1[0]]), np.array([p0[1], p1[1]]))))
            self.cuts[i].append({'id': len([c for cs in self.cuts.values() for c in cs]), 's0': s0, 's1': s1, 'T': (p0[0] - p1[0], p0[1] - p1[1]), 'dh': h0 - h1})
        for i in self.cuts: self.cuts[i].sort(key=lambda c: c['s0'])
        # every distinct shift (a "combo"): 0 = none; per line the shift after each of its cuts (and its parent's)
        self.combos = [(0.0, 0.0, 0.0)]
        self._combo_of = {}
        self.combo_cuts = {0: set()}   # (the cuts each combo's shift is made of)
        for i in range(len(self.lines)):
            for s in [0.0] + [c['s1'] + 1 for c in self.cuts[i]]:
                k = self._combo(*self._shift(i, s))
                self.combo_cuts.setdefault(k, set(self._cuts_behind(i, s)))
        self._grid = None
        self.rampM = W.get('rampM', 4000)

    def offset(self, li, s, k=None):
        """The height offset (m) of real points owned by line li at arc length s: each cut behind them adds its height
        change, faded out over rampM beyond the cut (so the far piece keeps its real heights beyond the ramp, and the
        cut's climb is spread over the road after it rather than lost)."""
        li, s = np.asarray(li), np.asarray(s, np.float64)
        out = np.zeros(s.shape)
        inc = self.combo_cuts.get(k) if k is not None else None
        def add(i, m, sv):
            for c in self.cuts[i]:
                f = np.clip(1 - np.maximum(sv - c['s1'], 0) / self.rampM, 0, 1); f = f * f * (3 - 2 * f)
                # (a piece's ground sampled past its own edge — into a cut — keeps the offsets of the cuts it is made of)
                on = (sv >= c['s1']) if inc is None else np.full(sv.shape, c['id'] in inc)
                out[m] += np.where(on, c['dh'] * f, 0)
        for i in range(len(self.lines)):
            m = li == i
            if not m.any(): continue
            add(i, m, s[m])
            j, sj = i, None
            while j in self.parent:   # (the lines it hangs from: their cuts' offsets where it starts)
                j, sj = self.parent[j]
                add(j, m, np.full(m.sum(), sj))
        return out

    # ---------------------------------------------------------------- coordinates
    def xy(self, lat, lon): return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)
    def ll(self, x, y): return (self.lat0 + np.asarray(y) / self.ky, self.lon0 + np.asarray(x) / self.kx)

    def at(self, i, s):
        l = self.lines[i]
        s = min(max(s, 0), l['s'][-1])
        k = min(int(np.searchsorted(l['s'], s, side='right')) - 1, len(l['s']) - 2)
        t = (s - l['s'][k]) / max(1e-9, l['s'][k + 1] - l['s'][k])
        return tuple(l['pts'][k] + (l['pts'][k + 1] - l['pts'][k]) * t)

    def _shift(self, i, s):
        """(Tx, Ty, dh) of line i at arc length s (its parents' shift where it starts, plus its own cuts behind s)."""
        tx = ty = dh = 0.0
        if i in self.parent:
            j, sj = self.parent[i]
            tx, ty, dh = self._shift(j, sj)
        for c in self.cuts[i]:
            if s >= c['s1']: tx += c['T'][0]; ty += c['T'][1]; dh += c['dh']
        return tx, ty, dh

    def _cuts_behind(self, i, s):
        out = []
        if i in self.parent:
            j, sj = self.parent[i]; out += self._cuts_behind(j, sj)
        return out + [c['id'] for c in self.cuts[i] if s >= c['s1']]

    def _combo(self, tx, ty, dh):
        key = (round(tx, 2), round(ty, 2))
        if key not in self._combo_of:
            if abs(tx) < .01 and abs(ty) < .01: self._combo_of[key] = 0
            else: self._combo_of[key] = len(self.combos); self.combos.append((tx, ty, dh))
        return self._combo_of[key]

    # ---------------------------------------------------------------- classification (real coordinates, metres)
    def classify(self, x, y, full=False):
        """For real points: (combo id, removed, lateral distance to the owning line (inf: owned by none))."""
        x, y = np.asarray(x, np.float64), np.asarray(y, np.float64)
        d, k = self.tree.query(np.stack([x.ravel(), y.ravel()], 1))
        li, s = self.L[k], self.S[k]
        own = d <= self.caps[li]
        combo = np.zeros(d.shape, np.int32); removed = np.zeros(d.shape, bool)
        for i in range(len(self.lines)):
            m = own & (li == i)
            if not m.any(): continue
            for c in self.cuts[i]: removed[m & (s > c['s0']) & (s < c['s1'])] = True
            # the combo by the cuts behind each point
            bounds = [c['s1'] for c in self.cuts[i]]
            nb = np.searchsorted(np.array(bounds), s[m], side='right') if bounds else np.zeros(m.sum(), int)
            ids = [self._combo(*self._shift(i, (bounds[n - 1] + 1) if n else 0.0)) for n in range(len(bounds) + 1)]
            combo[m] = np.array(ids)[nb]
        lat = np.where(own, d, np.inf)
        if full: return combo.reshape(x.shape), removed.reshape(x.shape), lat.reshape(x.shape), np.where(own, li, -1).reshape(x.shape), s.reshape(x.shape)
        return combo.reshape(x.shape), removed.reshape(x.shape), lat.reshape(x.shape)

    # ---------------------------------------------------------------- forward (real → warped)
    def forward_xy(self, x, y):
        """Real points → (warped x, warped y, keep): removed points, and points whose warped place another piece of the
        world claims (the ground there comes from that piece), are not kept."""
        combo, removed, lat = self.classify(x, y)
        T = np.array(self.combos)
        qx, qy = np.asarray(x) + T[combo, 0], np.asarray(y) + T[combo, 1]
        keep = ~removed
        if len(self.combos) > 1:
            win, _ = self.winner(qx, qy)
            keep &= win == combo
        return qx, qy, keep

    def fwd(self, lat, lon):
        """One real (lat, lon) → warped (lat, lon), or None if it's cut out."""
        x, y = self.xy(lat, lon)
        qx, qy, keep = self.forward_xy(np.array([x]), np.array([y]))
        if not keep[0]: return None
        a, o = self.ll(qx[0], qy[0])
        return float(a), float(o)

    def fwd_any(self, lat, lon):
        """As fwd, but a removed or overlapped point still moves (by its piece's shift): for anchors."""
        x, y = self.xy(lat, lon)
        combo, _, _ = self.classify(np.array([x]), np.array([y]))
        tx, ty, _ = self.combos[int(combo[0])]
        a, o = self.ll(x + tx, y + ty)
        return float(a), float(o)

    # ---------------------------------------------------------------- inverse (warped → real)
    def winner(self, qx, qy):
        """For warped points: which piece's world shows there (the combo whose owning line is nearest), and the real
        point it comes from. Points no piece covers get combo -1."""
        qx, qy = np.asarray(qx, np.float64), np.asarray(qy, np.float64)
        best = np.full(qx.shape, np.inf); win = np.full(qx.shape, -1, np.int32)
        for k, (tx, ty, _) in enumerate(self.combos):
            c, rem, lat = self.classify(qx - tx, qy - ty)
            ok = (c == k) & ~rem
            pri = np.where(np.isinf(lat), 1e8, lat)   # (unowned ground: last)
            m = ok & (pri < best)
            best[m] = pri[m]; win[m] = k
        return win, best

    def inverse_xy(self, qx, qy):
        """Warped points → (real x, real y, dh, combo); uncovered points take the nearest covered point's piece."""
        win, _ = self.winner(qx, qy)
        T = np.array(self.combos)
        w = np.where(win < 0, 0, win)
        return np.asarray(qx) - T[w, 0], np.asarray(qy) - T[w, 1], T[w, 2], win

    def inv(self, lat, lon):
        x, y = self.xy(lat, lon)
        rx, ry, _, _ = self.inverse_xy(np.array([x]), np.array([y]))
        a, o = self.ll(rx[0], ry[0])
        return float(a), float(o)

    # ---------------------------------------------------------------- the warped ground
    def height_grid(self, cell=10.0, coarse=40.0):
        """The warped heights on a `cell` grid over the warped area's box (+ 4 km), cached on disk."""
        if self._grid is not None: return self._grid
        key = json.dumps(self.W, sort_keys=True) + json.dumps(self.cfg['area'], sort_keys=True)
        import hashlib
        tag = hashlib.sha1(key.encode()).hexdigest()[:10]
        path = os.path.join(CACHE, f'warp-{self.city}-{tag}.npz')
        if os.path.exists(path):
            z = np.load(path); self._grid = (z['H'], float(z['x0']), float(z['y0']), float(z['cell'])); return self._grid
        # the warped box: the town circle and every line's points, moved
        xs, ys = [0.0], [0.0]
        for i, l in enumerate(self.lines):
            for p, s in zip(l['pts'], l['s']):
                tx, ty, _ = self._shift(i, s)
                xs.append(p[0] + tx); ys.append(p[1] + ty)
        pad = 4000
        x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
        # the pieces on a coarse grid (the nearest-line lookups are the cost); each piece's own ground (its real
        # terrain moved, plus its height offset) on the fine grid, cross-faded where pieces meet
        cx = np.arange(x0, x1 + coarse, coarse); cy = np.arange(y0, y1 + coarse, coarse)
        CX, CY = np.meshgrid(cx, cy)
        win, _ = self.winner(CX, CY)
        if (win < 0).any():   # (ground no piece covers: the nearest covered cell's piece)
            idx = ndimage.distance_transform_edt(win < 0, return_distances=False, return_indices=True)
            win = win[idx[0], idx[1]]
        fx = np.arange(x0, x1 + cell, cell); fy = np.arange(y0, y1 + cell, cell)
        FX, FY = np.meshgrid(fx, fy)
        # the fine cells' coarse coordinates (for upsampling)
        gi = (FY - y0) / coarse; gj = (FX - x0) / coarse
        def up(A):
            return ndimage.map_coordinates(A.astype(np.float32), [gi, gj], order=1, mode='nearest')
        T = np.array(self.combos)
        num = np.zeros(FX.shape, np.float32); den = np.zeros(FX.shape, np.float32)
        sig = self.blendM / coarse / 2.0
        for k, (tx, ty, _) in enumerate(self.combos):
            wk = ndimage.gaussian_filter((win == k).astype(np.float32), sig)
            if wk.max() < 1e-3: continue
            Wf = up(wk)
            m = Wf > 1e-3
            # the height offset of the real points this piece shows (coarse, then up)
            _, _, _, li, sv = self.classify(CX - tx, CY - ty, full=True)
            off = up(self.offset(li, sv, k) if k else np.zeros(CX.shape))
            lat, lon = self.ll(FX[m] - tx, FY[m] - ty)
            Hk = np.zeros(m.sum(), np.float32)
            for r in range(0, len(Hk), 2000000):
                Hk[r:r + 2000000] = self.dem(lat[r:r + 2000000], lon[r:r + 2000000])
            num[m] += Wf[m] * (Hk + off[m]); den[m] += Wf[m]
        H = (num / np.maximum(den, 1e-6)).astype(np.float32)
        np.savez_compressed(path, H=H, x0=x0, y0=y0, cell=cell)
        self._grid = (H, x0, y0, cell)
        return self._grid

    def elevation(self, lat, lon):
        """Warped ground height at warped (lat, lon) (bilinear on the height grid)."""
        H, x0, y0, cell = self.height_grid()
        x, y = self.xy(np.asarray(lat, np.float64), np.asarray(lon, np.float64))
        fx, fy = (x - x0) / cell, (y - y0) / cell
        i0 = np.clip(np.floor(fy).astype(int), 0, H.shape[0] - 2); j0 = np.clip(np.floor(fx).astype(int), 0, H.shape[1] - 2)
        ay, ax = np.clip(fy - i0, 0, 1), np.clip(fx - j0, 0, 1)
        v = (H[i0, j0] * (1 - ax) * (1 - ay) + H[i0, j0 + 1] * ax * (1 - ay) + H[i0 + 1, j0] * (1 - ax) * ay + H[i0 + 1, j0 + 1] * ax * ay)
        return float(v) if np.ndim(v) == 0 else v

    # ---------------------------------------------------------------- OSM and the area
    def osm_nodes(self, nodes):
        """{id: (lat, lon)} real → warped, without the removed or overlapped nodes."""
        if not nodes: return nodes
        ids = list(nodes.keys())
        a = np.array([nodes[i] for i in ids])
        x, y = self.xy(a[:, 0], a[:, 1])
        out = {}
        for r in range(0, len(ids), 200000):
            qx, qy, keep = self.forward_xy(x[r:r + 200000], y[r:r + 200000])
            la, lo = self.ll(qx, qy)
            for k in np.nonzero(keep)[0]:
                out[ids[r + k]] = (float(la[k]), float(lo[k]))
        print(f'  warp: {len(nodes) - len(out)} of {len(nodes)} OSM nodes cut out')
        return out

    def osm_ways(self, nodes, ways, stepM=20.0):
        """Real OSM {id: (lat, lon)} and {wid: (refs, tags)} → warped, every way's nodes first filled in every stepM (so a
        cut falls where the road is, not at its next mapped node), cut out and spliced across the cuts."""
        dense, extra = dict(nodes), 0
        out_w = {}
        for wid, (refs, t) in ways.items():
            rr = [r for r in refs if r in nodes]
            if len(rr) < 2: out_w[wid] = (refs, t); continue
            new = [rr[0]]
            for a, b in zip(rr, rr[1:]):
                pa, pb = nodes[a], nodes[b]
                L = math.hypot((pb[1] - pa[1]) * self.kx, (pb[0] - pa[0]) * self.ky)
                n = int(L // stepM)
                for k in range(1, n + 1):
                    if k * stepM >= L - 1: break
                    f = k * stepM / L; nid = f'd{wid}_{len(new)}'
                    dense[nid] = (pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f); new.append(nid); extra += 1
                new.append(b)
            out_w[wid] = (new, t)
        print(f'  warp: ways filled in with {extra} nodes (every {stepM:.0f} m)')
        nodes2 = self.osm_nodes(dense)
        split, ends = {}, []   # ends: (piece id, 0 | -1, node) where a cut took the way's next node
        for wid, (refs, t) in out_w.items():
            parts = self.splice(refs, nodes2)
            for k, part in enumerate(parts):
                pid = wid if k == 0 else f'{wid}w{k}'
                split[pid] = (part, t)
                i0, i1 = refs.index(part[0]), len(refs) - 1 - refs[::-1].index(part[-1])
                if i0 > 0 and refs[i0 - 1] not in nodes2: ends.append((pid, 0, part[0]))
                if i1 < len(refs) - 1 and refs[i1 + 1] not in nodes2: ends.append((pid, -1, part[-1]))
        # across a cut, two different ways can meet (the near way's last node and the far way's first both taken by the
        # cut): an end of one joined to the nearest end of another piece within 90 m, so the road runs on
        if ends:
            P = np.array([self.xy(*nodes2[n]) for _, _, n in ends])
            tree = cKDTree(P)
            used = set()
            name = lambda k: (split[ends[k][0]][1].get('ref') or split[ends[k][0]][1].get('name') or '', split[ends[k][0]][1].get('highway'))
            for a, b in sorted(tree.query_pairs(90.0), key=lambda ab: np.hypot(*(P[ab[0]] - P[ab[1]]))):
                if a in used or b in used or ends[a][0] == ends[b][0]: continue
                if name(a) != name(b) or not name(a)[0]: continue   # (the same road on both sides only: no side track joined on)
                used |= {a, b}
                pid, end, _ = ends[b]
                refs, t = split[pid]
                refs = list(refs)
                if end == 0: refs.insert(0, ends[a][2])
                else: refs.append(ends[a][2])
                split[pid] = (refs, t)
            print(f'  warp: {len(used) // 2} ways joined across the cuts, {len(ends) - len(used)} cut ends left')
        return nodes2, split

    def splice(self, refs, nodes, joinM=90.0):
        """A way's refs with the cut-out nodes dropped: across a cut the two sides are joined when they now meet
        (within joinM), else the way is split there. Returns a list of ref lists."""
        out, cur, last = [], [], None
        for pos, r in enumerate(refs):
            if r not in nodes: continue
            if cur and last is not None:
                p, q = nodes[last[1]], nodes[r]
                if pos - last[0] > 1 and math.hypot((p[1] - q[1]) * self.kx, (p[0] - q[0]) * self.ky) > joinM:
                    out.append(cur); cur = []
            cur.append(r); last = (pos, r)
        if cur: out.append(cur)
        return [c for c in out if len(c) >= 2]

    def area_lines(self):
        """The area's corridor lines, warped (each cut out of its line; trimmed lines ended)."""
        out = []
        for i, l in enumerate(self.lines):
            pts = []
            for p, s in zip(l['pts'], l['s']):
                if any(c['s0'] < s < c['s1'] for c in self.cuts[i]): continue
                tx, ty, _ = self._shift(i, s)
                a, o = self.ll(p[0] + tx, p[1] + ty)
                pts.append([round(float(a), 6), round(float(o), 6)])
            out.append({'name': l['name'], 'pts': pts})
        return out

    def raster_sampler(self, sample):
        """A real-coordinates raster sampler (lat, lon arrays → values) as a warped one."""
        def warped(lat, lon):
            lat, lon = np.asarray(lat, np.float64), np.asarray(lon, np.float64)
            x, y = self.xy(lat, lon)
            out = np.zeros(lat.shape, np.uint8)
            flat_x, flat_y = x.ravel(), y.ravel()
            res = np.zeros(flat_x.shape, np.uint8)
            for r in range(0, len(flat_x), 500000):
                rx, ry, _, _ = self.inverse_xy(flat_x[r:r + 500000], flat_y[r:r + 500000])
                la, lo = self.ll(rx, ry)
                res[r:r + 500000] = sample(la, lo)
            out[...] = res.reshape(lat.shape)
            return out
        return warped

    def real_box(self, s, w, n, e, pad=0.03):
        """The real-coordinates box any warped point in (s, w, n, e) comes from."""
        sx, sy = [], []
        for tx, ty, _ in self.combos:
            for la, lo in ((s, w), (n, e)):
                x, y = self.xy(la, lo); a, o = self.ll(x - tx, y - ty); sx.append(float(o)); sy.append(float(a))
        return min(sy) - pad, min(sx) - pad, max(sy) + pad, max(sx) + pad
