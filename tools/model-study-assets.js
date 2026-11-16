// Experimental examples only; production traffic keeps its existing geometry.
import * as THREE from '../vendor/three.module.min.js';
import { MeshBuilder } from '../js/world/city-geometry.js';
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** A 4.5 m compact: sloped glazing, round wheels and a restrained painted palette.
 * One merged vertex-colour mesh, suitable for a later instanced traffic trial. */
export function buildStudyCar() {
  const m = new MeshBuilder();
  m.color('#657e88');
  m.box(0, .38, 0, 1.8, .48, 4.5);
  m.box(0, .86, -1.5, 1.76, .13, 1.35);
  m.box(0, .86, 1.55, 1.76, .1, 1.25);
  // Cabin is a tapered prism: +z is forward, dimensions in metres.
  const bottom = [V(-.84,.86,-1.25),V(.84,.86,-1.25),V(.84,.86,1.05),V(-.84,.86,1.05)];
  const top = [V(-.68,1.44,-.8),V(.68,1.44,-.8),V(.68,1.44,.48),V(-.68,1.44,.48)];
  m.color('#2d424a');
  for (let i=0;i<4;i++) { const j=(i+1)%4; m.quad(bottom[i],top[i],top[j],bottom[j]); }
  m.color('#657e88'); m.quad(top[0],top[3],top[2],top[1]);
  for (const x of [-.855,.855]) {
    m.color('#657e88'); m.box(x, .86, -.1, .035, .58, .09);
    m.box(x * 1.12, 1.02, .68, .17, .12, .22);
  }
  // Twelve-sided tyres: solid silhouette without texture maps or alpha blending.
  for (const side of [-1,1]) for (const z of [-1.4,1.4]) {
    m.color('#242b2d');
    for (let i=0;i<12;i++) {
      const a=i*Math.PI/6, b=(i+1)*Math.PI/6;
      const p=(x,t,r=.33)=>V(x,.33+Math.cos(t)*r,z+Math.sin(t)*r);
      const inner=side*.76, outer=side*.96;
      const face=[p(inner,a),p(inner,b),p(outer,b),p(outer,a)];
      if(side<0) face.reverse();
      m.quad(...face);
      const rim=[V(outer,.33,z),p(outer,a),p(outer,b)];
      if(side<0) rim.reverse();
      m.triangle(...rim);
      m.color('#a7b1b0');
      const hub=[V(outer+side*.002,.33,z),p(outer+side*.002,a,.18),p(outer+side*.002,b,.18)];
      if(side<0) hub.reverse();
      m.triangle(...hub); m.color('#242b2d');
    }
  }
  m.color('#eee2b7'); for(const x of [-.6,.6]) m.box(x,.68,2.26,.3,.13,.035);
  m.color('#9c4036'); for(const x of [-.6,.6]) m.box(x,.7,-2.28,.3,.13,.035);
  m.color('#303a3b'); m.box(0,.45,2.27,.92,.16,.03);
  return m.geometry();
}
