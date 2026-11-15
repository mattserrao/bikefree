"""Build forest, alpine, desert and tropical extensions to the style-C kit.

    blender --background --python tools/build_regional_assets.py

Rebuilds the common coastal kit too, then writes the regional extension.
"""
import json
import math
import os
import random
import runpy
import bmesh

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
lib = runpy.run_path(os.path.join(ROOT, 'tools', 'build_coastal_assets.py'))
branch, ellipsoid, box, blade, export, part = [lib[n] for n in ['branch', 'ellipsoid', 'box', 'blade', 'export', 'part']]
assets = {}

for variant in range(2):
    rng = random.Random(920 + variant)
    crowns = [(math.cos(k * 2.4) * 2.2, 6 + rng.random() * 3, math.sin(k * 2.4) * 2.2) for k in range(9)]
    for detailed in [False, True]:
        branch((0, 0, 0), (.3, 6, .1), .3, '#70533c')
        for k, crown in enumerate(crowns):
            branch((.2, 4, 0), crown, .11, '#7a6145')
            ellipsoid(crown, (2.1, 1.7, 2), ['#54764b', '#76934e', '#416343'][k % 3], int(detailed))
        assets[f'broadleaf{variant}' + ('' if detailed else '-lod')] = export()

for variant in range(2):
    for detailed in [False, True]:
        height = 14 + variant * 3
        branch((0, 0, 0), (0, height, 0), .24, '#73523b')
        for level in range(8):
            y, radius = height * (.25 + level * .09), 3.3 - level * .34
            for k in range(3):
                a = k * 2.094 + level * 2.4
                end = (math.cos(a) * radius * .6, y, math.sin(a) * radius * .6)
                ellipsoid(end, (radius * .7, .6, radius * .65), ['#345b46', '#466e4d', '#5d8052'][level % 3], int(detailed))
        assets[f'fir{variant}' + ('' if detailed else '-lod')] = export()

for detailed in [False, True]:
    for i in range(7):
        branch((i * .08, i * 1.35, 0), ((i + 1) * .08, (i + 1) * 1.35, 0), .2 - i * .012, '#a18b63', segments=7)
    for k in range(11):
        angle = k * math.pi * 2 / 11
        bm = bmesh.new(); sections = 6 if detailed else 3; previous = None
        for j in range(sections + 1):
            t = j / sections; reach = t * 4.2; width = math.sin(t * math.pi) * .45 + .02
            y = 9.5 + math.sin(t * math.pi) * 1.1 - t * 1.4
            p = (math.cos(angle) * reach + .56, y, math.sin(angle) * reach)
            left = bm.verts.new((p[0] - math.sin(angle) * width, y, p[2] + math.cos(angle) * width))
            right = bm.verts.new((p[0] + math.sin(angle) * width, y, p[2] - math.cos(angle) * width))
            if previous: bm.faces.new((previous[0], previous[1], right, left))
            previous = (left, right)
        part(bm, ['#4d7e59', '#699759', '#8aa85c'][k % 3])
    assets['palm0' + ('' if detailed else '-lod')] = export()

for k in range(11):
    a = k * 2.4
    blade((0, .05, 0), a, .6 + (k % 4) * .15, .045, ['#879571', '#b0ad7b', '#748765'][k % 3])
assets['yucca'] = export()
for k in range(6):
    a = k * 2.4
    ellipsoid((math.cos(a) * .4, .35, math.sin(a) * .4), (.5, .4, .5), ['#9b9c7f', '#8a9478', '#ada689'][k % 3], 0)
assets['sage'] = export()
for frond in range(5):
    angle = frond * 2.4
    for leaf in range(7):
        t = leaf / 7; reach = t * .6; y = .15 + math.sin(t * math.pi * .8) * .55
        for side in [-1, 1]:
            p = (math.cos(angle) * reach, y, math.sin(angle) * reach)
            blade(p, angle + side * 1.1, .16 * (1 - t) + .04, .035, ['#597e4e', '#7c995b'][leaf % 2])
assets['fern'] = export()
for k in range(7):
    a = k * 2.4
    p = (math.cos(a) * .25, .25 + k * .025, math.sin(a) * .25)
    branch((p[0], 0, p[2]), p, .009, '#779067', segments=3)
    ellipsoid(p, (.08, .04, .08), ['#dfd9bc', '#b5b4c5', '#d9c57e'][k % 3], 0)
assets['alpineflowers'] = export()

# A repeatable concrete pier segment, used for the Seven Mile Bridge and short
# river crossings. The renderer fits each segment to the route centreline.
span = 192
box((0, -.55, 0), (9.4, 1.0, span), '#c7c5b0')
for x in [-4.3, 4.3]:
    box((x, .65, 0), (.35, 1.2, span), '#dddac6')
    box((x, 1.3, 0), (.5, .2, span), '#eee9d2')
    for z in range(-90, 91, 6): box((x, .9, z), (.5, 1.55, .6), '#cbc7b2')
for z in [-80, -40, 0, 40, 80]:
    box((0, -1.6, z), (8.6, 1.1, 1.8), '#aaa996')
    for x in [-3.1, 3.1]:
        box((x, -4.7, z), (1.2, 7.4, 1.5), '#b6b4a0')
        box((x, -8.1, z), (2.4, .8, 2.8), '#929585')
assets['viaduct'] = export()

out = os.path.join(ROOT, 'models', 'scenery', 'regional.json')
with open(out, 'w') as f:
    json.dump({'format': 'bikefree-scenery-1', 'positionScale': 100, 'assets': assets}, f, separators=(',', ':'))
print(f'Regional kit: {sum(a["triangles"] for a in assets.values()):,} triangles across {len(assets)} assets → {out}')
