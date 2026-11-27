// The browser tools' shared harness (code review 27 Nov 2026, P9): the static file server and the Chrome finder that
// 23 tools (snap_*, qc_clipping, perf_*, *_check, build_previews, bench, …) each had a copy of.
//
//   const srv = await serve(ROOT, opts)       a static server on 127.0.0.1 (a free port): srv.base, srv.server, srv.close()
//     opts.index        the file for a folder ("index.html")
//     opts.types        extra / different MIME types by extension ({ '.gz': 'application/gzip' })
//     opts.transform    (path, body, req) => body: change a file on the way out (bench.mjs: a map's effects)
//     opts.onMissing    (path) => void: called on each 404 (snap_pgh: SNAP_DEBUG)
//     opts.gzip         serve text gzipped (Accept-Encoding) with ETag / 304, as GitHub Pages does (menu_load.mjs)
//     opts.cacheControl a Cache-Control header for every file
//     opts.port, opts.host
//   resolvePath(root, url)                    the file a request names, or null (a bad escape, a NUL, outside root)
//   findChrome(explicit)                      explicit, else $CHROME, $CHROME_PATH, else the first installed Chrome
//   launchChrome({ chrome, args, ...rest })   playwright-core's chromium.launch with that Chrome
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.gpx': 'application/gpx+xml', '.xml': 'application/xml', '.txt': 'text/plain', '.md': 'text/plain',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.ktx2': 'image/ktx2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream', '.gz': 'application/octet-stream',
};
const TEXT = new Set(['.html', '.js', '.mjs', '.json', '.css', '.gpx', '.svg', '.xml', '.txt']);

export function resolvePath(root, url) {
  let p;
  try { p = decodeURIComponent(new URL(url, 'http://x').pathname); } catch { return null; }
  if (p.includes('\0')) return null;
  const base = resolve(root);
  const abs = resolve(base, normalize(p).replace(/^([/\\])+/, ''));
  return abs === base || abs.startsWith(base + sep) ? abs : null;
}

export async function serve(root, opts = {}) {
  const { index = 'index.html', types = {}, transform = null, onMissing = null, gzip = false, cacheControl = null, port = 0, host = '127.0.0.1' } = opts;
  const mime = { ...MIME, ...types };
  const base = resolve(root);
  const memo = new Map();   // (gzip: the compressed body and etag per file, until it changes)
  const server = createServer(async (req, res) => {
    let file = resolvePath(base, req.url);
    if (!file) { res.writeHead(403).end(); return; }
    const rel = file === base ? '' : file.slice(base.length + 1);
    try {
      let st = await stat(file);
      if (st.isDirectory()) { file = join(file, index); st = await stat(file); }
      const ext = extname(file);
      const head = { 'content-type': mime[ext] || 'application/octet-stream', ...(cacheControl ? { 'cache-control': cacheControl } : {}) };
      if (gzip) {
        let m = memo.get(file);
        if (!m || m.mtime !== st.mtimeMs) {
          let body = await readFile(file);
          if (transform) body = await transform(rel, body, req);
          m = { mtime: st.mtimeMs, body, gz: TEXT.has(ext) ? gzipSync(body, { level: 6 }) : null, etag: `"${createHash('md5').update(body).digest('hex')}"` };
          memo.set(file, m);
        }
        head.etag = m.etag;
        if (req.headers['if-none-match'] === m.etag) { res.writeHead(304, head).end(); return; }
        if (m.gz && /gzip/.test(req.headers['accept-encoding'] || '')) res.writeHead(200, { ...head, 'content-encoding': 'gzip' }).end(m.gz);
        else res.writeHead(200, head).end(m.body);
        return;
      }
      let body = await readFile(file);
      if (transform) body = await transform(rel, body, req);
      res.writeHead(200, head).end(body);
    } catch {
      if (onMissing) onMissing(rel);
      res.writeHead(404).end();
    }
  });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, host, ok); });
  const url = `http://${host}:${server.address().port}`;
  return { server, base: url, port: server.address().port, close: () => new Promise((ok) => { server.closeAllConnections?.(); server.close(() => ok()); }) };
}

export const CHROMES = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium', '/usr/bin/chromium-browser'];

export function findChrome(explicit, { env = process.env, exists = existsSync } = {}) {
  return explicit || env.CHROME || env.CHROME_PATH || CHROMES.find((p) => exists(p));
}

export async function launchChrome({ chrome, args = [], ...rest } = {}) {
  const { chromium } = await import('playwright-core');
  const executablePath = findChrome(chrome);
  return chromium.launch({ ...(executablePath ? { executablePath } : {}), args, ...rest });
}
