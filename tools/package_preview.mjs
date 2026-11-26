// Package the actual Big Sur WebGL preview as one HTML file that opens locally.
// Blob modules preserve Three.js module identity; embedded fetch responses keep
// GPX, scenery and the animated rider available without a server or network.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node tools/package_preview.mjs /path/to/bikefree-preview.html');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const walk = (dir) => readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((p) => p.isDirectory() ? walk(`${dir}/${p.name}`) : [`${dir}/${p.name}`]);
let html = read('tools/world-preview.html');
const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
const entry = match[1].replace("registerServiceWorker((...args) => console.log(...args));", '');
const catalog = JSON.parse(read('routes/parks/index.json')).filter((p) => p.id === 'bigsur');
const scene = JSON.parse(read(catalog[0].scene));
const paths = [...walk('js').filter((p) => p.endsWith('.js')), 'vendor/three.js', 'vendor/three.module.min.js',
  'models/rider.json', catalog[0].file, catalog[0].scene, scene.assets];
const files = Object.fromEntries(paths.map((p) => [`/${p}`, read(p)]));
files['/routes/parks/index.json'] = JSON.stringify(catalog);
files['/tools/preview-entry.js'] = entry;
const data = JSON.stringify(files).replace(/</g, '\\u003c');
const bootstrap = `
const embeddedFiles = ${data};
const virtualOrigin = 'https://bikefree.local';
window.fetch = async (input) => {
 const url = new URL(input?.url || String(input), virtualOrigin);
 const text = embeddedFiles[url.pathname];
 if (text === undefined) return new Response('Not included in this preview', {status:404});
 const type = url.pathname.endsWith('.json') ? 'application/json' : url.pathname.endsWith('.gpx') ? 'application/gpx+xml' : 'text/javascript';
 return new Response(text, {headers:{'Content-Type':type}});
};
const compiledModules = new Map();
function compileModule(path) {
 if (compiledModules.has(path)) return compiledModules.get(path);
 let source = embeddedFiles[path];
 if (source === undefined) throw new Error('Missing preview module: ' + path);
 source = source.replace(/import\\.meta\\.url/g, JSON.stringify(virtualOrigin + path));
 source = source.replace(/(\\bfrom\\s*|\\bimport\\s*)(['"])([^'"]+)\\2/g, (all, prefix, quote, specifier) => {
  if (!specifier.startsWith('.')) return all;
  const dependency = new URL(specifier, virtualOrigin + path).pathname;
  return prefix + JSON.stringify(compileModule(dependency));
 });
 const url = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
 compiledModules.set(path, url); return url;
}
import(compileModule('/tools/preview-entry.js')).catch((error) => {
 document.getElementById('status').textContent = 'Could not start the preview';
 const panel = document.getElementById('error'); panel.hidden = false; panel.textContent = error.message;
});
`;
// A function replacement preserves literal '$&' sequences in vendored code.
html = html.replace(match[0], () => `<script>${bootstrap}</script>`);
writeFileSync(resolve(destination), html);
console.log(`Standalone Big Sur preview → ${destination} (${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB)`);
