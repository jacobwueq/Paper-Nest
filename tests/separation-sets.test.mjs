import test from "node:test";
import assert from "node:assert/strict";
import {
  proposeCutSets,
  checkedCutSets,
  missingSegments,
} from "../dist/separation-sets.js";
import { exportSVG, exportDXF } from "../dist/exporters.js";
const s = {
  width: 200,
  height: 100,
  margin: 5,
  gap: 0,
  kerf: 0,
  minOffcutSide: 1,
};
const r = (id, x, y, w, h) => ({ id, number: Number(id), x, y, w, h });
const rectPart = (id, x, y, w, h) => {
  const outer = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  return {
    id,
    outer,
    origin: { x: 0, y: 0 },
    entities: [{ kind: "poly", closed: true, vertices: outer }],
  };
};
const pose = (id) => ({ id, x: 0, y: 0, angle: 0, sheet: 0 });
test("A: margin-adjacent right offcut releases with one physical full-height line", () => {
  const sets = proposeCutSets([], [], 0, s, [r("1", 100, 5, 95, 90)]);
  assert.equal(sets[0].segments.length, 1);
  assert.equal(sets[0].length, 100);
  assert.deepEqual(sets[0].segments[0], {
    start: { x: 100, y: 0 },
    end: { x: 100, y: 100 },
  });
});
test("B/D: corner uses physical perimeter and two short missing sides", () => {
  const p = proposeCutSets([], [], 0, s, [r("1", 0, 0, 30, 20)])[0];
  assert.equal(p.segments.length, 2);
  assert.equal(p.length, 50);
  assert.ok(
    p.segments.every(
      (l) =>
        !(l.start.x === 0 && l.end.x === 0) &&
        !(l.start.y === 0 && l.end.y === 0),
    ),
  );
});
test("C: existing real part boundary supplies part of the offcut boundary", () => {
  const part = rectPart("p", 0, 20, 30, 20);
  const set = proposeCutSets([part], [pose("p")], 0, s, [
    r("1", 0, 0, 30, 20),
  ])[0];
  assert.equal(set.length, 20);
  assert.equal(set.segments.length, 1);
});
test("partial existing boundary subtracts only its covered section", () => {
  const out = missingSegments(
    [{ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
    [{ start: { x: 30, y: 0 }, end: { x: 70, y: 0 } }],
  );
  assert.deepEqual(out, [
    { start: { x: 0, y: 0 }, end: { x: 30, y: 0 } },
    { start: { x: 70, y: 0 }, end: { x: 100, y: 0 } },
  ]);
});
test("E: combined cut set releases two adjacent pieces with shared cut once", () => {
  const sets = proposeCutSets([], [], 0, s, [
    r("1", 0, 0, 30, 20),
    r("2", 0, 20, 30, 20),
  ]);
  const both = sets.find((c) => c.offcuts.length === 2);
  assert.ok(both);
  assert.equal(both.length, 100);
  assert.ok(both.length < sets[0].length + sets[1].length);
  assert.equal(
    checkedCutSets([], [], 0, s, [...sets]).reduce(
      (n, l) => n + Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y),
      0,
    ),
    100,
  );
});
test("F: only selected sets export, exact segments in SVG and DXF, no sheet perimeter", () => {
  const set = proposeCutSets([], [], 0, s, [r("1", 0, 0, 30, 20)])[0];
  assert.doesNotMatch(exportSVG([], [], 0, s), /SEPARATION_CUT/);
  const svg = exportSVG([], [], 0, s, { cutSets: [set] });
  assert.match(svg, /SEPARATION_CUT/);
  assert.equal((svg.match(/<path/g) || []).length, 2);
  assert.match(exportDXF([], [], 0, s, { cutSets: [set] }), /SEPARATION_CUT/);
});
test("stale or modified sets reject after parts move; safe extension never crosses a part", () => {
  const set = proposeCutSets([], [], 0, s, [r("1", 0, 0, 30, 20)])[0];
  const p = rectPart("p", 25, 10, 10, 20);
  assert.throws(() => checkedCutSets([p], [pose("p")], 0, s, [set]));
  assert.throws(() =>
    checkedCutSets([], [], 0, s, [
      {
        ...set,
        segments: [{ start: { x: 0, y: 0 }, end: { x: 200, y: 100 } }],
      },
    ]),
  );
});
test("positive kerf rejects a new line too close to a part", () => {
  const p = rectPart("p", 31, 0, 20, 30);
  assert.equal(
    proposeCutSets([p], [pose("p")], 0, { ...s, kerf: 3 }, [
      r("1", 0, 0, 30, 20),
    ]).length,
    0,
  );
});
test("selected quick cut replaces its full extraction frame and preserves other selected frames", () => {
  const a = r("1", 100, 5, 95, 90),
    b = r("2", 10, 50, 20, 20),
    set = proposeCutSets([], [], 0, s, [a, b])[0];
  const svg = exportSVG([], [], 0, s, { offcuts: [a, b], cutSets: [set] });
  assert.match(svg, /SEPARATION_CUT/);
  assert.match(svg, /OFFCUT_CUT/);
  // Only the second frame remains: four paths plus the full-height quick line.
  assert.equal((svg.match(/<path/g) || []).length, 5);
});
test("sampled curve chords are not treated as existing straight cut boundaries", () => {
  const part = {
    id: "circle",
    outer: [
      { x: 30, y: 0 },
      { x: 40, y: 10 },
      { x: 30, y: 20 },
      { x: 20, y: 10 },
    ],
    origin: { x: 0, y: 0 },
    entities: [{ kind: "circle", cx: 30, cy: 10, r: 10 }],
  };
  assert.equal(
    proposeCutSets([part], [pose("circle")], 0, s, [r("1", 0, 0, 20, 20)])
      .length,
    0,
  );
});
