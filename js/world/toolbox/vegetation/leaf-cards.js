// Camera-facing leaf clumps (user, 26 Nov 2026: the near trees' leaf clusters "appear as crosses and aren't as
// convincing — review and rework"; chose "soft camera-facing clumps"). A leaf card no longer has a fixed plane: all
// six of its vertices sit at the clump's centre and carry their corner (aCard: x, y in metres, its roll, 1 if it keeps
// to world up), and the vertex shader opens the card in view space, square to whatever camera draws it — the rider's,
// the impostor bake's, the sun's for its shadow. Seen from anywhere, the crown is overlapping round clumps with no
// edge-on planes and no X where two cards cross. Normals stay spherized from the crown's centre, so the clumps shade as
// one soft volume (lit on the sun's side, dark underneath).
//
//   const C = cardArrays(); pushCard(C, centre, w, h, roll, upright, normal, u0, v0, colour) …; const g = cardGeometry(C)
//   billboardLeaves(material)   patches a leaf material (and returns it); leafDepthMaterial(map) for its shadow
import * as THREE from '../../../../vendor/three.js';

const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]], UVS = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];

export const cardArrays = () => ({ pos: [], nor: [], uv: [], col: [], card: [], pad: 0 });
// [shrub style, 27 Nov] the leaf texture is two squares tall: the four leaf clusters in its lower half (v 0–0.5: every
// caller's quadrant, (v0 + …) × LEAF_V), four desert-shrub pictures in its upper half (makeLeafTexture). A card names a
// shrub picture by SHRUB_CELL's [u0, v0].
export const LEAF_V = .5;
export const SHRUB_CELL = { sage: [0, 1.5], broom: [.5, 1.5], tips: [0, 1], twig: [.5, 1] };

/** A card at `c` (Vector3), half sizes w × h (m), turned `roll` in its plane, `upright` to keep its y to world up (a
 *  drooping willow spray, a bush's upright sheet); n: its (spherized) normal; one of the texture's four clusters. */
export function pushCard(C, c, w, h, roll, upright, n, u0, v0, col) {
  for (let j = 0; j < 6; j++) {
    const [sx, sy] = CORNERS[j];
    C.pos.push(c.x, c.y, c.z); C.nor.push(n.x, n.y, n.z); C.col.push(col.r, col.g, col.b);
    C.uv.push(u0 + UVS[j][0] * .5, (v0 + UVS[j][1] * .5) * LEAF_V);
    C.card.push(sx * w, sy * h, roll, upright ? 1 : 0);
  }
  C.pad = Math.max(C.pad, Math.hypot(w, h));
}

/** The cards as a geometry; its bounds padded by the largest card (its vertices sit at the centres). */
export function cardGeometry(C) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(C.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(C.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(C.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(C.col, 3));
  g.setAttribute('aCard', new THREE.Float32BufferAttribute(C.card, 4));
  const pad = C.pad;
  g.computeBoundingBox = function () { THREE.BufferGeometry.prototype.computeBoundingBox.call(this); this.boundingBox.expandByScalar(pad); };
  g.computeBoundingSphere = function () { THREE.BufferGeometry.prototype.computeBoundingSphere.call(this); this.boundingSphere.radius += pad; };
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.cards = true;
  return g;
}

/** The vertex code: a card opened in view space about its centre (after the instance and the model-view transform). */
export const CARD_PARS = 'attribute vec4 aCard;';
export const CARD_OPEN = /* glsl */`
  {
    #ifdef USE_INSTANCING
    float lcS = length(instanceMatrix[0].xyz);
    #else
    float lcS = 1.;
    #endif
    float lcC = cos(aCard.z), lcN = sin(aCard.z);
    vec2 lcO = mat2(lcC, lcN, -lcN, lcC) * aCard.xy * lcS;
    if (aCard.w > .5) {
      // upright: across the view, its y to world up (in view space)
      vec3 lcU = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz), lcR = normalize(cross(lcU, vec3(0., 0., 1.)));
      mvPosition.xyz += lcR * lcO.x + lcU * lcO.y;
    } else mvPosition.xy += lcO;
    gl_Position = projectionMatrix * mvPosition;
  }`;

/** Patch a leaf material so its cards open to the camera (chains any onBeforeCompile; idempotent). */
export function billboardLeaves(m) {
  if (m.userData.billboard) return m;
  m.userData.billboard = true;
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey ? m.customProgramCacheKey() : '';
  m.onBeforeCompile = (shader, r) => {
    prev?.call(m, shader, r);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${CARD_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${CARD_OPEN}`);
  };
  m.customProgramCacheKey = () => `${prevKey}|cards1`;
  return m;
}

/** The leaves' shadow: a depth material cut by the leaf texture, its cards opened to the light. */
export function leafDepthMaterial(map) {
  return billboardLeaves(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: .45, side: THREE.DoubleSide }));
}
