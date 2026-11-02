/**
 * MeshFlow Studio - composition model (MF.model).
 *
 * Pure data + code generation: palette/preset curation, immutable state helpers, colour
 * maths, and the copy-paste CSS emitter. This fragment must stay DOM-free and dependency-free
 * so it can be unit-tested directly under Node.
 *
 * Exposes:
 *   MF.model = { VERSION, ASPECTS, LIMITS, MIX_MODES, GRAIN_BLENDS, PALETTES, PRESETS,
 *                createState, aspectOf, dimensionsOf, clone, normalize, validState, newPoint,
 *                addPoint, removePoint, patchPoint, setAspect, applyPreset, randomize, recolor,
 *                serialize, deserialize, toCSS, toJSON, filename, formatDimensions, blurPx,
 *                grainTileSize, contrastText, color }
 *   MF.strings.model = { en, zh }
 */
MF.model = (function () {
  var U = MF.util;

  /* ------------------------------------------------------------------ colour */

  var color = (function () {
    function clampByte(value) {
      var n = Math.round(Number(value));
      if (!isFinite(n)) return 0;
      return n < 0 ? 0 : n > 255 ? 255 : n;
    }

    function clampAlpha(value, fallback) {
      var n = Number(value);
      if (!isFinite(n)) return fallback;
      return U.round(n < 0 ? 0 : n > 1 ? 1 : n, 3);
    }

    function rgbChannel(raw) {
      var text = String(raw);
      var n = parseFloat(text);
      if (!isFinite(n)) return 0;
      if (text.charAt(text.length - 1) === '%') return clampByte((n / 100) * 255);
      return clampByte(n);
    }

    function alphaChannel(raw) {
      var text = String(raw);
      var n = parseFloat(text);
      if (!isFinite(n)) return 1;
      if (text.charAt(text.length - 1) === '%') n = n / 100;
      return clampAlpha(n, 1);
    }

    function toHexByte(value) {
      var text = clampByte(value).toString(16);
      return text.length < 2 ? '0' + text : text;
    }

    /**
     * Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and `rgb()/rgba()` strings.
     * Always returns { r, g, b, a } (0..255, 0..1); invalid input yields opaque black.
     */
    function parse(input) {
      var out = { r: 0, g: 0, b: 0, a: 1 };
      if (typeof input !== 'string') return out;
      var text = input.trim().toLowerCase();
      if (!text) return out;

      if (text.charAt(0) === '#') {
        var body = text.slice(1);
        if (/^[0-9a-f]{3}$/.test(body) || /^[0-9a-f]{4}$/.test(body)) {
          out.r = parseInt(body.charAt(0) + body.charAt(0), 16);
          out.g = parseInt(body.charAt(1) + body.charAt(1), 16);
          out.b = parseInt(body.charAt(2) + body.charAt(2), 16);
          if (body.length === 4) out.a = U.round(parseInt(body.charAt(3) + body.charAt(3), 16) / 255, 3);
          return out;
        }
        if (/^[0-9a-f]{6}$/.test(body) || /^[0-9a-f]{8}$/.test(body)) {
          out.r = parseInt(body.slice(0, 2), 16);
          out.g = parseInt(body.slice(2, 4), 16);
          out.b = parseInt(body.slice(4, 6), 16);
          if (body.length === 8) out.a = U.round(parseInt(body.slice(6, 8), 16) / 255, 3);
          return out;
        }
        return out;
      }

      var match = /^rgba?\(\s*([0-9.%]+)\s*[, ]\s*([0-9.%]+)\s*[, ]\s*([0-9.%]+)\s*(?:[,/]\s*([0-9.%]+)\s*)?\)$/.exec(text);
      if (!match) return out;
      out.r = rgbChannel(match[1]);
      out.g = rgbChannel(match[2]);
      out.b = rgbChannel(match[3]);
      out.a = match[4] == null ? 1 : alphaChannel(match[4]);
      return out;
    }

    /** `{ r, g, b, a }` → css `rgba(...)` string. */
    function rgba(value) {
      var src = value && typeof value === 'object' ? value : {};
      return 'rgba(' + clampByte(src.r) + ', ' + clampByte(src.g) + ', ' + clampByte(src.b) + ', ' + clampAlpha(src.a, 1) + ')';
    }

    /** `{ r, g, b }` → `#rrggbb`. */
    function hex(value) {
      var src = value && typeof value === 'object' ? value : {};
      return '#' + toHexByte(src.r) + toHexByte(src.g) + toHexByte(src.b);
    }

    /** Linear (sRGB-space) interpolation between two colours. */
    function mix(from, to, amount) {
      var a = parse(from);
      var b = parse(to);
      var t = clampAlpha(amount, 1);
      return hex({
        r: Math.round(U.lerp(a.r, b.r, t)),
        g: Math.round(U.lerp(a.g, b.g, t)),
        b: Math.round(U.lerp(a.b, b.b, t)),
      });
    }

    function lighten(value, amount) {
      return mix(value, '#ffffff', amount);
    }

    function darken(value, amount) {
      return mix(value, '#000000', amount);
    }

    /** WCAG relative luminance (0..1). */
    function luminance(value) {
      var c = parse(value);
      function linear(channel) {
        var v = channel / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      }
      var lum = 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b);
      return U.round(lum < 0 ? 0 : lum > 1 ? 1 : lum, 4);
    }

    function withAlpha(value, alpha) {
      var c = parse(value);
      return rgba({ r: c.r, g: c.g, b: c.b, a: alpha });
    }

    return {
      parse: parse,
      rgba: rgba,
      hex: hex,
      mix: mix,
      lighten: lighten,
      darken: darken,
      luminance: luminance,
      withAlpha: withAlpha,
    };
  })();

  /* --------------------------------------------------------------- constants */

  var VERSION = 1;

  var ASPECTS = [
    { id: '16:9', w: 1600, h: 900 },
    { id: '4:3', w: 1440, h: 1080 },
    { id: '1:1', w: 1200, h: 1200 },
    { id: '9:16', w: 900, h: 1600 },
    { id: '3:2', w: 1500, h: 1000 },
    { id: '21:9', w: 1680, h: 720 },
    { id: '2:3', w: 1000, h: 1500 },
    { id: 'a4', w: 1240, h: 1754 },
  ];

  var LIMITS = {
    points: [2, 12],
    pointSize: [0.02, 1.4],
    pointOpacity: [0.05, 1],
    blur: [0, 100],
    grainAmount: [0, 100],
    grainScale: [1, 100],
    grainSeed: [1, 9999],
    vignetteAmount: [0, 100],
    vignetteSize: [0, 100],
    glassBlur: [0, 60],
    glassOpacity: [0, 100],
    glassRadius: [0, 80],
    glassBorder: [0, 100],
    glassSheen: [0, 100],
    glassSize: [0.05, 1],
  };

  var MIX_MODES = ['normal', 'screen', 'overlay', 'soft-light', 'lighter'];
  var GRAIN_BLENDS = ['overlay', 'soft-light', 'normal'];

  var PALETTES = [
    { id: 'aurora', nameKey: 'palette.aurora', colors: ['#6ee7ff', '#a78bfa', '#34d399', '#38bdf8', '#7cf29a'] },
    { id: 'sunset', nameKey: 'palette.sunset', colors: ['#ff9a6c', '#ff5e7e', '#ffc46b', '#c86dd7', '#ffb3c7'] },
    { id: 'ocean', nameKey: 'palette.ocean', colors: ['#0ea5e9', '#22d3ee', '#2563eb', '#0f766e', '#67e8f9'] },
    { id: 'neon', nameKey: 'palette.neon', colors: ['#ff2d95', '#00f0ff', '#a855f7', '#f9f871', '#39ff14'] },
    { id: 'pastel', nameKey: 'palette.pastel', colors: ['#ffd6e0', '#c7f0ff', '#d9c9ff', '#ffe8c2', '#b8f2d8'] },
    { id: 'forest', nameKey: 'palette.forest', colors: ['#2f6f4e', '#57a773', '#9bd18c', '#1f4d3a', '#cfe8a9'] },
    { id: 'ember', nameKey: 'palette.ember', colors: ['#ff4d00', '#ff8a3d', '#ffb703', '#c1121f', '#6a040f'] },
    { id: 'mono', nameKey: 'palette.mono', colors: ['#f5f5f7', '#c7c7d1', '#8b8b99', '#4a4a57', '#1c1c24'] },
  ];

  var MESHFLOW_FORMAT = 'meshflow-studio';

  /* ----------------------------------------------------------------- helpers */

  function findById(list, id) {
    if (typeof id !== 'string') return null;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  function paletteById(id) {
    return findById(PALETTES, id) || PALETTES[0];
  }

  function clampNumber(value, range, fallback) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return n < range[0] ? range[0] : n > range[1] ? range[1] : n;
  }

  function clampInt(value, range, fallback) {
    return Math.round(clampNumber(value, range, fallback));
  }

  function isHex(value) {
    return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim());
  }

  function hexValue(value, fallback) {
    return isHex(value) ? color.hex(color.parse(value)) : fallback;
  }

  function gcd(a, b) {
    var x = Math.abs(a);
    var y = Math.abs(b);
    while (y) {
      var t = y;
      y = x % y;
      x = t;
    }
    return x;
  }

  function ratioOf(width, height) {
    var d = gcd(width, height) || 1;
    return width / d + ' / ' + height / d;
  }

  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i += 1) {
        if (!sameValue(a[i], b[i])) return false;
      }
      return true;
    }
    var keys = Object.keys(a);
    var otherKeys = Object.keys(b);
    if (keys.length !== otherKeys.length) return false;
    for (var j = 0; j < keys.length; j += 1) {
      var key = keys[j];
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!sameValue(a[key], b[key])) return false;
    }
    return true;
  }

  /* ------------------------------------------------------------ default state */

  function defaultState() {
    return {
      version: VERSION,
      name: 'Untitled mesh',
      aspect: '16:9',
      base: '#0a0a12',
      mix: 'normal',
      points: [
        { id: 'p1', x: 0.28, y: 0.3, color: '#6ee7ff', size: 0.62, opacity: 1 },
        { id: 'p2', x: 0.72, y: 0.26, color: '#a78bfa', size: 0.55, opacity: 0.9 },
        { id: 'p3', x: 0.5, y: 0.72, color: '#34d399', size: 0.7, opacity: 0.85 },
        { id: 'p4', x: 0.16, y: 0.78, color: '#38bdf8', size: 0.5, opacity: 0.75 },
        { id: 'p5', x: 0.86, y: 0.7, color: '#7cf29a', size: 0.46, opacity: 0.8 },
        { id: 'p6', x: 0.6, y: 0.5, color: '#818cf8', size: 0.4, opacity: 0.6 },
      ],
      blur: 0,
      grain: { enabled: false, amount: 0, scale: 34, seed: 7, blend: 'overlay' },
      vignette: { enabled: false, amount: 24, size: 60 },
      glass: {
        enabled: false,
        x: 0.5,
        y: 0.5,
        w: 0.52,
        h: 0.42,
        radius: 28,
        blur: 18,
        opacity: 14,
        tint: '#ffffff',
        border: 40,
        sheen: 30,
      },
      palette: 'aurora',
    };
  }

  function createState() {
    return defaultState();
  }

  /* ---------------------------------------------------------------- normalise */

  function normalizePoints(list, paletteId) {
    var palette = paletteById(paletteId);
    var fallback = defaultState().points;
    var out = [];
    var i;

    if (Array.isArray(list)) {
      for (i = 0; i < list.length; i += 1) {
        if (out.length >= LIMITS.points[1]) break;
        var raw = list[i];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        var x = Number(raw.x);
        var y = Number(raw.y);
        if (!isFinite(x) || !isFinite(y)) continue;
        out.push({
          id: typeof raw.id === 'string' ? raw.id.trim().slice(0, 40) : '',
          x: clampNumber(x, [0, 1], 0.5),
          y: clampNumber(y, [0, 1], 0.5),
          color: hexValue(raw.color, palette.colors[out.length % palette.colors.length]),
          size: clampNumber(raw.size, LIMITS.pointSize, 0.5),
          opacity: clampNumber(raw.opacity, LIMITS.pointOpacity, 1),
        });
      }
    }

    if (!out.length) {
      // Nothing usable was supplied: fall back to the full default composition.
      for (i = 0; i < fallback.length; i += 1) {
        var basePoint = fallback[i];
        out.push({
          id: '',
          x: basePoint.x,
          y: basePoint.y,
          color: hexValue(basePoint.color, palette.colors[i % palette.colors.length]),
          size: basePoint.size,
          opacity: basePoint.opacity,
        });
      }
    } else {
      while (out.length < LIMITS.points[0]) {
        var seed = fallback[out.length % fallback.length];
        out.push({
          id: '',
          x: seed.x,
          y: seed.y,
          color: hexValue(seed.color, palette.colors[out.length % palette.colors.length]),
          size: seed.size,
          opacity: seed.opacity,
        });
      }
    }

    var used = {};
    for (i = 0; i < out.length; i += 1) {
      var id = out[i].id;
      if (!id || used[id]) {
        var n = 1;
        while (used['p' + n]) n += 1;
        id = 'p' + n;
      }
      used[id] = true;
      out[i].id = id;
    }
    return out;
  }

  function normalizeGrain(raw, fallback) {
    var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      enabled: !!src.enabled,
      amount: clampInt(src.amount, LIMITS.grainAmount, fallback.amount),
      scale: clampInt(src.scale, LIMITS.grainScale, fallback.scale),
      seed: clampInt(src.seed, LIMITS.grainSeed, fallback.seed),
      blend: GRAIN_BLENDS.indexOf(src.blend) >= 0 ? src.blend : fallback.blend,
    };
  }

  function normalizeVignette(raw, fallback) {
    var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      enabled: !!src.enabled,
      amount: clampInt(src.amount, LIMITS.vignetteAmount, fallback.amount),
      size: clampInt(src.size, LIMITS.vignetteSize, fallback.size),
    };
  }

  function normalizeGlass(raw, fallback) {
    var src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
      enabled: !!src.enabled,
      x: clampNumber(src.x, [0, 1], fallback.x),
      y: clampNumber(src.y, [0, 1], fallback.y),
      w: clampNumber(src.w, LIMITS.glassSize, fallback.w),
      h: clampNumber(src.h, LIMITS.glassSize, fallback.h),
      radius: clampInt(src.radius, LIMITS.glassRadius, fallback.radius),
      blur: clampInt(src.blur, LIMITS.glassBlur, fallback.blur),
      opacity: clampInt(src.opacity, LIMITS.glassOpacity, fallback.opacity),
      tint: hexValue(src.tint, fallback.tint),
      border: clampInt(src.border, LIMITS.glassBorder, fallback.border),
      sheen: clampInt(src.sheen, LIMITS.glassSheen, fallback.sheen),
    };
  }

  /** Fills / clamps / repairs any input into a complete valid composition. Never throws. */
  function normalize(input) {
    try {
      var src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
      var defaults = defaultState();
      var aspectId = findById(ASPECTS, src.aspect) ? src.aspect : defaults.aspect;
      var paletteId = findById(PALETTES, src.palette) ? src.palette : defaults.palette;
      var name =
        typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 120) : defaults.name;
      return {
        version: VERSION,
        name: name,
        aspect: aspectId,
        base: hexValue(src.base, defaults.base),
        mix: MIX_MODES.indexOf(src.mix) >= 0 ? src.mix : defaults.mix,
        points: normalizePoints(src.points, paletteId),
        blur: clampInt(src.blur, LIMITS.blur, defaults.blur),
        grain: normalizeGrain(src.grain, defaults.grain),
        vignette: normalizeVignette(src.vignette, defaults.vignette),
        glass: normalizeGlass(src.glass, defaults.glass),
        palette: paletteId,
      };
    } catch (error) {
      return defaultState();
    }
  }

  /** True when `value` is already a complete, normalised composition. */
  function validState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    try {
      return sameValue(normalize(value), value);
    } catch (error) {
      return false;
    }
  }

  /* -------------------------------------------------------------- state tools */

  function clone(state) {
    return U.clone(state);
  }

  function aspectOf(state) {
    var src = state && typeof state === 'object' ? state : {};
    return findById(ASPECTS, src.aspect) || ASPECTS[0];
  }

  function dimensionsOf(state) {
    var aspect = aspectOf(state);
    return { width: aspect.w, height: aspect.h };
  }

  function newPoint(partial) {
    var src = partial && typeof partial === 'object' ? partial : {};
    var id = typeof src.id === 'string' && src.id.trim() ? src.id.trim().slice(0, 40) : U.uid('p');
    return {
      id: id,
      x: clampNumber(src.x, [0, 1], 0.5),
      y: clampNumber(src.y, [0, 1], 0.5),
      color: hexValue(src.color, '#6ee7ff'),
      size: clampNumber(src.size, LIMITS.pointSize, 0.5),
      opacity: clampNumber(src.opacity, LIMITS.pointOpacity, 1),
    };
  }

  function addPoint(state, at) {
    var base = normalize(state);
    if (base.points.length >= LIMITS.points[1]) return base;
    var position = at && typeof at === 'object' ? at : {};
    var palette = paletteById(base.palette);
    var point = newPoint({
      id: U.uid('p'),
      x: isFinite(Number(position.x)) ? Number(position.x) : 0.5,
      y: isFinite(Number(position.y)) ? Number(position.y) : 0.5,
      color: palette.colors[base.points.length % palette.colors.length],
      size: 0.5,
      opacity: 0.9,
    });
    var next = clone(base);
    next.points = base.points.concat([point]);
    return normalize(next);
  }

  function removePoint(state, id) {
    var base = normalize(state);
    if (base.points.length <= LIMITS.points[0]) return base;
    var next = clone(base);
    next.points = base.points.filter(function (point) {
      return point.id !== id;
    });
    return normalize(next);
  }

  function patchPoint(state, id, patch) {
    var base = normalize(state);
    var src = patch && typeof patch === 'object' ? patch : {};
    var found = false;
    var points = base.points.map(function (point) {
      if (point.id !== id) return point;
      found = true;
      return {
        id: point.id,
        x: src.x !== undefined ? clampNumber(src.x, [0, 1], point.x) : point.x,
        y: src.y !== undefined ? clampNumber(src.y, [0, 1], point.y) : point.y,
        color: src.color !== undefined ? hexValue(src.color, point.color) : point.color,
        size: src.size !== undefined ? clampNumber(src.size, LIMITS.pointSize, point.size) : point.size,
        opacity: src.opacity !== undefined ? clampNumber(src.opacity, LIMITS.pointOpacity, point.opacity) : point.opacity,
      };
    });
    if (!found) return base;
    var next = clone(base);
    next.points = points;
    return normalize(next);
  }

  function setAspect(state, aspectId) {
    var base = normalize(state);
    var next = clone(base);
    next.aspect = findById(ASPECTS, aspectId) ? aspectId : base.aspect;
    return normalize(next);
  }

  function applyPreset(presetOrId) {
    var preset = null;
    if (typeof presetOrId === 'string') {
      preset = findByPresetId(presetOrId);
    } else if (presetOrId && typeof presetOrId === 'object') {
      if (presetOrId.state && typeof presetOrId.state === 'object') preset = presetOrId;
      else if (typeof presetOrId.id === 'string') preset = findByPresetId(presetOrId.id);
    }
    if (!preset || !preset.state) return createState();
    return normalize(clone(preset.state));
  }

  function recolor(state, paletteId) {
    var base = normalize(state);
    var palette = findById(PALETTES, paletteId) || paletteById(base.palette);
    var points = base.points.map(function (point, index) {
      return newPoint({
        id: point.id,
        x: point.x,
        y: point.y,
        color: palette.colors[index % palette.colors.length],
        size: point.size,
        opacity: point.opacity,
      });
    });
    var next = clone(base);
    next.palette = palette.id;
    next.points = points;
    return normalize(next);
  }

  function distanceToPoints(points, x, y) {
    var nearest = 2;
    for (var i = 0; i < points.length; i += 1) {
      var dx = points[i].x - x;
      var dy = points[i].y - y;
      var distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < nearest) nearest = distance;
    }
    return nearest;
  }

  /**
   * Deterministic composition generator. Same `seed` + same input state + same options always
   * yield byte-identical output. Layered stratification keeps blobs spread and un-muddy.
   */
  function randomize(state, options) {
    var base = normalize(state);
    var opts = options && typeof options === 'object' ? options : {};
    var rawSeed = Number(opts.seed);
    var seed = isFinite(rawSeed) && rawSeed > 0 ? Math.round(rawSeed) : Math.floor(Math.random() * 9998) + 2;
    var rng = U.mulberry32(seed);

    var palette = findById(PALETTES, opts.paletteId);
    if (!palette) palette = PALETTES[Math.min(PALETTES.length - 1, Math.floor(rng() * PALETTES.length))];

    var requested = Number(opts.count);
    var count;
    if (isFinite(requested) && requested > 0) count = Math.round(requested);
    else count = 4 + Math.floor(rng() * 5);
    count = Math.round(U.clamp(count, 4, 8));

    var lightBase = palette.id === 'pastel' ? true : rng() < 0.22;
    var baseColor = lightBase
      ? color.mix('#ffffff', palette.colors[0], 0.14)
      : color.mix('#07070f', palette.colors[0], 0.12);

    var mixPool = lightBase
      ? ['normal', 'overlay', 'soft-light', 'screen']
      : ['screen', 'screen', 'lighter', 'overlay', 'soft-light'];
    var mix = mixPool[Math.min(mixPool.length - 1, Math.floor(rng() * mixPool.length))];

    var dims = dimensionsOf(base);
    var aspectRatio = dims.width / dims.height;
    var cols = Math.max(2, Math.ceil(Math.sqrt(count * aspectRatio)));
    var rows = Math.max(2, Math.ceil(count / cols));
    var cells = [];
    var r;
    var c;
    for (r = 0; r < rows; r += 1) {
      for (c = 0; c < cols; c += 1) cells.push([c, r]);
    }
    cells = U.shuffle(cells, rng);
    var colors = U.shuffle(palette.colors.slice(), rng);

    var points = [];
    for (var i = 0; i < count; i += 1) {
      var cell = cells[i] || [i % cols, Math.floor(i / cols)];
      // Sample a few deterministic candidates inside the cell and keep the best separated one.
      var attempts = points.length ? 4 : 1;
      var bestX = 0.5;
      var bestY = 0.5;
      var bestDistance = -1;
      for (var attempt = 0; attempt < attempts; attempt += 1) {
        var candidateX = U.clamp((cell[0] + 0.16 + rng() * 0.68) / cols, 0.06, 0.94);
        var candidateY = U.clamp((cell[1] + 0.16 + rng() * 0.68) / rows, 0.06, 0.94);
        var separation = distanceToPoints(points, candidateX, candidateY);
        if (separation > bestDistance) {
          bestDistance = separation;
          bestX = candidateX;
          bestY = candidateY;
        }
      }
      var x = bestX;
      var y = bestY;
      var hero = i === 0;
      var size = hero ? 0.72 + rng() * 0.34 : 0.34 + rng() * 0.46;
      var opacity = hero ? 0.86 + rng() * 0.14 : 0.5 + rng() * 0.5;
      var pointColor = colors[i % colors.length];
      points.push(
        newPoint({
          id: 'p' + (i + 1),
          x: U.round(x, 3),
          y: U.round(y, 3),
          color: pointColor,
          size: U.round(size, 3),
          opacity: U.round(opacity, 3),
        })
      );
    }

    var blur = 10 + Math.floor(rng() * 61);
    var grainOn = rng() < 0.55;
    var grainAmount = grainOn ? 8 + Math.floor(rng() * 40) : 0;
    var grainScale = grainOn ? 18 + Math.floor(rng() * 55) : base.grain.scale;
    var grainSeed = grainOn ? 2 + Math.floor(rng() * 9996) : base.grain.seed;
    var grainBlend = grainOn
      ? GRAIN_BLENDS[Math.min(GRAIN_BLENDS.length - 1, Math.floor(rng() * GRAIN_BLENDS.length))]
      : base.grain.blend;
    var vignetteOn = !lightBase && rng() < 0.45;
    var vignetteAmount = vignetteOn ? 18 + Math.floor(rng() * 46) : 0;
    var vignetteSize = vignetteOn ? 42 + Math.floor(rng() * 46) : base.vignette.size;
    var glassOn = rng() < 0.2;

    var glassState = {
      enabled: glassOn,
      x: base.glass.x,
      y: base.glass.y,
      w: base.glass.w,
      h: base.glass.h,
      radius: base.glass.radius,
      blur: base.glass.blur,
      opacity: base.glass.opacity,
      tint: base.glass.tint,
      border: base.glass.border,
      sheen: base.glass.sheen,
    };
    if (glassOn) {
      glassState = {
        enabled: true,
        x: U.round(0.28 + rng() * 0.44, 3),
        y: U.round(0.3 + rng() * 0.4, 3),
        w: U.round(0.32 + rng() * 0.32, 3),
        h: U.round(0.24 + rng() * 0.28, 3),
        radius: 16 + Math.floor(rng() * 22),
        blur: 10 + Math.floor(rng() * 20),
        opacity: 10 + Math.floor(rng() * 14),
        tint: rng() < 0.5 ? '#ffffff' : color.lighten(palette.colors[0], 0.35),
        border: 28 + Math.floor(rng() * 40),
        sheen: 18 + Math.floor(rng() * 38),
      };
    }

    return normalize({
      version: VERSION,
      name: base.name,
      aspect: base.aspect,
      base: baseColor,
      mix: mix,
      points: points,
      blur: blur,
      grain: {
        enabled: grainOn,
        amount: grainAmount,
        scale: grainScale,
        seed: grainSeed,
        blend: grainBlend,
      },
      vignette: { enabled: vignetteOn, amount: vignetteAmount, size: vignetteSize },
      glass: glassState,
      palette: palette.id,
    });
  }

  /* -------------------------------------------------------------- (de)serialise */

  function serialize(state) {
    return JSON.stringify({ format: MESHFLOW_FORMAT, version: VERSION, state: normalize(state) });
  }

  function toJSON(state) {
    return JSON.stringify({ format: MESHFLOW_FORMAT, version: VERSION, state: normalize(state) }, null, 2);
  }

  function deserialize(input) {
    try {
      var data = input;
      if (typeof input === 'string') {
        if (!input.trim()) return null;
        data = JSON.parse(input);
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      if (data.format === MESHFLOW_FORMAT) {
        if (!data.state || typeof data.state !== 'object' || Array.isArray(data.state)) return null;
        return normalize(data.state);
      }
      if (data.state && typeof data.state === 'object' && data.format == null) {
        return normalize(data.state);
      }
      if (data.points != null || data.aspect != null || data.base != null || data.palette != null) {
        return normalize(data);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /* ---------------------------------------------------------------- dimensions */

  function blurPx(state) {
    var src = normalize(state);
    var dims = dimensionsOf(src);
    return Math.round((src.blur / 100) * Math.min(dims.width, dims.height) * 0.09);
  }

  function grainTileSize(state) {
    var src = normalize(state);
    var span = LIMITS.grainScale[1] - LIMITS.grainScale[0];
    var t = (clampNumber(src.grain.scale, LIMITS.grainScale, 34) - LIMITS.grainScale[0]) / span;
    return Math.round(U.clamp(U.lerp(256, 48, t), 48, 256));
  }

  function formatDimensions(state, scale) {
    var src = normalize(state);
    var factor = Number(scale);
    if (!isFinite(factor) || factor <= 0) factor = 1;
    var dims = dimensionsOf(src);
    return Math.round(dims.width * factor) + ' \u00d7 ' + Math.round(dims.height * factor);
  }

  function slugify(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 42);
  }

  function filename(state, scale) {
    var src = normalize(state);
    var factor = Number(scale);
    if (!isFinite(factor) || factor <= 0) factor = 1;
    var dims = dimensionsOf(src);
    var slug = slugify(src.name) || slugify(src.palette) || 'mesh';
    return 'meshflow-' + slug + '-' + Math.round(dims.width * factor) + 'x' + Math.round(dims.height * factor) + '.png';
  }

  function contrastText(value) {
    var hexColor = isHex(value) ? value : '#000000';
    return color.luminance(hexColor) >= 0.45 ? '#0b0b10' : '#ffffff';
  }

  /* ------------------------------------------------------------------ CSS codegen */

  function grainSvgUri(seed, tile, frequency) {
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' +
      tile +
      '" height="' +
      tile +
      '" viewBox="0 0 ' +
      tile +
      ' ' +
      tile +
      '">' +
      '<filter id="g" x="0" y="0" width="100%" height="100%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="' +
      frequency +
      '" numOctaves="4" seed="' +
      seed +
      '" stitchTiles="stitch"/>' +
      '<feColorMatrix type="saturate" values="0"/>' +
      '</filter>' +
      '<rect width="100%" height="100%" filter="url(#g)"/>' +
      '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27');
  }

  function gradientFor(point, width, height) {
    var maxSide = Math.max(width, height);
    var rx = U.round((point.size * maxSide) / width * 100, 2);
    var ry = U.round((point.size * maxSide) / height * 100, 2);
    var x = U.round(point.x * 100, 2);
    var y = U.round(point.y * 100, 2);
    var parsed = color.parse(point.color);
    var full = color.rgba({ r: parsed.r, g: parsed.g, b: parsed.b, a: point.opacity });
    var mid = color.rgba({ r: parsed.r, g: parsed.g, b: parsed.b, a: U.round(point.opacity * 0.42, 3) });
    var clear = color.rgba({ r: parsed.r, g: parsed.g, b: parsed.b, a: 0 });
    return (
      'radial-gradient(ellipse ' +
      rx +
      '% ' +
      ry +
      '% at ' +
      x +
      '% ' +
      y +
      '%, ' +
      full +
      ' 0%, ' +
      mid +
      ' 46%, ' +
      clear +
      ' 78%)'
    );
  }

  /** Complete, deterministic, copy-paste CSS for the composition (artwork values only). */
  function toCSS(input) {
    var state = normalize(input);
    var dims = dimensionsOf(state);
    var width = dims.width;
    var height = dims.height;
    var blur = blurPx(state);
    var name = state.name.replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ');
    var lines = [];

    lines.push('/* MeshFlow Studio \u2014 ' + name + ' */');
    lines.push(
      '/* ' +
        width +
        ' \u00d7 ' +
        height +
        ' \u00b7 ' +
        state.points.length +
        ' nodes \u00b7 blur ' +
        blur +
        'px' +
        (state.grain.enabled ? ' \u00b7 grain ' + state.grain.amount + '%' : '') +
        (state.vignette.enabled ? ' \u00b7 vignette' : '') +
        (state.glass.enabled ? ' \u00b7 glass' : '') +
        ' */'
    );
    lines.push('');

    lines.push('.meshflow-art {');
    lines.push('  position: relative;');
    lines.push('  isolation: isolate;');
    lines.push('  overflow: hidden;');
    lines.push('  width: 100%;');
    lines.push('  aspect-ratio: ' + ratioOf(width, height) + ';');
    lines.push('  background-color: ' + state.base + ';');
    lines.push('  border-radius: 16px;');
    if (state.vignette.enabled) {
      var vignetteAlpha = U.round((state.vignette.amount / 100) * 0.55, 2);
      var vignetteBlur = Math.round((state.vignette.size / 100) * Math.min(width, height) * 0.35 + 18);
      var vignetteSpread = Math.round(vignetteBlur * 0.34);
      lines.push('  /* vignette */');
      lines.push(
        '  box-shadow: inset 0 0 ' +
          vignetteBlur +
          'px ' +
          vignetteSpread +
          'px rgba(0, 0, 0, ' +
          vignetteAlpha +
          ');'
      );
    }
    lines.push('}');
    lines.push('');

    lines.push('.meshflow-art::before {');
    lines.push('  content: "";');
    lines.push('  position: absolute;');
    lines.push('  inset: -18%;');
    lines.push('  z-index: 0;');
    lines.push('  background:');
    lines.push(
      state.points
        .map(function (point) {
          return '    ' + gradientFor(point, width, height);
        })
        .join(',\n') + ';'
    );
    lines.push('  filter: blur(' + blur + 'px);');
    lines.push('  transform: translateZ(0);');
    lines.push('  pointer-events: none;');
    lines.push('}');

    if (state.grain.enabled) {
      var tile = grainTileSize(state);
      var frequency = U.round(
        U.lerp(1.28, 0.24, (clampNumber(state.grain.scale, LIMITS.grainScale, 34) - LIMITS.grainScale[0]) / (LIMITS.grainScale[1] - LIMITS.grainScale[0])),
        3
      );
      lines.push('');
      lines.push('.meshflow-art::after {');
      lines.push('  content: "";');
      lines.push('  position: absolute;');
      lines.push('  inset: 0;');
      lines.push('  z-index: 2;');
      lines.push('  background-image: url("' + grainSvgUri(state.grain.seed, tile, frequency) + '");');
      lines.push('  background-size: ' + tile + 'px ' + tile + 'px;');
      lines.push('  background-repeat: repeat;');
      lines.push('  opacity: ' + U.round(state.grain.amount / 100, 3) + ';');
      lines.push('  mix-blend-mode: ' + state.grain.blend + ';');
      lines.push('  pointer-events: none;');
      lines.push('}');
    }

    if (state.glass.enabled) {
      var glass = state.glass;
      var left = U.round((glass.x - glass.w / 2) * 100, 2);
      var top = U.round((glass.y - glass.h / 2) * 100, 2);
      var sheenAlpha = U.round((glass.sheen / 100) * 0.5, 2);
      var highlight = U.round(0.12 + (glass.sheen / 100) * 0.3, 2);
      lines.push('');
      lines.push('.meshflow-glass {');
      lines.push('  position: absolute;');
      lines.push('  z-index: 3;');
      lines.push('  left: ' + left + '%;');
      lines.push('  top: ' + top + '%;');
      lines.push('  width: ' + U.round(glass.w * 100, 2) + '%;');
      lines.push('  height: ' + U.round(glass.h * 100, 2) + '%;');
      lines.push('  border-radius: ' + glass.radius + 'px;');
      lines.push('  background:');
      lines.push(
        '    linear-gradient(135deg, rgba(255, 255, 255, ' + sheenAlpha + ') 0%, rgba(255, 255, 255, 0) 58%),'
      );
      lines.push('    ' + color.withAlpha(glass.tint, glass.opacity / 100) + ';');
      lines.push('  -webkit-backdrop-filter: blur(' + glass.blur + 'px) saturate(140%);');
      lines.push('  backdrop-filter: blur(' + glass.blur + 'px) saturate(140%);');
      lines.push('  border: 1px solid rgba(255, 255, 255, ' + U.round(glass.border / 100, 2) + ');');
      lines.push(
        '  box-shadow: inset 0 1px 0 rgba(255, 255, 255, ' +
          highlight +
          '), 0 24px 60px rgba(0, 0, 0, 0.28);'
      );
      lines.push('}');
    }

    lines.push('');
    lines.push('/*');
    lines.push('  Usage:');
    lines.push('  <div class="meshflow-art">');
    if (state.glass.enabled) lines.push('    <div class="meshflow-glass"></div>');
    lines.push('  </div>');
    lines.push('*/');

    return lines.join('\n') + '\n';
  }

  /* ------------------------------------------------------------------- presets */

  function P(x, y, pointColor, size, opacity) {
    return { x: x, y: y, color: pointColor, size: size, opacity: opacity };
  }

  var PRESET_DEFS = [
    {
      id: 'aurora-veil',
      nameKey: 'presets.aurora-veil',
      tagKey: 'tags.soft',
      state: {
        name: 'Aurora Veil',
        aspect: '16:9',
        base: '#050510',
        mix: 'screen',
        palette: 'aurora',
        blur: 26,
        points: [
          P(0.24, 0.28, '#6ee7ff', 0.86, 0.95),
          P(0.68, 0.2, '#a78bfa', 0.72, 0.85),
          P(0.82, 0.62, '#34d399', 0.78, 0.8),
          P(0.42, 0.56, '#38bdf8', 0.62, 0.7),
          P(0.16, 0.78, '#7cf29a', 0.66, 0.6),
          P(0.58, 0.88, '#a78bfa', 0.58, 0.55),
        ],
      },
    },
    {
      id: 'peach-haze',
      nameKey: 'presets.peach-haze',
      tagKey: 'tags.warm',
      state: {
        name: 'Peach Haze',
        aspect: '4:3',
        base: '#1b0f14',
        mix: 'screen',
        palette: 'sunset',
        blur: 44,
        grain: { enabled: true, amount: 18, scale: 42, seed: 11, blend: 'overlay' },
        vignette: { enabled: true, amount: 30, size: 68 },
        points: [
          P(0.22, 0.24, '#ffc46b', 0.9, 0.9),
          P(0.62, 0.18, '#ff9a6c', 0.8, 0.85),
          P(0.78, 0.52, '#ff5e7e', 0.7, 0.75),
          P(0.4, 0.62, '#ffb3c7', 0.66, 0.65),
          P(0.16, 0.8, '#c86dd7', 0.62, 0.5),
        ],
      },
    },
    {
      id: 'deep-orbit',
      nameKey: 'presets.deep-orbit',
      tagKey: 'tags.dark',
      state: {
        name: 'Deep Orbit',
        aspect: '21:9',
        base: '#03040a',
        mix: 'screen',
        palette: 'ocean',
        blur: 10,
        grain: { enabled: true, amount: 10, scale: 88, seed: 33, blend: 'soft-light' },
        vignette: { enabled: true, amount: 48, size: 70 },
        points: [
          P(0.1, 0.3, '#0ea5e9', 0.5, 0.7),
          P(0.3, 0.72, '#22d3ee', 0.62, 0.6),
          P(0.5, 0.3, '#2563eb', 0.7, 0.8),
          P(0.7, 0.68, '#67e8f9', 0.55, 0.6),
          P(0.86, 0.32, '#0f766e', 0.5, 0.65),
          P(0.42, 0.86, '#38bdf8', 0.4, 0.5),
          P(0.63, 0.46, '#e0f7ff', 0.1, 0.85),
        ],
      },
    },
    {
      id: 'neon-tokyo',
      nameKey: 'presets.neon-tokyo',
      tagKey: 'tags.bold',
      state: {
        name: 'Neon Tokyo',
        aspect: '16:9',
        base: '#08030f',
        mix: 'lighter',
        palette: 'neon',
        blur: 8,
        grain: { enabled: true, amount: 22, scale: 26, seed: 23, blend: 'overlay' },
        vignette: { enabled: true, amount: 36, size: 54 },
        points: [
          P(0.18, 0.28, '#ff2d95', 0.62, 0.9),
          P(0.4, 0.16, '#00f0ff', 0.55, 0.85),
          P(0.72, 0.26, '#a855f7', 0.6, 0.8),
          P(0.86, 0.62, '#f9f871', 0.42, 0.6),
          P(0.52, 0.7, '#39ff14', 0.5, 0.55),
          P(0.24, 0.76, '#00f0ff', 0.44, 0.5),
        ],
      },
    },
    {
      id: 'cotton-cloud',
      nameKey: 'presets.cotton-cloud',
      tagKey: 'tags.soft',
      state: {
        name: 'Cotton Cloud',
        aspect: '4:3',
        base: '#f7f2fb',
        mix: 'normal',
        palette: 'pastel',
        blur: 56,
        points: [
          P(0.22, 0.26, '#ffb3c7', 0.9, 0.92),
          P(0.6, 0.2, '#9edbff', 0.8, 0.82),
          P(0.8, 0.6, '#c4b5fd', 0.76, 0.78),
          P(0.36, 0.62, '#ffd98a', 0.7, 0.7),
          P(0.14, 0.78, '#9ff0c8', 0.6, 0.65),
          P(0.62, 0.86, '#a5c8ff', 0.54, 0.55),
        ],
      },
    },
    {
      id: 'mint-glacier',
      nameKey: 'presets.mint-glacier',
      tagKey: 'tags.cool',
      state: {
        name: 'Mint Glacier',
        aspect: '3:2',
        base: '#04121a',
        mix: 'screen',
        palette: 'forest',
        blur: 30,
        glass: {
          enabled: true,
          x: 0.5,
          y: 0.5,
          w: 0.56,
          h: 0.44,
          radius: 30,
          blur: 22,
          opacity: 13,
          tint: '#eafff6',
          border: 46,
          sheen: 34,
        },
        points: [
          P(0.2, 0.3, '#9bd18c', 0.8, 0.85),
          P(0.56, 0.2, '#57a773', 0.72, 0.8),
          P(0.82, 0.46, '#cfe8a9', 0.66, 0.7),
          P(0.34, 0.7, '#2f6f4e', 0.78, 0.6),
          P(0.7, 0.78, '#67e8f9', 0.6, 0.55),
        ],
      },
    },
    {
      id: 'ember-dusk',
      nameKey: 'presets.ember-dusk',
      tagKey: 'tags.warm',
      state: {
        name: 'Ember Dusk',
        aspect: '16:9',
        base: '#120604',
        mix: 'screen',
        palette: 'ember',
        blur: 22,
        grain: { enabled: true, amount: 34, scale: 36, seed: 41, blend: 'overlay' },
        vignette: { enabled: true, amount: 44, size: 60 },
        points: [
          P(0.18, 0.7, '#ff4d00', 0.8, 0.85),
          P(0.44, 0.3, '#ffb703', 0.7, 0.8),
          P(0.7, 0.66, '#ff8a3d', 0.76, 0.75),
          P(0.86, 0.26, '#c1121f', 0.6, 0.6),
          P(0.5, 0.86, '#6a040f', 0.66, 0.5),
        ],
      },
    },
    {
      id: 'violet-drift',
      nameKey: 'presets.violet-drift',
      tagKey: 'tags.cool',
      state: {
        name: 'Violet Drift',
        aspect: '4:3',
        base: '#0a0616',
        mix: 'screen',
        palette: 'aurora',
        blur: 38,
        grain: { enabled: true, amount: 12, scale: 52, seed: 17, blend: 'soft-light' },
        points: [
          P(0.2, 0.24, '#a78bfa', 0.85, 0.9),
          P(0.6, 0.18, '#c4b5fd', 0.72, 0.8),
          P(0.82, 0.5, '#818cf8', 0.74, 0.72),
          P(0.4, 0.48, '#6ee7ff', 0.6, 0.6),
          P(0.18, 0.76, '#38bdf8', 0.62, 0.5),
          P(0.68, 0.82, '#a78bfa', 0.66, 0.5),
          P(0.5, 0.94, '#c4b5fd', 0.44, 0.4),
        ],
      },
    },
    {
      id: 'midnight-mesh',
      nameKey: 'presets.midnight-mesh',
      tagKey: 'tags.dark',
      state: {
        name: 'Midnight Mesh',
        aspect: '16:9',
        base: '#07070c',
        mix: 'screen',
        palette: 'mono',
        blur: 22,
        grain: { enabled: true, amount: 26, scale: 64, seed: 5, blend: 'overlay' },
        vignette: { enabled: true, amount: 52, size: 72 },
        points: [
          P(0.26, 0.3, '#f4f4f8', 0.78, 0.62),
          P(0.66, 0.22, '#d2d2dd', 0.84, 0.5),
          P(0.84, 0.58, '#9c9cae', 0.68, 0.5),
          P(0.4, 0.68, '#585867', 0.92, 0.55),
          P(0.14, 0.84, '#d2d2dd', 0.52, 0.4),
          P(0.56, 0.9, '#26262f', 0.62, 0.45),
        ],
      },
    },
    {
      id: 'citrus-pop',
      nameKey: 'presets.citrus-pop',
      tagKey: 'tags.bold',
      state: {
        name: 'Citrus Pop',
        aspect: '1:1',
        base: '#140a06',
        mix: 'screen',
        palette: 'sunset',
        blur: 14,
        grain: { enabled: true, amount: 16, scale: 30, seed: 61, blend: 'overlay' },
        points: [
          P(0.24, 0.26, '#ffc46b', 0.78, 0.9),
          P(0.7, 0.2, '#ff5e7e', 0.66, 0.8),
          P(0.82, 0.62, '#ff9a6c', 0.62, 0.7),
          P(0.3, 0.7, '#ffb3c7', 0.7, 0.72),
          P(0.56, 0.9, '#c86dd7', 0.5, 0.5),
        ],
      },
    },
    {
      id: 'rose-quartz',
      nameKey: 'presets.rose-quartz',
      tagKey: 'tags.soft',
      state: {
        name: 'Rose Quartz',
        aspect: '3:2',
        base: '#fbf1f4',
        mix: 'normal',
        palette: 'pastel',
        blur: 48,
        glass: {
          enabled: true,
          x: 0.62,
          y: 0.44,
          w: 0.46,
          h: 0.4,
          radius: 24,
          blur: 16,
          opacity: 20,
          tint: '#ffffff',
          border: 52,
          sheen: 40,
        },
        points: [
          P(0.24, 0.3, '#ff9fc2', 0.9, 0.88),
          P(0.64, 0.22, '#c4b5fd', 0.76, 0.78),
          P(0.82, 0.66, '#ffb38f', 0.66, 0.68),
          P(0.36, 0.62, '#ffd9a3', 0.78, 0.7),
          P(0.14, 0.8, '#9fe8d5', 0.56, 0.6),
          P(0.58, 0.88, '#a8d8ff', 0.5, 0.5),
        ],
      },
    },
    {
      id: 'solar-flare',
      nameKey: 'presets.solar-flare',
      tagKey: 'tags.bold',
      state: {
        name: 'Solar Flare',
        aspect: '16:9',
        base: '#0d0400',
        mix: 'lighter',
        palette: 'ember',
        blur: 12,
        grain: { enabled: true, amount: 20, scale: 22, seed: 83, blend: 'overlay' },
        vignette: { enabled: true, amount: 30, size: 58 },
        points: [
          P(0.5, 0.4, '#ffb703', 1.1, 0.9),
          P(0.3, 0.62, '#ff8a3d', 0.7, 0.7),
          P(0.74, 0.3, '#ff4d00', 0.66, 0.7),
          P(0.68, 0.76, '#c1121f', 0.6, 0.5),
        ],
      },
    },
    {
      id: 'arctic-frost',
      nameKey: 'presets.arctic-frost',
      tagKey: 'tags.cool',
      state: {
        name: 'Arctic Frost',
        aspect: '21:9',
        base: '#04101a',
        mix: 'screen',
        palette: 'ocean',
        blur: 34,
        grain: { enabled: true, amount: 10, scale: 70, seed: 29, blend: 'soft-light' },
        points: [
          P(0.18, 0.32, '#67e8f9', 0.8, 0.8),
          P(0.5, 0.2, '#22d3ee', 0.7, 0.75),
          P(0.82, 0.36, '#0ea5e9', 0.7, 0.7),
          P(0.36, 0.7, '#2563eb', 0.72, 0.6),
          P(0.7, 0.78, '#0f766e', 0.64, 0.5),
          P(0.92, 0.7, '#22d3ee', 0.42, 0.4),
        ],
      },
    },
    {
      id: 'plum-noir',
      nameKey: 'presets.plum-noir',
      tagKey: 'tags.dark',
      state: {
        name: 'Plum Noir',
        aspect: '1:1',
        base: '#0b0410',
        mix: 'screen',
        palette: 'neon',
        blur: 16,
        grain: { enabled: true, amount: 30, scale: 48, seed: 47, blend: 'overlay' },
        vignette: { enabled: true, amount: 58, size: 76 },
        glass: {
          enabled: true,
          x: 0.5,
          y: 0.52,
          w: 0.6,
          h: 0.46,
          radius: 26,
          blur: 20,
          opacity: 12,
          tint: '#f4e8ff',
          border: 38,
          sheen: 28,
        },
        points: [
          P(0.24, 0.26, '#a855f7', 0.8, 0.85),
          P(0.7, 0.22, '#ff2d95', 0.66, 0.75),
          P(0.82, 0.62, '#00f0ff', 0.5, 0.4),
          P(0.3, 0.72, '#a855f7', 0.7, 0.6),
          P(0.56, 0.9, '#ff2d95', 0.5, 0.45),
        ],
      },
    },
    {
      id: 'glass-panel',
      nameKey: 'presets.glass-panel',
      tagKey: 'tags.glass',
      state: {
        name: 'Glass Panel',
        aspect: '16:9',
        base: '#101018',
        mix: 'screen',
        palette: 'mono',
        blur: 20,
        grain: { enabled: true, amount: 12, scale: 40, seed: 71, blend: 'overlay' },
        glass: {
          enabled: true,
          x: 0.5,
          y: 0.5,
          w: 0.58,
          h: 0.5,
          radius: 32,
          blur: 26,
          opacity: 16,
          tint: '#ffffff',
          border: 56,
          sheen: 46,
        },
        points: [
          P(0.22, 0.3, '#c7c7d1', 0.7, 0.5),
          P(0.64, 0.24, '#f5f5f7', 0.6, 0.4),
          P(0.82, 0.66, '#8b8b99', 0.6, 0.4),
          P(0.32, 0.74, '#4a4a57', 0.8, 0.5),
        ],
      },
    },
    {
      id: 'mono-grain',
      nameKey: 'presets.mono-grain',
      tagKey: 'tags.dark',
      state: {
        name: 'Mono Grain',
        aspect: '21:9',
        base: '#0b0b10',
        mix: 'screen',
        palette: 'mono',
        blur: 8,
        grain: { enabled: true, amount: 64, scale: 58, seed: 97, blend: 'overlay' },
        vignette: { enabled: true, amount: 60, size: 80 },
        points: [
          P(0.16, 0.4, '#f5f5f7', 0.5, 0.35),
          P(0.42, 0.6, '#c7c7d1', 0.6, 0.4),
          P(0.66, 0.28, '#8b8b99', 0.7, 0.45),
          P(0.86, 0.62, '#4a4a57', 0.55, 0.4),
          P(0.56, 0.84, '#1c1c24', 0.6, 0.35),
        ],
      },
    },
  ];

  function findByPresetId(id) {
    for (var i = 0; i < PRESETS.length; i += 1) {
      if (PRESETS[i].id === id) return PRESETS[i];
    }
    return null;
  }

  function buildPresets() {
    return PRESET_DEFS.map(function (def) {
      return {
        id: def.id,
        nameKey: def.nameKey,
        tagKey: def.tagKey,
        state: normalize(def.state),
      };
    });
  }

  var PRESETS = buildPresets();

  /* ----------------------------------------------------------------------- API */

  return {
    VERSION: VERSION,
    ASPECTS: ASPECTS,
    LIMITS: LIMITS,
    MIX_MODES: MIX_MODES,
    GRAIN_BLENDS: GRAIN_BLENDS,
    PALETTES: PALETTES,
    PRESETS: PRESETS,
    createState: createState,
    aspectOf: aspectOf,
    dimensionsOf: dimensionsOf,
    clone: clone,
    normalize: normalize,
    validState: validState,
    newPoint: newPoint,
    addPoint: addPoint,
    removePoint: removePoint,
    patchPoint: patchPoint,
    setAspect: setAspect,
    applyPreset: applyPreset,
    randomize: randomize,
    recolor: recolor,
    serialize: serialize,
    deserialize: deserialize,
    toCSS: toCSS,
    toJSON: toJSON,
    filename: filename,
    formatDimensions: formatDimensions,
    blurPx: blurPx,
    grainTileSize: grainTileSize,
    contrastText: contrastText,
    color: color,
  };
})();

/* ---------------------------------------------------------------- dictionary */

MF.strings = MF.strings || {};
MF.strings.model = {
  en: {
    'model.node': 'Node',
    'model.nodes': 'Nodes',
    'aspect.16:9': 'Widescreen',
    'aspect.4:3': 'Standard',
    'aspect.1:1': 'Square',
    'aspect.9:16': 'Portrait',
    'aspect.3:2': 'Photo',
    'aspect.21:9': 'Cinematic',
    'aspect.2:3': 'Tall',
    'aspect.a4': 'A4 Print',
    'mix.normal': 'Normal',
    'mix.screen': 'Screen',
    'mix.overlay': 'Overlay',
    'mix.soft-light': 'Soft light',
    'mix.lighter': 'Lighter',
    'palette.aurora': 'Aurora',
    'palette.sunset': 'Sunset',
    'palette.ocean': 'Ocean',
    'palette.neon': 'Neon',
    'palette.pastel': 'Pastel',
    'palette.forest': 'Forest',
    'palette.ember': 'Ember',
    'palette.mono': 'Mono',
    'tags.soft': 'Soft',
    'tags.bold': 'Bold',
    'tags.dark': 'Dark',
    'tags.warm': 'Warm',
    'tags.cool': 'Cool',
    'tags.glass': 'Glass',
    'presets.aurora-veil': 'Aurora Veil',
    'presets.peach-haze': 'Peach Haze',
    'presets.deep-orbit': 'Deep Orbit',
    'presets.neon-tokyo': 'Neon Tokyo',
    'presets.cotton-cloud': 'Cotton Cloud',
    'presets.mint-glacier': 'Mint Glacier',
    'presets.ember-dusk': 'Ember Dusk',
    'presets.violet-drift': 'Violet Drift',
    'presets.midnight-mesh': 'Midnight Mesh',
    'presets.citrus-pop': 'Citrus Pop',
    'presets.rose-quartz': 'Rose Quartz',
    'presets.solar-flare': 'Solar Flare',
    'presets.arctic-frost': 'Arctic Frost',
    'presets.plum-noir': 'Plum Noir',
    'presets.glass-panel': 'Glass Panel',
    'presets.mono-grain': 'Mono Grain',
  },
  zh: {
    'model.node': '节点',
    'model.nodes': '节点',
    'aspect.16:9': '宽屏',
    'aspect.4:3': '标准',
    'aspect.1:1': '方形',
    'aspect.9:16': '竖版',
    'aspect.3:2': '摄影',
    'aspect.21:9': '宽银幕',
    'aspect.2:3': '竖幅',
    'aspect.a4': 'A4 纸张',
    'mix.normal': '正常',
    'mix.screen': '滤色',
    'mix.overlay': '叠加',
    'mix.soft-light': '柔光',
    'mix.lighter': '提亮',
    'palette.aurora': '极光',
    'palette.sunset': '日落',
    'palette.ocean': '海洋',
    'palette.neon': '霓虹',
    'palette.pastel': '粉彩',
    'palette.forest': '森林',
    'palette.ember': '余烬',
    'palette.mono': '单色',
    'tags.soft': '柔和',
    'tags.bold': '大胆',
    'tags.dark': '暗色',
    'tags.warm': '暖调',
    'tags.cool': '冷调',
    'tags.glass': '玻璃',
    'presets.aurora-veil': '极光帷幕',
    'presets.peach-haze': '蜜桃薄雾',
    'presets.deep-orbit': '深空轨道',
    'presets.neon-tokyo': '霓虹东京',
    'presets.cotton-cloud': '棉花云',
    'presets.mint-glacier': '薄荷冰川',
    'presets.ember-dusk': '余烬黄昏',
    'presets.violet-drift': '紫罗兰漂流',
    'presets.midnight-mesh': '午夜网格',
    'presets.citrus-pop': '柑橘汽水',
    'presets.rose-quartz': '玫瑰石英',
    'presets.solar-flare': '太阳耀斑',
    'presets.arctic-frost': '北极寒霜',
    'presets.plum-noir': '梅子暗夜',
    'presets.glass-panel': '玻璃面板',
    'presets.mono-grain': '单色颗粒',
  },
};

/** Convenience alias: the model dictionary is also reachable from MF.model.strings. */
MF.model.strings = MF.strings.model;
