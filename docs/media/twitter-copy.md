# Twitter / X launch copy: MeshFlow Studio intro

Assets in this folder:

- `intro.mp4`: 1920×1080 (16:9), 30 fps, 12 s, silent, H.264/yuv420p/+faststart.
- `intro-square.mp4`: 1080×1080 (1:1), 30 fps, 12 s, silent, same cut.
- `poster.png`: 1920×1080 hero still (the glass-card + feature-chip frame, 8.55 s).

All three are **original motion-graphics renders**, not a screen recording, and contain
**no audio track**. Upload the MP4 as-is (X re-encodes it, so keep the caption text readable;
it is set at ≥32 px on a 1080p frame).

---

## Caption options (≤ 240 characters, 2–3 hashtags)

**1: product-first (recommended for the main post)**

> Mesh gradients, soft blur, film grain, glassmorphism: a live design studio for the Harness
> Web UI. Sculpt mesh nodes, export PNG, copy the CSS. Now open source.
> #meshgradient #css #opensource

**2: tagline-first (matches the video end card)**

> Design mesh gradients, blur & glass. Then ship the CSS. 16 presets, 8 palettes, draggable
> mesh nodes and one-click PNG export. Open source, local-first.
> #meshgradient #webdesign #opensource

**3: launch-thread opener (pairs with the thread below)**

> Twelve seconds of MeshFlow Studio: gradients bloom, glass rises, and every composition is
> copy-paste CSS. Open source ↓ github.com/hemanth090/meshflow-studio
> #cssart #buildinpublic #opensource

---

## Poster alt text

> A deep violet mesh gradient on a near-black navy plate. In the centre, a frosted
> glassmorphism card with a thin white border and a diagonal light sheen holds six feature
> chips, each with a coloured dot (Draggable mesh nodes, Soft blur, Film grain,
> Glassmorphism, PNG export, Copy CSS) in teal, violet, rose and sky blue. A small
> “MeshFlow Studio” icon-and-wordmark lockup sits in the top-left corner.

Short alt text (if the field is tight):

> MeshFlow Studio teaser: a violet mesh gradient with a frosted glass card listing six
> features: draggable mesh nodes, soft blur, film grain, glassmorphism, PNG export, copy CSS.

---

## Suggested thread outline (5 posts)

1. **Hook:** post `intro.mp4` (16:9) with caption 3. One sentence on what it is, one link.
2. **What it does:** the state model: 2–12 mesh nodes, per-node colour/position/radius/opacity,
   16 presets, 8 palettes, deterministic Randomize. Screenshot or `poster.png`.
3. **The effects:** soft blur, seeded film grain (amount/scale/seed/blend), vignette, and the
   glassmorphism card (backdrop blur, tint, 1px border, sheen). Short loop or still of the card.
4. **Ship it:** PNG at 1×/2×/4×, Copy PNG, Copy CSS, Copy JSON, Download CSS/JSON. Paste a real
   CSS snippet from the studio in the post.
5. **Install / contribute:** open source, MIT-style local bundle, no network calls, no runtime
   dependencies beyond the Harness-provided React. Link the repo and the README install section.

**Posting notes**

- Alternate the formats: 16:9 (`intro.mp4`) for the timeline, 1:1 (`intro-square.mp4`) if the
  post sits in a square-crop placement or an X article header.
- X auto-plays silently, so never add music/voice to these files; the cut is designed for silence
  and the caption carries the message.
- Keep the first 3 seconds intact: the gradient bloom + wordmark land before X's autoplay
  chyron can cover the lower third.
- If you add a caption overlay in the X composer, keep it clear of the bottom-left chip
  (“Mesh gradients, perfected.”) and the end-card CTA (centre, 10.3–12 s).
- Tag the repository exactly as shown on the end card: `github.com/hemanth090/meshflow-studio`.

---

## Paste-ready hooks (verified character counts)

All of these are em-dash-free and fit X's 280-character limit with room for a link in the reply.

### Recommended hook (attach `intro.mp4`, link goes in the first reply)

> Every beautiful background I've ever needed took 40 browser tabs and a blur filter. So I built
> the studio instead: mesh gradients, film grain, frosted glass. Copy the CSS, export the PNG.

187 characters. Specific pain, then the payoff; the 12 s video is the proof.

### Alternative angles

| Angle | Hook | Chars |
|---|---|---|
| Curiosity / technical | Mesh gradients look like magic. They're 2 to 12 radial blobs and one blur pass. Here's the studio that lets you sculpt them, then copy the CSS. | 143 |
| Builder / credibility | I shipped a design studio as a plugin: draggable mesh nodes, soft blur, seeded grain, glassmorphism. PNG export, copy CSS, 69 tests, zero dependencies, MIT. | 156 |
| Blunt command | Stop screenshotting gradients. Sculpt them, then ship the CSS. MeshFlow Studio is open source. | 94 |
| Visual, no claims | 12 seconds of mesh gradients blooming, glass rising, and grain settling. Every frame is a composition you can copy as CSS. | 122 |
| Question | What if a good background took two minutes instead of an afternoon? Mesh gradients, glass and grain, with a CSS copy button. Open source. | 137 |
| Hashtags | Mesh gradients, film grain, frosted glass. Design it, export the PNG, copy the CSS. Open source. #meshgradient #css #opensource | 127 |

### First reply (put the link here for reach)

> Repo, docs and the 12 second teaser: github.com/hemanth090/meshflow-studio (MIT, local-first, no network calls)

111 characters. A link in a reply costs no main-post reach.

### Posting mechanics

1. Upload `docs/media/intro.mp4` natively (16:9, 6.29 MB, silent, 30 fps). Do not convert it to GIF:
   GIF would band the darks and balloon the file size.
2. Keep the main post link-free, then reply with the repo line immediately.
3. If the main post uses `poster.png` instead of the video, use the alt text in the section above.
4. The video lands the wordmark in its first 2.3 s, so the hook line carries the message while it plays.
