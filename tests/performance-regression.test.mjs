import test from "node:test";
import assert from "node:assert/strict";
import { compactLayout } from "../dist/compaction.js";
import { profiled } from "../dist/nesting-profile.js?v=0.11.0";
import { evaluateLayout } from "../dist/search.js";
import { transformed, sampleParts } from "../dist/geometry.js";
import "../dist/engine/util/offcut.js";
test("memoisation retains identical candidate search result under a deterministic work budget", () => {
  const parts = [
    {
      id: "a",
      outer: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 10 },
        { x: 0, y: 10 },
      ],
    },
    {
      id: "b",
      outer: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 0, y: 10 },
      ],
    },
  ];
  const placements = parts.map((p, i) => ({
    id: p.id,
    x: 2,
    y: 2 + i * 30,
    angle: 0,
    sheet: 0,
    scale: 1,
  }));
  const settings = {
    width: 100,
    height: 100,
    margin: 2,
    gap: 2,
    scale: 1,
    rotations: 4,
    commonEdgeMode: true,
    minOffcutSide: 20,
  };
  const opts = { passes: 1, now: () => 0, profile: true };
  const before = compactLayout(parts, placements, settings, {
    ...opts,
    optimise: false,
  });
  const after = compactLayout(parts, placements, settings, {
    ...opts,
    optimise: true,
  });
  assert.deepEqual(after.placements, before.placements);
  assert.deepEqual(after.report, before.report);
  assert.equal(after.commonEdgeCandidateCount, before.commonEdgeCandidateCount);
  assert.ok(after.profile.counts.transformedGeometryCacheHits > 0);
  assert.ok(
    after.profile.counts.commonCollisionComputations <
      before.profile.counts.commonCollisionComputations,
  );
});
test("scoring memoisation keys include settings, contact metadata and pose; caches end with job", () => {
  const parts = sampleParts().slice(0, 1),
    placements = [
      { id: parts[0].id, x: 2, y: 2, angle: 0, sheet: 0, scale: 1 },
    ];
  const settings = {
    width: 200,
    height: 200,
    margin: 2,
    gap: 2,
    minOffcutSide: 20,
  };
  const r = profiled({ profile: true }, () => {
    evaluateLayout(parts, placements, settings);
    evaluateLayout(parts, placements, settings);
    evaluateLayout(parts, placements, { ...settings, minOffcutSide: 30 });
    return {};
  });
  assert.equal(r.profile.counts.layoutScoringCacheHits, 1);
  assert.equal(r.profile.counts.layoutScoringComputations, 2);
  const fresh = profiled({ profile: true }, () => {
    evaluateLayout(parts, placements, settings);
    return {};
  });
  assert.equal(fresh.profile.counts.layoutScoringComputations, 1);
});
