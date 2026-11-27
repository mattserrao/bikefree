#!/usr/bin/env python3
"""A blind A/B sheet for riders (user, 27 Nov 2026: "judge from outside"): each matched view's before and after renders
side by side, in an order drawn at random and kept out of the sheet, with the real photo of the place underneath for
reference. A rider picks, for each pair, the one that looks more like the place (or "same"); the page shows a short
answer string to send back. The key goes to a separate file.

  python3 tools/reference/ab_sheet.py <before-shots.json> <after-shots.json> --out sheet.html --key key.json [--seed N]
"""
import argparse, base64, io, json, os, random
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ap = argparse.ArgumentParser()
ap.add_argument('before'); ap.add_argument('after'); ap.add_argument('--out', required=True); ap.add_argument('--key', required=True)
ap.add_argument('--seed', type=int, default=None); ap.add_argument('--width', type=int, default=720)
a = ap.parse_args()


def jpg(path, w):
    im = Image.open(path).convert('RGB'); im = im.resize((w, round(w * im.height / im.width)), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=84); return 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()


B = {s['photo']: s for s in json.load(open(a.before))}; A = {s['photo']: s for s in json.load(open(a.after))}
rng = random.Random(a.seed)
pairs, key = [], []
for i, photo in enumerate(sorted(set(B) & set(A))):
    if not (os.path.exists(B[photo]['render']) and os.path.exists(A[photo]['render'])): continue
    flip = rng.random() < .5
    left, right = (A, B) if flip else (B, A)
    ref = os.path.join(ROOT, 'tools', '.cache', 'ref', A[photo]['map'], photo)
    v = A[photo]['view']
    pairs.append({'n': len(pairs) + 1, 'a': jpg(left[photo]['render'], a.width), 'b': jpg(right[photo]['render'], a.width),
                  'ref': jpg(ref, a.width // 2) if os.path.exists(ref) else None,
                  'credit': f"Photo: {(v.get('artist') or '').splitlines()[0][:80]} — {v.get('license', '')} ({v.get('page', '')})"})
    key.append({'n': len(pairs), 'photo': photo, 'A': 'after' if flip else 'before', 'B': 'before' if flip else 'after'})

cards = '\n'.join(f'''
<section class="pair" data-n="{p['n']}">
  <h2>View {p['n']}</h2>
  <div class="ab"><figure><img src="{p['a']}" alt="Render A, view {p['n']}"><figcaption>A</figcaption></figure>
  <figure><img src="{p['b']}" alt="Render B, view {p['n']}"><figcaption>B</figcaption></figure></div>
  {f'<details><summary>The real place (for reference)</summary><img class="ref" src="{p["ref"]}" alt="Photo of the place, view {p["n"]}"><p class="credit">{p["credit"]}</p></details>' if p['ref'] else ''}
  <div class="pick" role="radiogroup" aria-label="View {p['n']}: which looks more like a real place?">
    <label><input type="radio" name="v{p['n']}" value="A"> A</label>
    <label><input type="radio" name="v{p['n']}" value="="> Same</label>
    <label><input type="radio" name="v{p['n']}" value="B"> B</label>
  </div>
</section>''' for p in pairs)

html = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>bikefree — which looks more real?</title>
<style>
  :root {{ color-scheme: light dark; --ink: #1d1d1b; --paper: #faf8f4; --rule: #d8d2c6; --accent: #b4532a; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --ink: #ece8df; --paper: #1a1917; --rule: #3a3833; --accent: #e08a5f; }} }}
  body {{ margin: 0; font: 16px/1.5 system-ui, sans-serif; color: var(--ink); background: var(--paper); }}
  main {{ max-width: 1500px; margin: 0 auto; padding: 24px 16px 64px; }}
  h1 {{ font-size: 1.5rem; margin: 0 0 4px; }} h2 {{ font-size: 1.05rem; margin: 0 0 8px; }}
  .lede {{ max-width: 60ch; margin: 0 0 24px; }}
  .pair {{ border-top: 1px solid var(--rule); padding: 20px 0; }}
  .ab {{ display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }}
  @media (max-width: 700px) {{ .ab {{ grid-template-columns: 1fr; }} }}
  figure {{ margin: 0; }} img {{ width: 100%; height: auto; display: block; border-radius: 4px; }}
  figcaption {{ font-weight: 600; text-align: center; padding-top: 4px; }}
  details {{ margin: 10px 0; }} .ref {{ max-width: 480px; }} .credit {{ font-size: .8rem; opacity: .75; }}
  .pick {{ display: flex; gap: 20px; font-size: 1.05rem; }} .pick label {{ cursor: pointer; padding: 6px 0; }}
  #done {{ position: sticky; bottom: 0; background: var(--paper); border-top: 2px solid var(--accent); padding: 12px 0; }}
  code {{ font-size: 1.2rem; letter-spacing: .1em; }}
</style></head><body><main>
<h1>Which looks more like a real place?</h1>
<p class="lede">Each view below is the same spot drawn two ways. For each, pick the one that looks more like the real place
when you imagine riding past it — or "Same" if you can't tell. Go with your first impression. A photo of the actual place is
tucked under each pair if you want it.</p>
{cards}
<div id="done"><span>Your answers: </span><code id="code">—</code> <span id="left"></span>
<p>Send this code back when every view has an answer.</p></div>
</main>
<script>
  const n = {len(pairs)};
  function update() {{
    let s = '', left = 0;
    for (let i = 1; i <= n; i++) {{ const c = document.querySelector(`input[name="v${{i}}"]:checked`); s += c ? c.value : '·'; if (!c) left++; }}
    document.getElementById('code').textContent = s;
    document.getElementById('left').textContent = left ? `(${{left}} to go)` : '(done)';
  }}
  document.addEventListener('change', update); update();
</script></body></html>'''
open(a.out, 'w').write(html)
json.dump({'note': 'answer key for the blind A/B sheet (A and B per view): keep it out of the sheet', 'pairs': key}, open(a.key, 'w'), indent=1)
print(f'wrote {a.out} ({len(pairs)} pairs, {os.path.getsize(a.out) / 1e6:.1f} MB) and {a.key}')
