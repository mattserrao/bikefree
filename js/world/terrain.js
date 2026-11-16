// Streaming terrain: a quadtree of web-mercator tiles. Elevation from AWS Terrain Tiles
// (Terrarium encoding), ground texture from USGS National Map orthoimagery (NAIP).
// Tiles get finer near the camera; coarse parent tiles stay visible until their children load.
import * as THREE from '../../vendor/three.module.min.js';
import {
  lonToTileX, latToTileY, tileXToLon, tileYToLat, terrarium, tileSizeM,
  DEM_URL, IMG_URL, ROOT_Z, MAX_Z, IMG_MAX_Z, SPLIT, ROOT_PAD_DEG, splitDistance,
} from './geo.js';

const CONCURRENCY = 6;
const KEEP_MS = 30000;        // unload tiles unused for this long
const ROAD_FLAT_M = 5.5;      // terrain is levelled to the road within this distance…
const ROAD_BLEND_M = 24;      // …and blended back to natural ground by this distance
const TREE_TILE_Z = 15;
const NODATA_M = -1000;       // Terrain Tiles "no data" is −32768 m

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
    // Far-background mode (v0.11.2): behind a stylized route, draw only beyond `inner` metres,
    // without trees, colour-matched to the route's palette. The stylized scenery covers the near ground.
    this.far = opts.far || null;
    // Wireframe mode (new routes before scenery): no aerial photos, no trees or water; the real ground
    // as a dark fill with contour and grid lines (scene.wire: colours and spacings)
    this.wire = opts.wire || null;
    this.maxZ = this.far ? Math.min(MAX_Z, this.far.maxZ ?? 14) : MAX_Z;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);
    this.queue = [];
    this.active = 0;
    this.stats = { ready: 0, loading: 0, queued: 0, errors: 0 };
    this._imgErrors = 0;

    // Root tiles cover the route plus a wide margin for distant mountains.
    const pad = ROOT_PAD_DEG;
    const b = opts.bbox;
    const x0 = Math.floor(lonToTileX(b.minLon - pad, ROOT_Z)), x1 = Math.floor(lonToTileX(b.maxLon + pad, ROOT_Z));
    const y0 = Math.floor(latToTileY(b.maxLat + pad, ROOT_Z)), y1 = Math.floor(latToTileY(b.minLat - pad, ROOT_Z));
    this.roots = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.roots.push(new Node(ROOT_Z, x, y, proj));

    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    // Shared shader inputs (the world updates sun/sky/time each frame)
    this.uniforms = {
      uDetail: { value: makeDetailTexture(this.maxAniso) },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSkyTop: { value: new THREE.Color('#3f7fd0') },
      uSkyHorizon: { value: new THREE.Color('#c6dbef') },
      // x inner radius (m), y blend band (m), z on (0/1), w tint amount
      uFar: { value: new THREE.Vector4(this.far?.inner ?? 1500, this.far?.band ?? 400, 0, this.far?.tint ? (this.far.amount ?? 0.35) : 0) },
      uFarTint: { value: new THREE.Color(this.far?.tint || '#808080') },
      uFarRock: { value: new THREE.Color(this.far?.rock || this.far?.tint || '#8a7a6a') },
    };
    this.assets = this.wire ? {} : makeScatterAssets();
    if (this.wire) this.wireMaterial = makeWireMaterial(this.wire);
    // Eastern forests (Acadia) are mostly broadleaf; the western parks are conifer country.
    this.broadleafShare = proj.lon0 > -95 ? 0.6 : 0.06;
  }

  /** Choose which tiles to draw for a camera position; queue loads. Call every frame (it throttles itself). */
  update(cx, cz, now = performance.now()) {
    if (now - (this._lastSel || 0) < 150) { this._pump(); return; }
    this._lastSel = now;
    const request = (n, d, penalty = 0) => {
      n.lastUsed = now;
      n.priority = d + n.size * 0.08 + penalty;
      // far-background mode switches on only once the base tiles are in, so fetch those first
      if (this.far && n.z === ROOT_Z) n.priority = -1e9;
      if (n.state === 'empty' || (n.state === 'error' && now > n.retryAt)) {
        n.state = 'queued';
        this.queue.push(n);
      }
    };
    // cover(n) → list of [tile, quadrant] pieces that together draw n's area, or null.
    // A ready tile can stand in for any child that isn't ready yet by drawing just that quadrant,
    // so new detail appears as soon as it arrives.
    const hidden = this.far ? Math.max(0, this.far.inner - this.far.band) : 0;
    const cover = (n) => {
      n.lastUsed = now;
      // far mode: ground inside the hand-off ring is covered by stylized scenery, so treat it as ring-distance away
      const d = Math.max(n.distTo(cx, cz), hidden);
      const split = n.z < this.maxZ && d < splitDistance(n.z, n.size);
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
      if (n.meshes[0].material !== this.wireMaterial) {   // the wireframe material is shared by every tile
        n.meshes[0].material.map?.dispose();
        n.meshes[0].material.dispose();
      }
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
    // (tileUrls() above lists the same URLs for offline downloads)
    const imgTiles = [];
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) imgTiles.push([n.x * f + i, n.y * f + j, i, j]);

    const [dem, imgs] = await Promise.all([
      loadBitmap(DEM_URL(demZ, n.x, n.y)),
      this.wire ? [] : Promise.all(imgTiles.map(([x, y]) => loadBitmap(IMG_URL(imgZ, x, y)).catch(() => null))),
    ]);

    // Elevation pixels
    const px = bitmapPixels(dem, 256, 256);
    // Terrain Tiles has holes: whole tiles of "no data" (−32768 m), e.g. z14 near Valbonnais (Alpe d'Huez
    // stage). Fill them from the coarser parent tile, which has the ground.
    let parent = null;
    for (let o = 0; o < px.length; o += 4) {
      if (terrarium(px[o], px[o + 1], px[o + 2]) > NODATA_M) continue;
      if (demZ > ROOT_Z) {
        try { parent = bitmapPixels(await loadBitmap(DEM_URL(demZ - 1, n.x >> 1, n.y >> 1)), 256, 256); } catch { parent = null; }
      }
      break;
    }
    const ox = (n.x & 1) * 128, oy = (n.y & 1) * 128;
    const demAt = (u, v) => { // u,v in pixel space (0..256), bilinear
      const fx = Math.min(255, Math.max(0, u - 0.5)), fy = Math.min(255, Math.max(0, v - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const h = (x, y) => {
        const o = (y * 256 + x) * 4, e = terrarium(px[o], px[o + 1], px[o + 2]);
        if (e > NODATA_M || !parent) return e;
        const q = (Math.min(255, oy + (y >> 1)) * 256 + Math.min(255, ox + (x >> 1))) * 4;
        return terrarium(parent[q], parent[q + 1], parent[q + 2]);
      };
      return h(x0, y0) * (1 - ax) * (1 - ay) + h(x1, y0) * ax * (1 - ay) + h(x0, y1) * (1 - ax) * ay + h(x1, y1) * ax * ay;
    };

    // Imagery canvas (none in wireframe mode)
    const ts = 256;
    const canvas = this.wire ? null : document.createElement('canvas');
    let gotImagery = false, ctx = null;
    if (canvas) {
      canvas.width = canvas.height = ts * f;
      ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#6f7a58';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let k = 0; k < imgTiles.length; k++) {
        if (imgs[k]) { ctx.drawImage(imgs[k], imgTiles[k][2] * ts, imgTiles[k][3] * ts); gotImagery = true; }
      }
      if (!gotImagery && this._imgErrors++ < 3) this.onError(new Error('Aerial imagery unavailable for some tiles'));
    }

    // Geometry
    const S = n.z >= 15 ? 128 : n.z >= 11 ? 64 : 48;
    const N = S + 1;
    const heights = new Float32Array(N * N);
    const raw = new Float32Array(N * N);
    const water = new Float32Array(N * N + 4 * N);
    const W = canvas ? canvas.width : 0;
    const img = gotImagery && n.z >= 11 ? ctx.getImageData(0, 0, W, W).data : null;
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
        raw[j * N + i] = h;
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
    // Water: perfectly flat elevation (lakes are hydro-flattened in the DEM; the sea is 0 m)
    // where the aerial photo is dark/blue. Smoothed so shorelines blend.
    if (img) {
      const flat = new Uint8Array(N * N);
      const cl = (v) => Math.min(N - 1, Math.max(0, v));
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const k = j * N + i, h0 = raw[k];
          let range = 0;
          for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) range = Math.max(range, Math.abs(raw[cl(j + dj) * N + cl(i + di)] - h0));
          if (range > 0.12) continue; // lakes are hydro-flattened in the DEM; the sea is exactly 0 m
          // average a few photo pixels around the vertex
          let r = 0, g = 0, b = 0;
          for (const [du, dv] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const px = (Math.min(W - 1, Math.max(0, Math.floor((j / S) * W) + dv * 2)) * W + Math.min(W - 1, Math.max(0, Math.floor((i / S) * W) + du * 2))) * 4;
            r += img[px]; g += img[px + 1]; b += img[px + 2];
          }
          if (b > g * 0.95 && b > r * 1.08 && r + g + b < 5 * 330) flat[k] = 1;
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          let sum = 0, c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const jj = j + dj, ii = i + di;
            if (jj < 0 || ii < 0 || jj >= N || ii >= N) continue;
            sum += flat[jj * N + ii]; c++;
          }
          water[j * N + i] = sum / c;
        }
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
      water[k] = water[src];
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
    geo.setAttribute('water', new THREE.BufferAttribute(water, 1));
    // Normals from the ground only (so skirts don't darken tile edges), then add the skirts.
    geo.setIndex(gridIdx);
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal.array;
    edges.forEach((src, e) => {
      const k = N * N + e;
      nrm[k * 3] = nrm[src * 3]; nrm[k * 3 + 1] = nrm[src * 3 + 1]; nrm[k * 3 + 2] = nrm[src * 3 + 2];
    });
    geo.computeBoundingSphere();

    let mat = this.wireMaterial;
    if (!mat) {
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = this.maxAniso;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      mat = makeGroundMaterial(tex, this.uniforms);
    }
    n.meshes = quad.map((ix) => {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'uv', 'normal', 'water']) g.setAttribute(name, geo.attributes[name]);
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

    if (n.z >= TREE_TILE_Z && gotImagery && !this.far) n.trees = this._makeScatter(n, img, canvas.width);
    if (n.trees) { n.trees.visible = false; this.group.add(n.trees); }
  }

  /**
   * Scatter things on a near tile, guided by the aerial photo:
   * conifers and broadleaf trees where it shows forest; grass, shrubs and rocks along the road elsewhere.
   */
  _makeScatter(n, data, W) {
    const rand = mulberry32((n.x * 73856093) ^ (n.y * 19349663));
    const A = this.assets;
    const lists = { conifer: [], broadleaf: [], grass: [], shrub: [], rock: [] };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const pixel = (u, v) => {
      const o = (Math.min(W - 1, Math.floor(v * W)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
      return [data[o], data[o + 1], data[o + 2]];
    };
    const isForest = (r, g, b) => { const s = r + g + b; return s > 60 && s < 270 && g > r + 6 && g > b + 3 && r < 105; };
    const isWater = (r, g, b) => b >= g * 0.85 && b >= r && r + g + b < 330;
    const add = (list, x, z, y, scale, rot, col, tilt = 0) => {
      p.set(x, y, z);
      q.setFromAxisAngle(up, rot);
      if (tilt) q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt * (rand() - 0.5), 0, tilt * (rand() - 0.5))));
      sc.copy(scale);
      list.push([m.compose(p, q, sc).clone(), col]);
    };
    const local = (u, v) => this.proj.toLocal(tileYToLat(n.y + v, n.z), tileXToLon(n.x + u, n.z));
    const toUV = (x, z) => {
      const ll = this.proj.toLatLon(x, z);
      return [lonToTileX(ll.lon, n.z) - n.x, latToTileY(ll.lat, n.z) - n.y];
    };

    // Trees across the whole tile
    for (let c = 0; c < 2600; c++) {
      const u = rand(), v = rand();
      const [r, g, b] = pixel(u, v);
      if (!isForest(r, g, b)) continue;
      const pos = local(u, v);
      if (this.routeIndex.nearest(pos.x, pos.z, 9)) continue;
      const h = sampleHeights(n, u, v);
      const broad = rand() < this.broadleafShare && (g - r > 18 || r + g + b > 150);
      const height = broad ? 7 + rand() * 9 : 9 + rand() * 15;
      const width = broad ? height * (0.55 + rand() * 0.2) : height * (0.32 + rand() * 0.12);
      const shade = 0.75 + rand() * 0.4;
      const col = broad ? new THREE.Color(0.5 * shade, 0.75 * shade, 0.38 * shade) : new THREE.Color(0.55 * shade, 0.8 * shade, 0.5 * shade);
      add(broad ? lists.broadleaf : lists.conifer, pos.x, pos.z, h - 0.4, new THREE.Vector3(width, height, width), rand() * 6.28, col);
    }

    // Ground cover along the road (only where the road crosses this tile)
    const idx = this.routeIndex;
    for (let i = 0; i < idx.xs.length; i += 1) {
      const x0 = idx.xs[i], z0 = idx.zs[i];
      if (x0 < n.minX || x0 > n.maxX || z0 < n.minZ || z0 > n.maxZ) continue;
      const i2 = Math.min(idx.xs.length - 1, i + 1);
      let fx = idx.xs[i2] - x0, fz = idx.zs[i2] - z0;
      const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
      for (let k = 0; k < 14; k++) {
        const side = rand() < 0.5 ? -1 : 1;
        const off = 4.8 + Math.pow(rand(), 1.6) * 45;
        const along = (rand() - 0.5) * 10;
        const x = x0 + fx * along - fz * off * side, z = z0 + fz * along + fx * off * side;
        const [u, v] = toUV(x, z);
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        const near = this.routeIndex.nearest(x, z, 6);
        if (near && near.d < 4.6) continue;
        const [r, g, b] = pixel(u, v);
        if (isForest(r, g, b) && off > 9) continue; // trees already there
        if (isWater(r, g, b)) continue;
        const h = sampleHeights(n, u, v);
        const sum = r + g + b;
        const grey = Math.abs(r - g) < 22 && Math.abs(g - b) < 28;
        const tint = new THREE.Color(r / 255, g / 255, b / 255).convertSRGBToLinear();
        const roll = rand();
        if (grey && sum > 470 && roll < 0.015) {
          const s0 = 0.25 + rand() * 0.9;
          add(lists.rock, x, z, h - s0 * 0.25, new THREE.Vector3(s0 * (1 + rand() * 0.6), s0 * 0.7, s0), rand() * 6.28,
            new THREE.Color().setScalar(0.32 + rand() * 0.25), 0.6);
        } else if ((grey && sum > 230) || roll < 0.18) {
          // sagebrush / low shrubs: sage green, a little of the photo's colour
          const s0 = 0.3 + rand() * 0.45;
          add(lists.shrub, x, z, h - 0.08, new THREE.Vector3(s0 * 1.3, s0 * 0.8, s0 * 1.3), rand() * 6.28,
            new THREE.Color(0.2, 0.26, 0.17).lerp(tint, 0.3).multiplyScalar(0.8 + rand() * 0.4));
        } else {
          for (let t = 0; t < 3; t++) {
            const s0 = 0.8 + rand() * 0.9;
            add(lists.grass, x + (rand() - 0.5) * 1.6, z + (rand() - 0.5) * 1.6, h - 0.05, new THREE.Vector3(s0, s0 * (0.8 + rand() * 0.7), s0),
              rand() * 6.28, tint.clone().multiplyScalar(1.3 + rand() * 0.5).lerp(new THREE.Color(0.42, 0.5, 0.2), 0.45), 0.25);
          }
        }
      }
    }

    const group = new THREE.Group();
    for (const [key, list] of Object.entries(lists)) {
      if (!list.length) continue;
      const inst = new THREE.InstancedMesh(A[key].geometry, A[key].material, list.length);
      list.forEach(([mm, col], i) => { inst.setMatrixAt(i, mm); inst.setColorAt(i, col); });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    group.dispose = () => group.children.forEach((c) => c.dispose());
    return group.children.length ? group : null;
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

  /** Far-background mode: true once the base tiles cover the whole area (so the blend never shows holes). */
  get covered() { return this.roots.every((r) => r.state === 'ready'); }

  dispose() {
    this._forEach((n) => { if (n.state === 'ready') this._unload(n); });
    this.scene.remove(this.group);
    for (const a of Object.values(this.assets)) { a.geometry.dispose(); a.material.map?.dispose(); a.material.dispose(); }
    this.uniforms.uDetail.value.dispose();
    this.wireMaterial?.dispose();
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

/** Ground material: aerial photo + colour grading + close-up detail + water. */
/**
 * Wireframe ground (scene.wire): a dark fill with contour lines (every `contourM`, brighter every
 * `majorContourM`) and a map grid (every `gridM`) drawn in the shader, so the lines are the same on every
 * tile and detail level. Lines thinner than a pixel fade out instead of shimmering. Fog still applies.
 */
function makeWireMaterial(wire) {
  const mat = new THREE.MeshBasicMaterial({ color: wire.ground || '#111c30', side: THREE.DoubleSide, toneMapped: false });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLine = { value: new THREE.Color(wire.line || '#3d8bfd') };
    shader.uniforms.uWire = { value: new THREE.Vector3(wire.contourM || 50, wire.majorContourM || 250, wire.gridM || 100) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWirePos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWirePos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLine; uniform vec3 uWire; varying vec3 vWirePos;
        // anti-aliased line every 1 unit of f, about px pixels wide; faded where lines crowd under ~3 px apart
        float wireLine(float f, float px) {
          float w = fwidth(f);
          float d = abs(fract(f - 0.5) - 0.5) / max(w, 1e-5);
          return (1.0 - smoothstep(px * 0.5, px * 0.5 + 1.0, d)) * (1.0 - smoothstep(0.12, 0.35, w));
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // relief: light the fill from the north-west so the landform reads between the lines
          vec3 nrm = normalize(cross(dFdx(vWirePos), dFdy(vWirePos)));
          if (nrm.y < 0.0) nrm = -nrm;
          float shade = 0.55 + 0.45 * max(dot(nrm, normalize(vec3(-0.5, 0.8, -0.35))), 0.0);
          vec3 c = diffuseColor.rgb * shade;
          // fine lines (a fifth of the contour interval, a quarter of the grid) show close up and
          // fade out by themselves with distance, so the mesh stays even from the bike to the far ridges
          float fine = wireLine(vWirePos.y / (uWire.x * 0.2), 1.0);
          float minor = wireLine(vWirePos.y / uWire.x, 1.2);
          float major = wireLine(vWirePos.y / uWire.y, 1.8);
          float gridFine = max(wireLine(vWirePos.x / (uWire.z * 0.25), 1.0), wireLine(vWirePos.z / (uWire.z * 0.25), 1.0));
          float grid = max(wireLine(vWirePos.x / uWire.z, 1.0), wireLine(vWirePos.z / uWire.z, 1.0));
          c = mix(c, uLine * 0.45, gridFine * 0.3);
          c = mix(c, uLine * 0.55, max(grid * 0.5, fine * 0.35));
          c = mix(c, uLine * 0.85, minor * 0.8);
          c = mix(c, uLine * 1.25, major);
          diffuseColor.rgb = c;
        }`);
  };
  return mat;
}

function makeGroundMaterial(tex, uniforms) {
  const mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float water;\nvarying float vWater;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\nuniform vec4 uFar;')
      // far background sits a touch lower so the stylized ground wins where the two coincide in the blend band
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (uFar.z > 0.5) transformed.y -= 3.0;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWater = water;\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uDetail; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon;
        uniform vec4 uFar; uniform vec3 uFarTint; uniform vec3 uFarRock;
        varying float vWater; varying vec3 vWorldPos; varying vec3 vWorldNormal;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        if (uFar.z > 0.5) {
          // Far background: dithered hand-off with the stylized ground (it uses the complementary pattern).
          float farD = length(vWorldPos.xz - cameraPosition.xz);
          // solid from the start of the blend band: the stylized ground dithers away on top of it,
          // so every pixel always has ground behind it (no gaps where the two heights differ)
          if (farD < uFar.x - uFar.y * 0.5) discard;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          // colour grade: aerial photos are flat and hazy
          vec3 c = diffuseColor.rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(l), c, 1.32);                      // saturation
          c = (c - 0.18) * 1.08 + 0.18;                   // contrast around mid-grey (linear)
          c *= vec3(1.04, 1.02, 0.95);                    // slightly warmer
          // close-up detail so the ground isn't a smear near the camera
          float dist = length(vWorldPos - cameraPosition);
          float n0 = texture2D(uDetail, vWorldPos.xz / 0.9).r;
          float n1 = texture2D(uDetail, vWorldPos.xz / 3.1).g;
          float n2 = texture2D(uDetail, vWorldPos.xz / 11.0).r;
          float n3 = texture2D(uDetail, vWorldPos.xz / 47.0).b;
          float nearF = 1.0 - smoothstep(25.0, 260.0, dist);
          float midF = 1.0 - smoothstep(150.0, 1500.0, dist);
          float land = 1.0 - vWater;
          // fine grain close up, broader mottling further out
          c *= mix(1.0, 0.62 + 0.76 * (n0 * 0.55 + n1 * 0.45), nearF * land);
          c *= mix(1.0, 0.8 + 0.4 * (n2 * 0.6 + n3 * 0.4), midF * land);
          // steep ground reads as rock
          float steep = 1.0 - smoothstep(0.62, 0.86, vWorldNormal.y);
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(c, vec3(lum) * vec3(1.05, 1.0, 0.95) * (0.85 + 0.3 * n1), steep * 0.55 * land);
          if (uFar.w > 0.0) {
            // colour-match the photos to the stylized palette: keep their light and shade, borrow its hue
            vec3 lw = vec3(0.2126, 0.7152, 0.0722);
            float pl = dot(c, lw);
            vec3 tinted = uFarTint * (pl / max(dot(uFarTint, lw), 0.02));
            c = mix(c, tinted, uFar.w * land);
            c = mix(vec3(dot(c, lw)), c, 0.82);
            // aerial photos smear down cliff faces: paint steep real ground in the route's own rock colour
            float farSteep = 1.0 - smoothstep(0.45, 0.8, vWorldNormal.y);
            float strata = 0.5 + 0.5 * sin(vWorldPos.y * 0.22 + n3 * 3.0);
            c = mix(c, uFarRock * (0.8 + 0.25 * n2 + 0.12 * strata), farSteep * 0.85 * land);
          }
          diffuseColor.rgb = max(c, 0.0);
        }`)
      .replace('#include <opaque_fragment>', `
        if (vWater > 0.02) {
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec2 wp = vWorldPos.xz;
          float a = texture2D(uDetail, wp / 31.0 + vec2(uTime * 0.011, uTime * 0.007)).r;
          float b = texture2D(uDetail, wp / 17.0 - vec2(uTime * 0.009, -uTime * 0.013)).g;
          vec3 N = normalize(vec3((a - 0.5) * 0.22, 1.0, (b - 0.5) * 0.22));
          vec3 R = reflect(-V, N);
          vec3 sky = mix(uSkyHorizon, uSkyTop, pow(clamp(R.y, 0.0, 1.0), 0.5));
          float fres = 0.04 + 0.96 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
          vec3 deep = diffuseColor.rgb * 0.55 + vec3(0.004, 0.018, 0.03);
          vec3 waterCol = mix(deep, sky, clamp(fres * 1.15, 0.0, 1.0));
          waterCol += vec3(1.0, 0.95, 0.85) * pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0) * 2.5;
          outgoingLight = mix(outgoingLight, waterCol, smoothstep(0.15, 0.85, vWater));
        }
        #include <opaque_fragment>`)
      // far background: lift the shaded sides so real cliffs sit with the softly lit stylized foreground
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uFar.z > 0.5) totalEmissiveRadiance += diffuseColor.rgb * 0.22;');
  };
  return mat;
}

/** Tileable multi-octave noise in three channels (fine / medium / coarse). */
function makeDetailTexture(aniso) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  const rand = mulberry32(1234);
  const grid = (g) => { const a = new Float32Array(g * g); for (let i = 0; i < a.length; i++) a[i] = rand(); return a; };
  const noise = (x, y, g, arr) => {
    const fx = (x / S) * g, fy = (y / S) * g;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const v = (i, j) => arr[((j % g) * g) + (i % g)];
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (v(x0, y0) * (1 - sx) + v(x0 + 1, y0) * sx) * (1 - sy) + (v(x0, y0 + 1) * (1 - sx) + v(x0 + 1, y0 + 1) * sx) * sy;
  };
  const octs = [[8, grid(8)], [16, grid(16)], [32, grid(32)], [64, grid(64)], [128, grid(128)]];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const o = octs.map(([g, a]) => noise(x, y, g, a));
      const f = (w) => o.reduce((acc, v, i) => acc + v * w[i], 0) / w.reduce((a, b) => a + b, 0);
      const k = (y * S + x) * 4;
      img.data[k] = f([0.1, 0.2, 0.3, 0.6, 0.8]) * 255;
      img.data[k + 1] = f([0.3, 0.5, 0.6, 0.4, 0.2]) * 255;
      img.data[k + 2] = f([1, 0.7, 0.4, 0.2, 0.1]) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

function mergeParts(parts) {
  const pos = [], nor = [], col = [], uv = [];
  for (const [g0, mtx, c] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    g.applyMatrix4(mtx);
    pos.push(...g.attributes.position.array);
    nor.push(...g.attributes.normal.array);
    if (g.attributes.uv) uv.push(...g.attributes.uv.array);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(...c);
    g0.dispose(); g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (uv.length) geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

/** Geometry + materials for everything scattered on the ground. */
function makeScatterAssets() {
  const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
  const conifer = mergeParts([
    [new THREE.CylinderGeometry(0.035, 0.05, 0.25, 5), T(0, 0.125, 0), [0.36, 0.25, 0.16]],
    [new THREE.ConeGeometry(0.5, 0.42, 8), T(0, 0.38, 0), [0.15, 0.3, 0.16]],
    [new THREE.ConeGeometry(0.4, 0.38, 8), T(0, 0.6, 0), [0.17, 0.34, 0.18]],
    [new THREE.ConeGeometry(0.27, 0.34, 8), T(0, 0.82, 0), [0.19, 0.38, 0.2]],
  ]);
  const crown = new THREE.IcosahedronGeometry(0.42, 1);
  crown.scale(1, 0.85, 1);
  const crown2 = new THREE.IcosahedronGeometry(0.3, 1);
  const broadleaf = mergeParts([
    [new THREE.CylinderGeometry(0.04, 0.06, 0.45, 6), T(0, 0.225, 0), [0.33, 0.24, 0.16]],
    [crown, T(0, 0.62, 0), [0.24, 0.42, 0.18]],
    [crown2, T(0.18, 0.75, 0.08), [0.28, 0.47, 0.2]],
    [crown2.clone(), T(-0.16, 0.7, -0.1), [0.22, 0.4, 0.17]],
  ]);
  const shrub = mergeParts([
    [new THREE.IcosahedronGeometry(0.42, 1), T(0, 0.3, 0), [1, 1, 1]],
    [new THREE.IcosahedronGeometry(0.3, 1), T(0.3, 0.22, 0.12), [0.9, 0.95, 0.9]],
    [new THREE.IcosahedronGeometry(0.28, 1), T(-0.26, 0.2, -0.15), [1.05, 1.05, 1]],
  ]);
  const rockG = new THREE.DodecahedronGeometry(0.5, 0);
  rockG.translate(0, 0.25, 0);
  const rock = mergeParts([[rockG, new THREE.Matrix4(), [1, 1, 1]]]);

  // Grass tuft: three crossed cards with an alpha-tested blade texture
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const rand = mulberry32(99);
  for (let i = 0; i < 46; i++) {
    const x = 6 + rand() * 52, h = 22 + rand() * 40, lean = (rand() - 0.5) * 16;
    const g = 150 + rand() * 90;
    ctx.strokeStyle = `rgb(${g * 0.85},${g},${g * 0.6})`;
    ctx.lineWidth = 1.2 + rand() * 1.6;
    ctx.beginPath(); ctx.moveTo(x, 64); ctx.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h); ctx.stroke();
  }
  const gTex = new THREE.CanvasTexture(c);
  gTex.colorSpace = THREE.SRGBColorSpace;
  const cards = [];
  for (let k = 0; k < 3; k++) {
    const pl = new THREE.PlaneGeometry(1, 0.6);
    pl.translate(0, 0.3, 0);
    cards.push([pl, new THREE.Matrix4().makeRotationY((k * Math.PI) / 3), [1, 1, 1]]);
  }
  const grass = mergeParts(cards);
  // point all grass normals up so the cards light like the ground
  const gn = grass.attributes.normal.array;
  for (let i = 0; i < gn.length; i += 3) { gn[i] = 0; gn[i + 1] = 1; gn[i + 2] = 0; }

  const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
  return {
    conifer: { geometry: conifer, material: lam() },
    broadleaf: { geometry: broadleaf, material: lam() },
    shrub: { geometry: shrub, material: lam({ flatShading: true }) },
    rock: { geometry: rock, material: lam({ flatShading: true }) },
    grass: { geometry: grass, material: lam({ map: gTex, alphaTest: 0.45, side: THREE.DoubleSide }) },
  };
}

export { tileSizeM };
