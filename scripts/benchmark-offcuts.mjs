import fs from "node:fs";
import { sampleParts, transformed } from "../dist/geometry.js";
await import("../benchmarks/baseline/offcut.js");
const baseline = { PaperOffcut: globalThis.PaperOffcut };
await import("../dist/engine/util/offcut.js");
const optimised = { PaperOffcut: globalThis.PaperOffcut };
const rows = [];
for (const size of [8, 24, 64]) {
  const parts = sampleParts(),
    cols = Math.ceil(Math.sqrt(size));
  const polys = Array.from({ length: size }, (_, i) =>
    transformed(parts[i % parts.length].outer, {
      x: 5 + (i % cols) * 105,
      y: 5 + Math.floor(i / cols) * 110,
      angle: 0,
    }),
  );
  const sheet = { x: 5, y: 5, w: cols * 105, h: Math.ceil(size / cols) * 110 };
  const before = baseline.PaperOffcut.collect(polys, sheet, 2.03, 20);
  const after = optimised.PaperOffcut.collect(polys, sheet, 2.03, 20);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Offcut behaviour changed");
  const times = {};
  for (const [label, ctx] of [
    ["baseline", baseline],
    ["optimised", optimised],
  ]) {
    const samples = [];
    for (let n = 0; n < 5; n++) {
      const start = performance.now();
      for (let j = 0; j < 3; j++)
        ctx.PaperOffcut.collect(polys, sheet, 2.03, 20);
      samples.push((performance.now() - start) / 3);
    }
    times[label] = samples.sort((a, b) => a - b)[2];
  }
  rows.push({
    size,
    baselineMs: times.baseline,
    optimisedMs: times.optimised,
    speedup: times.baseline / times.optimised,
    identical: true,
  });
}
fs.writeFileSync(
  "outputs/offcut-fixed-work-benchmark.json",
  JSON.stringify(rows, null, 2),
);
console.log(JSON.stringify(rows));
