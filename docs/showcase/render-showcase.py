#!/usr/bin/env python3
"""
MeshFlow Studio - README showcase renderer.

Generates `presets-contact-sheet.png` and `palette-wall.png` from the plugin's REAL data:

  1. `src/00-prelude.js` + `src/10-model.js` are evaluated with Node's `node:vm` (exactly like
     the unit tests do), and the script dumps `MF.model.PRESETS`, `MF.model.PALETTES`,
     `MF.model.ASPECTS` and `MF.strings.model` as JSON.
  2. This script re-implements the drawing pipeline of `src/20-engine.js` with numpy + Pillow:
     base fill → radial-gradient point blobs (one layer, composited with the state's mix mode)
     → whole-canvas Gaussian blur → vignette → seeded grain tile → glass card
     (frosted backdrop, tint, diagonal sheen, top highlight, border).

So every thumbnail is the same composition the studio renders, not a hand-made mock.
Contact-sheet cells are uniform 16:9 frames: each preset is rendered at its own aspect ratio with
the engine pipeline and centre-cropped to fill the cell, so the 4x4 grid stays aligned.

Usage
-----
    python3 docs/showcase/render-showcase.py                   # write both PNGs
    python3 docs/showcase/render-showcase.py --only sheet      # contact sheet only
    python3 docs/showcase/render-showcase.py --only palettes   # palette wall only

Requirements: Python 3, numpy, Pillow (>= 9), a `node` binary (>= 18) on PATH or in
`MESHFLOW_NODE`. No network access is used and no external image assets are read.

The output is deterministic: the same source data always produces byte-identical PNGs.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------------------

HERE = Path(__file__).resolve().parent  # meshflow-studio/docs/showcase
ROOT = HERE.parents[1]                  # meshflow-studio
SRC = ROOT / "src"
PRELUDE = SRC / "00-prelude.js"
MODEL = SRC / "10-model.js"

# --------------------------------------------------------------------------------------
# 1. Real data: evaluate the model fragment inside Node's vm (same approach as the tests)
# --------------------------------------------------------------------------------------

NODE_DUMP_JS = r"""
const fs = require('node:fs');
const vm = require('node:vm');

const prelude = fs.readFileSync(process.env.MESHFLOW_PRELUDE, 'utf8');
const model = fs.readFileSync(process.env.MESHFLOW_MODEL, 'utf8');

const sandbox = {};
const context = vm.createContext(sandbox);
vm.runInContext(prelude + '\n' + model + '\n;globalThis.MF = MF;', context, {
  filename: 'meshflow-model.js',
});

const MF = sandbox.MF;
const M = MF.model;
const clone = (value) => JSON.parse(JSON.stringify(value));

process.stdout.write(JSON.stringify({
  presets: M.PRESETS.map((preset) => ({
    id: preset.id,
    nameKey: preset.nameKey,
    tagKey: preset.tagKey,
    state: clone(preset.state),
  })),
  palettes: clone(M.PALETTES),
  aspects: clone(M.ASPECTS),
  limits: clone(M.LIMITS),
  mixModes: clone(M.MIX_MODES),
  grainBlends: clone(M.GRAIN_BLENDS),
  strings: clone(MF.strings.model),
}));
"""


def find_node() -> str:
    """Portable node lookup: MESHFLOW_NODE override, then PATH, then a plain `node` call."""
    override = os.environ.get("MESHFLOW_NODE")
    if override:
        return override
    return shutil.which("node") or "node"


def load_model_data() -> dict:
    env = dict(os.environ)
    env["MESHFLOW_PRELUDE"] = str(PRELUDE)
    env["MESHFLOW_MODEL"] = str(MODEL)
    try:
        raw = subprocess.check_output([find_node(), "-e", NODE_DUMP_JS], env=env, text=True)
    except FileNotFoundError:  # pragma: no cover - environment failure
        raise SystemExit(
            "render-showcase.py: node was not found. Install Node or set MESHFLOW_NODE."
        )
    except subprocess.CalledProcessError as error:  # pragma: no cover - setup failure
        raise SystemExit("render-showcase.py: node:vm data dump failed:\n" + str(error))
    return json.loads(raw)


# --------------------------------------------------------------------------------------
# 2. Colour + numeric helpers (ports of MF.model and MF.util)
# --------------------------------------------------------------------------------------


def js_round(value: float) -> int:
    """Math.round: half away from zero toward +inf (Python round() is banker's rounding)."""
    return int(math.floor(float(value) + 0.5))


def clamp(value: float, low: float, high: float) -> float:
    return low if value < low else high if value > high else value


def parse_hex(text: str) -> np.ndarray:
    """`#rgb` / `#rrggbb` → float RGB array (0..255)."""
    value = str(text).strip().lstrip("#")
    if len(value) == 3:
        value = "".join(ch * 2 for ch in value)
    return np.array([int(value[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def to_hex(rgb: np.ndarray) -> str:
    return "#" + "".join(f"{int(clamp(js_round(ch), 0, 255)):02x}" for ch in rgb)


def mix_hex(first: str, second: str, amount: float) -> str:
    a = parse_hex(first)
    b = parse_hex(second)
    t = clamp(amount, 0, 1)
    return to_hex(a + (b - a) * t)


def blend_rgb(base: np.ndarray, source: np.ndarray, mode: str) -> np.ndarray:
    """Canvas `globalCompositeOperation` port for the five supported mix modes."""
    b = base / 255.0
    s = source / 255.0
    if mode == "screen":
        return (1.0 - (1.0 - b) * (1.0 - s)) * 255.0
    if mode == "lighter":
        return np.minimum(255.0, base + source)
    if mode == "overlay":
        out = np.where(b < 0.5, 2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s))
        return out * 255.0
    if mode == "soft-light":
        d = np.where(b <= 0.25, ((16.0 * b - 12.0) * b + 4.0) * b, np.sqrt(b))
        out = np.where(s <= 0.5, b - (1.0 - 2.0 * s) * b * (1.0 - b), b + (2.0 * s - 1.0) * (d - b))
        return out * 255.0
    return source  # normal


def js_mulberry32(seed: int):
    """Bit-exact port of MF.util.mulberry32 (uint32 arithmetic)."""
    a = int(seed) & 0xFFFFFFFF

    def rng() -> float:
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = ((t ^ (t >> 15)) * ((t | 1) & 0xFFFFFFFF)) & 0xFFFFFFFF
        u = ((t ^ (t >> 7)) * ((t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t = (t ^ ((t + u) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rng


# --------------------------------------------------------------------------------------
# 3. Geometry helpers
# --------------------------------------------------------------------------------------


def rounded_rect_alpha(width: int, height: int, x: float, y: float, w: float, h: float,
                       radius: float, softness: float = 1.0) -> np.ndarray:
    """Anti-aliased rounded-rect coverage mask (SDF based, 0..1 float)."""
    radius = max(0.0, min(radius, w / 2.0, h / 2.0))
    xs = np.arange(width, dtype=np.float64)[None, :] + 0.5
    ys = np.arange(height, dtype=np.float64)[:, None] + 0.5
    cx = x + w / 2.0
    cy = y + h / 2.0
    hx = max(0.0, w / 2.0 - radius)
    hy = max(0.0, h / 2.0 - radius)
    dx = np.maximum(np.abs(xs - cx) - hx, 0.0)
    dy = np.maximum(np.abs(ys - cy) - hy, 0.0)
    distance = np.sqrt(dx * dx + dy * dy) - radius
    return np.clip(0.5 - distance / softness, 0.0, 1.0)


def rounded_rect_distance(width: int, height: int, x: float, y: float, w: float, h: float,
                          radius: float) -> np.ndarray:
    radius = max(0.0, min(radius, w / 2.0, h / 2.0))
    xs = np.arange(width, dtype=np.float64)[None, :] + 0.5
    ys = np.arange(height, dtype=np.float64)[:, None] + 0.5
    cx = x + w / 2.0
    cy = y + h / 2.0
    hx = max(0.0, w / 2.0 - radius)
    hy = max(0.0, h / 2.0 - radius)
    dx = np.maximum(np.abs(xs - cx) - hx, 0.0)
    dy = np.maximum(np.abs(ys - cy) - hy, 0.0)
    return np.sqrt(dx * dx + dy * dy) - radius


def circle_alpha(width: int, height: int, cx: float, cy: float, radius: float,
                 softness: float = 1.0) -> np.ndarray:
    xs = np.arange(width, dtype=np.float64)[None, :] + 0.5
    ys = np.arange(height, dtype=np.float64)[:, None] + 0.5
    distance = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) - radius
    return np.clip(0.5 - distance / softness, 0.0, 1.0)


def rounded_stroke_alpha(width: int, height: int, x: float, y: float, w: float, h: float,
                         radius: float, stroke: float) -> np.ndarray:
    distance = rounded_rect_distance(width, height, x, y, w, h, radius)
    return np.clip(0.5 + stroke / 2.0 - np.abs(distance), 0.0, 1.0)


def alpha_over(image: np.ndarray, colour: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha[..., None]
    return image * (1.0 - a) + colour * a


# --------------------------------------------------------------------------------------
# 4. The engine pipeline (port of src/20-engine.js)
# --------------------------------------------------------------------------------------

ASPECTS: dict = {}
GRAIN_TILE_CACHE: dict = {}
MIX_TO_PIPELINE = {
    "normal": "normal",
    "screen": "screen",
    "overlay": "overlay",
    "soft-light": "soft-light",
    "lighter": "lighter",
}


def dimensions_of(state: dict) -> tuple[int, int]:
    aspect = ASPECTS.get(state.get("aspect")) or ASPECTS.get("16:9")
    return int(aspect["w"]), int(aspect["h"])


def model_blur_px(state: dict) -> int:
    natural_w, natural_h = dimensions_of(state)
    return js_round(clamp(float(state.get("blur", 0)), 0, 100) / 100.0
                    * min(natural_w, natural_h) * 0.09)


def model_grain_tile_size(state: dict) -> int:
    scale = clamp(js_round(float(state.get("grain", {}).get("scale", 34))), 1, 100)
    t = (scale - 1) / 99.0
    return js_round(clamp(256.0 + (48.0 - 256.0) * t, 48, 256))


def noise_tile(seed: int, size: int) -> np.ndarray:
    """Port of buildNoiseTile: 128 + round((rng()*2-1)*96), greyscale 32..224."""
    key = (int(seed), int(size))
    cached = GRAIN_TILE_CACHE.get(key)
    if cached is not None:
        return cached
    rng = js_mulberry32(int(seed))
    tile = np.empty((size, size), dtype=np.float64)
    for y in range(size):
        for x in range(size):
            tile[y, x] = 128 + js_round((rng() * 2.0 - 1.0) * 96)
    GRAIN_TILE_CACHE[key] = tile
    return tile


def grain_pattern(seed: int, size: int, width: int, height: int) -> np.ndarray:
    tile = noise_tile(seed, size)
    rows = int(math.ceil(height / size))
    cols = int(math.ceil(width / size))
    return np.tile(tile, (rows, cols))[:height, :width]


def glass_rect(state: dict, width: int, height: int) -> dict | None:
    """Port of MF.engine.glassRect (logical pixels, x/y = top-left)."""
    glass = state.get("glass") or {}
    w = clamp(float(glass.get("w", 0.52)), 0.02, 1.0) * width
    h = clamp(float(glass.get("h", 0.42)), 0.02, 1.0) * height
    if not (w > 0) or not (h > 0):
        return None
    cx = clamp(float(glass.get("x", 0.5)), 0.0, 1.0) * width
    cy = clamp(float(glass.get("y", 0.5)), 0.0, 1.0) * height
    left = clamp(cx - w / 2.0, 0.0, max(0.0, width - w))
    top = clamp(cy - h / 2.0, 0.0, max(0.0, height - h))
    radius = clamp(float(glass.get("radius", 28)), 0.0, min(w, h) / 2.0)
    return {"x": left, "y": top, "w": w, "h": h, "r": radius}


def render_composition(state: dict, target_w: int, target_h: int, pixel_ratio: float = 2.0) -> Image.Image:
    """
    Draw one composition, mirroring `MF.engine.render(canvas, state, {width, height, pixelRatio})`.

    Returns a Pillow RGB image at (target_w, target_h) logical pixels, rendered at
    `pixel_ratio` device scale and downsampled with Lanczos.
    """
    natural_w, natural_h = dimensions_of(state)
    ratio = clamp(max(target_w, target_h) / max(natural_w, natural_h), 0.04, 4.0)

    pw = max(1, js_round(target_w * pixel_ratio))
    ph = max(1, js_round(target_h * pixel_ratio))
    pr = float(pixel_ratio)

    # --- stage 1: base fill ---------------------------------------------------------
    base_rgb = parse_hex(state.get("base", "#0a0a12"))
    image = np.zeros((ph, pw, 3), dtype=np.float64) + base_rgb

    # --- stage 2: point blobs on one transparent layer, composited with the mix mode --
    points = state.get("points") or []
    if points:
        xs = np.arange(pw, dtype=np.float64)[None, :] + 0.5
        ys = np.arange(ph, dtype=np.float64)[:, None] + 0.5
        max_side = float(max(pw, ph))
        layer_premult = np.zeros((ph, pw, 3), dtype=np.float64)
        layer_alpha = np.zeros((ph, pw, 1), dtype=np.float64)
        for point in points:
            radius = max(0.5, float(point.get("size", 0.5)) * max_side)
            cx = float(point.get("x", 0.5)) * pw
            cy = float(point.get("y", 0.5)) * ph
            opacity = clamp(float(point.get("opacity", 1.0)), 0.0, 1.0)
            # createRadialGradient: alpha opacity at 0, alpha 0 at 0.72, transparent after.
            falloff = np.clip(1.0 - np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2) / (0.72 * radius), 0.0, 1.0)
            alpha = (opacity * falloff)[..., None]
            colour = parse_hex(point.get("color", "#ffffff"))
            layer_premult = colour * alpha + layer_premult * (1.0 - alpha)
            layer_alpha = alpha + layer_alpha * (1.0 - alpha)
        safe_alpha = np.maximum(layer_alpha, 1e-6)
        layer_rgb = np.where(layer_alpha > 1e-6, layer_premult / safe_alpha, 0.0)
        source_blend = blend_rgb(image, layer_rgb, MIX_TO_PIPELINE.get(state.get("mix"), "normal"))
        image = (1.0 - layer_alpha) * image + layer_alpha * source_blend

    # --- stage 3: whole-canvas Gaussian blur through a snapshot -----------------------
    logical_blur = model_blur_px(state) * ratio
    if logical_blur > 0.25:
        device_blur = js_round(logical_blur * pr * 10) / 10.0
        if device_blur > 0.05:
            snapshot = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
            image = np.asarray(snapshot.filter(ImageFilter.GaussianBlur(device_blur)), dtype=np.float64)

    # --- stage 4: vignette ------------------------------------------------------------
    vignette = state.get("vignette") or {}
    if vignette.get("enabled"):
        amount = clamp(float(vignette.get("amount", 24)), 0.0, 100.0) / 100.0
        if amount > 0:
            size = clamp(float(vignette.get("size", 60)), 0.0, 100.0) / 100.0
            outer = max(pw, ph) * 0.78
            inner = clamp(size * 0.62, 0.0, 0.95)
            xs = np.arange(pw, dtype=np.float64)[None, :] + 0.5
            ys = np.arange(ph, dtype=np.float64)[:, None] + 0.5
            distance = np.sqrt((xs - pw / 2.0) ** 2 + (ys - ph / 2.0) ** 2) / outer
            t = np.clip((distance - inner) / max(1e-6, 1.0 - inner), 0.0, 1.0)
            image = image * (1.0 - t * amount * 0.92)[..., None]

    # --- stage 5: grain ---------------------------------------------------------------
    grain = state.get("grain") or {}
    if grain.get("enabled"):
        amount = clamp(float(grain.get("amount", 0)), 0.0, 100.0) / 100.0
        if amount > 0:
            tile_size = int(clamp(js_round(model_grain_tile_size(state) * ratio * pr), 4, 256))
            seed = int(clamp(js_round(float(grain.get("seed", 7))), 1, 9999))
            pattern = grain_pattern(seed, tile_size, pw, ph)
            source = np.repeat(pattern[..., None], 3, axis=2)
            blended = blend_rgb(image, source, MIX_TO_PIPELINE.get(grain.get("blend"), "normal"))
            image = (1.0 - amount) * image + amount * blended

    # --- stage 6: glassmorphism card ---------------------------------------------------
    glass = state.get("glass") or {}
    logical_glass: dict | None = None
    if glass.get("enabled"):
        logical_glass = glass_rect(state, target_w, target_h)
    if logical_glass:
        gx = logical_glass["x"] * pr
        gy = logical_glass["y"] * pr
        gw = logical_glass["w"] * pr
        gh = logical_glass["h"] * pr
        gr = logical_glass["r"] * pr
        blur = clamp(float(glass.get("blur", 18)), 0.0, 60.0) * ratio * pr
        opacity = clamp(float(glass.get("opacity", 14)), 0.0, 100.0) / 100.0
        tint = parse_hex(glass.get("tint", "#ffffff"))
        sheen = clamp(float(glass.get("sheen", 30)), 0.0, 100.0) / 100.0
        mask = rounded_rect_alpha(pw, ph, gx, gy, gw, gh, gr)

        if blur > 0.4:
            snapshot = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
            image = np.asarray(snapshot.filter(ImageFilter.GaussianBlur(blur)), dtype=np.float64)

        if opacity > 0:
            tinted = image * (1.0 - opacity) + tint * opacity
            image = np.where(mask[..., None] > 0.0, tinted, image)

        if sheen > 0 and gw > 0 and gh > 0:
            xs = np.arange(pw, dtype=np.float64)[None, :] + 0.5
            ys = np.arange(ph, dtype=np.float64)[:, None] + 0.5
            t = ((xs - gx) * gw + (ys - gy) * gh) / (gw * gw + gh * gh)
            t = np.clip(t, 0.0, 1.0)
            stops = [(0.0, sheen * 0.55), (0.45, sheen * 0.08), (1.0, 0.0)]
            alpha = np.interp(t, [s[0] for s in stops], [s[1] for s in stops])
            image = alpha_over(image, np.full(3, 255.0), alpha * mask)

        logical_glass = {
            "x": logical_glass["x"], "y": logical_glass["y"],
            "w": logical_glass["w"], "h": logical_glass["h"], "r": logical_glass["r"],
            "border": clamp(float(glass.get("border", 40)), 0.0, 100.0) / 100.0,
        }

    # --- back to logical pixels --------------------------------------------------------
    logical = Image.fromarray(np.clip(image, 0, 255).astype(np.uint8))
    if (pw, ph) != (target_w, target_h):
        logical = logical.resize((target_w, target_h), Image.Resampling.LANCZOS)

    # Glass highlight + border are drawn at logical resolution so the hairline stays crisp
    # after the style's own downsample (equivalent to the browser showing a 2x canvas at 1x).
    if logical_glass:
        array = np.asarray(logical, dtype=np.float64)
        x, y, w, h, r = (logical_glass[k] for k in ("x", "y", "w", "h", "r"))
        hairline = 1.0
        highlight_width = max(0.0, w - r * 2.0)
        if highlight_width > 0:
            xs = np.arange(target_w, dtype=np.float64)[None, :] + 0.5
            ys = np.arange(target_h, dtype=np.float64)[:, None] + 0.5
            start = x + min(r, highlight_width)
            u = (xs - start) / highlight_width
            line_alpha = np.where((u >= 0.0) & (u <= 1.0),
                                  np.interp(np.clip(u, 0.0, 1.0), [0.0, 0.5, 1.0], [0.0, 0.34, 0.0]),
                                  0.0)
            cover = rounded_rect_alpha(target_w, target_h, x, y, w, h, r)
            rows = (ys >= y) & (ys < y + hairline)
            a = line_alpha * rows * cover
            array = alpha_over(array, np.full(3, 255.0), a)
        border = logical_glass["border"]
        if border > 0:
            stroke = rounded_stroke_alpha(target_w, target_h, x + 0.5, y + 0.5,
                                          max(0.0, w - 1.0), max(0.0, h - 1.0),
                                          max(0.0, r - 0.5), hairline)
            array = alpha_over(array, np.full(3, 255.0), stroke * (border * 0.54))
        logical = Image.fromarray(np.clip(array, 0, 255).astype(np.uint8))

    return logical


# --------------------------------------------------------------------------------------
# 5. Typography
# --------------------------------------------------------------------------------------

FONT_FILES = {
    "display": [
        ("/System/Library/Fonts/Avenir Next.ttc", 2),   # Demi Bold
        ("/System/Library/Fonts/HelveticaNeue.ttc", 10),
        ("/System/Library/Fonts/Helvetica.ttc", 1),
    ],
    "medium": [
        ("/System/Library/Fonts/Avenir Next.ttc", 5),   # Medium
        ("/System/Library/Fonts/HelveticaNeue.ttc", 10),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
    ],
    "regular": [
        ("/System/Library/Fonts/Avenir Next.ttc", 7),   # Regular
        ("/System/Library/Fonts/HelveticaNeue.ttc", 0),
        ("/System/Library/Fonts/Helvetica.ttc", 0),
    ],
    "mono": [
        ("/System/Library/Fonts/Menlo.ttc", 0),
        ("/System/Library/Fonts/Supplemental/Andale Mono.ttf", 0),
        ("/System/Library/Fonts/Monaco.ttf", 0),
    ],
}

FONT_CACHE: dict = {}


def font(role: str, size: int) -> ImageFont.FreeTypeFont:
    key = (role, int(size))
    if key in FONT_CACHE:
        return FONT_CACHE[key]
    for path, index in FONT_FILES[role]:
        if Path(path).exists():
            try:
                loaded = ImageFont.truetype(path, int(size), index=index)
                FONT_CACHE[key] = loaded
                return loaded
            except OSError:
                continue
    fallback = ImageFont.load_default(size=int(size))
    FONT_CACHE[key] = fallback
    return fallback


def text_width(draw: ImageDraw.ImageDraw, text: str, face, tracking: float = 0.0) -> float:
    if tracking:
        return sum(draw.textlength(ch, font=face) for ch in text) + tracking * max(0, len(text) - 1)
    return draw.textlength(text, font=face)


def draw_tracked(draw: ImageDraw.ImageDraw, xy: tuple[float, float], text: str, face,
                 fill, tracking: float = 0.0, anchor_center: bool = False) -> float:
    """Draw text with letter tracking (Pillow has no tracking support)."""
    if not tracking:
        if anchor_center:
            draw.text((xy[0], xy[1]), text, font=face, fill=fill, anchor="ma")
        else:
            draw.text((xy[0], xy[1]), text, font=face, fill=fill, anchor="ls")
        return draw.textlength(text, font=face)
    total = text_width(draw, text, face, tracking)
    x = xy[0] - total / 2.0 if anchor_center else xy[0]
    for ch in text:
        draw.text((x, xy[1]), ch, font=face, fill=fill, anchor="ls")
        x += draw.textlength(ch, font=face) + tracking
    return total


def draw_tracked_right(draw: ImageDraw.ImageDraw, right: float, baseline: float, text: str,
                       face, fill, tracking: float = 0.0) -> float:
    total = text_width(draw, text, face, tracking)
    draw_tracked(draw, (right - total, baseline), text, face, fill, tracking)
    return total


# --------------------------------------------------------------------------------------
# 6. Shared sheet chrome: background, wordmark, dividers
# --------------------------------------------------------------------------------------

SHEET_BG_TOP = np.array([12, 12, 22], dtype=np.float64)
SHEET_BG_BOTTOM = np.array([7, 7, 12], dtype=np.float64)
INK = (242, 242, 248)
INK_MUTED = (150, 150, 168)
INK_DIM = (108, 108, 126)
RULE = (255, 255, 255, 20)

TAG_COLOURS = {
    "soft": (143, 211, 255),
    "bold": (255, 158, 196),
    "dark": (185, 185, 201),
    "warm": (255, 201, 143),
    "cool": (143, 217, 200),
    "glass": (214, 214, 230),
}


def make_background(width: int, height: int, glows: list) -> np.ndarray:
    """Vertical charcoal gradient plus soft coloured glows (all from real palette colours)."""
    image = np.zeros((height, width, 3), dtype=np.float64)
    t = np.linspace(0.0, 1.0, height)[:, None]
    image[:, :, :] = SHEET_BG_TOP * (1.0 - t)[..., None] + SHEET_BG_BOTTOM * t[..., None]
    xs = np.arange(width, dtype=np.float64)[None, :] + 0.5
    ys = np.arange(height, dtype=np.float64)[:, None] + 0.5
    for glow in glows:
        cx, cy, rx, ry, colour, strength = glow
        d = np.sqrt(((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2)
        falloff = np.clip(1.0 - d, 0.0, 1.0) ** 2.2
        image = image + (np.array(colour, dtype=np.float64) - image) * (falloff * strength)[..., None]
    return image


def paste_rgba(base: Image.Image, layer: Image.Image, position: tuple[int, int]) -> None:
    base.paste(layer, position, layer)


def make_wordmark_mark(size: int, palettes: list) -> Image.Image:
    """Rounded mesh mark rendered from the real aurora palette colours."""
    aurora = next((p for p in palettes if p["id"] == "aurora"), palettes[0])
    colours = aurora["colors"][:4]
    state = {
        "version": 1,
        "name": "mark",
        "aspect": "1:1",
        "base": "#08080f",
        "mix": "screen",
        "points": [
            {"id": "p1", "x": 0.26, "y": 0.3, "color": colours[0], "size": 0.7, "opacity": 0.95},
            {"id": "p2", "x": 0.74, "y": 0.28, "color": colours[1], "size": 0.62, "opacity": 0.9},
            {"id": "p3", "x": 0.62, "y": 0.76, "color": colours[2 % len(colours)], "size": 0.66, "opacity": 0.85},
            {"id": "p4", "x": 0.2, "y": 0.78, "color": colours[3 % len(colours)], "size": 0.5, "opacity": 0.7},
        ],
        "blur": 18,
        "grain": {"enabled": False, "amount": 0, "scale": 34, "seed": 7, "blend": "overlay"},
        "vignette": {"enabled": False, "amount": 24, "size": 60},
        "glass": {
            "enabled": False, "x": 0.5, "y": 0.5, "w": 0.52, "h": 0.42, "radius": 28,
            "blur": 18, "opacity": 14, "tint": "#ffffff", "border": 40, "sheen": 30,
        },
        "palette": aurora["id"],
    }
    image = render_composition(state, size, size, pixel_ratio=3.0)
    array = np.asarray(image, dtype=np.float64)
    mask = rounded_rect_alpha(size, size, 0.0, 0.0, float(size), float(size), size * 0.26)
    border = rounded_stroke_alpha(size, size, 0.5, 0.5, size - 1.0, size - 1.0,
                                  size * 0.26 - 0.5, 1.0)
    array = alpha_over(array, np.full(3, 255.0), border * 0.24)
    rgba = np.dstack([np.clip(array, 0, 255), mask * 255.0]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def draw_header(sheet: Image.Image, draw: ImageDraw.ImageDraw, data: dict,
                title: str, subtitle: str, caption: str, caption_note: str,
                mark_size: int = 64, left: int = 72, top: int = 54,
                title_size: int = 44, subtitle_size: int = 16,
                rule_fill: tuple = RULE) -> int:
    mark = make_wordmark_mark(mark_size, data["palettes"])
    sheet.paste(mark, (left, top), mark)
    title_x = left + mark_size + 22
    draw.text((title_x, top + mark_size / 2.0 - 6), title, font=font("display", title_size),
              fill=INK, anchor="ls")
    draw.text((title_x + 2, top + mark_size + 18), subtitle, font=font("regular", subtitle_size),
              fill=INK_MUTED, anchor="ls")
    right = sheet.width - left
    draw_tracked_right(draw, right, top + 26, caption, font("medium", 18), (206, 206, 220))
    draw_tracked_right(draw, right, top + 50, caption_note, font("regular", 13), INK_DIM)
    rule_y = top + mark_size + 52
    draw.line([(left, rule_y), (right, rule_y)], fill=rule_fill, width=1)
    return rule_y


# --------------------------------------------------------------------------------------
# 7. presets-contact-sheet.png  (2400 x 1560)
# --------------------------------------------------------------------------------------

SHEET_W, SHEET_H = 2400, 1560
SHEET_SIDE = 96
CARD_W, CARD_H = 480, 270          # exact 16:9 cells; compositions are centre-cropped into them
CARD_RADIUS = 12
CARD_GAP_X = 96                    # gutters match the 96 px side margins
CARD_GAP_Y = 8
LABEL_H = 42                       # name + tag band under each card
ROW_H = CARD_H + LABEL_H
GRID_TOP = 186
FOOTER_RULE_Y = 1466               # footer caption baseline at 1492 -> 68 px bottom margin

# Layout invariants: the 4x4 grid plus a readable footer must fit 2400x1560.
assert 4 * CARD_W + 3 * CARD_GAP_X == SHEET_W - 2 * SHEET_SIDE
assert GRID_TOP + 4 * ROW_H + 3 * CARD_GAP_Y <= FOOTER_RULE_Y - 6


def render_preset_cell(state: dict, cell_w: int, cell_h: int, pixel_ratio: float = 2.0) -> Image.Image:
    """
    Render a preset at its native aspect ratio, then centre-crop it to the fixed cell aspect.

    The composition is rendered at `cell_w * pixel_ratio` wide (in the cropped region) so the
    engine pipeline's blur/grain/glass scaling matches the cropped frame, then the crop is
    downsampled to the cell size with Lanczos.
    """
    natural_w, natural_h = dimensions_of(state)
    cell_aspect = cell_w / float(cell_h)
    if natural_w / natural_h > cell_aspect:       # wider than the cell -> crop left/right
        crop_nat_w = natural_h * cell_aspect
        crop_nat_h = float(natural_h)
    else:                                          # taller than the cell -> crop top/bottom
        crop_nat_w = float(natural_w)
        crop_nat_h = natural_w / cell_aspect

    device_w = max(2, js_round(cell_w * pixel_ratio))
    device_h = max(2, js_round(cell_h * pixel_ratio))
    scale = device_w / crop_nat_w
    render_w = max(2, js_round(natural_w * scale))
    render_h = max(2, js_round(natural_h * scale))

    full = render_composition(state, render_w, render_h, pixel_ratio=1.0)
    crop_w = min(device_w, full.width)
    crop_h = min(device_h, full.height)
    left = (full.width - crop_w) // 2
    top = (full.height - crop_h) // 2
    cropped = full.crop((left, top, left + crop_w, top + crop_h))
    if cropped.size != (cell_w, cell_h):
        cropped = cropped.resize((cell_w, cell_h), Image.Resampling.LANCZOS)
    return cropped


def compose_contact_sheet(data: dict) -> Image.Image:
    presets = data["presets"]
    strings = data["strings"]["en"]
    palettes = data["palettes"]

    aurora = next((p for p in palettes if p["id"] == "aurora"), palettes[0])
    violet = next((p for p in palettes if p["id"] == "neon"), palettes[3])
    background = make_background(SHEET_W, SHEET_H, [
        (SHEET_W * 0.26, 60.0, 900.0, 460.0, parse_hex(aurora["colors"][0]), 0.055),
        (SHEET_W * 0.78, 30.0, 820.0, 420.0, parse_hex(violet["colors"][2]), 0.05),
        (SHEET_W * 0.5, SHEET_H + 140.0, 1400.0, 420.0, np.array([80.0, 70.0, 140.0]), 0.035),
    ])
    sheet = Image.fromarray(np.clip(background, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(sheet)

    # Header wordmark row (unchanged design, aligned to the same 96 px side margins as the grid).
    draw_header(
        sheet, draw, data,
        title="MeshFlow Studio",
        subtitle="Mesh gradients \u00b7 film grain \u00b7 glassmorphism",
        caption="16 curated presets \u00b7 8 palettes",
        caption_note="rendered from the real plugin data",
        mark_size=64, left=SHEET_SIDE, top=54, rule_fill=(30, 30, 42),
    )

    # Uniform grid: one 16:9 cell per preset, equal gutters, aligned columns and rows.
    cards = []
    for index, preset in enumerate(presets):
        column = index % 4
        row = index // 4
        card_x = SHEET_SIDE + column * (CARD_W + CARD_GAP_X)
        card_y = GRID_TOP + row * (ROW_H + CARD_GAP_Y)
        image = render_preset_cell(preset["state"], CARD_W, CARD_H, pixel_ratio=2.0)
        cards.append({"preset": preset, "image": image, "x": card_x, "y": card_y})

    # One consistent soft outer glow behind every card (same radius, blur, alpha, offset).
    shadow_mask = Image.new("L", (SHEET_W, SHEET_H), 0)
    shadow_draw = ImageDraw.Draw(shadow_mask)
    for card in cards:
        shadow_draw.rounded_rectangle(
            [card["x"] + 1, card["y"] + 10, card["x"] + CARD_W - 1, card["y"] + CARD_H + 10],
            radius=CARD_RADIUS, fill=155,
        )
    shadow_mask = shadow_mask.filter(ImageFilter.GaussianBlur(18))
    sheet.paste(Image.new("RGB", (SHEET_W, SHEET_H), (0, 0, 0)), (0, 0), shadow_mask)

    # Paste every card with the same rounded-corner mask.
    corner_mask = rounded_rect_alpha(CARD_W, CARD_H, 0.0, 0.0, float(CARD_W), float(CARD_H),
                                     CARD_RADIUS)
    for card in cards:
        image = card["image"]
        rgba = np.dstack([np.asarray(image, dtype=np.uint8), (corner_mask * 255.0).astype(np.uint8)])
        layer = Image.fromarray(rgba, "RGBA")
        sheet.paste(layer, (card["x"], card["y"]), layer)

    # Consistent 1 px hairline border on every card.
    border_mask = Image.new("L", (SHEET_W, SHEET_H), 0)
    border_draw = ImageDraw.Draw(border_mask)
    for card in cards:
        border_draw.rounded_rectangle(
            [card["x"], card["y"], card["x"] + CARD_W - 1, card["y"] + CARD_H - 1],
            radius=CARD_RADIUS, outline=255, width=1,
        )
    sheet.paste(Image.new("RGB", (SHEET_W, SHEET_H), (255, 255, 255)), (0, 0),
                border_mask.point(lambda value: int(value * 0.11)))

    # Labels: identical baselines for every card (name line, then tag line).
    draw = ImageDraw.Draw(sheet)
    for card in cards:
        preset = card["preset"]
        name = strings.get(preset["nameKey"], preset["id"])
        tag = strings.get(preset["tagKey"], preset["tagKey"].split(".")[-1])
        centre_x = card["x"] + CARD_W / 2.0
        name_baseline = card["y"] + CARD_H + 22
        draw.text((centre_x, name_baseline), name, font=font("display", 20), fill=INK, anchor="ms")
        tag_colour = TAG_COLOURS.get(preset["tagKey"].split(".")[-1], INK_MUTED)
        draw_tracked(draw, (centre_x, name_baseline + 16), tag.upper(), font("medium", 10),
                     tag_colour, tracking=1.6, anchor_center=True)

    # Footer: caption lines fully inside the canvas with a comfortable bottom margin.
    draw.line([(SHEET_SIDE, FOOTER_RULE_Y), (SHEET_W - SHEET_SIDE, FOOTER_RULE_Y)],
              fill=(26, 26, 36), width=1)
    footer_baseline = FOOTER_RULE_Y + 26
    draw_tracked(draw, (SHEET_SIDE, footer_baseline),
                 "GENERATED FROM src/10-model.js \u00b7 SOURCE DATA, NOT SCREENSHOTS",
                 font("medium", 10.5), (126, 126, 144), tracking=1.6)
    draw_tracked_right(draw, SHEET_W - SHEET_SIDE, footer_baseline,
                       "2400 \u00d7 1560", font("medium", 10.5), (126, 126, 144), tracking=1.6)
    return sheet


# --------------------------------------------------------------------------------------
# 8. palette-wall.png  (2000 x 1000)
# --------------------------------------------------------------------------------------

WALL_W, WALL_H = 2000, 1000
WALL_MARGIN = 56
WALL_ROW_H = 88
WALL_ROW_GAP = 12
WALL_TOP = 172


def palette_strip_state(palette: dict, index: int) -> dict:
    """Deterministic mini-composition built only from a palette's real colours."""
    colours = palette["colors"]
    count = len(colours)
    points = []
    for position, colour in enumerate(colours):
        x = 0.05 + (position + 0.5) * (0.9 / count)
        y = 0.5 + ((position % 2) - 0.5) * 0.36 + ((index % 3) - 1) * 0.05
        size = 0.55 + 0.17 * (((position * 3 + index) % 4) / 3.0)
        opacity = 0.78 + 0.06 * (position % 3)
        points.append({
            "id": f"p{position + 1}",
            "x": round(x, 4),
            "y": round(clamp(y, 0.08, 0.92), 4),
            "color": colour,
            "size": round(size, 3),
            "opacity": round(opacity, 3),
        })
    return {
        "version": 1,
        "name": palette["id"],
        "aspect": "21:9",
        "base": mix_hex("#07070f", colours[0], 0.12),
        "mix": "screen",
        "points": points,
        "blur": 22,
        "grain": {"enabled": True, "amount": 8, "scale": 72,
                  "seed": 11 + index * 7, "blend": "overlay"},
        "vignette": {"enabled": False, "amount": 24, "size": 60},
        "glass": {
            "enabled": False, "x": 0.5, "y": 0.5, "w": 0.52, "h": 0.42,
            "radius": 28, "blur": 18, "opacity": 14, "tint": "#ffffff",
            "border": 40, "sheen": 30,
        },
        "palette": palette["id"],
    }


def compose_palette_wall(data: dict) -> Image.Image:
    palettes = data["palettes"]
    strings = data["strings"]["en"]
    aurora = palettes[0]
    ember = next((p for p in palettes if p["id"] == "ember"), palettes[0])
    background = make_background(WALL_W, WALL_H, [
        (WALL_W * 0.18, 40.0, 760.0, 340.0, parse_hex(aurora["colors"][0]), 0.05),
        (WALL_W * 0.84, 20.0, 700.0, 320.0, parse_hex(ember["colors"][2]), 0.045),
    ])
    wall = Image.fromarray(np.clip(background, 0, 255).astype(np.uint8))
    draw = ImageDraw.Draw(wall)

    draw_header(
        wall, draw, data,
        title="Palettes",
        subtitle="Eight curated palettes \u00b7 recolor a composition with one click",
        caption="8 palettes \u00b7 4\u20136 colours each",
        caption_note="every strip is a mesh rendered from its own colours",
        mark_size=56, left=WALL_MARGIN, top=46, title_size=40, subtitle_size=15,
    )

    strip_w = WALL_W - 2 * WALL_MARGIN
    strip_radius = 14

    for index, palette in enumerate(palettes):
        row_y = WALL_TOP + index * (WALL_ROW_H + WALL_ROW_GAP)
        state = palette_strip_state(palette, index)
        strip = render_composition(state, strip_w, WALL_ROW_H, pixel_ratio=2.0)
        strip_array = np.asarray(strip, dtype=np.float64)

        width = strip_w
        xs = np.arange(width, dtype=np.float64)[None, :] + 0.5
        ys = np.arange(WALL_ROW_H, dtype=np.float64)[:, None] + 0.5

        # Left scrim so the palette name always reads; right scrim for the swatch pill.
        left_scrim = np.clip(1.0 - (xs - 0.0) / 460.0, 0.0, 1.0) ** 1.6 * 0.66
        right_start = width - 560.0
        right_scrim = np.clip(1.0 - (width - xs) / 600.0, 0.0, 1.0) ** 1.6 * 0.5
        scrim = np.clip(left_scrim + right_scrim, 0.0, 0.8)
        strip_array = strip_array * (1.0 - scrim[..., None])

        # Rounded corners + hairline border.
        mask = rounded_rect_alpha(width, WALL_ROW_H, 0.0, 0.0, float(width), float(WALL_ROW_H),
                                  strip_radius)
        border = rounded_stroke_alpha(width, WALL_ROW_H, 0.5, 0.5, width - 1.0, WALL_ROW_H - 1.0,
                                      strip_radius - 0.5, 1.0)
        strip_array = alpha_over(strip_array, np.full(3, 255.0), border * 0.10)

        rgba = np.dstack([np.clip(strip_array, 0, 255).astype(np.uint8),
                          (mask * 255.0).astype(np.uint8)])
        layer = Image.fromarray(rgba, "RGBA")
        wall.paste(layer, (WALL_MARGIN, row_y), layer)

        # Left overlay: palette name + colour count.
        name = strings.get(palette.get("nameKey", "palette." + palette["id"]), palette["id"])
        draw = ImageDraw.Draw(wall)
        name_baseline = row_y + 55
        draw.text((WALL_MARGIN + 30, name_baseline), name.title() if name.islower() else name,
                  font=font("display", 24), fill=(250, 250, 255), anchor="ls")
        draw_tracked(draw, (WALL_MARGIN + 30, name_baseline + 20),
                     f"{len(palette['colors'])} COLOURS", font("medium", 9.5),
                     (255, 255, 255), tracking=1.8)

        # Right overlay: glass pill with swatch circles + hex codes.
        colours = palette["colors"]
        item_w = 52.0
        gap = 18.0
        pill_h = 54.0
        pill_w = len(colours) * item_w + (len(colours) - 1) * gap + 36.0
        pill_x = WALL_MARGIN + width - 26.0 - pill_w
        pill_y = row_y + (WALL_ROW_H - pill_h) / 2.0
        pill = rounded_rect_alpha(WALL_W, WALL_H, pill_x, pill_y, pill_w, pill_h, pill_h / 2.0)
        pill_border = rounded_stroke_alpha(WALL_W, WALL_H, pill_x + 0.5, pill_y + 0.5,
                                           pill_w - 1.0, pill_h - 1.0,
                                           pill_h / 2.0 - 0.5, 1.0)
        full = np.asarray(wall, dtype=np.float64)
        full = alpha_over(full, np.array([7.0, 7.0, 13.0]), pill * 0.46)
        full = alpha_over(full, np.full(3, 255.0), pill_border * 0.16)
        wall = Image.fromarray(np.clip(full, 0, 255).astype(np.uint8))
        draw = ImageDraw.Draw(wall)

        for swatch_index, colour in enumerate(colours):
            cell_x = pill_x + 18.0 + swatch_index * (item_w + gap)
            cx = cell_x + item_w / 2.0
            circle = circle_alpha(WALL_W, WALL_H, cx, pill_y + 18.0, 9.0)
            full = np.asarray(wall, dtype=np.float64)
            full = alpha_over(full, parse_hex(colour), circle)
            ring = np.abs(circle - 1.0)
            wall = Image.fromarray(np.clip(full, 0, 255).astype(np.uint8))
            draw = ImageDraw.Draw(wall)
            draw.ellipse([cx - 9, pill_y + 9, cx + 9, pill_y + 27], outline=(255, 255, 255, 90),
                         width=1)
            draw.text((cx, pill_y + 43), colour.lower(), font=font("mono", 10),
                      fill=(232, 232, 242), anchor="ma")

    # Footer.
    footer_rule_y = WALL_H - 34
    draw.line([(WALL_MARGIN, footer_rule_y), (WALL_W - WALL_MARGIN, footer_rule_y)],
              fill=(255, 255, 255, 14), width=1)
    draw_tracked(draw, (WALL_MARGIN, footer_rule_y + 19),
                 "GENERATED FROM src/10-model.js \u00b7 MF.MODEL.PALETTES",
                 font("medium", 10), INK_DIM, tracking=1.6)
    draw_tracked_right(draw, WALL_W - WALL_MARGIN, footer_rule_y + 19,
                       "2000 \u00d7 1000", font("medium", 10), INK_DIM, tracking=1.6)
    return wall


# --------------------------------------------------------------------------------------
# 9. Entry point
# --------------------------------------------------------------------------------------


def save_png(image: Image.Image, path: Path) -> int:
    image.save(path, format="PNG", optimize=True, compress_level=9)
    return path.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser(description="Render the MeshFlow Studio README showcase.")
    parser.add_argument("--only", choices=["sheet", "palettes"], default=None,
                        help="render a single asset instead of both")
    parser.add_argument("--out-dir", default=str(HERE), help="output directory")
    args = parser.parse_args()

    data = load_model_data()
    global ASPECTS
    ASPECTS = {aspect["id"]: aspect for aspect in data["aspects"]}

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.only in (None, "sheet"):
        sheet = compose_contact_sheet(data)
        path = out_dir / "presets-contact-sheet.png"
        size = save_png(sheet, path)
        print(f"wrote {path}  {sheet.width}x{sheet.height}  {size / 1024:.0f} KB")

    if args.only in (None, "palettes"):
        wall = compose_palette_wall(data)
        path = out_dir / "palette-wall.png"
        size = save_png(wall, path)
        print(f"wrote {path}  {wall.width}x{wall.height}  {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
