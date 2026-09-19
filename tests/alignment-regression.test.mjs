import test from "node:test";
import assert from "node:assert/strict";
import { sampleParts, validateLayout, transform } from "../dist/geometry.js";
import { rebuildContacts, magneticSnap } from "../dist/manual-layout.js";
import { alignNearby } from "../dist/auto-align.js";
import { evaluateLayout, improves } from "../dist/search.js";
const s = {
  width: 420,
  height: 297,
  margin: 5,
  gap: 2,
  rotations: 360,
  commonEdgeMode: true,
  multiPartClusteringEnabled: true,
  diagonalCommonEdgesEnabled: true,
  minOffcutSide: 20,
  offcutShapeWeight: 0.35,
};
const pose = (id, x, y, angle = 0) => ({ id, x, y, angle, sheet: 0, scale: 1 });
test("screenshot arches share full 60 mm base despite repeated source vertices", () => {
  const p = sampleParts().slice(7, 9);
  for (const angle of [0, 37, 90]) {
    const ps = [pose(p[0].id, 0, 0), pose(p[1].id, 60, 110, 180)].map((t) => ({
      ...t,
      ...transform(t, { x: 140, y: 30, angle }),
      angle: t.angle + angle,
    }));
    const r = rebuildContacts(p, ps, s);
    assert.deepEqual(validateLayout(p, r, s), []);
    assert.ok(
      Math.abs(evaluateLayout(p, r, s).cutting.sharedLength - 60) < 1e-6,
    );
  }
  const r = magneticSnap(
    p,
    [pose(p[0].id, 100, 10), pose(p[1].id, 161, 120, 180)],
    [p[1].id],
    s,
    3,
  );
  assert.ok(r.valid);
  assert.equal(r.sharedLength, 60);
  assert.equal(r.placements[1].x, 160);
});
test("automatic pass closes obvious aligned panel gaps without manual input", () => {
  const p = sampleParts().slice(0, 3),
    ps = [
      pose(p[0].id, 5, 5),
      pose(p[1].id, 5, 107.05),
      pose(p[2].id, 99.05, 5),
    ];
  assert.deepEqual(validateLayout(p, ps, s), []);
  const r = alignNearby(p, ps, s, { deadline: Infinity });
  assert.ok(r.changed);
  assert.deepEqual(validateLayout(p, r.placements, s), []);
  assert.ok(r.report.cutting.sharedLength >= 180);
  assert.ok(improves(r.report.score, evaluateLayout(p, ps, s).score));
});
test("automatic alignment preserves locks and disabled mode", () => {
  const p = sampleParts().slice(0, 2),
    ps = [pose(p[0].id, 5, 5), pose(p[1].id, 5, 107.05)];
  const r = alignNearby(
    p,
    ps,
    { ...s, lockedPlacements: ps },
    { deadline: Infinity },
  );
  assert.deepEqual(r.placements, ps);
  assert.equal(r.changed, false);
  const off = alignNearby(
    p,
    ps,
    { ...s, commonEdgeMode: false },
    { deadline: Infinity },
  );
  assert.deepEqual(off.placements, ps);
});
