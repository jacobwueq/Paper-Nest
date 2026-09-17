import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  searchSettings,
  evaluateLayout,
  layoutScore,
  improves,
  searchSeed,
} from "../dist/search.js";
import { identifyParts, parseDXF } from "../dist/importers.js";
import { exportDXF, exportSVG } from "../dist/exporters.js";
import {
  transform,
  validateLayout,
  bounds,
  sampleArc,
} from "../dist/geometry.js";

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

const settings = { width: 200, height: 200, margin: 0, gap: 0 };
test("all selected angles are available immediately without timed stages", () => {
  for (const rotations of [1, 4, 12, 24, 72, 360])
    assert.deepEqual(searchSettings(rotations), { rotations, seconds: 20 });
  assert.throws(() => searchSettings(0));
});
test("largest offcut has priority over the remaining area", () => {
  const ps = [
    { id: "a", outer: rect(70, 20) },
    { id: "b", outer: rect(70, 20) },
  ];
  const narrow = [t("a", 0, 0), t("b", 0, 22)];
  const compact = [t("a", 0, 0), t("b", 72, 0)];
  const report = evaluateLayout(ps, compact, settings);
  assert.ok(improves(report.score, layoutScore(ps, narrow, settings)));
  assert.ok(report.sheets[0].rectangle.area > 35900);
  assert.ok(improves(report.score, layoutScore(ps, [t("a")], settings)));
  assert.ok(
    improves(
      report.score,
      layoutScore(ps, [t("a"), t("b", 0, 0, 0, 1)], settings),
    ),
  );
});
test("a worse candidate or continuation cannot replace the incumbent", () => {
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
  vm.runInContext(
    fs.readFileSync("dist/engine/util/offcut.js", "utf8"),
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
test("engine enables reflected orientations only when requested", () => {
  const ctx = engine(() => 0);
  for (const allowMirror of [false, true]) {
    const ps = gaParts();
    ps[0].seedAngle = 383;
    const ga = new ctx.TestGA(ps, rect(200, 200), {
      rotations: 360,
      populationSize: 3,
      mutationRate: 15,
      refine: true,
      allowMirror,
    });
    assert.equal(ga.population[0].rotation[0], allowMirror ? 383 : 23);
    ga.config.rotations = 1;
    assert.equal(ga.randomAngle(ps[0]), allowMirror ? 360 : 0);
    ga.config.rotations = 360;
    const values = [0.9, 0];
    ctx.Math.random = () => values.shift() ?? 0;
    assert.equal(ga.refinedAngle(ps[0], 383), allowMirror ? 384 : 24);
  }
});
test("worker reflection matches drawing transforms while preserving polygon winding", () => {
  const ctx = engine();
  vm.runInContext(
    fs.readFileSync("dist/engine/util/placementworker.js", "utf8"),
    ctx,
  );
  const polygon = [
    { x: 2, y: 3 },
    { x: 31, y: 5 },
    { x: 6, y: 19 },
  ];
  polygon.children = [rect(3, 2)];
  const rotated = ctx.rotatePolygon(polygon, 383);
  const expected = polygon
    .map((p) => transform(p, { x: 0, y: 0, angle: 23, mirrored: true }))
    .reverse();
  expected.forEach((p, i) => {
    assert.ok(Math.hypot(p.x - rotated[i].x, p.y - rotated[i].y) < 1e-10);
  });
  assert.equal(
    Math.sign(ctx.GeometryUtil.polygonArea(polygon)),
    Math.sign(ctx.GeometryUtil.polygonArea(rotated)),
  );
  assert.equal(rotated.children.length, 1);
});
test("adapter keeps curved mirrored parts inside physical sheet margins at every degree", () => {
  const ctx = engine();
  ctx.navigator = { appName: "Netscape", userAgent: "" };
  ctx.self = ctx;
  ctx.SvgParser = { config() {} };
  vm.runInContext(fs.readFileSync("dist/engine/util/clipper.js", "utf8"), ctx);
  vm.runInContext(
    fs.readFileSync("dist/engine/util/placementworker.js", "utf8"),
    ctx,
  );
  let start, config, display, result;
  const parent = {
    postMessage(data) {
      result = data;
    },
  };
  const mock = vm.createContext({
    window: {
      addEventListener(type, callback) {
        if (type === "message") start = callback;
      },
    },
    parent,
    location: { origin: "http://test" },
    SvgNest: {
      config(value) {
        config = value;
      },
      parsesvg() {
        return {
          querySelector() {
            return {};
          },
        };
      },
      setbin() {},
      start(progress, callback) {
        display = callback;
      },
    },
  });
  vm.runInContext(fs.readFileSync("dist/engine/adapter.js", "utf8"), mock);
  const part = {
    id: "circle",
    name: "Circle",
    outer: sampleArc(32.42, 32.42, 32.42, 0, Math.PI * 2).slice(0, -1),
  };
  const settings = {
    width: 200,
    height: 200,
    gap: 2,
    margin: 5,
    scale: 1,
    rotations: 360,
    allowMirror: true,
  };
  start({
    source: parent,
    origin: "http://test",
    data: { type: "start", parts: [part], settings, run: 1 },
  });
  ctx.SvgNest.config(config);
  // SVG polygon coordinates pass through float32 before Clipper sees them.
  const raw = config.offcut.outlines[0].map((p) => ({
    x: Math.fround(p.x),
    y: Math.fround(p.y),
  }));
  const collision = ctx.SvgNest.polygonOffset(
    ctx.SvgNest.cleanPolygon(raw),
    config.spacing / 2,
  )[0];
  const binPad = config.spacing / 2 - config.sheetEdgeSafety;
  for (let angle = 0; angle < 720; angle++) {
    const p = Object.assign(Array.from(collision), {
      id: 0,
      source: 0,
      rotation: angle,
    });
    const bin = rect(190 + 2 * binPad, 190 + 2 * binPad);
    const rotated = ctx.rotatePolygon(p, angle);
    const nfp = ctx.GeometryUtil.noFitPolygonRectangle(bin, rotated);
    const key = JSON.stringify({
      A: -1,
      B: 0,
      inside: true,
      Arotation: 0,
      Brotation: angle,
    });
    const worker = new ctx.PlacementWorker(
      bin,
      [p],
      [0],
      [angle],
      {},
      { [key]: nfp },
    );
    ctx.global = { env: { self: worker } };
    const placed = worker.placePaths([p]).placements[0][0];
    display([
      {
        children: [
          {
            tagName: "g",
            nestPlacement: placed,
            querySelector() {
              return { id: "circle" };
            },
          },
        ],
      },
    ]);
    assert.equal(result.type, "layout");
    assert.deepEqual(
      validateLayout([part], result.placements, settings),
      [],
      `angle ${angle}`,
    );
    assert.equal(result.placements[0].mirrored, angle >= 360);
  }
});
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
test("worker fitness uses reusable offcut and prioritises complete placement", () => {
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
  assert.equal(result.fitness[0], 0);
  assert.equal(result.fitness[1], 1);
  assert.equal(result.fitness[2][0], 9000);
  assert.equal(result.fitness[3], 200);
  worker.nfpCache = {};
  assert.ok(
    ctx.PaperOffcut.compare(worker.placePaths([p]).fitness, result.fitness) > 0,
  );
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

test("initial 1° candidate chooses a compact edge-aligned angle instead of a random rotation", () => {
  const ctx = engine();
  const part = Object.assign(
    rect(100, 10).map((p) => transform(p, { x: 0, y: 0, angle: 23 })),
    { id: 0 },
  );
  const ga = new ctx.TestGA([part], rect(104, 13), {
    rotations: 360,
    populationSize: 3,
    mutationRate: 15,
    refine: true,
  });
  const angle = ga.population[0].rotation[0];
  assert.ok([157, 337].includes(angle));
  assert.ok(ga.fits(part, angle));
});

test("worker and UI measure the same raw contours and clearances", () => {
  const ctx = engine();
  vm.runInContext(
    fs.readFileSync("dist/engine/util/placementworker.js", "utf8"),
    ctx,
  );
  const raw = rect(20, 10).map((p) => ({ x: p.x + 1000, y: p.y }));
  const p = Object.assign(
    raw.map((p) => ({ ...p })),
    { id: 0, rotation: 0, source: 0 },
  );
  const key = JSON.stringify({
    A: -1,
    B: 0,
    inside: true,
    Arotation: 0,
    Brotation: 0,
  });
  const worker = new ctx.PlacementWorker(
    rect(90, 90),
    [p],
    [0],
    [0],
    { offcut: { width: 90, height: 90, padding: 2.03, outlines: [raw] } },
    { [key]: [[{ x: 0, y: 0 }]] },
  );
  ctx.global = { env: { self: worker } };
  const result = worker.placePaths([p]);
  const parentScore = layoutScore(
    [{ id: "a", outer: rect(20, 10) }],
    [t("a", 5, 5)],
    { width: 100, height: 100, margin: 5, gap: 2 },
  );
  assert.equal(ctx.PaperOffcut.compare(result.fitness, parentScore), 0);
});

test("expanded collision bin preserves physical margins without charging the gap twice", () => {
  const ctx = engine();
  vm.runInContext(
    fs.readFileSync("dist/engine/util/placementworker.js", "utf8"),
    ctx,
  );
  const pad = 1.03,
    raw = rect(20, 10).map((p) => ({ x: p.x + 1000, y: p.y }));
  const collision = Object.assign(
    rect(20 + 2 * pad, 10 + 2 * pad).map((p) => ({
      x: p.x + 1000 - pad,
      y: p.y - pad,
    })),
    { id: 0, rotation: 0, source: 0 },
  );
  const key = JSON.stringify({
    A: -1,
    B: 0,
    inside: true,
    Arotation: 0,
    Brotation: 0,
  });
  const worker = new ctx.PlacementWorker(
    rect(90 + 2 * pad, 90 + 2 * pad),
    [collision],
    [0],
    [0],
    {
      offcut: {
        width: 90,
        height: 90,
        padding: 2.03,
        origin: pad,
        outlines: [raw],
      },
    },
    { [key]: [[{ x: 0, y: 0 }]] },
  );
  ctx.global = { env: { self: worker } };
  const result = worker.placePaths([collision]);
  const translation = result.placements[0][0];
  assert.ok(Math.abs(translation.x + 1000 - pad) < 1e-9);
  assert.ok(Math.abs(translation.y - pad) < 1e-9);
  const expected = layoutScore(
    [{ id: "a", outer: rect(20, 10) }],
    [t("a", 5, 5)],
    { width: 100, height: 100, margin: 5, gap: 2 },
  );
  assert.equal(ctx.PaperOffcut.compare(result.fitness, expected), 0);
});
