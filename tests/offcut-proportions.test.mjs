import test from "node:test";
import assert from "node:assert/strict";
import "../dist/engine/util/offcut.js";
import { SHEET_PRESETS } from "../dist/sheet-presets.js";
const { utility, score, compare, collect } = globalThis.PaperOffcut;
const report = (r) => [
  { rectangles: [{ ...r, area: r.w * r.h }], occupiedArea: 1 },
];
test("A4 to A1 landscape presets use exact millimetres", () => {
  assert.deepEqual(
    Object.values(SHEET_PRESETS).map((p) => [p.width, p.height]),
    [
      [297, 210],
      [420, 297],
      [594, 420],
      [841, 594],
    ],
  );
});
test("a slightly smaller broad offcut can beat a long strip, but a tiny square cannot", () => {
  const strip = { w: 200, h: 20 },
    broad = { w: 60, h: 60 },
    tiny = { w: 20, h: 20 };
  assert.ok(
    compare(score(0, report(strip), 0), score(0, report(broad), 0)) < 0,
  );
  assert.ok(
    compare(score(0, report(broad), 0.35), score(0, report(strip), 0.35)) < 0,
  );
  assert.ok(
    compare(score(0, report(strip), 0.35), score(0, report(tiny), 0.35)) < 0,
  );
  assert.equal(
    utility({ w: 60, h: 40 }, 0.35),
    utility({ w: 40, h: 60 }, 0.35),
  );
});
test("trimming or arbitrarily chopping a strip cannot game the primary score", () => {
  assert.ok(utility({ w: 200, h: 20 }, 0.5) > utility({ w: 20, h: 20 }, 0.5));
  assert.ok(
    compare(
      score(0, report({ w: 200, h: 20 }), 0.35),
      score(
        0,
        [
          {
            rectangles: Array.from({ length: 10 }, () => ({
              w: 20,
              h: 20,
              area: 400,
            })),
            occupiedArea: 1,
          },
        ],
        0.35,
      ),
    ) < 0,
  );
});
test("rectangle extraction uses the same proportion preference as global scoring", () => {
  // Empty regions: a 200x20 top strip and a 60x60 lower pocket, separated by material.
  const rect = (x, y, w, h) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  const polygons = [rect(0, 20, 200, 10), rect(60, 30, 140, 60)];
  const old = collect(polygons, { x: 0, y: 0, w: 200, h: 90 }, 0, 5, {
    shapeWeight: 0,
  });
  const balanced = collect(polygons, { x: 0, y: 0, w: 200, h: 90 }, 0, 5, {
    shapeWeight: 0.35,
  });
  assert.ok(old.rectangle.w / old.rectangle.h > 5);
  assert.ok(
    Math.max(balanced.rectangle.w, balanced.rectangle.h) /
      Math.min(balanced.rectangle.w, balanced.rectangle.h) <
      1.2,
  );
  assert.ok(utility(balanced.rectangle, 0.35) > utility(old.rectangle, 0.35));
});
