# Changelog

All notable changes to MeshFlow Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [1.0.0] - 2026-11-02

### Added

- **Mesh composition editor:** compose an artwork from 2–12 radial colour nodes with position,
  size, opacity and colour; drag handles on the artboard to sculpt the mesh, double-click empty
  space to add a node, `Delete` to remove one.
- **16 curated presets** across six tags (soft, bold, dark, warm, cool, glass), with a searchable
  preset rail, deterministic **Randomize**, and user presets saved locally.
- **8 curated palettes:** `aurora`, `sunset`, `ocean`, `neon`, `pastel`, `forest`, `ember`, `mono`,
  usable as one-click recolours.
- **8 aspect ratios:** 16:9 (1600×900), 4:3 (1440×1080), 1:1 (1200×1200), 9:16 (900×1600),
  3:2 (1500×1000), 21:9 (1680×720), 2:3 (1000×1500) and A4 (1240×1754).
- **Soft blur**, **film grain** (amount, tile scale, deterministic seed, overlay / soft-light /
  normal blend) and **vignette** (amount and size) over the composited mesh.
- **Glassmorphism card** with position, size, corner radius, backdrop blur, tint, border and sheen.
- **Undo / redo** history (up to 80 entries; a drag is one step, slider scrubs coalesce).
- **PNG export at 1× / 2× / 4×** with filenames derived from the preset/name and output dimensions,
  plus copy-to-clipboard for the PNG image where the async clipboard image API is available.
- **Copy / download CSS and JSON:** production-ready CSS (layered radial gradients, blur filter,
  optional grain and glass rule) and a versioned JSON composition envelope.
- **Bilingual UI (English + 简体中文)** via the Harness locale service, with a complete dictionary
  for every visible string and live re-render on language switch.
- **Persistence:** the current composition and user presets are stored in `localStorage` and
  restored on mount; corrupt values are ignored.
- **Accessibility:** real buttons/inputs/selects with accessible names, keyboard operation, visible
  brand focus rings, `role="switch"` toggles and arrow-key tabs.
- **Harness integration:** sidebar panel icon (`sidebar.panellist`), main panel (`main`, key
  `meshflow-studio`) and a compact composer launcher (`conversation.input.left`).
- **Keyboard shortcuts:** `R` randomize, `Mod+Z` undo, `Mod+Shift+Z` redo, `Delete`/`Backspace`
  remove the selected node, `Escape` deselect, arrow keys nudge by 0.005 (`Shift` ×4).
- **Zero-dependency tooling:** `node build.mjs` concatenates the plain-script fragments into
  `client.js`; 69 `node:test` unit/integration tests; GitHub Actions CI on Node 20 and 22 with a
  generated-bundle sync check.
- **Open-source project scaffolding:** MIT license, README, architecture and contribution docs,
  code of conduct, security policy, issue forms and a pull-request template.

### Security

- Client-only plugin: no network access, no telemetry, no host services; persistence is limited to
  two `localStorage` keys. Clipboard, download and canvas APIs are feature-detected and fully
  guarded, and temporary DOM nodes are always removed.

[Unreleased]: https://github.com/hemanth090/meshflow-studio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/hemanth090/meshflow-studio/releases/tag/v1.0.0
