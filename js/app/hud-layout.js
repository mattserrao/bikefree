// The ride HUD's layout helpers: the minimap sits just above the power bar and elevation profile, whatever their
// height (the power bar's size setting, a phone's full-width bar), and the turn prompt / pills just under the top row
// on a phone. Sets CSS variables on the HUD: --hud-bottom-h, --hud-top-h. (Part of the app: js/app.js imports it.)
const hud = document.querySelector('#rideScreen .hud');
const bottom = hud?.querySelector('.hud-bottom'), tl = hud?.querySelector('.hud-tl'), tr = hud?.querySelector('.hud-right');
if (hud && bottom && 'ResizeObserver' in window) {
  const set = () => {
    hud.style.setProperty('--hud-bottom-h', `${Math.round(bottom.getBoundingClientRect().height)}px`);
    const top = Math.max(tl?.getBoundingClientRect().bottom || 0, 0) - hud.getBoundingClientRect().top;
    hud.style.setProperty('--hud-tl-bottom', `${Math.round(top)}px`);
    hud.style.setProperty('--hud-tr-bottom', `${Math.round((tr?.getBoundingClientRect().bottom || 0) - hud.getBoundingClientRect().top)}px`);
  };
  const ro = new ResizeObserver(set);
  for (const el of [hud, bottom, tl, tr]) if (el) ro.observe(el);
  set();
}
