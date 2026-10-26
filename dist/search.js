import {
  cached,
  objectKey,
  poseKey,
  count,
} from "./nesting-profile.js?v=0.26.2";
import { cuttingMetrics } from "./cut-metrics.js?v=0.26.2";
import { transformed } from "./geometry.js?v=0.26.2";
import "./engine/util/offcut.js?v=0.26.2";
const offcut = globalThis.PaperOffcut;
export const ROTATIONS = [1, 4, 12, 24, 72, 360];
export function searchSettings(rotations) {
  if (!ROTATIONS.includes(rotations))
    throw new Error("Invalid rotation search");
  return { rotations, seconds: 20 };
}
export function evaluateLayout(parts, placements, settings) {
  return cached(
    "layoutScoring",
    objectKey(parts) +
      ":" +
      JSON.stringify(settings) +
      ":" +
      placements.map(poseKey).sort().join("|"),
    () => evaluateLayoutImpl(parts, placements, settings),
  );
}
function evaluateLayoutImpl(parts, placements, settings) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const sheets = new Map();
  for (const t of placements) {
    if (!sheets.has(t.sheet)) sheets.set(t.sheet, []);
    sheets.get(t.sheet).push(transformed(byId.get(t.id).outer, t));
  }
  const reports = [...sheets]
    .sort((a, b) => a[0] - b[0])
    .map(([sheet, polygons]) => ({
      sheet,
      ...offcut.collect(
        polygons,
        {
          x: settings.margin,
          y: settings.margin,
          w: settings.width - 2 * settings.margin,
          h: settings.height - 2 * settings.margin,
        },
        settings.gap + 0.03 * Math.max(1, settings.scale ?? 1),
        settings.minOffcutSide ?? 20,
        { count, shapeWeight: settings.offcutShapeWeight ?? 0 },
      ),
    }));
  const score = offcut.score(
    parts.length - placements.length,
    reports,
    settings.offcutShapeWeight ?? 0,
  );
  if (settings.commonEdgeMode !== true) return { score, sheets: reports };
  const commonEdgeWeight = settings.commonEdgeWeight ?? 1;
  const cutLengthWeight = settings.cutLengthWeight ?? 1;
  if (
    ![commonEdgeWeight, cutLengthWeight].every(
      (v) => Number.isFinite(v) && v >= 0,
    )
  )
    throw new Error("Cutting weights must be finite and non-negative");
  const cutting = cuttingMetrics(parts, placements, settings);
  // Preserve material priorities, then compare cutting cost before the final
  // positional compactness tie-breaker. No cutting reward can buy a worse box.
  score.splice(
    4,
    0,
    cutLengthWeight * cutting.estimatedCutLength -
      commonEdgeWeight * cutting.sharedLength,
  );
  return { score, sheets: reports, cutting };
}
export function layoutScore(parts, placements, settings) {
  return evaluateLayout(parts, placements, settings).score;
}
export function improves(a, b) {
  return offcut.compare(a, b) < 0;
}
export function searchSeed(placements) {
  return placements.map(({ id, angle, mirrored }) => ({
    id,
    angle: (((Math.round(angle) % 360) + 360) % 360) + (mirrored ? 360 : 0),
  }));
}
