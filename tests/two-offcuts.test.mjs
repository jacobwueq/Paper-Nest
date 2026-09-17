import test from "node:test";
import assert from "node:assert/strict";
import "../dist/engine/util/offcut.js";
import { clearance } from "../dist/geometry.js";
import { checkedOffcuts, rectanglePoints } from "../dist/offcut-export.js";
const { collect, analyse, score, compare } = globalThis.PaperOffcut;
const rect = (x, y, w, h) => rectanglePoints({ x, y, w, h });
const sheet = { x: 0, y: 0, w: 100, h: 100 };
test("a smaller primary rectangle wins when two rectangles recover more material", () => {
  const r = (a, b) => [
    { rectangle: { area: a }, recoveredArea: a + b, occupiedArea: 1 },
  ];
  assert.ok(compare(score(0, r(5500, 2500)), score(0, r(6000, 1000))) < 0);
  assert.ok(compare(score(0, r(6000, 2000)), score(0, r(5500, 2500))) < 0);
});
test("joint split search beats fixing the largest rectangle first, in both axes", () => {
  for (const transpose of [false, true]) {
    const polygons = [rect(35, 40, 30, 60)].map((p) =>
      p.map((v) => (transpose ? { x: v.y, y: v.x } : v)),
    );
    const first = analyse(polygons, sheet, 1, 20).rectangle;
    const second = analyse(
      [...polygons, rectanglePoints(first)],
      sheet,
      1,
      20,
    ).rectangle;
    const result = collect(polygons, sheet, 1, 20);
    assert.equal(result.rectangles.length, 2);
    assert.ok(result.recoveredArea > 6500);
    assert.ok(result.recoveredArea > first.area + second.area + 500);
    assert.ok(result.rectangle.area < first.area);
    assert.ok(
      clearance(
        rectanglePoints(result.rectangles[0]),
        rectanglePoints(result.rectangles[1]),
        1,
      ),
    );
    for (const r of result.rectangles)
      for (const p of polygons) assert.ok(clearance(rectanglePoints(r), p, 1));
  }
});
test("a useful offcut below 15 percent can be exported; narrow strips follow the chosen dimension", () => {
  const settings = {
    width: 200,
    height: 200,
    margin: 5,
    gap: 2,
    minOffcutSide: 20,
  };
  assert.equal(
    checkedOffcuts([], [], 0, settings, {
      offcuts: [{ x: 10, y: 10, w: 20, h: 30 }],
    }).length,
    1,
  );
  assert.throws(
    () =>
      checkedOffcuts([], [], 0, settings, {
        offcuts: [{ x: 10, y: 10, w: 19, h: 100 }],
      }),
    /dimensions/,
  );
  assert.equal(
    checkedOffcuts(
      [],
      [],
      0,
      { ...settings, minOffcutSide: 0 },
      { offcuts: [{ x: 10, y: 10, w: 19, h: 100 }] },
    ).length,
    1,
  );
  assert.equal(
    collect([rect(0, 0, 85, 100)], sheet, 1, 20).rectangles.length,
    0,
  );
  assert.ok(collect([rect(0, 0, 85, 100)], sheet, 1, 0).recoveredArea > 0);
});
