// GPU QC, run in the page on a built world (any of the preview pages: the world as `w`, THREE as `T`): one frame
// drawn and captured, its errors and costs counted, against the map's budget (tools/qc/budgets.json).
//
//   shaderErrors   programs that failed to compile or link (three.js reports them through renderer.debug)
//   glErrors       gl.getError() after the frame (anything but NO_ERROR)
//   overBudget     each of draw calls, triangles, geometries, textures, programs, heap MB over the map's budget
//
// With Spector there is also the frame's command list summed up: commands, draws, program / texture / buffer
// binds, uniforms, and the calls Spector finds redundant (status 30: setting state already set) — where the frame's
// cost goes. Without the bundle (npm install) the capture is skipped.
const SPECTOR_URL = '/node_modules/spectorjs/dist/spector.bundle.js';

async function loadSpector() {
  if (globalThis.SPECTOR) return globalThis.SPECTOR;
  await new Promise((ok) => { const s = document.createElement('script'); s.src = SPECTOR_URL; s.onload = ok; s.onerror = ok; document.head.appendChild(s); });
  return globalThis.SPECTOR || null;
}

const draw = (w) => (w._draw ? w._draw() : w._render ? w._render() : w.renderer.render(w.scene, w.camera));   // (the world's own frame: graph, route)

export async function runGpuQC(w, T, { budget = null, spector = true } = {}) {
  const r = w.renderer, gl = r.getContext(), out = { shaderErrors: 0, glErrors: 0, overBudget: 0 }, ex = {}, defects = [];
  const add = (k, note) => { out[k]++; (ex[k] ||= []).length < 6 && ex[k].push([note]); defects.push({ id: `${k}-${note.replace(/[^a-z0-9]+/gi, '').slice(0, 24).toLowerCase()}`, check: k, note }); };
  // shaders: every material in the scene compiled now, failures reported
  const prev = r.debug.onShaderError;
  r.debug.checkShaderErrors = true;
  r.debug.onShaderError = (glc, program, vs, fs) => { add('shaderErrors', (glc.getProgramInfoLog(program) || glc.getShaderInfoLog(fs) || glc.getShaderInfoLog(vs) || 'link failed').trim().slice(0, 160)); };
  try { r.compile(w.scene, w.camera); } catch (e) { add('shaderErrors', String(e.message || e).slice(0, 160)); }
  while (gl.getError() !== gl.NO_ERROR) { /* clear what came before */ }
  // the frame, plain: its GL errors and three.js's counts
  r.info.autoReset = false; r.info.reset();
  draw(w);
  for (let e = gl.getError(), k = 0; e !== gl.NO_ERROR && k < 8; e = gl.getError(), k++) add('glErrors', `0x${e.toString(16)}`);
  const i = r.info, stats = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length ?? 0, heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576) };
  // then again under Spector, for its command list (its own probing raises GL errors: not counted)
  let cap = null;
  const S = spector ? await loadSpector() : null;
  if (S) {
    const sp = new S.Spector();
    cap = await new Promise((ok) => {
      sp.onCapture.add((c) => ok(c)); sp.onError?.add?.(() => ok(null));
      // (on the world's own context; Spector ends a frame at requestAnimationFrame, so the draw goes in one)
      sp.captureContext(gl, 0, true);
      requestAnimationFrame(() => { draw(w); requestAnimationFrame(() => requestAnimationFrame(() => {})); });
      setTimeout(() => ok(null), 20000);
    });
    while (gl.getError() !== gl.NO_ERROR) { /* Spector's */ }
  }
  r.debug.onShaderError = prev;
  if (cap) {
    const cmds = cap.commands || [], names = (re) => cmds.filter((c) => re.test(c.name)).length;
    stats.capture = { commands: cmds.length, draws: names(/^draw/), programBinds: names(/^useProgram$/), textureBinds: names(/^bindTexture$/), bufferBinds: names(/^bind(Buffer|VertexArray)/), uniforms: names(/^uniform/), redundant: cmds.filter((c) => c.status === 30).length };
  }
  if (budget) for (const k of ['calls', 'triangles', 'geometries', 'textures', 'programs', 'heapMB']) if (budget[k] && stats[k] > budget[k]) add('overBudget', `${k} ${stats[k]} > ${budget[k]}`);
  return { counts: out, examples: ex, defects, gpu: stats };
}
