"""Build the bikefree rider + road bike in Blender and export models/rider.json + the texture atlases.

Run with the bpy module:   python tools/build_rider.py        (pip install bpy pillow numpy; Python 3.13)
or headless Blender:       blender --background --python tools/build_rider.py   (needs pillow + numpy in Blender's Python)

Semi-realistic rider (rider-test, Nov 2026): one skinned mesh, one draw call.
  - Bones (flat, all in model space): bike (rocks side to side when standing), wheelF, wheelR, crank,
    pelvis, chest, head, upperArm/forearm/hand L+R, thigh/shin/foot L+R. The app poses them every frame
    (js/world/rider.js): two-bone IK for legs (hip → ankle on the pedal) and arms (shoulder → wrist on the
    hoods or drops), and three postures: seated, standing and pumping, and the descending tuck.
  - The body is metaball blobs (trunk + arms, each leg, head, hands, shoes), decimated, with smooth skin
    weights blended between neighbouring bones. The bike parts are rigid.
  - Every vertex has a UV into one atlas (models/rider-atlas.png; the pacer's kit is models/pacer-atlas.png),
    painted here from code: kit panels, pockets and back print, socks, shoes, helmet, frame decals, rim
    decals, bar tape, chain, bottle label, head-unit screen. Projections: cylindrical (limbs, trunk,
    bottle), side-on (frame, shoes; left side mirrored so text reads), polar (rims, rotors), spherical
    (head, helmet), along-the-path (tape, chain), and flat swatches.
  - Per vertex: baked ambient occlusion (ray cast in the rest pose) and a specular strength (aShade).
Blender axes: X = rider's right, Y = forward, Z = up. Exported in three.js axes (x = -X, y = Z, z = Y).
"""
import bpy, bmesh, math, json, base64, struct, os, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'models', 'rider.json')
ATLAS_OUT = {'rider': os.path.join(ROOT, 'models', 'rider-atlas.png'), 'pacer': os.path.join(ROOT, 'models', 'pacer-atlas.png')}
ATLAS = 2048          # atlas width; the height is set by packing (ATLAS_H)
ATLAS_H = 2048
random.seed(7)

scn = bpy.context.scene
COL = bpy.data.collections.get('BikefreeRider') or bpy.data.collections.new('BikefreeRider')
if COL.name not in [c.name for c in scn.collection.children]:
    scn.collection.children.link(COL)
for o in list(COL.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def V(*a): return Vector(a)


# =====================================================================================================
# Rig: rest pose (seated on the hoods, crank with the right pedal forward). All in Blender axes.
# =====================================================================================================
RH = V(0, -0.41, 0.335); FH = V(0, 0.575, 0.335); BB = V(0, 0.0, 0.27)
ST = V(0, -0.165, 0.84); HT = V(0, 0.47, 0.87); HB = V(0, 0.515, 0.72)
CR = 0.1725                      # crank length
WHEEL_R = 0.336                  # tyre outer radius
PEDX = 0.095                     # cleat / pedal centre, sideways from the bike's centre line
THIGH, SHIN = 0.445, 0.435
UPPER, FORE = 0.29, 0.27
REST_CRANK = math.pi / 2         # right pedal forward (right leg phase 0, left phase pi)
ANKLE_FROM_PEDAL = V(0, -0.095, 0.085)   # ankle above and behind the pedal spindle (foot at rest pitch)
HC = V(0, -0.165, 1.03)          # hip centre (pelvis bone)
LB = V(0, -0.125, 1.12)          # lumbar (chest bone pivot)
NB = V(0, 0.255, 1.365)          # neck base (head bone pivot)
HEADC = V(0, 0.41, 1.49)         # centre of the head
SIDES = {'R': 1, 'L': -1}


def ankle_pitch(a):
    """Toe-down ankling through the pedal stroke (rad), same as the app."""
    return 0.1 + 0.18 * math.sin(a)


def pedal_at(s, a):
    return BB + V(s * PEDX, math.sin(a) * CR, math.cos(a) * CR)


def rot_x(t):
    """Toe-down by t (three.js rotation about +x == Blender rotation about -X)."""
    return Matrix.Rotation(-t, 3, 'X')


def ik2(A, T, l1, l2, pole):
    d = T - A; L = min(l1 + l2 - 1e-4, d.length); dn = d.normalized()
    k = math.acos(max(-1, min(1, (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L))))
    p = (pole - dn * pole.dot(dn)).normalized()
    return A + (dn * math.cos(k) + p * math.sin(k)) * l1


J = {'HC': HC, 'LB': LB, 'NB': NB, 'HEADC': HEADC}
for side, s in SIDES.items():
    a = REST_CRANK + (0 if side == 'R' else math.pi)
    J['HIP' + side] = HC + V(s * 0.09, 0, 0)
    J['PEDAL' + side] = pedal_at(s, a)
    J['ANKLE' + side] = J['PEDAL' + side] + ANKLE_FROM_PEDAL
    J['KNEE' + side] = ik2(J['HIP' + side], J['ANKLE' + side], THIGH, SHIN, V(0, 1, 0))
    J['TOE' + side] = J['ANKLE' + side] + rot_x(ankle_pitch(a)) @ V(0, 0.2, -0.07)
    J['SH' + side] = V(s * 0.165, 0.235, 1.335)
    J['G' + side] = V(s * 0.21, 0.666, 0.952)              # palm on top of the hood
    J['WR' + side] = J['G' + side] + V(-s * 0.004, -0.07, 0.016)
    J['ELB' + side] = ik2(J['SH' + side], J['WR' + side], UPPER, FORE, V(s * 0.7, -0.3, -1).normalized())
    J['D' + side] = V(s * 0.222, 0.612, 0.80)              # palm on the drops
ELBOW_POLE = {s: V(SIDES[s] * 0.7, -0.3, -1).normalized() for s in SIDES}

BONES = ['bike', 'wheelF', 'wheelR', 'crank', 'pelvis', 'chest', 'head',
         'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR',
         'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR']
BI = {n: i for i, n in enumerate(BONES)}
PIVOT = {'bike': V(0, 0, 0), 'wheelF': FH, 'wheelR': RH, 'crank': BB, 'pelvis': HC, 'chest': LB, 'head': NB}
SEG = {'pelvis': (HC, LB), 'chest': (LB, NB), 'head': (NB, HEADC)}
RAD = {'pelvis': 0.10, 'chest': 0.12, 'head': 0.055}
for side in SIDES:
    PIVOT.update({'upperArm' + side: J['SH' + side], 'forearm' + side: J['ELB' + side], 'hand' + side: J['WR' + side],
                  'thigh' + side: J['HIP' + side], 'shin' + side: J['KNEE' + side], 'foot' + side: J['ANKLE' + side]})
    SEG.update({'upperArm' + side: (J['SH' + side], J['ELB' + side]), 'forearm' + side: (J['ELB' + side], J['WR' + side]),
                'hand' + side: (J['WR' + side], J['G' + side]), 'thigh' + side: (J['HIP' + side], J['KNEE' + side]),
                'shin' + side: (J['KNEE' + side], J['ANKLE' + side]), 'foot' + side: (J['ANKLE' + side], J['TOE' + side])})
    RAD.update({'upperArm' + side: 0.05, 'forearm' + side: 0.04, 'hand' + side: 0.03,
                'thigh' + side: 0.07, 'shin' + side: 0.045, 'foot' + side: 0.04})
LINKS = {('pelvis', 'chest'), ('chest', 'head')}
for side in SIDES:
    LINKS |= {('chest', 'upperArm' + side), ('upperArm' + side, 'forearm' + side), ('forearm' + side, 'hand' + side),
              ('pelvis', 'thigh' + side), ('thigh' + side, 'shin' + side), ('shin' + side, 'foot' + side)}
NEIGH = {b: set() for b in BONES}
for a, b in LINKS:
    NEIGH[a].add(b); NEIGH[b].add(a)


def seg_dist(p, a, b):
    ab = b - a; t = max(0, min(1, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length, t


# =====================================================================================================
# Colours, tiles and projections
# =====================================================================================================
def hexrgb(h):
    h = h.lstrip('#'); return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


KIT = {
    'rider': {'main': '#ff7a1a', 'panel': '#1f2a44', 'accent': '#ffffff', 'shorts': '#121417', 'checks': None,
              'frame': '#1f2a44', 'frameAccent': '#ff7a1a', 'helmet': '#f4f4f4', 'helmetAccent': '#ff7a1a', 'shoe': '#f2f2f2'},
    'pacer': {'main': '#ffd21f', 'panel': '#16181c', 'accent': '#16181c', 'shorts': '#121417', 'checks': '#16181c',
              'frame': '#16181c', 'frameAccent': '#ffd21f', 'helmet': '#16181c', 'helmetAccent': '#ffd21f', 'shoe': '#16181c'},
}
SWATCH = {  # flat colours (sRGB) for parts with no print
    'skin': '#d6a07c', 'black': '#141518', 'carbon': '#1a1b1f', 'rubber': '#202124', 'alloy': '#a9aeb5',
    'hub': '#2a2d33', 'saddle': '#16181b', 'ring': '#2e3136', 'cassette': '#b9bec6', 'glove': '#1d1e22',
    'lens': '#1b2230', 'helmetInner': '#2c2c2e', 'tyre': '#1e1e1f', 'cleat': '#d8452a', 'sole': '#18191c',
    'gloveAccent': '#ff7a1a', 'strap': '#1c1d20', 'bottleCap': '#16181b', 'mount': '#24262b', 'hood': '#1c1d21',
}
# specular strength per tile (aShade.y): helmet and frame paint shine, fabric and rubber hardly
SPEC = {'torso': .14, 'arm': .14, 'thigh': .18, 'shin': .26, 'head': .22, 'helmet': .75, 'frame': .8, 'rim': .55,
        'shoe': .55, 'tape': .1, 'chain': .7, 'bottle': .5, 'screen': .9, 'glove': .12, 'rotor': .8,
        'skin': .26, 'black': .3, 'carbon': .6, 'rubber': .06, 'alloy': .8, 'hub': .5, 'saddle': .35, 'ring': .6,
        'cassette': .8, 'lens': 1.0, 'helmetInner': .1, 'tyre': .06, 'cleat': .3, 'sole': .2, 'gloveAccent': .12,
        'strap': .1, 'bottleCap': .3, 'mount': .4, 'hood': .1}


class Tile:
    def __init__(self, name, w, h, wrap=False, paint=None, base=None):
        self.name, self.w, self.h, self.wrap, self.paint = name, w, h, wrap, paint
        self.base = base or name
        self.mu = 0.07 if wrap else 0.015
        self.mv = 0.015
        self.x = self.y = 0

    def atlas_uv(self, u, v):
        return ((self.x + (u + self.mu) / (1 + 2 * self.mu) * self.w) / ATLAS,
                (self.y + (v + self.mv) / (1 + 2 * self.mv) * self.h) / ATLAS_H)

    def px(self, u, v):
        return ((u + self.mu) / (1 + 2 * self.mu) * self.w, (v + self.mv) / (1 + 2 * self.mv) * self.h)


TILES = {}


def tile(name, w, h, wrap=False, paint=None, sided=False):
    if sided:
        for sd in 'RL':
            TILES[name + '_' + sd] = Tile(name + '_' + sd, w, h, wrap, paint, base=name)
    else:
        TILES[name] = Tile(name, w, h, wrap, paint)


SW_N = 8   # swatches per row
SW_PX = 48
swatch_names = list(SWATCH)
TILES['swatches'] = Tile('swatches', SW_N * SW_PX, ((len(swatch_names) + SW_N - 1) // SW_N) * SW_PX)
TILES['swatches'].mu = TILES['swatches'].mv = 0


def swatch_uv(name):
    i = swatch_names.index(name); t = TILES['swatches']
    return ((t.x + (i % SW_N + 0.5) * SW_PX) / ATLAS, (t.y + (i // SW_N + 0.5) * SW_PX) / ATLAS_H)


# ---- projections: uv(co, face_normal) -> (tile name, u, v); u,v in [0,1] tile domain, v down the image
class Swatch:
    wrap = False
    def __init__(self, name): self.name = name


class Side:
    """Side-on (along X). Right/left faces use separate tiles; the left one is mirrored so prints read."""
    wrap = False
    def __init__(self, base, y0, y1, z0, z1, frame=None):
        self.base, self.y0, self.y1, self.z0, self.z1 = base, y0, y1, z0, z1
        self.frame = frame   # optional (origin, 3x3) to project in a part's own frame (shoes)

    def uv(self, co, n):
        if self.frame:
            o, m = self.frame; co = m @ (co - o); n = m @ n
        side = 'R' if n.x >= 0 else 'L'
        u = (co.y - self.y0) / (self.y1 - self.y0)
        return self.base + '_' + side, (u if side == 'R' else 1 - u), (self.z1 - co.z) / (self.z1 - self.z0)


class Cyl:
    """Around the axis a -> b: u = angle (0.5 at `ref`), v = 1 at a, 0 at b (so b is the top of the image)."""
    wrap = True
    def __init__(self, base, a, b, ref):
        self.base, self.a = base, Vector(a); self.L = (Vector(b) - self.a).length
        self.w = (Vector(b) - self.a).normalized()
        self.e1 = (Vector(ref) - self.w * Vector(ref).dot(self.w)).normalized(); self.e2 = self.w.cross(self.e1)

    def uv(self, co, n):
        d = co - self.a; t = d.dot(self.w) / self.L
        ang = math.atan2(d.dot(self.e2), d.dot(self.e1))
        return self.base, 0.5 + ang / (2 * math.pi), 1 - t


class Polar:
    """Around the X axis through `hub`: u = angle, v = radius from r0 (top) to r1. Sided if asked."""
    wrap = True
    def __init__(self, base, hub, r0, r1, sided=True):
        self.base, self.hub, self.r0, self.r1, self.sided = base, Vector(hub), r0, r1, sided

    def uv(self, co, n, fc=None):
        d = co - self.hub
        ang = math.atan2(d.z, d.y); r = math.hypot(d.y, d.z)
        u = 0.5 + ang / (2 * math.pi); v = (r - self.r0) / (self.r1 - self.r0)
        if not self.sided: return self.base, u, v
        side = 'R' if ((fc if fc is not None else co).x - self.hub.x) >= 0 else 'L'
        return self.base + '_' + side, (u if side == 'R' else 1 - u), v


class Sph:
    """Around Z through `c`: u = azimuth (0.5 at the back), v = 0 at the top to 1 at `vmax` rad from the top."""
    wrap = True
    def __init__(self, base, c, vmax=math.pi):
        self.base, self.c, self.vmax = base, Vector(c), vmax

    def uv(self, co, n):
        d = co - self.c; r = max(d.length, 1e-6)
        az = math.atan2(d.x, -d.y)
        return self.base, 0.5 + az / (2 * math.pi), math.acos(max(-1, min(1, d.z / r))) / self.vmax


class Stored:
    """UVs written while building (tubes along a path: tape, chain)."""
    wrap = False
    def __init__(self, base): self.base = base


class TopDown:
    wrap = False
    def __init__(self, base, cx, cy, sx, sy): self.base, self.cx, self.cy, self.sx, self.sy = base, cx, cy, sx, sy

    def uv(self, co, n):
        return self.base, (co.x - self.cx) / self.sx + 0.5, 0.5 - (co.y - self.cy) / self.sy


# =====================================================================================================
# Pieces and primitives
# =====================================================================================================
PIECES = []


class Piece:
    """A mesh under construction. Faces carry a projection; rigid pieces belong to one bone,
    skinned pieces get blended weights from `cands`. `classify(face centre) -> projection` overrides."""
    def __init__(self, name, bone=None, cands=None, ao='bike', classify=None, smooth_weights=0):
        self.name, self.bone, self.cands, self.ao, self.classify = name, bone, cands, ao, classify
        self.smooth_weights = smooth_weights
        self.bm = bmesh.new()
        self.lproj = self.bm.faces.layers.int.new('proj')
        self.luv = self.bm.loops.layers.uv.new('uv')
        self.projs = []
        PIECES.append(self)

    def add(self, bm, proj, flat=False):
        if proj not in self.projs: self.projs.append(proj)
        pi = self.projs.index(proj)
        uvl = bm.loops.layers.uv.active
        vmap = {v: self.bm.verts.new(v.co) for v in bm.verts}
        for f in bm.faces:
            try:
                nf = self.bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                continue
            nf[self.lproj] = pi; nf.smooth = not flat
            if uvl is not None:
                for ln, lo in zip(nf.loops, f.loops): ln[self.luv].uv = lo[uvl].uv
        bm.free()


def new_bm(): return bmesh.new()


def xform(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts); return bm


def cyl(a, b, r, segs=12, r2=None, caps=True):
    a, b = Vector(a), Vector(b); bm = new_bm(); d = b - a
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=segs, radius1=r, radius2=(r if r2 is None else r2), depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return xform(bm, Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())


def box(center, size, bevel=0.0, segs=2, shape=None):
    bm = new_bm(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    if shape:
        for v in bm.verts: shape(v)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def sphere(center, radii, us=16, vs=10):
    bm = new_bm(); bmesh.ops.create_uvsphere(bm, u_segments=us, v_segments=vs, radius=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return bm


def lathe(hub, profile, segs=64, closed=True):
    """Revolve [(radius, x offset)] around the X axis through hub."""
    hub = Vector(hub); bm = new_bm(); rings = []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        rings.append([bm.verts.new((hub.x + x, hub.y + r * math.cos(t), hub.z + r * math.sin(t))) for r, x in profile])
    n = len(profile)
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % segs]
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            bm.faces.new((A[j], B[j], B[k], A[k]))
    return bm


def tube(pts, rx, rz=None, segs=14, samples=10, lateral=Vector((1, 0, 0)), uv=False, caps=True, taper=None):
    """Smooth tube through points (Catmull-Rom). Cross-section: rx along `lateral`, rz across it.
    uv=True stores u = arc length / total, v = angle (for tape, chain)."""
    pts = [Vector(p) for p in pts]; rz = rx if rz is None else rz

    def cr(p0, p1, p2, p3, t):
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    if len(pts) == 2:
        path = [pts[0].lerp(pts[1], k / samples) for k in range(samples + 1)]
    else:
        ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
        path = []
        for i in range(1, len(ext) - 2):
            for k in range(samples):
                path.append(cr(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], k / samples))
        path.append(pts[-1])
    lens = [0.0]
    for i in range(1, len(path)): lens.append(lens[-1] + (path[i] - path[i - 1]).length)
    total = lens[-1] or 1
    bm = new_bm(); rings = []
    uvl = bm.loops.layers.uv.new('uv') if uv else None
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        lat = Vector(lateral); lat = (lat - t * lat.dot(t))
        if lat.length < 1e-4: lat = t.orthogonal()
        lat.normalize(); oth = t.cross(lat)
        k = taper(lens[i] / total) if taper else 1.0
        rings.append([bm.verts.new(p + (lat * math.cos(2 * math.pi * j / segs) * rx + oth * math.sin(2 * math.pi * j / segs) * rz) * k)
                      for j in range(segs)])
    for i in range(len(rings) - 1):
        for j in range(segs):
            f = bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % segs], rings[i][(j + 1) % segs]))
            if uvl:
                for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                    l[uvl].uv = (lens[ii] / total, jj / segs)
    if caps:
        for ring in (list(reversed(rings[0])), rings[-1]):
            f = bm.faces.new(ring)
            if uvl:
                for l in f.loops: l[uvl].uv = (0.0 if ring is not rings[-1] else 1.0, 0.5)
    return bm


def meta(elems, res, ratio=1.0, thresh=0.6, scale=1.42):
    """Metaball blob -> bmesh (decimated). elems: ('ball', centre, r) | ('cap', (a, b), r)."""
    mb = bpy.data.metaballs.new('bf_mb')
    mb.resolution = res; mb.render_resolution = res; mb.threshold = thresh
    for kind, data, r in elems:
        if kind == 'ball':
            e = mb.elements.new(type='BALL'); e.co = Vector(data); e.radius = r * scale
        elif kind == 'ell':
            e = mb.elements.new(type='ELLIPSOID'); e.co = Vector(data[0]); e.radius = r * scale
            e.size_x, e.size_y, e.size_z = data[1]
        else:
            a, b = Vector(data[0]), Vector(data[1]); d = b - a
            e = mb.elements.new(type='CAPSULE'); e.co = (a + b) / 2; e.radius = r * scale
            e.size_x = max(d.length / 2, 1e-4)
            e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = 2.0
    tmp = bpy.data.objects.new('bfBlob', mb); COL.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True); bpy.data.metaballs.remove(mb)
    if ratio < 1:
        o = bpy.data.objects.new('bfDec', me); COL.objects.link(o)
        mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = ratio
        dg.update()
        me2 = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        bpy.data.objects.remove(o, do_unlink=True); bpy.data.meshes.remove(me); me = me2
    bm = new_bm(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    return bm


def lerp(a, b, t): return Vector(a).lerp(Vector(b), t)


# =====================================================================================================
# Tiles (sizes); painters are defined further down
# =====================================================================================================
tile('torso', 1024, 512, wrap=True)
tile('arm', 256, 256, wrap=True)
tile('thigh', 256, 256, wrap=True)
tile('shin', 256, 256, wrap=True)
tile('head', 256, 256, wrap=True)
tile('helmet', 512, 256, wrap=True)
tile('glove', 128, 128, wrap=True)
tile('frame', 1020, 640, sided=True)
tile('rim', 1020, 64, wrap=True, sided=True)
tile('rotor', 512, 48, wrap=True)
tile('tape', 1020, 24)
tile('chain', 1020, 16)
tile('shoe', 256, 128, sided=True)
tile('bottle', 256, 128, wrap=True)
tile('screen', 96, 96)

FRAME_P = Side('frame', -0.78, 0.98, -0.02, 1.08)
CARBON = Swatch('carbon'); BLACK = Swatch('black'); ALLOY = Swatch('alloy'); RUBBER = Swatch('rubber')

# =====================================================================================================
# Bike (rigid): frame, fork, cockpit, saddle, bottles, drivetrain, wheels
# =====================================================================================================
P = Piece('Frame', bone='bike', ao='bike')
F = FRAME_P
P.add(cyl(BB + V(-0.043, 0, 0), BB + V(0.043, 0, 0), 0.024, 18), F)
P.add(tube([BB + V(0, 0.012, 0.012), lerp(BB, HB, 0.5) + V(0, 0, 0.004), HB + V(0, -0.012, -0.004)], 0.022, 0.029, 14, 6), F)
P.add(tube([BB + V(0, -0.006, 0.02), V(0, -0.075, 0.5), ST + V(0, 0, -0.02)], 0.017, 0.025, 14, 6), F)
P.add(tube([ST + V(0, 0.01, -0.035), lerp(ST, HT, 0.5) + V(0, 0, -0.035), HT + V(0, -0.016, -0.03)], 0.016, 0.019, 14, 8), F)
P.add(tube([HB + V(0, 0.002, -0.045), HT + V(0, -0.004, 0.002)], 0.021, 0.029, 16, 6, taper=lambda t: 1.08 - 0.12 * t), F)
SSJ = V(0, -0.115, 0.715)        # dropped seatstay junction on the seat tube
for s in (-1, 1):
    P.add(tube([BB + V(s * 0.03, -0.02, -0.004), BB + V(s * 0.058, -0.2, 0.028), RH + V(s * 0.062, 0.016, 0.0)], 0.0095, 0.016, 12, 8), F)
    P.add(tube([SSJ + V(s * 0.012, -0.01, 0), SSJ + V(s * 0.04, -0.13, -0.15), RH + V(s * 0.062, 0.008, 0.016)], 0.0085, 0.013, 12, 8), F)
    P.add(box(RH + V(s * 0.062, 0.006, 0.006), (0.008, 0.04, 0.04), bevel=0.008, segs=2), F)
    # fork leg (aero blade) from the crown to the front axle
    P.add(tube([HB + V(s * 0.04, 0.008, -0.065), V(s * 0.054, 0.545, 0.53), FH + V(s * 0.056, 0.004, 0.0)], 0.0115, 0.021, 12, 8), F)
    P.add(box(FH + V(s * 0.056, 0.0, 0.004), (0.008, 0.036, 0.036), bevel=0.008, segs=2), F)
P.add(box(HB + V(0, 0.006, -0.06), (0.11, 0.05, 0.035), bevel=0.016, segs=3), F)              # fork crown
# seatpost, clamp
P.add(tube([ST + V(0, 0, -0.03), V(0, -0.196, 0.955)], 0.0135, 0.021, 14, 4), F)
P.add(cyl(ST + V(0, 0.002, -0.012), ST + V(0, 0.002, 0.008), 0.024, 16), BLACK)

def saddle_shape(v):
    t = (v.co.y + 0.135) / 0.27
    v.co.x *= 1.0 - 0.62 * max(0, t - 0.32) / 0.68
    v.co.z += -0.014 * max(0, t - 0.62) + 0.006 * (1 - abs(v.co.x) / 0.07) * (1 if v.co.z > 0 else 0)
P.add(box(V(0, -0.205, 0.978), (0.135, 0.275, 0.032), bevel=0.014, segs=3, shape=saddle_shape), Swatch('saddle'))
for s in (-1, 1):
    P.add(tube([V(s * 0.03, -0.29, 0.965), V(s * 0.028, -0.2, 0.948), V(s * 0.02, -0.11, 0.962)], 0.0035, segs=6, samples=6), ALLOY)
P.add(box(V(0, -0.197, 0.952), (0.04, 0.05, 0.018), bevel=0.005), BLACK)
# integrated cockpit: spacers, stem, bars, hoods, levers
CP = Swatch('carbon')
P.add(cyl(HT + V(0, 0, -0.004), HT + V(0, -0.004, 0.03), 0.02, 16), CP)
P.add(tube([HT + V(0, -0.004, 0.032), V(0, 0.53, 0.905), V(0, 0.575, 0.905)], 0.018, 0.017, 14, 6), CP)
BC = V(0, 0.582, 0.905)          # bar centre
P.add(tube([V(-0.085, 0.58, 0.905), V(0, 0.575, 0.906), V(0.085, 0.58, 0.905)], 0.016, 0.009, 14, 8, lateral=V(0, 1, 0)), CP)
TAPE = Stored('tape')
for s in (-1, 1):
    pts = [(s * 0.08, 0.579, 0.905), (s * 0.21, 0.6, 0.905), (s * 0.212, 0.665, 0.9), (s * 0.217, 0.7, 0.86),
           (s * 0.222, 0.687, 0.8), (s * 0.222, 0.63, 0.785), (s * 0.222, 0.565, 0.79)]
    P.add(tube(pts, 0.0125, segs=10, samples=6, uv=True, caps=False, lateral=V(0, 0, 1)), TAPE)
    P.add(cyl(V(s * 0.222, 0.567, 0.79), V(s * 0.222, 0.559, 0.79), 0.012, 12), BLACK)
    # hood: lever body with a horn at the front
    def hood_shape(v, s=s):
        t = (v.co.y + 0.04) / 0.08
        v.co.z += 0.01 * max(0, t - 0.55) / 0.45 * (1 if v.co.z > 0 else 0.4)
        v.co.x *= 1.0 - 0.18 * max(0, t - 0.6)
    P.add(box(V(s * 0.212, 0.664, 0.928), (0.031, 0.08, 0.044), bevel=0.013, segs=3, shape=hood_shape), Swatch('hood'))
    P.add(tube([V(s * 0.212, 0.697, 0.93), V(s * 0.214, 0.718, 0.88), V(s * 0.218, 0.71, 0.82)], 0.0055, 0.011, 8, 6), CP)
# out-front computer mount and head unit (screen faces up at the chase camera)
P.add(tube([V(0, 0.582, 0.905), V(0, 0.64, 0.912)], 0.008, 0.006, 8, 3), Swatch('mount'))
unit = box(V(0, 0.665, 0.922), (0.052, 0.082, 0.017), bevel=0.006, segs=2)
P.add(xform(unit, Matrix.Translation(V(0, 0.665, 0.922)) @ Matrix.Rotation(math.radians(8), 4, 'X') @ Matrix.Translation(-V(0, 0.665, 0.922))), Swatch('mount'))
scr = box(V(0, 0.667, 0.9312), (0.042, 0.064, 0.001))
P.add(xform(scr, Matrix.Translation(V(0, 0.665, 0.922)) @ Matrix.Rotation(math.radians(8), 4, 'X') @ Matrix.Translation(-V(0, 0.665, 0.922))),
      TopDown('screen', 0, 0.667, 0.044, 0.066))
# bottle cages + bottles on the down and seat tubes
BOTTLE = []
for (a, b, off) in ((BB, HB, 0.21), (BB, ST, 0.26)):
    d = (b - a).normalized(); nrm = V(0, -d.z, d.y) if b is HB else V(0, d.z, -d.y)
    if nrm.z < 0: nrm = -nrm
    c0 = a + d * off + nrm * 0.055; c1 = c0 + d * 0.2
    P.add(cyl(c0, c1, 0.036, 20), Cyl('bottle', c0, c1, -nrm))
    P.add(cyl(c1, c1 + d * 0.025, 0.026, 16, 0.016), Swatch('bottleCap'))
    for s in (-1, 1):
        P.add(tube([a + d * (off + 0.01) + nrm * 0.022, c0 + d * 0.05 + nrm * -0.02 + V(s * 0.03, 0, 0), c0 + d * 0.16 + V(s * 0.035, 0, 0) + nrm * -0.01],
                   0.003, segs=6, samples=6), BLACK)
# brakes: flat-mount calipers on the left
P.add(box(FH + V(-0.05, -0.065, 0.045), (0.022, 0.07, 0.035), bevel=0.008), ALLOY)
P.add(box(RH + V(-0.055, 0.06, 0.04), (0.022, 0.07, 0.035), bevel=0.008), ALLOY)
# derailleurs and chain (static; teeth and cassette turn with their bones)
P.add(box(V(0.03, -0.075, 0.43), (0.02, 0.06, 0.028), bevel=0.008), BLACK)
P.add(box(V(0.062, -0.43, 0.3), (0.018, 0.04, 0.05), bevel=0.008), BLACK)
P.add(box(V(0.062, -0.40, 0.24), (0.005, 0.035, 0.11), bevel=0.003), BLACK)
P.add(lathe(V(0.056, -0.395, 0.275), [(0.018, -0.004), (0.018, 0.004), (0.006, 0.004), (0.006, -0.004)], 16), ALLOY)
P.add(lathe(V(0.056, -0.405, 0.205), [(0.018, -0.004), (0.018, 0.004), (0.006, 0.004), (0.006, -0.004)], 16), ALLOY)
RING_R, COG_R = 0.106, 0.042
ring_pts = [(0.047, BB.y + RING_R * math.cos(math.radians(x)), BB.z + RING_R * math.sin(math.radians(x))) for x in (-45, -15, 20, 55, 90)]
cog_pts = [(0.05, RH.y + COG_R * math.cos(math.radians(x)), RH.z + COG_R * math.sin(math.radians(x))) for x in (90, 130, 175, 220, 250)]
# top run ring -> cog, round the back of the cog, down through the jockey wheels, bottom run back to the ring
cpath = ring_pts + cog_pts + [(0.054, -0.381, 0.276), (0.056, -0.392, 0.23), (0.056, -0.405, 0.186), (0.054, -0.3, 0.178)] + \
        [(0.049, BB.y + RING_R * math.cos(math.radians(x)), BB.z + RING_R * math.sin(math.radians(x))) for x in (-115, -85, -60)]
P.add(tube(cpath, 0.0035, 0.0055, 6, 6, uv=True, caps=False), Stored('chain'))

# ---- wheels
def wheel(name, hub, rear):
    P = Piece(name, bone=name, ao=name)
    P.add(lathe(hub, [(0.322 + 0.0135 * math.cos(t), 0.0135 * math.sin(t)) for t in [2 * math.pi * k / 12 for k in range(12)]], 72),
          Swatch('tyre'))
    rim = [(0.3105, 0.0118), (0.304, 0.0135), (0.29, 0.0138), (0.275, 0.012), (0.266, 0.0085), (0.2615, 0.004), (0.26, 0.0),
           (0.2615, -0.004), (0.266, -0.0085), (0.275, -0.012), (0.29, -0.0138), (0.304, -0.0135), (0.3105, -0.0118)]
    P.add(lathe(hub, rim, 72), Polar('rim', hub, 0.26, 0.312))
    P.add(lathe(hub, [(0.011, -0.055), (0.019, -0.05), (0.022, -0.04), (0.031, -0.036), (0.031, -0.031), (0.02, -0.028),
                      (0.018, 0.0), (0.02, 0.028), (0.031, 0.031), (0.031, 0.036), (0.022, 0.04), (0.019, 0.05), (0.011, 0.055)], 20, closed=False),
          Swatch('hub'))
    for i in range(24):   # bladed spokes, two-cross at the rear
        t = 2 * math.pi * i / 24; side = 1 if i % 2 else -1
        t0 = t + (0.18 * (1 if (i // 2) % 2 else -1) if rear else 0)
        a = hub + V(side * 0.033, 0.03 * math.cos(t0), 0.03 * math.sin(t0)); b = hub + V(side * 0.004, 0.262 * math.cos(t), 0.262 * math.sin(t))
        d = (b - a); m = Matrix.Translation((a + b) / 2) @ Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        sb = box(V(0, 0, 0), (0.0018, 0.0042, d.length)); xform(sb, m); P.add(sb, BLACK, flat=True)
    # disc rotor + spider (left)
    P.add(lathe(hub + V(-0.047, 0, 0), [(0.0805, -0.001), (0.0805, 0.001), (0.064, 0.001), (0.064, -0.001)], 48), Polar('rotor', hub, 0.064, 0.0805, sided=False))
    for i in range(6):
        t = 2 * math.pi * i / 6
        P.add(tube([hub + V(-0.047, 0.022 * math.cos(t), 0.022 * math.sin(t)), hub + V(-0.047, 0.066 * math.cos(t + 0.25), 0.066 * math.sin(t + 0.25))],
                   0.002, 0.006, 6, 2, lateral=V(1, 0, 0)), Swatch('alloy'))
    if rear:   # cassette
        for k in range(9):
            r = 0.058 - k * 0.0042
            P.add(lathe(hub + V(0.033 + k * 0.0045, 0, 0), [(r, -0.0012), (r, 0.0012), (0.02, 0.0012), (0.02, -0.0012)], 22), Swatch('cassette'))
    else:
        P.add(cyl(hub + V(0.0, -0.0, 0.262), hub + V(0.0, 0, 0.28), 0.003, 6), ALLOY)   # valve
    return P


wheel('wheelR', RH, True); wheel('wheelF', FH, False)

# ---- crank: chainrings with teeth, spider, arms (right arm up in the rest pose; the app turns it)
P = Piece('crank', bone='crank', ao='crank')

def chainring(x, r_out, teeth, r_in):
    bm = new_bm(); outer = []; inner = []
    n = teeth * 4
    for k in range(n):
        t = 2 * math.pi * k / n; ph = k % 4
        r = r_out if ph in (1, 2) else r_out - 0.004
        tt = t + (0.15 if ph == 1 else -0.15 if ph == 2 else 0) * (2 * math.pi / teeth) * 0.5
        outer.append((r * math.cos(tt), r * math.sin(tt)))
        inner.append((r_in * math.cos(t), r_in * math.sin(t)))
    ring = []
    for dx in (-0.0018, 0.0018):
        ring.append(([bm.verts.new((BB.x + x + dx, BB.y + p[0], BB.z + p[1])) for p in outer],
                     [bm.verts.new((BB.x + x + dx, BB.y + p[0], BB.z + p[1])) for p in inner]))
    (o0, i0), (o1, i1) = ring
    for k in range(n):
        k2 = (k + 1) % n
        bm.faces.new((o0[k], o0[k2], i0[k2], i0[k])); bm.faces.new((o1[k], i1[k], i1[k2], o1[k2]))
        bm.faces.new((o0[k], o1[k], o1[k2], o0[k2])); bm.faces.new((i0[k], i0[k2], i1[k2], i1[k]))
    return bm

P.add(chainring(0.047, RING_R + 0.004, 52, 0.088), Swatch('ring'), flat=True)
P.add(chainring(0.040, 0.077, 36, 0.064), Swatch('ring'), flat=True)
for i in range(4):
    t = math.pi / 2 + 2 * math.pi * (i + 0.5) / 4
    P.add(tube([BB + V(0.05, 0.02 * math.cos(t), 0.02 * math.sin(t)), BB + V(0.047, 0.09 * math.cos(t), 0.09 * math.sin(t))], 0.004, 0.009, 8, 2), BLACK)
P.add(cyl(BB + V(0.05, 0, 0), BB + V(0.056, 0, 0), 0.03, 24), BLACK)
P.add(cyl(BB + V(-0.072, 0, 0), BB + V(0.072, 0, 0), 0.011, 12), ALLOY)
for s in (-1, 1):   # right arm up (+Z), left arm down; tapered aero arms out to the spindle
    end = BB + V(s * 0.075, 0, s * CR)
    P.add(tube([BB + V(s * 0.068, 0, 0), BB + V(s * 0.073, 0, s * CR * 0.5), end], 0.0085, 0.015, 10, 5,
               taper=lambda t: 1.15 - 0.35 * t), Swatch('carbon'))
    P.add(cyl(end + V(s * 0.0, 0, 0), end + V(s * 0.012, 0, 0), 0.006, 10), ALLOY)

# =====================================================================================================
# Rider body (skinned)
# =====================================================================================================
SKIN = Swatch('skin')
TORSO_P = Cyl('torso', V(0, -0.255, 0.955), V(0, 0.285, 1.405), V(0, 0, 1))
ARM_P = {s: Cyl('arm', J['SH' + s], J['ELB' + s], V(0, 0, 1)) for s in SIDES}
THIGH_P = {s: Cyl('thigh', J['HIP' + s], J['KNEE' + s], V(0, 1, 0)) for s in SIDES}
SHIN_P = {s: Cyl('shin', J['KNEE' + s], J['ANKLE' + s], V(0, 1, 0)) for s in SIDES}


def nearest_seg(c, names):
    best = None; bd = 1e9
    for n in names:
        d, _ = seg_dist(c, *SEG[n]); d -= RAD[n]
        if d < bd: bd, best = d, n
    return best


TRUNK_BONES = ['pelvis', 'chest', 'head', 'upperArmL', 'forearmL', 'handL', 'upperArmR', 'forearmR', 'handR']


def classify_trunk(c):
    b = nearest_seg(c, [x for x in TRUNK_BONES if not x.startswith('hand')])
    if b in ('pelvis', 'chest'): return TORSO_P
    if b.startswith('upperArm'): return ARM_P[b[-1]]
    return SKIN


E = []
# pelvis, glutes, bib shorts
E += [('ball', (0.058, -0.205, 1.02), 0.083), ('ball', (-0.058, -0.205, 1.02), 0.083),
      ('cap', ((-0.075, -0.165, 1.035), (0.075, -0.165, 1.035)), 0.078)]
# abdomen and ribcage (two columns so the trunk is wider than it is deep)
for x in (-0.048, 0.048):
    E += [('cap', ((x, -0.155, 1.085), (x * 1.05, 0.03, 1.21)), 0.093),
          ('cap', ((x * 1.05, 0.0, 1.2), (x * 1.1, 0.185, 1.312)), 0.103)]
E += [('ball', (0.098, 0.09, 1.282), 0.07), ('ball', (-0.098, 0.09, 1.282), 0.07),      # lats
      ('cap', ((0, -0.06, 1.2), (0, 0.13, 1.33)), 0.07)]                                  # spine/back line
for s in (-1, 1):
    sh = J['SH' + ('R' if s > 0 else 'L')]; el = J['ELB' + ('R' if s > 0 else 'L')]; wr = J['WR' + ('R' if s > 0 else 'L')]
    E += [('ball', tuple(sh), 0.058),
          ('cap', ((s * 0.07, 0.22, 1.372), (s * 0.15, 0.235, 1.355)), 0.043),               # trapezius
          ('cap', (tuple(sh), tuple(sh.lerp(el, 0.55))), 0.05),
          ('cap', (tuple(sh.lerp(el, 0.5)), tuple(el)), 0.041),
          ('ball', tuple(el), 0.038),
          ('cap', (tuple(el), tuple(el.lerp(wr, 0.45))), 0.038),
          ('cap', (tuple(el.lerp(wr, 0.4)), tuple(wr)), 0.029)]
E += [('cap', ((0, 0.235, 1.36), (0, 0.34, 1.43)), 0.05)]                                    # neck
P = Piece('trunk', cands=TRUNK_BONES, ao='body', classify=classify_trunk, smooth_weights=3)
P.add(meta(E, 0.0085, ratio=0.42), SKIN)

# head (rigid): skull, jaw, cheeks, nose, ears
HEAD_P = Sph('head', HEADC)
P = Piece('head', bone='head', ao='body')
P.add(meta([('ball', (0, 0.405, 1.505), 0.09), ('ball', (0, 0.37, 1.49), 0.082),
            ('cap', ((0, 0.44, 1.44), (0, 0.475, 1.452)), 0.052), ('ball', (0.044, 0.462, 1.462), 0.04),
            ('ball', (-0.044, 0.462, 1.462), 0.04), ('ball', (0, 0.48, 1.418), 0.03),
            ('cap', ((0, 0.497, 1.483), (0, 0.513, 1.463)), 0.013),
            ('ball', (0.088, 0.402, 1.476), 0.021), ('ball', (-0.088, 0.402, 1.476), 0.021)], 0.006, ratio=0.3), HEAD_P)

# helmet: shell with vents (solidified), straps, rear retention dial
P = Piece('helmet', bone='head', ao='body')
HELM_C = V(0, 0.4, 1.525)
bm = new_bm(); bmesh.ops.create_uvsphere(bm, u_segments=44, v_segments=22, radius=1.0)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.2], context='VERTS')
for v in bm.verts:
    v.co.x *= 0.118; v.co.y *= 0.156; v.co.z *= 0.112
    v.co.y -= 0.03 * max(0, -v.co.y / 0.156) ** 2          # tail
    v.co.z -= 0.012 * max(0, v.co.y / 0.156)                # front dips toward the brow
vent = []
for f in bm.faces:
    c = f.calc_center_median(); az = math.atan2(c.x, -c.y); el = math.atan2(c.z, math.hypot(c.x, c.y))
    lane = abs(az) / 0.32
    if 0.25 < el < 1.15 and abs(lane - round(lane)) < 0.17 and round(lane) <= 3 and (int(el / 0.2) % 2 == 0):
        vent.append(f)
bmesh.ops.delete(bm, geom=vent, context='FACES')
bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(14), 3, 'X'), verts=bm.verts)
bmesh.ops.translate(bm, vec=HELM_C, verts=bm.verts)
outer = set(bm.faces)
res = bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.011)
inner_faces = [f for f in bm.faces if f not in outer]
helm_in = new_bm(); hv = {}
for f in inner_faces:
    vs = []
    for v in f.verts:
        if v not in hv: hv[v] = helm_in.verts.new(v.co)
        vs.append(hv[v])
    try: helm_in.faces.new(vs)
    except ValueError: pass
bmesh.ops.delete(bm, geom=inner_faces, context='FACES')
P.add(bm, Sph('helmet', HELM_C, math.radians(118)))
P.add(helm_in, Swatch('helmetInner'))
P.add(box(V(0, 0.255, 1.47), (0.05, 0.02, 0.018), bevel=0.006), Swatch('strap'))
for s in (-1, 1):
    P.add(tube([V(s * 0.1, 0.36, 1.47), V(s * 0.093, 0.43, 1.40), V(s * 0.04, 0.475, 1.385)], 0.0025, 0.007, 6, 6, lateral=V(0, 1, 0)), Swatch('strap'))
    P.add(tube([V(s * 0.1, 0.47, 1.49), V(s * 0.09, 0.44, 1.42)], 0.0025, 0.006, 6, 4, lateral=V(0, 1, 0)), Swatch('strap'))
# glasses: wrap lens + arms
lens = tube([(-0.09, 0.455, 1.488), (-0.05, 0.508, 1.49), (0, 0.522, 1.494), (0.05, 0.508, 1.49), (0.09, 0.455, 1.488)],
            0.022, 0.003, 8, 8, lateral=V(0, 0, 1))
P.add(lens, Swatch('lens'))
for s in (-1, 1):
    P.add(tube([V(s * 0.09, 0.455, 1.495), V(s * 0.098, 0.39, 1.49)], 0.004, 0.0025, 6, 3), BLACK)

# legs (one blob each, skinned to pelvis/thigh/shin/foot)
for side, s in SIDES.items():
    hip, knee, ank = J['HIP' + side], J['KNEE' + side], J['ANKLE' + side]
    fwd_t = (knee - hip).normalized(); kneefront = V(0, 1, 0) - fwd_t * fwd_t.y; kneefront.normalize()
    shin_d = (ank - knee).normalized(); calfback = -(V(0, 1, 0) - shin_d * shin_d.y).normalized()
    E = [('ball', tuple(hip + V(0, -0.01, 0)), 0.076),
         ('cap', (tuple(hip), tuple(hip.lerp(knee, 0.55))), 0.07),
         ('ball', tuple(hip.lerp(knee, 0.42) + kneefront * 0.018), 0.064),                 # quads
         ('cap', (tuple(hip.lerp(knee, 0.5)), tuple(hip.lerp(knee, 0.9))), 0.056),
         ('ball', tuple(knee), 0.047), ('ball', tuple(knee + kneefront * 0.026), 0.028),   # knee, kneecap
         ('cap', (tuple(knee), tuple(knee.lerp(ank, 0.4))), 0.041),
         ('ball', tuple(knee.lerp(ank, 0.3) + calfback * 0.022), 0.047),                    # calf
         ('cap', (tuple(knee.lerp(ank, 0.35)), tuple(knee.lerp(ank, 0.8))), 0.033),
         ('cap', (tuple(knee.lerp(ank, 0.75)), tuple(ank)), 0.028), ('ball', tuple(ank), 0.03)]
    THP, SHP = THIGH_P[side], SHIN_P[side]
    P = Piece('leg' + side, cands=['pelvis', 'thigh' + side, 'shin' + side, 'foot' + side], ao='body', smooth_weights=3,
              classify=lambda c, side=side, THP=THP, SHP=SHP: THP if nearest_seg(c, ['thigh' + side, 'shin' + side]) == 'thigh' + side else SHP)
    P.add(meta(E, 0.0085, ratio=0.42), SKIN)

# hands (rigid): gloved hand wrapped over the hood
for side, s in SIDES.items():
    g, w = J['G' + side], J['WR' + side]
    E = [('cap', (tuple(w + V(0, 0.005, 0.0)), tuple(g + V(-s * 0.002, -0.012, 0.016))), 0.03),          # palm
         ('cap', (tuple(w + V(s * 0.012, 0.0, -0.004)), tuple(g + V(s * 0.016, -0.02, 0.008))), 0.022),
         ('cap', (tuple(g + V(0, -0.015, 0.02)), tuple(g + V(0, 0.026, 0.02))), 0.021),                  # knuckles to fingers
         ('cap', (tuple(g + V(0, 0.026, 0.018)), tuple(g + V(0, 0.046, -0.01))), 0.017),
         ('cap', (tuple(g + V(s * 0.004, 0.046, -0.012)), tuple(g + V(s * 0.006, 0.05, -0.05))), 0.012),   # fingers on the lever
         ('cap', (tuple(g + V(-s * 0.02, -0.025, 0.004)), tuple(g + V(-s * 0.026, 0.02, -0.006))), 0.011)]  # thumb inside
    P = Piece('hand' + side, bone='hand' + side, ao='body')
    P.add(meta(E, 0.0045, ratio=0.45), Cyl('glove', w, g + V(0, 0.03, 0), V(0, 0, 1)))

# shoes + pedals (rigid, foot bone). Built in the foot's own frame, then posed to the rest ankle.
for side, s in SIDES.items():
    a = REST_CRANK + (0 if side == 'R' else math.pi)
    Rf = rot_x(ankle_pitch(a)); ank = J['ANKLE' + side]; ped = J['PEDAL' + side]
    M = Matrix.Translation(ank) @ Rf.to_4x4()
    Minv = Rf.transposed()
    P = Piece('foot' + side, bone='foot' + side, ao='body')
    shoeP = Side('shoe', -0.075, 0.17, -0.115, 0.03, frame=(ank, Minv))
    # local frame: ankle at origin, sole at z ~ -0.1, toe at y ~ +0.16
    cleat = Minv @ (ped - ank)
    sole_z = cleat.z + 0.022
    E = [('ball', (0, -0.035, -0.035), 0.044), ('cap', ((0, -0.03, -0.05), (0, 0.11, sole_z + 0.03)), 0.04),
         ('cap', ((0, 0.08, sole_z + 0.028), (0, 0.15, sole_z + 0.018)), 0.034), ('ball', (0, 0.02, -0.01), 0.038)]
    bm = meta(E, 0.005, ratio=0.3)
    for v in bm.verts:
        v.co.x *= 0.82
        if v.co.z < sole_z + 0.006: v.co.z = sole_z + 0.006
    P.add(xform(bm, M), shoeP)
    P.add(xform(box(V(0, 0.045, sole_z + 0.002), (0.074, 0.245, 0.01), bevel=0.004, segs=2,
                    shape=lambda v: setattr(v.co, 'x', v.co.x * (0.75 if v.co.y < -0.02 else 1.0))), M), Swatch('sole'))
    P.add(xform(cyl(V(s * 0.04, 0.0, -0.015), V(s * 0.05, 0.0, -0.015), 0.012, 12), M), BLACK)       # BOA dial
    P.add(xform(box(cleat + V(0, 0, 0.0145), (0.05, 0.065, 0.006), bevel=0.003), M), Swatch('cleat'))
    # pedal body under the cleat, spindle back to the crank arm
    P.add(xform(box(cleat + V(0, 0.003, 0.002), (0.062, 0.078, 0.017), bevel=0.005, segs=2), M), BLACK)
    P.add(xform(cyl(cleat + V(-s * 0.02, 0, 0), cleat + V(-s * 0.037, 0, 0), 0.0065, 10), M), ALLOY)


# =====================================================================================================
# Painters
# =====================================================================================================
FONT_PATHS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
              '/Library/Fonts/Arial Bold.ttf']


def font(px):
    for p in FONT_PATHS:
        if os.path.exists(p): return ImageFont.truetype(p, px)
    return ImageFont.load_default()


def mix(a, b, m):
    m = np.clip(m, 0, 1)[..., None]; return a * (1 - m) + b * m


def band(x, lo, hi, soft=0.004):
    return np.clip((x - lo) / soft + 0.5, 0, 1) * np.clip((hi - x) / soft + 0.5, 0, 1)


def fill(shape, hexc): return np.broadcast_to(hexrgb(hexc), shape + (3,)).copy()


def noise(shape, amp, seed):
    rng = np.random.default_rng(seed); return 1 + (rng.random(shape) - 0.5) * amp


def paint_torso(U, Vv, k):
    t = 1 - Vv; u = U % 1
    c = fill(U.shape, k['main'])
    if k['checks']:   # pacer: big yellow/black checks above the pockets
        q = (np.floor(u * 16) + np.floor(t * 10)) % 2
        c = mix(c, hexrgb(k['checks']), (q > 0.5) * (t > 0.44) * (t < 0.92))
    side = np.minimum(np.abs(u - 0.25), np.abs(u - 0.75))
    c = mix(c, hexrgb(k['panel']), band(side, -1, 0.065, 0.006) * (t > 0.27))           # side panels
    c = mix(c, hexrgb(k['accent']), band(side, 0.065, 0.072, 0.003) * (t > 0.3) * (t < 0.9))
    pocket = band(u, 0.355, 0.645, 0.004) * band(t, 0.285, 0.43, 0.004)
    c = mix(c, c * 0.82, pocket)                                                          # pockets, a shade darker
    for e in (0.355, 0.452, 0.548, 0.645):
        c = mix(c, c * 0.55, band(u, e - 0.002, e + 0.002, 0.002) * band(t, 0.285, 0.43, 0.004))
    c = mix(c, c * 0.6, band(t, 0.427, 0.433, 0.003) * band(u, 0.355, 0.645, 0.004))
    c = mix(c, hexrgb(k['panel']), band(t, 0.27, 0.29, 0.004))                             # gripper hem
    c = mix(c, hexrgb(k['shorts']), t < 0.27)                                             # bib shorts
    c = mix(c, hexrgb('#2a2d33'), band(u, -1, 0.004, 0.002) + band(u, 0.996, 2, 0.002))   # zip
    c = mix(c, hexrgb(k['panel']), band(t, 0.94, 2, 0.006))                               # collar
    c = mix(c, hexrgb(k['accent']), band(t, 0.928, 0.94, 0.003))
    return c * noise(U.shape, 0.035, 1)[..., None]


def text_torso(img, t, k):
    draw_text(img, t, 'BIKEFREE', 0.5, 1 - 0.6, 0.085, k['accent'] if not k['checks'] else '#16181c', box_col=None if not k['checks'] else '#ffd21f')
    draw_text(img, t, 'bikefree', 0.88, 1 - 0.78, 0.05, k['accent'] if not k['checks'] else '#16181c')


def paint_arm(U, Vv, k):
    t = 1 - Vv   # 0 at the shoulder, 1 at the elbow
    c = fill(U.shape, k['main'])
    if k['checks']:
        q = (np.floor((U % 1) * 6) + np.floor(t * 5)) % 2
        c = mix(c, hexrgb(k['checks']), q > 0.5)
    c = mix(c, hexrgb(k['panel']), band(t, 0.4, 0.5, 0.006))
    c = mix(c, hexrgb(k['accent']), band(t, 0.385, 0.4, 0.004))
    c = mix(c, hexrgb(SWATCH['skin']) * 1.0, t > 0.5)
    return c * noise(U.shape, 0.03, 2)[..., None]


def paint_thigh(U, Vv, k):
    t = 1 - Vv; u = U % 1
    c = fill(U.shape, k['shorts'])
    side = np.minimum(np.abs(u - 0.25), np.abs(u - 0.75))
    c = mix(c, hexrgb(k['main']), band(side, -1, 0.012, 0.004) * (t < 0.6))
    c = mix(c, hexrgb('#2b2e34'), band(t, 0.6, 0.665, 0.004))
    c = mix(c, hexrgb(k['main']), band(t, 0.62, 0.635, 0.003))
    c = mix(c, hexrgb(SWATCH['skin']), t > 0.665)
    return c * noise(U.shape, 0.03, 3)[..., None]


def paint_shin(U, Vv, k):
    t = 1 - Vv
    c = fill(U.shape, SWATCH['skin'])
    sock = '#f2f2f2' if not k['checks'] else '#16181c'
    c = mix(c, hexrgb(sock), t > 0.66)
    c = mix(c, hexrgb(k['main']), band(t, 0.7, 0.735, 0.004))
    c = mix(c, hexrgb(k['panel'] if not k['checks'] else '#ffd21f'), band(t, 0.735, 0.75, 0.003))
    return c * noise(U.shape, 0.025, 4)[..., None]


def paint_head(U, Vv, k):
    u = U % 1
    c = fill(U.shape, SWATCH['skin'])
    hair = band(np.abs(u - 0.5), -1, 0.27, 0.03) * band(Vv, 0.3, 0.62, 0.03)
    return mix(c, hexrgb('#3b2a20'), hair) * noise(U.shape, 0.04, 5)[..., None]


def paint_helmet(U, Vv, k):
    u = U % 1; ang = (u - 0.5) * 2 * math.pi; el = Vv * math.radians(118)
    x = np.sin(el) * np.sin(ang)          # sideways component of the surface direction
    c = fill(U.shape, k['helmet'])
    c = mix(c, hexrgb(k['helmetAccent']), band(np.abs(x), -1, 0.05, 0.01) * (Vv < 0.75))
    c = mix(c, hexrgb('#2a2c31'), band(Vv, 0.86, 2, 0.01))
    c = mix(c, hexrgb(k['helmetAccent']), band(Vv, 0.8, 0.86, 0.008) * band(np.abs(u - 0.5), -1, 0.32, 0.01))
    return c


def paint_glove(U, Vv, k):
    u = U % 1
    c = fill(U.shape, SWATCH['glove'])
    return mix(c, hexrgb(k['main']), band(np.abs(u - 0.5), -1, 0.12, 0.02) * band(Vv, 0.3, 0.7, 0.03))


def paint_frame(Y, Z, side, k):
    c = fill(Y.shape, k['frame']) * noise(Y.shape, 0.02, 6)[..., None]
    # accent fade low on the seat tube and fork tips
    fork = np.clip((0.62 - Z) / 0.2, 0, 1) * (Y > 0.5)
    c = mix(c, hexrgb(k['frameAccent']), fork * 0.9)
    stb = band(Z, 0.48, 0.6, 0.01) * band(Y, -0.12, -0.02, 0.01)
    c = mix(c, hexrgb(k['frameAccent']), stb)
    return c


def frame_decals(img, t, side, k):
    """Down-tube logo along the tube; head-tube badge; seat-tube pinstripe text. In world (Y, Z)."""
    a, b = BB + V(0, 0, 0.015), HB
    if side == 'R':
        p0, p1 = a.lerp(b, 0.22), a.lerp(b, 0.8)
    else:
        p0, p1 = a.lerp(b, 0.8), a.lerp(b, 0.22)
    draw_text_line(img, t, 'bikefree', p0, p1, 0.034, '#ffffff' if not k['checks'] else '#ffd21f', side)
    draw_disc(img, t, V(0, 0.493, 0.8), 0.016, k['frameAccent'], side)


def paint_rim(U, Vv, k):
    c = fill(U.shape, '#1b1d21') * noise(U.shape, 0.03, 7)[..., None]
    c = mix(c, hexrgb('#5b5f66'), band(Vv, 0.9, 2, 0.02))       # braking-free bead edge, slightly lighter
    return c


def rim_decals(img, t, k):
    for u0 in (0.12, 0.62):
        draw_text(img, t, 'BIKEFREE 50', u0 + 0.12, 0.5, 0.55, '#ffffff' if not k['checks'] else '#ffd21f', wide=True)


def paint_rotor(U, Vv, k):
    u = U % 1
    c = fill(U.shape, '#b4b8bf')
    holes = (np.abs(((u * 48) % 1) - 0.5) < 0.18) * (np.abs(((Vv * 3 + np.floor(u * 48) * 0.5) % 1) - 0.5) < 0.2) * (Vv > 0.15) * (Vv < 0.85)
    return mix(c, hexrgb('#202226'), holes)


def paint_tape(U, Vv, k):
    s = (U * 160 + Vv * 1.0) % 1
    c = fill(U.shape, '#1b1c1f')
    return mix(c, hexrgb('#2a2c31'), band(s, 0.0, 0.08, 0.02))


def paint_chain(U, Vv, k):
    s = (U * 110) % 1
    c = fill(U.shape, '#5d6168')
    c = mix(c, hexrgb('#9aa0a8'), band(s, 0.1, 0.45, 0.04))
    return c


def paint_shoe(Y, Z, side, k):
    c = fill(Y.shape, k['shoe'])
    c = mix(c, hexrgb(k['main'] if not k['checks'] else '#ffd21f'), band(Z + 0.18 * (Y - 0.02), -0.07, -0.058, 0.004) * (Y > -0.03))
    c = mix(c, hexrgb(k['panel']), band(Y, -1, -0.045, 0.006))     # heel cup
    return c


def paint_bottle(U, Vv, k):
    t = 1 - Vv
    c = fill(U.shape, '#f0f0ee')
    c = mix(c, hexrgb(k['main']), band(t, 0.35, 0.65, 0.01))
    return c


def bottle_decals(img, t, k):
    draw_text(img, t, 'bikefree', 0.5, 0.5, 0.18, '#ffffff' if not k['checks'] else '#16181c')


def paint_screen(U, Vv, k):
    c = fill(U.shape, '#1d2a2a')
    return mix(c, hexrgb('#a9c4b8'), band(Vv, 0.06, 0.94, 0.02) * band(U, 0.06, 0.94, 0.02) * 0.25)


def screen_decals(img, t, k):
    draw_text(img, t, '32.4', 0.5, 0.32, 0.26, '#d9f2e6')
    draw_text(img, t, '245 W', 0.5, 0.7, 0.18, '#d9f2e6')


PAINT = {'torso': paint_torso, 'arm': paint_arm, 'thigh': paint_thigh, 'shin': paint_shin, 'head': paint_head,
         'helmet': paint_helmet, 'glove': paint_glove, 'rim': paint_rim, 'rotor': paint_rotor, 'tape': paint_tape,
         'chain': paint_chain, 'bottle': paint_bottle, 'screen': paint_screen}
SIDE_PAINT = {'frame': (paint_frame, FRAME_P), 'shoe': (paint_shoe, Side('shoe', -0.075, 0.17, -0.115, 0.03))}
DECALS = {'torso': text_torso, 'rim': rim_decals, 'bottle': bottle_decals, 'screen': screen_decals}


def draw_text(img, t, s, u, v, h, col, box_col=None, wide=False):
    """Text centred at tile-domain (u, v); h = cap height as a share of the tile height."""
    px_h = max(6, int(h * t.h / (1 + 2 * t.mv)))
    f = font(px_h)
    bbox = f.getbbox(s); tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    layer = Image.new('RGBA', (tw + 8, th + 8), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((4 - bbox[0], 4 - bbox[1]), s, font=f, fill=col)
    if wide: layer = layer.resize((int(layer.width * 1.6), layer.height))
    x, y = t.px(u, v)
    img.alpha_composite(layer, (int(x - layer.width / 2), int(y - layer.height / 2)))


def draw_text_line(img, t, s, p0, p1, h_m, col, side):
    """Text along a world segment on a side tile (Y, Z metres), h_m tall."""
    proj = FRAME_P
    def to_px(p):
        u = (p.y - proj.y0) / (proj.y1 - proj.y0); u = u if side == 'R' else 1 - u
        return t.px(u, (proj.z1 - p.z) / (proj.z1 - proj.z0))
    a, b = to_px(p0), to_px(p1)
    L = math.hypot(b[0] - a[0], b[1] - a[1]); ang = math.degrees(math.atan2(-(b[1] - a[1]), b[0] - a[0]))
    px_h = int(h_m / (proj.z1 - proj.z0) * t.h / (1 + 2 * t.mv))
    f = font(px_h); bbox = f.getbbox(s)
    layer = Image.new('RGBA', (bbox[2] - bbox[0] + 8, bbox[3] - bbox[1] + 8), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((4 - bbox[0], 4 - bbox[1]), s, font=f, fill=col)
    layer = layer.resize((int(L), layer.height)).rotate(ang, expand=True, resample=Image.BICUBIC)
    cx, cy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    img.alpha_composite(layer, (int(cx - layer.width / 2), int(cy - layer.height / 2)))


def draw_disc(img, t, p, r, col, side):
    proj = FRAME_P
    u = (p.y - proj.y0) / (proj.y1 - proj.y0); u = u if side == 'R' else 1 - u
    x, y = t.px(u, (proj.z1 - p.z) / (proj.z1 - proj.z0))
    rp = r / (proj.z1 - proj.z0) * t.h
    ImageDraw.Draw(img).ellipse((x - rp, y - rp, x + rp, y + rp), fill=col)


def pack_tiles():
    """Skyline bottom-left packing into a 2048-wide atlas; the height is rounded up to 128 px."""
    global ATLAS_H
    GAP = 4
    sky = [(0, ATLAS, 0)]   # (x, width, y)
    for t in sorted(TILES.values(), key=lambda t: (-t.h, -t.w)):
        w = t.w + GAP; best = None
        for i, (x, _, _) in enumerate(sky):
            if x + w > ATLAS + GAP: break
            y = 0; span = 0; j = i
            while span < w and j < len(sky):
                y = max(y, sky[j][2]); span += sky[j][1]; j += 1
            if best is None or y < best[1] or (y == best[1] and x < best[0]): best = (x, y)
        t.x, t.y = best
        top = best[1] + t.h + GAP
        new = []
        for x, sw, y in sky:   # cut [best.x, best.x + w) out of the skyline
            x1 = x + sw
            if x1 <= best[0] or x >= best[0] + w: new.append((x, sw, y)); continue
            if x < best[0]: new.append((x, best[0] - x, y))
            if x1 > best[0] + w: new.append((best[0] + w, x1 - best[0] - w, y))
        new.append((best[0], w, top)); sky = sorted(new)
    ATLAS_H = int(math.ceil(max(t.y + t.h for t in TILES.values()) / 128) * 128)
    assert ATLAS_H <= 4096, 'atlas overflow'


def paint_atlas(kit):
    k = KIT[kit]
    atlas = Image.new('RGBA', (ATLAS, ATLAS_H), (128, 128, 128, 255))
    for t in TILES.values():
        I, Jj = np.meshgrid(np.arange(t.w) + 0.5, np.arange(t.h) + 0.5)
        U = -t.mu + I / t.w * (1 + 2 * t.mu); Vv = -t.mv + Jj / t.h * (1 + 2 * t.mv)
        if t.name == 'swatches':
            img = np.zeros((t.h, t.w, 3))
            for i, n in enumerate(swatch_names):
                col = hexrgb(SWATCH[n])
                if n == 'gloveAccent': col = hexrgb(k['main'])
                img[(i // SW_N) * SW_PX:(i // SW_N + 1) * SW_PX, (i % SW_N) * SW_PX:(i % SW_N + 1) * SW_PX] = col
        elif t.base in SIDE_PAINT:
            fn, proj = SIDE_PAINT[t.base]; side = t.name[-1]
            Uw = U if side == 'R' else 1 - U
            Y = proj.y0 + Uw * (proj.y1 - proj.y0); Z = proj.z1 - Vv * (proj.z1 - proj.z0)
            img = fn(Y, Z, side, k)
        else:
            img = PAINT[t.base](U, Vv, k)
        tile_img = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).convert('RGBA')
        if t.base in DECALS: DECALS[t.base](tile_img, t, k)
        if t.base == 'frame': frame_decals(tile_img, t, t.name[-1], k)
        atlas.paste(tile_img, (t.x, t.y))
    return atlas.convert('RGB')


# =====================================================================================================
# Export
# =====================================================================================================
def to3(v): return (-v.x, v.z, v.y)


def corner_normals(bm, f, cos_lim=math.cos(math.radians(42))):
    out = []
    for l in f.loops:
        if not f.smooth:
            out.append(f.normal.copy()); continue
        n = Vector((0, 0, 0))
        for f2 in l.vert.link_faces:
            if f2.normal.dot(f.normal) >= cos_lim: n += f2.normal * max(f2.calc_area(), 1e-9)
        out.append(n.normalized() if n.length > 0 else f.normal.copy())
    return out


def bone_weights(piece, co):
    """Blend between the nearest bone and its neighbours by distance (minus each bone's nominal radius)."""
    cands = piece.cands
    if co.x > 0.03: cands = [b for b in cands if not b.endswith('L') or b in ('pelvis', 'chest', 'head')]
    if co.x < -0.03: cands = [b for b in cands if not b.endswith('R') or b in ('pelvis', 'chest', 'head')]
    e = {}
    for b in cands:
        d, _ = seg_dist(co, *SEG[b]); e[b] = d - RAD[b]
    p = min(e, key=e.get)
    w = {p: 1.0}
    for b in NEIGH[p]:
        if b in e: w[b] = math.exp(-((e[b] - e[p]) / 0.028) ** 2)
    return w


AO_DIRS = []
for i in range(20):   # cosine-weighted hemisphere, fixed
    r1 = (i + 0.5) / 20; r2 = (i * 0.618034) % 1
    rr = math.sqrt(r1); th = 2 * math.pi * r2
    AO_DIRS.append(Vector((rr * math.cos(th), rr * math.sin(th), math.sqrt(max(0, 1 - r1)))))


def build_ao():
    groups = {}
    for p in PIECES: groups.setdefault(p.ao, []).append(p)
    trees = {}
    for g, ps in groups.items():
        bm = new_bm()
        for p in ps:
            vm = {v: bm.verts.new(v.co) for v in p.bm.verts}
            for f in p.bm.faces:
                try: bm.faces.new([vm[v] for v in f.verts])
                except ValueError: pass
        trees[g] = BVHTree.FromBMesh(bm); bm.free()
    return trees


def ao_at(tree, co, n, maxd):
    t = n.orthogonal().normalized(); b = n.cross(t); occ = 0.0
    o = co + n * 0.0015
    for d in AO_DIRS:
        w = t * d.x + b * d.y + n * d.z
        hit = tree.ray_cast(o, w, maxd)
        if hit[0] is not None: occ += 1 - (hit[3] / maxd) ** 2
    return 1 - 0.8 * occ / len(AO_DIRS)


def export():
    pack_tiles()
    trees = build_ao()
    pos, nrm, uvs, sk, sw, shade, idx = [], [], [], [], [], [], []
    tri_by = {}
    for P in PIECES:
        bm = P.bm
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.normal_update(); bm.verts.ensure_lookup_table()
        # weights per vertex
        if P.bone:
            W = {v.index: {P.bone: 1.0} for v in bm.verts}
        else:
            W = {v.index: bone_weights(P, v.co) for v in bm.verts}
            for _ in range(P.smooth_weights):
                W2 = {}
                for v in bm.verts:
                    acc = dict(W[v.index]); nb = [e.other_vert(v) for e in v.link_edges]
                    for u in nb:
                        for b, x in W[u.index].items(): acc[b] = acc.get(b, 0) + x
                    tot = sum(acc.values()); W2[v.index] = {b: x / tot for b, x in acc.items()}
                W = W2
        # AO per vertex (smooth normal)
        maxd = 0.07 if P.ao == 'body' else 0.05
        AO = {v.index: ao_at(trees[P.ao], v.co, v.normal, maxd) for v in bm.verts}
        vmap = {}
        start = len(idx)
        for f in bm.faces:
            proj = P.classify(f.calc_center_median()) if P.classify else P.projs[f[P.lproj]]
            cn = corner_normals(bm, f)
            # uv per corner
            if isinstance(proj, Swatch):
                tname = proj.name; cuv = [swatch_uv(proj.name)] * 3; spec = SPEC.get(proj.name, .3)
            else:
                if isinstance(proj, Stored):
                    raw = [(proj.base, l[P.luv].uv.x, l[P.luv].uv.y) for l in f.loops]
                elif isinstance(proj, Polar):
                    fc = f.calc_center_median(); raw = [proj.uv(l.vert.co, f.normal, fc) for l in f.loops]
                else:
                    raw = [proj.uv(l.vert.co, f.normal) for l in f.loops]
                tname = raw[0][0]; t = TILES[tname]
                us = [r[1] for r in raw]; vs = [min(1.0, max(0.0, r[2])) for r in raw]
                if t.wrap and max(us) - min(us) > 0.5:
                    us = [u + 1 if u < 0.5 else u for u in us]
                us = [min(1 + t.mu * 0.95, max(-t.mu * 0.95, u)) for u in us]
                cuv = [t.atlas_uv(u, v) for u, v in zip(us, vs)]
                spec = SPEC.get(t.base, .3)
            for l, n, uv in zip(f.loops, cn, cuv):
                v = l.vert
                key = (v.index, round(uv[0] * 65535), round(uv[1] * 65535), round(n.x * 60), round(n.y * 60), round(n.z * 60))
                if key not in vmap:
                    vmap[key] = len(pos) // 3
                    c = v.co; pos += [round(-c.x * 4000), round(c.z * 4000), round(c.y * 4000)]
                    nrm += [round(-n.x * 127), round(n.z * 127), round(n.y * 127)]
                    uvs += [round(uv[0] * 65535), round(uv[1] * 65535)]
                    w = sorted(W[v.index].items(), key=lambda kv: -kv[1])[:4]
                    tot = sum(x for _, x in w); q = [int(round(x / tot * 255)) for _, x in w]
                    q[0] += 255 - sum(q)
                    bi = [BI[b] for b, _ in w]
                    while len(bi) < 4: bi.append(0); q.append(0)
                    sk += bi; sw += q
                    shade += [int(round(max(0, min(1, AO[v.index])) * 255)), int(round(spec * 255))]
                idx.append(vmap[key])
        tri_by[P.name] = (len(idx) - start) // 3
    nv = len(pos) // 3
    big = nv > 65535
    mesh = {
        'verts': nv, 'tris': len(idx) // 3,
        'pos': base64.b64encode(struct.pack('<%dh' % len(pos), *pos)).decode(),
        'nrm': base64.b64encode(struct.pack('<%db' % len(nrm), *[max(-127, min(127, x)) for x in nrm])).decode(),
        'uv': base64.b64encode(struct.pack('<%dH' % len(uvs), *uvs)).decode(),
        'skin': base64.b64encode(bytes(sk)).decode(), 'weights': base64.b64encode(bytes(sw)).decode(),
        'shade': base64.b64encode(bytes(shade)).decode(),
        'idx32': big, 'idx': base64.b64encode(struct.pack('<%d%s' % (len(idx), 'I' if big else 'H'), *idx)).decode(),
    }
    t3 = lambda v: [round(x, 4) for x in to3(v)]
    rig = {
        'bones': [{'name': b, 'pivot': t3(PIVOT[b])} for b in BONES],
        'thigh': THIGH, 'shin': SHIN, 'upperArm': UPPER, 'forearm': FORE, 'crank': CR, 'pedalX': PEDX,
        'restCrank': REST_CRANK, 'wheelRadius': WHEEL_R, 'bb': t3(BB), 'frontHub': t3(FH), 'rearHub': t3(RH),
        'ankleFromPedal': t3(ANKLE_FROM_PEDAL), 'hc': t3(HC), 'lb': t3(LB), 'nb': t3(NB),
        'joints': {k: t3(v) for k, v in J.items()},
        'kneePole': [0, 0, 1], 'elbowPole': {s: t3(ELBOW_POLE[s]) for s in SIDES},
    }
    out = {'format': 'bikefree-model-2',
           'units': 'pos int16 x 0.25 mm, three.js axes (x = -blender x, y up, z forward); uv uint16 (image space, flipY false)',
           'mesh': mesh, 'rig': rig, 'atlas': {**{k: os.path.basename(v) for k, v in ATLAS_OUT.items()}, 'size': [ATLAS, ATLAS_H]}, 'parts': tri_by}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    for kit, path in ATLAS_OUT.items():
        paint_atlas(kit).quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).save(path, optimize=True)
    print('wrote', OUT, 'triangles', mesh['tris'], 'verts', nv, tri_by)


export()
