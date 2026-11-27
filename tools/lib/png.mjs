// A small PNG reader for the browser tools' checks (code review 27 Nov 2026, wave 3): 8-bit greyscale / RGB / RGBA /
// grey+alpha, non-interlaced — what Chrome's canvas.toDataURL and page.screenshot write. No dependencies.
//
//   decodePng(buf)        { width, height, channels, data }   (data: Uint8Array, rows of width * channels bytes)
//   imageStats(buf)       { width, height, colours, lit, blank } colours: distinct RGBA values; lit: share of pixels
//                         that are not (near) black or fully transparent; blank: a still with nothing drawn in it
//
// The refactor guard (tools/toolbox_guard.mjs) refuses blank stills: until wave 3 every --fingerprint still was an
// empty canvas (the frame was read back after an await, once the browser had cleared the WebGL drawing buffer).
import { inflateSync } from 'node:zlib';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  let off = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off), kind = buf.toString('latin1', off + 4, off + 8), body = buf.subarray(off + 8, off + 8 + len);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; type = body[9]; interlace = body[12]; }
    else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    off += 12 + len;
  }
  const channels = CHANNELS[type];
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels, data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels] : 0, b = y ? data[row - stride + x] : 0, c = y && x >= channels ? data[row - stride + x - channels] : 0;
      let p;
      if (f === 0) p = 0; else if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else throw new Error(`bad PNG filter ${f}`);
      data[row + x] = (src[x] + p) & 255;
    }
  }
  return { width, height, channels, data };
}

export function imageStats(buf) {
  const { width, height, channels, data } = decodePng(buf);
  const seen = new Set();
  let lit = 0;
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i], g = channels >= 3 ? data[i + 1] : r, b = channels >= 3 ? data[i + 2] : r;
    const a = channels === 4 ? data[i + 3] : channels === 2 ? data[i + 1] : 255;
    seen.add(((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
    if (a > 0 && r + g + b > 24) lit++;
  }
  const n = width * height;
  return { width, height, colours: seen.size, lit: n ? lit / n : 0, blank: seen.size <= 2 || lit / n < 0.01 };
}

// The share of pixels whose RGB differs by more than `levels` in any channel (1 when the sizes differ): the graph
// maps' guard tolerance (was tools/png_diff.py, which needed numpy + Pillow and, on a bad path, printed nothing —
// read as 0 % changed).
export function pixelShare(bufA, bufB, levels = 32) {
  const a = decodePng(bufA), b = decodePng(bufB);
  if (a.width !== b.width || a.height !== b.height) return 1;
  const rgb = (img, i) => img.channels >= 3 ? [img.data[i * img.channels], img.data[i * img.channels + 1], img.data[i * img.channels + 2]] : [img.data[i * img.channels], img.data[i * img.channels], img.data[i * img.channels]];
  let off = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const p = rgb(a, i), q = rgb(b, i);
    if (Math.abs(p[0] - q[0]) > levels || Math.abs(p[1] - q[1]) > levels || Math.abs(p[2] - q[2]) > levels) off++;
  }
  return n ? off / n : 0;
}
