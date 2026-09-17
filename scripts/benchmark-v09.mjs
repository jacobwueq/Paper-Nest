// Run from project root. Baseline snapshot is local and excluded from publishing.
import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
// Freeze the published v0.9 baseline, including its existing caches.
const baselineCommit = "97399aba5105cd62d9b519ca32d6825393967522";
const files = execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", baselineCommit, "dist"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n");
for (const file of files) {
  const target = "work/perf-v09-baseline/" + file;
  fs.mkdirSync(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  fs.writeFileSync(
    target,
    execFileSync("git", ["show", baselineCommit + ":" + file]),
  );
}
const rows = [];
for (const size of [8, 24, 64])
  for (const mode of ["baseline", "disabled", "baseline-enabled", "enabled"]) {
    const runs = [];
    for (let repetition = 0; repetition < 3; repetition++) {
      const process = spawnSync(
        globalThis.process.execPath,
        ["scripts/benchmark-v09-case.mjs", String(size), mode],
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
  "outputs/performance-step8-v2.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      baselineCommit,
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
