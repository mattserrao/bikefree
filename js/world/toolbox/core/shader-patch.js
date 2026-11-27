// Toolbox core: patching three.js's built-in shaders (onBeforeCompile) at a named anchor, loudly.
// [review 27 Nov] A plain String.replace whose anchor isn't there does nothing, and the patch is silently lost: the
// street slot bias sat under a define r187 renamed; the bake's sun line and the vista kit's shadow line are exact lines
// of lights_fragment_begin that a three.js update can reword. patchShader throws instead, so the shader tests
// (test/shader-anchors.test.mjs) and the first compile show it at once.

/**
 * src with code put at the first occurrence of anchor: where 'after' (the default: anchor, then code), 'before' (code,
 * then anchor) or 'replace' (code in its place). Throws when src has no anchor.
 */
export function patchShader(src, anchor, code, where = 'after') {
  const i = src.indexOf(anchor);
  if (i < 0) throw new Error(`patchShader: anchor not found: ${anchor.length > 90 ? `${anchor.slice(0, 90)}…` : anchor}`);
  const put = where === 'after' ? `${anchor}\n${code}` : where === 'before' ? `${code}\n${anchor}` : where === 'replace' ? code : null;
  if (put == null) throw new Error(`patchShader: where must be after, before or replace (got ${where})`);
  return src.slice(0, i) + put + src.slice(i + anchor.length);
}
