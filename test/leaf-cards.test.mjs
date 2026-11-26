// Leaf clumps (user, 26 Nov 2026: the near trees' leaf clusters read as "crosses"; the bushes' sheets too): every leaf
// card in the tree kit is a camera-facing clump (js/world/toolbox/vegetation/leaf-cards.js) — its six vertices at the
// clump's centre with their corners in aCard — and its bounds still cover the opened cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUpstateTrees } from '../js/world/toolbox/vegetation/upstate-trees.js';

test('every tree and bush leaf geometry is camera-facing clumps, bounded by its opened cards', () => {
  const kit = makeUpstateTrees({ bushes: true, park: true, desert: true });
  const geos = [];
  for (const sp of Object.values(kit.species)) for (const v of sp.variants) for (const t of v.slice(0, 2)) if (t.leaves) geos.push(t.leaves);
  for (const u of Object.values(kit.understory)) if (u.leaves) geos.push(u.leaves);
  assert.ok(geos.length > 40, `${geos.length} leaf geometries`);
  for (const g of geos) {
    const P = g.attributes.position, C = g.attributes.aCard;
    assert.ok(C && C.count === P.count, 'aCard on every vertex');
    for (let i = 0; i < P.count; i += 6) for (let j = 1; j < 6; j++) assert.equal(P.getX(i + j), P.getX(i), 'a card\'s vertices share its centre');
    g.computeBoundingBox();
    let maxY = -Infinity; for (let i = 0; i < P.count; i++) maxY = Math.max(maxY, P.getY(i) + Math.abs(C.getY(i)));
    assert.ok(g.boundingBox.max.y >= maxY - 1e-3, 'bounds cover the opened cards');
  }
});
