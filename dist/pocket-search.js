import { count, measured } from "./nesting-profile.js?v=0.31.4";
import * as vendor from "./engine/util/clipper.js?v=0.31.4";
import { bounds } from "./geometry.js?v=0.31.4";
const C = globalThis.ClipperLib || vendor.default,
  S = 100000;
const path = (p) =>
  p.map((v) => ({ X: Math.round(v.x * S), Y: Math.round(v.y * S) }));
const positive = (p) => (C.Clipper.Orientation(p) ? p : p.slice().reverse());
// Configuration space: a point represents the translation of the complete
// moving contour. Subtract forbidden translations from the sheet, retaining
// every component, including pockets separated from the outside free region.
export function pocketTranslations(
  moving,
  obstacles,
  sheet,
  gap,
  shouldStop = () => false,
) {
  count("nfpRequests");
  return measured("nfp", () =>
    pocketTranslationsImpl(moving, obstacles, sheet, gap, shouldStop),
  );
}
// Roadmap 3.4: no-fit polygons depend only on the two shapes, not on where they are.
// Sums are computed for both shapes moved to a fixed corner and translated back by
// whole Clipper units, and kept between runs (bounded), so the same pair of shapes at
// the same angle is computed once. In the 64-part benchmark 63 sums come from 4 shapes.
const MINKOWSKI = new Map(), MINKOWSKI_LIMIT = 600;
export function minkowski(negative, a) {
  count("minkowskiRequests");
  const n0 = negative[0];
  let mx = Infinity, my = Infinity;
  for (const v of a) { if (v.X < mx) mx = v.X; if (v.Y < my) my = v.Y; }
  const key = JSON.stringify([negative.map((v) => [v.X - n0.X, v.Y - n0.Y]), a.map((v) => [v.X - mx, v.Y - my])]);
  let local = MINKOWSKI.get(key);
  if (local) { count("minkowskiCacheHits"); MINKOWSKI.delete(key); MINKOWSKI.set(key, local); }
  else {
    count("minkowskiComputations");
    local = measured("minkowski", () => C.Clipper.MinkowskiSum(negative.map((v) => ({ X: v.X - n0.X, Y: v.Y - n0.Y })), positive(a.map((v) => ({ X: v.X - mx, Y: v.Y - my }))), true));
    MINKOWSKI.set(key, local);
    if (MINKOWSKI.size > MINKOWSKI_LIMIT) MINKOWSKI.delete(MINKOWSKI.keys().next().value);
  }
  const dx = n0.X + mx, dy = n0.Y + my;
  return local.map((path) => path.map((v) => ({ X: v.X + dx, Y: v.Y + dy })));
}
export function clearNoFitCache() { MINKOWSKI.clear(); }
function pocketTranslationsImpl(moving, obstacles, sheet, gap, shouldStop) {
  const b = bounds(moving);
  const left = sheet.x - b.x,
    top = sheet.y - b.y;
  const right = sheet.x + sheet.w - b.x - b.w,
    bottom = sheet.y + sheet.h - b.y - b.h;
  if (right < left || bottom < top) return [];
  const bin = positive(
    path([
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ]),
  );
  const negative = positive(path(moving.map((v) => ({ x: -v.x, y: -v.y }))));
  const forbidden = [];
  for (const obstacle of obstacles) {
    if (shouldStop()) return [];
    const offset = new C.ClipperOffset(2, 0.005 * S),
      grown = [];
    offset.AddPath(
      positive(path(obstacle)),
      C.JoinType.jtRound,
      C.EndType.etClosedPolygon,
    );
    offset.Execute(grown, (gap + 0.01) * S);
    for (const a of grown) {
      const sums = minkowski(negative, a);
      forbidden.push(...sums);
      // Minkowski's boundary sweep can leave an artificial interior hole.
      // Include the filled obstacle at one moving vertex to fill that interior,
      // while preserving genuine configuration-space pockets.
      forbidden.push(
        positive(
          a.map((v) => ({ X: v.X + negative[0].X, Y: v.Y + negative[0].Y })),
        ),
      );
    }
  }
  const union = new C.Clipper(),
    blocked = [];
  union.AddPaths(forbidden, C.PolyType.ptSubject, true);
  union.Execute(
    C.ClipType.ctUnion,
    blocked,
    C.PolyFillType.pftNonZero,
    C.PolyFillType.pftNonZero,
  );
  const clip = new C.Clipper(),
    free = [];
  clip.AddPath(bin, C.PolyType.ptSubject, true);
  clip.AddPaths(blocked, C.PolyType.ptClip, true);
  clip.Execute(
    C.ClipType.ctDifference,
    free,
    C.PolyFillType.pftNonZero,
    C.PolyFillType.pftNonZero,
  );
  const unique = new Map();
  for (const polygon of free)
    for (const p of polygon) {
      const x = p.X / S,
        y = p.Y / S;
      unique.set(`${p.X}:${p.Y}`, { x, y });
    }
  return [...unique.values()];
}
