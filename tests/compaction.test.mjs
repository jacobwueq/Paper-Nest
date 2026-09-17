import test from "node:test";
import assert from "node:assert/strict";
import { compactLayout } from "../dist/compaction.js";
import { evaluateLayout, improves } from "../dist/search.js";
import { validateLayout, transformed, clearance } from "../dist/geometry.js";
import "../dist/engine/util/offcut.js";
const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const t = (id, x, y) => ({
  id,
  x,
  y,
  angle: 0,
  sheet: 0,
  scale: 1,
  mirrored: false,
});
const settings = {
  width: 100,
  height: 100,
  margin: 5,
  gap: 2,
  rotations: 1,
  scale: 1,
  allowMirror: false,
};
test("15% is exclusively a display/export filter and cannot change fitness", () => {
  const polygons = [rect(40, 100)],
    sheet = { x: 0, y: 0, w: 100, h: 100 };
  const a = PaperOffcut.collect(polygons, sheet, 2, 1500);
  const b = PaperOffcut.collect(polygons, sheet, 2, 9000);
  assert.equal(a.rectangles.length, 1);
  assert.equal(b.rectangles.length, 0);
  assert.deepEqual(PaperOffcut.score(0, [a]), PaperOffcut.score(0, [b]));
});
test("compaction closes internal gaps without shrinking the largest offcut", () => {
  const parts = [
    { id: "a", outer: rect(10, 10) },
    { id: "b", outer: rect(10, 10) },
  ];
  const initial = [t("a", 5.03, 5.03), t("b", 5.03, 45)];
  const before = evaluateLayout(parts, initial, settings);
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 1500,
  });
  assert.equal(result.changed, true);
  assert.ok(result.placements[1].y < 18);
  assert.ok(result.report.score[2] <= before.score[2] + 1e-6);
  assert.ok(
    result.report.sheets[0].occupiedArea < before.sheets[0].occupiedArea * 0.5,
  );
  assert.ok(improves(result.report.score, before.score));
  assert.deepEqual(validateLayout(parts, result.placements, settings), []);
  assert.equal(initial[1].y, 45, "caller data must not be mutated");
});
test("optimisation still improves a sheet with no offcut reaching 15%", () => {
  const parts = ["a", "b", "c"].map((id) => ({ id, outer: rect(89.9, 25) }));
  const initial = [t("a", 5.03, 5.03), t("b", 5.03, 35), t("c", 5.03, 65)];
  const before = evaluateLayout(parts, initial, settings);
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 1500,
  });
  assert.equal(before.sheets[0].rectangles.length, 0);
  assert.equal(result.report.sheets[0].rectangles.length, 0);
  assert.ok(
    result.report.sheets[0].rectangle.area >
      before.sheets[0].rectangle.area * 2,
  );
  assert.deepEqual(validateLayout(parts, result.placements, settings), []);
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      assert.ok(
        clearance(
          transformed(parts[i].outer, result.placements[i]),
          transformed(parts[j].outer, result.placements[j]),
          2,
        ),
      );
});
test("compaction keeps scale, groups, sheet identities and the selected angle grid", () => {
  const parts = [
    { id: "a", outer: rect(10, 20) },
    { id: "b", outer: rect(15, 8) },
  ];
  const initial = [
    { ...t("a", 45, 25), scale: 2, angle: 90 },
    { ...t("b", 55, 65), scale: 2, mirrored: true },
  ];
  const s = { ...settings, scale: 2, rotations: 4, allowMirror: true };
  const result = compactLayout(parts, initial, s, { milliseconds: 1500 });
  assert.deepEqual(validateLayout(parts, result.placements, s), []);
  assert.deepEqual(
    result.placements.map((p) => p.id),
    ["a", "b"],
  );
  for (const p of result.placements) {
    assert.equal(p.scale, 2);
    assert.equal(p.sheet, 0);
    assert.equal(p.angle % 90, 0);
  }
});
test("an exhausted time budget retains the original valid arrangement", () => {
  const parts = [{ id: "a", outer: rect(10, 10) }],
    initial = [t("a", 20, 20)];
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 0,
    now: () => 0,
  });
  assert.deepEqual(result.placements, initial);
  assert.equal(result.changed, false);
});
