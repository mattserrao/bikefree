"""Build the reusable style-C coastal kit with Blender, without external assets.

    blender --background --python tools/build_coastal_assets.py

Models use metres, Y up, +Z along the road. The bridge deck is at Y=0.
The compact vertex-colour export keeps the web preview self-contained.
"""
import base64
import json
import math
import os
import random
import struct

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
random.seed(1101)
objects = []


def color(hexcode):
    return tuple(int(hexcode[i:i + 2], 16) for i in (1, 3, 5))


def part(bm, tint):
    mesh = bpy.data.meshes.new('coastal-part')
    bm.to_mesh(mesh)
    bm.free()
    objects.append((mesh, color(tint)))


def ellipsoid(pos, scale, tint, detail=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail + 1, radius=1)
    for v in bm.verts:
        v.co = Vector(tuple(pos[i] + v.co[i] * scale[i] for i in range(3)))
    part(bm, tint)


def branch(a, b, radius, tint, top=None, segments=7):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                         radius1=radius, radius2=top or radius * .67, depth=1)
    direction = Vector(b) - Vector(a)
    rot = Vector((0, 0, 1)).rotation_difference(direction)
    mid = (Vector(a) + Vector(b)) * .5
    for v in bm.verts:
        v.co.z *= direction.length
        v.co = rot @ v.co + mid
    part(bm, tint)


def box(center, size, tint):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co = Vector(tuple(center[i] + v.co[i] * size[i] for i in range(3)))
    part(bm, tint)


def beam(a, b, width, thickness, tint):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    delta = Vector(b) - Vector(a)
    rot = Vector((0, 0, 1)).rotation_difference(delta)
    mid = (Vector(a) + Vector(b)) * .5
    for v in bm.verts:
        v.co = rot @ Vector((v.co.x * width, v.co.y * thickness, v.co.z * delta.length)) + mid
    part(bm, tint)


def blade(base, angle, height, width, tint):
    bm = bmesh.new()
    dx, dz = math.cos(angle), math.sin(angle)
    a = bm.verts.new((base[0] - dz * width, base[1], base[2] + dx * width))
    b = bm.verts.new((base[0] + dz * width, base[1], base[2] - dx * width))
    c = bm.verts.new((base[0] + dx * height * .3, base[1] + height * .55, base[2] + dz * height * .3))
    d = bm.verts.new((base[0] + dx * height * .65, base[1] + height, base[2] + dz * height * .65))
    bm.faces.new((a, b, c)); bm.faces.new((a, c, d))
    # Cross the blades for volume without transparent foliage cards.
    e = bm.verts.new((base[0] + dx * width, base[1], base[2] + dz * width))
    f = bm.verts.new((base[0] - dx * width, base[1], base[2] - dz * width))
    bm.faces.new((e, f, d))
    part(bm, tint)


def packed(fmt, values):
    return base64.b64encode(struct.pack('<' + str(len(values)) + fmt, *values)).decode('ascii')


def export():
    positions, normals, colors = [], [], []
    for mesh, tint in objects:
        mesh.calc_loop_triangles()
        for triangle in mesh.loop_triangles:
            normal = triangle.normal
            for index in triangle.vertices:
                positions.extend(round(c * 100) for c in mesh.vertices[index].co)
                normals.extend(round(c * 127) for c in normal)
                colors.extend(tint)
        bpy.data.meshes.remove(mesh)
    objects.clear()
    return {'position': packed('h', positions), 'normal': packed('b', normals),
            'color': packed('B', colors), 'triangles': len(positions) // 9}


assets = {}
for variant in range(3):
    rng = random.Random(200 + variant)
    height = 7.5 + variant * 1.3
    crowns = []
    for k in range(8):
        angle = k * 2.399 + variant
        reach = 1.6 + rng.random() * 1.8
        tip = (math.cos(angle) * reach + .6, height * (.62 + .3 * rng.random()), math.sin(angle) * reach)
        crowns.append((tip, (1.6 + rng.random() * .7, .8 + rng.random() * .6, 1.5 + rng.random()), angle))
    for detailed in [False, True]:
        branch((0, 0, 0), (.6, height * .62, .15), .28, '#65503c')
        for k, (tip, scale, angle) in enumerate(crowns):
            branch((.4, height * .48, .1), tip, .12, '#796347')
            tint = ['#344f3e', '#496a46', '#69854c', '#81965b'][k % 4]
            ellipsoid(tip, scale, tint, int(detailed))
            if detailed:
                for j in range(3):
                    a = angle + j * 2.1
                    pos = (tip[0] + math.cos(a) * scale[0] * .7, tip[1] + .15 + j * .08, tip[2] + math.sin(a) * scale[2] * .7)
                    ellipsoid(pos, (scale[0] * .48, scale[1] * .6, scale[2] * .48), tint, 0)
        assets[f'cypress{variant}' + ('' if detailed else '-lod')] = export()

for variant in range(2):
    for detailed in [False, True]:
        branch((0, 0, 0), (.2, 11 + variant * 2, 0), .24, '#79583c')
        for level in range(6):
            y = 4.5 + level * 1.35
            radius = 3.1 - level * .37
            for k in range(3):
                a = k * 2.09 + level * 1.7 + variant
                tip = (math.cos(a) * radius * .7, y, math.sin(a) * radius * .7)
                branch((0, y - .4, 0), tip, .07, '#7c6449', segments=5)
                ellipsoid(tip, (radius * .7, .65, radius * .6), ['#355442', '#486c4d', '#63804e'][level % 3], int(detailed))
        assets[f'pine{variant}' + ('' if detailed else '-lod')] = export()

for variant in range(2):
    for k in range(5):
        a = k * 2.399
        ellipsoid((math.cos(a) * .5, .45 + random.random() * .3, math.sin(a) * .5),
                  (.65, .5, .7), ['#7f9161', '#9da36b', '#667a54'][k % 3], 0)
    assets[f'shrub{variant}'] = export()

for variant in range(2):
    ellipsoid((0, .55, 0), (1.5, .85, 1.1), ['#b7b29b', '#958f7c'][variant], 0)
    assets[f'rock{variant}'] = export()

for variant in range(2):
    rng = random.Random(610 + variant)
    for chunk in range(3):
        bm = bmesh.new()
        xoff, zoff = (chunk - 1) * 1.8, math.sin(chunk * 4 + variant) * 1.2
        height = [3.1, 4.8, 3.8][chunk]
        rings = []
        angles = [k * math.pi * 2 / 7 + variant * .3 for k in range(7)]
        irregularity = [.85 + rng.random() * .4 for k in range(7)]
        for level, radius in enumerate([2.4, 2.65, 1.55]):
            ring = []
            for k, a in enumerate(angles):
                y = [-.4, height * .48, height][level]
                if level: y += math.sin(k * 5 + chunk) * .5
                r = radius * irregularity[k]
                ring.append(bm.verts.new((xoff + math.cos(a) * r + level * .2, y, zoff + math.sin(a) * r * .75)))
            rings.append(ring)
        for level in range(2):
            for k in range(7):
                j = (k + 1) % 7
                bm.faces.new((rings[level][k], rings[level][j], rings[level + 1][j], rings[level + 1][k]))
        bm.faces.new(tuple(rings[-1]))
        part(bm, ['#a39b87', '#b5a991', '#958f7c'][chunk])
    assets[f'outcrop{variant}'] = export()

# Solid blades avoid alpha-card shimmer and retain their shape at low resolution.
for k in range(14):
    a = k * 2.399
    blade((math.cos(a) * .08, 0, math.sin(a) * .08), a, .35 + random.random() * .45, .018,
          ['#a9ac70', '#bdb87e', '#819363', '#d0c18c'][k % 4])
assets['grass'] = export()
for k in range(7):
    a = k * 2.399
    stem = (math.cos(a) * .3, .3 + random.random() * .3, math.sin(a) * .3)
    branch((0, 0, 0), stem, .015, '#829464')
    ellipsoid(stem, (.09, .045, .09), '#efcb70', 0)
assets['flowers'] = export()

for k in range(9):
    a = k * 2.399
    blade((0, .05, 0), a, .36 + (k % 3) * .08, .08, ['#7c9d86', '#99af8a', '#617f70'][k % 3])
assets['succulent'] = export()
for k in range(5):
    a = k * 2.399
    stem = (math.cos(a) * .32, .38 + k * .045, math.sin(a) * .32)
    branch((0, 0, 0), stem, .012, '#789456', segments=3)
    for petal in range(7):
        a = petal * math.pi * 2 / 7
        bm = bmesh.new()
        c = bm.verts.new(stem)
        v1 = bm.verts.new((stem[0] + math.cos(a) * .14, stem[1] + .075, stem[2] + math.sin(a) * .14))
        v2 = bm.verts.new((stem[0] + math.cos(a + .9) * .14, stem[1] + .075, stem[2] + math.sin(a + .9) * .14))
        bm.faces.new((c, v1, v2))
        part(bm, ['#ebac48', '#eec46a', '#dc8f36'][petal % 3])
assets['poppy'] = export()
for k in range(4):
    a = k * 2.399
    x, z = math.cos(a) * .28, math.sin(a) * .28
    branch((x, 0, z), (x, .7, z), .012, '#748b59', segments=3)
    for j in range(4):
        ellipsoid((x, .35 + j * .11, z), (.09 - j * .012, .07, .09 - j * .012), ['#b5acbf', '#cfccd3'][j % 2], 0)
assets['lupine'] = export()

for x in [-.65, .65]:
    for z in [-.19, .19]:
        box((x, .23, z), (.09, .46, .09), '#716b55')
    box((x, .8, .25), (.08, .9, .08), '#716b55')
for z in [-.18, 0, .18]:
    box((0, .48, z), (1.8, .07, .15), '#a28a5c')
for y in [.75, .96]:
    box((0, y, .27), (1.8, .16, .07), '#b39865')
assets['bench'] = export()

# Bixby-inspired open-spandrel arch. Decorative structure; GPX supplies the riding surface.
span = 218
for side in [-1, 1]:
    x = side * 3.9
    for i in range(36):
        a, b = -span / 2 + span * i / 36, -span / 2 + span * (i + 1) / 36
        y1, y2 = -6 - 59 * (a / (span / 2)) ** 2, -6 - 59 * (b / (span / 2)) ** 2
        beam((x, y1, a), (x, y2, b), 2.3, 3.5, '#c5bda5')
    for z in range(-90, 91, 15):
        y = -6 - 59 * (z / (span / 2)) ** 2
        box((x, (y - 1) / 2, z), (.9, -y - 1, 1.05), '#e1d8bd')
        box((x, -2.2, z), (1.4, .65, 1.65), '#bcb49d')
    for z in range(-108, 109, 3):
        box((side * 4.25, .8, z), (.35, 1.3, .4), '#e5ddc6')
    box((side * 4.25, 1.45, 0), (.5, .25, span), '#ede3ca')
    box((side * 4.25, .48, 0), (.35, .2, span), '#c4bba2')
    box((side * 3.95, .16, 0), (.65, .24, span), '#d5ccb4')
    box((side * 3.58, .29, 0), (.16, .26, span), '#e5dac1')
    for z in [-106, 106]:
        box((side * 4.2, .9, z), (.85, 1.65, 1.1), '#d0c6ad')
for z in range(-90, 91, 15):
    box((0, -2.0, z), (8.4, .8, 1.4), '#aaa48f')
    if abs(z) < 80:
        y = -6 - 59 * (z / (span / 2)) ** 2
        box((0, y, z), (8.2, .65, .8), '#b8af97')
for z in [-101, 101]:
    for x in [-3.9, 3.9]:
        box((x, -33, z), (2.8, 65, 4), '#bdb69e')
        box((x, -64, z), (5.3, 4, 6.5), '#a69d85')
        box((x, -3, z), (3.5, 1.6, 5), '#d1c7ad')
box((0, -.65, 0), (9.4, 1.2, span), '#bfb79e')
assets['bridge'] = export()

out = os.path.join(ROOT, 'models', 'scenery', 'coastal.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w') as f:
    json.dump({'format': 'bikefree-scenery-1', 'positionScale': 100, 'assets': assets}, f, separators=(',', ':'))
print(f'Coastal kit: {sum(a["triangles"] for a in assets.values()):,} triangles across {len(assets)} assets → {out}')
