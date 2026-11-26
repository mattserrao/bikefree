// Soft roadside plants as alpha-cut picture cards (user, 24 Nov — Zwift parity, item 5: "soft grass"): the verge's
// grass, tall grass, goldenrod and Queen Anne's lace / chicory drawn once into a small atlas (a canvas at start, no
// download), and each plant two crossed cards that sway in the wind. Replaces the single-triangle blades, which read
// as a spiky saw-tooth fringe. The scrub, cattails and the rest still draw as geometry in the same mesh: their
// texture coordinates sit on the atlas's solid white corner.
import * as THREE from '../../../../vendor/three.js';
import { WIND, WIND_GLSL } from '../atmosphere/wind.js';

const W = 1024, H = 256, CELLS = 4, CW = W / CELLS;
export const CARD = { turf: 0, tall: 1, goldenrod: 2, lace: 3 };
/** The texture coordinate of the atlas's opaque white corner (for geometry that isn't a card). */
export const SOLID_UV = [1.5 / W, 1.5 / H];

function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** Draw the atlas (a canvas): four cells, each a clump seen from the side, roots at the bottom. */
function drawAtlas() {
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, W, H);
  const blade = (r, x0, len, lean, width, col) => {
    const tipX = x0 + lean * len, tipY = H - len, cx = x0 + lean * len * .35, cy = H - len * .62;
    g.beginPath(); g.moveTo(x0 - width, H); g.quadraticCurveTo(cx - width * .5, cy, tipX, tipY); g.quadraticCurveTo(cx + width * .5, cy, x0 + width, H); g.closePath();
    g.fillStyle = col; g.fill();
  };
  const greens = ['#5f7d3a', '#6d8a42', '#7f9548', '#8c9a52', '#a4a066', '#566f34'];
  // 0: turf: a low dense tuft
  { const r = rnd(11), x0 = 0;
    for (let k = 0; k < 90; k++) { const x = x0 + CW * (.1 + r() * .8); blade(r, x, H * (.22 + r() * .38), (r() - .5) * .9, 2 + r() * 2.5, greens[Math.floor(r() * greens.length)]); } }
  // 1: tall grass: long blades past the knee, tan seed heads
  { const r = rnd(23), x0 = CW;
    for (let k = 0; k < 70; k++) { const x = x0 + CW * (.12 + r() * .76), len = H * (.45 + r() * .5); blade(r, x, len, (r() - .5) * .7, 1.6 + r() * 2, greens[Math.floor(r() * greens.length)]); }
    for (let k = 0; k < 14; k++) { const x = x0 + CW * (.2 + r() * .6), y = H * (.05 + r() * .3); g.fillStyle = r() < .5 ? '#c2b07a' : '#b19e6c'; g.beginPath(); g.ellipse(x, y, 3, 12 + r() * 8, (r() - .5) * .5, 0, Math.PI * 2); g.fill(); g.fillRect(x - .8, y, 1.6, H * .25); } }
  // 2: goldenrod: stems, leaves, arching yellow plumes
  { const r = rnd(37), x0 = CW * 2;
    for (let k = 0; k < 11; k++) {
      const x = x0 + CW * (.15 + r() * .7), top = H * (.08 + r() * .3), bend = (r() - .5) * 30;
      g.strokeStyle = '#5f7238'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + bend * .3, (H + top) / 2, x + bend, top); g.stroke();
      for (let j = 0; j < 7; j++) { const t = .25 + j * .1, lx = x + bend * t * t, ly = H - (H - top) * t; g.fillStyle = '#617a3a'; g.beginPath(); g.ellipse(lx + (j % 2 ? 7 : -7), ly, 9, 2.4, j % 2 ? -.5 : .5, 0, Math.PI * 2); g.fill(); }
      for (let j = 0; j < 26; j++) { const t = j / 26, px = x + bend + Math.sin(t * 2.4) * 22 * (bend >= 0 ? 1 : -1), py = top - 4 + t * 34 + (r() - .5) * 6; g.fillStyle = r() < .3 ? '#d8bc4e' : r() < .6 ? '#c9ae46' : '#b89d3e'; g.beginPath(); g.arc(px, py, 2.3 + r() * 2.2, 0, Math.PI * 2); g.fill(); }
    }
    for (let k = 0; k < 30; k++) blade(r, x0 + CW * (.1 + r() * .8), H * (.15 + r() * .25), (r() - .5) * .8, 2, greens[k % greens.length]); }
  // 3: Queen Anne's lace (flat white umbels) and chicory (blue)
  { const r = rnd(53), x0 = CW * 3;
    for (let k = 0; k < 8; k++) {
      const x = x0 + CW * (.15 + r() * .7), top = H * (.1 + r() * .35), chic = r() < .4;
      g.strokeStyle = '#6a7d45'; g.lineWidth = 1.8; g.beginPath(); g.moveTo(x, H); g.lineTo(x + (r() - .5) * 20, top); g.stroke();
      if (chic) for (let j = 0; j < 5; j++) { g.fillStyle = '#8395c0'; g.beginPath(); g.arc(x + (r() - .5) * 16, top + j * 14, 4.5, 0, Math.PI * 2); g.fill(); }
      else { g.fillStyle = r() < .3 ? '#8b7552' : '#e4e1d6'; g.beginPath(); g.ellipse(x, top, 22, 7, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = 'rgba(160,150,120,.5)'; for (let j = 0; j < 10; j++) { g.beginPath(); g.arc(x + (r() - .5) * 34, top + (r() - .5) * 8, 1.6, 0, Math.PI * 2); g.fill(); } }
    }
    for (let k = 0; k < 40; k++) blade(r, x0 + CW * (.1 + r() * .8), H * (.15 + r() * .3), (r() - .5) * .8, 2, greens[k % greens.length]); }
  // the solid white corner (bottom-left: texture (0, 0) with the image flipped) for non-card geometry
  g.fillStyle = '#ffffff'; g.fillRect(0, H - 4, 4, 4);
  return cv;
}

let atlas = null;
export function grassAtlas(renderer) {
  if (atlas) return atlas;
  const t = new THREE.CanvasTexture(drawAtlas());
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return (atlas = t);
}

/**
 * The verges' material: vertex colour (a per-plant tint) × the atlas, alpha-cut (alpha to coverage where there's
 * MSAA: soft edges), both faces, lit as if facing up (so the cards don't go dark side-on), the cards' tops swaying.
 */
export function grassMaterial(renderer, uTime, msaa = true) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, metalness: 0, side: THREE.DoubleSide, map: grassAtlas(renderer), alphaTest: msaa ? .35 : .5, alphaToCoverage: msaa });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime; shader.uniforms.uWindDir = WIND.uWindDir; shader.uniforms.uWindK = WIND.uWindK;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;\n' + WIND_GLSL)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // a card's top (its uv.y above the cell's foot) sways; geometry on the white corner stays put
        if (uv.y > .05 && uv.x > .004) { vec3 wp = (modelMatrix * vec4(position, 1.)).xyz; float k = uv.y * uv.y;
          transformed.xz += (bfWindAt(wp.xz, uTime) * .1 + vec2(sin(uTime * 1.9 + wp.x * .35 + wp.z * .21), cos(uTime * 1.4 + wp.z * .3)) * .035) * k; }`)   // (the shared wind, and each blade's own flutter)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvCard = uv.x > .004 ? 1. : 0.;')
      .replace('#include <common>', '#include <common>\nvarying float vCard;');
    // the cards lit as the ground under them (facing up), whichever side faces the camera
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCard;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nif (vCard > .5) normal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);');
  };
  m.customProgramCacheKey = () => `grass-cards-3-${msaa}`;
  return m;
}

/**
 * One plant: two crossed cards (the cell's picture), w wide and h tall, standing at (x, y, z), turned by yaw; tint a
 * THREE.Color-like [r, g, b] (0–1) multiplied into the picture.
 */
export function grassCard(M, x, y, z, cell, w, h, yaw, tint) {
  const u0 = (cell * CW + 8) / W, u1 = ((cell + 1) * CW - 3) / W;
  M.color(tint);
  for (const a of [yaw, yaw + Math.PI / 2]) {
    const c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2;
    const a0 = M.vertex(x - c, y - .03, z - s, 0, 1, 0, u0, .03), a1 = M.vertex(x + c, y - .03, z + s, 0, 1, 0, u1, .03);
    const a2 = M.vertex(x + c, y + h, z + s, 0, 1, 0, u1, .99), a3 = M.vertex(x - c, y + h, z - s, 0, 1, 0, u0, .99);
    M.tri(a0, a1, a2); M.tri(a0, a2, a3);
  }
}
