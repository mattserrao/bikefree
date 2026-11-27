#!/usr/bin/env node
// QC fixers: propose data patches for the defects the map QC finds, and with --apply, apply them, re-run the QC at the
// sites where those defects were, and keep a patch only if its defect is gone and nothing new appeared
// (user, 25 Nov: "Propose + verify" — fixers write data patches, apply only with --apply, re-run sites, keep only if
// improved and nothing broke).
//
//   node tools/qc_fix.mjs <map> [site …] [--sweep [600]] [--check viewBlocked]           propose only
//   node tools/qc_fix.mjs <map> [site …] --apply                                        apply, verify, keep or revert
//   npm run qc:fix -- nyc --apply
//
// Proposals → tools/.cache/qc/<map>/fix-proposals.json (each: the defect, the file, what changes, before → after), and the
// verdict of each with --apply → tools/.cache/qc/<map>/fix-verdicts.json.
//
// The fixers (FIXERS below) only touch map data, never code:
//   viewBlocked   trees between a landmark and the way it's seen from → a view corridor from that way spot to the
//                 landmark in its heroes file (`views`, trees kept `viewM` off the line: js/world/graph-city.js
//                 _landmarkClear — a landmark's corridors count with or without its own clearM)
// A defect no fixer knows is listed as unfixable, for a person (or a new fixer).
import { readFile, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sitesOf, runQC, qcOut } from './qc_map.mjs';
import { diffDefects } from './qc-defects.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const FIXERS = {
  /** A view corridor in the heroes file from the way spot to the landmark. */
  async viewBlocked(d, { map }) {
    if (!d.landmark || !d.from) return null;
    const net = JSON.parse(await readFile(resolve(ROOT, `routes/cities/${map}.json`), 'utf8'));
    if (!net.heroes) return null;
    const file = net.heroes, h = JSON.parse(await readFile(resolve(ROOT, file), 'utf8'));
    const l = (h.landmarks || []).find((q) => q.label === d.landmark);
    if (!l || !l.center) return null;
    const from = d.from.map((v) => +v.toFixed(6));
    if ((l.views || []).some(([a, o]) => Math.abs(a - from[0]) < 2e-5 && Math.abs(o - from[1]) < 2e-5)) return null;   // (already there: not this)
    const before = { views: l.views || null };
    const after = { views: [...(l.views || []), from] };
    return {
      id: d.id, check: d.check, file, landmark: d.landmark, before, after,
      why: `${d.note}: keep trees ${l.viewM || 3.5} m off the line from the way at ${from.join(',')} to ${d.landmark}`,
      apply: (json) => { const q = json.landmarks.find((x) => x.label === d.landmark); q.views = after.views; },
    };
  },
};

/** The proposals for a list of defects (one per defect a fixer knows), and the ones no fixer knows. */
export async function propose(map, defects, { only = null } = {}) {
  const props = [], unfixable = [];
  for (const d of defects) {
    if (only && d.check !== only) continue;
    const f = FIXERS[d.check], p = f ? await f(d, { map }) : null;
    (p ? props : unfixable).push(p || { id: d.id, check: d.check, note: d.note });
  }
  return { props, unfixable };
}

/** Writes proposals into their files (grouped per file); returns the backups. */
async function applyAll(props) {
  const byFile = new Map(); for (const p of props) (byFile.get(p.file) || byFile.set(p.file, []).get(p.file)).push(p);
  const backups = [];
  for (const [file, list] of byFile) {
    const path = resolve(ROOT, file), bak = `${path}.qcfix-bak`;
    await copyFile(path, bak); backups.push([path, bak]);
    const text = await readFile(path, 'utf8'), json = JSON.parse(text), ind = text.match(/^\{\n( +)/)?.[1].length || 0;
    for (const p of list) p.apply(json);
    await writeFile(path, `${JSON.stringify(json, null, ind)}\n`);   // (in the file's own indent)
  }
  return backups;
}
const restore = (backups) => Promise.all(backups.map(([path, bak]) => copyFile(bak, path)));

const defectsOf = (res) => { const m = new Map(); for (const [site, r] of Object.entries(res)) for (const d of r?.defects || []) if (!m.has(d.id)) m.set(d.id, { ...d, site }); return [...m.values()]; };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
  const flag = (k) => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
  const only = opt('--check', null), doApply = flag('--apply');
  const sI = args.indexOf('--sweep'); let sweep = 0; if (sI >= 0) { const v = +args[sI + 1]; sweep = v > 0 ? v : 600; args.splice(sI, v > 0 ? 2 : 1); }
  const map = args.shift();
  if (!map) { console.error('usage: node tools/qc_fix.mjs <map> [site …] [--sweep [m]] [--check <check>] [--apply]'); process.exit(2); }
  const out = qcOut(map); await mkdir(out, { recursive: true });
  let sites = await sitesOf(map, { sweep });
  if (args.length) sites = Object.fromEntries(args.map((n) => [n, sites[n]]).filter(([, v]) => v));
  const radius = sweep ? Math.round(sweep * 0.75) : 420;
  const res0 = await runQC(map, sites, { out, radius });
  const before = defectsOf(res0);
  const { props, unfixable } = await propose(map, before, { only });
  await writeFile(`${out}/fix-proposals.json`, JSON.stringify(props.map(({ apply, ...p }) => p), null, 1));
  console.log(`\n${before.length} defects · ${props.length} with a proposed fix · ${unfixable.length} with none`);
  for (const p of props) console.log(`  propose ${p.id}  ${p.file}  ${p.why}`);
  if (!doApply || !props.length) { if (props.length) console.log(`\n(proposals only: ${out}/fix-proposals.json — run again with --apply to apply and verify)`); process.exit(0); }
  // apply, re-run where the defects were, and judge
  const backups = await applyAll(props);
  const touched = Object.fromEntries([...new Set(before.filter((d) => props.some((p) => p.id === d.id)).map((d) => d.site))].map((n) => [n, sites[n]]));
  const res1 = await runQC(map, touched, { out: `${out}/verify`, radius });
  const after = defectsOf(res1), was = before.filter((d) => d.site in touched);
  const diff = diffDefects(was, after);
  const verdicts = props.map((p) => ({ id: p.id, file: p.file, fixed: diff.fixed.includes(p.id) }));
  if (diff.added.length || verdicts.every((v) => !v.fixed)) {
    await restore(backups);
    console.log(`\nreverted all: ${diff.added.length ? `${diff.added.length} new defects (${diff.added.slice(0, 5).join(', ')})` : 'nothing fixed'}`);
    for (const v of verdicts) v.kept = false;
  } else {
    // (keep what fixed its defect; put the rest back the way it was)
    const keep = props.filter((p) => verdicts.find((v) => v.id === p.id).fixed);
    await restore(backups); await applyAll(keep);
    for (const v of verdicts) v.kept = v.fixed;
    console.log(`\nkept ${keep.length} of ${props.length} (fixed: ${diff.fixed.length}, new: 0)`);
  }
  for (const [, bak] of backups) await import('node:fs/promises').then((f) => f.rm(bak, { force: true }));
  await writeFile(`${out}/fix-verdicts.json`, JSON.stringify({ verdicts, diff }, null, 1));
  for (const v of verdicts) console.log(`  ${v.kept ? 'kept    ' : 'reverted'} ${v.id}${v.fixed ? '' : ' (still there)'}`);
}
