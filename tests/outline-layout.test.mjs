import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shelfLayout, outlineLayout } from '../dist/quick-layout.js';
import { validateLayout, transformed, bounds, nestedCount } from '../dist/geometry.js';
import { evaluateLayout, improves } from '../dist/search.js';

// The user's example (27 Oct): an L-shaped part and squares that fit its inside corner.
// Packing boxes cannot use the corner; packing outlines puts the squares in it.
const P = (id, outer) => ({ id, name: id, origin: { x: 0, y: 0 }, size: bounds(outer), entities: [{ kind: 'poly', closed: true, layer: '0', vertices: outer }], outer });
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const circle = (r) => Array.from({ length: 48 }, (_, i) => ({ x: r + r * Math.cos(i * Math.PI / 24), y: r + r * Math.sin(i * Math.PI / 24) }));
const tri = () => [{ x: 0, y: 0 }, { x: 78, y: 45 }, { x: 0, y: 90 }];
const parts = [
  P('L', [{ x: 76, y: 0 }, { x: 123, y: 0 }, { x: 123, y: 192 }, { x: 0, y: 192 }, { x: 0, y: 151 }, { x: 74, y: 151 }, { x: 76, y: 110 }]),
  P('tri1', tri()), P('tri2', tri()), P('c1', circle(46.5)), P('c2', circle(46.5)),
  P('sq1', rect(58, 58)), P('sq2', rect(58, 58)), P('s1', rect(28, 24)), P('s2', rect(28, 24)),
  P('q1', [{ x: 22, y: 0 }, { x: 38, y: 0 }, { x: 86, y: 38 }, { x: 0, y: 116 }]),
  P('q2', [{ x: 38, y: 0 }, { x: 117, y: 86 }, { x: 0, y: 64 }, { x: 0, y: 47 }]),
];
const settings = { width: 594, height: 420, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false, partInPart: true, minOffcutSide: 20, offcutShapeWeight: 0 };
const usedWidth = (list) => Math.max(...list.map((t) => { const b = bounds(transformed(parts.find((p) => p.id === t.id).outer, t)); return b.x + b.w; }));

test('outline packing fills the inside corner of an L and leaves a wider free strip', () => {
  const boxes = shelfLayout(parts, settings), outlines = outlineLayout(parts, settings);
  assert.equal(outlines.length, parts.length);
  assert.deepEqual(validateLayout(parts, outlines, settings), []);
  assert.ok(usedWidth(outlines) < 220, `used width ${usedWidth(outlines)}`);
  assert.ok(usedWidth(outlines) < usedWidth(boxes) - 50);
  assert.ok(improves(evaluateLayout(parts, outlines, settings).score, evaluateLayout(parts, boxes, settings).score));
  // Both large squares sit inside the L's bounding box, i.e. in its corner.
  const L = bounds(transformed(parts[0].outer, outlines.find((t) => t.id === 'L')));
  const inCorner = outlines.filter((t) => /^sq/.test(t.id)).filter((t) => { const b = bounds(transformed(parts.find((p) => p.id === t.id).outer, t)); return b.x >= L.x && b.x + b.w <= L.x + L.w && b.y >= L.y && b.y + b.h <= L.y + L.h; });
  assert.equal(inCorner.length, 2);
});

test('outline packing still puts parts in openings first and stays valid on the stress file', () => {
  const text = fs.readFileSync(new URL('../examples/laser-test/laser-test-a2-80-parts.dxf', import.meta.url), 'utf8');
  return import('../dist/importers.js').then(({ parseDXF }) => {
    const ps = parseDXF(text, 'auto').parts;
    const pl = outlineLayout(ps, settings);
    assert.equal(pl.length, 80);
    assert.deepEqual(validateLayout(ps, pl, settings), []);
    assert.equal(new Set(pl.map((t) => t.sheet)).size, 2);
    assert.ok(nestedCount(ps, pl, settings) >= 20);
  });
});

test('the page offers both instant layouts', () => {
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /\[outlineLayout\(state\.parts, runSettings\), shelfLayout\(state\.parts, runSettings\)\]/);
});
