#!/usr/bin/env node
// Convert a baked terrain grid from JSON (base64 rows) to the binary container (js/terrain-grid.js).
//   node tools/pack_terrain_grid.mjs routes/scenes/<id>-terrain.json   → routes/scenes/<id>-terrain.grid.bin.gz
// tools/build_terrain_grid.py writes the container itself; this converts older JSON grids.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { packTerrainGrid, parseTerrainGrid } from '../js/terrain-grid.js';

for (const path of process.argv.slice(2)) {
  const grid = JSON.parse(readFileSync(path, 'utf8'));
  const bytes = packTerrainGrid(grid);
  const out = path.replace(/\.json$/, '.grid.bin.gz');
  // round trip: the rows must come back byte for byte
  const back = parseTerrainGrid(bytes);
  for (const key of ['coarse', 'fine']) if (Buffer.from(back[key].h).toString('base64') !== grid[key].h) throw new Error(`${path}: ${key} rows differ after packing`);
  const gz = gzipSync(bytes, { level: 9 });
  writeFileSync(out, gz);
  console.log(`${path} (${(readFileSync(path).length / 1e6).toFixed(2)} MB, ${(gzipSync(readFileSync(path)).length / 1e6).toFixed(2)} MB gzipped) → ${out} (${(gz.length / 1e6).toFixed(2)} MB)`);
}
