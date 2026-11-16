import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStudyCar } from '../tools/model-study-assets.js';

test('proposed compact fits road scale, contacts ground and stays within a 500-triangle budget', () => {
  const g=buildStudyCar();
  g.computeBoundingBox();
  const b=g.boundingBox;
  assert.ok(Math.abs(b.min.y)<1e-6, 'tyres touch ground');
  assert.ok(b.max.y>1.4 && b.max.y<1.6, 'plausible compact height');
  assert.ok(b.max.x-b.min.x<2.1, 'fits a traffic lane');
  assert.ok(b.max.z-b.min.z>4.5 && b.max.z-b.min.z<4.7, 'compact length');
  assert.ok(g.index.count/3<=500, 'merged near mesh stays inexpensive');
  for(const name of ['position','normal','color']) for(const n of g.attributes[name].array) assert.ok(Number.isFinite(n), name);
  for(const i of g.index.array) assert.ok(i<g.attributes.position.count, 'valid indices');
  g.dispose();
});
