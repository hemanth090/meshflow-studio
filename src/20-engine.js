/**
 * 20-engine.js - MF.engine: the MeshFlow Studio canvas renderer.
 *
 * Draws one composition (see CONTRACT.md "Composition state") into a 2D canvas:
 *
 *   base fill → point blobs (one reusable offscreen layer, composited once with the
 *   mix mode) → whole-canvas blur (feature-detected ctx.filter) → vignette → grain
 *   tile pattern → glassmorphism card → optional guides.
 *
 * Everything is deterministic for a given state. No DOM access happens at module
 * evaluation time: `document` / `OffscreenCanvas` are only touched inside functions,
 * and every stage is defensive so a hostile context or a broken canvas cannot make
 * the studio throw.
 *
 * Public members:
 *   MF.engine.PIPELINE               - stage names in drawing order (pure)
 *   MF.engine.mixToComposite(mode)   - state.mix → canvas globalCompositeOperation
 *   MF.engine.grainBlendToComposite(blend)
 *   MF.engine.glassRect(state, w, h) - clamped glass card geometry in logical px
 *   MF.engine.render(canvas, state, options) → { width, height }
 *   MF.engine.renderToCanvas(state, options) → canvas | null
 *   MF.engine.exportCanvas(state, scale) → canvas | null
 *   MF.engine.toDataURL(state, scale) → string
 */
MF.engine = (function () {
  'use strict';

  var PIPELINE = Object.freeze(['base', 'blobs', 'blur', 'vignette', 'grain', 'glass', 'guides']);

  var MIX_TO_COMPOSITE = {
    normal: 'source-over',
    screen: 'screen',
    overlay: 'overlay',
    'soft-light': 'soft-light',
    lighter: 'lighter',
  };

  var GRAIN_TO_COMPOSITE = {
    overlay: 'overlay',
    'soft-light': 'soft-light',
    normal: 'source-over',
  };

  var MAX_LAYERS = 3;
  var MAX_BUFFERS = 4;
  var MAX_TILES = 8;
  var MAX_CACHED_PIXELS = 6000000; // do not pin multi-megapixel export buffers in memory
  var DEFAULT_WIDTH = 1600;
  var DEFAULT_HEIGHT = 900;

  /** Per-context ctx.filter support (detected once). */
  var FILTER_SUPPORT = typeof WeakMap === 'function' ? new WeakMap() : null;

  /* ------------------------------------------------------------------ caches */

  function makeStore(max) {
    return { max: max, keys: [], map: {} };
  }

  var LAYERS = makeStore(MAX_LAYERS); // blob layers keyed by `WxH` in device pixels
  var BUFFERS = makeStore(MAX_BUFFERS); // blur/glass snapshots keyed by stage + size
  var TILES = makeStore(MAX_TILES); // grain tiles keyed by `seed:tileSize`

  function cacheGet(store, key) {
    return store.map[key] || null;
  }

  function cacheSet(store, key, value) {
    if (!value) return value;
    // Oversized export buffers are used once and then left to the GC instead of being cached.
    if (value.width && value.height && value.width * value.height > MAX_CACHED_PIXELS) return value;
    if (!Object.prototype.hasOwnProperty.call(store.map, key)) {
      store.map[key] = value;
      store.keys.push(key);
      while (store.keys.length > store.max) {
        var stale = store.keys.shift();
        if (stale !== key) delete store.map[stale];
      }
    } else {
      store.map[key] = value;
    }
    return value;
  }

  /* ------------------------------------------------------------------ basics */

  function clamp(value, min, max) {
    if (MF.util && typeof MF.util.clamp === 'function') return MF.util.clamp(value, min, max);
    var n = Number(value);
    if (!isFinite(n)) return min;
    return n < min ? min : n > max ? max : n;
  }

  function num(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function round(value) {
    var n = Number(value);
    return isFinite(n) ? Math.round(n) : 0;
  }

  function rgbaWhite(alpha) {
    return 'rgba(255,255,255,' + Math.round(clamp(alpha, 0, 1) * 1000) / 1000 + ')';
  }

  function rgbaBlack(alpha) {
    return 'rgba(0,0,0,' + Math.round(clamp(alpha, 0, 1) * 1000) / 1000 + ')';
  }

  /** Fallback PRNG, only used when the shared MF.util has none. */
  function fallbackRng(seed) {
    var s = (round(seed) || 1) >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function randomFn(seed) {
    if (MF.util && typeof MF.util.mulberry32 === 'function') {
      try {
        return MF.util.mulberry32(seed);
      } catch (e) {
        /* fall through */
      }
    }
    return fallbackRng(seed);
  }

  function hasDocument() {
    try {
      return typeof document !== 'undefined' && !!document && typeof document.createElement === 'function';
    } catch (e) {
      return false;
    }
  }

  /** Create a detached canvas; null when the environment has no canvas support. */
  function createCanvas(width, height) {
    var w = Math.max(1, round(width));
    var h = Math.max(1, round(height));
    try {
      if (hasDocument()) {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        return canvas;
      }
    } catch (e) {
      /* fall through to OffscreenCanvas */
    }
    try {
      if (typeof OffscreenCanvas !== 'undefined' && OffscreenCanvas) {
        return new OffscreenCanvas(w, h);
      }
    } catch (e2) {
      /* no canvas support */
    }
    return null;
  }

  function get2d(canvas) {
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
      return canvas.getContext('2d') || null;
    } catch (e) {
      return null;
    }
  }

  /** Return a same-size buffer canvas from the cache (contents cleared by the caller). */
  function bufferFor(key, width, height) {
    var buffer = cacheGet(BUFFERS, key);
    if (buffer && buffer.width === width && buffer.height === height) return buffer;
    buffer = createCanvas(width, height);
    if (!buffer) return null;
    return cacheSet(BUFFERS, key, buffer);
  }

  /** Snapshot the canvas into a cached buffer and return its 2D context (or null). */
  function snapshot(source, key) {
    var width = Math.max(1, round(source.width));
    var height = Math.max(1, round(source.height));
    var buffer = bufferFor(key, width, height);
    if (!buffer) return null;
    var ctx = get2d(buffer);
    if (!ctx) return null;
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0);
      return ctx;
    } catch (e) {
      return null;
    }
  }

  /** Detect ctx.filter once per context; a throwing/absent filter means "unsupported". */
  function supportsFilter(ctx) {
    if (!ctx) return false;
    if (FILTER_SUPPORT) {
      var cached = FILTER_SUPPORT.get(ctx);
      if (cached !== undefined) return cached;
    }
    var ok = false;
    try {
      ok = typeof ctx.filter === 'string';
      if (ok) {
        var previous = ctx.filter;
        ctx.filter = 'blur(1px)';
        ok = ctx.filter === 'blur(1px)';
        ctx.filter = previous === undefined ? 'none' : previous;
      }
    } catch (e) {
      ok = false;
    }
    if (FILTER_SUPPORT) {
      try {
        FILTER_SUPPORT.set(ctx, ok);
      } catch (e2) {
        /* ignore */
      }
    }
    return ok;
  }

  /* ------------------------------------------------------------- model bridge */

  /** Contract: every public entry starts with MF.model.normalize(state). Never throws. */
  function normalizeState(state) {
    var model = MF.model;
    if (model && typeof model.normalize === 'function') {
      try {
        var next = model.normalize(state);
        if (next && typeof next === 'object') return next;
      } catch (e) {
        /* fall back to the raw value */
      }
    }
    return state && typeof state === 'object' ? state : {};
  }

  function dimensionsOf(state) {
    var model = MF.model;
    if (model && typeof model.dimensionsOf === 'function') {
      try {
        var dims = model.dimensionsOf(state);
        if (dims && isFinite(Number(dims.width)) && isFinite(Number(dims.height))) {
          return {
            width: Math.max(1, Number(dims.width)),
            height: Math.max(1, Number(dims.height)),
          };
        }
      } catch (e) {
        /* fall through */
      }
    }
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }

  function colorWithAlpha(hex, alpha) {
    var color = MF.model && MF.model.color;
    if (color && typeof color.withAlpha === 'function') {
      try {
        return color.withAlpha(hex, alpha);
      } catch (e) {
        /* fall through */
      }
    }
    return 'rgba(255,255,255,' + Math.round(clamp(alpha, 0, 1) * 1000) / 1000 + ')';
  }

  function modelBlurPx(state) {
    var model = MF.model;
    if (model && typeof model.blurPx === 'function') {
      try {
        return Math.max(0, num(model.blurPx(state), 0));
      } catch (e) {
        /* fall through */
      }
    }
    return 0;
  }

  function modelGrainTileSize(state) {
    var model = MF.model;
    if (model && typeof model.grainTileSize === 'function') {
      try {
        return clamp(round(model.grainTileSize(state)), 4, 256);
      } catch (e) {
        /* fall through */
      }
    }
    return 96;
  }

  function pointsOf(state) {
    var points = state && state.points;
    return Array.isArray(points) ? points : [];
  }

  /** Render-size relative factor: 1 for an export, < 1 for a smaller preview. */
  function renderRatio(state, width, height) {
    var dims = dimensionsOf(state);
    var natural = Math.max(dims.width, dims.height) || 1;
    var target = Math.max(width, height) || 1;
    return clamp(target / natural, 0.04, 4);
  }

  /* ------------------------------------------------------------ pure mappings */

  function mixToComposite(mode) {
    return Object.prototype.hasOwnProperty.call(MIX_TO_COMPOSITE, mode)
      ? MIX_TO_COMPOSITE[mode]
      : 'source-over';
  }

  function grainBlendToComposite(blend) {
    return Object.prototype.hasOwnProperty.call(GRAIN_TO_COMPOSITE, blend)
      ? GRAIN_TO_COMPOSITE[blend]
      : 'source-over';
  }

  /** Clamped glass card geometry in logical pixels: x/y = top-left corner. */
  function glassRect(state, width, height) {
    var glass = (state && state.glass) || {};
    var w = clamp(num(glass.w, 0.52), 0.02, 1) * width;
    var h = clamp(num(glass.h, 0.42), 0.02, 1) * height;
    if (!(w > 0) || !(h > 0)) return null;
    var cx = clamp(num(glass.x, 0.5), 0, 1) * width;
    var cy = clamp(num(glass.y, 0.5), 0, 1) * height;
    var left = clamp(cx - w / 2, 0, Math.max(0, width - w));
    var top = clamp(cy - h / 2, 0, Math.max(0, height - h));
    var radius = clamp(num(glass.radius, 28), 0, Math.min(w, h) / 2);
    return { x: left, y: top, w: w, h: h, r: radius };
  }

  /* ---------------------------------------------------------------- painting */

  function roundRectPath(ctx, x, y, w, h, radius) {
    var r = Math.max(0, Math.min(radius, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /**
   * Stage 1: base fill.
   */
  function drawBase(ctx, width, height, state) {
    try {
      ctx.save();
      // Drawn under the logical (pixelRatio) transform set by render().
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = typeof state.base === 'string' ? state.base : '#0a0a12';
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    } catch (e) {
      /* never throw */
    }
  }

  /**
   * Stage 2: all point blobs on one cached offscreen layer, composited once.
   */
  function drawBlobs(ctx, width, height, pixelRatio, state) {
    var points = pointsOf(state);
    if (!points.length) return;
    var px = Math.max(1, round(width * pixelRatio));
    var py = Math.max(1, round(height * pixelRatio));
    var key = px + 'x' + py;
    var layer = cacheGet(LAYERS, key);
    if (!layer || layer.width !== px || layer.height !== py) {
      layer = createCanvas(px, py);
      if (!layer) return;
      cacheSet(LAYERS, key, layer);
    }
    var lctx = get2d(layer);
    if (!lctx) return;

    try {
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.globalCompositeOperation = 'source-over';
      lctx.globalAlpha = 1;
      try {
        lctx.filter = 'none';
      } catch (eFilter) {
        /* filter unsupported */
      }
      lctx.clearRect(0, 0, px, py);

      var maxSide = Math.max(px, py);
      for (var i = 0; i < points.length; i += 1) {
        var point = points[i];
        if (!point || typeof point !== 'object') continue;
        var radius = Math.max(0.5, num(point.size, 0.5) * maxSide);
        var cx = num(point.x, 0.5) * px;
        var cy = num(point.y, 0.5) * py;
        var alpha = clamp(num(point.opacity, 1), 0, 1);
        try {
          var gradient = lctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          gradient.addColorStop(0, colorWithAlpha(point.color, alpha));
          gradient.addColorStop(0.72, colorWithAlpha(point.color, 0));
          gradient.addColorStop(1, colorWithAlpha(point.color, 0));
          lctx.fillStyle = gradient;
          lctx.beginPath();
          lctx.arc(cx, cy, radius, 0, Math.PI * 2);
          lctx.fill();
        } catch (ePoint) {
          /* one broken point must not kill the layer */
        }
      }
    } catch (e) {
      return;
    }

    try {
      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.globalCompositeOperation = mixToComposite(state.mix);
      ctx.globalAlpha = 1;
      ctx.drawImage(layer, 0, 0, width, height);
      ctx.restore();
    } catch (e2) {
      /* compositing failed; layer stays cached for the next frame */
    }
  }

  /**
   * Stage 3: whole-canvas Gaussian blur through a snapshot (avoids self-read artefacts).
   */
  function drawBlur(canvas, ctx, width, height, pixelRatio, state, ratio) {
    var logical = modelBlurPx(state) * ratio;
    if (!(logical > 0.25)) return;
    if (!supportsFilter(ctx)) return;
    var pw = Math.max(1, round(canvas.width));
    var ph = Math.max(1, round(canvas.height));
    var bufferCtx = snapshot(canvas, 'blur:' + pw + 'x' + ph);
    if (!bufferCtx) return;
    try {
      var buffer = bufferCtx.canvas;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.filter = 'blur(' + Math.round(logical * pixelRatio * 10) / 10 + 'px)';
      ctx.clearRect(0, 0, pw, ph);
      ctx.drawImage(buffer, 0, 0, pw, ph);
    } catch (e) {
      /* ignore: keep the unblurred frame */
    } finally {
      try {
        ctx.filter = 'none';
      } catch (e2) {
        /* ignore */
      }
      try {
        ctx.restore();
      } catch (e3) {
        /* ignore */
      }
    }
  }

  /**
   * Stage 4: vignette - transparent centre, darkened corners.
   */
  function drawVignette(ctx, width, height, state) {
    var vignette = (state && state.vignette) || {};
    if (!vignette.enabled) return;
    var amount = clamp(num(vignette.amount, 24), 0, 100) / 100;
    if (!(amount > 0)) return;
    var size = clamp(num(vignette.size, 60), 0, 100) / 100;
    try {
      ctx.save();
      // Drawn under the logical (pixelRatio) transform set by render().
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      var cx = width / 2;
      var cy = height / 2;
      var outer = Math.max(width, height) * 0.78;
      var inner = clamp(size * 0.62, 0, 0.95);
      var gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outer);
      gradient.addColorStop(0, rgbaBlack(0));
      gradient.addColorStop(inner, rgbaBlack(0));
      gradient.addColorStop(1, rgbaBlack(amount * 0.92));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    } catch (e) {
      /* never throw */
    } finally {
      try {
        ctx.restore();
      } catch (e2) {
        /* ignore */
      }
    }
  }

  /** Grain tile size in device pixels, scaled so previews match the export's grain. */
  function tileSizeFor(state, ratio, pixelRatio) {
    var natural = modelGrainTileSize(state);
    return clamp(round(natural * ratio * pixelRatio), 4, 256);
  }

  /** Deterministic monochrome noise tile, cached by `seed:size`. */
  function buildNoiseTile(seed, size) {
    var canvas = createCanvas(size, size);
    if (!canvas) return null;
    var ctx = get2d(canvas);
    if (!ctx) return null;
    var rng = randomFn(seed);

    try {
      if (typeof ctx.createImageData === 'function') {
        var image = ctx.createImageData(size, size);
        if (image && image.data && image.data.length === size * size * 4) {
          var data = image.data;
          for (var i = 0; i < data.length; i += 4) {
            var value = 128 + Math.round((rng() * 2 - 1) * 96);
            data[i] = value;
            data[i + 1] = value;
            data[i + 2] = value;
            data[i + 3] = 255;
          }
          ctx.putImageData(image, 0, 0);
          return canvas;
        }
      }
    } catch (e) {
      /* fall back to per-pixel rects */
    }

    try {
      for (var y = 0; y < size; y += 1) {
        for (var x = 0; x < size; x += 1) {
          var v = 128 + Math.round((rng() * 2 - 1) * 96);
          ctx.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    } catch (e2) {
      return null;
    }
    return canvas;
  }

  /**
   * Stage 5: grain - repeating noise tile in device pixels with amount/blend applied.
   */
  function drawGrain(canvas, ctx, width, height, pixelRatio, state, ratio) {
    var grain = (state && state.grain) || {};
    if (!grain.enabled) return;
    var amount = clamp(num(grain.amount, 0), 0, 100) / 100;
    if (!(amount > 0)) return;
    var size = tileSizeFor(state, ratio, pixelRatio);
    var seed = clamp(round(num(grain.seed, 7)), 1, 9999);
    var key = seed + ':' + size;
    var tile = cacheGet(TILES, key);
    if (!tile) {
      tile = buildNoiseTile(seed, size);
      if (tile) cacheSet(TILES, key, tile);
    }
    if (!tile) return;

    var pw = Math.max(1, round(canvas.width));
    var ph = Math.max(1, round(canvas.height));
    try {
      var pattern = ctx.createPattern(tile, 'repeat');
      if (!pattern) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = grainBlendToComposite(grain.blend);
      ctx.globalAlpha = amount;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, pw, ph);
    } catch (e) {
      /* never throw */
    } finally {
      try {
        ctx.globalAlpha = 1;
      } catch (e2) {
        /* ignore */
      }
      try {
        ctx.globalCompositeOperation = 'source-over';
      } catch (e3) {
        /* ignore */
      }
      try {
        ctx.restore();
      } catch (e4) {
        /* ignore */
      }
    }
  }

  /**
   * Stage 6: glassmorphism card - frosted backdrop, tint, sheen, highlight, border.
   */
  function drawGlass(canvas, ctx, width, height, pixelRatio, state, ratio) {
    var glass = (state && state.glass) || {};
    if (!glass.enabled) return;
    var rect = glassRect(state, width, height);
    if (!rect || rect.w < 2 || rect.h < 2) return;

    var pw = Math.max(1, round(canvas.width));
    var ph = Math.max(1, round(canvas.height));
    var bufferCtx = snapshot(canvas, 'glass:' + pw + 'x' + ph);
    if (!bufferCtx) return;
    var buffer = bufferCtx.canvas;

    var x = rect.x * pixelRatio;
    var y = rect.y * pixelRatio;
    var w = rect.w * pixelRatio;
    var h = rect.h * pixelRatio;
    var r = rect.r * pixelRatio;
    var blur = clamp(num(glass.blur, 18), 0, 60) * ratio * pixelRatio;
    var tint = typeof glass.tint === 'string' ? glass.tint : '#ffffff';
    var opacity = clamp(num(glass.opacity, 14), 0, 100) / 100;
    var border = clamp(num(glass.border, 40), 0, 100) / 100;
    var sheen = clamp(num(glass.sheen, 30), 0, 100) / 100;
    var hasFilter = supportsFilter(ctx);
    var hairline = Math.max(1, round(pixelRatio));

    try {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      try {
        ctx.filter = 'none';
      } catch (eFilter) {
        /* unsupported */
      }

      // Clip to the rounded card, then draw the frosted backdrop through a blur.
      roundRectPath(ctx, x, y, w, h, r);
      ctx.clip();
      if (hasFilter && blur > 0.4) {
        try {
          ctx.filter = 'blur(' + Math.round(blur * 10) / 10 + 'px)';
        } catch (eBlurFilter) {
          /* keep the unblurred backdrop */
        }
      }
      ctx.drawImage(buffer, 0, 0, pw, ph);
      try {
        ctx.filter = 'none';
      } catch (eResetFilter) {
        /* ignore */
      }

      // Tint.
      if (opacity > 0) {
        ctx.globalAlpha = opacity;
        ctx.fillStyle = tint;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }

      // Diagonal sheen.
      if (sheen > 0) {
        try {
          var sheenGradient = ctx.createLinearGradient(x, y, x + w, y + h);
          sheenGradient.addColorStop(0, rgbaWhite(sheen * 0.55));
          sheenGradient.addColorStop(0.45, rgbaWhite(sheen * 0.08));
          sheenGradient.addColorStop(1, rgbaWhite(0));
          ctx.fillStyle = sheenGradient;
          ctx.fillRect(x, y, w, h);
        } catch (eSheen) {
          /* ignore */
        }
      }

      // 1 logical px top highlight.
      try {
        var highlightWidth = Math.max(0, w - r * 2);
        if (highlightWidth > 0) {
          var highlightGradient = ctx.createLinearGradient(x, y, x + w, y);
          highlightGradient.addColorStop(0, rgbaWhite(0));
          highlightGradient.addColorStop(0.5, rgbaWhite(0.34));
          highlightGradient.addColorStop(1, rgbaWhite(0));
          ctx.fillStyle = highlightGradient;
          ctx.fillRect(x + Math.min(r, highlightWidth), y, highlightWidth, hairline);
        }
      } catch (eHighlight) {
        /* ignore */
      }

      // Border stroke.
      if (border > 0) {
        ctx.globalAlpha = border * 0.6;
        ctx.strokeStyle = rgbaWhite(0.9);
        ctx.lineWidth = hairline;
        var inset = hairline / 2;
        roundRectPath(
          ctx,
          x + inset,
          y + inset,
          Math.max(0, w - hairline),
          Math.max(0, h - hairline),
          Math.max(0, r - inset)
        );
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    } catch (e) {
      /* never leave the canvas broken by a glass failure */
    } finally {
      try {
        ctx.filter = 'none';
      } catch (e2) {
        /* ignore */
      }
      try {
        ctx.globalCompositeOperation = 'source-over';
      } catch (e3) {
        /* ignore */
      }
      try {
        ctx.globalAlpha = 1;
      } catch (e4) {
        /* ignore */
      }
      try {
        ctx.restore();
      } catch (e5) {
        /* ignore */
      }
    }
  }

  /**
   * Stage 7: optional editor guides (bounds + 4px crosshair arms).
   */
  function drawGuides(ctx, width, height, state) {
    try {
      ctx.save();
      // Drawn under the logical (pixelRatio) transform set by render().
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgbaWhite(0.55);
      ctx.strokeRect(0.5, 0.5, Math.max(0, width - 1), Math.max(0, height - 1));

      ctx.strokeStyle = rgbaWhite(0.85);
      var arm = 4;
      var points = pointsOf(state);
      ctx.beginPath();
      for (var i = 0; i < points.length; i += 1) {
        var point = points[i];
        if (!point || typeof point !== 'object') continue;
        var px = num(point.x, 0.5) * width;
        var py = num(point.y, 0.5) * height;
        ctx.moveTo(px - arm, py);
        ctx.lineTo(px + arm, py);
        ctx.moveTo(px, py - arm);
        ctx.lineTo(px, py + arm);
      }
      ctx.stroke();
    } catch (e) {
      /* never throw */
    } finally {
      try {
        ctx.restore();
      } catch (e2) {
        /* ignore */
      }
    }
  }

  /* ---------------------------------------------------------------- public API */

  /**
   * Draw `state` into an existing canvas.
   * options = { width, height, pixelRatio = 1, draft = false, guides = false }
   * Returns the logical size { width, height }.
   */
  function render(canvas, state, options) {
    var opts = options || {};
    var normalized = normalizeState(state);
    var dims = dimensionsOf(normalized);
    var width = Math.max(1, num(opts.width, dims.width));
    var height = Math.max(1, num(opts.height, dims.height));
    var pixelRatio = clamp(num(opts.pixelRatio, 1), 0.25, 3);
    if (opts.draft) pixelRatio = Math.min(pixelRatio, 1);
    var result = { width: width, height: height };
    if (!canvas || typeof canvas !== 'object') return result;

    var pw = Math.max(1, round(width * pixelRatio));
    var ph = Math.max(1, round(height * pixelRatio));
    try {
      canvas.width = pw;
      canvas.height = ph;
    } catch (eSize) {
      return result;
    }

    var ctx = get2d(canvas);
    if (!ctx) return result;

    var ratio = renderRatio(normalized, width, height);

    try {
      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      try {
        ctx.filter = 'none';
      } catch (eFilter) {
        /* unsupported filter: stages feature-detect on their own */
      }

      drawBase(ctx, width, height, normalized);
      drawBlobs(ctx, width, height, pixelRatio, normalized);
      drawBlur(canvas, ctx, width, height, pixelRatio, normalized, ratio);
      drawVignette(ctx, width, height, normalized);
      drawGrain(canvas, ctx, width, height, pixelRatio, normalized, ratio);
      drawGlass(canvas, ctx, width, height, pixelRatio, normalized, ratio);
      if (opts.guides) drawGuides(ctx, width, height, normalized);
    } catch (e) {
      /* render() must never throw */
    } finally {
      try {
        ctx.filter = 'none';
      } catch (e2) {
        /* ignore */
      }
      try {
        ctx.globalCompositeOperation = 'source-over';
      } catch (e3) {
        /* ignore */
      }
      try {
        ctx.globalAlpha = 1;
      } catch (e4) {
        /* ignore */
      }
      try {
        ctx.restore();
      } catch (e5) {
        /* ignore */
      }
    }

    return result;
  }

  /** Render into a new detached canvas; null when the environment cannot create one. */
  function renderToCanvas(state, options) {
    var opts = options || {};
    var normalized = normalizeState(state);
    var dims = dimensionsOf(normalized);
    var width = Math.max(1, num(opts.width, dims.width));
    var height = Math.max(1, num(opts.height, dims.height));
    var pixelRatio = clamp(num(opts.pixelRatio, 1), 0.25, 3);
    var canvas = createCanvas(round(width * pixelRatio), round(height * pixelRatio));
    if (!canvas) return null;
    render(canvas, normalized, {
      width: width,
      height: height,
      pixelRatio: pixelRatio,
      draft: !!opts.draft,
      guides: !!opts.guides,
    });
    return canvas;
  }

  /** Full-resolution offscreen canvas for export: dimensionsOf(state) * scale, longest side ≤ 8192. */
  function exportCanvas(state, scale) {
    var normalized = normalizeState(state);
    var dims = dimensionsOf(normalized);
    var factor = clamp(num(scale, 1), 0.1, 8);
    var width = Math.max(1, round(dims.width * factor));
    var height = Math.max(1, round(dims.height * factor));
    var longest = Math.max(width, height);
    if (longest > 8192) {
      var shrink = 8192 / longest;
      width = Math.max(1, Math.round(width * shrink));
      height = Math.max(1, Math.round(height * shrink));
    }
    return renderToCanvas(normalized, { width: width, height: height, pixelRatio: 1 });
  }

  /** PNG data URL of the composition; empty string when a canvas cannot be produced. */
  function toDataURL(state, scale) {
    var normalized = normalizeState(state);
    var canvas = exportCanvas(normalized, scale);
    if (!canvas || typeof canvas.toDataURL !== 'function') return '';
    try {
      return canvas.toDataURL('image/png');
    } catch (e) {
      return '';
    }
  }

  return {
    PIPELINE: PIPELINE,
    mixToComposite: mixToComposite,
    grainBlendToComposite: grainBlendToComposite,
    glassRect: glassRect,
    render: render,
    renderToCanvas: renderToCanvas,
    exportCanvas: exportCanvas,
    toDataURL: toDataURL,
  };
})();
