import test from "node:test";
import assert from "node:assert/strict";
import {
  ManualLayout,
  magneticSnap,
  rebuildContacts,
  translateSelection,
  rotateSelection,
  rotationSuggestion,
} from "../dist/manual-layout.js";
import { validateLayout, transform } from "../dist/geometry.js";
import { prepareCommonLineExport } from "../dist/common-line-export.js";
import { compactLayout } from "../dist/compaction.js";
const box = (id, w, h) => {
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
const pose = (id, x, y, angle = 0) => ({ id, x, y, angle, sheet: 0, scale: 1 });
const settings = {
  width: 250,
  height: 200,
  margin: 2,
  gap: 2,
  rotations: 4,
  commonEdgeMode: true,
  multiPartClusteringEnabled: true,
  diagonalCommonEdgesEnabled: true,
  minOffcutSide: 10,
};
const parts = [box("a", 100, 20), box("b", 40, 10)],
  poses = [pose("a", 10, 10), pose("b", 40, 35)];
test("B/C/L: manual movement, rotation and history keep authoritative poses", () => {
  const m = new ManualLayout(parts, poses, settings);
  assert.ok(m.commit(translateSelection(m.placements, ["b"], 10, 20)).valid);
  assert.equal(m.placements[1].x, 50);
  const before = structuredClone(m.placements);
  assert.ok(m.commit(rotateSelection(parts, m.placements, ["b"], 37)).valid);
  assert.equal(m.placements[1].angle, 37);
  m.undo();
  assert.deepEqual(m.placements, before);
  m.redo();
  assert.equal(m.placements[1].angle, 37);
});
test("D/F/G: 100/40 partial magnetic sharing preserves tangential sliding", () => {
  for (const x of [20, 40, 65]) {
    const p = [poses[0], pose("b", x, 33)],
      snap = magneticSnap(parts, p, ["b"], settings, 4);
    assert.ok(snap?.valid);
    assert.equal(snap.sharedLength, 40);
    assert.equal(snap.placements[1].x, x);
    assert.ok(Math.abs(snap.placements[1].y - 30) < 1e-7);
    assert.deepEqual(validateLayout(parts, snap.placements, settings), []);
  }
});
test("E: diagonal projection shares the same exact geometry", () => {
  const p = [pose("a", 10, 10), pose("b", 40, 32)].map((t) => ({
    ...t,
    ...transform(t, { x: 70, y: 40, angle: 37 }),
    angle: 37,
  }));
  const snap = magneticSnap(parts, p, ["b"], settings, 4);
  assert.ok(snap?.valid);
  assert.ok(Math.abs(snap.sharedLength - 40) < 1e-6);
  assert.equal(snap.placements[1].angle, 37);
});
test("H: collision and sheet violations cannot commit a snap", () => {
  const p = [...parts, box("c", 15, 15)],
    ps = [poses[0], pose("b", 40, 33), pose("c", 50, 32)];
  const snap = magneticSnap(p, ps, ["b"], settings, 4);
  assert.ok(!snap?.valid);
  const m = new ManualLayout(parts, poses, settings);
  assert.equal(
    m.commit(translateSelection(poses, ["b"], -100, 0)).valid,
    false,
  );
  assert.deepEqual(m.placements, poses);
  assert.equal(m.past.length, 0);
});
test("I/J/L: logical groups move together, detach and undo restores membership", () => {
  const p = [box("a", 20, 10), box("b", 20, 10), box("c", 20, 10)],
    ps = rebuildContacts(
      p,
      [pose("a", 10, 10), pose("b", 30, 10), pose("c", 50, 10)],
      settings,
    ),
    m = new ManualLayout(p, ps, settings);
  assert.equal(m.selection("a", true).length, 3);
  m.group(["a", "b", "c"]);
  assert.ok(
    m.commit(translateSelection(m.placements, m.selection("a", true), 5, 30))
      .valid,
  );
  assert.equal(m.placements[2].x, 55);
  m.ungroup(["c"]);
  assert.deepEqual(m.data.groups, [["a", "b"]]);
  m.undo();
  assert.deepEqual(m.data.groups, [["a", "b", "c"]]);
  m.redo();
  assert.deepEqual(m.data.groups, [["a", "b"]]);
});
test("K: manual 40 mm overlap cuts once and preserves longer edge tails", () => {
  const snap = magneticSnap(
      parts,
      [poses[0], pose("b", 40, 33)],
      ["b"],
      settings,
      4,
    ),
    m = new ManualLayout(parts, poses, settings);
  assert.ok(m.commit(snap.placements).valid);
  const lines = prepareCommonLineExport(parts, m.placements, 0).flatMap(
    (p) => p.entities,
  );
  const length = lines.reduce(
    (s, e) =>
      s +
      Math.hypot(
        e.vertices[1].x - e.vertices[0].x,
        e.vertices[1].y - e.vertices[0].y,
      ),
    0,
  );
  assert.ok(Math.abs(length - (240 + 100 - 40)) < 1e-6);
  assert.ok(m.commit(translateSelection(m.placements, ["b"], 0, 20)).valid);
  assert.equal(m.placements[1].sharedEdges.length, 0);
});
test("M: locked geometry survives refinement and manual movement is rejected", () => {
  const p = [box("a", 20, 10), box("b", 20, 10)],
    ps = [pose("a", 30, 30), pose("b", 70, 60)],
    m = new ManualLayout(p, ps, settings);
  m.lock(["a"], true);
  assert.equal(
    m.commit(translateSelection(m.placements, ["a"], 1, 0)).valid,
    false,
  );
  const r = compactLayout(
    p,
    ps,
    { ...settings, ...m.validationSettings() },
    { milliseconds: 300, passes: 1 },
  );
  for (const k of ["x", "y", "angle", "sheet"])
    assert.equal(r.placements[0][k], ps[0][k]);
  m.undo();
  assert.deepEqual(m.data.locks, []);
  m.redo();
  assert.deepEqual(m.data.locks, ["a"]);
});
test("rotation suggestion is explicit and does not mutate the current layout", () => {
  const before = structuredClone(poses);
  rotationSuggestion(parts, poses, ["b"], settings, 100);
  assert.deepEqual(poses, before);
});

test("D: full-length magnetic sharing", () => {
  const p = [box("a", 40, 10), box("b", 40, 10)];
  const snap = magneticSnap(
    p,
    [pose("a", 10, 10), pose("b", 10, 22)],
    ["b"],
    settings,
    3,
  );
  assert.ok(snap?.valid);
  assert.equal(snap.sharedLength, 40);
});
test("M: refinement respects locks with common-edge mode disabled", () => {
  const p = [box("a", 20, 10), box("b", 20, 10)],
    ps = [pose("a", 30, 30), pose("b", 70, 60)];
  const r = compactLayout(
    p,
    ps,
    { ...settings, commonEdgeMode: false, lockedPlacements: [ps[0]] },
    { milliseconds: 300, passes: 1 },
  );
  for (const k of ["x", "y", "angle", "sheet"])
    assert.equal(r.placements[0][k], ps[0][k]);
});
