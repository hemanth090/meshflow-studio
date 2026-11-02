/**
 * test/engine.test.mjs - tests for src/20-engine.js (MF.engine).
 *
 * The fragment and the real prelude are loaded together under node:vm with an injected
 * MF.model stub (10-model.js is written in parallel by another teammate, so this test only
 * depends on the CONTRACT surface). Nothing here needs a browser: a tiny fake canvas /
 * 2D-context records the draw operations so the pipeline order, blend modes and cleanup
 * can be asserted honestly, and a hostile sandbox proves loading never touches the DOM.
 *
 * Run: node --test test/engine.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const preludeSource = readFileSync(join(root, 'src', '00-prelude.js'), 'utf8');
const engineSource = readFileSync(join(root, 'src', '20-engine.js'), 'utf8');

/* -------------------------------------------------------------- model stub */

function makeModelStub() {
  const flags = { normalizeCalls: 0, throwAll: false };

  function baseState() {
    return {
      version: 1,
      name: 'Test mesh',
      aspect: '16:9',
      base: '#0a0a12',
      mix: 'normal',
      points: [
        { id: 'p1', x: 0.28, y: 0.32, color: '#6ee7ff', size: 0.62, opacity: 1 },
        { id: 'p2', x: 0.72, y: 0.6, color: '#f472b6', size: 0.5, opacity: 0.9 },
      ],
      blur: 0,
      grain: { enabled: false, amount: 24, scale: 34, seed: 7, blend: 'overlay' },
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

  const model = {
    flags,
    baseState,
    normalize(state) {
      flags.normalizeCalls += 1;
      if (flags.throwAll) throw new Error('normalize exploded');
      if (!state || typeof state !== 'object') return baseState();
      const out = baseState();
      Object.assign(out, state);
      out.points = Array.isArray(state.points)
        ? state.points.filter((point) => point && typeof point === 'object')
        : out.points;
      return out;
    },
    dimensionsOf() {
      if (flags.throwAll) throw new Error('dimensionsOf exploded');
      return { width: 1600, height: 900 };
    },
    blurPx(state) {
      if (flags.throwAll) throw new Error('blurPx exploded');
      // Same formula as the contract's MF.model.blurPx, for an output canvas of 1600×900.
      const blur = Number(state && state.blur) || 0;
      return Math.round((blur / 100) * Math.min(1600, 900) * 0.09);
    },
    grainTileSize() {
      if (flags.throwAll) throw new Error('grainTileSize exploded');
      return 96;
    },
    color: {
      withAlpha(hex, alpha) {
        if (flags.throwAll) throw new Error('withAlpha exploded');
        return 'rgba(255,255,255,' + alpha + ')';
      },
    },
  };

  return model;
}

/* ---------------------------------------------------------- fake canvas env */

function createFakeContext() {
  const ops = [];
  const ctx = {
    ops,
    filter: 'none',
    fillStyle: '#000000',
    strokeStyle: '#000000',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    lastImageData: null,
    save() {
      ops.push({ op: 'save', filter: this.filter, alpha: this.globalAlpha, composite: this.globalCompositeOperation });
    },
    restore() {
      ops.push({ op: 'restore' });
      this.filter = 'none';
      this.globalCompositeOperation = 'source-over';
      this.globalAlpha = 1;
    },
    setTransform() {
      ops.push({ op: 'setTransform' });
    },
    clearRect() {
      ops.push({ op: 'clearRect' });
    },
    fillRect(x, y, w, h) {
      ops.push({
        op: 'fillRect',
        fillStyle: this.fillStyle,
        alpha: this.globalAlpha,
        composite: this.globalCompositeOperation,
        x,
        y,
        w,
        h,
      });
    },
    strokeRect() {
      ops.push({ op: 'strokeRect', strokeStyle: this.strokeStyle });
    },
    beginPath() {
      ops.push({ op: 'beginPath' });
    },
    closePath() {
      ops.push({ op: 'closePath' });
    },
    moveTo() {
      ops.push({ op: 'moveTo' });
    },
    lineTo() {
      ops.push({ op: 'lineTo' });
    },
    arc() {
      ops.push({ op: 'arc' });
    },
    arcTo() {
      ops.push({ op: 'arcTo' });
    },
    clip() {
      ops.push({ op: 'clip' });
    },
    fill() {
      ops.push({ op: 'fill', fillStyle: this.fillStyle, alpha: this.globalAlpha });
    },
    stroke() {
      ops.push({ op: 'stroke', strokeStyle: this.strokeStyle, alpha: this.globalAlpha });
    },
    drawImage(source, ...rest) {
      ops.push({ op: 'drawImage', source, filter: this.filter, alpha: this.globalAlpha, composite: this.globalCompositeOperation, rest });
    },
    createRadialGradient() {
      ops.push({ op: 'createRadialGradient' });
      return { addColorStop() {} };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    createPattern(tile, repeat) {
      ops.push({ op: 'createPattern', tile, repeat });
      return { __pattern: true };
    },
    createImageData(w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
    },
    putImageData(image) {
      this.lastImageData = image;
      ops.push({ op: 'putImageData', width: image.width, height: image.height });
    },
  };
  return ctx;
}

function createFakeCanvas(options = {}) {
  const ctx = createFakeContext();
  const canvas = {
    width: 0,
    height: 0,
    ctx,
    getContext(type) {
      return type === '2d' ? ctx : null;
    },
    toDataURL(type) {
      if (options.throwDataURL) throw new Error('toDataURL blocked');
      return 'data:image/png;base64,FAKEPNG:' + type;
    },
  };
  // Real 2D contexts expose their canvas; the engine uses ctx.canvas for snapshots.
  ctx.canvas = canvas;
  return canvas;
}

function createFakeDocument() {
  const options = { throwDataURL: false };
  const created = [];
  return {
    options,
    created,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = createFakeCanvas(options);
      created.push(canvas);
      return canvas;
    },
  };
}

/* ---------------------------------------------------------------- vm loader */

function loadEngine(options = {}) {
  const model = options.model || makeModelStub();
  const sandbox = { console, __model: model };

  if (options.hostileDom) {
    for (const name of ['window', 'document', 'navigator', 'localStorage', 'OffscreenCanvas', 'HTMLCanvasElement']) {
      Object.defineProperty(sandbox, name, {
        configurable: true,
        get() {
          throw new Error('DOM access during module evaluation: ' + name);
        },
      });
    }
  }

  vm.createContext(sandbox);
  vm.runInContext(preludeSource + '\n' + engineSource, sandbox, { filename: 'meshflow-bundle.js' });
  vm.runInContext('MF.model = __model;', sandbox);

  if (options.document) {
    Object.defineProperty(sandbox, 'document', {
      configurable: true,
      writable: true,
      value: options.document,
    });
  }

  const MF = vm.runInContext('MF', sandbox);
  return { sandbox, MF, model };
}

function fullState(model, overrides = {}) {
  return Object.assign(model.baseState(), overrides);
}

function threePoints() {
  return [
    { id: 'p1', x: 0.28, y: 0.32, color: '#6ee7ff', size: 0.62, opacity: 1 },
    { id: 'p2', x: 0.72, y: 0.6, color: '#f472b6', size: 0.5, opacity: 0.9 },
    { id: 'p3', x: 0.5, y: 0.2, color: '#a78bfa', size: 0.7, opacity: 0.8 },
  ];
}

/* -------------------------------------------------------------------- tests */

test('loads without touching the DOM at module evaluation time', () => {
  // Every DOM-ish global throws on access: if the fragment evaluates any of them the load
  // itself would throw, which is exactly what this test catches.
  const { MF } = loadEngine({ hostileDom: true });
  assert.equal(typeof MF.engine, 'object');
  assert.equal(typeof MF.engine.render, 'function');
});

test('exposes exactly the contract API and the documented pure helpers', () => {
  const { MF } = loadEngine();
  assert.equal(typeof MF.engine.render, 'function');
  assert.equal(typeof MF.engine.renderToCanvas, 'function');
  assert.equal(typeof MF.engine.exportCanvas, 'function');
  assert.equal(typeof MF.engine.toDataURL, 'function');
  assert.equal(typeof MF.engine.mixToComposite, 'function');
  assert.equal(typeof MF.engine.grainBlendToComposite, 'function');
  assert.equal(typeof MF.engine.glassRect, 'function');
  assert.deepEqual(Array.from(MF.engine.PIPELINE), [
    'base',
    'blobs',
    'blur',
    'vignette',
    'grain',
    'glass',
    'guides',
  ]);
});

test('pure blend-mode mappings match the contract', () => {
  const { MF } = loadEngine();
  assert.equal(MF.engine.mixToComposite('normal'), 'source-over');
  assert.equal(MF.engine.mixToComposite('screen'), 'screen');
  assert.equal(MF.engine.mixToComposite('overlay'), 'overlay');
  assert.equal(MF.engine.mixToComposite('soft-light'), 'soft-light');
  assert.equal(MF.engine.mixToComposite('lighter'), 'lighter');
  assert.equal(MF.engine.mixToComposite('nonsense'), 'source-over');
  assert.equal(MF.engine.mixToComposite('toString'), 'source-over');
  assert.equal(MF.engine.mixToComposite(undefined), 'source-over');

  assert.equal(MF.engine.grainBlendToComposite('overlay'), 'overlay');
  assert.equal(MF.engine.grainBlendToComposite('soft-light'), 'soft-light');
  assert.equal(MF.engine.grainBlendToComposite('normal'), 'source-over');
  assert.equal(MF.engine.grainBlendToComposite('bogus'), 'source-over');
});

test('glassRect returns clamped card geometry in logical pixels', () => {
  const { MF, model } = loadEngine();
  const rect = MF.engine.glassRect(model.baseState(), 1000, 500);
  assert.equal(rect.w, 520);
  assert.equal(rect.h, 210);
  assert.equal(rect.x, 240);
  assert.equal(rect.y, 145);
  assert.equal(rect.r, 28);

  // A card near the edge is clamped fully inside the canvas.
  const edge = MF.engine.glassRect(
    fullState(model, { glass: Object.assign(model.baseState().glass, { x: 0.01, y: 0.99 }) }),
    1000,
    500
  );
  assert.equal(edge.x, 0);
  assert.equal(edge.y, 500 - 210);

  // Radius is clamped to the card half-size / 0 and accepts garbage state.
  const fatRadius = MF.engine.glassRect(
    fullState(model, { glass: Object.assign(model.baseState().glass, { radius: 9999 }) }),
    1000,
    500
  );
  assert.equal(fatRadius.r, 105);
  const noGlass = MF.engine.glassRect({}, 800, 400);
  assert.equal(noGlass.w, 416);
  assert.equal(noGlass.h, 168);
  assert.equal(MF.engine.glassRect({}, 0, 0), null);
});

test('render sizes the canvas with pixelRatio and draws the pipeline in order', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  assert.equal(doc.created.length, 0, 'loading must not create canvases');

  const state = fullState(model, {
    mix: 'screen',
    blur: 40,
    points: threePoints(),
    grain: { enabled: true, amount: 30, scale: 34, seed: 3, blend: 'overlay' },
    vignette: { enabled: true, amount: 24, size: 60 },
    glass: {
      enabled: true,
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
  });

  const canvas = createFakeCanvas();
  const before = model.flags.normalizeCalls;
  const result = MF.engine.render(canvas, state, { width: 400, height: 225, pixelRatio: 2 });
  assert.equal(result.width, 400);
  assert.equal(result.height, 225);
  assert.ok(model.flags.normalizeCalls > before, 'render() must normalize the state on entry');
  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 450);

  const ctx = canvas.ctx;
  const ops = ctx.ops;

  // Base fill first.
  const base = ops.findIndex((op) => op.op === 'fillRect' && op.fillStyle === '#0a0a12');
  assert.ok(base >= 0, 'base fill missing');

  // All three blobs drawn on one offscreen layer at device resolution.
  const layer = doc.created.find(
    (created) => created.width === 800 && created.ctx.ops.some((op) => op.op === 'createRadialGradient')
  );
  assert.ok(layer, 'blob layer canvas missing');
  assert.equal(
    layer.ctx.ops.filter((op) => op.op === 'createRadialGradient').length,
    3,
    'all points must be drawn on the single blob layer'
  );

  // The blob layer is composited exactly once with the mapped mix mode.
  const layerComposite = ops.findIndex(
    (op) => op.op === 'drawImage' && op.composite === 'screen' && op.source === layer && op.rest.length === 4
  );
  assert.ok(layerComposite >= 0, 'blob layer must be composited once with the mapped mix mode');

  // Whole-canvas blur goes through the filter, drawing from an offscreen snapshot.
  const blurOp = ops.find(
    (op) =>
      op.op === 'drawImage' &&
      typeof op.filter === 'string' &&
      op.filter.indexOf('blur(') === 0 &&
      op.source &&
      typeof op.source.getContext === 'function'
  );
  assert.ok(blurOp, 'the canvas must be blurred through ctx.filter from an offscreen snapshot');

  // Vignette adds one radial gradient on the main context.
  assert.equal(ops.filter((op) => op.op === 'createRadialGradient').length, 1);

  // Grain: repeating pattern, overlay blend, globalAlpha = amount / 100.
  const grain = ops.find((op) => op.op === 'fillRect' && op.alpha === 0.3 && op.composite === 'overlay');
  assert.ok(grain, 'grain must be composited at amount/100 with the overlay blend mode');
  const pattern = ops.find((op) => op.op === 'createPattern');
  assert.ok(pattern, 'grain pattern missing');
  assert.equal(pattern.repeat, 'repeat');

  // Glass: clipped rounded card with a blurred backdrop, tint and border.
  const clipIndex = ops.findIndex((op) => op.op === 'clip');
  assert.ok(clipIndex >= 0, 'glass card must be clipped');
  assert.ok(
    ops.some((op) => op.op === 'drawImage' && typeof op.filter === 'string' && op.filter.indexOf('blur(') === 0),
    'glass backdrop must be blurred'
  );
  assert.ok(ops.some((op) => op.op === 'stroke'), 'glass border stroke missing');

  // Pipeline order: base → blobs → grain → glass.
  const grainIndex = ops.indexOf(grain);
  assert.ok(base < layerComposite && layerComposite < grainIndex && grainIndex < clipIndex);

  // Cleanup: the context is left in a default state.
  assert.equal(ctx.filter, 'none');
  assert.equal(ctx.globalCompositeOperation, 'source-over');
  assert.equal(ctx.globalAlpha, 1);
});

test('render reuses cached layers, buffers and noise tiles across frames', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = fullState(model, {
    points: threePoints(),
    blur: 40,
    grain: { enabled: true, amount: 40, scale: 34, seed: 11, blend: 'soft-light' },
    glass: {
      enabled: true,
      x: 0.5,
      y: 0.5,
      w: 0.5,
      h: 0.4,
      radius: 20,
      blur: 16,
      opacity: 20,
      tint: '#ffffff',
      border: 40,
      sheen: 30,
    },
  });
  const canvas = createFakeCanvas();
  MF.engine.render(canvas, state, { width: 320, height: 180, pixelRatio: 1 });
  const afterFirst = doc.created.length;
  MF.engine.render(canvas, state, { width: 320, height: 180, pixelRatio: 1 });
  assert.equal(doc.created.length, afterFirst, 'second frame must not allocate new offscreen canvases');
});

test('grain noise is deterministic per seed and changes with the seed', () => {
  const docA = createFakeDocument();
  const docB = createFakeDocument();
  const docC = createFakeDocument();
  const envA = loadEngine({ document: docA });
  const envB = loadEngine({ document: docB });
  const envC = loadEngine({ document: docC });

  function renderGrain(env, doc, seed) {
    const state = fullState(env.model, {
      grain: { enabled: true, amount: 50, scale: 34, seed, blend: 'overlay' },
    });
    const canvas = createFakeCanvas();
    env.MF.engine.render(canvas, state, { width: 1600, height: 900, pixelRatio: 1 });
    const pattern = canvas.ctx.ops.find((op) => op.op === 'createPattern');
    assert.ok(pattern, 'grain pattern missing');
    const tile = doc.created.find((created) => created.ctx.lastImageData);
    assert.ok(tile, 'grain tile image data missing');
    return Array.from(tile.ctx.lastImageData.data);
  }

  const a = renderGrain(envA, docA, 7);
  const b = renderGrain(envB, docB, 7);
  const c = renderGrain(envC, docC, 8);
  assert.equal(a.length, 96 * 96 * 4);
  assert.deepEqual(a, b, 'same seed must produce the same tile');
  assert.notDeepEqual(a, c, 'a different seed must produce different noise');
  // Monochrome tile: r === g === b and fully opaque.
  assert.equal(a[0], a[1]);
  assert.equal(a[1], a[2]);
  assert.equal(a[3], 255);
});

test('disabled effects skip their stages', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = model.baseState(); // blur 0, grain/vignette/glass all disabled
  const canvas = createFakeCanvas();
  MF.engine.render(canvas, state, { width: 300, height: 200, pixelRatio: 1 });
  const ops = canvas.ctx.ops;
  assert.ok(!ops.some((op) => op.op === 'createPattern'), 'grain must be skipped when disabled');
  assert.ok(!ops.some((op) => op.op === 'clip'), 'glass must be skipped when disabled');
  assert.ok(!ops.some((op) => op.op === 'strokeRect'), 'guides must be skipped by default');
  assert.ok(
    !ops.some((op) => op.op === 'drawImage' && typeof op.filter === 'string' && op.filter.indexOf('blur(') === 0),
    'blur must be skipped at blur 0'
  );
});

test('guides are drawn only when options.guides is set', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const canvas = createFakeCanvas();
  MF.engine.render(canvas, model.baseState(), { width: 300, height: 200, pixelRatio: 1, guides: true });
  assert.ok(canvas.ctx.ops.some((op) => op.op === 'strokeRect'), 'bounds guide missing');
  assert.ok(canvas.ctx.ops.some((op) => op.op === 'stroke'), 'crosshair guide missing');
});

test('skips blur gracefully when the context has no filter support', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = fullState(model, { blur: 80, points: threePoints() });
  const canvas = createFakeCanvas();
  const ctx = canvas.ctx;
  // A context that never accepts a string filter: assignments are silently ignored, so the
  // feature detection must conclude "unsupported" and skip the blur pass.
  Object.defineProperty(ctx, 'filter', {
    configurable: true,
    get() {
      return undefined;
    },
    set() {},
  });
  const result = MF.engine.render(canvas, state, { width: 400, height: 225, pixelRatio: 1 });
  assert.equal(result.width, 400);
  assert.ok(
    !ctx.ops.some((op) => op.op === 'drawImage' && typeof op.filter === 'string' && op.filter.indexOf('blur(') === 0),
    'no blur pass may run without filter support'
  );
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('survives a context whose filter setter throws', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = fullState(model, {
    blur: 90,
    points: threePoints(),
    grain: { enabled: true, amount: 20, scale: 10, seed: 2, blend: 'normal' },
    vignette: { enabled: true, amount: 30, size: 50 },
    glass: {
      enabled: true,
      x: 0.5,
      y: 0.5,
      w: 0.4,
      h: 0.3,
      radius: 24,
      blur: 20,
      opacity: 30,
      tint: '#ffffff',
      border: 50,
      sheen: 40,
    },
  });
  const canvas = createFakeCanvas();
  const ctx = canvas.ctx;
  Object.defineProperty(ctx, 'filter', {
    configurable: true,
    get() {
      return 'none';
    },
    set() {
      throw new Error('filter assignment rejected');
    },
  });

  const result = MF.engine.render(canvas, state, { width: 640, height: 360, pixelRatio: 1 });
  assert.equal(result.width, 640);
  assert.equal(result.height, 360);
  assert.equal(canvas.width, 640);
  assert.ok(
    !ctx.ops.some((op) => op.op === 'drawImage' && op.filter !== 'none' && String(op.filter).indexOf('blur(') === 0),
    'blur must be skipped when the filter setter rejects'
  );
});

test('render never throws for a toxic context', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = fullState(model, {
    blur: 60,
    points: threePoints(),
    grain: { enabled: true, amount: 30, scale: 34, seed: 5, blend: 'overlay' },
    vignette: { enabled: true, amount: 30, size: 50 },
    glass: {
      enabled: true,
      x: 0.5,
      y: 0.5,
      w: 0.5,
      h: 0.4,
      radius: 20,
      blur: 18,
      opacity: 20,
      tint: '#ffffff',
      border: 40,
      sheen: 30,
    },
  });
  const toxic = {
    width: 0,
    height: 0,
    getContext() {
      return new Proxy(
        {},
        {
          get() {
            throw new Error('toxic get');
          },
          set() {
            throw new Error('toxic set');
          },
        }
      );
    },
  };
  const result = MF.engine.render(toxic, state, { width: 320, height: 180, pixelRatio: 2 });
  assert.equal(result.width, 320);
  assert.equal(result.height, 180);
  assert.equal(toxic.width, 640);
});

test('render never throws on bad or missing state', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });

  // Garbage but object-ish state.
  const canvas = createFakeCanvas();
  const bad = {
    base: 7,
    mix: 'definitely-not-a-mode',
    points: [{ x: 'nope', y: null, size: 'big', opacity: 300, color: 42 }, null, 'x'],
    grain: { enabled: true, amount: 'lots', seed: 'seed', blend: 'weird' },
    vignette: { enabled: true, amount: -10, size: 500 },
    glass: { enabled: true, x: 9, y: -9, w: 'wide', h: 0, radius: -4, blur: 'x', opacity: 'y' },
  };
  const result = MF.engine.render(canvas, bad, { width: 200, height: 120, pixelRatio: 1 });
  assert.equal(result.width, 200);
  assert.equal(result.height, 120);

  // null state.
  const canvas2 = createFakeCanvas();
  const result2 = MF.engine.render(canvas2, null, { width: 100, height: 100, pixelRatio: 1 });
  assert.equal(result2.width, 100);
  assert.equal(result2.height, 100);

  // Model methods that all throw: the engine falls back to internal defaults.
  model.flags.throwAll = true;
  const canvas3 = createFakeCanvas();
  const normalizedBefore = model.flags.normalizeCalls;
  const result3 = MF.engine.render(canvas3, { points: 'not-an-array' }, { width: 120, height: 60, pixelRatio: 1 });
  model.flags.throwAll = false;
  assert.equal(result3.width, 120);
  assert.equal(result3.height, 60);
  assert.ok(model.flags.normalizeCalls > normalizedBefore);
});

test('renderToCanvas creates a detached canvas and returns null without canvas support', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = fullState(model, { points: threePoints() });

  const canvas = MF.engine.renderToCanvas(state, { width: 320, height: 180, pixelRatio: 2 });
  assert.ok(canvas);
  assert.equal(canvas.width, 640);
  assert.equal(canvas.height, 360);
  assert.ok(doc.created.includes(canvas), 'renderToCanvas must create a new canvas');

  // No document / OffscreenCanvas: degrade to null rather than throwing.
  const bare = loadEngine();
  const bareState = bare.model.baseState();
  assert.equal(bare.MF.engine.renderToCanvas(bareState, { width: 200, height: 100 }), null);

  // Rendering into a caller-supplied canvas still works without offscreen canvas support.
  const supplied = createFakeCanvas();
  const rendered = bare.MF.engine.render(supplied, bareState, { width: 200, height: 100 });
  assert.equal(rendered.width, 200);
  assert.equal(rendered.height, 100);
  assert.equal(supplied.width, 200);
  assert.ok(supplied.ctx.ops.some((op) => op.op === 'fillRect'));
});

test('exportCanvas scales dimensionsOf(state) and caps the longest side at 8192', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = model.baseState();
  const before = model.flags.normalizeCalls;

  const canvas1x = MF.engine.exportCanvas(state, 1);
  assert.ok(canvas1x);
  assert.equal(canvas1x.width, 1600);
  assert.equal(canvas1x.height, 900);
  assert.ok(model.flags.normalizeCalls > before, 'exportCanvas must normalize on entry');

  const canvas2x = MF.engine.exportCanvas(state, 2);
  assert.equal(canvas2x.width, 3200);
  assert.equal(canvas2x.height, 1800);

  const capped = MF.engine.exportCanvas(state, 8);
  assert.equal(capped.width, 8192);
  assert.equal(capped.height, 4608);

  // Bad scale values fall back to something sane instead of throwing.
  const defaulted = MF.engine.exportCanvas(state, 'huge');
  assert.ok(defaulted.width >= 1);
  assert.ok(defaulted.height >= 1);
  assert.ok(Math.max(defaulted.width, defaulted.height) <= 8192);
});

test('toDataURL returns a PNG data URL and empty string on failure', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = model.baseState();

  assert.equal(MF.engine.toDataURL(state, 1), 'data:image/png;base64,FAKEPNG:image/png');

  doc.options.throwDataURL = true;
  assert.equal(MF.engine.toDataURL(state, 2), '');

  doc.options.throwDataURL = false;
  assert.equal(MF.engine.toDataURL(null, 1).indexOf('data:image/png'), 0);
});

test('draft mode caps the pixel ratio and default size comes from dimensionsOf', () => {
  const doc = createFakeDocument();
  const { MF, model } = loadEngine({ document: doc });
  const state = model.baseState();

  const draft = createFakeCanvas();
  MF.engine.render(draft, state, { width: 400, height: 225, pixelRatio: 2, draft: true });
  assert.equal(draft.width, 400, 'draft rendering caps the pixel ratio at 1');
  assert.equal(draft.height, 225);

  const crisp = createFakeCanvas();
  MF.engine.render(crisp, state, { width: 400, height: 225, pixelRatio: 2 });
  assert.equal(crisp.width, 800);
  assert.equal(crisp.height, 450);

  const auto = createFakeCanvas();
  const autoResult = MF.engine.render(auto, state, {});
  assert.equal(autoResult.width, 1600);
  assert.equal(autoResult.height, 900);
  assert.equal(auto.width, 1600);
  assert.equal(auto.height, 900);
});
