# MeshFlow Studio: launch media

Original motion-graphics assets for the MeshFlow Studio launch: a 12-second silent intro, a
square cut of the same edit, a hero poster and the exact preset data the artwork is built from.

Everything here is **generated**, not recorded: an original motion-graphics intro (not a screen recording), rendered frame-by-frame from the
plugin's own preset data and rendering maths. No stock footage, no third-party logos, no external assets, no network access and **no
audio track**.

| File | What it is | Format | Size |
|---|---|---|---|
| `intro.mp4` | Primary Twitter/X asset (16:9) | 1920×1080, 30 fps, 12.0 s, H.264 / yuv420p / +faststart | 6,287,495 B (6.29 MB) |
| `intro-square.mp4` | Square cut of the same edit (1:1) | 1080×1080, 30 fps, 12.0 s, H.264 / yuv420p / +faststart | 4,469,980 B (4.47 MB) |
| `poster.png` | Hero still for cards / article headers | 1920×1080 PNG, RGB | 2,481,600 B (2.48 MB) |
| `presets.json` | The plugin's real 16 preset compositions + 8 palettes | JSON (dump of `MF.model.PRESETS`) | 32,225 B |
| `render-video.py` | Deterministic generator (Pillow + numpy + ffmpeg) | Python 3.10+ | n/a |
| `dump-presets.mjs` | Re-dumps `presets.json` from `src/` via `node:vm` | Node.js ≥ 20 | n/a |
| `twitter-copy.md` | Captions, poster alt text, thread outline | Markdown | n/a |

`poster.png` is the frame at **8.55 s** (glass card landed, all six feature chips settled) and is
rendered from the same generator at full resolution, with no JPEG artifacts and no frame grab from the
compressed video.

---

## Specs

### Video (`intro.mp4`, `intro-square.mp4`)

| Property | Value |
|---|---|
| Container | MP4 (`mov,mp4,m4a,3gp,3g2,mj2`), `+faststart` (`moov` at byte 32, before `mdat`) |
| Codec / profile | H.264 / High profile, level 4.1 |
| Pixel format | `yuv420p` (8-bit 4:2:0) |
| Resolution | 1920×1080 and 1080×1080 |
| Frame rate | 30 fps constant (`r_frame_rate` = `avg_frame_rate` = `30/1`), 360 frames |
| Duration | exactly 12.000 s |
| Colour | BT.709 matrix / transfer / primaries (`-colorspace bt709` + x264 VUI) |
| Audio | **none:** no audio stream is ever written (`-an`) |
| Encoding | libx264, `-preset slow -crf 22 -maxrate 5M -bufsize 10M` (square: `-maxrate 4.5M`), `aq-mode=3`, `deblock=1,1`, `psy-rd=1.0,0.15`, `ref=3`, `bf=2`, `-g 60` |
| Measured bitrate | 4,191,663 bps (16:9) / 2,979,986 bps (square) |

### Poster (`poster.png`)

1920×1080, PNG, RGB, rendered losslessly at output resolution (no video encode). Composited with
anti-aliased vector chrome rendered at 2× and downsampled with Lanczos, so the type is crisp at
1×. Contains no motion blur or inter-frame artefacts (it is a single rendered frame).

---

## Scene breakdown (30 fps)

The edit is one continuous shot: the gradient plate never cuts; elements enter and leave over it.

| Time | Frames | Beat |
|---|---|---|
| 0.00 → 0.95 | 0–28 | Fade up from black; the plate resolves to deep navy (`#0b1020` → `#05060c`). |
| 0.28 → 2.45 | 8–73 | The mesh gradient **blooms out of a central knot**: every blob starts at the centre at 12 % radius and opens to its preset position/size with ease-in-out; the whole-canvas blur relaxes from 45 % to full strength. |
| 0.62 → 1.66 | 19–50 | The **4-blob MeshFlow mark draws itself**: rounded-square mask (radius 30/128), aurora blobs unfurl from the centre while their falloff sharpens, hairline white border fades in. |
| 1.16 → 2.34 | 35–70 | Logotype **“MeshFlow Studio”** eases in: per-letter stagger, tracking animates from +0.155 em down to +0.004 em (tight), letters rise 16 px into place. |
| 1.28 → 1.78 | 38–53 | White **sparkle** stars pop with a slight overshoot (`ease-out-back`). |
| 2.62 → 3.18 | 79–95 | Hero lockup lifts and fades as the gradient takes over. |
| 2.95 → 3.55 | 88–107 | Small icon + wordmark **corner lockup** fades in (top-left, 5 % margin) and stays through the product scenes. |
| 2.95 → 4.35 | 88–130 | Preset morph 1: **aurora-veil → neon-tokyo** (blob positions, radii, opacities and colours interpolated in linear light; screen ↔ additive blend weights cross-faded). |
| 4.35 → 5.75 | 130–172 | Preset morph 2: **neon-tokyo → rose-quartz**. |
| 4.82 → 5.44 / 7.12 → 7.52 | 145–163 / 214–226 | Caption chip **“Mesh gradients, perfected.”** slides up and fades bottom-left, then clears before the end card. |
| 6.40 → 8.55 | 192–256 | Preset morph 3: **rose-quartz → plum-noir:** the plate turns violet/magenta behind the glass card. |
| 6.38 → 7.20 | 191–216 | **Glassmorphism card rises** into frame (74 px rise, 0.968 → 1.0 scale, ease-out-cubic): frosted backdrop blur over the live gradient, 7.5 % white tint, 1 px white border, inner top highlight. |
| 7.00 → 8.15 | 210–245 | **Diagonal sheen** sweeps across the card (Gaussian band, 58°, clipped to the rounded mask). |
| 7.06 → 8.12 | 212–244 | Six **feature chips** stagger in (110 ms apart, 520 ms each): Draggable mesh nodes · Soft blur · Film grain · Glassmorphism · PNG export · Copy CSS, each with a brand accent dot (`#5eead4` `#a78bfa` `#fb7185` `#38bdf8`). |
| 9.02 → 9.42 | 271–283 | Card and chips fade/lift out. |
| 9.15 → 9.95 | 275–299 | Plate darkens toward navy; vignette relaxes. |
| 9.42 → 10.02 | 283–301 | End-card icon mark scales in. |
| 9.55 → 10.30 | 287–309 | **Wordmark** rises 18 px with tracking animating from +0.10 em to 0. |
| 9.90 → 10.62 | 297–319 | Tagline **“Design mesh gradients, blur & glass. Then ship the CSS.”** |
| 10.30 → 11.00 | 309–330 | **CTA pill** “Open source · github.com/hemanth090/meshflow-studio” with a teal→violet→rose gradient ring, a light sheen at 10.55–11.35. |
| 11.66 → 12.00 | 350–359 | Fade to black. |

Throughout: a **slow camera push** (zoom 1.00 → 1.12), per-blob **parallax** against a drifting
camera offset, a **travelling soft light bloom** (adds at low intensity), seeded **film grain**
(re-seeded every frame) and a **vignette**. All easing is ease-in-out cubic unless noted.

Layout: 96 px safe margin on the 1080p frame (5 % of width), text measure capped at ~1728 px;
typography 88 px hero wordmark / 84 px end-card wordmark / 44 px tagline / 31 px chip labels /
30 px caption / 32 px CTA. On the 1080×1080 cut the feature chips reflow to one column and the
tagline balances onto two lines; everything stays inside the same 5 % margins.

---

## Where the artwork comes from (provenance)

**Preset data.** `presets.json` is a verbatim dump of the plugin's real `MF.model.PRESETS`
(16 presets) plus `MF.model.PALETTES` (8 palettes), produced by loading `src/00-prelude.js` +
`src/10-model.js` in a `node:vm` sandbox and serialising `MF.model.PRESETS`:

```sh
node docs/media/dump-presets.mjs          # writes docs/media/presets.json
```

`render-video.py` reads that file; no colour, position, radius or opacity in the artwork is
invented. The edit uses four of the sixteen presets: `aurora-veil` → `neon-tokyo` →
`rose-quartz` → `plum-noir`.

**Rendering maths ported from `src/20-engine.js`:**

- blob = radial gradient at `(x·w, y·h)`, radius `size · max(w, h)`, colour at `opacity` at 0 %,
  transparent from 72 % to 100 % (the engine's exact stops);
- blobs composite through the preset's `mix` mode (`normal` / `screen` / `lighter`); during a
  morph the blend weights are interpolated so no frame ever cuts between modes;
- whole-canvas blur = `MF.model.blurPx`: `blur / 100 · min(w, h) · 0.09`;
- grain = seeded monochrome noise tiled at `MF.model.grainTileSize` (`lerp(256, 48, (scale−1)/99)`),
  added at `amount` with a filmic 0.55 gain and a fresh seed per frame;
- vignette = the engine's radial ramp (`amount`, `size`).

**Deliberate video grade (the only deviation from the studio's export).** Presets are authored to
fill the whole artboard, which reads as a bright wash over 12 s of motion. For the teaser each
preset's blob opacity is graded down, blob radii are scaled ×0.62 and blur ×0.80, and the field is
tone-graded (gamma 1.35, exposure 0.90, saturation 1.25) onto the brand's `#0b1020`–`#05060c`
plate. Relative colours, positions, opacities, blur ratios and grain amounts remain the preset's
own. The knobs are: `OPACITY_GRADE`, `SIZE_SCALE`, `BLUR_SCALE`, `GRADE_GAMMA`, `GRADE_EXPOSURE`,
`GRADE_SATURATION` at the top of `render-video.py`.

**Typography.** macOS system fonts only: `/System/Library/Fonts/SFNS.ttf` (variable weight axis -
Semibold for the wordmark/CTA, Medium for chips, Regular for the tagline), with
`HelveticaNeue.ttc` → `Helvetica.ttc` → `Arial*.ttf` fallbacks (plus DejaVu on Linux). The script verifies each path
loads before use and falls back gracefully (Pillow's bundled default if none exist). Glyphs are
laid out individually with kerning-aware advances so the tracking animation stays clean.

---

## Regeneration

From the plugin root (`meshflow-studio/`), one command regenerates all three media files:

```sh
python3 docs/media/render-video.py
```

Requirements:

- Python 3.10+ with **Pillow** and **numpy** (`python3 -m pip install pillow numpy`;
  tested with Pillow 12.3.0 / numpy 2.3.5).
- **ffmpeg** and **ffprobe** on `PATH` (`brew install ffmpeg` on macOS, `apt install ffmpeg` on
  Debian/Ubuntu). Set `MESHFLOW_FFMPEG` / `MESHFLOW_FFPROBE` to point at a specific binary.
- macOS system fonts for the brand typography (SF / Helvetica Neue / Arial); on other systems the
  script falls back through its font stack and, failing that, to Pillow's bundled default.

No network, no pip installs at render time, no external assets.

The generator renders both cuts and the poster, streams raw RGB frames straight into ffmpeg
(no PNG intermediates, no second generation), then prints a size/resolution/duration summary.
Runtime is ~2–3 minutes total on an M-series Mac.

Useful flags:

```sh
python3 docs/media/render-video.py --only video      # just intro.mp4
python3 docs/media/render-video.py --only square     # just intro-square.mp4
python3 docs/media/render-video.py --only poster     # just poster.png
python3 docs/media/render-video.py --crf 21 --maxrate 6M --bufsize 12M
python3 docs/media/render-video.py --stills 1.2,5.5,8.55   # review frames -> _preview/ (scratch)
```

To refresh the preset data first (after any preset change in `src/10-model.js`):

```sh
node docs/media/dump-presets.mjs && python3 docs/media/render-video.py
```

**Determinism.** Same inputs → same frames: no wall-clock, no `Math.random`, every random value
comes from `numpy.random.default_rng(seed)` with a seed derived from the timeline (grain),
`mulberry32`-style constants elsewhere, and the preset data. Pillow and numpy versions pin the
exact raster; `--stills` regenerates identical frames.

---

## Encoding (what the generator runs)

Frames are piped as raw `rgb24` at the target resolution and encoded in one pass:

```sh
ffmpeg -f rawvideo -pix_fmt rgb24 -s 1920x1080 -r 30 -i - \
  -an -c:v libx264 -preset slow -crf 22 -maxrate 5M -bufsize 10M \
  -profile:v high -level 4.1 -pix_fmt yuv420p -g 60 -bf 2 \
  -x264-params "aq-mode=3:deblock=1,1:ref=3:psy-rd=1.0,0.15:colorprim=bt709:transfer=bt709:colormatrix=bt709" \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -movflags +faststart intro.mp4
```

The square cut is the same command at `1080x1080` with `-maxrate 4.5M -bufsize 9M`.

If you need to re-encode an existing master instead (e.g. a larger archival render):

```sh
ffmpeg -i master.mp4 -an \
  -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p \
  -maxrate 6M -bufsize 12M \
  -profile:v high -movflags +faststart intro.mp4
```

**Size budget.** Animated film grain dominates H.264 bitrate; without a cap the same cut encodes
to ~37 MB. The generator therefore caps the rate (`-maxrate 5M`) on top of CRF 22 and keeps grain
amplitude low, landing at 6.29 MB (16:9) / 4.47 MB (1:1); inside the <10 MB Twitter limit with
room to spare, and visually clean at 1080p. Lower `--maxrate` if you need a smaller file; raise
`--crf` (e.g. 20) only if you also raise `--maxrate`, otherwise the cap erases the gain.

---

## Twitter / X posting notes

- **Primary asset:** `intro.mp4` (16:9). It auto-plays silently on the timeline, which is how the
  cut is designed: the caption chip and end card carry the message.
- **Square placements:** `intro-square.mp4` (1:1) for profile-adjacent or square-crop slots.
- **Card / article header:** `poster.png` (1920×1080). No JPEG artefacts; use it as-is rather than
  grabbing a frame from the compressed MP4.
- **Aspect ratios:** 16:9 = 1920×1080; 1:1 = 1080×1080. X renders 16:9 natively and will letterbox
  a square upload in wide placements, so pick the format that matches the post surface.
- **No audio:** do not add music or voice-over. The files have no audio stream at all (X shows
  them without a mute affordance); adding audio means re-encoding and losing the size budget.
- **Legibility:** all copy is set at ≥30 px on a 1080p frame and kept inside a 5 % safe margin, so
  it stays readable at phone size and under X's UI chrome. The first 3 seconds (bloom + wordmark)
  are clean of bottom-third UI overlap.
- **Captions, alt text and a thread outline** live in [`twitter-copy.md`](twitter-copy.md).
- Upload the MP4 directly (not a GIF conversion): X's encoder keeps 30 fps and the grain reads
  correctly; GIF would band the darks and balloon the file size.

---

## Verification

`ffprobe -v error -show_entries format=duration,size,bit_rate -show_entries stream=...`:

```text
# intro.mp4
codec_name=h264   profile=High   pix_fmt=yuv420p   1920x1080
r_frame_rate=30/1  avg_frame_rate=30/1  nb_frames=360
color_space=bt709  color_transfer=bt709  color_primaries=bt709
duration=12.000000  size=6287495  bit_rate=4191663     # no audio stream

# intro-square.mp4
codec_name=h264   profile=High   pix_fmt=yuv420p   1080x1080
r_frame_rate=30/1  avg_frame_rate=30/1  nb_frames=360
color_space=bt709  color_transfer=bt709  color_primaries=bt709
duration=12.000000  size=4469980  bit_rate=2979986     # no audio stream

# poster.png
codec_name=png  pix_fmt=rgb24  1920x1080  size=2481600
```

Faststart check (atom order: `moov` before `mdat`):

```text
intro.mp4        ftyp(32) → moov(3782) → free(8) → mdat
intro-square.mp4 ftyp(32) → moov(3743) → free(8) → mdat
```

Silence check:

```sh
ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 intro.mp4 | wc -l   # 0
```

---

## Release facts

- **Primary asset:** `intro.mp4`, 16:9, 1920×1080, 30 fps, 12 s, silent, H.264 / yuv420p /
  faststart, 6.29 MB. Safe to upload to X as-is.
- **Square cut:** `intro-square.mp4`, 1080×1080, same edit, 4.47 MB.
- **Hero still:** `poster.png`, 1920×1080, rendered losslessly (not a frame grab).
- **Original artwork.** No stock footage, no third-party logos, no music, no voice-over; every
  colour, position, radius and opacity comes from the plugin's real preset data.
- **Reproducible offline.** `node docs/media/dump-presets.mjs && python3 docs/media/render-video.py`
  regenerates every file deterministically; the end-card CTA comes from the `REPO_URL` constant at
  the top of `render-video.py` (`https://github.com/hemanth090/meshflow-studio`).
- **Captions and alt text:** [`twitter-copy.md`](twitter-copy.md).
