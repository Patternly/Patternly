// Accuracy of the colour-chart path against the hand-checked Riolis 2289 cells (riolis2289_gt.json).
//   python3 torgba.py IMG_1704_key.jpeg key.rgba 1800 1
//   pdftoppm -jpeg -scale-to 3600 preview_scan.pdf scan && python3 torgba.py scan-1.jpg scan.rgba
//   node eval_gt.js key.rgba 1350 1800 scan.rgba 2602 3600
// Prints grid, time, % correct, flagged share, and which classes were mixed up (true→read).
const P = require('./plscan.js'), fs = require('fs');
const [kf, kw, kh, cf, cw, ch] = process.argv.slice(2), G = JSON.parse(fs.readFileSync(__dirname + '/riolis2289_gt.json'));
const L = P.legendTiles(new Uint8ClampedArray(fs.readFileSync(kf)), +kw, +kh, 625, 331);
let t = Date.now(); const an = P.analysePage(new Uint8ClampedArray(fs.readFileSync(cf)), +cw, +ch, null, { colour: true }); const m = an.mesh;
const cells = P.readCells(an.rgba, an.w, an.h, m), tc = Date.now() - t; t = Date.now();
const r = P.matchColour(cells, m.cols, m.rows, L.templates.map((x, i) => ({ id: i, rgba: x.rgba, size: x.size })));
let ok = 0, st = 0, fl = 0; const wrong = {};
for (const [y, x, c] of G.cells) { const k = r.labels[y * m.cols + x] + 1; if (k === c) ok++; else wrong[c + '→' + k] = (wrong[c + '→' + k] || 0) + 1; }
for (let i = 0; i < r.labels.length; i++) if (r.labels[i] >= 0) { st++; if (r.margin[i] < 0.06) fl++; }
console.log(`grid ${m.cols}×${m.rows}, page ${tc} ms, match ${Date.now() - t} ms; correct ${(100 * ok / G.cells.length).toFixed(1)}% of ${G.cells.length}; flagged ${(100 * fl / st).toFixed(1)}% of ${st} stitches`);
console.log('mix-ups', JSON.stringify(wrong));
