import test from 'node:test';
import assert from 'node:assert/strict';
import * as vendor from '../dist/engine/util/clipper.js';
import { minkowski, clearNoFitCache } from '../dist/pocket-search.js';
import { sampleParts, transform } from '../dist/geometry.js';

// Roadmap 3.4: no-fit sums are cached by shape, not position, and kept between runs.
// A cached sum moved into place must equal the sum computed in place.
const C = globalThis.ClipperLib || vendor.default, S = 100000;
const path = (p) => p.map((v) => ({ X: Math.round(v.x * S), Y: Math.round(v.y * S) }));
const positive = (p) => (C.Clipper.Orientation(p) ? p : p.slice().reverse());
const norm = (paths) => paths.map((p) => p.map((v) => `${v.X},${v.Y}`).join(' ')).sort();

test('a cached no-fit sum equals the direct sum at every position', () => {
  clearNoFitCache();
  const shapes = sampleParts().map((p) => p.outer);
  let checked = 0;
  for (const [i, j] of [[0, 3], [3, 7], [7, 10], [10, 0], [3, 3]]) for (const angle of [0, 90, 180]) {
    const moving = shapes[i].map((v) => transform(v, { x: 0, y: 0, angle }));
    const negative = positive(path(moving.map((v) => ({ x: -v.x, y: -v.y }))));
    for (const [x, y] of [[5.03, 7.1], [120.5, 33.333], [301.2, 250.75]]) {
      const obstacle = positive(path(shapes[j].map((v) => ({ x: v.x + x, y: v.y + y }))));
      const direct = C.Clipper.MinkowskiSum(negative, positive(obstacle), true);
      assert.deepEqual(norm(minkowski(negative, obstacle)), norm(direct), `${i}/${j} at ${angle}° (${x}, ${y})`);
      checked++;
    }
  }
  assert.equal(checked, 45);
});
