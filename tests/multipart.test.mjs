import test from "node:test";
import assert from "node:assert/strict";
import {
  commonEdgeCandidates,
  extractPartEdges,
  transformEdge,
  sharedSection,
} from "../dist/common-edge.js";
import {
  contactFromCandidate,
  contactsAtPlacement,
  commonContactClearance,
} from "../dist/common-contact.js";
import { createPartCluster, expandPairCluster } from "../dist/pair-cluster.js";
import { transform, validateLayout } from "../dist/geometry.js";
const box = (id, w = 30, h = 10, angle = 0) => {
  const outer = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ].map((p) => transform(p, { x: 0, y: 0, angle }));
  return {
    id,
    name: id,
    outer,
    origin: { x: 0, y: 0 },
    entities: [{ kind: "poly", closed: true, layer: "CUT", vertices: outer }],
  };
};
const pose = (id, x = 0, y = 0, angle = 0) => ({
  id,
  x,
  y,
  angle,
  sheet: 0,
  scale: 1,
});
function linked(parts, poses) {
  return poses.map((t) => ({
    ...t,
    sharedEdges: contactsAtPlacement(
      parts.find((p) => p.id === t.id),
      t,
      parts,
      poses,
    ),
  }));
}
export { box, pose, linked };
test("A/E/F: exact contact angles 45°, 37°, 63.5° include 60/35 partial overlaps", () => {
  for (const angle of [45, 37, 63.5, 63.50000003]) {
    const a = box("a", 60, 10, angle),
      b = box("b", 35, 10),
      ta = pose("a", 100, 100),
      tb = pose("b");
    const cs = [
      ...commonEdgeCandidates(b, tb, a, ta, {
        rotations: 360,
        diagonalCommonEdgesEnabled: true,
      }),
    ];
    const good = cs.find(
      (c) =>
        Math.abs(c.sharedSection.length - 35) < 1e-6 &&
        commonContactClearance(
          a,
          ta,
          b,
          { ...c.placement, sharedEdges: [contactFromCandidate(c)] },
          2,
        ).valid,
    );
    assert.ok(good, `missing ${angle}`);
    assert.ok(Math.abs(good.sharedSection.length - 35) < 1e-6);
  }
});
test("multiple genuine contacts at one placement survive validation", () => {
  const parts = [box("a"), box("b"), box("c")],
    ps = linked(parts, [
      pose("a", 10, 10),
      pose("b", 40, 10),
      pose("c", 70, 10),
    ]);
  assert.equal(ps[1].sharedEdges.length, 2);
  assert.deepEqual(
    validateLayout(parts, ps, {
      width: 120,
      height: 60,
      margin: 2,
      gap: 2,
      commonEdgeMode: true,
    }),
    [],
  );
});
test("B/C: three and four children expose one true union and original geometry", () => {
  for (const n of [3, 4]) {
    const parts = Array.from({ length: n }, (_, i) => box(String(i))),
      ps = linked(
        parts,
        parts.map((p, i) => pose(p.id, 5 + i * 30, 5)),
      );
    const cluster = createPartCluster(parts, ps, 2);
    assert.ok(cluster);
    assert.equal(cluster.children.length, n);
    assert.ok(Math.abs(cluster.size.w - n * 30) < 1e-6);
    assert.equal(cluster.outer.length, 4);
    const expanded = expandPairCluster(cluster);
    for (let i = 0; i < n; i++) {
      assert.equal(cluster.children[i].part, parts[i]);
      assert.ok(Math.abs(expanded[i].x - ps[i].x) < 1e-6);
    }
  }
});
import {
  searchMultiPartClusters,
  compactMultiPartClusters,
} from "../dist/multi-cluster.js";
const settings = {
  width: 160,
  height: 100,
  margin: 2,
  gap: 2,
  rotations: 4,
  commonEdgeMode: true,
  diagonalCommonEdgesEnabled: true,
  maxClusterParts: 4,
  clusterBeamWidth: 8,
  minOffcutSide: 10,
};
test("B/C/D: beam expands multiple memberships to three and four children", () => {
  const parts = [box("a", 30), box("b", 40), box("c", 20), box("d", 25)],
    ps = parts.map((p, i) => pose(p.id, 5 + i * 35, 40));
  const result = searchMultiPartClusters(parts, ps, settings);
  assert.ok(result.levels[1].some((s) => s.ids.length === 3));
  assert.ok(result.levels[2].some((s) => s.ids.length === 4));
  assert.ok(
    result.levels[1].some((s) => s.ids.join("") === "acd"),
    "alternative membership ACD must survive",
  );
  for (const state of result.candidates) {
    const expanded = expandPairCluster(state.cluster, {
      ...state.cluster.placement,
      x: 5,
      y: 5,
    });
    assert.deepEqual(
      validateLayout(
        state.cluster.children.map((c) => c.part),
        expanded,
        { ...settings, width: 500, height: 500 },
      ),
      [],
    );
  }
});
import { evaluateLayout, improves } from "../dist/search.js";
import { mergeCommonLines, lineLength } from "../dist/common-line.js";
import { prepareCommonLineExport } from "../dist/common-line-export.js";
import { exportDXF } from "../dist/exporters.js";
import { remnantPlan } from "../dist/remnant-policy.js";
import { compactLayout } from "../dist/compaction.js";
test("B: a three-part global move beats the best pair move on the same sheet", () => {
  const parts = [box("a"), box("b"), box("c")],
    ps = [pose("a", 5, 40), pose("b", 60, 40), pose("c", 110, 40)];
  const opts = { now: () => 0, deadline: Infinity };
  const pair = compactMultiPartClusters(
    parts,
    ps,
    { ...settings, maxClusterParts: 2 },
    opts,
  );
  const triple = compactMultiPartClusters(
    parts,
    ps,
    { ...settings, maxClusterParts: 3 },
    opts,
  );
  assert.equal(triple.maxClusterSize, 3);
  assert.ok(triple.changed);
  assert.ok(improves(triple.report.score, pair.report.score));
  assert.deepEqual(validateLayout(parts, triple.placements, settings), []);
});
test("D: a locally attractive AB pair does not suppress the globally better ACD", () => {
  const parts = [box("a", 30), box("b", 30), box("c", 10), box("d", 20)],
    ps = [
      pose("a", 100, 20),
      pose("b", 2, 2),
      pose("c", 60, 50),
      pose("d", 100, 50),
    ];
  const events = [];
  const r = compactMultiPartClusters(
    parts,
    ps,
    { ...settings, maxClusterParts: 3 },
    { now: () => 0, deadline: Infinity, onDebug: (e) => events.push(e) },
  );
  assert.ok(
    events.some(
      (e) => e.stage === "cluster-global" && e.ids.join("") === "acd",
    ),
  );
  assert.ok(
    events.some(
      (e) => e.stage === "cluster-selected" && e.ids.join("") === "acd",
    ),
  );
  assert.ok(
    improves(r.report.score, evaluateLayout(parts, ps, settings).score),
  );
});
test("G/H: preserved remnant plans constrain placement only while preservation is enabled", () => {
  const parts = [box("a", 60, 10, 45), box("b", 35, 10)],
    ta = pose("a", 90, 90);
  const c = [
    ...commonEdgeCandidates(parts[1], pose("b"), parts[0], ta, {
      rotations: 360,
      diagonalCommonEdgesEnabled: true,
    }),
  ].find(
    (c) =>
      commonContactClearance(
        parts[0],
        ta,
        parts[1],
        { ...c.placement, sharedEdges: [contactFromCandidate(c)] },
        2,
      ).valid,
  );
  const poses = [
    ta,
    { ...c.placement, sharedEdges: [contactFromCandidate(c)] },
  ];
  const b = boundsFor(parts[1], c.placement);
  const preservedRemnants = remnantPlan([
    { x: b.x + 1, y: b.y + 1, w: 3, h: 3 },
  ]);
  assert.equal(preservedRemnants[0].splitLines[0].role, "generated-split-line");
  const config = {
    ...settings,
    width: 250,
    height: 250,
    preservedRemnants,
    preserveRemnantSplitLines: true,
  };
  assert.ok(
    validateLayout(parts, poses, config).some((e) =>
      e.includes("preserved-remnant"),
    ),
  );
  assert.deepEqual(
    validateLayout(parts, poses, {
      ...config,
      preserveRemnantSplitLines: false,
    }),
    [],
  );
  assert.equal(parts.length, 2, "remnants are never converted to parts");
});
function boundsFor(p, t) {
  const q = p.outer.map((v) => transform(v, t));
  return {
    x: Math.min(...q.map((p) => p.x)),
    y: Math.min(...q.map((p) => p.y)),
  };
}
test("F/I: diagonal 60/35 sharing preserves 25 mm tail and handles three owners", () => {
  const d = {
      x: Math.cos((63.5 * Math.PI) / 180),
      y: Math.sin((63.5 * Math.PI) / 180),
    },
    at = (t) => ({ x: 10 + t * d.x, y: 10 + t * d.y });
  const result = mergeCommonLines([
    { start: at(0), end: at(60), owner: "A" },
    { start: at(0), end: at(35), owner: "B" },
    { start: at(10), end: at(25), owner: "C" },
  ]);
  assert.ok(
    Math.abs(result.reduce((s, e) => s + lineLength(e), 0) - 60) < 1e-6,
  );
  assert.ok(
    Math.abs(
      result.filter((e) => e.shared).reduce((s, e) => s + lineLength(e), 0) -
        35,
    ) < 1e-6,
  );
  assert.ok(result.some((e) => e.owners.length === 3));
  assert.ok(
    Math.abs(
      result.filter((e) => !e.shared).reduce((s, e) => s + lineLength(e), 0) -
        25,
    ) < 1e-6,
  );
});
test("I: four child export cuts every shared interval once", () => {
  const parts = ["a", "b", "c", "d"].map((id) => box(id)),
    ps = linked(
      parts,
      parts.map((p, i) => pose(p.id, 5 + 30 * i, 5)),
    );
  const prepared = prepareCommonLineExport(parts, ps, 0);
  const lines = prepared.flatMap((p) => p.entities),
    length = lines.reduce(
      (s, e) =>
        s +
        Math.hypot(
          e.vertices[1].x - e.vertices[0].x,
          e.vertices[1].y - e.vertices[0].y,
        ),
      0,
    );
  assert.equal(length, 4 * 80 - 3 * 10);
  assert.equal(lines.filter((e) => e.segmentOwners?.length === 2).length, 3);
  assert.match(
    exportDXF(
      parts,
      ps,
      0,
      { ...settings, width: 200 },
      { mergeCommonLines: true },
    ),
    /\nEOF\n/,
  );
});
test("debug traces include generated contacts, rejection reasons and scored decisions", () => {
  const parts = [box("a"), box("b")],
    ps = [pose("a", 5, 5), pose("b", 70, 5)];
  const r = compactLayout(parts, ps, settings, {
    passes: 1,
    milliseconds: 300,
    debug: true,
    debugLimit: 3000,
  });
  assert.ok(
    r.diagnostics.events.some(
      (e) => e.stage === "generated" && e.sharedLength > 0,
    ),
  );
  assert.ok(
    r.diagnostics.events.some(
      (e) => e.stage === "candidate" && e.reason === "validation",
    ),
  );
  assert.ok(
    r.diagnostics.events.some(
      (e) => e.stage === "candidate" && e.score && e.decidingCriterion,
    ),
  );
});
import fs from "node:fs";
test("J: all new features disabled match frozen v0.9.2 placements, scoring and candidate counts", () => {
  const fixture = JSON.parse(
    fs.readFileSync(
      new URL(
        "../benchmarks/baseline/multipart-disabled-v092.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const expected of fixture) {
    const parts = [30, 20].map((w, i) => ({
      id: String(i),
      outer: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: 10 },
        { x: 0, y: 10 },
      ],
    }));
    const poses = parts.map((p, i) => ({
      id: p.id,
      x: 2,
      y: 2 + i * 30,
      angle: 0,
      sheet: 0,
      scale: 1,
    }));
    const r = compactLayout(
      parts,
      poses,
      {
        width: 100,
        height: 100,
        margin: 2,
        gap: 2,
        scale: 1,
        rotations: 4,
        commonEdgeMode: expected.enabled,
        multiPartClusteringEnabled: false,
        diagonalCommonEdgesEnabled: false,
        preserveRemnantSplitLines: false,
        minOffcutSide: 20,
      },
      { passes: 1, now: () => 0, profile: true },
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(r.placements)),
      expected.placements,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(r.report)), expected.report);
    assert.equal(r.profile.counts.generatedCandidates, expected.candidates);
  }
});

import { clusterPierceLowerBound } from "../dist/cluster-pierces.js";
import { profiled } from "../dist/nesting-profile.js?v=0.13.0";
test("pierce lower bound retains separate holes after joining outer contours", () => {
  const parts = [box("a"), box("b")];
  parts[0].entities.push({ kind: "circle", cx: 8, cy: 5, r: 1, layer: "CUT" });
  const ps = linked(parts, [pose("a"), pose("b", 30)]);
  assert.equal(clusterPierceLowerBound(parts, ps), 2);
});
test("contact cache and bounds rejection preserve exact candidate geometry", () => {
  const parts = [box("a", 60, 10, 63.5), box("b", 35)];
  const ta = pose("a", 80, 80),
    c = [
      ...commonEdgeCandidates(parts[1], pose("b"), parts[0], ta, {
        diagonalCommonEdgesEnabled: true,
      }),
    ][0];
  const ps = [ta, c.placement];
  const run = (optimise) =>
    profiled({ profile: true, optimise }, () => ({
      contacts: Array.from({ length: 4 }, () =>
        contactsAtPlacement(parts[1], c.placement, parts, ps),
      ),
    }));
  const cached = run(true),
    plain = run(false);
  assert.deepEqual(cached.contacts, plain.contacts);
  assert.ok(cached.profile.counts.contactDiscoveryCacheHits >= 3);
  assert.ok(cached.profile.counts.contactDiscoveryBoundsRejected > 0);
});

import { compatibilityGraph } from "../dist/multi-cluster.js";
test("graph deadline still enforces neighbour bounds", () => {
  const parts = Array.from({ length: 30 }, (_, i) => box(String(i))),
    ps = parts.map((p) => pose(p.id));
  let calls = 0;
  const graph = compatibilityGraph(
    parts,
    ps,
    { ...settings, clusterBeamWidth: 2 },
    { shouldStop: () => ++calls > 25 },
  );
  assert.ok([...graph.values()].every((links) => links.length <= 4));
});
test("C: a four-part cluster participates in global placement and preserves clearance", () => {
  const parts = ["a", "b", "c", "d"].map((id) => box(id)),
    ps = parts.map((p, i) => pose(p.id, 5 + i * 37, 40));
  const events = [],
    r = compactMultiPartClusters(parts, ps, settings, {
      now: () => 0,
      deadline: Infinity,
      onDebug: (e) => {
        if (e.stage === "cluster-selected") events.push(e);
      },
    });
  assert.ok(events.some((e) => e.ids.length === 4));
  assert.deepEqual(validateLayout(parts, r.placements, settings), []);
});

test("preserved remnant constraints also hold with common-edge mode off", () => {
  const parts = [box("a")],
    ps = [pose("a", 90, 60)],
    config = {
      ...settings,
      commonEdgeMode: false,
      preserveRemnantSplitLines: true,
      preservedRemnants: remnantPlan([{ x: 2, y: 2, w: 50, h: 50 }]),
    };
  const r = compactLayout(parts, ps, config, { passes: 1, now: () => 0 });
  assert.deepEqual(validateLayout(parts, r.placements, config), []);
});

import { visibleRemnantRectangles } from "../dist/remnant-policy.js";
test("preserved offcut display retains area and excludes conflicting new rectangles", () => {
  const plan = remnantPlan([{ x: 2, y: 2, w: 20, h: 20 }]);
  const current = [
    { x: 2, y: 2, w: 21, h: 20 },
    { x: 23, y: 2, w: 10, h: 10 },
    { x: 30, y: 2, w: 10, h: 10 },
  ];
  const result = visibleRemnantRectangles(current, plan, 0, 2);
  assert.equal(result.length, 2);
  assert.equal(result[0].area, 400);
  assert.equal(result[1].x, 30);
});

test("common-edge master switch off preserves legacy search with new sub-options enabled", () => {
  const parts = [box("a"), box("b", 20)],
    ps = [pose("a", 2, 2), pose("b", 2, 32)];
  const run = (enabled) =>
    compactLayout(
      parts,
      ps,
      {
        ...settings,
        width: 100,
        commonEdgeMode: false,
        multiPartClusteringEnabled: enabled,
        diagonalCommonEdgesEnabled: enabled,
      },
      { passes: 1, now: () => 0, profile: true },
    );
  const off = run(false),
    on = run(true);
  assert.deepEqual(on.placements, off.placements);
  assert.deepEqual(on.report, off.report);
  assert.equal(
    on.profile.counts.generatedCandidates,
    off.profile.counts.generatedCandidates,
  );
});

test("cluster portfolio never replaces a better ordinary search branch", () => {
  const parts = [box("a"), box("b"), box("c")],
    ps = [pose("a", 5, 40), pose("b", 60, 40), pose("c", 110, 40)];
  const ordinary = compactLayout(
    parts,
    ps,
    { ...settings, multiPartClusteringEnabled: false, pairClusters: false },
    { passes: 1, now: () => 0 },
  );
  const portfolio = compactLayout(
    parts,
    ps,
    { ...settings, multiPartClusteringEnabled: true },
    { passes: 1, now: () => 0 },
  );
  assert.ok(!improves(ordinary.report.score, portfolio.report.score));
  assert.deepEqual(validateLayout(parts, portfolio.placements, settings), []);
});
