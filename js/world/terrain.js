// Streaming terrain: a quadtree of web-mercator tiles. Elevation from AWS Terrain Tiles
// (Terrarium encoding), ground texture from USGS National Map orthoimagery (NAIP).
// Tiles get finer near the camera; coarse parent tiles stay visible until their children load.
import * as THREE from '../../vendor/three.module.min.js';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat, terrarium, tileSizeM } from './geo.js';

const DEM_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const IMG_URL = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;

const ROOT_Z = 9;
const MAX_Z = 15;
const IMG_MAX_Z = 16;
const SPLIT = 1.0;            // split a tile when the camera is closer than SPLIT × its size
const CONCURRENCY = 6;
const KEEP_MS = 30000;        // unload tiles unused for this long
const ROAD_FLAT_M = 5.5;      // terrain is levelled to the road within this distance…
const ROAD_BLEND_M = 24;      // …and blended back to natural ground by this distance
const TREE_TILE_Z = 15;

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

async function loadBitmap(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return createImageBitmap(await res.blob());
}

function bitmapPixels(bmp, w = bmp.width, h = bmp.height) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

class Node {
  constructor(z, x, y, proj, parent = null) {
    this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.key = `${z}/${x}/${y}`;
    this.children = null;
    this.state = 'empty';       // empty | queued | loading | ready | error
    this.meshes = null;      // one mesh per quadrant (shared vertices)
    this.trees = null;
    this.heights = null;        // (S+1)² floats, after road levelling
    this.S = 0;
    this.lastUsed = 0;
    this.retryAt = 0;
    const nw = proj.toLocal(tileYToLat(y, z), tileXToLon(x, z));
    const se = proj.toLocal(tileYToLat(y + 1, z), tileXToLon(x + 1, z));
    this.minX = nw.x; this.maxX = se.x; this.minZ = nw.z; this.maxZ = se.z;
    this.size = Math.max(this.maxX - this.minX, this.maxZ - this.minZ);
  }

  distTo(x, z) {
    const dx = Math.max(this.minX - x, 0, x - this.maxX);
    const dz = Math.max(this.minZ - z, 0, z - this.maxZ);
    return Math.hypot(dx, dz);
  }
}

export class Terrain {
  /**
   * @param {THREE.Scene} scene
   * @param {{toLocal, toLatLon, lat0, lon0}} proj
   * @param {{nearest}} routeIndex
   * @param {{bbox:{minLat,maxLat,minLon,maxLon}, renderer:THREE.WebGLRenderer, onError?:Function}} opts
   */
  constructor(scene, proj, routeIndex, opts) {
    this.scene = scene;
    this.proj = proj;
    this.routeIndex = routeIndex;
    this.renderer = opts.renderer;
    this.onError = opts.onError || (() => {});
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.queue = [];
    this.active = 0;
    this.stats = { ready: 0, loading: 0, queued: 0, errors: 0 };
    this._imgErrors = 0;

    // Root tiles cover the route plus a wide margin for distant mountains.
    const pad = 0.3; // degrees (~25–35 km)
    const b = opts.bbox;
    const x0 = Math.floor(lonToTileX(b.minLon - pad, ROOT_Z)), x1 = Math.floor(lonToTileX(b.maxLon + pad, ROOT_Z));
    const y0 = Math.floor(latToTileY(b.maxLat + pad, ROOT_Z)), y1 = Math.floor(latToTileY(b.minLat - pad, ROOT_Z));
    this.roots = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.roots.push(new Node(ROOT_Z, x, y, proj));

    this.treeGeometry = makeTreeGeometry();
    this.treeMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
  }

  /** Choose which tiles to draw for a camera position; queue loads. Call every frame (it throttles itself). */
  update(cx, cz, now = performance.now()) {
    if (now - (this._lastSel || 0) < 150) { this._pump(); return; }
    this._lastSel = now;
    const request = (n, d, penalty = 0) => {
      n.lastUsed = now;
      n.priority = d + n.size * 0.08 + penalty;
      if (n.state === 'empty' || (n.state === 'error' && now > n.retryAt)) {
        n.state = 'queued';
        this.queue.push(n);
      }
    };
    // cover(n) → list of [tile, quadrant] pieces that together draw n's area, or null.
    // A ready tile can stand in for any child that isn't ready yet by drawing just that quadrant,
    // so new detail appears as soon as it arrives.
    const cover = (n) => {
      n.lastUsed = now;
      const d = n.distTo(cx, cz);
      const split = n.z < MAX_Z && d < n.size * (n.z >= 13 ? SPLIT : SPLIT * 0.7);
      if (split) {
        if (!n.children) {
          n.children = [];
          for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            n.children.push(new Node(n.z + 1, n.x * 2 + dx, n.y * 2 + dy, this.proj, n));
          }
        }
        const parts = n.children.map(cover);
        if (parts.every(Boolean)) return parts.flat();
        request(n, d);
        if (n.state !== 'ready') return null;
        return parts.flatMap((p, q) => p || [[n, q]]);
      }
      request(n, d);
      return n.state === 'ready' ? [0, 1, 2, 3].map((q) => [n, q]) : null;
    };
    const show = new Map(); // node → Set(quadrants)
    for (const r of this.roots) {
      for (const [n, q] of cover(r) || []) {
        if (!show.has(n)) show.set(n, new Set());
        show.get(n).add(q);
      }
    }

    // Show / hide meshes
    this._forEach((n) => {
      if (!n.meshes) return;
      const qs = show.get(n);
      n.meshes.forEach((m, q) => { m.visible = !!qs && qs.has(q); });
      if (n.trees) n.trees.visible = !!qs;
    });
    this._evict(now);
    this._pump();
    this.stats.queued = this.queue.length;
  }

  _forEach(fn) {
    const walk = (n) => { fn(n); if (n.children) n.children.forEach(walk); };
    this.roots.forEach(walk);
  }

  _evict(now) {
    const walk = (n) => {
      if (n.children) {
        n.children.forEach(walk);
        if (n.children.every((c) => (c.state === 'empty' || c.state === 'error') && !c.children && now - c.lastUsed > KEEP_MS)) {
          n.children = null;
        }
      }
      if (n.z > ROOT_Z && n.state === 'ready' && now - n.lastUsed > KEEP_MS) this._unload(n);
    };
    this.roots.forEach(walk);
  }

  _unload(n) {
    if (n.meshes) {
      for (const m of n.meshes) { this.group.remove(m); m.geometry.dispose(); }
      n.meshes[0].material.map?.dispose();
      n.meshes[0].material.dispose();
      n.meshes = null;
    }
    if (n.trees) { this.group.remove(n.trees); n.trees.dispose(); n.trees = null; }
    n.heights = null;
    n.state = 'empty';
    this.stats.ready--;
  }

  _pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      // Closest first; drop requests nobody has wanted for a while.
      this.queue.sort((a, b) => a.priority - b.priority);
      const n = this.queue.shift();
      if (performance.now() - n.lastUsed > 5000) { n.state = 'empty'; continue; }
      this.active++;
      this.stats.loading = this.active;
      n.state = 'loading';
      this._load(n)
        .then(() => { n.state = 'ready'; this.stats.ready++; })
        .catch((err) => {
          n.state = 'error';
          n.retryAt = performance.now() + 15000;
          this.stats.errors++;
          this.onError(err);
        })
        .finally(() => { this.active--; this.stats.loading = this.active; this._pump(); });
    }
  }

  async _load(n) {
    const demZ = Math.min(n.z, 15);
    const imgZ = n.z >= 14 ? Math.min(n.z + 1, IMG_MAX_Z) : n.z;
    const f = 2 ** (imgZ - n.z);
    const imgTiles = [];
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) imgTiles.push([n.x * f + i, n.y * f + j, i, j]);

    const [dem, imgs] = await Promise.all([
      loadBitmap(DEM_URL(demZ, n.x, n.y)),
      Promise.all(imgTiles.map(([x, y]) => loadBitmap(IMG_URL(imgZ, x, y)).catch(() => null))),
    ]);

    // Elevation pixels
    const px = bitmapPixels(dem, 256, 256);
    const demAt = (u, v) => { // u,v in pixel space (0..256), bilinear
      const fx = Math.min(255, Math.max(0, u - 0.5)), fy = Math.min(255, Math.max(0, v - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const h = (x, y) => { const o = (y * 256 + x) * 4; return terrarium(px[o], px[o + 1], px[o + 2]); };
      return h(x0, y0) * (1 - ax) * (1 - ay) + h(x1, y0) * ax * (1 - ay) + h(x0, y1) * (1 - ax) * ay + h(x1, y1) * ax * ay;
    };

    // Imagery canvas
    const ts = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ts * f;
    const ctx = canvas.getContext('2d', { willReadFrequently: n.z >= TREE_TILE_Z });
    ctx.fillStyle = '#6f7a58';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let gotImagery = false;
    for (let k = 0; k < imgTiles.length; k++) {
      if (imgs[k]) { ctx.drawImage(imgs[k], imgTiles[k][2] * ts, imgTiles[k][3] * ts); gotImagery = true; }
    }
    if (!gotImagery && this._imgErrors++ < 3) this.onError(new Error('Aerial imagery unavailable for some tiles'));

    // Geometry
    const S = n.z >= 15 ? 128 : n.z >= 11 ? 64 : 48;
    const N = S + 1;
    const heights = new Float32Array(N * N);
    const positions = new Float32Array((N * N + 4 * N) * 3);
    const uvs = new Float32Array((N * N + 4 * N) * 2);
    const carve = n.z >= 14;
    let minH = Infinity;
    for (let j = 0; j < N; j++) {
      const lat = tileYToLat(n.y + j / S, n.z);
      for (let i = 0; i < N; i++) {
        const lon = tileXToLon(n.x + i / S, n.z);
        const p = this.proj.toLocal(lat, lon);
        let h = demAt((i / S) * 256, (j / S) * 256);
        if (carve) {
          const hit = this.routeIndex.nearest(p.x, p.z, ROAD_BLEND_M);
          if (hit) h = hit.ele - 0.35 + (h - (hit.ele - 0.35)) * smoothstep(ROAD_FLAT_M, ROAD_BLEND_M, hit.d);
        }
        const k = j * N + i;
        heights[k] = h;
        minH = Math.min(minH, h);
        positions[k * 3] = p.x; positions[k * 3 + 1] = h; positions[k * 3 + 2] = p.z;
        uvs[k * 2] = i / S; uvs[k * 2 + 1] = 1 - j / S;
      }
    }
    // Skirts hide cracks between neighbouring tiles of different detail.
    const skirt = Math.max(8, n.size * 0.015);
    const edges = [];
    for (let i = 0; i < N; i++) edges.push(i);                 // top
    for (let i = 0; i < N; i++) edges.push((N - 1) * N + i);   // bottom
    for (let j = 0; j < N; j++) edges.push(j * N);             // left
    for (let j = 0; j < N; j++) edges.push(j * N + N - 1);     // right
    edges.forEach((src, e) => {
      const k = N * N + e;
      positions[k * 3] = positions[src * 3];
      positions[k * 3 + 1] = positions[src * 3 + 1] - skirt;
      positions[k * 3 + 2] = positions[src * 3 + 2];
      uvs[k * 2] = uvs[src * 2]; uvs[k * 2 + 1] = uvs[src * 2 + 1];
    });
    const H = S / 2;
    const gridIdx = [];
    const quad = [[], [], [], []]; // quadrant index lists, same order as the children
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
        gridIdx.push(a, c, b, b, c, d);
        quad[(j >= H ? 2 : 0) + (i >= H ? 1 : 0)].push(a, c, b, b, c, d);
      }
    }
    const strip = (base, dir, qa, qb) => {
      for (let t = 0; t < S; t++) {
        const s0 = edges[base + t], s1 = edges[base + t + 1];
        const k0 = N * N + base + t, k1 = k0 + 1;
        const out = quad[t < H ? qa : qb];
        if (dir) out.push(s0, k0, s1, s1, k0, k1); else out.push(s0, s1, k0, s1, k1, k0);
      }
    };
    strip(0, false, 0, 1); strip(N, true, 2, 3); strip(2 * N, true, 0, 2); strip(3 * N, false, 1, 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    // Normals from the ground only (so skirts don't darken tile edges), then add the skirts.
    geo.setIndex(gridIdx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal.array;
    edges.forEach((src, e) => {
      const k = N * N + e;
      nrm[k * 3] = nrm[src * 3]; nrm[k * 3 + 1] = nrm[src * 3 + 1]; nrm[k * 3 + 2] = nrm[src * 3 + 2];
    });
    geo.computeBoundingSphere();

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
    n.meshes = quad.map((ix) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'uv', 'normal']) g.setAttribute(name, geo.attributes[name]);
      g.setIndex(ix);
      g.boundingSphere = geo.boundingSphere;
      const mesh = new THREE.Mesh(g, mat);
      mesh.visible = false;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      return mesh;
    });
    geo.setIndex(null);
    n.heights = heights;
    n.S = S;

    if (n.z >= TREE_TILE_Z && gotImagery) n.trees = this._makeTrees(n, ctx, canvas.width);
    if (n.trees) { n.trees.visible = false; this.group.add(n.trees); }
  }

  /** Scatter trees where the aerial photo looks like forest, away from the road. */
  _makeTrees(n, ctx, W) {
    const data = ctx.getImageData(0, 0, W, W).data;
    const rand = mulberry32(n.x * 73856093 ^ n.y * 19349663);
    const CANDIDATES = 2200;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const mats = [], cols = [];
    const color = new THREE.Color();
    for (let c = 0; c < CANDIDATES; c++) {
      const u = rand(), v = rand();
      const o = (Math.floor(v * W) * W + Math.floor(u * W)) * 4;
      const r = data[o], g = data[o + 1], b = data[o + 2];
      const sum = r + g + b;
      // Forest in NAIP natural colour: darkish, green-leaning, not blue (water) and not bare/grass.
      const forest = sum > 60 && sum < 270 && g > r + 6 && g > b + 3 && r < 105;
      if (!forest) continue;
      const lat = tileYToLat(n.y + v, n.z), lon = tileXToLon(n.x + u, n.z);
      const pos = this.proj.toLocal(lat, lon);
      const near = this.routeIndex.nearest(pos.x, pos.z, 10);
      if (near) continue;
      const h = sampleHeights(n, u, v);
      const height = 9 + rand() * 15;
      const width = height * (0.32 + rand() * 0.12);
      p.set(pos.x, h - 0.4, pos.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
      s.set(width, height, width);
      mats.push(m.compose(p, q, s).clone());
      const shade = 0.75 + rand() * 0.4;
      cols.push(color.setRGB(0.55 * shade, 0.8 * shade, 0.5 * shade).clone());
    }
    if (!mats.length) return null;
    const inst = new THREE.InstancedMesh(this.treeGeometry, this.treeMaterial, mats.length);
    mats.forEach((mm, i) => { inst.setMatrixAt(i, mm); inst.setColorAt(i, cols[i]); });
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    return inst;
  }

  /** Ground height at a local position from the finest loaded tile (or null). */
  heightAt(x, z) {
    const { lat, lon } = this.proj.toLatLon(x, z);
    let best = null;
    const walk = (n) => {
      const tx = lonToTileX(lon, n.z) - n.x, ty = latToTileY(lat, n.z) - n.y;
      if (tx < 0 || tx > 1 || ty < 0 || ty > 1) return;
      if (n.state === 'ready' && n.heights) best = { n, tx, ty };
      if (n.children) n.children.forEach(walk);
    };
    this.roots.forEach(walk);
    return best ? sampleHeights(best.n, best.tx, best.ty) : null;
  }

  get loadingCount() { return this.active + this.queue.length; }

  dispose() {
    this._forEach((n) => { if (n.state === 'ready') this._unload(n); });
    this.scene.remove(this.group);
    this.treeGeometry.dispose();
    this.treeMaterial.dispose();
    this.queue = [];
  }
}

function sampleHeights(n, u, v) {
  const S = n.S, N = S + 1;
  const fx = Math.min(S, Math.max(0, u * S)), fy = Math.min(S, Math.max(0, v * S));
  const x0 = Math.min(S - 1, Math.floor(fx)), y0 = Math.min(S - 1, Math.floor(fy));
  const ax = fx - x0, ay = fy - y0;
  const H = n.heights;
  const a = H[y0 * N + x0], b = H[y0 * N + x0 + 1], c = H[(y0 + 1) * N + x0], d = H[(y0 + 1) * N + x0 + 1];
  return a * (1 - ax) * (1 - ay) + b * ax * (1 - ay) + c * (1 - ax) * ay + d * ax * ay;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A low-poly conifer (unit height) with vertex colours: brown trunk, two green tiers. */
function makeTreeGeometry() {
  const parts = [
    [new THREE.CylinderGeometry(0.035, 0.05, 0.25, 5), 0.125, [0.36, 0.25, 0.16]],
    [new THREE.ConeGeometry(0.5, 0.55, 7), 0.45, [0.16, 0.32, 0.17]],
    [new THREE.ConeGeometry(0.36, 0.45, 7), 0.75, [0.19, 0.37, 0.19]],
  ];
  const pos = [], nor = [], col = [];
  for (const [g0, y, c] of parts) {
    const g = g0.toNonIndexed();
    g.translate(0, y, 0);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(...c);
    g0.dispose(); g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export { tileSizeM };
