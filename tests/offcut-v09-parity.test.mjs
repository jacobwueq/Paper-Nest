import test from "node:test";
import assert from "node:assert/strict";
await import("../benchmarks/baseline/offcut-v09.js");
const before = globalThis.PaperOffcut;
await import("../dist/engine/util/offcut.js");
const after = globalThis.PaperOffcut;
const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
test("offcut optimisation preserves complete v0.9 reports", () => {
  const drawings = [
    [],
    [rect(30, 30, 40, 40)],
    [rect(0, 0, 100, 100)],
    [rect(45, 0, 10, 100), rect(0, 45, 100, 10)],
    [
      [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
        { x: 80, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 80 },
        { x: 10, y: 80 },
      ],
    ],
    [
      [
        { x: 10, y: 10 },
        { x: 90, y: 89.9 },
        { x: 90, y: 90 },
      ],
    ],
    [rect(5, 5, 20, 20), rect(65, 65, 25, 25), rect(65, 5, 20, 20)],
  ];
  for (const polygons of drawings)
    for (const padding of [0, 2.03])
      for (const min of [10, 20])
        assert.deepEqual(
          after.collect(polygons, { w: 100, h: 100 }, padding, min),
          before.collect(polygons, { w: 100, h: 100 }, padding, min),
        );
});
test("base occupancy is built once and reused for subsequent subdivisions", () => {
  const counts = {};
  after.collect([rect(30, 30, 40, 40)], { w: 100, h: 100 }, 2, 20, {
    count(k) {
      counts[k] = (counts[k] || 0) + 1;
    },
  });
  assert.equal(counts.offcutBaseRasterBuilds, 1);
  assert.ok(counts.offcutBaseRasterReuses > 0);
});
test("standalone analysis preserves zero-minimum and translated sheet behaviour", () => {
  for (const min of [0, 20])
    for (const padding of [0, 2]) {
      const polygons = [rect(35, 45, 25, 30), rect(75, 15, 5, 70)];
      assert.deepEqual(
        after.analyse(
          polygons,
          { x: 5, y: 10, w: 100, h: 90 },
          padding,
          min,
          true,
        ),
        before.analyse(
          polygons,
          { x: 5, y: 10, w: 100, h: 90 },
          padding,
          min,
          true,
        ),
      );
    }
});
