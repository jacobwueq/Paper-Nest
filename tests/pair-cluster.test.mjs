import test from "node:test";
import assert from "node:assert/strict";
import {
  createPairCluster,
  expandPairCluster,
  expandClusterLayout,
  compactPairClusters,
  findPairClusters,
} from "../dist/pair-cluster.js";
import { commonEdgeCandidates } from "../dist/common-edge.js";
import { contactFromCandidate } from "../dist/common-contact.js";
import {
  area,
  bounds,
  transformed,
  validateLayout,
  clearance,
} from "../dist/geometry.js";
import { exportSVG, exportDXF } from "../dist/exporters.js";
const box = (id, w, h = 10) => ({
  id,
  name: id,
  origin: { x: 0, y: 0 },
  outer: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
  entities: [
    {
      kind: "poly",
      closed: true,
      layer: "CUT",
      vertices: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    },
  ],
});
const pose = (id, x = 0, y = 0) => ({ id, x, y, angle: 0, scale: 1, sheet: 0 });
const settings = {
  width: 200,
  height: 150,
  margin: 2,
  gap: 2,
  scale: 1,
  rotations: 4,
  commonEdgeMode: true,
  minOffcutSide: 10,
};
function pair(w = 40) {
  const a = box("a", 100),
    b = box("b", w),
    ta = pose("a", 20, 40);
  const c = [
    ...commonEdgeCandidates(b, pose("b"), a, ta, { rotations: 1 }),
  ].find(
    (c) =>
      c.fixedEdge.edgeIndex === 0 &&
      c.movingEdge.edgeIndex === 2 &&
      c.placement.x === 20,
  );
  const tb = { ...c.placement, sharedEdges: [contactFromCandidate(c)] };
  return { a, b, ta, tb, cluster: createPairCluster(a, ta, b, tb, 2) };
}
test("two rectangles expose a union exterior without the shared internal edge", () => {
  const { cluster } = pair(100);
  assert.ok(cluster);
  assert.equal(Math.abs(area(cluster.outer)), 2000);
  assert.equal(cluster.outer.length, 4);
  assert.deepEqual(bounds(cluster.outer), { x: 0, y: 0, w: 100, h: 20 });
});
test("partial shared edge yields the exact concave exterior, not a bounding rectangle", () => {
  const { cluster } = pair(40);
  assert.equal(Math.abs(area(cluster.outer)), 1400);
  assert.equal(cluster.outer.length, 6);
  assert.ok(Math.abs(area(cluster.outer)) < cluster.size.w * cluster.size.h);
});
test("macro placement obeys normal external clearance and expansion preserves zero internal gap", () => {
  const { a, b, cluster } = pair(40),
    c = box("c", 10);
  const macro = { ...cluster.placement, x: 2, y: 2 };
  const valid = pose("c", 104, 2),
    invalid = pose("c", 103, 2);
  assert.equal(
    clearance(
      transformed(cluster.outer, macro),
      transformed(c.outer, valid),
      2,
    ),
    true,
  );
  assert.equal(
    clearance(
      transformed(cluster.outer, macro),
      transformed(c.outer, invalid),
      2,
    ),
    false,
  );
  const children = expandPairCluster(cluster, macro);
  assert.deepEqual(
    validateLayout([a, b, c], [...children, valid], settings),
    [],
  );
  assert.ok(validateLayout([a, b, c], [...children, invalid], settings).length);
});
test("cluster rotation and mirroring compose child transforms and keep contact references", () => {
  const { a, b, cluster } = pair(40);
  for (const mirrored of [false, true]) {
    const t = {
      ...cluster.placement,
      x: 80,
      y: 80,
      angle: 37,
      mirrored,
      scale: 0.7,
    };
    const expanded = expandPairCluster(cluster, t);
    assert.deepEqual(
      validateLayout([a, b], expanded, { ...settings, allowMirror: true }),
      [],
    );
    assert.equal(expanded[0].mirrored, mirrored);
    assert.equal(expanded[1].sharedEdges[0].otherPartId, "a");
  }
});
test("normal pocket placement moves a pair as one and scores original children", () => {
  const { a, b, ta, tb } = pair(40),
    before = JSON.stringify([a, b, ta, tb]);
  const result = compactPairClusters([a, b], [ta, tb], settings);
  assert.ok(result.clusterCandidateCount > 0);
  assert.equal(result.clustersMoved, 1);
  assert.deepEqual(validateLayout([a, b], result.placements, settings), []);
  assert.equal(JSON.stringify([a, b, ta, tb]), before);
  assert.deepEqual(
    result.placements.map((t) => t.id),
    ["a", "b"],
  );
});
test("export expansion retains original child geometry, holes and engraving", () => {
  const { a, b, cluster } = pair(40);
  a.entities.push({ kind: "circle", cx: 60, cy: 5, r: 2, layer: "CUT" });
  b.entities.push({
    kind: "poly",
    closed: false,
    vertices: [
      { x: 5, y: 2 },
      { x: 20, y: 2 },
    ],
    layer: "SCORE",
  });
  const expanded = expandClusterLayout(
    [cluster],
    [{ ...cluster.placement, x: 10, y: 10 }],
  );
  assert.equal(expanded.parts[0], a);
  assert.equal(expanded.parts[1], b);
  assert.equal(expanded.parts[0].entities.at(-1).kind, "circle");
  const dxf = exportDXF(expanded.parts, expanded.placements, 0, settings);
  const svg = exportSVG(expanded.parts, expanded.placements, 0, settings);
  assert.match(dxf, /CIRCLE/);
  assert.match(dxf, /SCORE/);
  assert.match(svg, /<circle/);
  assert.match(svg, /SCORE/);
});
test("invalid pairs, recursive clusters and larger contact graphs are not clustered", () => {
  const { a, b, ta, tb, cluster } = pair(40);
  assert.equal(createPairCluster(a, ta, b, { ...tb, x: tb.x + 1 }, 2), null);
  assert.equal(createPairCluster(cluster, cluster.placement, b, tb, 2), null);
  const c = box("c", 10),
    tc = { ...pose("c", 150, 100), sharedEdges: [{ otherPartId: "a" }] };
  assert.equal(findPairClusters([a, b, c], [ta, tb, tc], 2).length, 0);
});
