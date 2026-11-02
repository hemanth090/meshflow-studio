# Contributing to MeshFlow Studio

Thanks for helping make MeshFlow Studio better. This is a client-side design-studio plugin for
the DeepSeek Harness Web UI: mesh gradients, blur, grain, vignette and glassmorphism, with PNG and
CSS/JSON export. It is deliberately small - a set of plain-JavaScript fragments compiled into one
browser bundle - and the rules below are what keep it maintainable.

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to contribute

- **Bug reports:** open an issue with the [bug report form](.github/ISSUE_TEMPLATE/bug_report.yml).
  Include your Harness/DSH version, OS, theme and the exact steps that reproduce the problem.
- **Feature ideas:** open an issue with the [feature request form](.github/ISSUE_TEMPLATE/feature_request.yml)
  describing the problem before the solution.
- **Pull requests:** small, focused changes with tests and a green CI run. For anything larger than
  a bug fix or a new preset/palette, open an issue first so the approach can be agreed.
- **Presets and palettes:** curated additions are welcome; they only touch the model fragment and
  its dictionaries (see below).

Please do not report security problems in public issues - see [SECURITY.md](SECURITY.md).

## Development setup

Requirements: **Node.js 20 or newer** (the tooling uses `node:test` / `node:vm`; CI runs Node 20
and 22). There are **no npm dependencies**: the bundle only calls `require('react')`, which the
Harness provides at runtime. You do not need `npm install` or any package manager to build, run or
test the plugin.

```sh
git clone https://github.com/hemanth090/meshflow-studio.git
cd meshflow-studio

node --version                    # v20.x or newer

node build.mjs                    # regenerate client.js from src/*.js
node --check client.js            # syntax-check the generated bundle
node --test test/*.mjs            # run the full test suite (69 tests)
```

`node build.mjs` must be run before the integration test, because `test/integration.test.mjs` loads
the generated `client.js` from disk. `node --test test/model.test.mjs` (and the other unit tests) load
the source fragments directly and do not need a build.

A package manager is optional and only useful if you add throwaway local tooling; do not add runtime
dependencies, and do not commit a lockfile for dependencies the plugin does not have.

## Repository layout

| Path | What it is |
|---|---|
| `src/00-prelude.js` … `src/60-register.js` | The plugin sources - plain script fragments, concatenated in order. |
| `build.mjs` | Build script: validates fragments and writes the generated `client.js`. |
| `client.js` | **Generated** bundle loaded by the DSH module loader. Never edit by hand. |
| `test/*.mjs` | `node:test` unit tests (model, engine, exporter) plus a bundle integration test. |
| `locale/*.json` | Host-side locale metadata (`meta.title`, `meta.description`). |
| `docs/` | Architecture notes and delivered media/showcase assets. |
| `package.json`, `cordis.patch.yml`, `index.js`, `icon.svg` | Bundle/package plumbing. |

## Architecture rules

The full build contract lives in [CONTRACT.md](CONTRACT.md); [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
explains the runtime design. The rules that matter for every contribution:

1. **Fragments are plain scripts.** `src/*.js` are concatenated inside one factory function. No
   `import`/`export`, no JSX, no TypeScript. `React`, `h` and `require` are in scope; the only
   package you may `require()` is `react`.
2. **One shared namespace.** `00-prelude.js` creates `MF`; each module assigns exactly one member
   (`MF.model`, `MF.engine`, `MF.exporter`, `MF.ui`, `MF.panels`, `MF.Studio`, …). Share helpers via
   `MF.util` instead of copying code between modules.
3. **Respect module boundaries.** The build order matters: a module may use a member defined above it
   in the graph (`00-prelude → 10-model → 20-engine → 25-exporter → 30-controls → 40-panels → 50-studio → 60-register`).
   Lazy references inside functions are fine; top-level evaluation order is not.
4. **DOM and browser globals are confined.** Canvas and clipboard access happens only inside
   functions in `20-engine.js` / `25-exporter.js`; React components touch the DOM only through refs
   and effects; `50-studio.js` owns its window listeners inside `useEffect`. Never append to
   `document.body`, never create a second React root, never use `innerHTML` for visible chrome.
   Every effect that adds a listener, timer, `requestAnimationFrame` or `ResizeObserver` must return
   a cleanup that removes/cancels it.
5. **No network.** No `fetch`, no XHR, no WebSockets, no telemetry. Everything runs locally in the
   page; persistence is `localStorage` only.
6. **Chrome uses theme tokens only.** Surfaces, text, borders, focus rings and dividers use
   `var(--dsw-alias-*)`. Literal colours are allowed only for artwork: canvas content, preset
   thumbnails, swatches and gradient values that are part of the saved composition.
7. **Every visible string is translated.** Components receive `t(key)` and render `t('some.key')`.
   Each module owns its dictionary under `MF.strings.<module>` with **both** `en` and `zh` for every
   key; keys are prefixed by module (`model.`, `panels.`, `studio.`, `mesh.`, `effects.`, `glass.`,
   `export.`) and stay under 40 characters. `60-register.js` merges dictionaries first-definition-wins,
   so never redefine a key another module owns.
8. **State is immutable and JSON-serialisable.** Build the next state with object spread; pass it back
   through `onChange(nextState, coalesce)`. Validate with `MF.model.normalize` / `deserialize` at the
   edges; never mutate `state` or its `points` array in place. A drag is one history entry; slider
   scrubs coalesce.
9. **Accessibility is not optional.** Interactive elements are real `<button>`/`<input>`/`<select>`
   controls with accessible names, keyboard reachable, with a visible `2px` brand focus ring. Toggles
   expose `role="switch"` + `aria-checked`; tabs use `role="tablist"`/`aria-selected` with arrow keys;
   sliders pair an `<input type="range">` with a numeric readout; respect `prefers-reduced-motion`.
10. **`client.js` is generated.** Edit `src/`, run `node build.mjs`, and commit the rebuilt
    `client.js` **in the same pull request**. CI fails if the committed bundle differs from a fresh
    build (`git diff --exit-code -- client.js`).

## Adding a preset

1. In `src/10-model.js`, append to `MF.model.PRESETS`:
   `{ id: 'my-preset', nameKey: 'preset.my-preset', tagKey: 'tags.soft', state: <complete state> }`.
   Build the state from `createState()` and override fields; keep 2–12 valid, in-range points.
2. Add the display name (`preset.my-preset`) to the model dictionary in `MF.strings.model` for both
   `en` and `zh`.
3. Run `node build.mjs` and `node --test test/*.mjs`. The preset rail, search and thumbnails pick the
   new entry up automatically; the preset completeness tests will check it.

## Adding a palette

1. In `src/10-model.js`, append `{ id: 'my-palette', nameKey: 'palette.my-palette', colors: [4–6 hex] }`
   to `MF.model.PALETTES`.
2. Add `palette.my-palette` to `MF.strings.model.en` and `.zh`.
3. Rebuild. Palette chips and `MF.model.recolor` use the list directly.

## Adding a locale string

```js
MF.strings.panels = {
  en: { 'panels.presets': 'Presets' },
  zh: { 'panels.presets': '预设' },
};
```

Every key must exist in both locales with a non-empty value. Keep copy short and professional, and
reuse existing keys instead of duplicating them with different text. If you add keys to the host
metadata files (`locale/en.json`, `locale/zh.json`), mirror them there too.

## Tests and CI

| Command | Purpose |
|---|---|
| `node --check src/<file>.js` | Syntax-check one fragment while editing. |
| `node --check client.js` | Syntax-check the generated bundle. |
| `node build.mjs` | Regenerate `client.js`; must be committed with source changes. |
| `node --test test/*.mjs` | Full suite: model, engine, exporter and bundle integration tests (69 tests). |

Tests use `node:test` + `node:vm`. Unit tests evaluate fragments in a VM context seeded with
`00-prelude.js`, so the model stays DOM-free; the integration test loads the built `client.js` with a
minimal React stub and fake `locale`/`slots`/`layout` services. New behavior needs a test; a bug fix
needs a regression test. CI runs on Ubuntu with Node 20 and 22 and executes the bundle syntax check,
the build/sync check, and the test suite.

## Code style

- 2-space indentation, LF line endings, UTF-8, final newline, no trailing whitespace (see
  `.editorconfig`).
- Single quotes, semicolons, trailing commas in multi-line literals. Keep lines readable (~100
  characters); break long expressions rather than cramming them.
- Match the surrounding fragment style: function declarations, `var` and early returns, JSDoc-style
  comments for exported members. The build accepts ES2019+, but consistency wins.
- No formatter is enforced; keep diffs focused. Do not reformat untouched code, and do not rename
  public `MF.*` members or component props - they are a contract.

## Pull request checklist

- [ ] The change is scoped to one concern; unrelated files are untouched.
- [ ] `node --check` passes for every changed fragment (and for `client.js`).
- [ ] `node build.mjs` was run and the regenerated `client.js` is included.
- [ ] `node --test test/*.mjs` passes, with new tests for new behavior.
- [ ] New visible strings exist in `en` and `zh` and go through `t()`.
- [ ] Chrome styling uses theme tokens only; artwork colours stay in composition data.
- [ ] Accessibility checked: names, keyboard path, focus ring, ARIA roles/states.
- [ ] No new dependencies, no network calls, no DOM access outside the allowed modules/effects.
- [ ] Docs (`README.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`) updated when behavior changes.

## Review and merge

Maintainers review for correctness, the contract rules above, and user-visible polish. CI (Node 20/22
matrix) must be green before merge. Keep pull requests small enough to review in one sitting; split
larger work into stacked PRs.
