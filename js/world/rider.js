// The rider + road bike modelled in Blender (tools/build_rider.py → models/rider.json),
// animated here: wheels and crank spin, legs follow the pedals with two-bone IK.
import * as THREE from '../../vendor/three.module.min.js';

const MODEL_URL = new URL('../../models/rider.json', import.meta.url);

function b64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function partGeometry(part, palette) {
  const pos16 = new Int16Array(b64(part.pos));
  const pos = new Float32Array(pos16.length);
  for (let i = 0; i < pos.length; i++) pos[i] = pos16[i] / 4000;
  const nrm = new Int8Array(b64(part.nrm));
  const ci = new Uint8Array(b64(part.col));
  const col = new Float32Array(ci.length * 3);
  for (let i = 0; i < ci.length; i++) {
    const c = palette[ci[i]];
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3, true));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(b64(part.idx)), 1));
  g.computeBoundingSphere();
  return g;
}

/** Soft oval shadow under the bike so it sits on the road. */
function makeShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const grd = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 1.9),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.02, 0.08);
  m.renderOrder = 3;
  return m;
}

/** Load the Blender model. Resolves to {group, update(pos, fwd, crank, speed, dt)}. */
export async function loadRider() {
  const data = await (await fetch(MODEL_URL)).json();
  if (data.format !== 'bikefree-model-1') throw new Error('Unknown rider model format');
  const palette = data.palette.map((h) => new THREE.Color(h)); // hex is sRGB → linear
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group();
  group.name = 'rider';
  const parts = {};
  for (const [name, part] of Object.entries(data.parts)) {
    const mesh = new THREE.Mesh(partGeometry(part, palette), material);
    mesh.position.fromArray(part.origin);
    mesh.name = name;
    group.add(mesh);
    parts[name] = mesh;
  }
  group.add(makeShadow());

  const R = data.rig;
  const bb = new THREE.Vector3().fromArray(R.bb);
  const ankleOff = new THREE.Vector3().fromArray(R.ankleFromPedal);
  const legs = [
    { hip: new THREE.Vector3().fromArray(R.hipR), phase: 0, thigh: parts.ThighR, shin: parts.ShinR, foot: parts.FootR },
    { hip: new THREE.Vector3().fromArray(R.hipL), phase: Math.PI, thigh: parts.ThighL, shin: parts.ShinL, foot: parts.FootL },
  ];
  const down = new THREE.Vector3(0, -1, 0);
  const tmp = new THREE.Vector3(), knee = new THREE.Vector3(), ankle = new THREE.Vector3();

  function update(pos, fwd, crank, speed, dt) {
    group.position.copy(pos);
    group.lookAt(tmp.copy(pos).add(fwd));
    const spin = (speed / R.wheelRadius) * dt;
    parts.WheelFront.rotation.x += spin;
    parts.WheelRear.rotation.x += spin;
    parts.Crank.rotation.x = crank;
    for (const leg of legs) {
      const a = crank + leg.phase;
      ankle.set(leg.hip.x, bb.y + Math.cos(a) * R.crank, bb.z + Math.sin(a) * R.crank).add(ankleOff);
      const dvec = tmp.copy(ankle).sub(leg.hip);
      const d = Math.min(R.thigh + R.shin - 0.001, dvec.length());
      const k = Math.acos(Math.min(1, Math.max(-1, (R.thigh * R.thigh + d * d - R.shin * R.shin) / (2 * R.thigh * d))));
      dvec.normalize();
      const base = Math.atan2(dvec.z, -dvec.y);
      knee.set(leg.hip.x, leg.hip.y - Math.cos(base + k) * R.thigh, leg.hip.z + Math.sin(base + k) * R.thigh);
      leg.thigh.position.copy(leg.hip);
      leg.thigh.quaternion.setFromUnitVectors(down, tmp.copy(knee).sub(leg.hip).normalize());
      leg.shin.position.copy(knee);
      leg.shin.quaternion.setFromUnitVectors(down, tmp.copy(ankle).sub(knee).normalize());
      leg.foot.position.copy(ankle);
      leg.foot.rotation.set(0.1 + 0.18 * Math.sin(a), 0, 0); // a little ankling through the stroke
    }
  }
  update(new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 0, 0, 0);
  return { group, update, triangles: Object.values(data.parts).reduce((t, p) => t + p.tris, 0) };
}
