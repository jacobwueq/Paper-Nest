import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { identifyParts, parseDXF } from "../dist/importers.js";
import {
  entityPoints,
  area,
  transform,
  validateLayout,
  sampleParts,
  simplePolygon,
} from "../dist/geometry.js";
import { exportDXF } from "../dist/exporters.js";
const rect = (w, h, x = 0, y = 0) => ({
  kind: "poly",
  closed: true,
  layer: "CUT",
  vertices: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});
const settings = { width: 420, height: 297, gap: 2, margin: 5, rotations: 24 };
test("a 100 × 50 mm part retains a hole and open engraving", () => {
  const p = identifyParts([
    rect(100, 50),
    { kind: "circle", cx: 25, cy: 25, r: 4, closed: true, layer: "CUT" },
    {
      kind: "poly",
      vertices: [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
      ],
      closed: false,
      layer: "SCORE",
    },
  ]);
  assert.equal(p.length, 1);
  assert.equal(p[0].entities.length, 3);
  assert.equal(p[0].size.w, 100);
  assert.equal(p[0].size.h, 50);
});
test("closed chain of LINEs forms one part; a gap is rejected", () => {
  const vertices = rect(100, 50).vertices;
  const lines = vertices.map((p, i) => ({
    kind: "poly",
    vertices: [p, vertices[(i + 1) % 4]],
    closed: false,
  }));
  assert.equal(identifyParts(lines).length, 1);
  lines[3] = { ...lines[3], vertices: [vertices[3], { x: 0.1, y: 0 }] };
  assert.throws(() => identifyParts(lines), /closed/);
});
test("native group retains disconnected shapes as one rigid part", () => {
  const parts = identifyParts([
    { ...rect(30, 20), group: "G" },
    { ...rect(20, 20, 50, 0), group: "G" },
  ]);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].entities.length, 2);
  assert.equal(parts[0].size.w, 70);
});
test("concavity, overlaps, spacing and sheet bounds are validated", () => {
  const p = identifyParts([rect(100, 50), rect(20, 20, 150, 0)]);
  assert.deepEqual(
    validateLayout(
      p,
      [
        { id: p[0].id, x: 5, y: 5, angle: 0, sheet: 0 },
        { id: p[1].id, x: 107, y: 5, angle: 0, sheet: 0 },
      ],
      settings,
    ),
    [],
  );
  assert.ok(
    validateLayout(
      p,
      [
        { id: p[0].id, x: 5, y: 5, angle: 0, sheet: 0 },
        { id: p[1].id, x: 104, y: 5, angle: 0, sheet: 0 },
      ],
      settings,
    ).length,
  );
  assert.ok(
    validateLayout(
      p,
      [{ id: p[0].id, x: 0, y: 0, angle: 0, sheet: 0 }],
      settings,
    ).length,
  );
});
test("self-intersecting outlines are rejected", () => {
  assert.throws(
    () =>
      identifyParts([
        {
          kind: "poly",
          closed: true,
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
            { x: 10, y: 0 },
          ],
        },
      ]),
    /intersect/,
  );
});
test("bulges and exact arcs survive rotated DXF export", () => {
  const e = rect(100, 80);
  e.vertices[0].bulge = -0.414213562373095;
  const parts = identifyParts([
    e,
    {
      kind: "arc",
      cx: 40,
      cy: 40,
      r: 5,
      start: 0.2,
      sweep: -1.2,
      closed: false,
      layer: "SCORE",
    },
  ]);
  const t = { id: parts[0].id, x: 150, y: 30, angle: 37, sheet: 0 };
  const out = exportDXF(parts, [t], 0, settings);
  const back = parseDXF(out);
  assert.equal(back.parts.length, 1);
  const poly = back.parts[0].entities.find((e) => e.kind === "poly");
  assert.ok(Math.abs(poly.vertices[0].bulge - e.vertices[0].bulge) < 1e-6);
  const a = back.parts[0].entities.find((e) => e.kind === "arc");
  assert.ok(Math.abs(a.r - 5) < 1e-6);
  assert.ok(Math.abs(a.sweep + 1.2) < 1e-6);
  fs.writeFileSync("work/roundtrip.dxf", out);
});
test("missing units and unsupported entities are never silently accepted", () => {
  const parts = identifyParts([rect(100, 50)]);
  const out = exportDXF(
    parts,
    [{ id: parts[0].id, x: 10, y: 10, angle: 0, sheet: 0 }],
    0,
    settings,
  );
  assert.throws(
    () => parseDXF(out.replace("$INSUNITS\n70\n4", "$INSUNITS\n70\n0")),
    /units/,
  );
  assert.throws(
    () => parseDXF(out.replace("LWPOLYLINE", "SPLINE")),
    /Unsupported/,
  );
});
test("sample parts have non-self-intersecting collision outlines", () => {
  for (const p of sampleParts()) assert.ok(simplePolygon(p.outer), p.name);
});
test("physical units convert inches to mm", () => {
  const p = identifyParts([rect(100 / 25.4, 50 / 25.4)]);
  const d = exportDXF(
    p,
    [{ id: p[0].id, x: 10, y: 10, angle: 0, sheet: 0 }],
    0,
    settings,
  ).replace("$INSUNITS\n70\n4", "$INSUNITS\n70\n1");
  const q = parseDXF(d).parts[0];
  assert.ok(Math.abs(q.size.w - 100) < 0.0001);
  assert.ok(Math.abs(q.size.h - 50) < 0.0001);
});
test("separate-sheet placement and oversize are accounted for", () => {
  const p = identifyParts([rect(410, 287), rect(410, 287, 500)]);
  const placements = p.map((p, i) => ({
    id: p.id,
    x: 5,
    y: 5,
    angle: 0,
    sheet: i,
  }));
  assert.equal(validateLayout(p, placements, settings).length, 0);
  assert.ok(
    validateLayout(p, [{ id: p[0].id, x: 5, y: 5, angle: 0, sheet: 0 }], {
      ...settings,
      width: 100,
    }).length,
  );
});
test("exported disjoint GROUP survives re-import", () => {
  const p = identifyParts([
    { ...rect(20, 20), group: "g" },
    { ...rect(20, 20, 40), group: "g" },
  ]);
  const d = exportDXF(
    p,
    [{ id: p[0].id, x: 10, y: 10, angle: 0, sheet: 0 }],
    0,
    settings,
  );
  const q = parseDXF(d).parts;
  assert.equal(q.length, 1);
  assert.equal(q[0].entities.length, 2);
});
test("ACI, BYLAYER and true black colours survive DXF round trip", () => {
  for (const c of [
    { aci: 1, trueColor: null },
    { aci: 143, trueColor: null },
    { aci: 256, trueColor: null },
    { aci: 7, trueColor: 0 },
  ]) {
    const layerColor = { aci: 5, trueColor: null };
    const p = identifyParts([{ ...rect(100, 50), dxfColor: c, layerColor }]);
    const d = exportDXF(
      p,
      [{ id: p[0].id, x: 10, y: 10, angle: 0, sheet: 0 }],
      0,
      settings,
    );
    const e = parseDXF(d).parts[0].entities[0];
    assert.deepEqual(e.dxfColor, c);
    assert.equal(e.layerColor.aci, 5);
    if (c.trueColor === 0) assert.equal(e.color, "#000000");
    if (c.aci === 1) assert.equal(e.color, "#ff0000");
  }
});
test("duplicate and zero-length geometry are rejected", () => {
  assert.throws(() => identifyParts([rect(10, 10), rect(10, 10)]), /Duplicate/);
  assert.throws(
    () =>
      identifyParts([
        rect(10, 10),
        {
          kind: "poly",
          closed: false,
          vertices: [
            { x: 2, y: 2 },
            { x: 2, y: 2 },
          ],
        },
      ]),
    /zero-length/,
  );
});
test("uniform INSERT transforms geometry and resolves BYBLOCK colour", () => {
  const tags = (...a) => a.join("\n") + "\n";
  const d = tags(
    0,
    "SECTION",
    2,
    "HEADER",
    9,
    "$INSUNITS",
    70,
    4,
    0,
    "ENDSEC",
    0,
    "SECTION",
    2,
    "BLOCKS",
    0,
    "BLOCK",
    2,
    "PANEL",
    10,
    0,
    20,
    0,
    0,
    "LWPOLYLINE",
    8,
    "0",
    62,
    0,
    90,
    4,
    70,
    1,
    10,
    0,
    20,
    0,
    10,
    50,
    20,
    0,
    10,
    50,
    20,
    25,
    10,
    0,
    20,
    25,
    0,
    "ENDBLK",
    0,
    "ENDSEC",
    0,
    "SECTION",
    2,
    "ENTITIES",
    0,
    "INSERT",
    2,
    "PANEL",
    8,
    "CUT",
    62,
    1,
    10,
    200,
    20,
    150,
    41,
    2,
    42,
    2,
    50,
    90,
    0,
    "ENDSEC",
    0,
    "EOF",
  );
  const p = parseDXF(d).parts[0];
  assert.ok(Math.abs(p.size.w - 50) < 1e-6);
  assert.ok(Math.abs(p.size.h - 100) < 1e-6);
  assert.equal(p.entities[0].dxfColor.aci, 1);
  assert.equal(p.entities[0].color, "#ff0000");
  assert.equal(p.entities[0].layer, "CUT");
});
