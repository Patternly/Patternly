# Pattern Assistant tools

Work for the thread "Automate photo-to-pattern cleanup for Luca-S team" (Cristian, 14–15 Nov 2026). The Luca-S team (about 5 people) cleans every converted design by hand. These tools measure what they change and prototype an automatic first draft.

The page itself is `assistant.html` at the repo root (thread list in `pa-threads.json`, built from `LUCAS_RAW` / `DMC_RAW` / `ANCHOR_RAW` in `index.html`). Its engine is the `<script id="pa-engine">` block, run as a Web Worker, so it can move into Studio and the editor unchanged.

## XSPro `.xsp` files (what we know)

- Width and height: two little-endian uint32 at byte 0x25 and 0x29.
- From 0x2D: one RGB preview colour per stitch, 4 bytes (R, G, B, 0), stored column by column (x outer, y inner).
- After that: the thread table (names such as `302 + 269` for blends) and the stitch data. Not decoded yet; the preview colours are enough to compare charts.

## Scripts (Python 3 + numpy + Pillow)

- `xsp_compare.py NAME raw.xsp edited.xsp` prints colours, single stitches, small blobs and what kind of changes the team made, and writes `NAME_raw.png`, `NAME_edited.png`, `NAME_changes.png`.
- `prototype.py picture.jpg W H K out.png [fresh=1]` is the Python version of the engine (needs `pal.json` with the thread tables next to it).

## First findings (B717 roses, BU5113 cat)

- Team: colours 140–150 → 59–63, single stitches 35–39 % → 9–15 %, 83–88 % of stitches changed.
- They also make artistic changes (more contrast, crisp light edges, recoloured objects, added flowers). Those stay with people.
- The engine reaches the team's confetti level (8–11 % single stitches) in 1–2 s per picture.
