import { pathToFileURL } from "node:url";
const size = Number(process.argv[2]),
  mode = process.argv[3];
const root = mode.startsWith("baseline")
  ? "work/perf-v09-baseline/dist"
  : "dist";
const { compactLayout } = await import(
  pathToFileURL(process.cwd() + "/" + root + "/compaction.js")
);
const { sampleParts, area, validateLayout } = await import(
  pathToFileURL(process.cwd() + "/" + root + "/geometry.js")
);
const { cuttingMetrics } = await import(
  pathToFileURL(process.cwd() + "/" + root + "/cut-metrics.js")
);
const source = sampleParts();
const parts = Array.from({ length: size }, (_, i) => ({
  ...structuredClone(source[i % source.length]),
  id: "bench-" + i,
  name: "Bench " + i,
}));
const cols = Math.ceil(Math.sqrt(size)),
  rows = Math.ceil(size / cols);
const settings = {
  width: cols * 105 + 10,
  height: rows * 110 + 10,
  margin: 5,
  gap: 2,
  rotations: 4,
  scale: 1,
  allowMirror: false,
  minOffcutSide: 20,
  commonEdgeMode: mode === "enabled" || mode === "baseline-enabled",
  pairClusters: mode === "pairs",
};
let placements = parts.map((p, i) => ({
  id: p.id,
  x: 5 + (i % cols) * 105,
  y: 5 + Math.floor(i / cols) * 110,
  angle: 0,
  scale: 1,
  sheet: 0,
}));
if (validateLayout(parts, placements, settings).length)
  throw new Error("Invalid benchmark seed");
compactLayout(parts.slice(0, 2), placements.slice(0, 2), settings, {
  milliseconds: 100,
  passes: 1,
  optimise: true,
});
const totals = { runtimeMs: 0, counts: {}, inclusiveMs: {} };
let result,
  clusterMoves = 0;
for (let job = 0; job < 2; job++) {
  result = compactLayout(parts, placements, settings, {
    milliseconds: 900,
    passes: 1,
    profile: true,
    optimise: true,
    startOffset: result?.nextOffset || 0,
    pairOffset: result?.nextPairOffset || 0,
    groupOnly: job === 1,
  });
  placements = result.placements;
  clusterMoves += result.clustersMoved || 0;
  totals.runtimeMs += result.profile.runtimeMs;
  for (const field of ["counts", "inclusiveMs"])
    for (const [k, v] of Object.entries(result.profile[field]))
      totals[field][k] = (totals[field][k] || 0) + v;
}
if (validateLayout(parts, placements, settings).length)
  throw new Error("Invalid final benchmark layout");
const cutting = cuttingMetrics(parts, placements, {
  ...settings,
  commonEdgeMode: true,
});
const utilisation =
  (100 * parts.reduce((s, p) => s + Math.abs(area(p.outer)), 0)) /
  (settings.width * settings.height * result.report.sheets.length);
console.log(
  JSON.stringify({
    size,
    mode,
    ...totals,
    generatedCandidates: totals.counts.generatedCandidates || 0,
    edgePairComparisons: totals.counts.edgePairComparisons || 0,
    collisionTests: totals.counts.collisionTests || 0,
    materialUtilisationPercent: utilisation,
    largestOffcut: result.report.sheets.reduce(
      (m, s) => Math.max(m, s.rectangle.area),
      0,
    ),
    boundingArea: result.report.score[3],
    clusterMoves,
    ...cutting,
  }),
);
