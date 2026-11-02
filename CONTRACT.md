# MeshFlow Studio: build contract (read this first)

MeshFlow Studio is a DSH Web UI plugin: a **main-panel design studio** for creating mesh
gradients, soft blur, film grain, vignette and glassmorphism compositions, with PNG export,
CSS/JSON copy, presets and drag-to-sculpt nodes.

Everything is authored as plain JavaScript script fragments in `src/`, then concatenated by
`build.mjs` into a single `client.js` (a `window.__ModuleLoader__.load({...})` factory). The
plugin is installed as a DSH bundle and rendered in the connected web page.

Working directory: the repository root (the directory that contains `package.json`).

## File ownership (do not edit files you do not own)

| Owner | Files |
|---|---|
| Lead | `00-prelude.js`, `60-register.js`, `build.mjs`, `package.json`, `cordis.patch.yml`, `index.js`, `icon.svg`, `locale/*.json`, `client.js` (generated), `README.md` |
| teammate `engine-dev` | `src/10-model.js`, `src/20-engine.js`, `test/model.test.mjs`, `test/engine.test.mjs` |
| teammate `export-dev` | `src/25-exporter.js`, `test/exporter.test.mjs` |
| teammate `ui-dev` | `src/30-controls.js`, `src/40-panels.js` |
| teammate `studio-dev` | `src/50-studio.js` (component only; exposes `MF.Studio`, no registration) |
| teammate `qa-verifier` | `verify/*`, `docs/*`, `README.md` (after Lead finishes integration) |

Only the Lead runs `node build.mjs` and the `plugin_manager` install. Never edit `client.js`,
`package.json`, `cordis.patch.yml`, `index.js`, or another teammate's file. Put tests under
`test/` in your own files.

## Build model: no modules, no imports, no JSX

`build.mjs` emits:

```js
window.__ModuleLoader__.load({
  id: '@local/meshflow-studio',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    /* src/00-prelude.js, src/10-model.js, ... src/60-register.js concatenated in order */
  },
});
```

Rules for every `src/*.js` fragment:

- Plain ES2019+ script statements. **No** `import`/`export`, no JSX, no TypeScript.
- `React`, `h`, `require` are in scope (defined by the wrapper). Nothing else from npm.
- Never `require()` any package other than `react`.
- All shared code hangs off one namespace object `MF` created in `00-prelude.js`.
  Each module assigns its own member exactly once, e.g. `MF.model = (function () { ... })();`.
- The file must stay syntactically valid on its own: run `node --check src/<file>.js` after edits
(the registration fragment assigns `MF.clientPlugin`; `build.mjs` owns the factory's final `return`).
- Browser globals (`window`, `document`, `localStorage`, `navigator`, `CanvasRenderingContext2D`)
  are allowed **only** in the modules listed below and never at module-evaluation time:
  - `20-engine.js`: canvas creation/drawing inside functions.
  - `25-exporter.js`: clipboard / anchor download / canvas helpers inside functions.
  - `30-controls.js`, `40-panels.js`: DOM only through React refs/effects (no `document.body`,
    no global listeners).
  - `50-studio.js`: React and its own listeners inside `useEffect` with cleanup.
  - `60-register.js` (Lead): registration only.
- Never append to `document.body`, never create a second React root, never read another
  plugin's DOM/styles, never use `innerHTML` for visible plugin chrome.
- No network calls, no `fetch`, no timers outside `useEffect` cleanup.

## Hard UI rules

1. **Chrome uses theme tokens only.** Every color of plugin chrome (surfaces, text, borders,
   controls, focus rings, dividers) is `var(--dsw-alias-*)`; literal colors are allowed only for
   artwork (gradient values, preset thumbnails, the canvas itself, the sidebar mark, glass tint
   values that belong to the saved composition). Available tokens:
   `--dsw-alias-bg-base`, `--dsw-alias-bg-layer-1`, `--dsw-alias-bg-layer-2`,
   `--dsw-alias-bg-overlay`, `--dsw-alias-border-l1`, `--dsw-alias-border-l2`,
   `--dsw-alias-brand-primary`, `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`,
   `--dsw-alias-state-error-primary`, `--dsw-alias-state-success-primary`,
   `--dsw-alias-state-warn-primary`, `--dsw-alias-state-idle-primary`,
   `--dsw-specific-sidebar-fill`.
   No hardcoded `#fff`, `#000`, `rgba(...)` for chrome (translucent *artwork* overlays on the
   canvas are fine). Use `color-mix()` only if you also give a token-only fallback.
2. **Every visible string goes through the locale service.** No English literal in JSX/JS
   output. Components receive `t(key) => string` and render `t('some.key')`. Each module that
   shows text owns its dictionary:

   ```js
   MF.strings = MF.strings || {};
   MF.strings.panels = {
     en: { 'panels.presets': 'Presets', ... },
     zh: { 'panels.presets': '预设', ... },
   };
   ```

   The Lead merges every `MF.strings.*.en` / `.zh` into the registered namespace
   `meshflow-studio`. Prefix keys with your module (`panels.`, `studio.`, `presets.`, `mesh.`,
   `effects.`, `glass.`, `export.`) and keep every key under 40 chars. Both `en` and `zh` are
   required for every key. Keep the UI copy short and professional.
3. **Accessibility**: every interactive element is a real `<button>`/`<input>`/`<select>`
   with an accessible name (`aria-label` / linked label text), keyboard reachable,
   visible focus (`outline: 2px solid var(--dsw-alias-brand-primary)`), and correct
   `role`/`aria-checked` for toggles. Sliders: `<input type="range">` plus a numeric readout.
4. **Performance**: no expensive work during render. Canvas drawing runs in effects with
   `requestAnimationFrame` coalescing. Sliders must feel live (state updates in the parent are
   cheap). Never re-create a canvas element per render; use refs.
5. **Responsive**: the studio is used in a desktop web app; the panel must work from ~640px to
   ~1800px wide. Chrome is flat: borders + token surfaces, no heavy shadows (a soft shadow is
   allowed only on the artboard itself).

## Composition state (plain JSON, owned by `MF.Studio`)

```js
{
  version: 1,
  name: 'Untitled mesh',
  aspect: '16:9',                     // id from MF.model.ASPECTS
  base: '#0a0a12',
  mix: 'normal',                      // normal | screen | overlay | soft-light | lighter
  points: [
    { id: 'p1', x: 0.28, y: 0.32, color: '#6ee7ff', size: 0.62, opacity: 1 }
    // x,y in 0..1 (center), size in 0.02..1.4 (radius factor), opacity 0..1
  ],
  blur: 0,                            // 0..100
  grain: { enabled: true, amount: 0, scale: 34, seed: 7, blend: 'overlay' },
  vignette: { enabled: false, amount: 24, size: 60 },
  glass: {
    enabled: false, x: 0.5, y: 0.5, w: 0.52, h: 0.42, radius: 28,
    blur: 18, opacity: 14, tint: '#ffffff', border: 40, sheen: 30,
  },
  palette: 'aurora',
}
```

State is immutable from every consumer's point of view: components build the next state with
object spread and call `onChange(nextState, coalesce)`. Never mutate `state` or its arrays in
place. The state must stay JSON-serialisable (`JSON.parse(JSON.stringify(state))` works).

## Shared namespace

`MF` members provided by the Lead (`00-prelude.js`):

- `MF.ID` = `'meshflow-studio'`, `MF.VERSION` = `1`
- `MF.strings` - `{}` then dictionaries
- `MF.util.clamp(v, min, max)`, `MF.util.lerp(a, b, t)`, `MF.util.round(v, p)`,
  `MF.util.uid(prefix)` → unique id string, `MF.util.clone(v)` → JSON deep clone,
  `MF.util.mulberry32(seed)` → deterministic `() => number` in [0,1)

## Module APIs - implement exactly these

### `10-model.js` - `MF.model` (pure, no DOM; must pass unit tests)

Constants:

- `MF.model.VERSION` = 1
- `MF.model.ASPECTS` = `[{ id, w, h }]` with exactly these ids/dimensions:
  `16:9` 1600×900, `4:3` 1440×1080, `1:1` 1200×1200, `9:16` 900×1600,
  `3:2` 1500×1000, `21:9` 1680×720, `2:3` 1000×1500, `a4` 1240×1754.
  Display labels come from locale keys `aspect.16:9`, `aspect.4:3`, … (provide dictionary).
- `MF.model.LIMITS` = `{ points: [2, 12], pointSize: [0.02, 1.4], pointOpacity: [0.05, 1],
  blur: [0, 100], grainAmount: [0, 100], grainScale: [1, 100], grainSeed: [1, 9999],
  vignetteAmount: [0, 100], vignetteSize: [0, 100], glassBlur: [0, 60],
  glassOpacity: [0, 100], glassRadius: [0, 80], glassBorder: [0, 100],
  glassSheen: [0, 100], glassSize: [0.05, 1] }` (arrays are `[min, max]`).
- `MF.model.MIX_MODES` = `['normal', 'screen', 'overlay', 'soft-light', 'lighter']`
- `MF.model.GRAIN_BLENDS` = `['overlay', 'soft-light', 'normal']`
- `MF.model.PALETTES` = 8 palettes `{ id, nameKey, colors: [4..6 hex] }`, ids:
  `aurora`, `sunset`, `ocean`, `neon`, `pastel`, `forest`, `ember`, `mono`. Curated hex colors.
- `MF.model.PRESETS` = **16** presets `{ id, nameKey, tagKey, state }` where `state` is a
  **complete, normalised** composition (use `createState()` then override). Tags are locale
  keys (`tags.soft`, `tags.bold`, `tags.dark`, `tags.warm`, `tags.cool`, `tags.glass`).
  Ids: `aurora-veil`, `peach-haze`, `deep-orbit`, `neon-tokyo`, `cotton-cloud`, `mint-glacier`,
  `ember-dusk`, `violet-drift`, `midnight-mesh`, `citrus-pop`, `rose-quartz`, `solar-flare`,
  `arctic-frost`, `plum-noir`, `glass-panel`, `mono-grain`. Each must look distinct and good:
  different palettes, point counts, blur/grain amounts; at least 4 with `grain.enabled`,
  at least 3 with `glass.enabled`, none with more than 8 points.

Functions:

- `createState()` → default state (aurora palette; 6 points; blur 0; grain off; vignette off;
  glass off; aspect 16:9).
- `aspectOf(state)` → the `ASPECTS` entry.
- `dimensionsOf(state)` → `{ width, height }` in output pixels.
- `clone(state)` → deep JSON clone.
- `normalize(state)` → valid full state: fill missing fields from defaults, clamp numbers,
  drop invalid points, ensure 2..12 points with unique string ids, valid hex colors, valid
  aspect/mix/blend ids. Must never throw; unknown input → `createState()`.
- `validState(value)` → boolean (true iff `normalize` changes nothing meaningful).
- `point(id)` → `{ id, x, y, color, size, opacity }` template? No - instead:
  `newPoint(partial)` → normalised point with id/x/y/color/size/opacity defaults.
- `addPoint(state, at = { x: 0.5, y: 0.5 })` → new state (caps at max, color from palette cycle).
- `removePoint(state, id)` → new state (keeps >= 2 points).
- `patchPoint(state, id, patch)` → new state with clamped point fields.
- `setAspect(state, aspectId)` → new state.
- `applyPreset(presetOrId)` → full new state (look up by id if string).
- `randomize(state, options)` → new state; `options = { seed, paletteId, count }`; completely
  deterministic for a given seed + input (use `MF.util.mulberry32`); picks a palette, 4–8
  points, a pleasant blur 10–70, grain and occasionally glass; keeps `aspect`/`name`.
- `recolor(state, paletteId)` → new state re-colouring existing points from the palette cycle.
- `serialize(state)` → compact JSON string `{ format: 'meshflow-studio', version: 1, state }`.
- `deserialize(text)` → state or `null` (accepts both the envelope and a bare state).
- `toCSS(state)` → string: a complete copy-paste CSS block for the composition
  (`background-color` + layered `radial-gradient()` stack on `::before` with `filter: blur()`,
  optional grain `::after` SVG turbulence overlay, optional `.meshflow-glass` rule and an HTML
  comment showing usage). Must be valid CSS, token-free (it is artwork), deterministic.
- `toJSON(state)` → pretty JSON string of the serialised envelope.
- `filename(state, scale)` → e.g. `meshflow-aurora-veil-3200x1800.png` (slug of name/preset +
  dimensions + `.png`).
- `formatDimensions(state, scale)` → `'3200 × 1800'`.
- `blurPx(state)` → the artistic blur radius in output pixels (`blur/100 * min(width,height) *
  0.09`, rounded).
- `grainTileSize(state)` → integer 48..256 derived from `grain.scale` (small scale = big tile).
- `contrastText(hex)` → `'#ffffff'` or `'#0b0b10'` for readable text on a swatch.
- `MF.model.color` namespace:
  `parse(hex)` → `{ r, g, b, a }` (0..255, a 0..1; accept `#rgb`, `#rrggbb`, `#rrggbbaa`,
  `rgb()/rgba()`); `rgba({r,g,b,a})` → css string; `hex({r,g,b})` → `#rrggbb`;
  `mix(a, b, t)` → hex; `lighten(hex, t)`, `darken(hex, t)`; `luminance(hex)` 0..1;
  `withAlpha(hex, alpha)` → css `rgba(...)`.
- `MF.model.strings` dictionary (preset names, tags, palette names, aspect labels, mixer names)
  under `MF.strings.model.en` / `.zh`.

`test/model.test.mjs` must load the fragment with `node:vm` (define `global.MF`/`MF` stub from
the prelude, then `vm.runInNewContext`), and assert: aspect dimensions, normalize on garbage,
deterministic `randomize` (same seed → same JSON), preset completeness/validity (all 16),
color round-trips, `toCSS` contains `radial-gradient` and no `undefined`, `blurPx`/`grainTileSize`
ranges, serialize→deserialize round-trip. Run with `node --test test/model.test.mjs`.

### `20-engine.js` - `MF.engine` (canvas renderer)

`MF.engine.render(canvas, state, options)` draws the composition into an existing canvas:

- `options = { width, height, pixelRatio = 1, draft = false }`; set `canvas.width/height` to
  `round(width*pixelRatio)` × `round(height*pixelRatio)`, draw with a scaled transform so all
  coordinates are logical (0..width, 0..height). Return `{ width, height }` logical size.
- Pipeline, in order: base fill → point blobs layer (`MF.model.mix` as a canvas
  `globalCompositeOperation` map, `normal` → `source-over`) → whole-canvas blur
  (`options.draft` may cap the pixel ratio/passes) → vignette → grain tile composite
  (`grain.blend` → `overlay`/`soft-light`/`source-over`) → glass card → optional guides
  (draw a 4px crosshair / bounds only when `options.guides`).
- Point blob: radial gradient at `(x*width, y*height)` with radius
  `point.size * max(width,height)`, colour `MF.model.color.withAlpha(point.color, opacity)`
  at 0% → same colour alpha 0 at 72% → transparent at 100%. Draw all blobs on one offscreen
  layer canvas (reuse a cache keyed by `${width}x${height}`), then composite the layer.
- Blur: use `ctx.filter = 'blur(${px}px)'` when available (feature-detect once with
  `typeof ctx.filter === 'string'`); otherwise skip blur. Draw via an offscreen snapshot to
  avoid self-read artefacts.
- Grain: build (and cache) a monochrome noise tile canvas from `MF.util.mulberry32(seed)`
  at `MF.model.grainTileSize(state)`, composite as a repeating pattern with
  `globalAlpha = amount/100` and the mapped blend mode.
- Glass: snapshot the canvas, clip a rounded rect (`x,y` are the card center, `w,h` its size,
  `radius` from the state, clamped), draw the snapshotted content through
  `ctx.filter = 'blur(${glass.blur}px)'` for a frosted backdrop, fill the tint at
  `opacity/100`, add a diagonal sheen gradient at `sheen/100`, a 1px top highlight and a
  border stroke at `border/100`. Reset filters/composite in `finally`-style cleanup.
- `MF.engine.renderToCanvas(state, { width, height, pixelRatio })` → new `<canvas>` (not attached).
- `MF.engine.exportCanvas(state, scale)` → offscreen canvas at
  `MF.model.dimensionsOf(state) * scale` (pixelRatio 1), max side 8192.
- `MF.engine.toDataURL(state, scale)` → `canvas.toDataURL('image/png')`.
- Never throw on bad state: call `MF.model.normalize(state)` first.

`test/engine.test.mjs` (node) asserts the pure parts only: `MF.engine` loads without touching
DOM, and any exposed pure helpers behave (`engine.blurPx?` no - use `MF.model.blurPx`);
`MF.engine` has render/renderToCanvas/exportCanvas/toDataURL functions. Run with `node --test`.

### `25-exporter.js` - `MF.exporter` (download / clipboard / files)

- `MF.exporter.filename(state, scale)` → delegate to `MF.model.filename`.
- `MF.exporter.downloadPNG(state, scale)` → build PNG via `MF.engine` and trigger a download
  with a temporary `<a download>`; return the filename. Must not leave anchors in the DOM.
- `MF.exporter.copyText(text)` → `Promise<boolean>`; uses `navigator.clipboard.writeText`,
  falls back to a hidden textarea + `document.execCommand('copy')` with cleanup.
- `MF.exporter.copyCSS(state)` / `copyJSON(state)` → `Promise<boolean>` wrapping `copyText`
  with `MF.model.toCSS` / `MF.model.toJSON`.
- `MF.exporter.copyPNG(state, scale)` → `Promise<boolean>`; uses `navigator.clipboard.write`
  with a `ClipboardItem` of the PNG blob when available, `false` otherwise.
- `MF.exporter.downloadJSON(state)` / `downloadCSS(state)` → save a `.json` / `.css` file.
- All functions are `async`, never throw (return `false` / `null` on failure), and touch the
  DOM only inside the call.
- Add dictionary keys under `MF.strings.exporter` (button labels used by panels are owned by
  `ui-dev`; exporter itself shows nothing).
- `test/exporter.test.mjs`: assert `MF.exporter` exists, that `MF.model.toCSS` is reused, and
  that copy helpers exist; no DOM required (do not call DOM functions).
- The CSS/JSON/PNG download logic must not depend on the studio component.

### `30-controls.js` - `MF.ui` (presentational React primitives, no app state)

All components are plain functions `(props) => ReactElement`, styled with classes prefixed
`mf-ctl-` declared in the module-level `MF.ui.css` string (concatenated by the Lead into the
page's single `<style>`), theme tokens only:

- `MF.ui.Icon({ name, size = 16 })` - inline `<svg>` icons, `currentColor`, no external assets.
  `MF.ui.icons` contains path data for at least: `dice`, `undo`, `redo`, `plus`, `trash`,
  `download`, `copy`, `image`, `code`, `sliders`, `layers`, `grid`, `close`, `check`,
  `chevron`, `sparkle`, `eye`, `reset`, `save`.
- `MF.ui.Button({ children, onClick, variant = 'ghost' | 'primary' | 'quiet' | 'danger',
  icon, disabled, title, fullWidth, type = 'button' })`
- `MF.ui.IconButton({ icon, label, onClick, active, disabled, size = 30 })` (real `<button>`,
  `aria-label={label}`, `aria-pressed` when `active` is a boolean)
- `MF.ui.Slider({ label, value, min, max, step = 1, onChange, format, disabled, hint })` -
  range input + right-aligned readout (`format ? format(value) : value`), label `<label>`.
- `MF.ui.Toggle({ label, checked, onChange, hint, disabled })` - `role="switch"` button or
  checkbox styled as a switch, `aria-checked`, keyboard operable with Space/Enter.
- `MF.ui.Segmented({ value, options, onChange, label, size = 'sm' })` - options:
  `[{ value, label, icon? }]`, `role="group"`, buttons with `aria-pressed`.
- `MF.ui.Select({ value, options, onChange, label, disabled })` - native `<select>` styled.
- `MF.ui.ColorField({ value, onChange, label })` - swatch button + hex text `<input>` (accepts
  `#rgb`/`#rrggbb`, commits on blur/Enter, shows invalid state) + native
  `<input type="color">` for the OS picker; no library.
- `MF.ui.SwatchRow({ colors, value, onPick, label })` - clickable swatches with selected ring.
- `MF.ui.Section({ title, children, right, dense })` - titled group with a divider.
- `MF.ui.Tabs({ tabs, value, onChange })` - tabs: `[{ id, label, icon? }]`, `role="tablist"`,
  `aria-selected`, arrow-key navigation.
- `MF.ui.Row({ label, children, hint })` - label-left/control-right row.
- `MF.ui.Badge({ children, tone = 'neutral' })`.
- `MF.ui.Kbd({ children })`.
- `MF.ui.css` - one CSS string with all `.mf-ctl-*` classes, hover/focus/disabled/active
  states, no literal chrome colors (tokens only), and a `@media (prefers-reduced-motion)` guard.

Do not define page layout, presets, or state here. Keep every control controlled (no internal
value state except transient text editing in `ColorField`).

### `40-panels.js` - `MF.panels` (studio side panels)

Components receive `t`, `state`, callbacks, and use `MF.model` / `MF.ui` / `MF.engine`.
Classes prefixed `mf-pnl-`, CSS in `MF.panels.css`. Dictionary in `MF.strings.panels`.

- `MF.panels.PresetThumb({ state, width = 112, height })` - draws a mini preview into a
  `<canvas>` via `MF.engine.render` in `useEffect` with `pixelRatio` capped at 1 (never in
  render); renders a wrapper with fixed size and `aria-hidden`. Must handle unmount
  (cancel rAF) and not resize React state during render.
- `MF.panels.PresetRail({ t, state, userPresets, onApply, onRandomize, onSavePreset,
  onDeletePreset, onRecolor })`
  Layout: header (`Presets` + dice icon button), search input filtering by translated name,
  "Surprise me" primary button, palette chips (`MF.model.PALETTES`) calling
  `onRecolor(paletteId)`, scrollable grid of preset cards (2 columns) with
  `PresetThumb` + name + tag; `My presets` section with save-name inline form (input + save
  button; trims, max 32 chars) and delete button per user preset. Empty search → "No presets
  found" state. Clicking a card calls `onApply(preset.state)`; keyboard Enter/Space works.
- `MF.panels.LayerList({ t, state, selectedId, onSelect, onRemove, onAdd })` - list of points
  with a colour dot, label `Node 1..n` (`t('mesh.node')` + index), x/y percentage readout,
  delete icon (disabled at 2 points), selection ring; "Add node" button. Order shown as-is;
  no drag reorder needed.
- `MF.panels.Inspector({ t, state, selectedId, onChange, onSelectPoint, onRandomizePoints,
  onExport, busy, exportScale, onExportScale })` - owns only the active tab state. Tabs:
  `mesh` (LayerList + selected node editor: colour `ColorField`, size/opacity `Slider`, X/Y
  sliders, base colour, mix `Segmented`, palette recolor via `onChange`), `effects`
  (blur, grain toggle/amount/scale/seed + reroll, grain blend, vignette toggle/amount/size),
  `glass` (toggle + position/size/opacity/blur/tint/radius/border/sheen sliders), `export`
  (scale `Segmented` 1×/2×/4× with pixel dimensions, PNG download primary, Copy PNG, Copy CSS,
  Copy JSON, Download CSS/JSON, plus a hint). Show `busy` state on the active export action.
  `onExport` is `{ downloadPNG, copyPNG, copyCSS, copyJSON, downloadCSS, downloadJSON }`, each
  `(scale) => void`/`() => void`. Never call `MF.exporter` directly from panels - the studio
  wires it (panels are dumb).
  All numeric controls use `onChange(nextState, true)` (coalesced) built with spreads.
- `MF.panels.css` string, tokens only.

### `50-studio.js` - `MF.Studio` (main panel page)

`MF.Studio` is the root component rendered in the `main` slot: props `{}` (no session). It
owns the composition state, history, persistence, canvas rendering, node dragging, keyboard
shortcuts and wiring of `MF.panels` and `MF.exporter`.

- Layout: vertical flex, full height (`height: 100%`, `minHeight: 520px`, `minWidth: 0`,
  `boxSizing: border-box`, `overflow: hidden`, background `var(--dsw-alias-bg-base)`).
  Header (title mark + `MeshFlow Studio` + `t('studio.subtitle')` + actions: undo, redo,
  Randomize, Copy CSS, Export PNG) → body `grid-template-columns: 236px minmax(0,1fr) 296px`
  (collapses to one column below 1080px with the rails as horizontal strips / stacked, and
  the inspector below the stage) → status bar (`t('studio.status')` template with
  `${width} × ${height}`, node count, blur, grain, saved state).
- Artboard: centered, aspect-ratio box (`aspect-ratio: w / h`), token border + radius 12px,
  artboard shadow allowed, `canvas` with `width/height` CSS 100%, absolutely-positioned node
  handles layer above it. Handles are `<button aria-label={t('mesh.node') + ' ' + (i+1)}>`
  with `--mf-dot` colour, selected ring; pointer drag (pointer capture) updates x/y live
  (`onChange(next, true)`), one undo entry per drag (snapshot before pointerdown). Double-click
  on the artboard adds a point at that position. Click empty artboard deselects. Show a subtle
  grid overlay toggle. If the stage is bigger than available, `max-width:100%;
  max-height:100%` with `object-fit` behaviour (wrapper flex center + `aspect-ratio`).
- Canvas rendering: `useEffect` on `[state, stageSize, interacting]` → `MF.engine.render(...)`
  with `pixelRatio = Math.min(2, devicePixelRatio)` (1 while interacting) inside
  `requestAnimationFrame`; cancel in cleanup; `ResizeObserver` on the wrapper; no canvas in
  state.
- History: `useReducer`-free plain `useState` + refs is fine; max 80 entries; `undo`/`redo`
  buttons disabled appropriately; a drag pushes exactly one entry; slider changes coalesce
  (append only if the last entry is older than 600ms or the change is non-coalesced).
- Shortcuts (`window.addEventListener('keydown')` in an effect with cleanup): ignore when
  `event.target` is `INPUT`/`TEXTAREA`/`SELECT`/contentEditable; `r` randomize, `mod+z` undo,
  `mod+shift+z` redo, `Delete`/`Backspace` remove selected, `Escape` deselect, arrows nudge
  selected node by `0.005` (`shift` ×4). Do not hijack other keys.
- Persistence: `localStorage` keys `meshflow-studio.state.v2` and
  `meshflow-studio.presets.v1` (try/catch, debounce ~500ms via effect cleanup); restore on
  mount with `MF.model.deserialize`, ignore corrupt values. Custom presets: `{ id, name,
  state, createdAt }`, save current, delete, apply. Use `MF.util.uid`.
- Toast: transient status line for copy/export results (`t('studio.copiedCSS')` etc.),
  auto-clears after 2.2s in an effect cleanup; `aria-live="polite"`.
- Wiring export: `onExport` object calling `MF.exporter.*` with `await`, then toast; `busy`
  state until resolved.
- Render `<style>` once at the top of the tree from `MF.controlsCss + MF.panelsCss +
  MF.studioCss` (Lead exposes `MF.cssAll()`); use `dangerouslySetInnerHTML`.
- Never use `document.body`, never render outside the panel root, no portals.
- Dictionary in `MF.strings.studio` (`studio.*`, `mesh.*`, `effects.*`, `glass.*`, `export.*`
  keys you render). Keep keys consistent with `ui-dev` where they overlap: `mesh.*`, `effects.*`,
  `glass.*`, `export.*` belong to `ui-dev`; the studio reuses those through `t` (they are
  registered globally) - do not duplicate keys with different text. `studio.*` keys are yours.

### `60-register.js` (Lead) - registration shape

The Lead registers: locale namespace `meshflow-studio` (all merged dictionaries), the sidebar
panel icon (`sidebar.panellist`, id `meshflow-studio`), the main panel (`main`, key
`meshflow-studio` = `MF.Studio`), and a compact composer launcher in `conversation.input.left`
that calls `layout.selectPanel('meshflow-studio')`. Nothing for teammates to do here.

## Definition of done for a module owner

1. All your files exist and `node --check src/<your-file>.js` passes for each fragment.
2. Your tests pass: `node --test test/<your-test>.mjs`.
3. No hardcoded visible English outside `MF.strings`; no literal chrome colors; no imports
   besides `react`; no `document.body`.
4. Your components/props match this contract exactly (names, defaults, callback signatures).
5. Report in your completion message: files, exported members, test output summary, and any
   contract deviation (never silently change an interface - message the Lead instead).
