import test from "node:test";
import assert from "node:assert/strict";
import { pocketTranslations } from "../dist/pocket-search.js";
import { compactLayout } from "../dist/compaction.js";
import {
  bounds,
  transformed,
  validateLayout,
  sampleParts,
} from "../dist/geometry.js";
import { evaluateLayout, improves } from "../dist/search.js";
const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
const L = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 15 },
  { x: 15, y: 15 },
  { x: 15, y: 100 },
  { x: 0, y: 100 },
];
const t = (id, x, y) => ({
  id,
  x,
  y,
  angle: 0,
  sheet: 0,
  scale: 1,
  mirrored: false,
});
test("configuration-space search finds an L pocket excluded by bounding-box anchors", () => {
  const obstacle = L.map((p) => ({ x: p.x + 5, y: p.y + 5 }));
  const candidates = pocketTranslations(
    rect(50, 50),
    [obstacle],
    { x: 5, y: 5, w: 190, h: 190 },
    2,
  );
  assert.ok(
    candidates.some((p) => p.x > 21 && p.x < 23 && p.y > 21 && p.y < 23),
  );
  const parts = [
    { id: "L", outer: L },
    { id: "box", outer: rect(50, 50) },
  ];
  for (const p of candidates)
    assert.deepEqual(
      validateLayout(parts, [t("L", 5, 5), t("box", p.x, p.y)], {
        width: 200,
        height: 200,
        margin: 5,
        gap: 2,
      }),
      [],
    );
});
test("concave-part layout relocates both arches out of the lower area", () => {
  const arch = sampleParts().find((p) => p.name.startsWith("Arch")).outer;
  const parts = [
    { id: "wall", outer: rect(90, 350) },
    { id: "L1", outer: L },
    { id: "L2", outer: L },
    { id: "A1", outer: arch },
    { id: "A2", outer: arch },
  ];
  const initial = [
    t("wall", 5.03, 5.03),
    t("L1", 100, 5.03),
    t("L2", 100, 120),
    t("A1", 125, 245),
    t("A2", 125, 315),
  ];
  const settings = {
    width: 420,
    height: 380,
    margin: 5,
    gap: 2,
    rotations: 1,
    scale: 1,
    allowMirror: false,
  };
  const before = evaluateLayout(parts, initial, settings);
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 6000,
    passes: 2,
  });
  assert.deepEqual(validateLayout(parts, result.placements, settings), []);
  for (const id of ["A1", "A2"]) {
    const p = result.placements.find((p) => p.id === id);
    const b = bounds(transformed(arch, p));
    assert.ok(
      b.y + b.h < 245,
      `${id} must leave the lower area: ${JSON.stringify(b)}`,
    );
  }
  assert.ok(improves(result.report.score, before.score));
  assert.ok(
    result.report.sheets[0].recoveredArea > before.sheets[0].recoveredArea,
  );
});
test("search retains a disconnected cavity even when a part cannot slide through its mouth", () => {
  const C = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 35 },
    { x: 80, y: 35 },
    { x: 80, y: 15 },
    { x: 15, y: 15 },
    { x: 15, y: 85 },
    { x: 80, y: 85 },
    { x: 80, y: 65 },
    { x: 100, y: 65 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];
  const candidates = pocketTranslations(
    rect(40, 40),
    [C],
    { x: 0, y: 0, w: 200, h: 200 },
    2,
  );
  assert.ok(
    candidates.some((p) => p.x > 16 && p.x < 39 && p.y > 16 && p.y < 44),
  );
});
test("pair reinsertion improves a complete layout without losing part identities", () => {
  // Pair repair must preserve every part and publish only complete improvements.
  const frame = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 15 },
    { x: 15, y: 15 },
    { x: 15, y: 220 },
    { x: 100, y: 220 },
    { x: 100, y: 235 },
    { x: 0, y: 235 },
  ];
  const parts = [
    { id: "frame", outer: frame },
    { id: "wide", outer: rect(70, 40) },
    { id: "small", outer: rect(35, 35) },
  ];
  const initial = [
    t("frame", 5.03, 5.03),
    t("small", 22.1, 22.1),
    t("wide", 22.1, 170),
  ];
  const settings = {
    width: 300,
    height: 300,
    margin: 5,
    gap: 2,
    rotations: 1,
    scale: 1,
    allowMirror: false,
  };
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 5000,
    groupOnly: true,
  });
  assert.deepEqual(validateLayout(parts, result.placements, settings), []);
  assert.ok(result.changed);
  assert.ok(
    improves(
      result.report.score,
      evaluateLayout(parts, initial, settings).score,
    ),
  );
  assert.deepEqual(
    result.placements.map((p) => p.id),
    initial.map((p) => p.id),
  );
});

test("screenshot-style sample improves beyond the manual reference while preserving complete groups", () => {
  const parts = sampleParts(),
    t = (n, x, y, angle = 0) => ({
      id: `part-${n}`,
      x,
      y,
      angle,
      sheet: 0,
      scale: 1,
      mirrored: false,
    });
  const settings = {
    width: 420,
    height: 420,
    gap: 2,
    margin: 5,
    scale: 1,
    rotations: 360,
    allowMirror: false,
  };
  const initial = [
    t(1, 5.03, 5.03),
    t(2, 5.03, 107.09),
    t(3, 5.03, 209.15),
    t(4, 99.09, 62.09),
    t(5, 187.15, 155.15, 180),
    t(6, 99.09, 202.21, 270),
    t(7, 99.09, 204.27),
    t(8, 99.09, 5.03),
    t(9, 99.1, 298),
    t(10, 159.1, 410, 180),
    t(11, 5.03, 311.21),
    t(12, 5.03, 353.27),
  ];
  const manual = initial.map((p) => ({ ...p }));
  manual[4].y = 103.15;
  manual[8] = t(9, 121.15, 105.21);
  manual[9] = t(10, 181.15, 281.33, 180);
  assert.deepEqual(validateLayout(parts, initial, settings), []);
  assert.deepEqual(validateLayout(parts, manual, settings), []);
  let accepted = 0;
  const result = compactLayout(parts, initial, settings, {
    milliseconds: 6000,
    groupOnly: true,
    pairOffset: 4,
    onImprove: ({ placements }) => {
      accepted++;
      assert.equal(new Set(placements.map((p) => p.id)).size, parts.length);
      assert.deepEqual(validateLayout(parts, placements, settings), []);
    },
  });
  assert.ok(accepted > 0);
  assert.ok(
    improves(
      result.report.score,
      evaluateLayout(parts, manual, settings).score,
    ),
  );
  assert.ok(
    result.report.sheets[0].recoveredArea >
      evaluateLayout(parts, initial, settings).sheets[0].recoveredArea,
  );
});
