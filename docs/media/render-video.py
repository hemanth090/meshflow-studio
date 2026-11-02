#!/usr/bin/env python3
"""
MeshFlow Studio - deterministic promo intro renderer.

Renders the launch teaser for the MeshFlow Studio plugin (a DSH Web UI mesh-gradient
design studio) and the assets that go with it:

    intro.mp4         1920x1080, 30 fps, 12 s, H.264 / yuv420p / +faststart, silent
    poster.png        1920x1080 hero frame (PNG)
    intro-square.mp4  1080x1080, 30 fps, 12 s, same look

Everything is generated from the plugin's *real* preset data (`presets.json`, dumped from
`MF.model.PRESETS` by `dump-presets.mjs`) and the plugin's real rendering maths:

  * blobs are radial gradients at `point.x/y`, radius `point.size * max(width, height)`,
    drawn `opacity` at 0 % and transparent from 72 % (exactly `20-engine.js` drawBlobs);
  * the whole blob layer is blurred by `blur / 100 * min(w, h) * 0.09` (MF.model.blurPx);
  * grain is a seeded monochrome tile with `amount` and overlay-style blending
    (MF.engine drawGrain / MF.model.grainTileSize);
  * the vignette is the engine's radial `size` / `amount` ramp.

No network, no external assets, no stock fonts: typography uses the macOS system fonts
(SF variable font with weight axes, with Helvetica Neue / Arial fallbacks). The video is
silent by construction - no audio stream is ever written.

Usage:
    python3 render-video.py                     # intro.mp4 + poster.png + intro-square.mp4
    python3 render-video.py --stills 1.2,5.5,8.5 # just those frames as PNG (review)
    python3 render-video.py --only poster       # one deliverable
    python3 render-video.py --crf 21            # tune the x264 quality/size trade-off

Requirements: Python 3.10+, Pillow, numpy, and ffmpeg/ffprobe on PATH.
Deterministic: same inputs -> byte-identical frames (numpy PCG64 seeded tiles, no clock).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# --------------------------------------------------------------------------- constants

HERE = Path(__file__).resolve().parent
PLUGIN_ROOT = HERE.parent.parent
PRESETS_JSON = HERE / "presets.json"

#: ffmpeg/ffprobe are resolved from PATH (install via `brew install ffmpeg`, apt, etc.).
#: Override with MESHFLOW_FFMPEG / MESHFLOW_FFPROBE if they live somewhere unusual.
FFMPEG = os.environ.get("MESHFLOW_FFMPEG") or shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = os.environ.get("MESHFLOW_FFPROBE") or shutil.which("ffprobe") or "ffprobe"

FPS = 30
DURATION = 12.0

#: Single source of truth for the repository link shown on the end-card CTA.
#: (The Lead may correct this constant; everything else derives from it.)
REPO_URL = "github.com/hemanth090/meshflow-studio"

#: Brand palette - the four accent colours used by the plugin icon and its gradient mark.
BRAND = {
    "teal": "#5eead4",
    "violet": "#a78bfa",
    "rose": "#fb7185",
    "sky": "#38bdf8",
}
ACCENTS = [BRAND["teal"], BRAND["violet"], BRAND["rose"], BRAND["sky"]]
BASE_DARK = "#05060c"
BASE_NAVY = "#0b1020"

WORDMARK = "MeshFlow Studio"
TAGLINE = "Design mesh gradients, blur & glass. Then ship the CSS."
CAPTION = "Mesh gradients, perfected."
CARD_EYEBROW = "EVERYTHING YOU NEED"
CHIPS = [
    "Draggable mesh nodes",
    "Soft blur",
    "Film grain",
    "Glassmorphism",
    "PNG export",
    "Copy CSS",
]
CTA_TEXT = f"Open source · {REPO_URL}"

#: The teaser grades the presets so their artwork sits on the brand's deep-navy plate.
#: Positions, colours, opacities *relative to each other*, blur and grain amounts are the
#: preset's own data; the grade just re-levels exposure and scale for a dark 16:9 hero.
OPACITY_GRADE = {
    "aurora-veil": 0.85,
    "neon-tokyo": 0.90,
    "rose-quartz": 0.60,
    "glass-panel": 0.70,
}
SIZE_SCALE = 0.62
BLUR_SCALE = 0.80

#: Filmic grade applied to the mesh field so the artwork sits on the brand's deep navy:
#: a gamma lift for deep shadows, a slight exposure pull and a saturation boost. The hues
#: are still the preset's own colours - this only re-levels the plate for a dark hero.
GRADE_GAMMA = 1.35
GRADE_EXPOSURE = 0.90
GRADE_SATURATION = 1.25

SS = 2  # foreground supersample factor (typography / vector chrome)
BG_DIV = 2  # the smooth mesh gradient is rendered at 1/BG_DIV and upscaled

# --------------------------------------------------------------------------- timeline

T = {
    "fade_in": (0.00, 0.95),
    "bloom": (0.28, 2.45),
    "icon_in": (0.62, 1.66),
    "sparkle": (1.28, 1.78),
    "word_in": (1.16, 2.34),
    "hero_out": (2.62, 3.18),
    # scene B - morph through the three real presets
    "morph_ab": (2.95, 4.35),
    "morph_bc": (4.35, 5.75),
    "morph_cd": (6.40, 8.55),
    "caption_in": (4.82, 5.44),
    "caption_out": (7.12, 7.52),
    "lockup_in": (2.95, 3.55),
    "lockup_out": (9.10, 9.46),
    # scene C - glassmorphism card + chips
    "card_in": (6.38, 7.20),
    "sheen": (7.00, 8.15),
    "chips": (7.06, 0.11, 0.52),
    "card_out": (9.02, 9.42),
    # scene D - end card
    "darken": (9.15, 9.95),
    "end_icon": (9.42, 10.02),
    "end_word": (9.55, 10.30),
    "end_tag": (9.90, 10.62),
    "end_cta": (10.30, 11.00),
    "cta_sheen": (10.55, 11.35),
    "fade_out": (11.66, 12.00),
}

#: Poster is the densest, most "product" frame: card + every chip settled.
POSTER_TIME = 8.55

# --------------------------------------------------------------------------- maths


def clamp(value, lo=0.0, hi=1.0):
    return lo if value < lo else hi if value > hi else value


def lerp(a, b, t):
    return a + (b - a) * t


def seg(t, start, end):
    """Normalised 0..1 position of `t` inside [start, end] (clamped)."""
    if end <= start:
        return 1.0 if t >= end else 0.0
    return clamp((t - start) / (end - start))


def ease_in_out_cubic(t):
    """Cubic ease-in-out (the house easing for the whole piece)."""
    t = clamp(t)
    if t < 0.5:
        return 4.0 * t * t * t
    return 1.0 - (-2.0 * t + 2.0) ** 3 / 2.0


def ease_out(t):
    t = clamp(t)
    return 1.0 - (1.0 - t) ** 3



def ease_out_quint(t):
    t = clamp(t)
    return 1.0 - (1.0 - t) ** 5


def ease_in(t):
    t = clamp(t)
    return t * t * t


def ease_out_back(t, s=1.42):
    t = clamp(t)
    return 1.0 + (s + 1.0) * (t - 1.0) ** 3 + s * (t - 1.0) ** 2


# Common aliases so the timeline reads naturally.
ease_in_out = ease_in_out_cubic
ease_out_cubic = ease_out
ease_in_cubic = ease_in


def smoothstep(edge0, edge1, x):
    t = clamp((x - edge0) / (edge1 - edge0)) if edge1 != edge0 else (1.0 if x >= edge1 else 0.0)
    return t * t * (3.0 - 2.0 * t)


def envelope(t, t_in, t_out):
    """Ease in over `t_in`, hold, ease out over `t_out`."""
    in_a, in_b = t_in
    out_a, out_b = t_out
    return ease_in_out(seg(t, in_a, in_b)) * (1.0 - ease_in_out(seg(t, out_a, out_b)))


def bump(t, a, b):
    """0 -> 1 -> 0 over [a, b], eased."""
    x = seg(t, a, b)
    return math.sin(math.pi * x) ** 2 if 0.0 < x < 1.0 else 0.0


# --------------------------------------------------------------------------- colour


def hex_rgb(value):
    value = value.strip().lstrip("#")
    if len(value) == 3:
        value = "".join(c * 2 for c in value)
    if len(value) == 8:
        value = value[:6]
    return np.array([int(value[i : i + 2], 16) for i in (0, 2, 4)], dtype=np.float64)


def rgba(value, alpha=1.0):
    """-> (r, g, b, a) 0..255 tuple for PIL."""
    c = hex_rgb(value)
    return (int(round(c[0])), int(round(c[1])), int(round(c[2])), int(round(clamp(alpha) * 255)))


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1.0 / 2.4) - 0.055)


def lerp_colour(hex_a, hex_b, t):
    """Colour interpolation in linear light: no muddy mid-tones during the morph."""
    a = srgb_to_linear(hex_rgb(hex_a) / 255.0)
    b = srgb_to_linear(hex_rgb(hex_b) / 255.0)
    return rgb_to_hex(linear_to_srgb(lerp(a, b, clamp(t))))


def rgb_to_hex(rgb):
    r, g, b = (int(round(clamp(float(v)) * 255)) for v in rgb)
    return f"#{r:02x}{g:02x}{b:02x}"


def to_u8(array):
    return np.uint8(np.clip(array, 0.0, 1.0) * 255.0 + 0.5)


# --------------------------------------------------------------------------- presets


@dataclass
class Preset:
    id: str
    name: str
    base: str
    mix: str
    blur: float
    grain_amount: float
    grain_scale: float
    grain_enabled: bool
    vignette_amount: float
    vignette_enabled: bool
    points: list


def load_presets():
    if not PRESETS_JSON.exists():
        sys.exit(
            f"missing {PRESETS_JSON}\n"
            f"run: node {HERE / 'dump-presets.mjs'}"
        )
    with PRESETS_JSON.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    presets = {}
    for entry in payload["presets"]:
        state = entry["state"]
        grain = state.get("grain") or {}
        vignette = state.get("vignette") or {}
        presets[entry["id"]] = Preset(
            id=entry["id"],
            name=entry.get("name") or state.get("name") or entry["id"],
            base=state["base"],
            mix=state["mix"],
            blur=float(state["blur"]),
            grain_amount=float(grain.get("amount", 0)),
            grain_scale=float(grain.get("scale", 34)),
            grain_enabled=bool(grain.get("enabled")),
            vignette_amount=float(vignette.get("amount", 24)),
            vignette_enabled=bool(vignette.get("enabled")),
            points=[dict(p) for p in state["points"]],
        )
    return presets


#: Blend weights for a preset's `mix` mode, so cross-morphing between presets can
#: interpolate the compositing smoothly instead of cutting between modes.
MIX_WEIGHTS = {
    "normal": {"normal": 1.0, "screen": 0.0, "add": 0.0},
    "screen": {"normal": 0.0, "screen": 1.0, "add": 0.0},
    "overlay": {"normal": 0.55, "screen": 0.45, "add": 0.0},
    "soft-light": {"normal": 0.6, "screen": 0.4, "add": 0.0},
    "lighter": {"normal": 0.0, "screen": 0.0, "add": 1.0},
}


def blend_weights(mix):
    return dict(MIX_WEIGHTS.get(mix, MIX_WEIGHTS["normal"]))


def video_state(preset):
    """Preset geometry/colour, re-based onto the brand navy so the artwork reads on dark.

    The video is a dark launch teaser: every preset keeps its real blob positions, radii,
    opacities, colours and blur, but the plate is the brand navy and any very light base
    preset is composited in screen mode (documented in docs/media/README.md).
    """
    mix = preset.mix
    # rose-quartz ships a light `fbf1f4` plate with `normal` mixing; on the brand navy we
    # keep its pastel glow by compositing in screen mode instead.
    if mix == "normal":
        mix = "screen"
    grade = OPACITY_GRADE.get(preset.id, 0.72)
    points = []
    for point in preset.points:
        graded = dict(point)
        graded["opacity"] = float(point["opacity"]) * grade
        graded["size"] = float(point["size"]) * SIZE_SCALE
        points.append(graded)
    return {
        "points": points,
        "blend": blend_weights(mix),
        "blur": preset.blur * BLUR_SCALE,
        "grain": (preset.grain_amount / 100.0) if preset.grain_enabled else 0.0,
        "grain_scale": preset.grain_scale,
        "vignette": (preset.vignette_amount / 100.0) if preset.vignette_enabled else 0.0,
    }


def morph(a, b, t):
    """Interpolate two video states: point positions, sizes, opacities and colours."""
    t = clamp(t)
    pa, pb = a["points"], b["points"]
    n = max(len(pa), len(pb))
    points = []
    for i in range(n):
        if i < len(pa) and i < len(pb):
            p, q = pa[i], pb[i]
            points.append(
                {
                    "x": lerp(p["x"], q["x"], t),
                    "y": lerp(p["y"], q["y"], t),
                    "size": lerp(p["size"], q["size"], t),
                    "opacity": lerp(p["opacity"], q["opacity"], t),
                    "color": lerp_colour(p["color"], q["color"], t),
                }
            )
        elif i < len(pa):  # extra point fades out where it is
            p = dict(pa[i])
            p["opacity"] = p["opacity"] * (1.0 - t)
            points.append(p)
        else:  # new point fades in at its destination
            q = dict(pb[i])
            q["opacity"] = q["opacity"] * t
            points.append(q)
    blend = {k: lerp(a["blend"][k], b["blend"][k], t) for k in ("normal", "screen", "add")}
    return {
        "points": points,
        "blend": blend,
        "blur": lerp(a["blur"], b["blur"], t),
        "grain": lerp(a["grain"], b["grain"], t),
        "grain_scale": lerp(a["grain_scale"], b["grain_scale"], t),
        "vignette": lerp(a["vignette"], b["vignette"], t),
    }


# --------------------------------------------------------------------------- fonts

FONT_STACKS = {
    # SF (the macOS system face) has a variable weight axis and is the brand face.
    "display": [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
    "text": [
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
}

_TTC_WEIGHT_ORDER = {"Regular": 0, "Medium": 1, "Semibold": 2, "Bold": 3}
_FONT_WARNED = set()


def _variation_bytes(font):
    try:
        return [n if isinstance(n, bytes) else str(n).encode() for n in font.get_variation_names()]
    except Exception:
        return []


def _apply_weight(font, weight):
    names = _variation_bytes(font)
    if not names:
        return font
    want = weight.encode()
    if want in names:
        font.set_variation_by_name(want)
        return font
    # Some system fonts only expose "Regular"/"Bold" style instances.
    for candidate in (b"Semibold", b"Bold", b"Medium", b"Regular"):
        if candidate in names:
            font.set_variation_by_name(candidate)
            return font
    return font


def _ttc_face(path, weight, size):
    """Pick the TTC face whose style name matches `weight` as closely as possible."""
    rank = _TTC_WEIGHT_ORDER.get(weight, 1)
    best = None
    for index in range(0, 10):
        try:
            font = ImageFont.truetype(path, size, index=index)
        except Exception:
            break
        try:
            style = (font.getname() or ("", ""))[1] or ""
        except Exception:
            style = ""
        score = 9
        for name, value in _TTC_WEIGHT_ORDER.items():
            if name.lower() in style.lower():
                score = abs(value - rank)
                break
        if score == 0:
            return font
        if best is None or score < best[0]:
            best = (score, font)
    if best is not None:
        return best[1]
    raise RuntimeError(f"no usable face in {path}")


@lru_cache(maxsize=None)
def get_font(role, weight, size):
    """Load a system font at `size` px; fall back gracefully through the stack."""
    size = int(round(size))
    for path in FONT_STACKS[role]:
        if not os.path.exists(path):
            continue
        try:
            if path.lower().endswith(".ttc"):
                font = _ttc_face(path, weight, size)
            else:
                font = ImageFont.truetype(path, size)
                font = _apply_weight(font, weight)
            return font
        except Exception:
            continue
    key = ("missing", role)
    if key not in _FONT_WARNED:
        _FONT_WARNED.add(key)
        print(
            f"warning: no system font found for role '{role}'; using Pillow's bitmap default",
            file=sys.stderr,
        )
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def glyph_layout(text, font, tracking):
    """Per-glyph x offsets + total advance, kerning-aware (pair advances from getlength)."""
    n = len(text)
    advances = []
    for i in range(n):
        if i == n - 1:
            adv = font.getlength(text[i])
        else:
            adv = font.getlength(text[i:]) - font.getlength(text[i + 1 :])
        advances.append(adv)
    offsets = []
    x = 0.0
    for i in range(n):
        offsets.append(x)
        x += advances[i] + tracking
    total = (offsets[-1] + advances[-1]) if n else 0.0
    return offsets, total


def text_width_tracked(text, font, tracking):
    return glyph_layout(text, font, tracking)[1]


def wrap_balanced(text, font, max_width, tracking=0.0):
    """Greedy wrap, then narrow the measure again so the lines end up visually even."""
    lines = wrap_text(text, font, max_width, tracking)
    if len(lines) <= 1:
        return lines
    target = len(lines)
    lo, hi = max_width * 0.25, max_width
    for _ in range(18):
        mid = (lo + hi) / 2.0
        candidate = wrap_text(text, font, mid, tracking)
        if len(candidate) <= target:
            hi = mid
        else:
            lo = mid
    balanced = wrap_text(text, font, hi, tracking)
    return balanced if len(balanced) == target else lines


def wrap_text(text, font, max_width, tracking=0.0):
    words = text.split(" ")
    lines, current = [], ""
    for word in words:
        candidate = word if not current else current + " " + word
        if text_width_tracked(candidate, font, tracking) <= max_width or not current:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


# --------------------------------------------------------------------------- canvas


class Overlay:
    """RGBA drawing surface at SS times the output resolution."""

    def __init__(self, width, height, ss=SS):
        self.width = width
        self.height = height
        self.ss = ss
        self.img = Image.new("RGBA", (width * ss, height * ss), (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.img)

    # -- primitives ------------------------------------------------------
    def rounded_rect(self, box, radius, fill=None, outline=None, width=1):
        x0, y0, x1, y1 = box
        self.draw.rounded_rectangle(
            [x0 * self.ss, y0 * self.ss, x1 * self.ss, y1 * self.ss],
            radius=max(0.0, radius * self.ss),
            fill=fill,
            outline=outline,
            width=max(1, int(round(width * self.ss))),
        )

    def pill(self, x, y, w, h, fill=None, outline=None, width=1):
        self.rounded_rect((x, y, x + w, y + h), min(h / 2.0, w / 2.0), fill, outline, width)

    def circle(self, cx, cy, r, fill=None, outline=None, width=1):
        self.draw.ellipse(
            [(cx - r) * self.ss, (cy - r) * self.ss, (cx + r) * self.ss, (cy + r) * self.ss],
            fill=fill,
            outline=outline,
            width=max(1, int(round(width * self.ss))),
        )

    def polygon(self, points, fill=None):
        self.draw.polygon([(x * self.ss, y * self.ss) for x, y in points], fill=fill)

    def line(self, points, fill, width=1):
        self.draw.line(
            [(x * self.ss, y * self.ss) for x, y in points],
            fill=fill,
            width=max(1, int(round(width * self.ss))),
        )

    def paste(self, image, x, y):
        """Alpha-composite an RGBA layer whose pixel grid is already SS-scaled."""
        self.img.alpha_composite(image, dest=(int(round(x * self.ss)), int(round(y * self.ss))))

    def text(
        self,
        x,
        baseline,
        text,
        font,
        fill,
        tracking=0.0,
        align="left",
        letter_dy=None,
        letter_alpha=None,
    ):
        """Draw a single line with per-glyph kerning and optional per-letter animation."""
        if not text:
            return 0.0
        offsets, total = glyph_layout(text, font, tracking * self.ss)
        start = x * self.ss
        if align == "center":
            start -= total / 2.0
        elif align == "right":
            start -= total
        for i, ch in enumerate(text):
            if ch == " ":
                continue
            alpha = 1.0 if letter_alpha is None else clamp(letter_alpha[i])
            if alpha <= 0.003:
                continue
            dy = 0.0 if letter_dy is None else letter_dy[i]
            colour = (fill[0], fill[1], fill[2], int(fill[3] * alpha))
            self.draw.text(
                (start + offsets[i], (baseline + dy) * self.ss),
                ch,
                font=font,
                fill=colour,
                anchor="ls",
            )
        return total / self.ss


def rounded_mask(w, h, radius, ss=SS):
    """Anti-aliased rounded-rectangle mask (float 0..1) at output resolution."""
    w_i, h_i = max(1, int(round(w))), max(1, int(round(h)))
    mask = Image.new("L", (w_i * ss, h_i * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, w_i * ss - 1, h_i * ss - 1],
        radius=max(0.0, radius * ss),
        fill=255,
    )
    return np.asarray(mask.resize((w_i, h_i), Image.LANCZOS), dtype=np.float32) / 255.0


def vertical_gradient(width, height, color, alpha_top, alpha_bottom):
    """RGBA strip with a vertical alpha ramp (used for card highlights)."""
    h = max(1, int(round(height)))
    w = max(1, int(round(width)))
    ramp = np.linspace(alpha_top, alpha_bottom, h, dtype=np.float32)[:, None]
    rgb = hex_rgb(color) / 255.0
    arr = np.empty((h, w, 4), dtype=np.float32)
    arr[..., 0] = rgb[0]
    arr[..., 1] = rgb[1]
    arr[..., 2] = rgb[2]
    arr[..., 3] = np.repeat(ramp, w, axis=1)
    return Image.fromarray(to_u8(arr), "RGBA")


def diagonal_sheen(width, height, angle_deg, position, width_frac, peak):
    """Soft diagonal light band across a rect; `position` 0..1 sweeps it across."""
    w, h = max(1, int(round(width))), max(1, int(round(height)))
    angle = math.radians(angle_deg)
    ux, uy = math.cos(angle), math.sin(angle)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    proj = (xx / w) * ux + (yy / h) * uy
    lo, hi = float(proj.min()), float(proj.max())
    proj = (proj - lo) / max(1e-6, hi - lo)
    reach = max(0.02, width_frac)
    # Sweep centre travels from slightly before the rect to slightly after it.
    centre = lerp(-reach, 1.0 + reach, clamp(position))
    band = np.exp(-0.5 * ((proj - centre) / reach) ** 2).astype(np.float32)
    arr = np.empty((h, w, 4), dtype=np.float32)
    arr[..., :3] = 1.0
    arr[..., 3] = np.clip(band * peak, 0.0, 1.0)
    return Image.fromarray(to_u8(arr), "RGBA")


# --------------------------------------------------------------------------- mesh renderer


class MeshRenderer:
    """The plugin's blob pipeline (base -> blobs -> blur -> light bloom) at low res."""

    def __init__(self, out_w, out_h, div=BG_DIV):
        self.out_w = out_w
        self.out_h = out_h
        self.w = max(2, int(round(out_w / div)))
        self.h = max(2, int(round(out_h / div)))
        yy, xx = np.mgrid[0 : self.h, 0 : self.w].astype(np.float32)
        self.xx = xx
        self.yy = yy
        # Vignette mask at output resolution (engine geometry).
        oy, ox = np.mgrid[0:out_h, 0:out_w].astype(np.float32)
        cx, cy = out_w / 2.0, out_h / 2.0
        dist = np.sqrt((ox - cx) ** 2 + (oy - cy) ** 2) / (max(out_w, out_h) * 0.78)
        self.vignette_mask = np.clip(dist, 0.0, 1.5).astype(np.float32)

    # -- one layer -------------------------------------------------------
    def render(self, points, base_hex, blend, blur_state, zoom, camera, light, bloom):
        w, h = self.w, self.h
        max_side = max(w, h)
        base = hex_rgb(base_hex) / 255.0
        out = np.empty((h, w, 3), dtype=np.float32)
        out[...] = base

        w_add = float(blend["add"])
        w_scr = float(blend["screen"])
        w_nrm = float(blend["normal"])
        norm = max(1e-6, w_add + w_scr + w_nrm)
        w_add, w_scr, w_nrm = w_add / norm, w_scr / norm, w_nrm / norm

        for index, point in enumerate(points):
            opacity = float(point["opacity"]) * bloom
            if opacity <= 0.002 or point["size"] <= 0.0:
                continue
            depth = 0.35 + 0.65 * (((index * 0.61803398875) % 1.0))
            px = 0.5 + (float(point["x"]) - 0.5) * zoom + camera[0] * depth
            py = 0.5 + (float(point["y"]) - 0.5) * zoom + camera[1] * depth
            radius = max(1.0, float(point["size"]) * max_side * lerp(1.0, 1.02, zoom - 1.0))
            cx = px * w
            cy = py * h

            x0 = max(0, int(math.floor(cx - radius)))
            x1 = min(w, int(math.ceil(cx + radius)) + 1)
            y0 = max(0, int(math.floor(cy - radius)))
            y1 = min(h, int(math.ceil(cy + radius)) + 1)
            if x1 <= x0 or y1 <= y0:
                continue
            dx = self.xx[y0:y1, x0:x1] + 0.5 - cx
            dy = self.yy[y0:y1, x0:x1] + 0.5 - cy
            u = np.sqrt(dx * dx + dy * dy) / radius
            # engine gradient stops: alpha at 0 -> 0 at 0.72 -> 0 at 1.0
            alpha = opacity * np.clip(1.0 - u / 0.72, 0.0, 1.0)
            alpha[u >= 1.0] = 0.0
            if not np.any(alpha > 0.001):
                continue
            src = hex_rgb(point["color"]) / 255.0
            region = out[y0:y1, x0:x1]
            if w_nrm > 0.0:
                a = (alpha * w_nrm)[..., None]
                out[y0:y1, x0:x1] = region + (src - region) * a
            region = out[y0:y1, x0:x1]
            if w_scr > 0.0:
                screen = 1.0 - (1.0 - region) * (1.0 - src)
                a = (alpha * w_scr)[..., None]
                out[y0:y1, x0:x1] = region + (screen - region) * a
            region = out[y0:y1, x0:x1]
            if w_add > 0.0:
                out[y0:y1, x0:x1] = region + src * (alpha * w_add)[..., None]

        np.clip(out, 0.0, 1.0, out=out)
        out = self._grade(out)

        # MF.model.blurPx: blur/100 * min(w, h) * 0.09 - expressed in the low-res grid.
        blur_px = (blur_state / 100.0) * min(self.out_w, self.out_h) * 0.09 * (w / self.out_w)
        if blur_px > 0.35:
            image = Image.fromarray(to_u8(out), "RGB").filter(ImageFilter.GaussianBlur(blur_px))
            out = np.asarray(image, dtype=np.float32) / 255.0

        if light is not None:
            out = self._add_light(out, light)

        # Upscale the smooth field to output resolution.
        up = Image.fromarray(to_u8(out), "RGB").resize(
            (self.out_w, self.out_h), Image.LANCZOS
        )
        return np.asarray(up, dtype=np.float32) / 255.0

    @staticmethod
    def _grade(field):
        """Deep-navy plate: gamma, exposure and saturation grade (deterministic)."""
        field = np.power(np.clip(field, 0.0, 1.0), GRADE_GAMMA) * GRADE_EXPOSURE
        luma = (field * np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).sum(
            axis=2, keepdims=True
        )
        field = luma + (field - luma) * GRADE_SATURATION
        return np.clip(field, 0.0, 1.0)

    # -- additive bloom --------------------------------------------------
    def _add_light(self, out, light):
        h, w = out.shape[:2]
        cx = light["x"] * w
        cy = light["y"] * h
        radius = max(8.0, light["radius"] * max(w, h))
        x0 = max(0, int(cx - radius * 3))
        x1 = min(w, int(cx + radius * 3) + 1)
        y0 = max(0, int(cy - radius * 3))
        y1 = min(h, int(cy + radius * 3) + 1)
        if x1 <= x0 or y1 <= y0:
            return out
        dx = self.xx[y0:y1, x0:x1] + 0.5 - cx
        dy = self.yy[y0:y1, x0:x1] + 0.5 - cy
        falloff = np.exp(-((dx * dx + dy * dy) / (2.0 * radius * radius)) * 1.35).astype(np.float32)
        colour = hex_rgb(light["color"]) / 255.0
        out[y0:y1, x0:x1] += colour * (falloff * float(light["intensity"]))[..., None]
        np.clip(out, 0.0, 1.0, out=out)
        return out

    def vignette(self, frame, amount, size=0.60):
        if amount <= 0.001:
            return frame
        inner = clamp(size * 0.62, 0.0, 0.95)
        ramp = np.clip((self.vignette_mask - inner) / max(1e-6, 1.0 - inner), 0.0, 1.0)
        factor = 1.0 - amount * 0.92 * (ramp ** 1.35)
        return frame * factor[..., None]


# --------------------------------------------------------------------------- icon mark

#: The plugin's icon mark (icon.svg): four aurora blobs inside a rounded square + sparkles.
ICON_BLOBS = [
    # (cx, cy, r, colour, opacity) in the SVG's 128x128 user space
    (34.0, 38.0, 38.0, "#5eead4", 0.92),
    (88.0, 30.0, 34.0, "#a78bfa", 0.92),
    (74.0, 92.0, 42.0, "#fb7185", 0.82),
    (26.0, 98.0, 28.0, "#38bdf8", 0.72),
]
ICON_SPARKLES = [
    # (cx, cy, outer radius, inner radius, alpha)
    (93.0, 48.0, 10.0, 2.9, 0.90),
    (41.0, 36.5, 6.5, 1.9, 0.72),
]


def star_points(cx, cy, r_outer, r_inner, rotation=0.0):
    points = []
    for i in range(8):
        angle = rotation + math.pi / 4.0 * i - math.pi / 2.0
        radius = r_outer if i % 2 == 0 else r_inner
        points.append((cx + math.cos(angle) * radius, cy + math.sin(angle) * radius))
    return points


def render_icon(
    size,
    spread=1.0,
    blur=1.0,
    sparkle=1.0,
    border_alpha=0.16,
    alpha=1.0,
    internal=3,
):
    """The MeshFlow mark as an RGBA image at `size` px (SS-ready pixel size).

    `spread` < 1 pulls the blobs toward the centre (the mark "draws itself" open),
    `blur` scales the icon's Gaussian falloff, `sparkle` scales the star bursts.
    """
    px = max(8, int(round(size)))
    scale = px * internal / 128.0
    canvas = px * internal
    layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    for cx, cy, r, colour, opacity in ICON_BLOBS:
        bx = 64.0 + (cx - 64.0) * spread
        by = 64.0 + (cy - 64.0) * spread
        br = r * spread
        draw.ellipse(
            [(bx - br) * scale, (by - br) * scale, (bx + br) * scale, (by + br) * scale],
            fill=rgba(colour, opacity * alpha),
        )

    sigma = max(0.01, 10.0 * blur * scale)
    layer = layer.filter(ImageFilter.GaussianBlur(sigma))

    # Rounded-square mask (128-space radius 30, as in icon.svg).
    mask = Image.new("L", (canvas, canvas), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, canvas - 1, canvas - 1], radius=30.0 * scale, fill=255
    )
    a = layer.getchannel("A")
    from PIL import ImageChops  # local import keeps the module header tidy

    layer.putalpha(ImageChops.multiply(a, mask))

    # Sparkles are drawn sharp on top (they are crisp vector shapes in the icon).
    if sparkle > 0.01:
        sparkle_layer = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(sparkle_layer)
        for cx, cy, r_out, r_in, a0 in ICON_SPARKLES:
            pts = star_points(cx * scale, cy * scale, r_out * scale * sparkle, r_in * scale * sparkle)
            sdraw.polygon(pts, fill=(255, 255, 255, int(255 * a0 * alpha)))
        layer = Image.alpha_composite(layer, sparkle_layer)

    # Hairline border (white 16 % in the SVG).
    if border_alpha > 0.001:
        border = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        ImageDraw.Draw(border).rounded_rectangle(
            [1 * scale, 1 * scale, canvas - 1 * scale, canvas - 1 * scale],
            radius=29.0 * scale,
            outline=(255, 255, 255, int(255 * border_alpha * alpha)),
            width=max(1, int(round(2.0 * scale))),
        )
        layer = Image.alpha_composite(layer, border)

    return layer.resize((px, px), Image.LANCZOS)


def radial_glow(size, colour, intensity, falloff=2.2):
    """Soft circular halo, RGBA, used behind the icon mark."""
    size = max(4, int(size))
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    cx = cy = (size - 1) / 2.0
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (size / 2.0)
    a = np.clip(1.0 - d, 0.0, 1.0) ** falloff * clamp(intensity) * 255.0
    rgb = hex_rgb(colour)
    arr = np.empty((size, size, 4), dtype=np.float32)
    arr[..., 0] = rgb[0] / 255.0
    arr[..., 1] = rgb[1] / 255.0
    arr[..., 2] = rgb[2] / 255.0
    arr[..., 3] = a / 255.0
    return Image.fromarray(to_u8(arr), "RGBA")


# --------------------------------------------------------------------------- scene model


@dataclass
class Scene:
    mesh: dict
    zoom: float
    camera: tuple
    light: dict | None
    bloom: float
    fade: float
    darken: float
    hero: dict = field(default_factory=dict)
    lockup: float = 0.0
    caption: dict | None = None
    card: dict | None = None
    endcard: dict | None = None


class Composition:
    """The whole 12 s timeline, sampled as a `Scene` at time t."""

    def __init__(self, width, height, presets):
        self.width = width
        self.height = height
        self.presets = presets
        self.mesh_renderer = MeshRenderer(width, height)
        self.states = {
            "aurora-veil": video_state(presets["aurora-veil"]),
            "neon-tokyo": video_state(presets["neon-tokyo"]),
            "rose-quartz": video_state(presets["rose-quartz"]),
            "plum-noir": video_state(presets["plum-noir"]),
        }
        self.unit = min(width, height) / 1080.0  # typography scale (1.0 for both outputs)
        self.margin = max(48.0, round(width * 0.05))

    # -- preset morph ----------------------------------------------------
    def _mesh_at(self, t):
        a = self.states["aurora-veil"]
        b = self.states["neon-tokyo"]
        c = self.states["rose-quartz"]
        d = self.states["plum-noir"]
        if t < T["morph_ab"][0]:
            return a
        if t < T["morph_ab"][1]:
            return morph(a, b, ease_in_out(seg(t, *T["morph_ab"])))
        if t < T["morph_bc"][0]:
            return b
        if t < T["morph_bc"][1]:
            return morph(b, c, ease_in_out(seg(t, *T["morph_bc"])))
        if t < T["morph_cd"][0]:
            return c
        if t < T["morph_cd"][1]:
            return morph(c, d, ease_in_out(seg(t, *T["morph_cd"])))
        return d

    # -- sampling --------------------------------------------------------
    def sample(self, t):
        mesh = self._mesh_at(t)
        mesh = dict(mesh)
        mesh["points"] = [dict(p) for p in mesh["points"]]

        # "Blooms from the centre": the blob field opens out of a small central knot.
        take = ease_out_quint(seg(t, *T["bloom"]))
        bloom = clamp(0.0 + take)
        if t < T["bloom"][1]:
            sx, sy = 0.02, 0.02
            knot = ease_in_out(seg(t, *T["bloom"]))
            for point in mesh["points"]:
                point["x"] = lerp(0.5 + (point["x"] - 0.5) * sx, point["x"], knot)
                point["y"] = lerp(0.5 + (point["y"] - 0.5) * sy, point["y"], knot)
                point["size"] = lerp(point["size"] * 0.12, point["size"], knot)
            mesh["blur"] = mesh["blur"] * lerp(0.45, 1.0, knot)
        for index, point in enumerate(mesh["points"]):
            # A barely-there drift keeps the gradient "live" behind the frosted card.
            wobble = 0.010 * self.unit
            point["x"] += wobble * math.sin(t * 0.62 + index * 1.31)
            point["y"] += wobble * math.cos(t * 0.51 + index * 0.83)

        # Slow camera push + parallax drift, easing across the scenes.
        zoom = 1.0 + 0.050 * smoothstep(2.8, 6.4, t) + 0.050 * smoothstep(6.4, 9.6, t)
        zoom += 0.020 * smoothstep(9.6, 12.0, t)
        camera = (
            0.012 * math.sin(0.55 * t + 0.4),
            0.009 * math.cos(0.43 * t - 0.7),
        )

        # Moving light bloom (a soft key light travelling over the artwork).
        light = None
        if 0.05 < t < 12.0:
            lx = 0.5 + 0.24 * math.sin(0.52 * t - 0.6)
            ly = 0.46 + 0.17 * math.cos(0.41 * t + 0.3)
            intensity = 0.045 + 0.022 * math.sin(0.8 * t)
            intensity *= 1.0 - 0.55 * smoothstep(9.6, 10.6, t)
            intensity += 0.075 * bump(t, 0.15, 1.85)  # the opening bloom
            light = {
                "x": lx,
                "y": ly,
                "radius": 0.30 + 0.04 * math.sin(0.7 * t),
                "intensity": max(0.0, intensity),
                "color": BRAND["sky"] if t < 6.4 else BRAND["violet"],
            }

        fade = ease_in_out(seg(t, *T["fade_in"])) * (1.0 - ease_in_out(seg(t, *T["fade_out"])))
        darken = 0.76 * ease_in_out(seg(t, *T["darken"]))

        scene = Scene(
            mesh=mesh,
            zoom=zoom,
            camera=camera,
            light=light,
            bloom=1.0,
            fade=fade,
            darken=darken,
        )

        # ---- scene A: hero lockup --------------------------------------
        scene.hero = self._hero(t)
        scene.lockup = envelope(t, T["lockup_in"], T["lockup_out"])

        # ---- scene B: caption chip -------------------------------------
        cap_alpha = envelope(t, T["caption_in"], T["caption_out"])
        if cap_alpha > 0.001:
            slide = ease_out_cubic(seg(t, *T["caption_in"]))
            scene.caption = {
                "alpha": cap_alpha,
                "dy": lerp(20.0 * self.unit, 0.0, slide),
            }

        # ---- scene C: glass card + chips -------------------------------
        card_alpha = envelope(t, T["card_in"], T["card_out"])
        if card_alpha > 0.001:
            rise = ease_out_cubic(seg(t, *T["card_in"]))
            out = ease_in_out(seg(t, *T["card_out"]))
            chips = []
            start, stagger, dur = T["chips"]
            for index in range(len(CHIPS)):
                chip_in = ease_out_cubic(seg(t, start + index * stagger, start + index * stagger + dur))
                chip_out = 1.0 - ease_in_out(seg(t, T["card_out"][0], T["card_out"][0] + 0.16 + index * 0.02))
                chips.append({"alpha": chip_in * chip_out, "dy": lerp(18.0 * self.unit, 0.0, chip_in)})
            scene.card = {
                "alpha": card_alpha,
                "dy": lerp(74.0 * self.unit, 0.0, rise) - 18.0 * self.unit * out,
                "scale": lerp(0.968, 1.0, rise),
                "header_alpha": ease_in_out(seg(t, T["card_in"][0] + 0.25, T["card_in"][1] + 0.30)),
                "sheen": seg(t, *T["sheen"]),
                "sheen_alpha": bump(t, *T["sheen"]),
                "chips": chips,
            }

        # ---- scene D: end card -----------------------------------------
        end = {}
        icon_in = ease_out_cubic(seg(t, *T["end_icon"]))
        if icon_in > 0.001:
            end["icon_alpha"] = ease_in_out(seg(t, *T["end_icon"]))
            end["icon_scale"] = lerp(0.72, 1.0, icon_in)
        word_in = ease_out_cubic(seg(t, *T["end_word"]))
        if word_in > 0.001:
            end["word_alpha"] = clamp(word_in * 1.35)
            end["word_rise"] = lerp(18.0 * self.unit, 0.0, word_in)
            end["word_tracking"] = lerp(0.10, 0.0, word_in)
        tag_in = ease_out_cubic(seg(t, *T["end_tag"]))
        if tag_in > 0.001:
            end["tag_alpha"] = clamp(tag_in * 1.6)
            end["tag_rise"] = lerp(14.0 * self.unit, 0.0, tag_in)
        cta_in = ease_out_cubic(seg(t, *T["end_cta"]))
        if cta_in > 0.001:
            end["cta_alpha"] = clamp(cta_in * 1.8)
            end["cta_scale"] = lerp(0.955, 1.0, cta_in)
            end["cta_sheen"] = seg(t, *T["cta_sheen"])
            end["cta_sheen_alpha"] = bump(t, *T["cta_sheen"])
        if end:
            scene.endcard = end

        return scene

    # -- hero lockup -----------------------------------------------------
    def _hero(self, t):
        if t >= T["hero_out"][1]:
            return {}
        alpha = envelope(t, T["icon_in"], T["hero_out"])
        if alpha <= 0.001:
            return {}
        unit = self.unit
        in_icon = ease_out_cubic(seg(t, *T["icon_in"]))
        icon_alpha = ease_in_out(seg(t, T["icon_in"][0], T["icon_in"][0] + 0.55)) * (
            1.0 - ease_in_out(seg(t, *T["hero_out"]))
        )
        sparkle = ease_out_back(seg(t, *T["sparkle"]), 1.9)
        word_in = ease_out_cubic(seg(t, *T["word_in"]))
        word_alpha = ease_in_out(seg(t, T["word_in"][0], T["word_in"][0] + 0.62)) * (
            1.0 - ease_in_out(seg(t, *T["hero_out"]))
        )
        # The lockup sinks slightly and loses scale as the gradient takes over.
        exit = ease_in_out(seg(t, *T["hero_out"]))
        letters = len(WORDMARK)
        letter_alpha, letter_dy = [], []
        for i in range(letters):
            n = i / max(1, letters - 1)
            phase = seg(t, T["word_in"][0] + 0.30 * n, T["word_in"][0] + 0.30 * n + 0.55)
            letter_alpha.append(ease_in_out(phase) * (1.0 - exit))
            letter_dy.append(lerp(16.0 * unit, 0.0, ease_out_cubic(phase)) * (1.0 - exit))
        return {
            "alpha": 1.0 - exit,
            "icon_alpha": icon_alpha,
            "icon_scale": lerp(0.66, 1.0, ease_out_cubic(in_icon)) * lerp(1.0, 0.94, exit),
            "icon_spread": lerp(0.42, 1.0, ease_out_cubic(in_icon)),
            "icon_blur": lerp(2.6, 1.0, ease_out_cubic(clamp(in_icon * 1.15))),
            "sparkle": clamp(sparkle) * clamp(seg(t, T["icon_in"][0] + 0.35, T["sparkle"][1])),
            "glow": 0.26 * ease_out_cubic(in_icon) * (1.0 - 0.5 * exit),
            "word_alpha": word_alpha,
            "word_letter_alpha": letter_alpha,
            "word_letter_dy": letter_dy,
            "word_tracking": lerp(0.155, 0.004, ease_out_cubic(clamp(word_in * 1.0))),
            "word_rise": lerp(10.0 * unit, 0.0, word_in) * (1.0 - exit),
            "exit": exit,
        }

    # -- frame -----------------------------------------------------------
    def render(self, t):
        W, H = self.width, self.height
        unit = self.unit
        scene = self.sample(t)

        # 1) live mesh gradient plate + light bloom
        frame = self.mesh_renderer.render(
            scene.mesh["points"],
            BASE_NAVY,
            scene.mesh["blend"],
            scene.mesh["blur"],
            scene.zoom,
            scene.camera,
            scene.light,
            scene.bloom,
        )

        # 2) end-card darkening (blend toward the deep navy/black plate)
        if scene.darken > 0.001:
            target = hex_rgb("#070a14") / 255.0
            mix_amount = scene.darken * 0.70
            frame = frame * (1.0 - mix_amount) + target * mix_amount

        # 3) vignette (engine geometry, always on for the filmic look)
        vignette = clamp(0.42 + scene.mesh["vignette"] * 0.30)
        vignette *= 1.0 - 0.40 * smoothstep(9.25, 10.15, t)
        frame = self.mesh_renderer.vignette(frame, vignette, size=0.62)

        # 4) foreground chrome at SS resolution
        overlay = Overlay(W, H, SS)
        if scene.caption:
            self._draw_caption(overlay, scene.caption)
        if scene.lockup > 0.001 and not scene.hero:
            self._draw_lockup(overlay, scene.lockup)
        if scene.card:
            frame = self._composite_card(frame, scene.card)
            self._draw_card_chrome(overlay, scene.card)
        if scene.hero:
            self._draw_hero(overlay, scene.hero)
        if scene.endcard:
            self._draw_endcard(overlay, scene.endcard)

        fg = np.asarray(overlay.img.resize((W, H), Image.LANCZOS), dtype=np.float32) / 255.0
        alpha = fg[..., 3:4]
        frame = frame * (1.0 - alpha) + fg[..., :3] * alpha

        # 5) seeded monochrome film grain (MF.engine's tile + amount/blend maths)
        grain = (0.018 + scene.mesh["grain"] * 0.12) * 0.55
        if grain > 0.002:
            frame = self._add_grain(frame, grain, scene.mesh["grain_scale"], t)

        # 6) fades
        if scene.fade < 0.999:
            frame *= scene.fade
        return to_u8(frame)

    # -- grain -----------------------------------------------------------
    def _add_grain(self, frame, amount, grain_scale, t):
        h, w = frame.shape[:2]
        # MF.model.grainTileSize: lerp(256, 48, (scale-1)/99), scaled to the output size.
        t = clamp((grain_scale - 1.0) / 99.0)
        tile = int(round(lerp(256.0, 48.0, t) * (min(self.width, self.height) / 900.0)))
        tile = max(24, min(256, tile))
        # A fresh seeded tile per frame: seeded film grain, not a static printed pattern.
        seed = (0x5EED0000 + int(round(t * 1000)) * 7919) & 0xFFFFFFFF
        rng = np.random.default_rng(seed)
        # One noise sample per pixel: fine film grain (also dithers the dark gradients so
        # the 8-bit H.264 deliverable does not band). Amplitude is kept low so the grain
        # survives the bitrate cap instead of being quantised into blocky mush.
        noise = rng.random((tile, tile), dtype=np.float32) * 2.0 - 1.0
        reps_y = int(math.ceil(h / tile))
        reps_x = int(math.ceil(w / tile))
        field = np.tile(noise, (reps_y, reps_x))[:h, :w]
        return frame + field[..., None] * amount

    # -- caption chip ----------------------------------------------------
    def _draw_caption(self, overlay, caption):
        u = self.unit
        alpha = caption["alpha"]
        pad_x, height = 28.0 * u, 58.0 * u
        font = get_font("text", "Medium", 30 * u * SS)
        text_w = text_width_tracked(CAPTION, font, 0.0) / SS
        width = pad_x * 2 + 12 * u + 14 * u + text_w
        x = self.margin
        y = self.height - self.margin - 40 * u - height + caption["dy"]
        overlay.pill(x, y, width, height, fill=(6, 8, 16, int(150 * alpha)))
        overlay.pill(x, y, width, height, outline=(255, 255, 255, int(44 * alpha)), width=1.0)
        overlay.circle(
            x + pad_x + 6 * u,
            y + height / 2.0,
            6.0 * u,
            fill=rgba(BRAND["teal"], 0.92 * alpha),
        )
        overlay.text(
            x + pad_x + 12 * u + 14 * u,
            y + height / 2.0 + 10.5 * u,
            CAPTION,
            font,
            (255, 255, 255, int(242 * alpha)),
        )

    # -- small corner lockup ---------------------------------------------
    def _draw_lockup(self, overlay, alpha):
        u = self.unit
        size = 34.0 * u
        x = self.margin
        y = self.margin - 4 * u
        icon = render_icon(size * SS, spread=1.0, blur=0.85, sparkle=1.0, alpha=alpha, internal=4)
        overlay.paste(icon, x, y)
        font = get_font("display", "Semibold", 23 * u * SS)
        overlay.text(
            x + size + 12 * u,
            y + size / 2.0 + 8.2 * u,
            WORDMARK,
            font,
            (255, 255, 255, int(190 * alpha)),
            tracking=0.012,
        )

    # -- hero lockup -----------------------------------------------------
    def _draw_hero(self, overlay, hero):
        W, H = self.width, self.height
        unit = self.unit
        icon_size = 196.0 * unit * hero["icon_scale"]
        word_size = 88.0 * unit
        cx = W / 2.0
        # vertical stack, optically centred
        gap = 36.0 * unit * hero["icon_scale"]
        word_h = word_size * 0.72
        total = icon_size + gap + word_h
        top = H / 2.0 - total / 2.0 - 6.0 * unit + 16.0 * unit * hero["exit"]

        if hero["glow"] > 0.004:
            glow_size = icon_size * 2.7
            glow = radial_glow(glow_size, BRAND["teal"], hero["glow"] * 0.55, falloff=2.6)
            overlay.paste(glow, cx - glow_size / 2.0, top + icon_size / 2.0 - glow_size / 2.0)
            glow2 = radial_glow(glow_size * 0.62, BRAND["violet"], hero["glow"] * 0.42, falloff=2.2)
            overlay.paste(glow2, cx - glow_size * 0.31, top + icon_size * 0.42 - glow_size * 0.31)

        if hero["icon_alpha"] > 0.004 and icon_size > 4:
            icon = render_icon(
                icon_size * SS,
                spread=hero["icon_spread"],
                blur=hero["icon_blur"],
                sparkle=max(0.0, hero["sparkle"]),
                border_alpha=0.16,
                alpha=hero["icon_alpha"],
                internal=3,
            )
            overlay.paste(icon, cx - icon_size / 2.0, top)

        if hero["word_alpha"] > 0.004:
            font = get_font("display", "Semibold", word_size * SS)
            baseline = top + icon_size + gap + word_size * 0.74 + hero["word_rise"]
            overlay.text(
                cx,
                baseline,
                WORDMARK,
                font,
                (255, 255, 255, 255),
                tracking=hero["word_tracking"] * word_size,
                align="center",
                letter_dy=hero["word_letter_dy"],
                letter_alpha=hero["word_letter_alpha"],
            )

    # -- glass card ------------------------------------------------------
    def _card_geometry(self, card):
        W, H = self.width, self.height
        unit = self.unit
        margin = self.margin
        # 2-column chip grid on wide frames, one column on a square frame.
        two_cols = W >= 1.35 * H
        card_w = min(1180.0 * unit, W - 2.0 * margin - 40.0 * unit)
        pad = 56.0 * unit
        chip_h = 74.0 * unit
        gap = 28.0 * unit
        chip_w = (card_w - 2.0 * pad - (gap if two_cols else 0.0)) / (2.0 if two_cols else 1.0)
        cols = 2 if two_cols else 1
        rows = int(math.ceil(len(CHIPS) / cols))
        header_h = 78.0 * unit
        card_h = pad * 2.0 + header_h + rows * chip_h + (rows - 1) * 18.0 * unit
        cx = W / 2.0
        cy = H / 2.0 + 10.0 * unit
        return {
            "w": card_w * card["scale"],
            "h": card_h * card["scale"],
            "x": cx - card_w * card["scale"] / 2.0,
            "y": cy - card_h * card["scale"] / 2.0 + card["dy"],
            "r": 30.0 * unit * card["scale"],
            "pad": pad,
            "chip_w": chip_w * card["scale"],
            "chip_h": chip_h * card["scale"],
            "gap": gap,
            "cols": cols,
            "rows": rows,
            "header_h": header_h * card["scale"],
        }

    def _composite_card(self, frame, card):
        """Frosted backdrop over the live gradient (the engine's glass stage)."""
        H, W = frame.shape[:2]
        geo = self._card_geometry(card)
        alpha = card["alpha"]
        blur_px = 20.0 * self.unit  # glass backdrop blur, output pixels
        x0, y0 = geo["x"], geo["y"]
        w, h, radius = geo["w"], geo["h"], geo["r"]
        pad = blur_px * 2.6
        bx0 = max(0, int(math.floor(x0 - pad)))
        by0 = max(0, int(math.floor(y0 - pad)))
        bx1 = min(W, int(math.ceil(x0 + w + pad)))
        by1 = min(H, int(math.ceil(y0 + h + pad)))
        if bx1 - bx0 < 4 or by1 - by0 < 4:
            return frame

        crop = frame[by0:by1, bx0:bx1]
        blurred = (
            np.asarray(
                Image.fromarray(to_u8(crop), "RGB").filter(ImageFilter.GaussianBlur(blur_px)),
                dtype=np.float32,
            )
            / 255.0
        )
        # Anti-aliased rounded-rect mask for the card, built at SS then downsampled.
        big = Image.new("L", ((bx1 - bx0) * SS, (by1 - by0) * SS), 0)
        ImageDraw.Draw(big).rounded_rectangle(
            [
                (x0 - bx0) * SS,
                (y0 - by0) * SS,
                (x0 - bx0 + w) * SS,
                (y0 - by0 + h) * SS,
            ],
            radius=radius * SS,
            fill=255,
        )
        mask = np.asarray(big.resize((bx1 - bx0, by1 - by0), Image.LANCZOS), dtype=np.float32) / 255.0
        mask *= alpha

        tint = np.array([1.0, 1.0, 1.0], dtype=np.float32)
        tinted = blurred * (1.0 - 0.075) + tint * 0.075
        # A touch of vertical falloff: glass catches the light along its top edge.
        yy = np.linspace(1.06, 0.985, tinted.shape[0], dtype=np.float32)[:, None, None]
        tinted = np.clip(tinted * yy, 0.0, 1.0)

        out = crop * (1.0 - mask[..., None]) + tinted * mask[..., None]
        frame[by0:by1, bx0:bx1] = out
        return frame

    def _draw_card_chrome(self, overlay, card):
        """Border, inner highlight and the diagonal sheen - all at SS resolution."""
        geo = self._card_geometry(card)
        alpha = card["alpha"]
        x, y, w, h = geo["x"], geo["y"], geo["w"], geo["h"]
        radius = geo["r"]

        # chore: the sheen is clipped to the card's rounded mask
        if card["sheen_alpha"] > 0.004:
            bw, bh = int(round(w)), int(round(h))
            if bw > 4 and bh > 4:
                sheen = diagonal_sheen(
                    bw * SS,
                    bh * SS,
                    angle_deg=58.0,
                    position=card["sheen"],
                    width_frac=0.16,
                    peak=0.30 * card["sheen_alpha"] * alpha,
                )
                mask = Image.new("L", (bw * SS, bh * SS), 0)
                ImageDraw.Draw(mask).rounded_rectangle(
                    [0, 0, bw * SS - 1, bh * SS - 1], radius=radius * SS, fill=255
                )
                from PIL import ImageChops

                sheen.putalpha(ImageChops.multiply(sheen.getchannel("A"), mask))
                overlay.paste(sheen, x, y)

        # 1 px white border (engine `glass.border`)
        overlay.rounded_rect(
            (x, y, x + w, y + h),
            radius,
            outline=(255, 255, 255, int(72 * alpha)),
            width=1.0,
        )
        # top highlight: a short, soft white gradient along the upper edge
        inner_w = max(8.0, w - 2.0 * radius * 0.6)
        highlight = vertical_gradient(
            inner_w * SS, max(2.0, 46.0 * self.unit * SS), "#ffffff", 0.18 * alpha, 0.0
        )
        overlay.paste(highlight, x + (w - inner_w) / 2.0, y + 1.0)

        # header eyebrow
        head_alpha = card["header_alpha"] * alpha
        if head_alpha > 0.004:
            font = get_font("text", "Semibold", 17.0 * self.unit * SS)
            overlay.text(
                x + geo["pad"],
                y + geo["pad"] + 18.0 * self.unit,
                CARD_EYEBROW,
                font,
                (255, 255, 255, int(150 * head_alpha)),
                tracking=0.20,
            )
            # hairline divider under the eyebrow
            dy = y + geo["pad"] + 40.0 * self.unit
            overlay.line(
                [
                    (x + geo["pad"], dy),
                    (x + w - geo["pad"], dy),
                ],
                fill=(255, 255, 255, int(34 * head_alpha)),
                width=1.0,
            )

        # feature chips
        chip_font = get_font("text", "Medium", 31.0 * self.unit * SS)
        for index, chip in enumerate(card["chips"]):
            chip_alpha = chip["alpha"]
            if chip_alpha <= 0.004:
                continue
            col = index % geo["cols"]
            row = index // geo["cols"]
            cx = x + geo["pad"] + col * (geo["chip_w"] + geo["gap"])
            cy = y + geo["pad"] + geo["header_h"] + row * (geo["chip_h"] + 18.0 * self.unit) + chip["dy"]
            overlay.pill(
                cx,
                cy,
                geo["chip_w"],
                geo["chip_h"],
                fill=(8, 10, 20, int(120 * chip_alpha * alpha)),
            )
            overlay.pill(
                cx,
                cy,
                geo["chip_w"],
                geo["chip_h"],
                outline=(255, 255, 255, int(38 * chip_alpha * alpha)),
                width=1.0,
            )
            accent = ACCENTS[index % len(ACCENTS)]
            overlay.circle(
                cx + 30.0 * self.unit,
                cy + geo["chip_h"] / 2.0,
                6.5 * self.unit,
                fill=rgba(accent, 0.95 * chip_alpha * alpha),
            )
            overlay.text(
                cx + 30.0 * self.unit + 22.0 * self.unit,
                cy + geo["chip_h"] / 2.0 + 11.0 * self.unit,
                CHIPS[index],
                chip_font,
                (247, 249, 255, int(238 * chip_alpha * alpha)),
            )

    # -- end card --------------------------------------------------------
    def _draw_endcard(self, overlay, end):
        W, H = self.width, self.height
        unit = self.unit
        cx = W / 2.0

        icon_size = 74.0 * unit * end.get("icon_scale", 1.0)
        word_size = 84.0 * unit
        tag_size = 44.0 * unit
        tag_font = get_font("text", "Regular", tag_size * SS)
        max_w = W - 2.0 * self.margin - 60.0 * unit
        tag_lines = wrap_balanced(TAGLINE, tag_font, max_w * SS, 0.0)
        tag_line_h = tag_size * 1.34

        cta_size = 32.0 * unit
        if W < 1.3 * H:  # a square frame needs a slightly tighter CTA pill
            cta_size *= 0.90
        cta_font = get_font("display", "Semibold", cta_size * SS)
        cta_link_font = get_font("display", "Semibold", cta_size * SS)
        cta_lead_font = get_font("display", "Semibold", cta_size * SS)
        cta_sep_font = get_font("text", "Regular", cta_size * SS)
        # "Open source" in brand teal, a muted separator, then the repository in white.
        cta_segments = [
            ("Open source", cta_lead_font, rgba(BRAND["teal"], 0.98), 0.0),
            ("  ·  ", cta_sep_font, (168, 180, 204, 210), 0.0),
            (REPO_URL, cta_link_font, (247, 250, 255, 250), 0.0),
        ]
        cta_text_w = sum(text_width_tracked(t, f, tr) for t, f, _c, tr in cta_segments) / SS
        cta_h = 78.0 * unit
        cta_w = cta_text_w + 92.0 * unit
        cta_w = min(cta_w, W - 2.0 * self.margin)

        block = icon_size + 30.0 * unit + word_size * 0.78 + 28.0 * unit + len(tag_lines) * tag_line_h + 46.0 * unit + cta_h
        top = H / 2.0 - block / 2.0 + 4.0 * unit

        # soft brand glow behind the lockup
        if end.get("icon_alpha", 0.0) > 0.004:
            glow_size = 620.0 * unit
            glow = radial_glow(glow_size, BRAND["teal"], 0.10 * end["icon_alpha"], falloff=2.4)
            overlay.paste(glow, cx - glow_size / 2.0, top - glow_size * 0.18)
            glow_v = radial_glow(glow_size * 0.8, BRAND["violet"], 0.10 * end["icon_alpha"], falloff=2.6)
            overlay.paste(glow_v, cx - glow_size * 0.40, top + 40.0 * unit)

        if end.get("icon_alpha", 0.0) > 0.004:
            icon = render_icon(
                icon_size * SS,
                spread=1.0,
                blur=0.85,
                sparkle=1.0,
                border_alpha=0.16,
                alpha=end["icon_alpha"],
                internal=4,
            )
            overlay.paste(icon, cx - icon_size / 2.0, top)

        y = top + icon_size + 30.0 * unit
        if end.get("word_alpha", 0.0) > 0.004:
            font = get_font("display", "Semibold", word_size * SS)
            overlay.text(
                cx,
                y + word_size * 0.78 + end.get("word_rise", 0.0),
                WORDMARK,
                font,
                (255, 255, 255, int(255 * end["word_alpha"])),
                tracking=end.get("word_tracking", 0.0) * word_size,
                align="center",
            )
        y += word_size * 0.78 + 28.0 * unit
        if end.get("tag_alpha", 0.0) > 0.004:
            for line in tag_lines:
                overlay.text(
                    cx,
                    y + tag_size * 0.72 + end.get("tag_rise", 0.0),
                    line,
                    tag_font,
                    (214, 222, 240, int(238 * end["tag_alpha"])),
                    align="center",
                )
                y += tag_line_h
        y += 46.0 * unit

        if end.get("cta_alpha", 0.0) > 0.004:
            cta_alpha = end["cta_alpha"]
            scale = end.get("cta_scale", 1.0)
            w = cta_w * scale
            h = cta_h * scale
            x = cx - w / 2.0
            yy = y + (cta_h - h) / 2.0
            overlay.pill(x, yy, w, h, fill=(7, 10, 20, int(224 * cta_alpha)))
            # brand gradient ring
            grad_w, grad_h = int(round(w)), int(round(h))
            if grad_w > 8 and grad_h > 8:
                ring = self._gradient_ring(grad_w * SS, grad_h * SS, min(grad_h, w) / 2.0 * SS, cta_alpha)
                overlay.paste(ring, x, yy)
            if end.get("cta_sheen_alpha", 0.0) > 0.004:
                sheen = diagonal_sheen(
                    grad_w * SS,
                    grad_h * SS,
                    angle_deg=62.0,
                    position=end.get("cta_sheen", 0.0),
                    width_frac=0.22,
                    peak=0.22 * end["cta_sheen_alpha"] * cta_alpha,
                )
                mask = Image.new("L", (grad_w * SS, grad_h * SS), 0)
                ImageDraw.Draw(mask).rounded_rectangle(
                    [0, 0, grad_w * SS - 1, grad_h * SS - 1], radius=grad_h * SS / 2.0, fill=255
                )
                from PIL import ImageChops

                sheen.putalpha(ImageChops.multiply(sheen.getchannel("A"), mask))
                overlay.paste(sheen, x, yy)
            dot_x = x + 44.0 * self.unit
            overlay.circle(
                dot_x,
                yy + h / 2.0,
                5.5 * self.unit,
                fill=rgba(BRAND["teal"], 0.95 * cta_alpha),
            )
            text_x = dot_x + 18.0 * self.unit
            baseline = yy + h / 2.0 + 11.0 * self.unit
            for seg_text, seg_font, seg_colour, seg_tracking in cta_segments:
                colour = (seg_colour[0], seg_colour[1], seg_colour[2], int(seg_colour[3] * cta_alpha))
                text_x += overlay.text(text_x, baseline, seg_text, seg_font, colour, tracking=seg_tracking)

    def _gradient_ring(self, width, height, radius, alpha):
        """Rounded-rect outline filled with the brand gradient (teal -> violet -> rose)."""
        w, h = max(1, int(width)), max(1, int(height))
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        pos = np.clip((xx / w) * 0.65 + (yy / h) * 0.35, 0.0, 1.0)
        stops = [hex_rgb(BRAND["teal"]), hex_rgb(BRAND["violet"]), hex_rgb(BRAND["rose"])]
        grad = np.empty((h, w, 3), dtype=np.float32)
        for channel in range(3):
            grad[..., channel] = (
                np.interp(pos, [0.0, 0.5, 1.0], [s[channel] / 255.0 for s in stops])
            )
        ring = Image.new("L", (w, h), 0)
        ImageDraw.Draw(ring).rounded_rectangle(
            [0, 0, w - 1, h - 1],
            radius=radius,
            outline=255,
            width=max(2, int(round(2.0 * self.unit * SS))),
        )
        arr = np.empty((h, w, 4), dtype=np.float32)
        arr[..., :3] = grad
        arr[..., 3] = (np.asarray(ring, dtype=np.float32) / 255.0) * clamp(alpha)
        return Image.fromarray(to_u8(arr), "RGBA")


# --------------------------------------------------------------------------- ffmpeg


def ffmpeg_available():
    return bool(shutil.which(FFMPEG) or (os.path.exists(FFMPEG) and os.access(FFMPEG, os.X_OK)))


def encode(composition, out_path, crf=22, maxrate="5M", bufsize="10M"):
    W, H = composition.width, composition.height
    frames = int(round(DURATION * FPS))
    cmd = [
        FFMPEG,
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{W}x{H}",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        str(crf),
        "-maxrate",
        maxrate,
        "-bufsize",
        bufsize,
        "-profile:v",
        "high",
        "-level",
        "4.1",
        "-pix_fmt",
        "yuv420p",
        "-g",
        str(FPS * 2),
        "-bf",
        "2",
        "-x264-params",
        "aq-mode=3:deblock=1,1:ref=3:psy-rd=1.0,0.15:"
        "colorprim=bt709:transfer=bt709:colormatrix=bt709",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        for index in range(frames):
            t = index / FPS
            frame = composition.render(t)
            proc.stdin.write(frame.tobytes())
            if index % 30 == 0 or index == frames - 1:
                pct = 100.0 * (index + 1) / frames
                print(f"  {out_path.name}: frame {index + 1}/{frames} ({pct:5.1f}%) t={t:5.2f}s", flush=True)
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
    stderr = proc.stderr.read().decode("utf-8", "replace").strip()
    code = proc.wait()
    if code != 0:
        raise RuntimeError(f"ffmpeg failed ({code}):\n{stderr}")
    if stderr:
        print(stderr, file=sys.stderr)
    return out_path


def save_poster(composition, out_path, t=POSTER_TIME):
    frame = composition.render(t)
    Image.fromarray(frame, "RGB").save(out_path, format="PNG", optimize=True)
    return out_path


def probe(path):
    if not (shutil.which(FFPROBE) or os.path.exists(FFPROBE)):
        return {}
    out = subprocess.check_output(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "stream=index,codec_name,codec_type,width,height,r_frame_rate,avg_frame_rate,nb_frames,"
            "pix_fmt,profile,bit_rate:format=duration,size,bit_rate,format_name",
            "-of",
            "json",
            str(path),
        ],
        text=True,
    )
    return json.loads(out)


# --------------------------------------------------------------------------- CLI


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Render the MeshFlow Studio promo intro (deterministic, silent, original).",
    )
    parser.add_argument(
        "--only",
        choices=["all", "video", "square", "poster"],
        default="all",
        help="which deliverable(s) to render (default: all)",
    )
    parser.add_argument("--crf", type=int, default=22, help="x264 CRF (default 22)")
    parser.add_argument("--maxrate", default="5M", help="x264 maxrate cap (default 5M)")
    parser.add_argument("--bufsize", default="10M", help="x264 bufsize (default 10M)")
    parser.add_argument(
        "--stills",
        default="",
        help="comma separated times in seconds, e.g. 1.2,5.5,9.0 - writes PNG review stills",
    )
    parser.add_argument(
        "--still-dir",
        default=str(HERE / "_preview"),
        help="directory for --stills output (default: docs/media/_preview)",
    )
    parser.add_argument("--width", type=int, default=1920, help="16:9 output width")
    parser.add_argument("--height", type=int, default=1080, help="16:9 output height")
    parser.add_argument("--square", type=int, default=1080, help="square output edge")
    parser.add_argument("--preview-scale", type=float, default=1.0, help="render stills scaled down")
    args = parser.parse_args(argv)

    if not ffmpeg_available():
        sys.exit(f"ffmpeg not found/executable at {FFMPEG}")

    presets = load_presets()
    wide = Composition(args.width, args.height, presets)

    if args.stills:
        still_dir = Path(args.still_dir)
        still_dir.mkdir(parents=True, exist_ok=True)
        for token in args.stills.split(","):
            token = token.strip()
            if not token:
                continue
            t = float(token)
            frame = wide.render(t)
            image = Image.fromarray(frame, "RGB")
            if args.preview_scale != 1.0:
                image = image.resize(
                    (
                        max(1, int(round(image.width * args.preview_scale))),
                        max(1, int(round(image.height * args.preview_scale))),
                    ),
                    Image.LANCZOS,
                )
            path = still_dir / f"still-{t:05.2f}.png"
            image.save(path)
            print(f"wrote {path}")
        return 0

    produced = []
    if args.only in ("all", "video"):
        produced.append(
            encode(wide, HERE / "intro.mp4", crf=args.crf, maxrate=args.maxrate, bufsize=args.bufsize)
        )
    if args.only in ("all", "poster"):
        produced.append(save_poster(wide, HERE / "poster.png"))
    if args.only in ("all", "square"):
        square = Composition(args.square, args.square, presets)
        produced.append(
            encode(
                square,
                HERE / "intro-square.mp4",
                crf=args.crf,
                maxrate=args.maxrate,
                bufsize=args.bufsize,
            )
        )

    print("\noutputs:")
    for path in produced:
        data = probe(path)
        fmt = data.get("format", {})
        size = int(fmt.get("size", 0) or 0) or path.stat().st_size
        streams = [s for s in data.get("streams", []) if s.get("codec_type") == "video"]
        stream = streams[0] if streams else {}
        extra = ""
        if stream:
            extra = (
                f" {stream.get('width')}x{stream.get('height')} "
                f"{stream.get('codec_name')}/{stream.get('pix_fmt')} "
                f"{stream.get('r_frame_rate')}fps {float(fmt.get('duration', 0)):.3f}s"
            )
        print(f"  {path.name}: {size / 1e6:.2f} MB{extra}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
