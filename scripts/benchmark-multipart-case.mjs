import { pathToFileURL } from "node:url";
const size = Number(process.argv[2]),
  mode = process.argv[3],
  root = mode === "baseline" ? "work/multipart-baseline/dist" : "dist";
const { compactLayout } = await import(
  pathToFileURL(process.cwd() + `/${root}/compaction.js`)
);
const { sampleParts, validateLayout, area } = await import(
  pathToFileURL(process.cwd() + `/${root}/geometry.js`)
);
const { cuttingMetrics } = await import(
  pathToFileURL(process.cwd() + `/${root}/cut-metrics.js`)
);
const src = sampleParts(),
  cols = Math.ceil(Math.sqrt(size));
const parts = Array.from({ length: size }, (_, i) => ({
  ...structuredClone(src[i % src.length]),
  id: `p${String(i).padStart(3, "0")}`,
}));
let placements = parts.map((p, i) => ({
  id: p.id,
  x: 5 + (i % cols) * 105,
  y: 5 + Math.floor(i / cols) * 110,
  angle: 0,
  scale: 1,
  sheet: 0,
}));
const settings = {
  width: cols * 105 + 10,
  height: Math.ceil(size / cols) * 110 + 10,
  margin: 5,
  gap: 2,
  rotations: 4,
  scale: 1,
  minOffcutSide: 20,
  commonEdgeMode: true,
  pairClusters: true,
  multiPartClusteringEnabled: mode === "enabled",
  diagonalCommonEdgesEnabled: mode === "enabled",
  maxClusterParts: 4,
  clusterBeamWidth: 8,
  preserveRemnantSplitLines: mode === "enabled",
};
if (validateLayout(parts, placements, settings).length)
  throw Error("Invalid seed");
compactLayout(parts.slice(0, 2), placements.slice(0, 2), settings, {
  milliseconds: 100,
  passes: 1,
});
const r = compactLayout(parts, placements, settings, {
  milliseconds: 1800,
  passes: 1,
  profile: true,
});
if (validateLayout(parts, r.placements, settings).length)
  throw Error("Invalid result");
console.log(
  JSON.stringify({
    size,
    mode,
    runtimeMs: r.profile.runtimeMs,
    counts: r.profile.counts,
    inclusiveMs: r.profile.inclusiveMs,
    maxClusterSize: r.maxClusterSize ?? null,
    clustersMoved: r.clustersMoved,
    materialUtilisation:
      (100 * parts.reduce((s, p) => s + Math.abs(area(p.outer)), 0)) /
      (settings.width * settings.height * r.report.sheets.length),
    largestOffcut: Math.max(...r.report.sheets.map((s) => s.rectangle.area)),
    boundingArea: r.report.score[3],
    ...cuttingMetrics(parts, r.placements, settings),
  }),
);
