import { transformed } from "./geometry.js?v=0.4.2";
import "./engine/util/offcut.js?v=0.4.2";
const offcut = globalThis.PaperOffcut;
export const ROTATIONS = [1, 4, 12, 24, 72, 360];
export function searchSettings(rotations) {
  if (!ROTATIONS.includes(rotations))
    throw new Error("Invalid rotation search");
  return { rotations, seconds: 20 };
}
export function evaluateLayout(parts, placements, settings) {
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
        settings.width * settings.height * 0.15,
      ),
    }));
  return {
    score: offcut.score(parts.length - placements.length, reports),
    sheets: reports,
  };
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
