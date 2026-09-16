import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  searchPlan,
  layoutScore,
  improves,
  searchSeed,
} from "../dist/search.js";
import { identifyParts, parseDXF } from "../dist/importers.js";
import { exportDXF, exportSVG } from "../dist/exporters.js";
import { transform, validateLayout, bounds } from "../dist/geometry.js";

const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const parts = [
  { id: "a", outer: rect(100, 10) },
  { id: "b", outer: rect(20, 20) },
];
const t = (id, x = 5, y = 5, angle = 0, sheet = 0) => ({
  id,
  x,
  y,
  angle,
  sheet,
});

test("automatic budgets refine to 1°; continuation honours manual constraints", () => {
  assert.deepEqual(
    searchPlan(0).map((s) => s.rotations),
    [24, 72, 360],
  );
  assert.equal(
    searchPlan(0).reduce((s, p) => s + p.seconds, 0),
    60,
  );
  assert.deepEqual(searchPlan(0, true), [{ rotations: 360, seconds: 30 }]);
  for (const rotations of [1, 4, 12, 24, 72, 360]) {
    assert.deepEqual(searchPlan(rotations, true), [{ rotations, seconds: 30 }]);
  }
  assert.throws(() => searchPlan(13));
});
test("score prioritises completeness, sheets and true rotated occupied width", () => {
  const upright = [t("a"), t("b", 110)];
  const narrow = [t("a", 15, 5, 90), t("b", 5, 110)];
  assert.equal(layoutScore(parts, upright)[2], 125);
  assert.ok(Math.abs(layoutScore(parts, narrow)[2] - 20) < 1e-9);
  assert.ok(improves(layoutScore(parts, narrow), layoutScore(parts, upright)));
  assert.ok(
    improves(layoutScore(parts, upright), layoutScore(parts, [t("a")])),
  );
  assert.ok(
    improves(
      layoutScore(parts, upright),
      layoutScore(parts, [t("a"), t("b", 5, 5, 0, 1)]),
    ),
  );
  const translated = upright.map((p) => ({ ...p, x: p.x + 100, y: p.y + 100 }));
  assert.deepEqual(layoutScore(parts, translated), layoutScore(parts, upright));
});
test("a worse stage or continuation cannot replace the incumbent", () => {
  let best = [0, 1, 150];
  for (const proposed of [
    [1, 1, 50],
    [0, 2, 80],
    [0, 1, 160],
    [0, 1, 140],
    [0, 1, 145],
  ]) {
    if (improves(proposed, best)) best = proposed;
  }
  assert.deepEqual(best, [0, 1, 140]);
  assert.equal(improves([0, 1, 140 + 1e-7], best), false);
});
test("seed preserves insertion order and identities with wrapped integer angles", () => {
  const p = [t("b", 0, 0, -1), t("a", 0, 0, 37.00000001)];
  assert.deepEqual(searchSeed(p), [
    { id: "b", angle: 359 },
    { id: "a", angle: 37 },
  ]);
  assert.equal(p[0].angle, -1);
});

// Exercise the vendored implementation itself, exposing its private GA only in
// this test VM. No production debug API or DOM/browser dependency is introduced.
function engine(random = () => 0.5) {
  const context = vm.createContext({
    console,
    Math: Object.assign(Object.create(Math), { random }),
  });
  context.window = context;
  vm.runInContext(
    fs.readFileSync("dist/engine/util/geometryutil.js", "utf8"),
    context,
  );
  const src = fs
    .readFileSync("dist/engine/svgnest.js", "utf8")
    .replace(
      "root.SvgNest = new SvgNest();",
      "root.SvgNest = new SvgNest(); root.TestGA = GeneticAlgorithm;",
    );
  vm.runInContext(src, context);
  return context;
}
function gaParts() {
  return [
    Object.assign(rect(20, 10), { id: 1, seedAngle: 37 }),
    Object.assign(rect(10, 15), { id: 2, seedAngle: 359 }),
  ];
}
test("fine engine initialises with inherited 37° and 359° angles", () => {
  const ctx = engine();
  const ga = new ctx.TestGA(gaParts(), rect(200, 200), {
    rotations: 360,
    populationSize: 3,
    mutationRate: 15,
    refine: true,
  });
  assert.deepEqual(Array.from(ga.population[0].rotation), [37, 359]);
});
test("rotation follows the same part when insertion order mutates", () => {
  const ctx = engine();
  const ga = new ctx.TestGA(gaParts(), rect(200, 200), {
    rotations: 360,
    populationSize: 3,
    mutationRate: 15,
  });
  const values = [0, 0.9, 0.9, 0.9];
  ctx.Math.random = () => values.shift() ?? 0.9;
  const next = ga.mutate(ga.population[0]);
  assert.deepEqual(
    Array.from(next.placement, (p) => p.id),
    [2, 1],
  );
  assert.deepEqual(Array.from(next.rotation), [359, 37]);
  assert.deepEqual(Array.from(ga.population[0].rotation), [37, 359]);
});
test("local fine mutations propose off-5° angles and wrap through 0°", () => {
  const ctx = engine();
  const ga = new ctx.TestGA(gaParts(), rect(200, 200), {
    rotations: 360,
    populationSize: 3,
    mutationRate: 15,
    refine: true,
  });
  for (const [current, expected] of [
    [35, 36],
    [359, 0],
  ]) {
    const values = [0.9, 0];
    ctx.Math.random = () => values.shift() ?? 0;
    assert.equal(ga.refinedAngle(gaParts()[0], current), expected);
  }
});
test("fine angle candidates respect the selected grid and bin bounds", () => {
  const ctx = engine();
  const ga = new ctx.TestGA(gaParts(), rect(32, 17), {
    rotations: 72,
    populationSize: 3,
    mutationRate: 15,
    refine: true,
  });
  const p = rect(30, 10);
  for (let i = 0; i < 100; i++) {
    const angle = ga.refinedAngle(p, 0);
    assert.equal(angle % 5, 0);
    assert.ok(ga.fits(p, angle));
  }
});
test("single-part sheet width contributes to worker fitness; missing part loses", () => {
  const ctx = engine();
  vm.runInContext(
    fs.readFileSync("dist/engine/util/placementworker.js", "utf8"),
    ctx,
  );
  const p = Object.assign(rect(20, 10), { id: 0, rotation: 0, source: 0 });
  const key = JSON.stringify({
    A: -1,
    B: 0,
    inside: true,
    Arotation: 0,
    Brotation: 0,
  });
  const worker = new ctx.PlacementWorker(
    rect(100, 100),
    [p],
    [0],
    [0],
    {},
    { [key]: [[{ x: 0, y: 0 }]] },
  );
  ctx.global = { env: { self: worker } };
  const result = worker.placePaths([p]);
  assert.equal(result.placements.length, 1);
  assert.equal(result.fitness, 1.1);
  worker.nfpCache = {};
  assert.ok(worker.placePaths([p]).fitness > result.fitness);
});
test("1° rotations preserve hole, engraving, distances and full-scale exports", () => {
  const entities = [
    { kind: "poly", closed: true, layer: "CUT", vertices: rect(100, 50) },
    { kind: "circle", closed: true, layer: "CUT", cx: 25, cy: 25, r: 4 },
    {
      kind: "poly",
      closed: false,
      layer: "SCORE",
      vertices: [
        { x: 10, y: 10 },
        { x: 80, y: 10 },
      ],
    },
  ];
  const ps = identifyParts(entities);
  const settings = { width: 420, height: 297, gap: 2, margin: 5 };
  for (const angle of [1, 37, 359]) {
    const placement = t(ps[0].id, 100, 30, angle);
    assert.deepEqual(validateLayout(ps, [placement], settings), []);
    const a = transform({ x: 0, y: 0 }, placement),
      b = transform({ x: 100, y: 0 }, placement);
    assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 100) < 1e-9);
    const exported = exportDXF(ps, [placement], 0, settings);
    const back = parseDXF(exported).parts;
    assert.equal(back.length, 1);
    assert.equal(back[0].entities.length, 3);
    assert.equal(back[0].entities.find((e) => e.kind === "circle").r, 4);
    const poly = back[0].entities.find((e) => e.kind === "poly" && e.closed);
    assert.ok(
      Math.abs(
        Math.hypot(
          poly.vertices[1].x - poly.vertices[0].x,
          poly.vertices[1].y - poly.vertices[0].y,
        ) - 100,
      ) < 1e-5,
    );
    const svg = exportSVG(ps, [placement], 0, settings);
    assert.match(svg, /width="420mm"/);
    assert.match(svg, /height="297mm"/);
    assert.match(svg, new RegExp(`rotate\\(${angle}\\)`));
  }
});
