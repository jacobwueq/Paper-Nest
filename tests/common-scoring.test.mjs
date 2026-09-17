import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLayout, improves } from "../dist/search.js";
import { commonEdgeCandidates } from "../dist/common-edge.js";
import { contactFromCandidate } from "../dist/common-contact.js";
import { validateLayout } from "../dist/geometry.js";
const box = (id) => ({
  id,
  name: id,
  outer: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
});
const pose = (id, x, y) => ({ id, x, y, angle: 0, sheet: 0, scale: 1 });
const parts = ["a", "b", "c"].map(box);
const settings = {
  width: 160,
  height: 120,
  margin: 0,
  gap: 2,
  rotations: 1,
  commonEdgeMode: true,
  minOffcutSide: 200,
};
function shared(x = 10, y = 10) {
  const a = pose("a", x, y);
  const c = [
    ...commonEdgeCandidates(parts[1], pose("b", 0, 0), parts[0], a, {
      rotations: 1,
    }),
  ].find(
    (c) =>
      Math.abs(c.placement.x - x) < 1e-6 &&
      Math.abs(c.placement.y - y - 20) < 1e-6,
  );
  return [
    a,
    { ...c.placement, sharedEdges: [contactFromCandidate(c)] },
    pose("c", 90, 90),
  ];
}
const normal = [pose("a", 10, 10), pose("b", 10, 32), pose("c", 90, 90)];
test("common edge wins globally equal material and bounding layout by shorter cutting", () => {
  const a = evaluateLayout(parts, shared(), settings),
    b = evaluateLayout(parts, normal, settings);
  assert.deepEqual(validateLayout(parts, shared(), settings), []);
  assert.deepEqual(a.score.slice(0, 4), b.score.slice(0, 4));
  assert.equal(a.cutting.sharedLength, 20);
  assert.equal(a.cutting.rawCutLength, 240);
  assert.equal(a.cutting.estimatedCutLength, 220);
  assert.equal(a.cutting.pierceCount, null);
  assert.ok(improves(a.score, b.score));
});
test("shorter cut length cannot buy a worse bounding extent, even with huge reward", () => {
  const s = { ...settings, commonEdgeWeight: 1e9 },
    bad = shared(8);
  const a = evaluateLayout(parts, bad, s),
    b = evaluateLayout(parts, normal, s);
  assert.deepEqual(validateLayout(parts, bad, s), []);
  assert.ok(a.cutting.estimatedCutLength < b.cutting.estimatedCutLength);
  assert.ok(a.score[3] > b.score[3]);
  assert.ok(improves(b.score, a.score));
});
test("normal arrangement with a larger primary offcut beats common-edge layout", () => {
  const s = { ...settings, minOffcutSide: 10, commonEdgeWeight: 1e9 };
  const packed = [pose("a", 10, 10), pose("b", 32, 10), pose("c", 54, 10)];
  const common = shared();
  assert.deepEqual(validateLayout(parts, packed, s), []);
  const a = evaluateLayout(parts, common, s),
    b = evaluateLayout(parts, packed, s);
  assert.ok(a.cutting.estimatedCutLength < b.cutting.estimatedCutLength);
  assert.ok(b.score[2][0] > a.score[2][0]);
  assert.ok(improves(b.score, a.score));
});
test("weights are configurable, zero disables cutting tie-break and off mode retains old score", () => {
  const a = evaluateLayout(parts, shared(), settings);
  const weighted = evaluateLayout(parts, shared(), {
    ...settings,
    commonEdgeWeight: 3,
  });
  assert.equal(a.score[4] - weighted.score[4], 40);
  const zero = evaluateLayout(parts, shared(), {
    ...settings,
    commonEdgeWeight: 0,
    cutLengthWeight: 0,
  });
  assert.equal(zero.score[4], 0);
  const legacy = evaluateLayout(parts, normal, {
    ...settings,
    commonEdgeMode: false,
  });
  assert.equal(legacy.score.length, 5);
  assert.equal(legacy.cutting, undefined);
  assert.throws(() =>
    evaluateLayout(parts, normal, { ...settings, commonEdgeWeight: -1 }),
  );
});
test("duplicate declarations do not double count shared length; stale contacts earn no reward", () => {
  const placements = shared();
  placements[1].sharedEdges.push(structuredClone(placements[1].sharedEdges[0]));
  assert.equal(
    evaluateLayout(parts, placements, settings).cutting.sharedLength,
    20,
  );
  placements[1].x += 1;
  assert.equal(
    evaluateLayout(parts, placements, settings).cutting.sharedLength,
    0,
  );
});
test("imported path metrics include details and respect export operation identity", () => {
  const actual = parts.map((p) => ({
    ...p,
    origin: { x: 0, y: 0 },
    entities: [
      {
        kind: "poly",
        closed: true,
        vertices: p.outer,
        layer: "CUT",
        color: "#000000",
      },
      {
        kind: "circle",
        cx: 10,
        cy: 10,
        r: 2,
        layer: "SCORE",
        color: "#ff0000",
      },
    ],
  }));
  const ta = pose("a", 10, 10);
  const c = [
    ...commonEdgeCandidates(actual[1], pose("b", 0, 0), actual[0], ta, {
      rotations: 1,
    }),
  ].find(
    (c) =>
      Math.abs(c.placement.x - 10) < 1e-6 &&
      Math.abs(c.placement.y - 30) < 1e-6,
  );
  const placements = [
    ta,
    { ...c.placement, sharedEdges: [contactFromCandidate(c)] },
    pose("c", 90, 90),
  ];
  const report = evaluateLayout(actual, placements, settings);
  assert.ok(
    Math.abs(report.cutting.rawCutLength - (240 + 12 * Math.PI)) < 1e-8,
  );
  assert.equal(report.cutting.sharedLength, 20);
  actual[1].entities[0].layer = "OTHER_OPERATION";
  assert.equal(
    evaluateLayout(actual, placements, settings).cutting.sharedLength,
    0,
  );
});
