// Run from project root. Baseline snapshot is local and excluded from publishing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
// Reconstruct the instrumented pre-optimisation baseline from current code:
// same sources, caches and early dedup off, saved original offcut collector.
fs.mkdirSync("work/step8-baseline", { recursive: true });
fs.cpSync("dist", "work/step8-baseline/dist", { recursive: true });
fs.copyFileSync(
  "benchmarks/baseline/offcut.js",
  "work/step8-baseline/dist/engine/util/offcut.js",
);
const rows = [];
for (const size of [8, 24, 64])
  for (const mode of ["baseline", "disabled", "enabled", "pairs"]) {
    const runs = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      const process = spawnSync(
        globalThis.process.execPath,
        ["scripts/benchmark-case.mjs", String(size), mode],
        { encoding: "utf8", maxBuffer: 4e6 },
      );
      if (process.status !== 0) throw new Error(process.stderr);
      runs.push(JSON.parse(process.stdout));
    }
    runs.sort((a, b) => a.runtimeMs - b.runtimeMs);
    rows.push({ ...runs[1], runs });
    console.log(JSON.stringify({ ...runs[1], runs: undefined }));
  }
fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(
  "outputs/common-edge-benchmark.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      node: process.version,
      cpu: os.cpus()[0].model,
      method:
        "Median-runtime run of 3 isolated processes per case; 2 × 900 ms jobs, first single-part and then pair-repair continuation. Time-bounded search, not global optimum. Warm-up before measurement. Timings inclusive, not additive.",
      rows,
    },
    null,
    2,
  ),
);
