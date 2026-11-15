// bikefree — light / dark / system appearance, adapted from Machine Manager's mm-theme.js.
// Loaded as a plain script in <head>, before the stylesheet paints, so the page never flashes the wrong colours.
//
//   BFTheme.pref()        'system' | 'light' | 'dark'   (what you picked; default 'system')
//   BFTheme.mode()        'light' | 'dark'              (what's showing now)
//   BFTheme.set(pref)     pick one: applies now and remembers it
//   BFTheme.onChange(fn)  fn(pref, mode) whenever either changes (macOS switching appearance included)
//
// <html data-theme="light|dark"> drives the colour tokens in css/style.css.
(() => {
  const KEY = 'bikefree.theme', PREFS = ['system', 'light', 'dark'];
  const BG = { dark: '#262624', light: '#f8f8f7' };   // --bg in style.css
  const mq = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
  const ls = {
    get() { try { return localStorage.getItem(KEY); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } },
  };
  const subs = [];
  let pref = PREFS.includes(ls.get()) ? ls.get() : 'system';

  const mode = () => (pref === 'system' ? (mq && mq.matches ? 'light' : 'dark') : pref);
  function apply() {
    const m = mode(), root = document.documentElement;
    if (root.dataset.theme !== m) root.dataset.theme = m;
    root.dataset.themePref = pref;
    let tc = document.querySelector('meta[name="theme-color"]');
    if (!tc) { tc = document.createElement('meta'); tc.name = 'theme-color'; document.head.appendChild(tc); }
    tc.content = BG[m];
    subs.forEach((fn) => { try { fn(pref, m); } catch { /* ignore */ } });
  }
  function use(p, remember = true) {
    if (!PREFS.includes(p)) return;
    pref = p;
    if (remember) ls.set(p);
    apply();
  }

  window.BFTheme = { pref: () => pref, mode, prefs: PREFS.slice(), set: (p) => use(p), onChange: (fn) => subs.push(fn) };
  if (mq) (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
  window.addEventListener('storage', (e) => { if (e.key === KEY && PREFS.includes(e.newValue)) use(e.newValue, false); });
  apply();
})();
