import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDXF } from '../dist/importers.js';
import { shelfLayout } from '../dist/quick-layout.js';
import { validateLayout, partHoles } from '../dist/geometry.js';

// A drawing made in mm inside AutoCAD's inch template ($INSUNITS 1) reads 25.4x too big;
// the page offers millimetres (app.js) using these fields.
test('the importer reports the unit it read from the file', () => {
  const text = fs.readFileSync(new URL('../examples/laser-test/laser-test-a2-80-parts.dxf', import.meta.url), 'utf8');
  const mm = parseDXF(text, 'auto'), inch = parseDXF(text.replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n1'), 'auto'), forced = parseDXF(text.replace('$INSUNITS\n70\n4', '$INSUNITS\n70\n1'), '1');
  assert.deepEqual([mm.unitScale, mm.unitFromFile, inch.unitScale, inch.unitFromFile, forced.unitScale, forced.unitFromFile], [1, true, 25.4, true, 1, false]);
  const big = (r) => Math.max(...r.parts.map((p) => Math.max(p.size.w, p.size.h)));
  assert.ok(Math.abs(big(inch) / big(mm) - 25.4) < 1e-6);
  assert.ok(big(inch) > 1000 && big(mm) <= 1000, 'the case the page offers to fix');
});

test('the quick layout packs boxes tightly (MaxRects): 83 % of an A2 by box area on one sheet', () => {
  const sizes = [[193, 209], [193, 209], [93, 149], [58, 58], [28, 24], [28, 24], [28, 24], [28, 24], [28, 24], [28, 24], [40, 58], [93, 93], [89, 77], [56, 49], [53, 46], [184, 174], [122, 191], [55, 42], [116, 86]];
  const parts = sizes.map(([w, h], i) => ({ id: 'r' + i, name: 'R' + i, origin: { x: 0, y: 0 }, size: { x: 0, y: 0, w, h }, entities: [], outer: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }));
  const settings = { width: 594, height: 420, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false };
  const placements = shelfLayout(parts, settings);
  assert.equal(placements.length, 19);
  assert.equal(new Set(placements.map((t) => t.sheet)).size, 1);
  assert.deepEqual(validateLayout(parts, placements, settings), []);
});

test('openings shaped like a C still take parts (the rectangle search tries several centres)', () => {
  const C = [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 90 }, { x: 80, y: 90 }, { x: 80, y: 120 }, { x: 0, y: 120 }];
  const frame = { id: 'frame', name: 'Frame', origin: { x: 0, y: 0 }, size: { x: 0, y: 0, w: 120, h: 160 },
    outer: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 160 }, { x: 0, y: 160 }],
    entities: [{ kind: 'poly', closed: true, layer: '0', vertices: [{ x: 0, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 160 }, { x: 0, y: 160 }] }, { kind: 'poly', closed: true, layer: '0', vertices: C.map((p) => ({ x: p.x + 20, y: p.y + 20 })) }] };
  const square = { id: 'sq', name: 'Square', origin: { x: 0, y: 0 }, size: { x: 0, y: 0, w: 24, h: 24 }, entities: [], outer: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 24 }, { x: 0, y: 24 }] };
  assert.equal(partHoles(frame).length, 1);
  const settings = { width: 300, height: 200, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false, partInPart: true };
  const placements = shelfLayout([frame, square], settings), sq = placements.find((t) => t.id === 'sq');
  assert.ok(sq.x > 20 && sq.x < 70 && sq.y > 20 && sq.y < 140, 'square sits inside the C opening');
  assert.deepEqual(validateLayout([frame, square], placements, settings), []);
});
