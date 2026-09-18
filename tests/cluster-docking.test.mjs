import test from "node:test";
import assert from "node:assert/strict";
import {
  dockConnectedClusters,
  contactComponents,
  moveRigidComponent,
} from "../dist/cluster-docking.js";
import { contactsAtPlacement } from "../dist/common-contact.js";
import { validateLayout, transform } from "../dist/geometry.js";
import { prepareCommonLineExport } from "../dist/common-line-export.js";
const box = (id, w = 20, h = 20) => {
  const outer = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  return {
    id,
    name: id,
    outer,
    origin: { x: 0, y: 0 },
    entities: [{ kind: "poly", closed: true, layer: "CUT", vertices: outer }],
  };
};
const pose = (id, x, y) => ({ id, x, y, angle: 0, sheet: 0, scale: 1 });
const linked = (parts, poses) =>
  poses.map((t) => ({
    ...t,
    sharedEdges: contactsAtPlacement(
      parts.find((p) => p.id === t.id),
      t,
      parts,
      poses,
    ),
  }));
const settings = {
  width: 60,
  height: 60,
  margin: 2,
  gap: 2,
  rotations: 4,
  commonEdgeMode: true,
  multiPartClusteringEnabled: true,
  diagonalCommonEdgesEnabled: true,
  minOffcutSide: 3,
  offcutShapeWeight: 0.35,
};
test("two existing pairs dock along another side, including the central four-part junction", () => {
  const parts = ["a", "b", "c", "d"].map((id) => box(id)),
    ps = linked(parts, [
      pose("a", 5, 5),
      pose("b", 25, 5),
      pose("c", 5, 33),
      pose("d", 25, 33),
    ]);
  assert.deepEqual(validateLayout(parts, ps, settings), []);
  const events = [],
    r = dockConnectedClusters(parts, ps, settings, {
      now: () => 0,
      deadline: Infinity,
      onDebug: (e) => events.push(e),
    });
  assert.ok(r.changed);
  assert.equal(contactComponents(r.placements).length, 1);
  assert.deepEqual(validateLayout(parts, r.placements, settings), []);
  assert.ok(events.some((e) => e.score));
  for (const [a, b] of [
    ["a", "b"],
    ["c", "d"],
  ]) {
    const p = r.placements.find((t) => t.id === a),
      q = r.placements.find((t) => t.id === b);
    assert.ok(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - 20) < 1e-7);
  }
  const exported = prepareCommonLineExport(parts, r.placements, 0).flatMap(
    (p) => p.entities,
  );
  const total = exported.reduce(
    (s, e) =>
      s +
      Math.hypot(
        e.vertices[1].x - e.vertices[0].x,
        e.vertices[1].y - e.vertices[0].y,
      ),
    0,
  );
  assert.ok(
    Math.abs(total - 240) < 1e-6,
    "2x2 square cuts all four shared edges once",
  );
});
test("two three-part components can join beyond the four-part assembly limit", () => {
  const parts = ["a", "b", "c", "d", "e", "f"].map((id) => box(id, 15, 10));
  const ps = linked(
    parts,
    parts.map((p, i) => pose(p.id, 5 + (i % 3) * 15, i < 3 ? 5 : 30)),
  );
  const r = dockConnectedClusters(
    parts,
    ps,
    { ...settings, width: 65, height: 55 },
    { now: () => 0, deadline: Infinity },
  );
  assert.ok(r.changed);
  assert.equal(contactComponents(r.placements)[0].length, 6);
  assert.deepEqual(
    validateLayout(parts, r.placements, { ...settings, width: 65, height: 55 }),
    [],
  );
});
test("unrelated corner touches and undeclared junctions still reject", () => {
  const parts = ["a", "b", "c", "d"].map((id) => box(id)),
    ps = [
      pose("a", 5, 5),
      pose("b", 25, 5),
      pose("c", 5, 25),
      pose("d", 25, 25),
    ];
  assert.ok(validateLayout(parts, ps, settings).length);
  const connected = linked(parts, ps);
  assert.deepEqual(validateLayout(parts, connected, settings), []);
  assert.ok(
    validateLayout(parts, connected, {
      ...settings,
      multiPartClusteringEnabled: false,
    }).length,
  );
  const accidental = [pose("a", 5, 5), pose("b", 25, 25)];
  assert.ok(validateLayout(parts.slice(0, 2), accidental, settings).length);
});
test("rigid component rotation preserves diagonal poses and internal spacing", () => {
  const ps = [
      { ...pose("a", 5, 5), angle: 37, mirrored: true },
      { ...pose("b", 25, 5), angle: 37 },
    ],
    target = { ...ps[0], x: 40, y: 30, angle: 63.5 };
  const moved = moveRigidComponent(ps, ps[0], target);
  assert.ok(Math.abs(moved[0].x - target.x) < 1e-9);
  assert.ok(Math.abs(moved[0].y - target.y) < 1e-9);
  assert.equal(moved[0].mirrored, true);
  const expected = transform({ x: 20, y: 0 }, { x: 0, y: 0, angle: 26.5 });
  assert.ok(Math.abs(moved[1].x - moved[0].x - expected.x) < 1e-7);
  assert.ok(Math.abs(moved[1].y - moved[0].y - expected.y) < 1e-7);
});
test("docking remains bounded and disabled mode does not move anything", () => {
  const parts = ["a", "b", "c", "d"].map((id) => box(id)),
    ps = linked(parts, [
      pose("a", 5, 5),
      pose("b", 25, 5),
      pose("c", 5, 33),
      pose("d", 25, 33),
    ]);
  const timed = dockConnectedClusters(parts, ps, settings, {
    now: () => 10,
    deadline: 5,
  });
  assert.equal(timed.generated, 0);
  const off = dockConnectedClusters(parts, ps, {
    ...settings,
    commonEdgeMode: false,
  });
  assert.deepEqual(off.placements, ps);
  assert.equal(off.generated, 0);
});
