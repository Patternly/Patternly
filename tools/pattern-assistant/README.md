# Pattern Assistant tools

Work for the thread "Automate photo-to-pattern cleanup for Luca-S team" (Cristian, 14–15 Nov 2026). The Luca-S team (about 5 people) cleans every converted design by hand. These tools measure what they change and prototype an automatic first draft.

The page is `assistant.html` at the repo root. The thread tables are inlined in it (`<script id="pa-threads">`, built from `LUCAS_RAW` / `DMC_RAW` / `ANCHOR_RAW` in `index.html`; rebuild them when threads change). Its engine is the `<script id="pa-engine">` block, run as a Web Worker.

Luca-S team only: the middleware answers 404 for the file itself on every live host (`assistantBlocked`, branch previews `<branch>.patternly.pages.dev` excepted) and hands it out through `GET partner/admin/assistant` to the owner or a team user with the `assistant` permission. Studio tab "Pattern Assistant" (`#tab-aassist`, `asLoad`) shows it from a blob address with `#studio` (no own title, light look, reports its height).

Engine v2 steps: Lab + bilateral smoothing at 3x the grid; detail map -> subject mask S; background smoothed more; lightness stretch, local contrast and colour on the subject ("Lighter and fresher" also lightens and calms the background); k-means for K colours with detailed areas weighted 4x, centres snapped to real threads; nearest thread per stitch, plus a one-stitch checker band where a smooth area sits between two close shades (dE < 13); stray specks merged; colours under 30 stitches merged.

## XSPro `.xsp` files (what we know)

- Width and height: two little-endian uint32 at byte 0x25 and 0x29.
- From 0x2D: one RGB preview colour per stitch, 4 bytes (R, G, B, 0), stored column by column (x outer, y inner).
- After that: the thread table (names such as `302 + 269` for blends) and the stitch data. Not decoded yet; the preview colours are enough to compare charts.

## Scripts (Python 3 + numpy + Pillow)

- `xsp_compare.py NAME raw.xsp edited.xsp` prints colours, single stitches, small blobs and what kind of changes the team made, and writes `NAME_raw.png`, `NAME_edited.png`, `NAME_changes.png`.
- `prototype.py` (engine v1 helpers) and `prototype_v2.py picture.jpg W H K out.png [fresh=1]` are the Python version of the engine (need `pal.json` = `{lucas:[{r,g,b}],...}` next to them).

## First findings (B717 roses, BU5113 cat)

- Team: colours 140–150 → 59–63, single stitches 35–39 % → 9–15 %, 83–88 % of stitches changed.
- They also make artistic changes (more contrast, crisp light edges, recoloured objects, added flowers). Those stay with people.
- Team charts: single stitches 9–15 %, of which stray (no diagonal partner, so not checker shading) 1.4–3.2 %. Engine v2: stray 3–4.5 %, 55–57 colours, 1–2 s per picture.
- The team shades with checker bands between close shades and keeps backgrounds to a few calm tones; v2 copies both.
