import test from "node:test";
import assert from "node:assert/strict";
import { proposeSeparations, checkedSeparations } from "../dist/separation.js";
import { exportSVG, exportDXF } from "../dist/exporters.js";
const outer = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 30 },
  { x: 0, y: 30 },
];
const parts = [
  {
    id: "a",
    name: "a",
    outer,
    origin: { x: 0, y: 0 },
    entities: [{ kind: "poly", closed: true, vertices: outer, layer: "CUT" }],
  },
];
const poses = [{ id: "a", x: 10, y: 10, angle: 0, sheet: 0 }];
const s = {
  width: 200,
  height: 100,
  margin: 5,
  gap: 2,
  kerf: 0.2,
  minOffcutSide: 20,
};
test("proposes at most two full-sheet axis cuts, clear of kerf, without moving parts", () => {
  const original = structuredClone(poses),
    lines = proposeSeparations(parts, poses, 0, s);
  assert.equal(lines.length, 2);
  assert.deepEqual(poses, original);
  assert.equal(lines[0].start.y, 0);
  assert.equal(lines[0].end.y, 100);
  assert.equal(lines[1].start.x, 0);
  assert.equal(lines[1].end.x, 200);
  assert.ok(lines[0].start.x > 50.1);
  assert.ok(lines[1].start.y > 40.1);
  assert.equal(checkedSeparations(parts, poses, 0, s, lines).length, 2);
});
test("rejects interior crossings, part boundary contacts, kerf intrusion and partial/diagonal lines", () => {
  for (const l of [
    { start: { x: 0, y: 20 }, end: { x: 200, y: 20 } },
    { start: { x: 0, y: 40 }, end: { x: 200, y: 40 } },
    { start: { x: 0, y: 40.05 }, end: { x: 200, y: 40.05 } },
    { start: { x: 5, y: 60 }, end: { x: 195, y: 60 } },
    { start: { x: 0, y: 0 }, end: { x: 200, y: 100 } },
    { start: { x: 0, y: 100 }, end: { x: 200, y: 100 } },
  ])
    assert.throws(() => checkedSeparations(parts, poses, 0, s, [l]));
});
test("no proposal when no reusable full-sheet strip exists, and respects sheet/rotation", () => {
  assert.deepEqual(proposeSeparations(parts, poses, 1, s), []);
  assert.deepEqual(
    proposeSeparations(parts, [{ ...poses[0], x: 5, y: 5 }], 0, {
      ...s,
      width: 50,
      height: 40,
    }),
    [],
  );
  const rotated = [{ ...poses[0], x: 100, y: 10, angle: 45 }];
  assert.doesNotThrow(() =>
    checkedSeparations(
      parts,
      rotated,
      0,
      s,
      proposeSeparations(parts, rotated, 0, s),
    ),
  );
});
test("duplicate separation lines output once; SVG and DXF include real purple cut paths", () => {
  const l = proposeSeparations(parts, poses, 0, s)[0];
  assert.equal(checkedSeparations(parts, poses, 0, s, [l, l]).length, 1);
  const svg = exportSVG(parts, poses, 0, s, { separationCuts: [l, l] });
  assert.match(svg, /id="SEPARATION_CUT"/);
  assert.match(svg, /stroke="#8b3fd6"/);
  assert.equal(svg.split('id="SEPARATION_CUT"')[1].match(/<path /g).length, 1);
  const dxf = exportDXF(parts, poses, 0, s, { separationCuts: [l] });
  assert.match(dxf, /SEPARATION_CUT/);
  assert.match(dxf, /AcDbLine/);
  assert.doesNotMatch(exportSVG(parts, poses, 0, s), /SEPARATION_CUT/);
});
test("full remnant and separation can export together; proposals revalidate after movement", () => {
  const lines = proposeSeparations(parts, poses, 0, s);
  assert.doesNotThrow(() =>
    exportSVG(parts, poses, 0, s, {
      offcuts: [{ x: 80, y: 50, w: 80, h: 40 }],
      separationCuts: lines,
    }),
  );
  assert.throws(() =>
    exportDXF(parts, [{ ...poses[0], x: 45 }], 0, s, { separationCuts: lines }),
  );
  assert.throws(() => proposeSeparations(parts, poses, 0, { ...s, kerf: NaN }));
});

test("mixed recovery removes only coincident portions, leaving full physical quick cut", async () => {
  const { recoveryLines } = await import("../dist/exporters.js");
  const q = { start: { x: 80, y: 0 }, end: { x: 80, y: 100 } };
  const frame = [
    [
      { x: 80, y: 50 },
      { x: 160, y: 50 },
      { x: 160, y: 90 },
      { x: 80, y: 90 },
    ],
  ];
  const r = recoveryLines(frame, [q]);
  const length = (lines) =>
    lines.reduce(
      (n, l) => n + Math.hypot(l.end.x - l.start.x, l.end.y - l.start.y),
      0,
    );
  assert.equal(length(r.quick), 100);
  assert.equal(length(r.remnant), 200);
  const svg = exportSVG(parts, poses, 0, s, {
    offcuts: [{ x: 80, y: 50, w: 80, h: 40 }],
    separationCuts: [q],
  });
  assert.match(svg, /id="OFFCUT_CUT"/);
  assert.match(svg, /id="SEPARATION_CUT"/);
  assert.doesNotMatch(svg, /scissors|stroke-dasharray|preview/);
});
