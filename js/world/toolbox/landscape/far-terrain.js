/**
 * The land beyond the ground (user, 27 Nov 2026: photos of Kanab and the Coral Pink dunes, matched shot for shot — their
 * skylines are mesas and mountains 10–30 km off; the map's horizon was flat fog). One mesh, one draw call: a 400 m
 * height grid out to ~45 km (tools/far_terrain.py → routes/cities/<id>-far.json).
 *
 * It sits behind the streamed ground: within ~4 km of the camera it is sunk out of sight under the real tiles; beyond,
 * each vertex is pulled in toward the camera along its own line of sight (the angles kept, the order kept) so the
 * whole range fits in front of the camera's far plane. Shaded in the shader — sun and sky, the land's colour by
 * slope and height (sand flats, red ledges, pinyon-juniper, the White Cliffs), and its own aerial perspective by the
 * true distance (the scene's fog would have swallowed it).
 */
import * as THREE from '../../../../vendor/three.js';
const HAZE_BLUE = new THREE.Color(.42, .55, .78);   // (the far haze's blue, lerped into the fog colour)

const VERT = /* glsl */`
  uniform vec3 uCam; uniform float uNear, uK, uSinkM;
  varying vec3 vN; varying float vD; varying vec3 vW;
  void main() {
    vec3 w = (modelMatrix * vec4(position, 1.)).xyz;
    vec2 rh = w.xz - uCam.xz; float dh = length(rh);
    w.y -= (1. - smoothstep(uNear - 700., uNear + 300., dh)) * uSinkM;   // (under the streamed tiles near the camera)
    vec3 r = w - uCam; float d = length(r);
    float dc = d < uNear ? d : uNear + (d - uNear) * uK;
    vec3 p = uCam + r * (dc / max(d, 1.));
    vN = normal; vD = d; vW = w;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
  }`;

const FRAG = /* glsl */`
  uniform vec3 uSunDir, uSunCol, uAmb, uHaze, uHazeFar; uniform float uVis, uDesert;
  varying vec3 vN; varying float vD; varying vec3 vW;
  float fh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    return mix(mix(fh(i), fh(i + vec2(1., 0.)), f.x), mix(fh(i + vec2(0., 1.)), fh(i + vec2(1., 1.)), f.x), f.y); }
  void main() {
    vec3 n = normalize(vN);
    float sl = 1. - n.y, h = vW.y;
    vec3 c;
    if (uDesert > .5) {
      // (linear albedo, as calibrated for the near ground: sand ~0.38, red rock ~0.18, juniper woodland ~0.12)
      vec3 sand = vec3(.63, .36, .21), rock = vec3(.39, .14, .075), pale = vec3(.55, .3, .155), white = vec3(.63, .55, .42);
      vec3 pj = vec3(.085, .1, .06);
      float band = .5 + .5 * sin(h * .21 + fn(vW.xz * .0004) * 6.);
      c = mix(sand, mix(rock, pale, band * .5), smoothstep(.12, .35, sl));
      c = mix(c, white, smoothstep(1860., 2050., h) * (.35 + .4 * smoothstep(.1, .4, sl)));
      // pinyon-juniper on the benches and plateaus above ~1,650 m, thinning on the faces
      float wood = smoothstep(1600., 1800., h) * (1. - smoothstep(.25, .5, sl)) * smoothstep(.35, .65, fn(vW.xz * .0011) * .7 + fn(vW.xz * .006) * .3);
      c = mix(c, pj, wood * .75);
    } else {
      vec3 grass = vec3(.12, .2, .06), forest = vec3(.045, .075, .03), rockg = vec3(.25, .24, .21);
      c = mix(grass, forest, smoothstep(.4, .6, fn(vW.xz * .0012)));
      c = mix(c, rockg, smoothstep(.45, .8, sl));
    }
    c *= .9 + .2 * fn(vW.xz * .003);
    vec3 L = c * (uSunCol * max(dot(n, uSunDir), 0.) + uAmb * (.6 + .4 * n.y));
    // aerial perspective by the true distance: the near haze, then the far blue
    float f = 1. - exp(-vD / uVis);
    vec3 hz = mix(uHaze, uHazeFar, smoothstep(.3, .9, f));
    gl_FragColor = vec4(mix(L, hz, f), 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class FarTerrain {
  /** data: <id>-far.json; proj: the map's projection (toLocal); opts.desert: the red-rock palette. */
  constructor(data, proj, { desert = false, nearM = 4000, farPlane = 8600, visibilityM = 55000 } = {}) {
    const n = data.n, cell = data.cellM, [clat, clon] = data.center;
    const raw = Uint8Array.from(atob(data.h), (ch) => ch.charCodeAt(0));
    const H = new Int16Array(raw.buffer);
    const ky = 110540, kx = 111320 * Math.cos(clat * Math.PI / 180);
    const pos = new Float32Array(n * n * 3);
    let maxR = 0;
    for (let j = 0, k = 0; j < n; j++) for (let i = 0; i < n; i++, k++) {
      const dx = (i - (n - 1) / 2) * cell, dzN = ((n - 1) / 2 - j) * cell;   // (rows north → south)
      const p = proj.toLocal(clat + dzN / ky, clon + dx / kx);
      pos[3 * k] = p.x; pos[3 * k + 1] = data.base + H[k]; pos[3 * k + 2] = p.z;
      maxR = Math.max(maxR, Math.hypot(dx, dzN));
    }
    const idx = new Uint32Array((n - 1) * (n - 1) * 6);
    for (let j = 0, q = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx.slice(), 1));   // (a copy: the hole is cut from `idx`)
    g.computeVertexNormals();
    // (winding: make the normals point up)
    const nr = g.attributes.normal; let up = 0; for (let k = 0; k < nr.count; k += 97) up += nr.getY(k);
    if (up < 0) { for (let k = 0; k < nr.count; k++) nr.setXYZ(k, -nr.getX(k), -nr.getY(k), -nr.getZ(k)); }
    this.uniforms = {
      uCam: { value: new THREE.Vector3() }, uNear: { value: nearM }, uK: { value: (farPlane - nearM) / Math.max(1, maxR * 1.5 - nearM) }, uSinkM: { value: 80 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: new THREE.Color(.3, .32, .36) },
      uHaze: { value: new THREE.Color(.6, .6, .65) }, uHazeFar: { value: new THREE.Color(.45, .55, .72) }, uVis: { value: visibilityM }, uDesert: { value: desert ? 1 : 0 },
    };
    const m = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: false });
    m.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.name = 'Far terrain';
    this.mesh.frustumCulled = false;
    // [evidence 27 Nov] drawn after the scenery (it had renderOrder −1: first, so every near ground pixel shaded the far
    // land too before the ground covered it — the frame audit's overdraw up a layer), and with a hole round the camera
    // (below): the cells wholly under the streamed ground aren't drawn at all
    this.mesh.renderOrder = 5;
    this.full = idx; this.pos = pos; this.holeM = Math.min(nearM - 1000, 2000); this._holeAt = null;   // (the hole inside the streamed tiles: NEAR_M 2400 m)
    g.index.setUsage(THREE.DynamicDrawUsage);
  }

  /** The index without the triangles wholly inside holeM of (x, z): rebuilt when the camera has moved a cell's worth. */
  _hole(x, z) {
    const { full, pos } = this, R2 = this.holeM * this.holeM, idx = this.mesh.geometry.index;
    const far = (v) => { const dx = pos[3 * v] - x, dz = pos[3 * v + 2] - z; return dx * dx + dz * dz > R2; };
    let q = 0;
    for (let t = 0; t < full.length; t += 3) {
      const a = full[t], b = full[t + 1], c = full[t + 2];
      if (far(a) || far(b) || far(c)) { idx.array[q++] = a; idx.array[q++] = b; idx.array[q++] = c; }
    }
    this.mesh.geometry.setDrawRange(0, q);
    idx.clearUpdateRanges(); idx.addUpdateRange(0, q); idx.needsUpdate = true;
    this._holeAt = [x, z];
  }

  /** Each frame: the camera, and the sun, sky and haze from the scene. */
  tick(camera, { sunDir, sun, fogColor, ambient } = {}) {
    const U = this.uniforms;
    U.uCam.value.copy(camera.position);
    const h = this._holeAt, p = camera.position;
    if (!h || Math.hypot(p.x - h[0], p.z - h[1]) > 300) this._hole(p.x, p.z);
    if (sunDir) U.uSunDir.value.copy(sunDir).normalize();
    if (sun) U.uSunCol.value.copy(sun.color).multiplyScalar(sun.intensity);
    if (fogColor) { U.uHaze.value.copy(fogColor); U.uHazeFar.value.copy(fogColor).lerp(HAZE_BLUE, .35); }   // [review 27 Nov] HAZE_BLUE a constant (was a new Color a tick)
    if (ambient) U.uAmb.value.copy(ambient);
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
