import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shelfLayout } from '../dist/quick-layout.js';
import { compactLayout } from '../dist/compaction.js';
import { validateLayout, partHoles, nestedCount } from '../dist/geometry.js';

// An arrow-shaped opening like the ones in the user's nesting2.dxf: no single
// rectangle covers both the head and the shaft, so only a true-shape fill uses both.
const arrow = [{ x: 0, y: 0 }, { x: 110, y: 30 }, { x: 60, y: 80 }, { x: 110, y: 120 }, { x: 0, y: 120 }];
const loop = (pts, dx = 0, dy = 0) => ({ kind: 'poly', closed: true, layer: '0', vertices: pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const host = { id: 'host', name: 'Host', origin: { x: 0, y: 0 }, size: { x: 0, y: 0, w: 160, h: 170 }, outer: rect(160, 170), entities: [loop(rect(160, 170)), loop(arrow, 20, 20)] };
const part = (id, outer) => ({ id, name: id, origin: { x: 0, y: 0 }, size: { x: 0, y: 0, w: 1, h: 1 }, entities: [], outer });
const guests = [part('tri', [{ x: 0, y: 0 }, { x: 40, y: 12 }, { x: 0, y: 40 }]), part('sq1', rect(28, 24)), part('sq2', rect(28, 24))];
const settings = { width: 420, height: 297, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false, partInPart: true, minOffcutSide: 20, offcutShapeWeight: 0 };

test('parts are placed inside a concave opening by their real outlines', () => {
  const parts = [host, ...guests];
  assert.equal(partHoles(host).length, 1);
  const placements = shelfLayout(parts, settings);
  assert.deepEqual(validateLayout(parts, placements, settings), []);
  assert.ok(nestedCount(parts, placements, settings) >= 2, 'at least two parts sit in the opening');
  assert.equal(nestedCount(parts, placements, { ...settings, partInPart: false }), 0);
});

test('compaction leaves parts that sit in an opening where they are', () => {
  const parts = [host, ...guests];
  const placements = shelfLayout(parts, settings), before = nestedCount(parts, placements, settings);
  const wp = parts.map((p) => ({ ...p, holes: partHoles(p) }));
  const result = compactLayout(wp, placements, settings, { milliseconds: 400 });
  assert.equal(nestedCount(parts, result.placements || placements, settings), before);
});

test('part-in-part is on by default and openings are drawn as holes', () => {
  const html = fs.readFileSync(new URL('../dist/laser.html', import.meta.url), 'utf8');
  assert.match(html, /id="part-in-part" type="checkbox" checked/);
  const app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /<path class="part-hit" fill-rule="evenodd" d="\$\{partArea\(p\)\}"\/>/);
  assert.match(app, /nestedCount\(state\.parts, placements, runSettings\) < nestedCount/);
});

test('a part inside an opening is valid with common-line cutting on (the user\'s manual drag)', () => {
  const parts = [host, guests[1]];
  const placements = [{ id: 'host', x: 10, y: 10, angle: 0, sheet: 0 }, { id: 'sq1', x: 40, y: 80, angle: 0, sheet: 0 }];
  const common = { ...settings, commonEdgeMode: true };
  assert.deepEqual(validateLayout(parts, placements, common), []);
  assert.notDeepEqual(validateLayout(parts, placements, { ...common, partInPart: false }), []);
  // The quick layout is no longer rejected in common-line mode.
  const quick = shelfLayout([host, ...guests], common);
  assert.deepEqual(validateLayout([host, ...guests], quick, common), []);
  assert.ok(nestedCount([host, ...guests], quick, common) >= 2);
});
