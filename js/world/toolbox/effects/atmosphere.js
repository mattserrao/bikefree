// Atmosphere (user, 23 Nov 2026: "what other effects? sun beams etc."; chose sun beams through trees, ground mist in
// low spots, drifting leaves, dust and pollen motes). Four cheap layers round the rider, all in the world (no
// post-processing pass): each is one draw call, its animation in the vertex shader.
//   beams   soft shafts of the low sun slanting down through the crowns near the road: long thin additive cards along
//           the sun's direction, turned about their own axis to face you, faint at their ends; re-placed as you ride
//           (at trees up-sun of the road) — only when the sun is low enough to rake through the woods
//   mist    a thin haze lying over the water and the wet ground near you (soft round cards just over the surface,
//           drifting a little), strongest at golden hour
//   leaves  falling leaves in a box round the camera: fluttering, spinning, drifting with the wind, wrapping round
//   motes   tiny dust and pollen points floating in the air, catching the light when you look toward the sun
// Options: { beams: 1, mist: 1, leaves: 1, motes: 1 } (each a strength; 0 turns it off).
// The world it needs: scene, camera, sunDir, sun, and (for beams and mist) city.forest.tiles, city.landAt / LAND codes,
// poolAt(x, z), surfaceH(x, z).
import * as THREE from '../../../../vendor/three.module.min.js';

const BEAMS = 14, MIST = 22, LEAVES = 160, MOTES = 420;

export const atmosphere = {
  install(world, opts = {}) {
    const on = (k) => (opts[k] ?? 1) > 0;
    const group = new THREE.Group(); group.name = 'Atmosphere'; world.scene.add(group);
    const uTime = { value: 0 }, uCam = { value: new THREE.Vector3() }, uSun = { value: new THREE.Vector3(0, 1, 0) }, uSunCol = { value: new THREE.Color(1, .9, .7) };
    const parts = [];

    // ---------------------------------------------------------------- sun beams
    let beams = null;
    if (on('beams')) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, 0, 0, .5, 0, 0, .5, 1, 0, -.5, 1, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const iA = new THREE.InstancedBufferAttribute(new Float32Array(BEAMS * 4), 4), iB = new THREE.InstancedBufferAttribute(new Float32Array(BEAMS * 4), 4);
      iA.setUsage(THREE.DynamicDrawUsage); iB.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iA', iA); g.setAttribute('iB', iB); g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime, uCam, uSun, uSunCol, uK: { value: opts.beams ?? 1 }, uLow: { value: 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
        vertexShader: /* glsl */`
          attribute vec4 iA; attribute vec4 iB;   // iA: top x, y, z, length; iB: width, born, phase, strength
          uniform vec3 uCam, uSun; uniform float uTime;
          varying vec2 vUv; varying float vA;
          void main() {
            vec3 dir = -normalize(uSun);                       // down the beam: away from the sun
            vec3 top = iA.xyz, mid = top + dir * iA.w * .5;
            vec3 side = normalize(cross(dir, normalize(uCam - mid)));
            vec3 p = top + dir * (position.y * iA.w) + side * position.x * iB.x * (1. + position.y * .6);
            vUv = vec2(position.x + .5, position.y);
            float d = length(uCam - mid);
            // fade in when placed, out with distance and when seen end-on; a slow shimmer
            vA = iB.w * clamp((uTime - iB.y) / 3., 0., 1.) * smoothstep(110., 45., d) * smoothstep(4., 12., d)
               * (.75 + .25 * sin(uTime * .35 + iB.z * 6.28));
            gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uSunCol; uniform float uK, uLow;
          varying vec2 vUv; varying float vA;
          void main() {
            float across = 1. - abs(vUv.x * 2. - 1.); across *= across;
            float along = smoothstep(0., .18, vUv.y) * (1. - smoothstep(.55, 1., vUv.y));
            float a = across * along * vA * uK * uLow * .2;
            gl_FragColor = vec4(uSunCol * a, 1.);
          }`,
      });
      beams = new THREE.Mesh(g, mat); beams.frustumCulled = false; beams.name = 'Sun beams'; beams.renderOrder = 5; beams.userData.bake = false;
      group.add(beams); parts.push(beams);
    }

    // ---------------------------------------------------------------- ground mist
    let mist = null;
    if (on('mist')) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const iA = new THREE.InstancedBufferAttribute(new Float32Array(MIST * 4), 4); iA.setUsage(THREE.DynamicDrawUsage);
      const iB = new THREE.InstancedBufferAttribute(new Float32Array(MIST * 2), 2); iB.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iA', iA); g.setAttribute('iB', iB); g.instanceCount = 0;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime, uCam, uSunCol, uK: { value: opts.mist ?? 1 }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
        transparent: true, depthWrite: false, fog: true,
        vertexShader: /* glsl */`
          attribute vec4 iA; attribute vec2 iB;   // iA: x, y, z, radius; iB: born, phase
          uniform float uTime; uniform vec3 uCam;
          varying vec2 vUv; varying float vA;
          #include <fog_pars_vertex>
          void main() {
            vec3 o = iA.xyz + vec3(sin(uTime * .05 + iB.y * 6.) * 3., 0., cos(uTime * .04 + iB.y * 5.) * 3.);
            vec3 p = o + position * vec3(iA.w, 1., iA.w * .7);
            vUv = position.xz;
            vA = clamp((uTime - iB.x) / 4., 0., 1.) * smoothstep(5., 18., length(uCam.xz - o.xz));
            vec4 mvPosition = viewMatrix * vec4(p, 1.);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uSunCol; uniform float uK, uTime;
          varying vec2 vUv; varying float vA;
          #include <fog_pars_fragment>
          void main() {
            float r = length(vUv), a = (1. - smoothstep(.2, 1., r));
            a *= .75 + .25 * sin(vUv.x * 3. + uTime * .2) * sin(vUv.y * 2.4 - uTime * .17);
            gl_FragColor = vec4(mix(vec3(.86, .88, .9), uSunCol, .35), a * vA * uK * .2);
            #include <fog_fragment>
          }`,
      });
      mist = new THREE.Mesh(g, mat); mist.frustumCulled = false; mist.name = 'Ground mist'; mist.renderOrder = 4; mist.userData.bake = false;
      group.add(mist); parts.push(mist);
    }

    // ---------------------------------------------------------------- drifting leaves
    if (on('leaves')) {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const n = Math.round(LEAVES * Math.min(1.5, opts.leaves ?? 1)), seed = new Float32Array(n * 4), col = new Float32Array(n * 3);
      const tones = ['#c4561f', '#d8892a', '#b3341d', '#c9a43a', '#8a5a2a', '#9c7a2c'].map((h) => new THREE.Color(h));
      for (let i = 0; i < n; i++) { seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4); const c = tones[i % tones.length]; col.set([c.r, c.g, c.b], i * 3); }
      g.setAttribute('iS', new THREE.InstancedBufferAttribute(seed, 4)); g.setAttribute('iC', new THREE.InstancedBufferAttribute(col, 3)); g.instanceCount = n;
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime, uCam, uSunCol, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) }, side: THREE.DoubleSide, fog: true,
        vertexShader: /* glsl */`
          attribute vec4 iS; attribute vec3 iC; uniform float uTime; uniform vec3 uCam;
          varying vec3 vC; varying vec2 vUv;
          #include <fog_pars_vertex>
          void main() {
            // a 36 × 9 × 36 m box round the camera; each leaf falls ~0.7 m/s, drifts with the wind, wraps round the box
            vec3 box = vec3(36., 9., 36.);
            float t = uTime * (.55 + iS.w * .35) + iS.x * 40.;
            vec3 o = vec3(iS.x, 1. - fract(t / box.y), iS.z) * box;
            o.x += uTime * .9 + sin(t * 1.3 + iS.y * 9.) * .8; o.z += uTime * .3 + cos(t * 1.1 + iS.x * 7.) * .6;
            vec3 base = uCam - vec3(box.x * .5, 5.5, box.z * .5);
            o.xz = mod(o.xz - (uCam.xz - box.xz * .5), box.xz);
            vec3 c = base + o;
            // flutter: tumbling about two axes
            float a = t * (2.5 + iS.y * 3.), b = t * (1.7 + iS.z * 2.);
            vec3 p = position * (.06 + iS.y * .05);
            p = vec3(p.x * cos(a), p.y * cos(b) + p.x * sin(a) * .3, p.x * sin(a) + p.y * sin(b));
            vC = iC; vUv = position.xy;
            vec4 mvPosition = viewMatrix * vec4(c + p, 1.);
            gl_Position = projectionMatrix * mvPosition;
            #include <fog_vertex>
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uSunCol; varying vec3 vC; varying vec2 vUv;
          #include <fog_pars_fragment>
          void main() {
            if (abs(vUv.x) + abs(vUv.y) * 1.4 > .55) discard;   // a leaf's diamond
            gl_FragColor = vec4(vC * (.55 + .45 * uSunCol), 1.);
            #include <colorspace_fragment>
            #include <fog_fragment>
          }`,
      });
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.name = 'Drifting leaves'; m.userData.bake = false;
      group.add(m); parts.push(m);
    }

    // ---------------------------------------------------------------- dust and pollen motes
    if (on('motes')) {
      const n = Math.round(MOTES * Math.min(1.5, opts.motes ?? 1)), pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([Math.random(), Math.random(), Math.random()], i * 3);
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime, uCam, uSun, uSunCol, uPx: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */`
          uniform float uTime, uPx; uniform vec3 uCam, uSun; varying float vA;
          void main() {
            vec3 box = vec3(18., 5., 18.);
            vec3 o = position * box + vec3(sin(uTime * .2 + position.y * 30.) * .4, sin(uTime * .13 + position.x * 20.) * .3, uTime * .12);
            o.xz = mod(o.xz - (uCam.xz - box.xz * .5), box.xz);
            o.y = mod(o.y + uTime * .05, box.y);
            vec3 p = uCam - vec3(box.x * .5, 3., box.z * .5) + o;
            vec3 toCam = normalize(uCam - p);
            // they catch the light: brightest looking toward the sun (forward scatter)
            vA = .15 + .85 * pow(max(dot(-toCam, normalize(uSun)), 0.), 6.);
            vec4 mv = viewMatrix * vec4(p, 1.);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = clamp(2.4 * uPx * 6. / -mv.z, 1., 4.);
            vA *= smoothstep(1.5, 4., -mv.z) * (1. - smoothstep(9., 14., -mv.z));
          }`,
        fragmentShader: /* glsl */`
          uniform vec3 uSunCol; varying float vA;
          void main() { vec2 c = gl_PointCoord - .5; float a = (1. - smoothstep(.2, .5, length(c))) * vA * .55; gl_FragColor = vec4(uSunCol * a, 1.); }`,
      });
      const m = new THREE.Points(g, mat); m.frustumCulled = false; m.name = 'Dust motes'; m.userData.bake = false; m.renderOrder = 6;
      group.add(m); parts.push(m);
    }

    // ---------------------------------------------------------------- placement round the rider
    let lastPlace = -99, placedAt = null;
    const place = (t) => {
      const cam = world.camera.position, sd = world.sunDir || uSun.value;
      if (beams) {
        // trees up-sun of the road ahead, 15–80 m off: a beam from each crown down through the trunks, away from the sun
        const A = beams.geometry.attributes.iA, B = beams.geometry.attributes.iB, cands = [];
        for (const list of world.city?.forest?.tiles?.values() || []) for (const tr of list) {
          const dx = tr.x - cam.x, dz = tr.z - cam.z, d = Math.hypot(dx, dz);
          if (d < 15 || d > 85 || tr.sp === 'snag' || !tr.h || tr.h < 8) continue;
          cands.push(tr);
        }
        let k = 0;
        for (let q = 0; q < cands.length && k < BEAMS; q += Math.max(1, Math.floor(cands.length / BEAMS))) {
          const tr = cands[q], top = new THREE.Vector3(tr.x, tr.y + tr.h * .8, tr.z);
          A.setXYZW(k, top.x, top.y, top.z, tr.h * 1.8 + 6);
          B.setXYZW(k, 2 + Math.random() * 3.5, t, Math.random(), .6 + Math.random() * .6);
          k++;
        }
        beams.geometry.instanceCount = k; A.needsUpdate = true; B.needsUpdate = true;
      }
      if (mist && world.city?.landAt) {
        // the water and the wet ground near you
        const A = mist.geometry.attributes.iA, B = mist.geometry.attributes.iB, C = world.city;
        const wet = C.waterNear ? (x, z) => C.waterNear(x, z) : (x, z) => { const c = C.landAt(x, z); return c === 3 || c === 12; };   // (LAND.water, LAND.wetland)
        let k = 0;
        for (let tries = 0; tries < 160 && k < MIST; tries++) {
          const a = Math.random() * 6.283, r = 12 + Math.random() * 90, x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
          if (!wet(x, z)) continue;
          const y = Math.max(world.poolAt?.(x, z) ?? -1e9, world.surfaceH?.(x, z) ?? 0) + .35 + Math.random() * .5;
          A.setXYZW(k, x, y, z, 7 + Math.random() * 10); B.setXY(k, t, Math.random()); k++;
        }
        mist.geometry.instanceCount = k; A.needsUpdate = true; B.needsUpdate = true;
      }
      placedAt = cam.clone(); lastPlace = t;
    };

    return {
      tick(t) {
        uTime.value = t; uCam.value.copy(world.camera.position);
        if (world.sunDir) uSun.value.copy(world.sunDir);
        if (world.sun) uSunCol.value.copy(world.sun.color);
        // the beams only for a low sun (golden hour, morning), not at noon or at night
        const el = uSun.value.y;
        if (beams) beams.material.uniforms.uLow.value = THREE.MathUtils.smoothstep(el, -.02, .08) * (1 - THREE.MathUtils.smoothstep(el, .45, .7));
        if (!placedAt || placedAt.distanceTo(world.camera.position) > 35 || t - lastPlace > 20) place(t);
      },
      dispose() { for (const m of parts) { m.geometry.dispose(); m.material.dispose(); } group.removeFromParent(); },
    };
  },
};
