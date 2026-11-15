"""Build the bikefree rider + road bike in Blender and export models/rider.json.

Run headless:   blender --background --python tools/build_rider.py
or with the bpy module:   python tools/build_rider.py
or paste into Blender's Text Editor and press Run Script (it builds into a scene called "BikefreeRider").

Everything is built with bmesh/metaballs (no operators), as separate parts so the app can animate them:
  Frame, WheelFront, WheelRear (spin), Crank (spins), RiderBody (static),
  ThighL/R, ShinL/R, FootL/R (two-bone leg IK in the app).
Blender axes: X = rider's right, Y = forward, Z = up. Exported in three.js axes (x = −X, y = Z, z = Y).
"""
import bpy, bmesh, math, json, base64, struct, os, sys
from mathutils import Vector, Matrix

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'models', 'rider.json')

scn = bpy.data.scenes.get('BikefreeRider') or bpy.data.scenes.new('BikefreeRider')
COL = bpy.data.collections.get('BikefreeRider') or bpy.data.collections.new('BikefreeRider')
if COL.name not in [c.name for c in scn.collection.children]:
    scn.collection.children.link(COL)
if bpy.context.window:
    bpy.context.window.scene = scn
for o in list(COL.objects):
    bpy.data.objects.remove(o, do_unlink=True)


def V(*a): return Vector(a)


def srgb(h):
    h = h.lstrip('#'); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mat(name, hexcol, rough=0.55, metal=0.0):
    m = bpy.data.materials.get('bf_' + name) or bpy.data.materials.new('bf_' + name)
    m.diffuse_color = (*srgb(hexcol), 1)
    m.roughness = rough
    m.metallic = metal
    m['bf_hex'] = hexcol
    return m


def new_obj(name, mesh):
    old = bpy.data.objects.get(name)
    if old: bpy.data.objects.remove(old, do_unlink=True)
    o = bpy.data.objects.new(name, mesh)
    COL.objects.link(o)
    return o


class Part:
    """A mesh under construction: a bmesh plus a material list. No operators, no context."""
    def __init__(self):
        self.bm = bmesh.new(); self.mats = []

    def _mi(self, m):
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)

    def add_bm(self, bm, m):
        me = bpy.data.meshes.new('tmp'); bm.to_mesh(me); bm.free()
        self.add_mesh(me, [m]); bpy.data.meshes.remove(me)

    def add_mesh(self, me, mats):
        idx = [self._mi(m) for m in mats] or [0]
        vs = [self.bm.verts.new(v.co) for v in me.vertices]
        self.bm.verts.ensure_lookup_table()
        for p in me.polygons:
            try:
                f = self.bm.faces.new([vs[i] for i in p.vertices])
                f.material_index = idx[min(p.material_index, len(idx) - 1)]
                f.smooth = True
            except ValueError:
                pass

    def to_obj(self, name, pivot=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(m)
        pv = Vector(pivot)
        me.transform(Matrix.Translation(-pv))
        o = new_obj(name, me); o.location = pv
        return o


def cyl(P, a, b, r, m, segs=12, r2=None):
    a, b = Vector(a), Vector(b)
    bm = bmesh.new(); d = b - a
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=(r if r2 is None else r2), depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bmesh.ops.transform(bm, matrix=Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4(), verts=bm.verts)
    P.add_bm(bm, m)


def torus(P, center, R, r, m, maj=48, mino=10):
    bm = bmesh.new(); rings = []
    for i in range(maj):
        t = 2 * math.pi * i / maj; ring = []
        for j in range(mino):
            p = 2 * math.pi * j / mino; rad = R + r * math.cos(p)
            ring.append(bm.verts.new((center[0] + r * math.sin(p), center[1] + rad * math.cos(t), center[2] + rad * math.sin(t))))
        rings.append(ring)
    for i in range(maj):
        for j in range(mino):
            bm.faces.new((rings[i][j], rings[(i + 1) % maj][j], rings[(i + 1) % maj][(j + 1) % mino], rings[i][(j + 1) % mino]))
    P.add_bm(bm, m)


def box(P, center, size, m, bevel=0.0, segs=2, shape=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=segs, affect='EDGES', profile=0.5)
    if shape:
        for v in bm.verts: shape(v)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    P.add_bm(bm, m)


def path_tube(P, pts, r, m, segs=10, samples=24):
    """Smooth tube through points (Catmull-Rom)."""
    pts = [Vector(p) for p in pts]

    def cr(p0, p1, p2, p3, t):
        return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    path = []
    for i in range(1, len(ext) - 2):
        for k in range(samples):
            path.append(cr(ext[i - 1], ext[i], ext[i + 1], ext[i + 2], k / samples))
    path.append(pts[-1])
    bm = bmesh.new(); rings = []; prev_n = None
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        n = (prev_n - t * prev_n.dot(t)).normalized() if prev_n else t.orthogonal().normalized()
        prev_n = n; b = t.cross(n)
        rings.append([bm.verts.new(p + (n * math.cos(2 * math.pi * j / segs) + b * math.sin(2 * math.pi * j / segs)) * r) for j in range(segs)])
    for i in range(len(rings) - 1):
        for j in range(segs):
            bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % segs], rings[i][(j + 1) % segs]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    P.add_bm(bm, m)


def seg_dist(p, a, b):
    ab = b - a; t = max(0, min(1, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (a + ab * t - p).length


def meta_into(P, name, elems, res=0.014, thresh=0.6, scale=1.42):
    """Metaball blob → mesh, faces coloured by nearest element. elems: (kind, data, radius, material).
    `scale` compensates for metaballs coming out thinner than their radius."""
    mb = bpy.data.metaballs.new(name + '_mb')
    mb.resolution = res; mb.render_resolution = res; mb.threshold = thresh
    for kind, data, r, m in elems:
        if kind == 'ball':
            e = mb.elements.new(type='BALL'); e.co = Vector(data); e.radius = r * scale
        else:
            a, b = Vector(data[0]), Vector(data[1]); d = b - a
            e = mb.elements.new(type='CAPSULE'); e.co = (a + b) / 2; e.radius = r * scale
            e.size_x = d.length / 2
            e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = 2.0
    tmp = bpy.data.objects.new(name + 'Blob', mb); COL.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get(); dg.update()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True); bpy.data.metaballs.remove(mb)
    mats = []
    for _, _, _, m in elems:
        if m not in mats: mats.append(m)
    for poly in me.polygons:
        c = poly.center; best = None; bd = 1e9
        for kind, data, r, m in elems:
            d = ((c - Vector(data)).length if kind == 'ball' else seg_dist(c, Vector(data[0]), Vector(data[1]))) - r
            if d < bd: bd = d; best = m
        poly.material_index = mats.index(best)
    P.add_mesh(me, mats)
    bpy.data.meshes.remove(me)


# ---------------- Materials ----------------
frameM = mat('frame', '#1f2a44', 0.35, 0.3)
accentM = mat('accent', '#ff7a1a', 0.4)
blackM = mat('black', '#161616', 0.5)
greyM = mat('alloy', '#9aa0a6', 0.3, 0.8)
tapeM = mat('tape', '#222222', 0.8)
tyreM = mat('tyre', '#1c1c1c', 0.85)
rimM = mat('rim', '#2a2d33', 0.4, 0.2)
jersey = mat('jersey', '#ff7a1a', 0.6); jersey2 = mat('jersey_dark', '#1f2a44', 0.6)
shorts = mat('shorts', '#121417', 0.7); skin = mat('skin', '#d8a07e', 0.6)
glove = mat('glove', '#1a1a1a', 0.7); helmetM = mat('helmet', '#f4f4f4', 0.35)
lens = mat('lens', '#0d0f14', 0.1, 0.6)
sock = mat('sock', '#f2f2f2', 0.7); shoe = mat('shoe', '#f4f4f4', 0.35); sole = mat('sole', '#161616', 0.6)

# ---------------- Geometry constants ----------------
RH = V(0, -0.41, 0.335); FH = V(0, 0.575, 0.335); BB = V(0, 0.0, 0.27)
ST = V(0, -0.165, 0.84); HT = V(0, 0.47, 0.87); HB = V(0, 0.515, 0.72)
CR = 0.1725
THIGH, SHIN = 0.445, 0.435
HIP = {'L': V(-0.09, -0.165, 1.03), 'R': V(0.09, -0.165, 1.03)}

# ---------------- Frame ----------------
P = Part()
cyl(P, BB, ST, 0.017, frameM, 14)
cyl(P, ST + V(0, 0.01, 0), HT + V(0, -0.01, -0.02), 0.016, frameM, 14, 0.018)
cyl(P, BB, HB + V(0, -0.005, 0.02), 0.024, frameM, 14, 0.02)
cyl(P, HB + V(0, 0.01, -0.03), HT + V(0, -0.006, 0.03), 0.021, frameM, 14)
for x in (-0.055, 0.055):
    cyl(P, BB + V(x * 0.4, -0.02, 0), RH + V(x, 0.02, 0), 0.011, frameM, 10, 0.009)
    cyl(P, ST + V(x * 0.25, -0.02, -0.03), RH + V(x, 0.01, 0.02), 0.009, frameM, 10, 0.008)
    path_tube(P, [HB + V(x * 0.6, 0, 0), HB + V(x, 0.03, -0.2), FH + V(x, 0, 0)], 0.012, frameM, 10, 10)
cyl(P, BB + V(-0.04, 0, 0), BB + V(0.04, 0, 0), 0.023, frameM, 14)
cyl(P, ST, ST + V(0, -0.035, 0.12), 0.0135, blackM, 12)
cyl(P, BB + (ST - BB) * 0.55, BB + (ST - BB) * 0.62, 0.0178, accentM, 14)
cyl(P, BB + (HB - BB) * 0.35, BB + (HB - BB) * 0.6, 0.0245, accentM, 14, 0.0235)


def saddle_shape(v):
    t = (v.co.y + 0.135) / 0.27
    v.co.x *= 1.0 - 0.65 * max(0, t - 0.35) / 0.65
    v.co.z += -0.012 * max(0, t - 0.6)


box(P, V(0, -0.205, 0.975), (0.13, 0.27, 0.035), blackM, bevel=0.015, segs=3, shape=saddle_shape)
cyl(P, HT + V(0, 0, 0.035), V(0, 0.575, 0.905), 0.016, blackM, 12)
cyl(P, HT, HT + V(0, -0.005, 0.04), 0.019, blackM, 12)
path_tube(P, [(-0.21, 0.6, 0.905), (-0.1, 0.578, 0.905), (0, 0.575, 0.905), (0.1, 0.578, 0.905), (0.21, 0.6, 0.905)], 0.0125, tapeM, 10, 8)
for x in (-0.21, 0.21):
    s = 1 if x > 0 else -1
    path_tube(P, [(x, 0.6, 0.905), (x, 0.665, 0.9), (x + s * 0.005, 0.7, 0.86), (x + s * 0.01, 0.685, 0.8), (x + s * 0.01, 0.63, 0.785), (x + s * 0.01, 0.58, 0.79)], 0.0125, tapeM, 10, 8)
    box(P, (x, 0.665, 0.925), (0.03, 0.07, 0.045), blackM, bevel=0.012, segs=2)
    cyl(P, V(x, 0.69, 0.93), V(x + s * 0.003, 0.705, 0.83), 0.007, greyM, 8)
cyl(P, RH + V(0.02, 0, 0), RH + V(0.06, 0, 0), 0.05, greyM, 20)
box(P, RH + V(0.065, -0.02, -0.07), (0.015, 0.05, 0.07), blackM, bevel=0.006)
P.to_obj('Frame', (0, 0, 0))

# ---------------- Wheels ----------------
def wheel(name, hub):
    P = Part()
    torus(P, hub, 0.322, 0.0135, tyreM, 64, 10)
    torus(P, hub, 0.288, 0.024, rimM, 64, 8)
    torus(P, hub + V(0.0241, 0, 0), 0.292, 0.003, accentM, 64, 4)
    torus(P, hub + V(-0.0241, 0, 0), 0.292, 0.003, accentM, 64, 4)
    cyl(P, hub + V(-0.05, 0, 0), hub + V(0.05, 0, 0), 0.018, greyM, 12)
    for i in range(20):
        t = 2 * math.pi * i / 20; side = 0.035 if i % 2 else -0.035
        cyl(P, hub + V(side, 0, 0), hub + V(0, 0.27 * math.cos(t), 0.27 * math.sin(t)), 0.0016, greyM, 4)
    return P.to_obj(name, hub)


wheel('WheelRear', RH); wheel('WheelFront', FH)

# ---------------- Crank (right arm up in the rest pose) ----------------
P = Part()
cyl(P, BB + V(0.045, 0, 0), BB + V(0.052, 0, 0), 0.105, blackM, 40)
cyl(P, BB + V(0.052, 0, 0), BB + V(0.056, 0, 0), 0.07, greyM, 30)
cyl(P, BB + V(-0.075, 0, 0), BB + V(0.075, 0, 0), 0.01, greyM, 10)
cyl(P, BB + V(0.07, 0, 0), BB + V(0.075, 0, CR), 0.012, blackM, 8)
cyl(P, BB + V(-0.07, 0, 0), BB + V(-0.075, 0, -CR), 0.012, blackM, 8)
box(P, BB + V(0.105, 0, CR), (0.07, 0.085, 0.018), blackM, bevel=0.005)
box(P, BB + V(-0.105, 0, -CR), (0.07, 0.085, 0.018), blackM, bevel=0.005)
P.to_obj('Crank', BB)

# ---------------- Rider body (static) ----------------
E = []
E += [('ball', (0, -0.175, 1.045), 0.115, shorts), ('cap', ((-0.07, -0.17, 1.02), (0.07, -0.17, 1.02)), 0.085, shorts)]
E += [('cap', ((0, -0.13, 1.11), (0, 0.18, 1.32)), 0.118, jersey),
      ('cap', ((-0.105, 0.19, 1.315), (0.105, 0.19, 1.315)), 0.07, jersey),
      ('cap', ((0, 0.0, 1.24), (0, 0.15, 1.33)), 0.1, jersey),
      ('cap', ((-0.095, -0.1, 1.1), (-0.085, 0.06, 1.2)), 0.07, jersey2),
      ('cap', ((0.095, -0.1, 1.1), (0.085, 0.06, 1.2)), 0.07, jersey2)]
E += [('cap', ((0, 0.27, 1.365), (0, 0.335, 1.42)), 0.046, skin),
      ('ball', (0, 0.41, 1.49), 0.098, skin), ('ball', (0, 0.455, 1.445), 0.062, skin)]
for s in (-1, 1):
    sh = V(s * 0.16, 0.235, 1.33); el = V(s * 0.205, 0.445, 1.15); hand = V(s * 0.21, 0.66, 0.955)
    E += [('ball', tuple(sh), 0.06, jersey),
          ('cap', (tuple(sh), tuple(sh.lerp(el, 0.45))), 0.05, jersey),
          ('cap', (tuple(sh.lerp(el, 0.45)), tuple(el)), 0.042, skin),
          ('cap', (tuple(el), tuple(hand)), 0.036, skin),
          ('ball', tuple(hand), 0.042, glove)]
P = Part()
meta_into(P, 'RiderBody', E, res=0.011)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=1.0)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.12], context='VERTS')
for v in bm.verts:
    v.co.x *= 0.112; v.co.y *= 0.148; v.co.z *= 0.1
    v.co.y -= 0.025 * max(0, -v.co.y / 0.148)
bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.radians(16), 3, 'X'), verts=bm.verts)
bmesh.ops.translate(bm, vec=(0, 0.405, 1.53), verts=bm.verts)
P.add_bm(bm, helmetM)
path_tube(P, [(0, 0.53, 1.55), (0, 0.44, 1.627), (0, 0.33, 1.6), (0, 0.27, 1.545)], 0.01, accentM, 8, 8)
path_tube(P, [(-0.088, 0.46, 1.485), (-0.05, 0.505, 1.487), (0, 0.517, 1.49), (0.05, 0.505, 1.487), (0.088, 0.46, 1.485)], 0.014, lens, 8, 8)
P.to_obj('RiderBody', (0, 0, 0))

# ---------------- Legs (pivots at hip, knee, ankle; rest pose straight down) ----------------
for side, hip in HIP.items():
    P = Part()
    meta_into(P, 'Thigh' + side, [
        ('cap', ((0, 0.0, 0.0), (0, 0.006, -0.2)), 0.074, shorts),
        ('cap', ((0, 0.006, -0.18), (0, 0.01, -0.31)), 0.06, shorts),
        ('cap', ((0, 0.01, -0.31), (0, 0.006, -THIGH)), 0.048, skin),
        ('ball', (0, 0.014, -THIGH), 0.05, skin)], res=0.01)
    P.to_obj('Thigh' + side).location = hip
    P = Part()
    meta_into(P, 'Shin' + side, [
        ('ball', (0, 0.0, 0.0), 0.048, skin),
        ('cap', ((0, -0.022, -0.07), (0, -0.018, -0.22)), 0.052, skin),
        ('cap', ((0, 0.0, -0.02), (0, 0.0, -0.36)), 0.037, skin),
        ('cap', ((0, 0.0, -0.355), (0, 0.0, -SHIN + 0.01)), 0.035, sock)], res=0.01)
    P.to_obj('Shin' + side).location = hip + V(0, 0, -THIGH)
    P = Part()
    meta_into(P, 'Foot' + side, [
        ('ball', (0, -0.02, -0.035), 0.048, shoe),
        ('cap', ((0, -0.02, -0.045), (0, 0.15, -0.065)), 0.04, shoe),
        ('cap', ((0, -0.04, -0.085), (0, 0.17, -0.09)), 0.027, sole)], res=0.01)
    P.to_obj('Foot' + side).location = hip + V(0, 0, -THIGH - SHIN)

# ---------------- Export ----------------
palette = []; pal_idx = {}


def color_index(m):
    h = m.get('bf_hex', '#888888')
    if h not in pal_idx: pal_idx[h] = len(palette); palette.append(h)
    return pal_idx[h]


DECIMATE = {'RiderBody': 0.32, 'ThighL': 0.3, 'ThighR': 0.3, 'ShinL': 0.32, 'ShinR': 0.32, 'FootL': 0.35, 'FootR': 0.35}
out = {'format': 'bikefree-model-1', 'units': 'pos int16 x 0.25 mm, three.js axes (x = -blender x, y up, z forward)', 'parts': {}}
dg = bpy.context.evaluated_depsgraph_get()
total = 0
for o in list(COL.objects):
    mod = None
    if o.name in DECIMATE:
        mod = o.modifiers.new('dec', 'DECIMATE'); mod.ratio = DECIMATE[o.name]
    dg.update()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    if mod: o.modifiers.remove(mod)
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.normal_update()
    mats = list(me.materials)
    verts = {}; pos = []; nrm = []; col = []; idx = []
    for f in bm.faces:
        ci = color_index(mats[min(f.material_index, len(mats) - 1)])
        for l in f.loops:
            v = l.vert
            n = v.normal if f.smooth else f.normal
            key = (v.index, ci) if f.smooth else (v.index, ci, f.index)
            if key not in verts:
                verts[key] = len(col)
                c = v.co
                pos += [round(-c.x * 4000), round(c.z * 4000), round(c.y * 4000)]
                nrm += [round(-n.x * 127), round(n.z * 127), round(n.y * 127)]
                col.append(ci)
            idx.append(verts[key])
    total += len(idx) // 3
    bm.free(); bpy.data.meshes.remove(me)
    L = o.location
    out['parts'][o.name] = {
        'origin': [round(-L.x, 4), round(L.z, 4), round(L.y, 4)],
        'pos': base64.b64encode(struct.pack('<%dh' % len(pos), *pos)).decode(),
        'nrm': base64.b64encode(struct.pack('<%db' % len(nrm), *[max(-127, min(127, x)) for x in nrm])).decode(),
        'col': base64.b64encode(bytes(col)).decode(),
        'idx': base64.b64encode(struct.pack('<%dH' % len(idx), *idx)).decode(),
        'verts': len(col), 'tris': len(idx) // 3,
    }
out['palette'] = palette
out['rig'] = {'thigh': THIGH, 'shin': SHIN, 'crank': CR,
              'hipL': [0.09, 1.03, -0.165], 'hipR': [-0.09, 1.03, -0.165], 'bb': [0, 0.27, 0],
              'ankleFromPedal': [0, 0.075, -0.03], 'wheelRadius': 0.336}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'w') as f:
    json.dump(out, f, separators=(',', ':'))
print('wrote', OUT, 'triangles', total, {k: v['tris'] for k, v in out['parts'].items()})
