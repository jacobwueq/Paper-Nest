import { spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
const baseline = "b10f19a3e6b74cb19287d8e3d48803969f88b3dc";
for (const file of execFileSync(
  "git",
  ["ls-tree", "-r", "--name-only", baseline, "dist"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")) {
  const path = "work/multipart-baseline/" + file;
  fs.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  fs.writeFileSync(path, execFileSync("git", ["show", baseline + ":" + file]));
}
const rows = [];
for (const size of [8, 24, 100])
  for (const mode of ["baseline", "disabled", "enabled"]) {
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(
        process.execPath,
        ["scripts/benchmark-multipart-case.mjs", String(size), mode],
        { encoding: "utf8", maxBuffer: 4e6 },
      );
      if (r.status !== 0) throw Error(r.stderr);
      runs.push(JSON.parse(r.stdout));
    }
    runs.sort((a, b) => a.runtimeMs - b.runtimeMs);
    rows.push({ ...runs[1], runs });
    console.log(JSON.stringify({ ...runs[1] }));
  }
fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(
  "outputs/multipart-benchmark.json",
  JSON.stringify(
    {
      date: new Date().toISOString(),
      baseline,
      method:
        "3 isolated runs; 1800 ms compaction budget, 4 orientations, repeated built-in sample shapes; median-runtime run. Common-edge mode on in all three modes. Not total browser runtime.",
      rows,
    },
    null,
    2,
  ),
);
