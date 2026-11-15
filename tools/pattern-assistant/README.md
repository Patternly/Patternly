# Pattern Assistant tools

Work for the thread "Automate photo-to-pattern cleanup for Luca-S team" (Cristian, 14–15 Nov 2026). The Luca-S team (about 5 people) cleans every converted design by hand. These tools measure what they change and prototype an automatic first draft.

The page is `assistant.html` at the repo root. The thread tables are inlined in it (`<script id="pa-threads">`, built from `LUCAS_RAW` / `DMC_RAW` / `ANCHOR_RAW` in `index.html`; rebuild them when threads change). Its engine is the `<script id="pa-engine">` block, run as a Web Worker.

Luca-S team only: the middleware answers 404 for the file itself on every live host (`assistantBlocked`, branch previews `<branch>.patternly.pages.dev` excepted) and hands it out through `GET partner/admin/assistant` to the owner or a team user with the `assistant` permission. Studio tab "Pattern Assistant" (`#tab-aassist`, `asLoad`) shows it from a blob address with `#studio` (no own title, light look, reports its height).

Engine v3 steps: plain border trimmed (`trimBox`); Lab + bilateral smoothing at 3x the grid; detail map -> subject mask S (smoothstep 0.08–0.3 of blurred detail / p90); background smoothed only where S is low; lightness stretch, clarity 0.25 x (L - wide blur) everywhere, fine contrast 0.45 x S, chroma x1.25 only for already strong colours (C 15–40 ramp) ("Lighter and fresher" also lightens and calms the background); k-means for K colours with detailed areas weighted 4x, centres snapped to real threads; nearest thread per stitch, plus a one-stitch checker band where a smooth area sits between two close shades (dE < 13); stray specks merged (Standard dE < 26); last pass: a single stitch with no same colour around it joins the closest neighbouring colour if dE < 22 (Strong 28, Gentle off); colours under 30 stitches merged.

## XSPro `.xsp` files (what we know)

- Width and height: two little-endian uint32 at byte 0x25 and 0x29.
- From 0x2D: one RGB preview colour per stitch, 4 bytes (R, G, B, 0), stored column by column (x outer, y inner).
- After that: the thread table (names such as `302 + 269` for blends) and the stitch data. Not decoded yet; the preview colours are enough to compare charts.

## Scripts (Python 3 + numpy + Pillow)

- `xsp_compare.py NAME raw.xsp edited.xsp` prints colours, single stitches, small blobs and what kind of changes the team made, and writes `NAME_raw.png`, `NAME_edited.png`, `NAME_changes.png`.
- `prototype.py` (engine v1 helpers) and `prototype_v2.py picture.jpg W H K out.png s0=0.08 s1=0.3 a1=0.25 cb=0.25 cmode=1 cd=26 fin=22 [fresh=1]` (those values = engine v3) are the Python version of the engine (need `pal.json` = `{lucas:[{r,g,b}],...}` next to them).

## Findings (B717 roses, BU5113 cat, BU5107 Paris, B707 magnolias)

- Team: colours 140–150 → 59–63, single stitches 35–39 % → 9–15 %, 83–88 % of stitches changed.
- They also make artistic changes (more contrast, crisp light edges, recoloured objects, added flowers). Those stay with people.
- Team charts: single stitches 9–15 %, of which stray (no diagonal partner, so not checker shading) 1.4–3.2 %. Engine v2: stray 3–4.5 %, 55–57 colours, 1–2 s per picture.
- The team shades with checker bands between close shades and keeps backgrounds to a few calm tones; v2 copies both.
- Engine v3 on the 4 kits at the team's size and colour count: stray 0.7–3.3 %, local contrast within about 10 % of the team's. Still for people: redrawing small shapes crisply (lamps, figures, basket weave), recolouring, and the lighter pinkish whites the team gives pale flowers.
