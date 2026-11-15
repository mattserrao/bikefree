// Offline park downloads: work out every terrain/imagery tile the 3D world will load along
// a route, and store them in the browser's cache (the service worker serves them offline).
import {
  ROOT_Z, MAX_Z, ROOT_PAD_DEG, splitDistance, tileUrls, makeProjection,
  lonToTileX, latToTileY, tileXToLon, tileYToLat,
} from './world/geo.js';

export const TILE_CACHE = 'bikefree-tiles-v1';
const STATUS_KEY = 'bikefree.offline.v1';

/**
 * Tiles the 3D view needs to ride a route, mirroring the live level-of-detail rules:
 * every tile visited by the quadtree from camera positions every `stepM` metres.
 * @returns {string[]} keys "z/x/y"
 */
export function planRouteTiles(route, stepM = 120) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (let i = 0; i < route.lat.length; i++) {
    minLat = Math.min(minLat, route.lat[i]); maxLat = Math.max(maxLat, route.lat[i]);
    minLon = Math.min(minLon, route.lon[i]); maxLon = Math.max(maxLon, route.lon[i]);
  }
  const proj = makeProjection((minLat + maxLat) / 2, (minLon + maxLon) / 2);
  const pad = ROOT_PAD_DEG;
  const x0 = Math.floor(lonToTileX(minLon - pad, ROOT_Z)), x1 = Math.floor(lonToTileX(maxLon + pad, ROOT_Z));
  const y0 = Math.floor(latToTileY(maxLat + pad, ROOT_Z)), y1 = Math.floor(latToTileY(minLat - pad, ROOT_Z));
  const bounds = new Map();
  const bound = (z, x, y) => {
    const k = `${z}/${x}/${y}`;
    let b = bounds.get(k);
    if (!b) {
      const nw = proj.toLocal(tileYToLat(y, z), tileXToLon(x, z));
      const se = proj.toLocal(tileYToLat(y + 1, z), tileXToLon(x + 1, z));
      b = { minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z, size: Math.max(se.x - nw.x, se.z - nw.z) };
      bounds.set(k, b);
    }
    return [k, b];
  };
  const keys = new Set();
  const visit = (z, x, y, cx, cz) => {
    const [k, b] = bound(z, x, y);
    keys.add(k);
    const d = Math.hypot(Math.max(b.minX - cx, 0, cx - b.maxX), Math.max(b.minZ - cz, 0, cz - b.maxZ));
    if (z < MAX_Z && d < splitDistance(z, b.size)) {
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) visit(z + 1, x * 2 + dx, y * 2 + dy, cx, cz);
    }
  };
  const step = Math.max(1, Math.round(stepM / 10));
  for (let i = 0; i < route.lat.length; i += step) {
    const p = proj.toLocal(route.lat[i], route.lon[i]);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) visit(ROOT_Z, x, y, p.x, p.z);
  }
  return [...keys];
}

/** All URLs for a list of tile keys. */
export function tileKeysToUrls(keys) {
  const urls = [];
  for (const k of keys) {
    const [z, x, y] = k.split('/').map(Number);
    urls.push(...tileUrls(z, x, y));
  }
  return urls;
}

/**
 * Download URLs into the tile cache, skipping ones already cached.
 * @param {string[]} urls
 * @param {(p:{done:number,total:number,bytes:number,failed:number})=>void} onProgress
 * @param {AbortSignal} [signal]
 */
export async function downloadUrls(urls, onProgress, signal) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0, bytes = 0, failed = 0, i = 0;
  const total = urls.length;
  const worker = async () => {
    while (i < urls.length) {
      if (signal?.aborted) return;
      const url = urls[i++];
      try {
        const hit = await cache.match(url);
        if (hit) {
          bytes += Number(hit.headers.get('content-length')) || 0;
        } else {
          const res = await fetch(url, { mode: 'cors', signal });
          if (res.ok) {
            const blob = await res.clone().blob();
            bytes += blob.size;
            await cache.put(url, res);
          } else if (res.status !== 404) {
            failed++;
          }
        }
      } catch (err) {
        if (signal?.aborted) return;
        failed++;
      }
      done++;
      if (done % 10 === 0 || done === total) onProgress({ done, total, bytes, failed });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { done, total, bytes, failed };
}

export function offlineStatus(id) {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY) || '{}')[id] || null; } catch { return null; }
}

export function setOfflineStatus(id, value) {
  try {
    const all = JSON.parse(localStorage.getItem(STATUS_KEY) || '{}');
    if (value) all[id] = value; else delete all[id];
    localStorage.setItem(STATUS_KEY, JSON.stringify(all));
  } catch { /* storage unavailable */ }
}

export function registerServiceWorker(log) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' }).catch((err) => log?.('app', `Offline support unavailable: ${err.message}`, 'debug'));
}
