// Route preview pictures in the menu (PLAN 6.8): 2–3 small pictures along the selected route — its start, its
// highlight and a climb or a second highlight — pre-rendered from the 3D world by tools/build_previews.mjs into
// routes/previews/ (480×270 WebP) with a manifest, routes/previews/index.json:
//   { format: 'bikefree-previews-1', size, images, bytes, routes: { <routeId>: [{ file, caption, role, atM, v }] } }
// routeId: a park route's catalog id, a network preset's id, a network's free ride `<network id>-free`.
// Offline: the manifest is precached with the app (sw-assets.js); the pictures are cached the first time they're
// shown, in their own cache that survives app updates (sw.js, PREVIEW_CACHE) — `v` (the file's hash) in the URL
// makes a re-rendered picture a new cache entry.

export const PREVIEW_DIR = 'routes/previews/';
export const PREVIEW_INDEX = `${PREVIEW_DIR}index.json`;

/** A route's pictures in riding order, each with its URL and its caption split into the role word and the place. */
export function previewShots(manifest, routeId) {
  const list = manifest?.format === 'bikefree-previews-1' ? manifest.routes?.[routeId] : null;
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s.file === 'string' && /^[a-z0-9-]+\.webp$/.test(s.file))
    .sort((a, b) => (a.atM ?? 0) - (b.atM ?? 0))
    .map((s) => {
      const [word, ...rest] = String(s.caption || '').split(' · ');
      return { ...s, url: `${PREVIEW_DIR}${s.file}${s.v ? `?v=${s.v}` : ''}`, word: word || 'Along the route', place: rest.join(' · ') };
    });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The strip of pictures for the preview pane (buttons: a tap enlarges). Lazy: the browser loads them when shown. */
export function shotsHtml(shots) {
  return shots.map((s, i) => `<figure class="shot"><button type="button" class="shot-img" data-shot="${i}" aria-label="Enlarge: ${esc(s.caption)}">` +
    `<img src="${esc(s.url)}" alt="${esc(s.caption)}" width="480" height="270" loading="lazy" decoding="async"></button>` +
    `<figcaption><b>${esc(s.word)}</b>${s.place ? ` <span>${esc(s.place)}</span>` : ''}</figcaption></figure>`).join('');
}

/**
 * Drops pictures no longer in the manifest from the preview cache (re-rendered ones get a new `?v=`), so it holds
 * one copy of each. Runs in the page (the Cache API is there too); a no-op without it.
 */
export async function prunePreviewCache(manifest, cacheName = 'bikefree-previews-v1') {
  if (typeof caches === 'undefined' || !manifest?.routes) return 0;
  const keep = new Set(Object.values(manifest.routes).flat().map((s) => `${PREVIEW_DIR}${s.file}${s.v ? `?v=${s.v}` : ''}`));
  const c = await caches.open(cacheName);
  let n = 0;
  for (const req of await c.keys()) {
    const u = new URL(req.url);
    if (!keep.has(u.pathname.replace(/^.*?(routes\/previews\/)/, '$1') + u.search)) { await c.delete(req); n++; }
  }
  return n;
}
