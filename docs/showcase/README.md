# MeshFlow Studio: showcase artwork

README artwork for MeshFlow Studio, **rendered from the plugin's real data** (never screenshots or
hand-drawn mocks). Every thumbnail is produced by the same drawing pipeline the studio uses, ported
from [`src/20-engine.js`](../../src/20-engine.js) to Pillow + numpy.

| File | Dimensions | Size | What it shows |
|---|---|---|---|
| [`presets-contact-sheet.png`](./presets-contact-sheet.png) | 2400 × 1560 | ~2.2 MB | All 16 curated presets in a uniform 4 × 4 gallery - each card is a real composition, centre-cropped into a 16:9 frame, with its preset name and tag below. Header wordmark and footer caption included. |
| [`palette-wall.png`](./palette-wall.png) | 2000 × 1000 | ~1.3 MB | The 8 curated palettes as full-width mesh strips - each strip is a mini-composition built only from that palette's own colours, with the palette name, colour count, and a glass swatch strip of hex values. |

Both images are optimised PNGs under the 2.5 MB README budget.

## Regenerate

From the repository root:

```bash
python3 docs/showcase/render-showcase.py                # both images
python3 docs/showcase/render-showcase.py --only sheet   # contact sheet only
python3 docs/showcase/render-showcase.py --only palettes # palette wall only
```

The generator is deterministic: the same `src/` data always produces byte-identical PNGs.

**Requirements**

- Python 3.9+, [`Pillow`](https://python-pillow.org/) (≥ 9) and `numpy`
- Node.js ≥ 18 on `PATH` (or point at it with `MESHFLOW_NODE=/path/to/node`)
- No network access, no external image assets, no browser required

## How the artwork is produced

1. **Real data.** The script evaluates `src/00-prelude.js` + `src/10-model.js` inside Node's
   `node:vm` (the same approach as `test/model.test.mjs`) and dumps
   `MF.model.PRESETS`, `MF.model.PALETTES`, `MF.model.ASPECTS`, `MF.model.LIMITS` and the
   `MF.strings.model` en/zh dictionaries as JSON.
2. **Real pipeline.** `render_composition()` re-implements `MF.engine.render()` stage by stage:
   base fill → radial-gradient point blobs drawn on one layer and composited with the preset's
   `mix` mode (`normal`/`screen`/`overlay`/`soft-light`/`lighter`) → whole-canvas Gaussian blur
   (`MF.model.blurPx`) → vignette → seeded grain tile (`MF.util.mulberry32` + `MF.model.grainTileSize`)
   → glass card (frosted backdrop, tint, diagonal sheen, hairline highlight, border).
3. **Gallery chrome.** The contact sheet lays the 16 compositions out in fixed 16:9 cells
   (480 × 270, 12 px radius, 96 px gutters) on a charcoal canvas with soft palette-tinted glows.
   Names and tags come from the locale dictionary; labels use the system sans
   (Avenir Next, Helvetica Neue fallback) and hex values use the system mono (Menlo fallback).
   The palette wall builds one deterministic mini-composition per palette and overlays the name,
   colour count and a glass swatch strip.

## Notes

- The contact sheet renders each preset at its native aspect ratio and centre-crops it into the
  fixed 16:9 cell, so the grid stays perfectly aligned while the artwork still matches the
  composition the studio draws at that aspect.
- Regenerate after editing preset or palette data in `src/10-model.js`. Label rasterisation can
  differ slightly between machines depending on installed system fonts; the artwork itself is
  deterministic.
- Artwork is part of the project and uses the same licence as the rest of the repository. The
  plugin's UI copy is bilingual (en/zh); showcase labels use the English dictionary.
