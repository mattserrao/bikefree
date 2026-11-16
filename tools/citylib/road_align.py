"""Road alignment for built routes and city streets: smooth centrelines in plan and rideable profiles.

Route-agnostic, numpy only (plus PIL for rasterising building footprints). Used by tools/build_city.py
(hooks tagged `[road-align]`); any other builder that turns mapped ways into a ride can use it too.

    from citylib import road_align as ra

    clear = ra.Clearance(buildings, clear_m=3.2)       # buildings: [polygon [(x, y), …]] in local metres
    sm = ra.align_plan(r2, clear=clear, drift=16, loop=True)   # r2: the mapped line resampled every 2 m
    e = ra.align_profile(ele10, bridge_mask, step=10, loop=True)
    pts = ra.round_street(pts, fixed, max_shift=1.5)   # a street's polyline, junction vertices kept

Plan (align_plan): the mapped line has right-angle corners and sideways jogs where OSM ways join. It is
  1. rounded (box filter, `corner_passes` × ±`corner_half_window` samples),
  2. eased where it still turns faster than `max_turn` °/m,
  3. faired: bi-Laplacian smoothing (`fair_iters`), which removes the short wiggles that make a ribbon
     zig-zag but keeps the shape of a corner,
  and after every step projected back into the allowed corridor: never more than `drift` m from the mapped
  line and never within `clear_m` of a building (where the mapped line itself is clear). The projection is
  continuous — a point that would enter a building slides back towards the mapped line only as far as it
  must — so it never snaps back to the raw corner (which is what left kinks before).

Profile (align_profile): elevation sampled along the mapped line (bridge decks interpolated by the caller).
Spikes narrower than ~2×`spike_m` are shaved; only notches narrower than ~2×`notch_m` are filled (where the
line brushes a wall or a cliff edge); real dips and crests are kept, so the road stays on its own ground.
Then the grade is limited to `max_grade` and grade changes to `max_grade_change` per sample, and the result
is lightly averaged. No steps: every rule moves samples continuously.
"""
import math

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


# ---------------------------------------------------------------- building clearance
class Clearance:
    """Is a point at least `clear_m` from every building footprint? Rasterised lazily in 64 m tiles at 0.5 m."""
    TILE, RES = 64.0, 0.5

    def __init__(self, polygons, clear_m=3.2):
        self.clear_m = clear_m
        self.grid = {}
        for poly in polygons:
            xs, ys = [p[0] for p in poly], [p[1] for p in poly]
            m = clear_m + 1
            for gx in range(int(math.floor((min(xs) - m) / self.TILE)), int(math.floor((max(xs) + m) / self.TILE)) + 1):
                for gy in range(int(math.floor((min(ys) - m) / self.TILE)), int(math.floor((max(ys) + m) / self.TILE)) + 1):
                    self.grid.setdefault((gx, gy), []).append(poly)
        self.tiles = {}

    def _tile(self, gx, gy):
        t = self.tiles.get((gx, gy))
        if t is not None: return t
        polys = self.grid.get((gx, gy))
        if not polys:
            self.tiles[(gx, gy)] = False
            return False
        pad = int(math.ceil((self.clear_m + 1) / self.RES))
        n = int(self.TILE / self.RES) + 2 * pad
        x0, y0 = gx * self.TILE - pad * self.RES, gy * self.TILE - pad * self.RES
        img = Image.new('1', (n, n), 0)
        dr = ImageDraw.Draw(img)
        for poly in polys:
            dr.polygon([((x - x0) / self.RES, (y - y0) / self.RES) for x, y in poly], fill=1)
        occ = np.array(img, dtype=bool)
        if not occ.any():
            self.tiles[(gx, gy)] = False
            return False
        dist = ndimage.distance_transform_edt(~occ) * self.RES
        blocked = (dist < self.clear_m)[pad:n - pad, pad:n - pad]
        self.tiles[(gx, gy)] = blocked
        return blocked

    def ok(self, xy):
        """xy: (n, 2) array → bool array (True: clear of buildings)."""
        xy = np.atleast_2d(xy)
        out = np.ones(len(xy), dtype=bool)
        gx = np.floor(xy[:, 0] / self.TILE).astype(int); gy = np.floor(xy[:, 1] / self.TILE).astype(int)
        keys = {}
        for k, key in enumerate(zip(gx.tolist(), gy.tolist())):
            if key in self.grid: keys.setdefault(key, []).append(k)
        m = int(self.TILE / self.RES)
        for (tx, ty), ks in keys.items():
            t = self._tile(tx, ty)
            if t is False: continue
            ks = np.array(ks)
            # the raster's row index is y (PIL draws y down the rows)
            u = np.clip(((xy[ks, 0] - tx * self.TILE) / self.RES).astype(int), 0, m - 1)
            v = np.clip(((xy[ks, 1] - ty * self.TILE) / self.RES).astype(int), 0, m - 1)
            out[ks] = ~t[v, u]
        return out


# ---------------------------------------------------------------- plan
def _roll_mean(p, w, loop):
    if w <= 0: return p
    if loop:
        acc = np.zeros_like(p)
        for o in range(-w, w + 1): acc += np.roll(p, -o, axis=0)
        return acc / (2 * w + 1)
    pad = np.concatenate([np.repeat(p[:1], w, 0), p, np.repeat(p[-1:], w, 0)])
    c = np.cumsum(np.vstack([np.zeros((1, p.shape[1])), pad]), axis=0)
    return (c[2 * w + 1:] - c[:-2 * w - 1]) / (2 * w + 1)


def turn_rates(p, loop=True):
    """Heading change at every sample, in degrees per metre (0 at the ends of an open line)."""
    a = np.roll(p, 1, 0) if loop else np.vstack([p[:1], p[:-1]])
    c = np.roll(p, -1, 0) if loop else np.vstack([p[1:], p[-1:]])
    t1 = np.arctan2(p[:, 1] - a[:, 1], p[:, 0] - a[:, 0]); t2 = np.arctan2(c[:, 1] - p[:, 1], c[:, 0] - p[:, 0])
    seg = (np.hypot(*(p - a).T) + np.hypot(*(c - p).T)) / 2
    d = np.abs((np.degrees(t2 - t1) + 540) % 360 - 180) / np.maximum(seg, .05)
    if not loop: d[0] = d[-1] = 0
    return d


def align_plan(raw, clear=None, drift=16.0, loop=True, corner_passes=3, corner_half_window=8, max_turn=4.5,
               fair_iters=240, fair_rate=.1, ease_iters=1500, log=print):
    """Smooth a mapped line (samples every ~2 m, local metres) → (n, 2) array, same sample count."""
    raw = np.asarray(raw, dtype=float)
    n = len(raw)
    free = clear.ok(raw) if clear is not None else np.ones(n, dtype=bool)   # constrained only where the map is clear

    def project(p, idx=None):
        """Back into the corridor: within `drift` of the mapped line, and clear of buildings (continuously)."""
        sel = np.arange(n) if idx is None else idx
        d = p[sel] - raw[sel]
        L = np.hypot(d[:, 0], d[:, 1])
        far = L > drift
        d[far] *= (drift / L[far])[:, None]
        q = raw[sel] + d
        if clear is not None:
            bad = free[sel] & ~clear.ok(q)
            if bad.any():
                b = np.flatnonzero(bad)
                lo, hi = np.zeros(len(b)), np.ones(len(b))
                for _ in range(10):   # largest share of the move that stays clear (the mapped point is clear)
                    mid = (lo + hi) / 2
                    okm = clear.ok(raw[sel[b]] + d[b] * mid[:, None])
                    lo = np.where(okm, mid, lo); hi = np.where(okm, hi, mid)
                q[b] = raw[sel[b]] + d[b] * lo[:, None]
        p = p.copy(); p[sel] = q
        return p

    p = raw.copy()
    for _ in range(corner_passes):
        p = project(_roll_mean(p, corner_half_window, loop))
    # ease the remaining tight spots (hairpins, park paths) until no turn is sharper than max_turn °/m
    it = 0
    for it in range(ease_iters):
        tight = turn_rates(p, loop) > max_turn
        if not tight.any(): break
        near = np.convolve(tight.astype(float), np.ones(21), 'same') > 0 if not loop else \
            np.convolve(np.concatenate([tight[-10:], tight, tight[:10]]).astype(float), np.ones(21), 'valid') > 0
        idx = np.flatnonzero(near)
        sm = _roll_mean(p, 7, loop)
        q = p.copy(); q[idx] = sm[idx]
        p = project(q, idx)
    log(f'  [road-align] corners eased in {it} passes, {int((turn_rates(p, loop) > max_turn).sum())} samples still tight')
    # fairing: bi-Laplacian steps (removes 10–30 m wiggles, keeps corners' shape), projected each time
    for _ in range(fair_iters):
        if loop:
            d4 = np.roll(p, 2, 0) - 4 * np.roll(p, 1, 0) + 6 * p - 4 * np.roll(p, -1, 0) + np.roll(p, -2, 0)
        else:
            d4 = np.zeros_like(p)
            d4[2:-2] = p[:-4] - 4 * p[1:-3] + 6 * p[2:-2] - 4 * p[3:-1] + p[4:]
        p = project(p - fair_rate * d4)
    return p


# ---------------------------------------------------------------- profile
def _filt(v, w, fn, loop):
    if w <= 0: return v
    if loop: stack = np.stack([np.roll(v, -o) for o in range(-w, w + 1)])
    else:
        pad = np.concatenate([np.repeat(v[:1], w), v, np.repeat(v[-1:], w)])
        stack = np.stack([pad[w + o:w + o + len(v)] for o in range(-w, w + 1)])
    return fn(stack, axis=0)


def align_profile(ele, fixed=None, step=10.0, loop=True, spike_m=20.0, notch_m=20.0, max_grade=.2,
                  max_grade_change=.03, mean_m=30.0, iters=60):
    """Rideable profile from elevation sampled every `step` m along the mapped line.

    `fixed`: optional bool mask of samples that must not move (none by default; bridge decks are already
    straight interpolations and pass through unchanged by the opening/closing). Returns an array.
    """
    e = np.asarray(ele, dtype=float).copy()
    fixed = np.zeros(len(e), dtype=bool) if fixed is None else np.asarray(fixed, dtype=bool)
    keep = e.copy()
    ws, wn = int(round(spike_m / step)), int(round(notch_m / step))
    e = _filt(_filt(e, ws, np.min, loop), ws, np.max, loop)     # opening: shave spikes
    e = _filt(_filt(e, wn, np.max, loop), wn, np.min, loop)     # closing: fill narrow notches only
    e[fixed] = keep[fixed]
    g_max, dg_max = max_grade * step, max_grade_change * step
    for _ in range(iters):
        moved = False
        # grade limit: pull both ends of a too-steep step towards each other
        d = (np.roll(e, -1) - e) if loop else np.diff(e)
        over = np.abs(d) - g_max
        if (over > 1e-6).any():
            moved = True
            corr = np.where(over > 0, np.sign(d) * over / 2, 0)
            de = np.zeros_like(e)
            if loop: de += corr; de -= np.roll(corr, 1)
            else: de[:-1] += corr; de[1:] -= corr
            de[fixed] = 0; e += de
        # grade-change limit: a sample that kinks the profile moves towards its neighbours' line
        mid = ((np.roll(e, 1) + np.roll(e, -1)) / 2) if loop else np.concatenate([[e[0]], (e[:-2] + e[2:]) / 2, [e[-1]]])
        k = e - mid
        over = np.abs(k) - dg_max / 2
        if (over > 1e-6).any():
            moved = True
            de = np.where(over > 0, -np.sign(k) * over * .5, 0)
            de[fixed] = 0; e += de
        if not moved: break
    wm = int(round(mean_m / step))
    out = _filt(e, wm, np.mean, loop)
    out[fixed] = keep[fixed]
    return out


# ---------------------------------------------------------------- streets
def round_street(pts, fixed, max_shift=1.5, min_turn=12.0, tol=.25):
    """Clean a street's polyline (local metres) between its junctions.

    pts: [(x, y)], fixed: [bool] (ends, shared/junction vertices: never moved or dropped).
    Drops vertices that sit within `tol` of the line through their neighbours (OSM jitter), then rounds
    every free corner sharper than `min_turn`° with a short arc whose middle stays within `max_shift` m of
    the mapped corner. Returns (points, fixed flags).
    """
    if len(pts) < 3: return list(pts), list(fixed)
    P, F = [pts[0]], [fixed[0]]
    for i in range(1, len(pts) - 1):
        if fixed[i]: P.append(pts[i]); F.append(True); continue
        a, b, c = P[-1], pts[i], pts[i + 1]
        dx, dy = c[0] - a[0], c[1] - a[1]; L = math.hypot(dx, dy)
        if L > 1e-6 and abs((b[0] - a[0]) * dy - (b[1] - a[1]) * dx) / L < tol: continue
        P.append(b); F.append(False)
    P.append(pts[-1]); F.append(fixed[-1])
    out, of = [P[0]], [F[0]]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        if F[i]: out.append(b); of.append(True); continue
        u = (b[0] - a[0], b[1] - a[1]); w = (c[0] - b[0], c[1] - b[1])
        lu, lw = math.hypot(*u), math.hypot(*w)
        if lu < .5 or lw < .5: out.append(b); of.append(False); continue
        th = math.acos(max(-1.0, min(1.0, (u[0] * w[0] + u[1] * w[1]) / (lu * lw))))
        if math.degrees(th) < min_turn: out.append(b); of.append(False); continue
        # tangent length t: the arc's middle sits t·tan(θ/2)·sin… ≈ t·tan(θ/4)… keep it simple and safe:
        # the quadratic Bézier through (b - t·û, b, b + t·ŵ) bulges in by t·sin(θ/2)/2 at most
        t = min(lu * .45, lw * .45, 2 * max_shift / max(.05, math.sin(th / 2)))
        p0 = (b[0] - u[0] / lu * t, b[1] - u[1] / lu * t); p2 = (b[0] + w[0] / lw * t, b[1] + w[1] / lw * t)
        k = max(2, min(6, int(math.degrees(th) / 12) + 1))
        for j in range(k + 1):
            f = j / k
            out.append(((1 - f) ** 2 * p0[0] + 2 * (1 - f) * f * b[0] + f * f * p2[0],
                        (1 - f) ** 2 * p0[1] + 2 * (1 - f) * f * b[1] + f * f * p2[1]))
            of.append(False)
    out.append(P[-1]); of.append(F[-1])
    return out, of


# ---------------------------------------------------------------- bridge decks
def deck_heights(edges, anchors):
    """Deck heights over a chain of bridge ways: linear along the deck between its ground ends.

    edges: [(a, b, length_m)] between consecutive deck nodes; anchors: {node: height} (the deck's ground ends).
    Solves the graph Laplace equation (weights 1/length) with the anchors fixed, so a two-ended deck is a
    straight ramp by distance along it and a forked one blends smoothly — unlike inverse-distance weights,
    which leave a deck flat at both ends and twice as steep in the middle. Returns {node: height}.
    """
    nbr = {}
    for a, b, L in edges:
        w = 1.0 / max(.5, L)
        nbr.setdefault(a, []).append((b, w)); nbr.setdefault(b, []).append((a, w))
    if not anchors: return {}
    free = [n for n in nbr if n not in anchors]
    out = {n: anchors[n] for n in nbr if n in anchors}
    if not free: return out
    ix = {n: k for k, n in enumerate(free)}
    A = np.zeros((len(free), len(free))); rhs = np.zeros(len(free))
    for n in free:
        k = ix[n]
        for m, w in nbr[n]:
            A[k, k] += w
            if m in ix: A[ix[m], k] -= w
            else: rhs[k] += w * anchors[m]
    try: sol = np.linalg.solve(A, rhs)
    except np.linalg.LinAlgError: sol = np.linalg.lstsq(A, rhs, rcond=None)[0]
    out.update({n: float(sol[ix[n]]) for n in free})
    return out


# ---------------------------------------------------------------- decks meeting the route ([w2-meets])
def _route_near(route_xy, route_e, x, y, reach):
    """Nearest point of the route polyline within `reach`: (distance, height, tangent) or None."""
    best = None
    for k in range(len(route_xy) - 1):
        (ax, ay), (bx, by) = route_xy[k], route_xy[k + 1]
        dx, dy = bx - ax, by - ay; l2 = dx * dx + dy * dy or 1.0
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / l2))
        d = math.hypot(ax + dx * t - x, ay + dy * t - y)
        if d < reach and (best is None or d < best[0]):
            l = math.sqrt(l2); best = (d, route_e[k] + (route_e[k + 1] - route_e[k]) * t, (dx / l, dy / l))
    return best


def deck_route_anchors(group_nodes, edges, node_xy, heights, anchors, route_xy, route_e, clear=4.9, below=1.5,
                       end_reach=9.0, cos_cross=.7):
    """Extra anchors for one deck chain so it meets the route properly (the builder's half of road meets):
    - a ground end of the deck within `end_reach` of the route sits at the route's height (the route's profile is
      smoothed, the DEM under an abutment isn't: they used to disagree by a metre or more, and the deck came in
      with a step or a sawtooth where the run-time pins pulled it under the road);
    - where the deck crosses over the route (not running along it) lower than `clear` above the road — but not
      more than `below` under it (then it passes under the route) — both ends of the crossing edge are held at
      the clearance height, so the deck rises over the rider instead of being cut open at run time.
    Returns {node: height} to add to the anchors (re-solve with deck_heights)."""
    out = {}
    for n, h in anchors.items():
        x, y = node_xy[n]
        r = _route_near(route_xy, route_e, x, y, end_reach)
        if r: out[n] = r[1] - .1
    deg = {}
    for a, b, L in edges: deg[a] = deg.get(a, 0) + 1; deg[b] = deg.get(b, 0) + 1
    # a deck that ends at the route meets it (at its height): it doesn't cross over it
    meets = any(deg.get(n) == 1 and _route_near(route_xy, route_e, *node_xy[n], 15.0) for n in deg)
    if meets: return out
    for a, b, L in edges:
        (ax, ay), (bx, by) = node_xy[a], node_xy[b]
        for f in (0.0, .25, .5, .75, 1.0):
            x, y = ax + (bx - ax) * f, ay + (by - ay) * f
            r = _route_near(route_xy, route_e, x, y, 6.0)
            if not r: continue
            ex, ey = (bx - ax) / (L or 1), (by - ay) / (L or 1)
            if abs(ex * r[2][0] + ey * r[2][1]) > cos_cross: continue   # along the route: its other half, not a crossing
            h = heights.get(a, 0) + (heights.get(b, 0) - heights.get(a, 0)) * f
            need = r[1] + clear
            if r[1] - below < h < need:
                for m in (a, b): out[m] = max(out.get(m, -1e9), need)
            break
    return out


def lift_over_route(edges, heights, anchors, needs, grade=.06, end_grade=.15):
    """Raise a deck chain smoothly where it must clear the route: `needs` {node: height} (deck_route_anchors' crossing
    holds). Every node rises by the most any crossing asks, less `grade` per metre of deck between them, and never
    faster than `end_grade` from the deck's ground ends (they stay put). Returns new {node: height}."""
    import heapq
    nbr = {}
    for a, b, L in edges: nbr.setdefault(a, []).append((b, L)); nbr.setdefault(b, []).append((a, L))
    def dists(srcs):
        d = {n: 0.0 for n in srcs}; q = [(0.0, n) for n in srcs]
        while q:
            c, n = heapq.heappop(q)
            if c > d.get(n, 1e18): continue
            for m, L in nbr.get(n, []):
                if c + L < d.get(m, 1e18): d[m] = c + L; heapq.heappush(q, (c + L, m))
        return d
    to_end = dists([n for n in anchors if n in nbr])
    out = dict(heights)
    for c, need in needs.items():
        up = need - heights.get(c, need)
        if up <= 0: continue
        dc = dists([c])
        for n in nbr:
            lift = min(up - grade * dc.get(n, 1e18), end_grade * to_end.get(n, 1e18))
            if lift > 0 and n not in anchors: out[n] = max(out[n], heights[n] + lift)
    return out
