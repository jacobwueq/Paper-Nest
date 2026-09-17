import test from "node:test";
import assert from "node:assert/strict";
import "../dist/engine/util/offcut.js";
import { clearance } from "../dist/geometry.js";
import { checkedOffcuts, rectanglePoints } from "../dist/offcut-export.js";
const { collect, analyse, score, compare } = globalThis.PaperOffcut;
const rect = (x, y, w, h) => rectanglePoints({ x, y, w, h });
const sheet = { x: 0, y: 0, w: 100, h: 100 };
test("largest-first ranking never trades the primary for more total material", () => {
  const r = (...areas) => [
    { rectangles: areas.map((area) => ({ area })), occupiedArea: 1 },
  ];
  assert.ok(
    compare(score(0, r(6000, 1000)), score(0, r(5500, 2500, 2000))) < 0,
  );
  assert.ok(
    compare(score(0, r(6000, 2000, 500)), score(0, r(6000, 1800, 1000))) < 0,
  );
  assert.ok(
    compare(score(0, r(6000, 2000, 600)), score(0, r(6000, 2000, 500))) < 0,
  );
  assert.ok(
    compare(score(0, r(6000, 2000, 500, 100)), score(0, r(6000, 2000, 500))) <
      0,
  );
});
test("extract a third rectangle while preserving the largest first, in both axes", () => {
  for (const transpose of [false, true]) {
    const polygons = [rect(35, 40, 30, 60)].map((p) =>
      p.map((v) => (transpose ? { x: v.y, y: v.x } : v)),
    );
    const first = analyse(polygons, sheet, 1, 20).rectangle;
    const result = collect(polygons, sheet, 1, 20);
    assert.equal(result.rectangle.area, first.area);
    assert.equal(result.rectangles.length, 3);
    for (let i = 0; i < result.rectangles.length; i++) {
      const r = result.rectangles[i];
      for (const p of polygons) assert.ok(clearance(rectanglePoints(r), p, 1));
      for (const s of result.rectangles.slice(i + 1))
        assert.ok(clearance(rectanglePoints(r), rectanglePoints(s), 1));
    }
    const blocked = [...polygons, ...result.rectangles.map(rectanglePoints)];
    assert.equal(analyse(blocked, sheet, 1, 20).rectangle.area, 0);
  }
});
test("equally large first rectangles are chosen by their following offcuts", () => {
  for (const transpose of [false, true]) {
    const polygons = [
      rect(30, 40, 20, 10),
      rect(30, 10, 20, 10),
      rect(0, 0, 10, 10),
      rect(50, 50, 10, 10),
    ].map((p) => p.map((v) => (transpose ? { x: v.y, y: v.x } : v)));
    const ties = analyse(polygons, sheet, 1, 10, true).alternatives;
    assert.equal(ties.length, 2);
    const nextAreas = ties.map(
      (r) =>
        analyse([...polygons, rectanglePoints(r)], sheet, 1, 10).rectangle.area,
    );
    assert.ok(Math.max(...nextAreas) - Math.min(...nextAreas) > 100);
    const result = collect(polygons, sheet, 1, 10);
    assert.equal(result.rectangle.area, 3900);
    assert.equal(result.rectangles[1].area, Math.max(...nextAreas));
  }
});
test("seven independent offcuts are retained and exportable without a count cap", () => {
  const ps = [50, 105, 161, 218, 276, 335].map((x) => rect(x, 0, 5, 80));
  const result = collect(ps, { x: 0, y: 0, w: 400, h: 80 }, 1, 20);
  assert.equal(result.rectangles.length, 7);
  const parts = ps.map((outer, i) => ({ id: String(i), outer })),
    placements = parts.map((p) => ({
      id: p.id,
      x: 0,
      y: 0,
      angle: 0,
      sheet: 0,
    }));
  assert.equal(
    checkedOffcuts(
      parts,
      placements,
      0,
      { width: 400, height: 80, margin: 0, gap: 1, minOffcutSide: 20 },
      { offcuts: result.rectangles },
    ).length,
    7,
  );
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
