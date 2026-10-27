import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDXF } from '../dist/importers.js';
import { shelfLayout } from '../dist/quick-layout.js';
import { validateLayout, partHoles, insideHole, transformed } from '../dist/geometry.js';

// examples/laser-test: 80 irregular parts (the importer's limit) for A2, with openings.
const parts = parseDXF(fs.readFileSync(new URL('../examples/laser-test/laser-test-a2-80-parts.dxf', import.meta.url), 'utf8'), 'auto').parts;
const a2 = { width: 594, height: 420, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false };

test('the stress drawing imports as 80 parts; 20 have openings, score lines are not holes', () => {
  assert.equal(parts.length, 80);
  assert.equal(parts.filter((p) => partHoles(p).length).length, 20);
  assert.ok(parts.every((p) => p.review && !p.review.envelope && p.review.inside === 0));
});

test('the quick layout places all 80 parts validly at once, with and without part-in-part', () => {
  for (const partInPart of [false, true]) {
    const settings = { ...a2, partInPart }, t0 = performance.now();
    const placements = shelfLayout(parts, settings);
    assert.ok(performance.now() - t0 < 1000);
    assert.equal(placements.length, 80);
    assert.deepEqual(validateLayout(parts, placements, settings), []);
  }
});

test('with part-in-part the quick layout already puts parts inside openings', () => {
  const settings = { ...a2, partInPart: true }, placements = shelfLayout(parts, settings), byId = new Map(parts.map((p) => [p.id, p]));
  const inside = placements.filter((t) => placements.some((h) => h !== t && h.sheet === t.sheet &&
    partHoles(byId.get(h.id)).some((hole) => insideHole(transformed(hole, h), transformed(byId.get(t.id).outer, t), 2))));
  assert.ok(inside.length >= 20, `${inside.length} parts inside openings`);
  assert.notDeepEqual(validateLayout(parts, placements, a2), [], 'and that is only valid with part-in-part on');
});
