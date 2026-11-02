/**
 * MeshFlow Studio - shared prelude.
 *
 * Concatenated into the single generated client bundle by build.mjs. Everything the plugin
 * shares lives on this one namespace object; later fragments attach exactly one member each.
 */
const MF = {
  ID: 'meshflow-studio',
  VERSION: 1,
  /** Filled per module as { en: {...}, zh: {...} } and merged by 60-register.js. */
  strings: {},
};

MF.util = (function () {
  var uidCounter = 0;

  function clamp(value, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return min;
    return n < min ? min : n > max ? max : n;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function round(value, precision) {
    var p = Math.pow(10, precision == null ? 2 : precision);
    return Math.round(Number(value) * p) / p;
  }

  function uid(prefix) {
    uidCounter += 1;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + uidCounter.toString(36);
  }

  function clone(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
  }

  /** Deterministic PRNG (mulberry32): returns () => number in [0, 1). */
  function mulberry32(seed) {
    var a = (Number(seed) || 1) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Formats a number with a fixed number of decimals, dropping trailing zeros. */
  function trim(value, precision) {
    var s = Number(value).toFixed(precision == null ? 2 : precision);
    return s.replace(/\.?0+$/, '');
  }

  /** Pick a random item from an array using a provided rng. */
  function pick(list, rng) {
    if (!list || !list.length) return undefined;
    var r = typeof rng === 'function' ? rng() : Math.random();
    return list[Math.min(list.length - 1, Math.floor(r * list.length))];
  }

  /** Deterministic shuffle (returns a new array). */
  function shuffle(list, rng) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i -= 1) {
      var r = typeof rng === 'function' ? rng() : Math.random();
      var j = Math.floor(r * (i + 1));
      var tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  return {
    clamp: clamp,
    lerp: lerp,
    round: round,
    trim: trim,
    uid: uid,
    clone: clone,
    mulberry32: mulberry32,
    pick: pick,
    shuffle: shuffle,
  };
})();

/** All plugin CSS, assembled by build time from the module fragments. */
MF.cssAll = function cssAll() {
  return [MF.ui && MF.ui.css, MF.panels && MF.panels.css, MF.studioCss]
    .filter(Boolean)
    .join('\n');
};
