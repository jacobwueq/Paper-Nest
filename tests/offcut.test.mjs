import test from "node:test";
import assert from "node:assert/strict";
import "../dist/engine/util/offcut.js";
import { clearance, transform } from "../dist/geometry.js";
const { analyse, score, compare } = globalThis.PaperOffcut;
const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
const sheet = { x: 0, y: 0, w: 100, h: 100 };
function check(polygons, padding = 0) {
  const result = analyse(polygons, sheet, padding),
    r = result.rectangle;
  assert.ok(
    r.x >= -1e-6 &&
      r.y >= -1e-6 &&
      r.x + r.w <= 100 + 1e-6 &&
      r.y + r.h <= 100 + 1e-6,
  );
  if (r.area > 0)
    for (const p of polygons)
      assert.ok(
        clearance(rect(r.x, r.y, r.w, r.h), p, Math.max(0, padding - 1e-6)),
        JSON.stringify(r),
      );
  return r;
}
test("compact edge strip is measured exactly with reserved clearance", () => {
  const r = check([rect(0, 0, 40, 100)], 2);
  assert.deepEqual(r, { x: 42, y: 0, w: 58, h: 100, area: 5800 });
});
test("interior reusable space is found even when the overall bounds fill the sheet", () => {
  const r = check(
    [
      rect(0, 0, 20, 20),
      rect(80, 0, 20, 20),
      rect(0, 80, 20, 20),
      rect(80, 80, 20, 20),
    ],
    1,
  );
  assert.ok(r.area > 5600);
  assert.ok(r.area <= 5800);
});
test("narrow diagonal geometry cannot disappear between grid samples", () => {
  for (let angle = 1; angle < 180; angle += 13) {
    const p = rect(0, 0, 42, 0.05).map((p) =>
      transform(p, { x: 50, y: 25, angle }),
    );
    check([p], 0.2);
  }
});
test("concave outlines are conservatively excluded from the offcut", () => {
  const l = [
    { x: 0, y: 0 },
    { x: 60, y: 0 },
    { x: 60, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 80 },
    { x: 0, y: 80 },
  ];
  const r = check([l], 1);
  assert.ok(r.area > 6000);
});
test("one large reusable piece outranks fragmented offcuts of equal total area", () => {
  const reports = (areas) =>
    areas.map((area) => ({ rectangle: { area }, occupiedArea: 1 }));
  assert.ok(
    compare(score(0, reports([800, 200])), score(0, reports([500, 500]))) < 0,
  );
  assert.ok(
    compare(score(0, reports([100])), score(0, reports([800, 200]))) < 0,
  );
  assert.ok(compare(score(0, reports([100])), score(1, reports([9000]))) < 0);
});
test("a completely occupied sheet has no reusable rectangle", () => {
  assert.equal(analyse([rect(0, 0, 100, 100)], sheet, 1).rectangle.area, 0);
});
