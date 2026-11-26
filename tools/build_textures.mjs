#!/usr/bin/env node
// The texture build (fidelity plan, step 3): every surface set in textures/src (tools/make_pbr_sets.py, or photo-sourced
// CC0 sets dropped in under the same names) encoded to KTX2 with Basis Universal, so it stays compressed on the GPU:
//   <set>-albedo.png  → textures/ktx2/<set>-albedo.ktx2   ETC1S (small download; colour)
//   <set>-nra.png     → textures/ktx2/<set>-nra.ktx2      UASTC + zstd + RDO at 512 px (normals don't survive ETC1S)
// Phones get the 512 px level: each file is encoded at 1024 px with mipmaps, and the loader skips the top level on Phone.
// Writes textures/ktx2/manifest.json: per set, its files' bytes and GPU bytes; the maps' "assets.textures" lists name
// sets from it, and the test (test/textures.test.mjs) holds every map under MAP_TEXTURE_MB.
//   node tools/build_textures.mjs [set …]       (all sets when none named)
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeToKTX2 } from 'ktx2-encoder';
import { execFileSync } from 'node:child_process';

// (the encoder wants raw RGBA in Node: Pillow decodes the PNG — the PBR sets' generator needs it anyway)
const imageDecoder = async (_buf, path, size = 0) => {
  const raw = execFileSync('python3', ['-c', 'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGBA");n=int(sys.argv[2]);im=im.resize((n,n),Image.LANCZOS) if n else im;sys.stdout.buffer.write(im.size[0].to_bytes(4,"little")+im.size[1].to_bytes(4,"little")+im.tobytes())', path, String(size)], { maxBuffer: 1 << 28 });
  return { width: raw.readUInt32LE(0), height: raw.readUInt32LE(4), data: new Uint8Array(raw.buffer, raw.byteOffset + 8, raw.length - 8) };
};

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'textures/src'), OUT = join(ROOT, 'textures/ktx2');
await mkdir(OUT, { recursive: true });
const want = process.argv.slice(2);
const files = (await readdir(SRC)).filter((f) => /-(albedo|nra)\.png$/.test(f)).filter((f) => !want.length || want.some((s) => f.startsWith(`${s}-`)));
let manifest = {};
try { manifest = JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8')); } catch { /* first build */ }
for (const f of files.sort()) {
  const [, set, kind] = f.match(/^(.*)-(albedo|nra)\.png$/);
  const png = new Uint8Array(await readFile(join(SRC, f)));
  const t0 = Date.now();
  // (the normal/roughness/AO map at 512 px: its detail is fine-scale relief, and it's the heavy file — UASTC)
  const decode = (b) => imageDecoder(b, join(SRC, f), kind === 'nra' ? 512 : 0);
  const ktx = await encodeToKTX2(png, kind === 'albedo'
    ? { imageDecoder: decode, isUASTC: false, qualityLevel: 160, compressionLevel: 2, generateMipmap: true, isSetKTX2SRGBTransferFunc: true, isPerceptual: true }
    : { imageDecoder: decode, isUASTC: true, needSupercompression: true, uastcLDRQualityLevel: 2, enableRDO: true, rdoQualityLevel: 2, generateMipmap: true, isSetKTX2SRGBTransferFunc: false, isPerceptual: false, isNormalMap: false });
  const name = `${set}-${kind}.ktx2`;
  await writeFile(join(OUT, name), ktx);
  // GPU bytes: both carry alpha (albedo: height; nra: AO), so both transcode to 8 bpp (BC3/BC7/ETC2-RGBA/ASTC 4×4):
  // 1 byte a texel at 1024², × 4/3 for the mips
  const side = kind === 'nra' ? 512 : 1024, gpu = Math.round(side * side * 4 / 3);
  ((manifest[set] ||= {}))[kind] = { file: `textures/ktx2/${name}`, bytes: ktx.byteLength, gpuBytes: gpu };
  console.log(`${name.padEnd(30)} ${(ktx.byteLength / 1024).toFixed(0).padStart(6)} KB  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
const total = Object.values(manifest).flatMap((s) => Object.values(s)).reduce((a, x) => a + x.bytes, 0);
console.log(`${Object.keys(manifest).length} sets, ${(total / 1048576).toFixed(1)} MB in all`);
