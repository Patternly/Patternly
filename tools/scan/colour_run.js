// Colour-key scan without the browser: key photo + tap point + one chart page → labels and a picture.
//   node colour_run.js key.rgba kw kh tapX tapY chart.rgba cw ch outDir
// (key photo at 1800 px long side like the app; make the .rgba files with torgba.py)
const P = require('./plscan.js'), fs = require('fs');
const [kf, kw, kh, tx, ty, cf, cw, chh, out] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const L = P.legendTiles(new Uint8ClampedArray(fs.readFileSync(kf)), +kw, +kh, +tx, +ty);
if (!L.ok) { console.log('key not read:', L.reason); process.exit(1); }
console.log('key squares', L.templates.length, 'plain', L.swatches.filter(s => !s.glyph).length, 'backstitch lines', L.lines.length);
const prog = () => {}; prog.debug = true;
let t = Date.now(); const an = P.analysePage(new Uint8ClampedArray(fs.readFileSync(cf)), +cw, +chh, prog);
if (!an.ok) { console.log('chart page:', an.reason); process.exit(1); }
const m = an.mesh; console.log('grid', m.cols, 'x', m.rows, 'colour', an.colour, Date.now() - t, 'ms');
t = Date.now(); const cells = P.readCells(an.rgba, an.w, an.h, m);
const r = P.matchColour(cells, m.cols, m.rows, L.templates.map((x, i) => ({ id: i, rgba: x.rgba, size: x.size })), { debug: true });
console.log('cells + match', Date.now() - t, 'ms');
let uns = 0; for (const v of r.margin) if (v < 0.06) uns++; console.log('to check (margin < 0.06):', uns, (100 * uns / r.margin.length).toFixed(1) + '%');
// side by side: photo cells | recognised key squares (magenta corner = to check)
const S = 16, W1 = m.cols + 1, img = Buffer.alloc(m.rows * S * m.cols * S * 2 * 3);
const put = (x, y, rgb) => { const o = (y * m.cols * S * 2 + x) * 3; img[o] = rgb[0]; img[o + 1] = rgb[1]; img[o + 2] = rgb[2]; };
for (let i = 0; i < m.rows; i++) for (let j = 0; j < m.cols; j++) {
  const a = i * W1 + j, b = a + 1, c = a + W1 + 1, d = a + W1;
  const cell = P.cutCell(an.rgba, an.w, an.h, [m.xs[a], m.ys[a], m.xs[b], m.ys[b], m.xs[c], m.ys[c], m.xs[d], m.ys[d]]);
  const k = r.labels[i * m.cols + j], T = k >= 0 ? L.templates[k].rgba : null, flag = r.margin[i * m.cols + j] < 0.06;
  for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
    const sp = (Math.floor(v * 2.5) * 40 + Math.floor(u * 2.5)); put(j * S + u, i * S + v, [cell[sp * 3], cell[sp * 3 + 1], cell[sp * 3 + 2]]);
    const q = sp * 4; let px = T ? [T[q], T[q + 1], T[q + 2]] : [255, 255, 255]; if (flag && (u < 2 || v < 2)) px = [255, 0, 255];
    put(m.cols * S + j * S + u, i * S + v, px);
  }
}
fs.writeFileSync(out + '/compare.rgb', img); fs.writeFileSync(out + '/compare.json', JSON.stringify({ w: m.cols * S * 2, h: m.rows * S }));
console.log('wrote', out + '/compare.rgb (python3 -c "from PIL import Image;import json;j=json.load(open(\'' + out + '/compare.json\'));Image.frombytes(\'RGB\',(j[\'w\'],j[\'h\']),open(\'' + out + '/compare.rgb\',\'rb\').read()).save(\'' + out + '/compare.png\')")');
