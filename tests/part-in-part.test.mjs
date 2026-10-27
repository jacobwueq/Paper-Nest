import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactLayout, fixedWorkClock } from '../dist/compaction.js';
import { sampleParts, validateLayout, partHoles, insideHole, bounds, transformed } from '../dist/geometry.js';

// Roadmap 3.3: small parts may sit inside another part's opening (opt-in).
const walls = sampleParts().filter((p) => p.name.startsWith('Wall'));
const square = (id, w, h) => ({ id, name: id, origin: { x: 0, y: 0 }, size: { x: 0, y: 0, w, h }, group: 'test', outer: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }], entities: [{ kind: 'poly', closed: true, layer: 'CUT', vertices: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }] });
const t = (id, x, y) => ({ id, x, y, angle: 0, scale: 1, sheet: 0 });

test('the sample walls have one opening each; score lines and the outline are not holes', () => {
  for (const w of walls) {
    const holes = partHoles(w);
    assert.equal(holes.length, 1);
    assert.deepEqual(bounds(holes[0]), { x: 32, y: 37, w: 28, h: 53 });
  }
  assert.equal(partHoles(square('s', 20, 40)).length, 0);
});

test('a part inside an opening is valid only with part-in-part on, and only with the gap kept', () => {
  const tab = square('tab', 20, 40), parts = [walls[0], tab];
  const settings = { width: 200, height: 200, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false };
  const inside = [t(walls[0].id, 5, 5), t('tab', 5 + 36, 5 + 43)];
  assert.notDeepEqual(validateLayout(parts, inside, settings), []);
  assert.deepEqual(validateLayout(parts, inside, { ...settings, partInPart: true }), []);
  const tight = [t(walls[0].id, 5, 5), t('tab', 5 + 32.5, 5 + 43)]; // 0.5 mm from the opening edge
  assert.notDeepEqual(validateLayout(parts, tight, { ...settings, partInPart: true }), []);
  assert.equal(insideHole(transformed(partHoles(walls[0])[0], inside[0]), transformed(tab.outer, inside[1]), 2), true);
});

test('compaction moves small parts into the wall openings and saves height', () => {
  const tabs = [0, 1, 2].map((i) => square('tab-' + i, 20, 40)), parts = [...walls, ...tabs];
  const settings = { width: 300, height: 160, margin: 5, gap: 2, rotations: 4, scale: 1, allowMirror: false, minOffcutSide: 10 };
  const start = [...walls.map((w, i) => t(w.id, 5 + i * 95, 5)), ...tabs.map((p, i) => t(p.id, 5 + i * 25, 110))];
  const height = (r) => Math.max(...r.placements.map((q) => { const b = bounds(transformed(parts.find((p) => p.id === q.id).outer, q)); return b.y + b.h; }));
  const off = compactLayout(parts, start, settings, { milliseconds: 400, passes: 3, now: fixedWorkClock(0.05) });
  const on = compactLayout(parts, start, { ...settings, partInPart: true }, { milliseconds: 400, passes: 3, now: fixedWorkClock(0.05) });
  assert.deepEqual(validateLayout(parts, on.placements, { ...settings, partInPart: true }), []);
  assert.ok(height(on) <= 105.01, `all tabs inside the walls' band: ${height(on)}`);
  assert.ok(height(off) > 130);
});

test('the laser page offers the option and sends holes to the worker', () => {
  const html = fs.readFileSync(new URL('../dist/laser.html', import.meta.url), 'utf8'), app = fs.readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="part-in-part" type="checkbox"/);
  assert.match(app, /partInPart: \$\("part-in-part"\)\.checked/);
  assert.match(app, /holes: partHoles\(p\)/);
});
