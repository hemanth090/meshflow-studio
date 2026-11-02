/**
 * MeshFlow Studio - `MF.model` unit tests.
 *
 * Loads the plain-script fragments (`00-prelude.js` + `10-model.js`) inside a `node:vm`
 * context exactly like the generated bundle would, then exercises the pure model API.
 *
 *   node --test test/model.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const preludeSource = readFileSync(join(root, 'src', '00-prelude.js'), 'utf8');
const modelSource = readFileSync(join(root, 'src', '10-model.js'), 'utf8');

const sandbox = {};
const context = vm.createContext(sandbox);
vm.runInContext(preludeSource, context, { filename: '00-prelude.js' });
vm.runInContext(modelSource, context, { filename: '10-model.js' });
vm.runInContext('globalThis.MF = MF;', context, { filename: 'expose-mf.js' });

const MF = sandbox.MF;
const M = MF.model;

/** vm objects live in another realm; deepStrictEqual compares prototypes, so normalise. */
const plain = (value) => JSON.parse(JSON.stringify(value));

const PRESET_IDS = [
  'aurora-veil',
  'peach-haze',
  'deep-orbit',
  'neon-tokyo',
  'cotton-cloud',
  'mint-glacier',
  'ember-dusk',
  'violet-drift',
  'midnight-mesh',
  'citrus-pop',
  'rose-quartz',
  'solar-flare',
  'arctic-frost',
  'plum-noir',
  'glass-panel',
  'mono-grain',
];

const ASPECT_DIMENSIONS = {
  '16:9': [1600, 900],
  '4:3': [1440, 1080],
  '1:1': [1200, 1200],
  '9:16': [900, 1600],
  '3:2': [1500, 1000],
  '21:9': [1680, 720],
  '2:3': [1000, 1500],
  a4: [1240, 1754],
};

const HEX = /^#[0-9a-f]{6}$/;

/* ------------------------------------------------------------------ loading */

test('fragment loads in a vm sandbox and exposes the contracted API', () => {
  assert.ok(M, 'MF.model must be defined');
  assert.equal(M.VERSION, 1);
  const functions = [
    'createState',
    'aspectOf',
    'dimensionsOf',
    'clone',
    'normalize',
    'validState',
    'newPoint',
    'addPoint',
    'removePoint',
    'patchPoint',
    'setAspect',
    'applyPreset',
    'randomize',
    'recolor',
    'serialize',
    'deserialize',
    'toCSS',
    'toJSON',
    'filename',
    'formatDimensions',
    'blurPx',
    'grainTileSize',
    'contrastText',
  ];
  for (const name of functions) assert.equal(typeof M[name], 'function', 'MF.model.' + name);
  for (const name of ['parse', 'rgba', 'hex', 'mix', 'lighten', 'darken', 'luminance', 'withAlpha']) {
    assert.equal(typeof M.color[name], 'function', 'MF.model.color.' + name);
  }
  assert.equal(typeof MF.strings.model.en, 'object');
  assert.equal(typeof MF.strings.model.zh, 'object');
  assert.equal(MF.strings.model.en['presets.aurora-veil'], 'Aurora Veil');
});

/* ------------------------------------------------------------------ constants */

test('ASPECTS exposes exactly the eight contracted sizes', () => {
  assert.equal(M.ASPECTS.length, 8);
  assert.deepEqual(plain(M.ASPECTS).map((aspect) => aspect.id), Object.keys(ASPECT_DIMENSIONS));
  for (const aspect of plain(M.ASPECTS)) {
    assert.deepEqual([aspect.w, aspect.h], ASPECT_DIMENSIONS[aspect.id], aspect.id);
  }
  const state = M.createState();
  assert.deepEqual(plain(M.dimensionsOf(state)), { width: 1600, height: 900 });
  assert.equal(M.aspectOf(state).id, '16:9');
  for (const aspect of plain(M.ASPECTS)) {
    const next = M.setAspect(state, aspect.id);
    assert.equal(next.aspect, aspect.id);
    assert.deepEqual(plain(M.dimensionsOf(next)), {
      width: ASPECT_DIMENSIONS[aspect.id][0],
      height: ASPECT_DIMENSIONS[aspect.id][1],
    });
  }
});

test('LIMITS, MIX_MODES and GRAIN_BLENDS match the contract', () => {
  assert.deepEqual(plain(M.LIMITS), {
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
  });
  assert.deepEqual(plain(M.MIX_MODES), ['normal', 'screen', 'overlay', 'soft-light', 'lighter']);
  assert.deepEqual(plain(M.GRAIN_BLENDS), ['overlay', 'soft-light', 'normal']);
});

test('eight curated palettes with 4..6 valid hex colours each', () => {
  assert.equal(M.PALETTES.length, 8);
  assert.deepEqual(
    plain(M.PALETTES).map((palette) => palette.id),
    ['aurora', 'sunset', 'ocean', 'neon', 'pastel', 'forest', 'ember', 'mono']
  );
  const seen = new Set();
  for (const palette of plain(M.PALETTES)) {
    assert.ok(palette.nameKey, palette.id + ' nameKey');
    assert.ok(palette.colors.length >= 4 && palette.colors.length <= 6, palette.id + ' colours');
    for (const swatch of palette.colors) {
      assert.match(swatch, HEX, palette.id + ' swatch');
      seen.add(swatch);
    }
  }
  assert.ok(seen.size >= 30, 'palettes are visually varied (' + seen.size + ' unique swatches)');
});

/* --------------------------------------------------------------- default state */

test('createState returns the documented default composition', () => {
  const state = plain(M.createState());
  assert.equal(state.version, 1);
  assert.equal(state.aspect, '16:9');
  assert.equal(state.palette, 'aurora');
  assert.equal(state.points.length, 6);
  assert.equal(state.blur, 0);
  assert.equal(state.grain.enabled, false);
  assert.equal(state.vignette.enabled, false);
  assert.equal(state.glass.enabled, false);
  assert.deepEqual(Object.keys(state), [
    'version',
    'name',
    'aspect',
    'base',
    'mix',
    'points',
    'blur',
    'grain',
    'vignette',
    'glass',
    'palette',
  ]);
  for (const point of state.points) {
    assert.equal(typeof point.id, 'string');
    assert.ok(point.x >= 0 && point.x <= 1);
    assert.ok(point.y >= 0 && point.y <= 1);
    assert.match(point.color, HEX);
    assert.ok(point.size >= 0.02 && point.size <= 1.4);
    assert.ok(point.opacity >= 0.05 && point.opacity <= 1);
  }
  assert.equal(M.validState(M.createState()), true);
  assert.deepEqual(plain(JSON.parse(JSON.stringify(M.createState()))), state);
});

/* --------------------------------------------------------------------- normalise */

test('normalize repairs garbage into a valid default composition', () => {
  const garbage = [
    null,
    undefined,
    0,
    42,
    Number.NaN,
    'garbage',
    '',
    true,
    [],
    [1, 2, 3],
    {},
    { points: 'nope' },
    { aspect: 'nope', palette: 'nope', mix: 'nope', base: 'not-a-colour', points: [{}] },
    { points: new Array(80).fill(null) },
  ];
  for (const input of garbage) {
    const state = M.normalize(input);
    assert.equal(M.validState(state), true, 'garbage should normalise: ' + String(input));
    assert.equal(state.points.length >= 2 && state.points.length <= 12, true);
  }
  assert.deepEqual(plain(M.normalize({})), plain(M.createState()), 'empty object falls back to defaults');
});

test('normalize clamps numbers, repairs colours and drops invalid points', () => {
  const fixed = plain(
    M.normalize({
      name: '  Test  ',
      aspect: '4:3',
      base: 'red',
      mix: 'zzz',
      palette: 'nope',
      points: [
        { x: -3, y: 99, color: 'nope', size: 100, opacity: -1 },
        { x: 0.5, y: 0.5, color: '#ABC', size: 0.5, opacity: 0.5 },
        'junk',
        { y: 0.5 },
      ],
      blur: 999,
      grain: { enabled: 'yes', amount: -5, scale: 500, seed: 0, blend: 'zzz' },
      vignette: { enabled: 1, amount: 999, size: -20 },
      glass: { enabled: true, x: -1, y: 2, w: 0, h: 5, radius: 999, blur: -2, opacity: 999, tint: 'bad', border: 999, sheen: -5 },
    })
  );
  assert.equal(M.validState(fixed), true);
  assert.equal(fixed.name, 'Test');
  assert.equal(fixed.aspect, '4:3');
  assert.equal(fixed.points.length, 2);
  assert.equal(fixed.points[0].x, 0);
  assert.equal(fixed.points[0].y, 1);
  assert.equal(fixed.points[0].size, 1.4);
  assert.equal(fixed.points[0].opacity, 0.05);
  assert.match(fixed.points[0].color, HEX);
  assert.equal(fixed.points[1].color, '#aabbcc');
  assert.equal(fixed.blur, 100);
  assert.equal(fixed.grain.enabled, true);
  assert.equal(fixed.grain.amount, 0);
  assert.equal(fixed.grain.scale, 100);
  assert.equal(fixed.grain.seed, 1);
  assert.equal(fixed.grain.blend, 'overlay');
  assert.equal(fixed.vignette.amount, 100);
  assert.equal(fixed.vignette.size, 0);
  assert.equal(fixed.glass.x, 0);
  assert.equal(fixed.glass.y, 1);
  assert.equal(fixed.glass.w, 0.05);
  assert.equal(fixed.glass.h, 1);
  assert.equal(fixed.glass.radius, 80);
  assert.equal(fixed.glass.blur, 0);
  assert.equal(fixed.glass.opacity, 100);
  assert.equal(fixed.glass.tint, '#ffffff');
  assert.equal(fixed.glass.border, 100);
  assert.equal(fixed.glass.sheen, 0);
  assert.equal(fixed.palette, 'aurora', 'invalid palette falls back to aurora');
});

test('validState is strict about normalisation', () => {
  assert.equal(M.validState(M.createState()), true);
  assert.equal(M.validState(null), false);
  assert.equal(M.validState(undefined), false);
  assert.equal(M.validState('state'), false);
  assert.equal(M.validState({}), false);
  const extra = plain(M.createState());
  extra.unknownField = true;
  assert.equal(M.validState(extra), false);
});

/* --------------------------------------------------------------------- presets */

test('all 16 presets are complete, valid and visually distinct', () => {
  assert.equal(M.PRESETS.length, 16);
  assert.deepEqual(plain(M.PRESETS).map((preset) => preset.id), PRESET_IDS);

  const seenStates = new Set();
  let grainCount = 0;
  let glassCount = 0;

  for (const preset of plain(M.PRESETS)) {
    assert.ok(preset.nameKey, preset.id + ' nameKey');
    assert.ok(preset.tagKey, preset.id + ' tagKey');
    const key = 'presets.' + preset.id;
    assert.equal(preset.nameKey, key);
    assert.ok(MF.strings.model.en[key], key + ' en name');
    assert.ok(MF.strings.model.zh[key], key + ' zh name');
    assert.ok(MF.strings.model.en[preset.tagKey], preset.tagKey + ' en tag');

    const state = preset.state;
    assert.equal(M.validState(preset.state), true, preset.id + ' must be normalised');
    assert.equal(state.version, 1);
    assert.match(state.base, /^#[0-9a-f]{6}$/);
    assert.ok(M.MIX_MODES.includes(state.mix));
    assert.ok(M.PALETTES.some((palette) => palette.id === state.palette));
    assert.ok(state.points.length >= 3 && state.points.length <= 8, preset.id + ' point count');
    assert.ok(state.blur >= 0 && state.blur <= 100);
    for (const point of state.points) {
      assert.match(point.color, HEX);
      assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
    }
    const ids = new Set(state.points.map((point) => point.id));
    assert.equal(ids.size, state.points.length, preset.id + ' unique point ids');
    seenStates.add(JSON.stringify(state));
    if (state.grain.enabled) grainCount += 1;
    if (state.glass.enabled) glassCount += 1;
  }

  assert.ok(grainCount >= 4, 'at least 4 presets use grain (got ' + grainCount + ')');
  assert.ok(glassCount >= 3, 'at least 3 presets use glass (got ' + glassCount + ')');
  assert.equal(seenStates.size, 16, 'every preset is a distinct composition');
});

test('applyPreset clones presets and tolerates unknown ids', () => {
  const preset = plain(M.PRESETS.find((item) => item.id === 'neon-tokyo'));
  const applied = M.applyPreset('neon-tokyo');
  assert.deepEqual(plain(applied), preset.state);

  applied.points[0].x = 0.99;
  assert.notEqual(plain(M.PRESETS.find((item) => item.id === 'neon-tokyo')).state.points[0].x, 0.99);

  const byObject = M.applyPreset({ id: 'ember-dusk' });
  assert.equal(byObject.name, 'Ember Dusk');
  const passthrough = M.applyPreset({ state: M.createState() });
  assert.equal(passthrough.aspect, '16:9');
  assert.deepEqual(plain(M.applyPreset('does-not-exist')), plain(M.createState()));
});

/* -------------------------------------------------------------------- randomize */

test('randomize is deterministic for a given seed and input', () => {
  const state = M.createState();
  const first = M.randomize(state, { seed: 4242 });
  const second = M.randomize(state, { seed: 4242 });
  assert.equal(M.serialize(first), M.serialize(second));

  const different = M.randomize(state, { seed: 777 });
  assert.notEqual(M.serialize(first), M.serialize(different));

  assert.equal(M.validState(first), true);
  assert.equal(first.aspect, state.aspect);
  assert.equal(first.name, state.name);
  assert.ok(first.points.length >= 4 && first.points.length <= 8);
  assert.ok(first.blur >= 10 && first.blur <= 70);
});

test('randomize honours paletteId/count and always produces sane compositions', () => {
  const state = M.createState();
  const neon = M.randomize(state, { seed: 202, paletteId: 'neon' });
  assert.equal(neon.palette, 'neon');
  const neonSwatches = plain(M.PALETTES.find((palette) => palette.id === 'neon').colors);
  for (const point of plain(neon.points)) {
    assert.ok(neonSwatches.includes(point.color), 'point colour comes from the chosen palette');
  }

  for (const count of [4, 5, 6, 7, 8]) {
    assert.equal(M.randomize(state, { seed: 99, count }).points.length, count);
    assert.equal(M.randomize(state, { seed: 99, count: 12 }).points.length, 8, 'count clamps to 8');
  }

  for (let seed = 1; seed <= 40; seed += 1) {
    const randomized = M.randomize(state, { seed });
    assert.equal(M.validState(randomized), true, 'seed ' + seed);
    assert.ok(randomized.points.length >= 4 && randomized.points.length <= 8);
    assert.ok(randomized.blur >= 10 && randomized.blur <= 70);
    assert.ok(randomized.grain.amount >= 0 && randomized.grain.amount <= 100);
    if (randomized.grain.enabled) {
      assert.ok(randomized.grain.seed >= 1 && randomized.grain.seed <= 9999);
    }
    if (randomized.glass.enabled) {
      assert.ok(randomized.glass.w >= 0.05 && randomized.glass.w <= 1);
      assert.match(randomized.glass.tint, HEX);
    }
  }
});

/* ------------------------------------------------------------------------ colour */

test('colour parsing accepts the documented notation and round-trips', () => {
  assert.deepEqual(plain(M.color.parse('#6ee7ff')), { r: 110, g: 231, b: 255, a: 1 });
  assert.deepEqual(plain(M.color.parse('#fff')), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(plain(M.color.parse('#0af')), { r: 0, g: 170, b: 255, a: 1 });
  assert.deepEqual(plain(M.color.parse('#11223344')), { r: 17, g: 34, b: 51, a: 0.267 });
  assert.deepEqual(plain(M.color.parse('#11223380')), { r: 17, g: 34, b: 51, a: 0.502 });
  assert.deepEqual(plain(M.color.parse('rgba(10, 20, 30, 0.5)')), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.deepEqual(plain(M.color.parse('rgb(255 128 0 / 50%)')), { r: 255, g: 128, b: 0, a: 0.5 });

  for (const hex of ['#000000', '#ffffff', '#6ee7ff', '#ff2d95', '#0f766e']) {
    assert.equal(M.color.hex(M.color.parse(hex)), hex);
  }
  assert.equal(M.color.hex(M.color.parse('#ABC')), '#aabbcc');
  assert.equal(M.color.rgba({ r: 1, g: 2, b: 3, a: 0.25 }), 'rgba(1, 2, 3, 0.25)');
  assert.equal(M.color.withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.equal(M.color.withAlpha('#ff0000', 4), 'rgba(255, 0, 0, 1)');
  assert.equal(M.color.withAlpha('#ff0000', -2), 'rgba(255, 0, 0, 0)');
});

test('colour mixing, lightening and luminance behave', () => {
  assert.equal(M.color.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(M.color.mix('#000000', '#ffffff', 0), '#000000');
  assert.equal(M.color.mix('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(M.color.mix('#123456', '#abcdef', -5), '#123456');
  assert.equal(M.color.lighten('#000000', 1), '#ffffff');
  assert.equal(M.color.darken('#ffffff', 1), '#000000');
  assert.equal(M.color.lighten('#123456', 0), '#123456');
  assert.equal(M.color.luminance('#ffffff'), 1);
  assert.equal(M.color.luminance('#000000'), 0);
  const midGrey = M.color.luminance('#808080');
  assert.ok(midGrey > 0.2 && midGrey < 0.25, 'mid grey luminance ' + midGrey);
  assert.match(M.color.hex({ r: 300, g: -20, b: 128 }), HEX);
  assert.equal(M.color.hex({ r: 300, g: -20, b: 128 }), '#ff0080');
  assert.deepEqual(plain(M.color.parse('not-a-colour')), { r: 0, g: 0, b: 0, a: 1 });
});

/* --------------------------------------------------------------------- css codegen */

test('toCSS emits production CSS layers without undefined/NaN', () => {
  const state = M.createState();
  const css = M.toCSS(state);
  assert.equal(typeof css, 'string');
  assert.match(css, /\.meshflow-art\s*\{/);
  assert.match(css, /background-color: #0a0a12;/);
  assert.match(css, /\.meshflow-art::before\s*\{/);
  assert.match(css, /radial-gradient\(ellipse/);
  assert.match(css, /filter: blur\(0px\);/);
  assert.match(css, /aspect-ratio: 16 \/ 9;/);
  assert.ok(!css.includes('feTurbulence'), 'no grain layer when grain is off');
  assert.ok(!css.includes('.meshflow-glass'), 'no glass rule when glass is off');
  assert.ok(!css.includes('undefined'), 'never undefined');
  assert.ok(!css.includes('NaN'), 'never NaN');
  assert.equal(M.toCSS(state), css, 'deterministic output');

  const gradientCount = (css.match(/radial-gradient/g) || []).length;
  assert.equal(gradientCount, state.points.length, 'one radial-gradient layer per node');
});

test('toCSS includes grain, vignette and glass layers when enabled', () => {
  const grain = M.toCSS(M.applyPreset('ember-dusk'));
  assert.match(grain, /feTurbulence/);
  assert.match(grain, /data:image\/svg\+xml/);
  assert.match(grain, /background-size: \d+px \d+px;/);
  assert.match(grain, /mix-blend-mode: overlay;/);
  assert.match(grain, /box-shadow: inset 0 0 \d+px \d+px rgba\(0, 0, 0, /);

  const glass = M.toCSS(M.applyPreset('glass-panel'));
  assert.match(glass, /\.meshflow-glass\s*\{/);
  assert.match(glass, /backdrop-filter: blur\(\d+px\) saturate\(140%\);/);
  assert.match(glass, /border: 1px solid rgba\(255, 255, 255, /);
  assert.match(glass, /<div class="meshflow-glass"><\/div>/);

  const monoGrain = M.toCSS(M.applyPreset('mono-grain'));
  assert.match(monoGrain, /opacity: 0\.64;/);
});

test('toCSS never throws or leaks bad numbers for garbage states', () => {
  const inputs = [
    null,
    undefined,
    {},
    { points: [{ x: Number.NaN, y: Number.POSITIVE_INFINITY }] },
    { blur: Number.NaN, grain: { enabled: true, seed: Number.NaN }, glass: { enabled: true } },
    M.randomize(M.createState(), { seed: 12 }),
  ];
  for (const input of inputs) {
    const css = M.toCSS(input);
    assert.equal(typeof css, 'string');
    assert.ok(!css.includes('undefined'), 'no undefined');
    assert.ok(!css.includes('NaN'), 'no NaN');
    assert.match(css, /radial-gradient/);
  }
  for (const preset of plain(M.PRESETS)) {
    const css = M.toCSS(preset.state);
    assert.ok(!css.includes('undefined') && !css.includes('NaN'), preset.id);
  }
});

/* ------------------------------------------------------------------ (de)serialise */

test('serialize/deserialize round-trips envelope and bare state', () => {
  const state = M.applyPreset('neon-tokyo');
  const text = M.serialize(state);
  assert.equal(typeof text, 'string');
  assert.ok(text.startsWith('{'));
  const envelope = JSON.parse(text);
  assert.equal(envelope.format, 'meshflow-studio');
  assert.equal(envelope.version, 1);

  assert.deepEqual(plain(M.deserialize(text)), plain(state));
  assert.deepEqual(plain(M.deserialize(JSON.stringify(plain(state)))), plain(state), 'bare state');

  const pretty = M.toJSON(state);
  assert.match(pretty, /"format": "meshflow-studio"/);
  assert.deepEqual(plain(M.deserialize(pretty)), plain(state));
  assert.deepEqual(plain(JSON.parse(pretty).state), plain(state));
});

test('deserialize returns null for corrupt input and normalises partial envelopes', () => {
  for (const bad of ['', '   ', 'not json', '{bad', 'null', '42', '"text"', '[]', '{}']) {
    assert.equal(M.deserialize(bad), null, 'bad payload: ' + bad);
  }
  assert.equal(M.deserialize(JSON.stringify({ format: 'meshflow-studio', version: 1 })), null);
  const partial = M.deserialize(JSON.stringify({ format: 'meshflow-studio', version: 1, state: { points: [] } }));
  assert.notEqual(partial, null);
  assert.equal(M.validState(partial), true);
  assert.equal(M.validState(M.deserialize(M.serialize(M.createState()))), true);
});

/* --------------------------------------------------------------- dimensions/helpers */

test('formatDimensions and filename follow the documented pattern', () => {
  assert.equal(M.formatDimensions(M.createState(), 1), '1600 \u00d7 900');
  assert.equal(M.formatDimensions(M.createState(), 2), '3200 \u00d7 1800');
  assert.equal(M.formatDimensions(M.applyPreset('deep-orbit'), 4), '6720 \u00d7 2880');
  assert.equal(M.filename(M.applyPreset('aurora-veil'), 2), 'meshflow-aurora-veil-3200x1800.png');
  assert.equal(M.filename(M.createState(), 1), 'meshflow-untitled-mesh-1600x900.png');
  const named = M.normalize({ ...plain(M.createState()), name: 'My  Décor / Set' });
  assert.equal(M.filename(named, 1), 'meshflow-my-d-cor-set-1600x900.png');
  for (const preset of plain(M.PRESETS)) {
    assert.match(M.filename(preset.state, 2), /^meshflow-[a-z0-9-]+-\d+x\d+\.png$/, preset.id);
  }
});

test('blurPx and grainTileSize stay inside their ranges', () => {
  const square = M.setAspect(M.createState(), '1:1');
  const maxBlur = { ...plain(square), blur: 100 };
  assert.equal(M.blurPx(maxBlur), 108, 'blur/100 * min * 0.09 for 1200px');
  assert.equal(M.blurPx({ ...plain(square), blur: 0 }), 0);
  assert.equal(M.blurPx({ ...plain(square), blur: 50 }), 54);
  assert.equal(M.blurPx(M.createState()), 0);
  for (const blur of [0, 12, 33, 50, 77, 100]) {
    const px = M.blurPx({ ...plain(M.createState()), blur });
    assert.equal(Number.isInteger(px), true);
    assert.ok(px >= 0 && px <= 112);
  }

  assert.equal(M.grainTileSize({ ...plain(M.createState()), grain: { enabled: true, amount: 20, scale: 1, seed: 3, blend: 'overlay' } }), 256);
  assert.equal(M.grainTileSize({ ...plain(M.createState()), grain: { enabled: true, amount: 20, scale: 100, seed: 3, blend: 'overlay' } }), 48);
  assert.equal(M.grainTileSize(M.applyPreset('mono-grain')), 136, 'scale 58 maps to a 136px tile');
  for (const preset of plain(M.PRESETS)) {
    const tile = M.grainTileSize(preset.state);
    assert.equal(Number.isInteger(tile), true);
    assert.ok(tile >= 48 && tile <= 256, preset.id + ' tile ' + tile);
  }
});

test('contrastText picks readable ink for swatches', () => {
  assert.equal(M.contrastText('#ffffff'), '#0b0b10');
  assert.equal(M.contrastText('#f5f5f7'), '#0b0b10');
  assert.equal(M.contrastText('#000000'), '#ffffff');
  assert.equal(M.contrastText('#1c1c24'), '#ffffff');
  assert.equal(M.contrastText('#6ee7ff'), '#0b0b10');
  assert.equal(M.contrastText('not-a-colour'), '#ffffff');
  for (const palette of plain(M.PALETTES)) {
    for (const swatch of palette.colors) {
      assert.ok(['#ffffff', '#0b0b10'].includes(M.contrastText(swatch)));
    }
  }
});

/* ------------------------------------------------------------------- state tools */

test('newPoint normalises partial point input', () => {
  const point = plain(M.newPoint());
  assert.equal(typeof point.id, 'string');
  assert.ok(point.id.length > 0);
  assert.equal(point.x, 0.5);
  assert.equal(point.y, 0.5);
  assert.equal(point.size, 0.5);
  assert.equal(point.opacity, 1);
  assert.match(point.color, HEX);

  const clamped = plain(M.newPoint({ x: 9, y: -1, color: 'nope', size: 99, opacity: 0 }));
  assert.equal(clamped.x, 1);
  assert.equal(clamped.y, 0);
  assert.match(clamped.color, HEX);
  assert.equal(clamped.size, 1.4);
  assert.equal(clamped.opacity, 0.05);
});

test('addPoint/removePoint respect the 2..12 bounds', () => {
  let state = M.createState();
  const initial = state.points.length;
  state = M.addPoint(state, { x: 0.1, y: 0.9 });
  assert.equal(state.points.length, initial + 1);
  const added = state.points[state.points.length - 1];
  assert.equal(added.x, 0.1);
  assert.equal(added.y, 0.9);
  const paletteColors = plain(M.PALETTES.find((palette) => palette.id === state.palette).colors);
  assert.ok(paletteColors.includes(added.color));

  while (state.points.length < 12) state = M.addPoint(state);
  assert.equal(state.points.length, 12);
  const capped = M.addPoint(state);
  assert.equal(capped.points.length, 12);
  const ids = new Set(capped.points.map((point) => point.id));
  assert.equal(ids.size, 12, 'unique ids after additions');

  let trimmed = M.applyPreset('deep-orbit');
  while (trimmed.points.length > 2) trimmed = M.removePoint(trimmed, trimmed.points[0].id);
  assert.equal(trimmed.points.length, 2);
  assert.equal(M.removePoint(trimmed, trimmed.points[0].id).points.length, 2, 'keeps at least 2 points');
  const unchanged = M.removePoint(M.createState(), 'missing-id');
  assert.deepEqual(plain(unchanged), plain(M.createState()));
});

test('patchPoint clamps and setAspect validates', () => {
  const state = M.createState();
  const id = state.points[0].id;
  const patched = M.patchPoint(state, id, { x: 5, y: -1, size: 99, opacity: 0, color: 'nope' });
  const point = patched.points.find((item) => item.id === id);
  assert.equal(point.x, 1);
  assert.equal(point.y, 0);
  assert.equal(point.size, 1.4);
  assert.equal(point.opacity, 0.05);
  assert.equal(point.color, state.points[0].color, 'invalid colour keeps the old value');
  assert.deepEqual(plain(M.patchPoint(state, 'nope', { x: 0.1 })), plain(state));

  assert.equal(M.setAspect(state, '9:16').aspect, '9:16');
  assert.equal(M.setAspect(state, 'nope').aspect, '16:9', 'invalid aspect keeps current');
  assert.deepEqual(plain(M.dimensionsOf(M.setAspect(state, '9:16'))), { width: 900, height: 1600 });
});

test('recolor cycles palette colours without touching geometry', () => {
  const state = M.createState();
  const recoloured = M.recolor(state, 'neon');
  assert.equal(recoloured.palette, 'neon');
  const neonColors = plain(M.PALETTES.find((palette) => palette.id === 'neon').colors);
  recoloured.points.forEach((point, index) => {
    assert.equal(point.color, neonColors[index % neonColors.length]);
    assert.equal(point.x, state.points[index].x);
    assert.equal(point.y, state.points[index].y);
    assert.equal(point.size, state.points[index].size);
    assert.equal(point.opacity, state.points[index].opacity);
    assert.equal(point.id, state.points[index].id);
  });
  assert.equal(M.validState(recoloured), true);
  assert.equal(M.recolor(state, 'invalid').palette, 'aurora', 'invalid palette keeps the current one');
  assert.deepEqual(plain(M.recolor(state, 'invalid')), plain(M.recolor(state, state.palette)));
});

test('clone is a deep copy', () => {
  const state = M.createState();
  const copy = M.clone(state);
  assert.notEqual(copy, state);
  assert.deepEqual(plain(copy), plain(state));
  copy.points[0].x = 0.01;
  copy.grain.enabled = true;
  assert.equal(state.points[0].x, 0.28);
  assert.equal(state.grain.enabled, false);
});

/* ---------------------------------------------------------------------- strings */

test('en/zh dictionaries cover every visible model string', () => {
  const en = MF.strings.model.en;
  const zh = MF.strings.model.zh;
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();
  assert.deepEqual(zhKeys, enKeys, 'both locales expose the same keys');
  assert.ok(enKeys.length >= 45, 'dictionary has all preset/palette/aspect/tag/mix labels');

  for (const key of enKeys) {
    assert.ok(key.length < 40, key + ' key length');
    assert.equal(typeof en[key], 'string');
    assert.equal(typeof zh[key], 'string');
    assert.ok(en[key].trim().length > 0, key + ' en');
    assert.ok(zh[key].trim().length > 0, key + ' zh');
    assert.notEqual(en[key], zh[key], key + ' is translated');
  }

  for (const preset of plain(M.PRESETS)) {
    assert.ok(en[preset.nameKey], preset.nameKey);
    assert.ok(zh[preset.nameKey], preset.nameKey);
    assert.ok(en[preset.tagKey], preset.tagKey);
    assert.ok(zh[preset.tagKey], preset.tagKey);
  }
  for (const palette of plain(M.PALETTES)) {
    assert.ok(en[palette.nameKey], palette.nameKey);
    assert.ok(zh[palette.nameKey], palette.nameKey);
  }
  for (const aspect of plain(M.ASPECTS)) {
    assert.ok(en['aspect.' + aspect.id], 'aspect.' + aspect.id);
    assert.ok(zh['aspect.' + aspect.id], 'aspect.' + aspect.id);
  }
  for (const mode of plain(M.MIX_MODES)) {
    assert.ok(en['mix.' + mode], 'mix.' + mode);
    assert.ok(zh['mix.' + mode], 'mix.' + mode);
  }
  assert.ok(en['model.node']);
  assert.ok(zh['model.node']);
});
