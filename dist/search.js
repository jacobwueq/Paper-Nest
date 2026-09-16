import { bounds, transformed } from "./geometry.js";

// 0 selects the staged search; the other values count orientations per turn.
export const ROTATIONS = [0, 1, 4, 12, 24, 72, 360];
export function searchPlan(rotations, continuing = false) {
  if (!ROTATIONS.includes(rotations))
    throw new Error("Invalid rotation search");
  if (rotations === 0 && !continuing)
    return [
      { rotations: 24, seconds: 10 },
      { rotations: 72, seconds: 15 },
      { rotations: 360, seconds: 35 },
    ];
  return [{ rotations: rotations || 360, seconds: 30 }];
}

// Compare complete layouts first, then sheet count, then occupied strip width.
// Translation coordinates alone are misleading when a part is rotated.
export function layoutScore(parts, placements) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const sheets = new Map();
  for (const t of placements) {
    const b = bounds(transformed(byId.get(t.id).outer, t));
    const s = sheets.get(t.sheet) || { min: Infinity, max: -Infinity };
    s.min = Math.min(s.min, b.x);
    s.max = Math.max(s.max, b.x + b.w);
    sheets.set(t.sheet, s);
  }
  return [
    parts.length - placements.length,
    sheets.size,
    [...sheets.values()].reduce((sum, s) => sum + s.max - s.min, 0),
  ];
}
export function improves(candidate, incumbent) {
  for (let i = 0; i < candidate.length; i++) {
    if (Math.abs(candidate[i] - incumbent[i]) > (i === 2 ? 1e-5 : 0))
      return candidate[i] < incumbent[i];
  }
  return false;
}

// The engine returns parts in insertion order, grouped by sheet. Retain this
// order and each part's own angle; coordinates remain the parent's incumbent.
export function searchSeed(placements) {
  return placements.map(({ id, angle }) => ({
    id,
    angle: ((Math.round(angle) % 360) + 360) % 360,
  }));
}
