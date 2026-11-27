// [review 27 Nov] W15: the phone / tablet test, the one copy (graph-world.js, graph-city.js and endless-world.js each had
// it). MOBILE: a phone or tablet by its user agent, or an iPad that reports itself as a Mac (a touch screen);
// PHONE_UA: the user-agent test alone, for the places that never counted an iPad-as-Mac (kept as they were: the
// golden-hour bake's cell size, the stylized terrain's near trees).
export const PHONE_UA = /iPhone|iPad|iPod|Android|Mobile/;
export const MOBILE = (() => { try { const ua = navigator.userAgent || ''; return PHONE_UA.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); } catch { return false; } })();
