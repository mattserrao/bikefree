// Soft roadside plants as alpha-cut picture cards (user, 24 Nov — Zwift parity, item 5: "soft grass"): the verge's
// grass, tall grass, goldenrod and Queen Anne's lace / chicory drawn once into a small atlas (a canvas at start, no
// download), and each plant two crossed cards that sway in the wind. Replaces the single-triangle blades, which read
// as a spiky saw-tooth fringe. The scrub, cattails and the rest still draw as geometry in the same mesh: their
// texture coordinates sit on the atlas's solid white corner.
import * as THREE from '../../../../vendor/three.js';
import { WIND, WIND_GLSL } from '../atmosphere/wind.js';

const W = 2048, H = 256, CELLS = 8, CW = W / CELLS;
// [plants phase 3] 5–7: the desert's — bunchgrass (Indian ricegrass, needle-and-thread, galleta), cheatgrass, forbs
export const CARD = { turf: 0, tall: 1, goldenrod: 2, lace: 3, scrub: 4, bunch: 5, cheat: 6, forb: 7 };
/** The u offset from one card cell to the next (GroundCover's per-tuft cell: shifted in the shader). */
export const CELL_U = CW / W;
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
  // 4: scrub (user, 26 Nov — the verge's shrubs were faceted pyramids, then mounds): a leafy dome of overlapping
  // leaves to the ground, drawn light and neutral so each plant's tint gives its colour (dogwood red, sumac, green)
  { const r = rnd(71), x0 = CW * 4, cx = x0 + CW / 2;
    for (let k = 0; k < 520; k++) {
      const a = r() * Math.PI, rr = Math.sqrt(r()), px = cx + Math.cos(a) * rr * CW * .44 * (r() < .5 ? -1 : 1), py = H - Math.sin(a) * rr * H * .86 - 4;
      const v = 92 + Math.floor((1 - rr * .4) * 80 * (.5 + r() * .5)) + (py < H * .45 ? 16 : 0);
      g.fillStyle = `rgb(${v},${v},${Math.floor(v * .96)})`;
      g.beginPath(); g.ellipse(px, py, 4 + r() * 5, 2.2 + r() * 2.6, r() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgb(120,110,100)'; g.lineWidth = 2;
    for (let k = 0; k < 6; k++) { const x = cx + (r() - .5) * CW * .3; g.beginPath(); g.moveTo(x, H); g.lineTo(x + (r() - .5) * 30, H * .55); g.stroke(); } }
  // 5: desert bunchgrass (Indian ricegrass, needle-and-thread, galleta) in fall: a stiff upright fountain of fine
  // straw and grey-green blades, cured gold at the tips, airy seed sprays above (drawn near neutral: the tuft's tint
  // shifts it per cover)
  { const r = rnd(83), x0 = CW * 5, cx = x0 + CW / 2;
    const cured = ['#b7a678', '#c4b585', '#a99a6c', '#9fa07a', '#8f9670', '#c9bb8e'];
    for (let k = 0; k < 120; k++) { const x = cx + (r() - .5) * CW * .34, len = H * (.4 + r() * .45); blade(r, x, len, (x - cx) / (CW * .17) * .35 + (r() - .5) * .25, 1 + r() * 1.1, cured[Math.floor(r() * cured.length)]); }
    g.strokeStyle = '#d8cca2'; g.lineWidth = 1;
    for (let k = 0; k < 26; k++) { const x = cx + (r() - .5) * CW * .3, top = H * (.02 + r() * .16), bend = (x - cx) * .6; g.beginPath(); g.moveTo(x, H * .45); g.quadraticCurveTo(x + bend * .3, top + 30, x + bend, top); g.stroke();
      for (let j = 0; j < 6; j++) { g.fillStyle = '#e0d4ac'; g.beginPath(); g.ellipse(x + bend * (j / 6) + (r() - .5) * 10, top + 6 + j * 7, 1.6, 3.2, r(), 0, Math.PI * 2); g.fill(); } } }
  // 6: cheatgrass (downy brome) gone over: short, soft, nodding heads, tan with a purple cast; carpets disturbed ground
  { const r = rnd(97), x0 = CW * 6;
    const brome = ['#b59d76', '#a88f6c', '#c2ab82', '#9c8466', '#b8a07e'];
    for (let k = 0; k < 110; k++) { const x = x0 + CW * (.08 + r() * .84), len = H * (.25 + r() * .35); blade(r, x, len, (r() - .5) * 1.1, 1.2 + r(), brome[Math.floor(r() * brome.length)]); }
    for (let k = 0; k < 40; k++) { const x = x0 + CW * (.1 + r() * .8), y = H * (.38 + r() * .3), dx = (r() < .5 ? -1 : 1) * (6 + r() * 10); g.strokeStyle = '#a58a6a'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + dx, y - 4, x + dx * 1.3, y + 10); g.stroke();
      g.fillStyle = r() < .5 ? '#9a7e6e' : '#b39a78'; g.beginPath(); g.ellipse(x + dx * 1.3, y + 12, 2, 6, .3, 0, Math.PI * 2); g.fill(); } }
  // 7: fall forbs: dry stalks with seed heads, a few late globemallow (orange) and aster (lilac) flowers, low leaves
  { const r = rnd(109), x0 = CW * 7;
    for (let k = 0; k < 12; k++) {
      const x = x0 + CW * (.12 + r() * .76), top = H * (.12 + r() * .4), bend = (r() - .5) * 26;
      g.strokeStyle = '#8a7c5c'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + bend * .3, (H + top) / 2, x + bend, top); g.stroke();
      const kind = r();
      for (let j = 0; j < 5; j++) { const py = top + j * 12, px = x + bend * (1 - j * .08); g.fillStyle = kind < .3 ? '#d9743a' : kind < .45 ? '#b7a6c9' : '#8f7f5c'; g.beginPath(); g.arc(px + (r() - .5) * 6, py, kind < .45 ? 3.6 : 2.6, 0, Math.PI * 2); g.fill(); }
    }
    for (let k = 0; k < 24; k++) { g.fillStyle = r() < .5 ? '#8c9468' : '#7f8a60'; g.beginPath(); g.ellipse(x0 + CW * (.1 + r() * .8), H - 6 - r() * 20, 6, 3, r(), 0, Math.PI * 2); g.fill(); } }
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
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
        vMapUv.x += iCell * ${CELL_U.toFixed(6)};   // [plants phase 3] a ground-cover tuft's own card (GroundCover: one mesh, many plants)
        #endif`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvCard = uv.x > .004 ? 1. : 0.;')
      .replace('#include <common>', '#include <common>\nvarying float vCard;\n#ifdef USE_INSTANCING\nattribute float iCell;\n#endif');
    // the cards lit as the ground under them (facing up), whichever side faces the camera
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vCard;')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nif (vCard > .5) normal = normalize((viewMatrix * vec4(0., 1., 0., 0.)).xyz);');
  };
  m.customProgramCacheKey = () => `grass-cards-4-${msaa}`;
  return m;
}

/**
 * One plant: two crossed cards (the cell's picture), w wide and h tall, standing at (x, y, z), turned by yaw; tint a
 * THREE.Color-like [r, g, b] (0–1) multiplied into the picture.
 */
export function grassCard(M, x, y, z, cell, w, h, yaw, tint) {
  const u0 = (cell * CW + 8) / W, u1 = ((cell + 1) * CW - 3) / W;
  M.color(tint);
  // (a shrub: three cards at 60°, so its dome reads round from every side; the grasses: two)
  for (const a of cell === CARD.scrub ? [yaw, yaw + Math.PI / 3, yaw + 2 * Math.PI / 3] : [yaw, yaw + Math.PI / 2]) {
    const c = Math.cos(a) * w / 2, s = Math.sin(a) * w / 2;
    const a0 = M.vertex(x - c, y - .03, z - s, 0, 1, 0, u0, .03), a1 = M.vertex(x + c, y - .03, z + s, 0, 1, 0, u1, .03);
    const a2 = M.vertex(x + c, y + h, z + s, 0, 1, 0, u1, .99), a3 = M.vertex(x - c, y + h, z - s, 0, 1, 0, u0, .99);
    M.tri(a0, a1, a2); M.tri(a0, a2, a3);
  }
}
