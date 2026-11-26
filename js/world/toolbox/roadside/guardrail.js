// Toolbox: post-and-rail guardrail along stretches of road (a scene's "roadside": [{ fromM, toM, side }]).
// Two instanced meshes for the whole route; gaps at overlook entrances and on bridges.
import * as THREE from '../../../../vendor/three.js';
import { litMaterial } from '../materials/lit.js';

export function buildGuardrail(config, route, index, landscape) {
  const posts = [], rails = [];
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3();
  for (const range of config.roadside || []) {
    for (let s = range.fromM; s < range.toM; s += 8) {
      const i = Math.min((route.turnIdx || route.dist.length - 1) - 2, Math.floor(s / 10)), j = i + 1;
      if ((config.lookouts || []).some((l) => (l.side || 'ocean') === (range.side || 'ocean') && Math.abs(s - l.atM) < (l.lengthM || 32) / 2 + 30)) continue;   // open entry and exit for traffic pulling in
      const f = (s - route.dist[i]) / (route.dist[j] - route.dist[i]);
      const x = index.xs[i] + (index.xs[j] - index.xs[i]) * f, z = index.zs[i] + (index.zs[j] - index.zs[i]) * f;
      if (landscape.bridgeAt(x, z, 12)) continue;
      const direction = new THREE.Vector3(index.xs[j] - index.xs[i], route.ele[j] - route.ele[i], index.zs[j] - index.zs[i]).normalize();
      const right = new THREE.Vector3(-direction.z, 0, direction.x).normalize();
      const side = range.side === 'inland' ? -1 : 1;
      position.set(x, route.ele[i] + (route.ele[j] - route.ele[i]) * f, z).addScaledVector(right, side * 4.1);
      const q = new THREE.Quaternion();
      scale.set(1, 1, 1);
      posts.push(matrix.compose(position.clone().add(new THREE.Vector3(0, .55, 0)), q, scale).clone());
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      scale.set(1, 1, 8.15);
      rails.push(matrix.compose(position.clone().add(new THREE.Vector3(0, .95, 0)).addScaledVector(direction, 4), q, scale).clone());
    }
  }
  const group = new THREE.Group();
  const material = litMaterial({ color: '#b7b5a1' });
  for (const [geometry, matrices] of [[new THREE.BoxGeometry(.16, 1.1, .16), posts], [new THREE.BoxGeometry(.16, .23, 1), rails]]) {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
    matrices.forEach((m, i) => mesh.setMatrixAt(i, m)); mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); group.add(mesh);
  }
  return group;
}
