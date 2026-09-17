import test from "node:test";
import assert from "node:assert/strict";
import { extractPartEdges, commonEdgeCandidates } from "../dist/common-edge.js";
import {
  commonContactClearance,
  contactFromCandidate,
  replacePlacement,
} from "../dist/common-contact.js";
import { validateLayout, clearance, transformed } from "../dist/geometry.js";
import { compactLayout } from "../dist/compaction.js";
const polygon = (id, points) => ({
  id,
  name: id,
  outer: points.map(([x, y]) => ({ x, y })),
});
const box = (id, w = 40, h = 20) =>
  polygon(id, [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ]);
const pose = (id, x = 0, y = 0) => ({
  id,
  x,
  y,
  angle: 0,
  sheet: 0,
  scale: 1,
  mirrored: false,
});
const settings = {
  width: 200,
  height: 200,
  margin: 0,
  gap: 2,
  scale: 1,
  rotations: 4,
  allowMirror: false,
  minOffcutSide: 20,
  commonEdgeMode: true,
};
function fixture(w = 40) {
  const a = box("a", 100),
    b = box("b", w),
    ta = pose("a", 10, 30);
  const c = [
    ...commonEdgeCandidates(b, pose("b"), a, ta, { rotations: 1 }),
  ].find(
    (c) =>
      c.fixedEdge.edgeIndex === 0 &&
      c.movingEdge.edgeIndex === 2 &&
      c.placement.x === 10,
  );
  assert.ok(c);
  const tb = { ...c.placement, sharedEdges: [contactFromCandidate(c)] };
  return { a, b, ta, tb };
}
function claim(a, ai, b, bi, start, end) {
  const ref = (e) => ({
    contourId: e.contourId,
    edgeIndex: e.edgeIndex,
    entityIndex: e.entityIndex,
    sourceSegmentIndex: e.sourceSegmentIndex,
  });
  return {
    otherPartId: b.id,
    ownEdge: ref(extractPartEdges(a)[ai]),
    otherEdge: ref(extractPartEdges(b)[bi]),
    ownSection: [start, end],
    otherSection: [start, end],
  };
}
test("explicit full and 100/40 partial shared boundaries allow zero clearance", () => {
  for (const w of [100, 40]) {
    const { a, b, ta, tb } = fixture(w);
    assert.equal(commonContactClearance(a, ta, b, tb, 2).valid, true);
    assert.deepEqual(validateLayout([a, b], [ta, tb], settings), []);
    assert.equal(
      clearance(transformed(a.outer, ta), transformed(b.outer, tb), 2),
      false,
    );
  }
});
test("unrelated boundary on the SAME pair still needs normal spacing", () => {
  const a = box("a", 100);
  // Bottom edge shares A's top. The returning arm stops 1 mm from A's right.
  const b = polygon("b", [
    [0, 0],
    [0, -10],
    [110, -10],
    [110, 10],
    [101, 10],
    [101, -5],
    [40, -5],
    [40, 0],
  ]);
  const ta = pose("a"),
    tb = pose("b");
  tb.sharedEdges = [claim(b, 7, a, 0, { x: 0, y: 0 }, { x: 40, y: 0 })];
  assert.equal(commonContactClearance(a, ta, b, tb, 0.5).valid, true);
  assert.equal(commonContactClearance(a, ta, b, tb, 2).reason, "clearance");
});
test("a third part receives no shared-pair clearance exemption", () => {
  const { a, b, ta, tb } = fixture();
  const c = box("c", 10, 10),
    tc = pose("c", 51, 10);
  assert.ok(
    validateLayout([a, b, c], [ta, tb, tc], settings).some((e) =>
      e.includes("clearance"),
    ),
  );
});
test("valid shared section cannot hide polygon interior overlap elsewhere", () => {
  const a = box("a", 100);
  const b = polygon("b", [
    [0, 0],
    [0, -10],
    [110, -10],
    [110, 10],
    [99, 10],
    [99, -5],
    [40, -5],
    [40, 0],
  ]);
  const tb = pose("b");
  tb.sharedEdges = [claim(b, 7, a, 0, { x: 0, y: 0 }, { x: 40, y: 0 })];
  assert.equal(
    commonContactClearance(a, pose("a"), b, tb, 2).reason,
    "interior-overlap",
  );
});
test("accidental touching elsewhere on a declared pair is rejected, including gap zero", () => {
  const a = box("a", 100);
  const b = polygon("b", [
    [0, 0],
    [0, -10],
    [110, -10],
    [110, 10],
    [100, 10],
    [100, -5],
    [40, -5],
    [40, 0],
  ]);
  const tb = pose("b");
  tb.sharedEdges = [claim(b, 7, a, 0, { x: 0, y: 0 }, { x: 40, y: 0 })];
  for (const gap of [0, 2])
    assert.equal(
      commonContactClearance(a, pose("a"), b, tb, gap).reason,
      "unapproved-touch",
    );
});
test("only the declared interval is authorised, not the entire collinear edge", () => {
  const { a, b, ta, tb } = fixture();
  tb.sharedEdges[0].ownSection[1].x -= 10;
  tb.sharedEdges[0].otherSection[1].x -= 10;
  assert.equal(
    commonContactClearance(a, ta, b, tb, 2).reason,
    "unapproved-touch",
  );
});
test("no declaration rejects touching; containment and coincident interiors reject", () => {
  const { a, b, ta, tb } = fixture();
  delete tb.sharedEdges;
  assert.equal(
    commonContactClearance(a, ta, b, tb, 0).reason,
    "unapproved-touch",
  );
  for (const tc of [pose("b", 10, 30), pose("b", 20, 32)]) {
    const small = box("b", 10, 10);
    assert.equal(
      commonContactClearance(a, ta, small, tc, 0).reason,
      "interior-overlap",
    );
  }
});
test("stale, unknown and cross-sheet declarations are rejected", () => {
  const { a, b, ta, tb } = fixture();
  assert.equal(
    commonContactClearance(a, ta, b, { ...tb, x: tb.x + 1 }, 2).reason,
    "invalid-shared-section",
  );
  const unknown = structuredClone(tb);
  unknown.sharedEdges[0].ownEdge.edgeIndex = 999;
  assert.equal(
    commonContactClearance(a, ta, b, unknown, 2).reason,
    "unknown-shared-edge",
  );
  assert.ok(validateLayout([a, b], [ta, { ...tb, sheet: 1 }], settings).length);
  const absent = structuredClone(tb);
  absent.sharedEdges[0].otherPartId = "missing";
  assert.ok(validateLayout([a, b], [ta, absent], settings).length);
});
test("transformed candidates validate at arbitrary angles, scales and mirroring", () => {
  for (const mirrored of [false, true]) {
    const a = box("a", 100),
      b = box("b");
    const cs = [
      ...commonEdgeCandidates(
        b,
        { ...pose("b"), scale: 1.5, mirrored },
        a,
        { ...pose("a", 100, 100), angle: 37 },
        { rotations: 360 },
      ),
    ];
    assert.ok(cs.length);
    for (const c of cs)
      assert.equal(
        commonContactClearance(
          a,
          c.fixedPlacement,
          b,
          { ...c.placement, sharedEdges: [contactFromCandidate(c)] },
          2,
        ).valid,
        true,
      );
  }
});
test("subdividing an incident straight boundary does not change clearance", () => {
  const { a, b, ta, tb } = fixture();
  // These vertices are on the left boundary after the bottom-left point.
  b.outer = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 20 },
    { x: 0, y: 20 },
    { x: 0, y: 19 },
    { x: 0, y: 18 },
  ];
  assert.equal(commonContactClearance(a, ta, b, tb, 2).valid, true);
});
test("disabled mode ignores contact metadata and exactly retains legacy validation", () => {
  const { a, b, ta, tb } = fixture();
  for (const x of [10, 20, 112, 113])
    for (const gap of [0, 2]) {
      const t = { ...tb, x };
      const plain = { ...t };
      delete plain.sharedEdges;
      const legacy = validateLayout([a, b], [ta, plain], {
        ...settings,
        gap,
        commonEdgeMode: undefined,
      });
      assert.deepEqual(
        validateLayout([a, b], [ta, t], {
          ...settings,
          gap,
          commonEdgeMode: false,
        }),
        legacy,
      );
      assert.equal(
        legacy.length === 0,
        clearance(transformed(a.outer, ta), transformed(b.outer, t), gap),
      );
    }
});
test("moving a part invalidates both outgoing and incoming old claims", () => {
  const { ta, tb } = fixture();
  const moved = replacePlacement([ta, tb], { ...ta, x: 12 });
  assert.ok(moved.every((t) => !t.sharedEdges));
  assert.ok(tb.sharedEdges); // caller's layout was not mutated
});
test("enabled compaction accepts and retains validated shared-edge candidates", () => {
  const parts = [box("a", 30, 10), box("b", 20, 10)];
  const initial = [pose("a", 2, 2), pose("b", 2, 35)];
  const result = compactLayout(
    parts,
    initial,
    { ...settings, width: 100, height: 100, margin: 2 },
    {
      milliseconds: 1500,
      passes: 1,
    },
  );
  assert.ok(result.commonEdgeCandidateCount > 0);
  assert.deepEqual(
    validateLayout(parts, result.placements, {
      ...settings,
      width: 100,
      height: 100,
      margin: 2,
    }),
    [],
  );
  assert.ok(result.placements.some((t) => t.sharedEdges?.length));
});
