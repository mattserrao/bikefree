// Binary container for the baked real-terrain grids ("bikefree-terrain-grid-1", tools/build_terrain_grid.py).
// The grids used to ship as JSON with the height rows as base64 strings; the container keeps the same JSON
// header but stores those rows as raw bytes, so the file is a quarter smaller and loads without a big
// JSON string parse and base64 decode:
//
//   "BFTG"  uint32 header length (LE)  header JSON (utf-8)  padding to 4 bytes  row bytes…
//
// and the file ships gzipped (<id>-terrain.grid.bin.gz): GitHub Pages compresses JSON but not binary, so
// the app inflates it itself (DecompressionStream). The download is ~12% smaller than the gzipped JSON.
//
// In the header, each `h` string becomes {"$bin": [offset, length]} (offsets from the start of the row bytes).
// Pure JS (no three.js, no DOM): used by the app, the QC tools and the tests.

const MAGIC = 'BFTG';
const BINARY_FIELDS = ['coarse', 'fine', 'landcover'];   // their `h` rows (landcover: the places container, tools/build_places.py)

const isGzip = (b) => b[0] === 0x1f && b[1] === 0x8b;

/** Fetched bytes (gzipped or not, if the server already inflated them) → the grid object. */
export async function loadTerrainGrid(buffer) {
  let bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (isGzip(bytes)) bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  return parseTerrainGrid(bytes);
}

/** Container bytes (not gzipped) → the grid object, with `coarse.h` / `fine.h` as Uint8Arrays. */
export function parseTerrainGrid(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (isGzip(bytes)) throw new Error('Gzipped terrain grid: inflate it first (loadTerrainGrid, or zlib.gunzipSync in Node)');
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== MAGIC) throw new Error('Not a terrain grid container');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + length)));
  const start = 8 + length + ((4 - ((8 + length) % 4)) % 4);
  for (const key of BINARY_FIELDS) {
    const bin = header[key]?.h?.$bin;
    if (bin) header[key].h = bytes.subarray(start + bin[0], start + bin[0] + bin[1]);
  }
  return header;
}

/** The grid object (with base64 `h` strings) → container bytes (gzip them to ship). */
export function packTerrainGrid(grid) {
  const header = structuredClone(grid), blobs = [];
  let offset = 0;
  for (const key of BINARY_FIELDS) {
    const h = header[key]?.h;
    if (typeof h !== 'string') continue;
    const raw = base64ToBytes(h);
    header[key].h = { $bin: [offset, raw.length] };
    blobs.push(raw); offset += raw.length;
  }
  const json = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 - ((8 + json.length) % 4)) % 4;
  const out = new Uint8Array(8 + json.length + pad + offset);
  out.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(out.buffer).setUint32(4, json.length, true);
  out.set(json, 8);
  let at = 8 + json.length + pad;
  for (const b of blobs) { out.set(b, at); at += b.length; }
  return out;
}

function base64ToBytes(text) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(text, 'base64'));
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
