/**
 * A frame's cost in counts that don't depend on the machine (user, 27 Nov 2026: "improve the visuals … prove each
 * change with evidence"; the M4 Air isn't available, so timing on the device waits — these counts stand in for it and
 * hold on any GPU):
 *
 *   passes     every renderer.render() the frame makes (shadow maps, reflections, the scene, the post passes): its
 *              target, draw calls and triangles
 *   programs   shader programs alive, and their fragment shaders' size (a proxy for per-pixel cost)
 *   memory     geometry and texture bytes on the GPU (counted from the live objects)
 *   overdraw   how many times each pixel of the main view is drawn (every opaque and transparent surface, depth test off)
 *   cpuMs      the JavaScript of one frame's update, without the draw (median of `frames`)
 *
 * Used by tools/qc/audit.mjs through the snapshot tool (`--eval`); the page is drawn again afterwards, as it was.
 */
import * as THREE from '../../../../vendor/three.js';

export async function auditFrame(w, { frames = 12, overdrawScale = 4 } = {}) {
  const R = w.renderer, out = {};
  // ---- the passes: every render() of one frame, by target
  const passes = [], orig = R.render.bind(R);
  R.info.autoReset = false;
  R.render = (scene, camera) => {
    const c0 = R.info.render.calls, t0 = R.info.render.triangles;
    orig(scene, camera);
    const t = R.getRenderTarget();
    passes.push({ target: t ? `${t.width}x${t.height}${t.samples ? `x${t.samples}` : ''}${t.isWebGLCubeRenderTarget ? ' cube' : ''}` : 'canvas',
      camera: camera.isOrthographicCamera ? 'ortho' : 'persp', calls: R.info.render.calls - c0, triangles: R.info.render.triangles - t0, scene: scene.name || scene.type });
  };
  R.info.reset();
  // (the shadow maps draw inside render(): their cost shows as part of the pass that triggered them — split them out)
  const shadowRender = R.shadowMap.render.bind(R.shadowMap);
  let shadow = { calls: 0, triangles: 0 };
  R.shadowMap.render = (...a) => { const c0 = R.info.render.calls, t0 = R.info.render.triangles; shadowRender(...a); shadow.calls += R.info.render.calls - c0; shadow.triangles += R.info.render.triangles - t0; };
  w._draw();
  R.render = orig; R.shadowMap.render = shadowRender;
  out.passes = passes;
  out.shadow = shadow;
  out.calls = R.info.render.calls; out.triangles = R.info.render.triangles;
  // ---- programs
  const progs = R.info.programs || [];
  out.programs = progs.length;
  out.fragmentChars = progs.reduce((s, p) => s + (p.cacheKey?.length || 0), 0);   // (the cache key carries the defines; sizes below)
  try {
    const gl = R.getContext(); let fs = 0;
    for (const p of progs) { const sh = gl.getAttachedShaders(p.program) || []; for (const s of sh) if (gl.getShaderParameter(s, gl.SHADER_TYPE) === gl.FRAGMENT_SHADER) fs += (gl.getShaderSource(s) || '').length; }
    out.fragmentChars = fs;
  } catch { /* (not every context lends its shaders back) */ }
  // ---- memory: geometry and textures in use by the scene
  const geos = new Set(), texs = new Set();
  const own = new Map();   // (texture → the first object.slot holding it: which one is big)
  w.scene.traverse((o) => {
    if (o.geometry) geos.add(o.geometry);
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) for (const k in m) { const v = m[k]; if (v && v.isTexture) { texs.add(v); own.has(v) || own.set(v, `${o.name || o.type}.${k}`); } if (k === 'uniforms') for (const [uk, u] of Object.entries(v)) if (u?.value?.isTexture) { texs.add(u.value); own.has(u.value) || own.set(u.value, `${o.name || o.type}.${uk}`); } }
  });
  let gb = 0;
  for (const g of geos) { for (const a of Object.values(g.attributes || {})) gb += a?.array?.byteLength || a?.data?.array?.byteLength || 0; gb += g.index?.array?.byteLength || 0; }
  let tb = 0; const big = [];
  for (const t of texs) {
    const im = t.image; const wd = im?.width || im?.data?.width || 0, ht = im?.height || im?.data?.height || 0, dp = im?.depth || 1;
    const ch = { [THREE.RedFormat]: 1, [THREE.RGFormat]: 2, [THREE.RGBFormat]: 3 }[t.format] || 4;
    const bpp = ch * (t.type === THREE.FloatType ? 4 : t.type === THREE.HalfFloatType ? 2 : 1);
    const b = wd * ht * dp * bpp * (t.generateMipmaps !== false && t.minFilter !== THREE.LinearFilter && t.minFilter !== THREE.NearestFilter ? 4 / 3 : 1);
    tb += b; big.push([t.name || own.get(t) || t.constructor.name, `${wd}x${ht}${dp > 1 ? 'x' + dp : ''}`, +(b / 1048576).toFixed(1)]);
  }
  out.bigTextures = big.sort((a, b) => b[2] - a[2]).slice(0, 8);
  out.geometryMB = +(gb / 1048576).toFixed(1); out.textureMB = +(tb / 1048576).toFixed(1); out.textures = texs.size;
  // ---- overdraw: every surface of the main view adds 1/255·scale; read back the mean and the 95th percentile
  {
    const size = R.getDrawingBufferSize(new THREE.Vector2());
    const W = Math.max(64, Math.round(size.x / 4)), H = Math.max(36, Math.round(size.y / 4));
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(overdrawScale / 255, 0, 0), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true, side: THREE.DoubleSide });
    mat.color.r = overdrawScale / 255;   // (linear: the target is linear)
    const bg = w.scene.background, fog = w.scene.fog, ov = w.scene.overrideMaterial, sa = R.shadowMap.autoUpdate;
    w.scene.background = null; w.scene.fog = null; w.scene.overrideMaterial = mat; R.shadowMap.autoUpdate = false;
    const sky = []; w.scene.traverse((o) => { if (o.isMesh && (o.name?.match(/sky|dome|cloud/i) || o.material?.side === THREE.BackSide)) { sky.push([o, o.visible]); o.visible = false; } });
    R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear(); orig(w.scene, w.camera); R.setRenderTarget(null);
    const px = new Uint8Array(W * H * 4); R.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const v = []; for (let i = 0; i < W * H; i++) v.push(px[i * 4] / overdrawScale);
    v.sort((a, b) => a - b);
    out.overdraw = { mean: +(v.reduce((s, x) => s + x, 0) / v.length).toFixed(2), p95: +v[Math.floor(v.length * .95)].toFixed(1), max: +v[v.length - 1].toFixed(0), saturatesAt: Math.floor(255 / overdrawScale) };
    for (const [o, vis] of sky) o.visible = vis;
    w.scene.background = bg; w.scene.fog = fog; w.scene.overrideMaterial = ov; R.shadowMap.autoUpdate = sa;
    rt.dispose(); mat.dispose();
  }
  // ---- the update's JavaScript (the frame without its draw)
  {
    const draw = w._draw; w._draw = () => {};
    const cam = w.camera, keep = { p: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, p0: w.p };   // (the update moves the camera: put it back)
    const ts = []; let now = performance.now();
    const raf = window.requestAnimationFrame; window.requestAnimationFrame = () => 0;
    const run = w.running; w.running = true;
    for (let k = 0; k < frames; k++) { now += 1000 / 60; const t0 = performance.now(); try { w._frame(now); } catch (e) { out.cpuError = String(e); break; } ts.push(performance.now() - t0); }
    w.running = run; window.requestAnimationFrame = raf; w._draw = draw;
    cam.position.copy(keep.p); cam.quaternion.copy(keep.q); cam.fov = keep.fov; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); w.p = keep.p0;
    ts.sort((a, b) => a - b);
    out.cpuMs = +(ts[Math.floor(ts.length / 2)] || 0).toFixed(2);
  }
  R.info.autoReset = true;
  w._draw();   // (the page as it was, for the screenshot)
  return out;
}

/**
 * The albedo view (a lighting-independent check of the surfaces against measured reflectance, tools/reference/
 * measured.json): every lit material outputs its base colour — no light, shadow, fog or grade — straight to the canvas
 * (sRGB). The page is left showing it, for the screenshot. Opaque and alpha-tested surfaces; the sky hidden (black).
 */
export function albedoView(w) {
  const R = w.renderer;
  const chunk = THREE.ShaderChunk.opaque_fragment;
  if (!chunk.includes('BF_ALBEDO')) THREE.ShaderChunk.opaque_fragment = `#ifdef BF_ALBEDO\noutgoingLight = diffuseColor.rgb;\n#endif\n${chunk}`;
  const mats = new Set();
  w.scene.traverse((o) => {
    if (o.isMesh && (o.name?.match(/sky|dome|cloud|sun|glow|halo/i) || o.material?.side === THREE.BackSide)) o.visible = false;
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) mats.add(m);
  });
  for (const m of mats) { if (!m.isMeshStandardMaterial && !m.isMeshLambertMaterial && !m.isMeshPhongMaterial && !m.isMeshPhysicalMaterial) continue; m.defines = { ...(m.defines || {}), BF_ALBEDO: '' }; m.needsUpdate = true; }
  w.scene.background = new THREE.Color(0, 0, 0); w.scene.fog = null;
  const tm = R.toneMapping; R.toneMapping = THREE.NoToneMapping;
  R.setRenderTarget(null); R.setClearColor(0x000000, 1); R.clear();
  R.render(w.scene, w.camera);
  R.toneMapping = tm;
  return { materials: mats.size };
}
