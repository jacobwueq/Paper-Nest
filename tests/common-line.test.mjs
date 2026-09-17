import test from "node:test";
import assert from "node:assert/strict";
import { mergeCommonLines, lineLength } from "../dist/common-line.js";
import { prepareCommonLineExport } from "../dist/common-line-export.js";
import { exportSVG, exportDXF } from "../dist/exporters.js";
const line = (a, b, y = 0) => ({ start: { x: a, y }, end: { x: b, y } });
const spans = (ls) =>
  mergeCommonLines(ls).map((s) => [s.start.x, s.end.x, s.shared]);
test("full reversed duplicates retain one canonical line", () => {
  assert.deepEqual(spans([line(0, 100), line(100, 0)]), [[0, 100, true]]);
});
test("contained 30–70 edge splits 0–100 without losing either tail", () => {
  assert.deepEqual(spans([line(0, 100), line(30, 70)]), [
    [0, 30, false],
    [30, 70, true],
    [70, 100, false],
  ]);
});
test("overlap at ends preserves both non-shared sections", () => {
  assert.deepEqual(spans([line(0, 60), line(40, 100)]), [
    [0, 40, false],
    [40, 60, true],
    [60, 100, false],
  ]);
});
test("endpoint touching is not shared overlap", () => {
  assert.deepEqual(spans([line(0, 40), line(40, 100)]), [
    [0, 40, false],
    [40, 100, false],
  ]);
});
test("parallel offset beyond tolerance and non-parallel edges remain distinct", () => {
  assert.equal(
    mergeCommonLines([line(0, 100), line(0, 100, 0.00002)], {
      tolerance: 0.00001,
    }).length,
    2,
  );
  const slope = { start: { x: 0, y: 0 }, end: { x: 100, y: 0.01 } };
  assert.equal(mergeCommonLines([line(0, 100), slope]).length, 2);
});
test("multiple adjacent shared sections are emitted once each", () => {
  const result = mergeCommonLines([
    line(0, 100),
    line(20, 40),
    line(40, 70),
    line(60, 90),
  ]);
  assert.deepEqual(
    result.map((s) => [s.start.x, s.end.x]),
    [
      [0, 20],
      [20, 40],
      [40, 60],
      [60, 70],
      [70, 90],
      [90, 100],
    ],
  );
  assert.equal(
    result.reduce((n, s) => n + lineLength(s), 0),
    100,
  );
});
test("short tails, gaps, operations and source inputs are preserved", () => {
  const ls = [
    { ...line(0, 100), mergeKey: "CUT" },
    { ...line(30, 70), mergeKey: "SCORE" },
  ];
  const before = structuredClone(ls);
  assert.equal(
    mergeCommonLines(ls).reduce((s, e) => s + lineLength(e), 0),
    140,
  );
  assert.deepEqual(ls, before);
  assert.equal(mergeCommonLines([line(0, 1), line(1.0000001, 2)]).length, 2);
  assert.equal(mergeCommonLines([line(0, 100), line(0, 99.9999999)]).length, 2);
});
const poly = (vs, extra = {}) => ({
  kind: "poly",
  vertices: vs.map(([x, y]) => ({ x, y })),
  closed: false,
  layer: "CUT",
  color: "#000000",
  ...extra,
});
const part = (id, e) => ({
  id,
  name: id,
  origin: { x: 0, y: 0 },
  outer: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 10 },
    { x: 0, y: 10 },
  ],
  entities: e,
});
const pose = (id, x = 0, y = 0) => ({ id, x, y, angle: 0, sheet: 0, scale: 1 });
const settings = { width: 200, height: 200, gap: 2, margin: 0 };
test("DXF and SVG export apply cleanup independently of placement mode", () => {
  const parts = [
    part("a", [
      poly([
        [0, 0],
        [100, 0],
      ]),
    ]),
    part("b", [
      poly([
        [30, 0],
        [70, 0],
      ]),
    ]),
  ];
  const placements = [pose("a"), pose("b")],
    before = structuredClone(parts);
  const options = { mergeCommonLines: true };
  const dxf = exportDXF(parts, placements, 0, settings, options);
  assert.equal((dxf.match(/\nLINE\n/g) || []).length, 3);
  const svg = exportSVG(parts, placements, 0, settings, options);
  assert.equal((svg.match(/<path /g) || []).length, 3);
  assert.match(svg, /M0 0 L30 0/);
  assert.match(svg, /M30 0 L70 0/);
  assert.match(svg, /M70 0 L100 0/);
  assert.deepEqual(parts, before);
  assert.equal(
    (exportDXF(parts, placements, 0, settings).match(/\nLINE\n/g) || []).length,
    2,
  );
});
test("cleanup compares final transforms, preserves arcs, and separates sheets", () => {
  const parts = [
    part("a", [
      poly([
        [0, 0],
        [100, 0],
      ]),
      { kind: "circle", cx: 50, cy: 10, r: 3, layer: "CUT" },
    ]),
    part("b", [
      poly([
        [0, 0],
        [40, 0],
      ]),
    ]),
  ];
  const placements = [pose("a"), { ...pose("b", 70, 0), mirrored: true }];
  const result = prepareCommonLineExport(parts, placements, 0);
  assert.equal(
    result.flatMap((p) => p.entities).filter((e) => e.kind === "poly").length,
    3,
  );
  assert.equal(result[0].entities.filter((e) => e.kind === "circle").length, 1);
  const arc = poly(
    [
      [0, 0],
      [10, 0],
      [20, 0],
    ],
    { closed: false },
  );
  arc.vertices[0].bulge = 1;
  const prepared = prepareCommonLineExport([part("c", [arc])], [pose("c")], 0);
  assert.equal(
    prepared[0].entities.find((e) => e.vertices[0].bulge).vertices[0].bulge,
    1,
  );
  placements[1].sheet = 1;
  assert.equal(
    prepareCommonLineExport(parts, placements, 0)[0].entities.length,
    2,
  );
});
test("SVG source straight commands merge while cubic curves remain exact", () => {
  const svg = {
    kind: "svg",
    layer: "CUT",
    color: "#000000",
    svg: "",
    pathMatrix: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
    pathCommands: [
      { type: "M", values: [0, 0] },
      { type: "L", values: [100, 0] },
      { type: "C", values: [101, 0, 101, 10, 100, 10] },
    ],
  };
  const parts = [
    part("a", [svg]),
    part("b", [
      poly([
        [30, 0],
        [70, 0],
      ]),
    ]),
  ];
  const output = exportSVG(parts, [pose("a"), pose("b")], 0, settings, {
    mergeCommonLines: true,
  });
  assert.match(output, /C 101 0 101 10 100 10/);
  assert.equal((output.match(/<path /g) || []).length, 4);
});
test("offcut recovery outlines use the same independent cleanup without crossing operations", () => {
  const opts = {
    mergeCommonLines: true,
    offcuts: [
      { x: 0, y: 0, w: 30, h: 30 },
      { x: 30, y: 0, w: 30, h: 30 },
    ],
  };
  const config = { ...settings, gap: 0, minOffcutSide: 10 };
  const output = exportSVG([], [], 0, config, opts);
  // Two rectangles sharing one complete edge: seven unique perimeter sections.
  assert.equal((output.match(/<path /g) || []).length, 7);
  assert.equal(
    (exportDXF([], [], 0, config, opts).match(/\nLINE\n/g) || []).length,
    7,
  );
});
