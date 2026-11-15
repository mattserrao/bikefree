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


def branch(a, b, radius, tint, top=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=7,
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
    height = 7.5 + variant * 1.3
    branch((0, 0, 0), (.6, height * .62, .15), .28, '#68533d')
    for k in range(8):
        angle = k * 2.399 + variant
        reach = 1.6 + random.random() * 1.8
        tip = (math.cos(angle) * reach + .6, height * (.62 + .3 * random.random()), math.sin(angle) * reach)
        branch((.4, height * .48, .1), tip, .12, '#746047')
        tint = ['#405d46', '#58734b', '#728454', '#899760'][k % 4]
        ellipsoid(tip, (1.6 + random.random() * .7, .8 + random.random() * .6, 1.5 + random.random()), tint)
    assets[f'cypress{variant}'] = export()

for variant in range(2):
    for k in range(5):
        a = k * 2.399
        ellipsoid((math.cos(a) * .5, .45 + random.random() * .3, math.sin(a) * .5),
                  (.65, .5, .7), ['#7f9161', '#9da36b', '#667a54'][k % 3], 0)
    assets[f'shrub{variant}'] = export()

for variant in range(2):
    ellipsoid((0, .55, 0), (1.5, .85, 1.1), ['#b7b29b', '#958f7c'][variant], 0)
    assets[f'rock{variant}'] = export()

# Solid blades avoid alpha-card shimmer and retain their shape at low resolution.
for k in range(9):
    a = k * 2.399
    end = (math.cos(a) * .33, .4 + random.random() * .4, math.sin(a) * .33)
    branch((0, 0, 0), end, .028, ['#c2b476', '#a5a16a', '#d3c48e'][k % 3], .003)
assets['grass'] = export()
for k in range(7):
    a = k * 2.399
    stem = (math.cos(a) * .3, .3 + random.random() * .3, math.sin(a) * .3)
    branch((0, 0, 0), stem, .015, '#829464')
    ellipsoid(stem, (.09, .045, .09), '#efcb70', 0)
assets['flowers'] = export()

# Bixby-inspired open-spandrel arch. Decorative structure; GPX supplies the riding surface.
span = 218
for side in [-1, 1]:
    x = side * 3.9
    for i in range(36):
        a, b = -span / 2 + span * i / 36, -span / 2 + span * (i + 1) / 36
        y1, y2 = -6 - 59 * (a / (span / 2)) ** 2, -6 - 59 * (b / (span / 2)) ** 2
        branch((x, y1, a), (x, y2, b), 1.7, '#d6ceb4', 1.7)
    for z in range(-90, 91, 15):
        y = -6 - 59 * (z / (span / 2)) ** 2
        box((x, (y - 1) / 2, z), (.9, -y - 1, 1.05), '#e1d8bd')
    for z in range(-109, 110, 5):
        box((side * 4.25, .8, z), (.35, 1.3, .4), '#e5ddc6')
    box((side * 4.25, 1.45, 0), (.5, .25, span), '#ede3ca')
    box((side * 4.25, .48, 0), (.35, .2, span), '#c4bba2')
for z in [-101, 101]:
    for x in [-3.9, 3.9]:
        box((x, -33, z), (2.8, 65, 4), '#bdb69e')
box((0, -.65, 0), (9.4, 1.2, span), '#bfb79e')
assets['bridge'] = export()

out = os.path.join(ROOT, 'models', 'scenery', 'coastal.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w') as f:
    json.dump({'format': 'bikefree-scenery-1', 'positionScale': 100, 'assets': assets}, f, separators=(',', ':'))
print(f'Coastal kit: {sum(a["triangles"] for a in assets.values()):,} triangles across {len(assets)} assets → {out}')
