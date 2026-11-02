# Scan engine harness (Node, no browser)

The shipped engine lives inside `index.html` (`<script id="plscan-src">`). These files test it from the command line.

- `./extract.sh` — copies the engine out of `index.html` into `plscan.js` (git-ignored copy, regenerate after every edit).
- `python3 torgba.py photo.jpg out.rgba [maxSide] [turns]` — photo to raw RGBA (prints width height). The app reads key photos at 1800 px and chart pages at up to 4200 px.
- `node colour_run.js key.rgba kw kh tapX tapY chart.rgba cw ch outDir` — colour key (Riolis style) + one chart page: prints the key read-out, grid size, the share of cells flagged "to check", and writes a side-by-side picture (photo cells | recognised key squares).

Test photos are not in the repo (kit charts are copyrighted). The Riolis 2289 photos Cristian sent on 28 Oct 2026 are in the project files under `scan-tests/riolis-2289/`.
- `node eval_gt.js key.rgba 1350 1800 scan.rgba 2602 3600` — accuracy of the colour path on 234 hand-checked cells of the Riolis 2289 iOS Preview scan (`riolis2289_gt.json`: row, column, key row 1–29 or 0 for empty). Run it before and after every engine change; v644 = 88.0 %.
