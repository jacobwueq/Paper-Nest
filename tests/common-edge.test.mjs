import test from "node:test";
import assert from "node:assert/strict";
import {
  extractPolygonEdges,
  extractPartEdges,
  edgeCompatibility,
  transformEdge,
  sharedSection,
  commonEdgeCandidates,
  svgStraightSegments,
} from "../dist/common-edge.js";
import { compactLayout } from "../dist/compaction.js";
import { validateLayout } from "../dist/geometry.js";
const box = (id, w, h = 10) => ({
  id,
  outer: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});
const pose = (id, x = 0, y = 0, angle = 0) => ({
  id,
  x,
  y,
  angle,
  sheet: 0,
  scale: 1,
  mirrored: false,
});
const edge = (id, w, top = true) => extractPartEdges(box(id, w))[top ? 0 : 2];
test("equal opposite edges share their full length and expose geometry metadata", () => {
  const a = edge("a", 100),
    b = edge("b", 100, false);
  assert.deepEqual(a.start, { x: 0, y: 0 });
  assert.equal(a.length, 100);
  assert.deepEqual(a.outwardNormal, { x: 0, y: -1 });
  assert.equal(a.partId, "a");
  assert.equal(a.contourId, "outer");
  assert.equal(a.edgeIndex, 0);
  assert.equal(edgeCompatibility(a, b).maxOverlap, 100);
});
test("100 mm and 40 mm have 40 mm potential, independent of existing positions", () => {
  const a = edge("a", 100),
    b = transformEdge(edge("b", 40, false), pose("b", 999, 88));
  assert.equal(edgeCompatibility(a, b).maxOverlap, 40);
  assert.equal(sharedSection(a, b), null);
  const touching = transformEdge(edge("b", 40, false), pose("b", 80, -10));
  assert.equal(sharedSection(a, touching).length, 20);
});
test("parallel same-facing, non-parallel and degenerate pairs reject early", () => {
  const a = edge("a", 100);
  assert.equal(edgeCompatibility(a, edge("b", 40)).reason, "same-facing");
  assert.equal(
    edgeCompatibility(
      a,
      transformEdge(edge("b", 40, false), pose("b", 0, 0, 10)),
    ).reason,
    "not-parallel",
  );
  assert.equal(
    edgeCompatibility(a, { ...edge("b", 40, false), length: 0 }).reason,
    "too-short",
  );
  assert.equal(edgeCompatibility(a, edge("a", 40, false)).reason, "same-part");
});
test("angle tolerance is inclusive at its boundary and configurable", () => {
  const a = edge("a", 100),
    b = edge("b", 40, false);
  for (const angle of [-0.5, 0.5])
    assert.ok(
      edgeCompatibility(a, transformEdge(b, pose("b", 0, 0, angle)), {
        angleTolerance: 0.5,
      }).compatible,
    );
  assert.equal(
    edgeCompatibility(a, transformEdge(b, pose("b", 0, 0, 0.50001)), {
      angleTolerance: 0.5,
    }).compatible,
    false,
  );
  assert.ok(edgeCompatibility(a, b, { angleTolerance: 0 }).compatible);
  assert.throws(() => edgeCompatibility(a, b, { angleTolerance: -1 }));
});
test("winding and mirror transforms preserve outward normals and physical lengths", () => {
  const p = box("a", 100);
  p.outer.reverse();
  const edges = extractPartEdges(p);
  assert.ok(
    edges.every(
      (e) =>
        e.outwardNormal.x * (e.start.x + e.end.x - 100) +
          e.outwardNormal.y * (e.start.y + e.end.y - 10) >
        0,
    ),
  );
  const e = transformEdge(edge("a", 100), {
    ...pose("a"),
    mirrored: true,
    scale: 2,
  });
  assert.equal(e.length, 200);
  assert.deepEqual(e.outwardNormal, { x: 0, y: -1 });
});
test("source extraction excludes holes, engravings, bulge arcs and fabricated hull edges", () => {
  const p = box("a", 100);
  p.origin = { x: 0, y: 0 };
  p.entities = [
    { kind: "poly", closed: true, vertices: p.outer.map((v) => ({ ...v })) },
    {
      kind: "poly",
      closed: false,
      vertices: [
        { x: 10, y: 5 },
        { x: 90, y: 5 },
      ],
    },
    { kind: "circle", cx: 50, cy: 5, r: 1 },
  ];
  assert.equal(extractPartEdges(p).length, 4);
  p.entities[0].vertices[0].bulge = 0.5;
  assert.equal(extractPartEdges(p).length, 3);
  p.entities = [
    {
      kind: "poly",
      closed: false,
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
  ];
  assert.equal(extractPartEdges(p).length, 0); // cannot infer the hull's 100 mm edge
});
test("normalised SVG source lines survive transforms; curve samples are not edges", () => {
  const commands = [
    { type: "M", values: [0, 0] },
    { type: "L", values: [100, 0] },
    { type: "C", values: [110, 0, 110, 10, 100, 10] },
    { type: "L", values: [0, 10] },
    { type: "Z", values: [] },
  ];
  const segments = svgStraightSegments(commands, {
    a: 2,
    b: 0,
    c: 0,
    d: 2,
    e: 5,
    f: 7,
  });
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0].end, { x: 205, y: 7 });
  const p = box("s", 100);
  p.entities = [
    { kind: "svg", straightSegments: svgStraightSegments(commands) },
  ];
  assert.equal(extractPartEdges(p).length, 3);
  delete p.entities[0].straightSegments;
  assert.equal(extractPartEdges(p).length, 0);
});
test("endpoint candidates include both ends of a 100/40 pairing with exact 40 mm overlap", () => {
  const fixed = box("a", 100),
    moving = box("b", 40);
  const candidates = [
    ...commonEdgeCandidates(moving, pose("b", 200, 200), fixed, pose("a"), {
      rotations: 1,
    }),
  ];
  const samePair = candidates.filter(
    (c) => c.fixedEdge.edgeIndex === 0 && c.movingEdge.edgeIndex === 2,
  );
  assert.deepEqual(
    samePair.map((c) => c.placement.x).sort((a, b) => a - b),
    [0, 60],
  );
  for (const c of samePair) {
    assert.equal(c.sharedSection.length, 40);
    assert.equal(c.placement.y, -10);
  }
  assert.ok(candidates.length <= 4 * 4 * 4);
});
test("candidate rotation and translation honour the grid, scale and reflection", () => {
  const fixed = box("a", 100),
    moving = box("b", 40);
  for (const mirrored of [false, true]) {
    const mp = { ...pose("b"), scale: 1.5, mirrored };
    const fp = pose("a", 50, 80, 37);
    const cs = [
      ...commonEdgeCandidates(moving, mp, fixed, fp, { rotations: 360 }),
    ];
    assert.ok(cs.length > 0);
    for (const c of cs) {
      assert.ok(
        sharedSection(
          transformEdge(c.fixedEdge, fp),
          transformEdge(c.movingEdge, c.placement),
        ),
      );
      assert.equal(c.placement.scale, 1.5);
      assert.equal(c.placement.mirrored, mirrored);
    }
    assert.equal(
      [...commonEdgeCandidates(moving, mp, fixed, fp, { rotations: 4 })].length,
      0,
    );
  }
});
test("pipeline emits common-edge candidates but keeps existing positive-clearance rejection", () => {
  const parts = [box("a", 30), box("b", 20)],
    initial = [pose("a", 5, 5), pose("b", 5, 35)];
  const settings = {
    width: 100,
    height: 100,
    margin: 2,
    gap: 2,
    scale: 1,
    rotations: 4,
    allowMirror: false,
    minOffcutSide: 20,
  };
  let generated = 0;
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 1500,
    passes: 1,
    onCandidate: (c) => {
      generated++;
      assert.equal(c.source, "common-edge");
      assert.ok(c.sharedSection.length > 0);
      const trial = initial.map((p) =>
        p.id === c.placement.id
          ? c.placement
          : p.id === c.fixedPartId
            ? c.fixedPlacement
            : p,
      );
      assert.ok(validateLayout(parts, trial, settings).length > 0);
    },
  });
  assert.ok(generated > 0);
  assert.equal(result.commonEdgeCandidateCount, generated);
  assert.deepEqual(validateLayout(parts, result.placements, settings), []);
});
