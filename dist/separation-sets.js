import {
  transformed,
  pointIn,
  segmentsCross,
  segmentDistance,
} from "./geometry.js?v=0.32.0";
import { extractPartEdges, transformEdge } from "./common-edge.js?v=0.32.0";
import { mergeCommonLines, lineLength } from "./common-line.js?v=0.32.0";
import { rectanglePoints } from "./offcut-export.js?v=0.32.0";
const EPS = 1e-6;
const edges = (points) =>
  points.map((start, i) => ({ start, end: points[(i + 1) % points.length] }));
const perimeter = (r) => edges(rectanglePoints(r));
const total = (ss) => ss.reduce((n, s) => n + lineLength(s), 0);
// Reuse only real source straight exterior cuts: never curve tessellation or engraving.
function context(parts, placements, sheet, s) {
  if (
    ![s.width, s.height, s.margin ?? 0, s.kerf ?? 0].every(Number.isFinite) ||
    s.width <= 0 ||
    s.height <= 0 ||
    (s.kerf ?? 0) < 0
  )
    throw Error("Invalid sheet or kerf");
  const map = new Map(parts.map((p) => [p.id, p]));
  const polygons = [],
    existing = perimeter({ x: 0, y: 0, w: s.width, h: s.height });
  for (const t of placements.filter((t) => t.sheet === sheet)) {
    const p = map.get(t.id);
    if (!p) throw Error("Unknown part");
    polygons.push(transformed(p.outer, t));
    existing.push(...extractPartEdges(p).map((e) => transformEdge(e, t)));
  }
  return { polygons, existing };
}
export function missingSegments(required, existing) {
  const result = [];
  for (const line of required) {
    const len = lineLength(line);
    if (len <= EPS) continue;
    const u = {
      x: (line.end.x - line.start.x) / len,
      y: (line.end.y - line.start.y) / len,
    };
    const project = (p) =>
      (p.x - line.start.x) * u.x + (p.y - line.start.y) * u.y;
    const distance = (p) =>
      Math.abs((p.x - line.start.x) * u.y - (p.y - line.start.y) * u.x);
    const intervals = [];
    for (const e of existing) {
      if (distance(e.start) > EPS || distance(e.end) > EPS) continue;
      const lo = Math.max(0, Math.min(project(e.start), project(e.end))),
        hi = Math.min(len, Math.max(project(e.start), project(e.end)));
      if (hi > lo) intervals.push([lo, hi]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const point = (t) => ({
      x: line.start.x + u.x * t,
      y: line.start.y + u.y * t,
    });
    const add = (a, b) => {
      if (b - a > EPS) result.push({ start: point(a), end: point(b) });
    };
    for (const [lo, hi] of intervals) {
      if (lo > cursor) add(cursor, lo);
      cursor = Math.max(cursor, hi);
    }
    add(cursor, len);
  }
  return result;
}
function strictIn(p, poly) {
  return (
    pointIn(p, poly) &&
    !edges(poly).some((s) => segmentDistance(p, s.start, s.end) < EPS)
  );
}
function overlap(a, b) {
  return (
    a.some((p) => strictIn(p, b)) ||
    b.some((p) => strictIn(p, a)) ||
    edges(a).some((s) =>
      edges(b).some((t) => segmentsCross(s.start, s.end, t.start, t.end)),
    ) ||
    strictIn(
      {
        x: a.reduce((n, p) => n + p.x, 0) / a.length,
        y: a.reduce((n, p) => n + p.y, 0) / a.length,
      },
      b,
    )
  );
}
function safeSegment(s, polygons, kerf, existing) {
  let { start: a, end: b } = s;
  const len = lineLength(s);
  if (len < EPS) return false;
  for (const poly of polygons) {
    if (
      strictIn(a, poly) ||
      strictIn(b, poly) ||
      strictIn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, poly) ||
      edges(poly).some((t) => segmentsCross(a, b, t.start, t.end))
    )
      return false;
  }
  // A sampled curve chord is not a cut boundary. Only verified source lines
  // may provide a zero-clearance junction for an additional straight cut.
  for (const p of [a, b, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]) {
    if (
      polygons.some((poly) =>
        edges(poly).some((e) => segmentDistance(p, e.start, e.end) < EPS),
      ) &&
      !existing.some((e) => segmentDistance(p, e.start, e.end) < EPS)
    )
      return false;
  }
  const pad = kerf / 2;
  if (!pad) return true;
  // At a junction with an existing cut its kerf already opens the endpoint.
  const trim = (p) =>
    existing.some((e) => segmentDistance(p, e.start, e.end) < EPS)
      ? Math.min(pad, len / 3)
      : 0;
  const da = trim(a),
    db = trim(b),
    u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  a = { x: a.x + u.x * da, y: a.y + u.y * da };
  b = { x: b.x - u.x * db, y: b.y - u.y * db };
  return polygons.every((poly) =>
    edges(poly).every(
      (t) =>
        Math.min(
          segmentDistance(a, t.start, t.end),
          segmentDistance(b, t.start, t.end),
          segmentDistance(t.start, a, b),
          segmentDistance(t.end, a, b),
        ) >=
        pad - EPS,
    ),
  );
}
function validRect(r, s) {
  return (
    [r.x, r.y, r.w, r.h].every(Number.isFinite) &&
    r.w > 0 &&
    r.h > 0 &&
    r.x >= -EPS &&
    r.y >= -EPS &&
    r.x + r.w <= s.width + EPS &&
    r.y + r.h <= s.height + EPS
  );
}
function key(ss) {
  return JSON.stringify(
    ss
      .map((l) =>
        [l.start.x, l.start.y, l.end.x, l.end.y].map((n) =>
          Number(n.toFixed(6)),
        ),
      )
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  );
}
export function proposeCutSets(parts, placements, sheet, s, offcuts = []) {
  const { polygons, existing } = context(parts, placements, sheet, s);
  const plans = [];
  const margin = Math.max(0, s.margin ?? 0);
  for (const [i, r] of offcuts.entries()) {
    if (!validRect(r, s)) throw Error("Invalid offcut dimensions");
    const variants = [];
    // A bounded 16 boundary choices per offcut, independent of the number of parts.
    for (let mask = 0; mask < 16; mask++) {
      let x = r.x,
        y = r.y,
        right = r.x + r.w,
        bottom = r.y + r.h;
      if (mask & 1) {
        if (x > margin + EPS) continue;
        x = 0;
      }
      if (mask & 2) {
        if (y > margin + EPS) continue;
        y = 0;
      }
      if (mask & 4) {
        if (s.width - right > margin + EPS) continue;
        right = s.width;
      }
      if (mask & 8) {
        if (s.height - bottom > margin + EPS) continue;
        bottom = s.height;
      }
      const region = { x, y, w: right - x, h: bottom - y };
      const poly = rectanglePoints(region);
      if (polygons.some((p) => overlap(poly, p))) continue;
      const required = perimeter(region),
        segments = missingSegments(required, existing);
      if (
        !segments.every((l) => safeSegment(l, polygons, s.kerf ?? 0, existing))
      )
        continue;
      // A new line must not slice the interior of another reusable rectangle.
      if (
        segments.some((l) =>
          offcuts.some(
            (other, j) =>
              j !== i &&
              (strictIn(l.start, rectanglePoints(other)) ||
                strictIn(l.end, rectanglePoints(other)) ||
                strictIn(
                  {
                    x: (l.start.x + l.end.x) / 2,
                    y: (l.start.y + l.end.y) / 2,
                  },
                  rectanglePoints(other),
                ) ||
                perimeter(other).some((e) =>
                  segmentsCross(l.start, l.end, e.start, e.end),
                )),
          ),
        )
      )
        continue;
      variants.push({ segments, region, length: total(segments) });
    }
    variants.sort(
      (a, b) =>
        a.length - b.length ||
        a.segments.length - b.segments.length ||
        b.region.w * b.region.h - a.region.w * a.region.h,
    );
    if (!variants.length) continue;
    const best = variants[0];
    plans.push({
      ...best,
      offcuts: [{ ...r, id: r.id ?? String(i), number: r.number ?? i + 1 }],
      regions: [best.region],
    });
  }
  const make = (ps) => {
    const segments = mergeCommonLines(ps.flatMap((p) => p.segments)).map(
        (l) => ({ start: l.start, end: l.end }),
      ),
      released = ps.flatMap((p) => p.offcuts);
    return {
      id: `${sheet}:set:${encodeURIComponent(
        key(segments) +
          released
            .map((r) => r.id)
            .sort()
            .join("|"),
      )}`,
      segments,
      offcuts: released,
      regions: ps.flatMap((p) => p.regions),
      length: total(segments),
      area: released.reduce((n, r) => n + r.w * r.h, 0),
    };
  };
  const sets = plans.map((p) => make([p]));
  // Add a combined option only when shared boundaries reduce additional cutting.
  if (plans.length > 1) {
    const combined = make(plans);
    if (combined.length < plans.reduce((n, p) => n + p.length, 0) - EPS)
      sets.push(combined);
  }
  return sets;
}
export function checkedCutSets(parts, placements, sheet, s, sets = []) {
  if (!Array.isArray(sets)) throw Error("Invalid cut sets");
  const { polygons, existing } = context(parts, placements, sheet, s),
    lines = [];
  for (const set of sets) {
    if (
      !Array.isArray(set.offcuts) ||
      !Array.isArray(set.segments) ||
      !Array.isArray(set.regions) ||
      set.regions.length !== set.offcuts.length
    )
      throw Error("Invalid cut set");
    const required = [];
    for (let i = 0; i < set.regions.length; i++) {
      const r = set.offcuts[i],
        region = set.regions[i],
        m = Math.max(0, s.margin ?? 0);
      const same = (a, b) => Math.abs(a - b) < EPS;
      if (
        !validRect(r, s) ||
        !validRect(region, s) ||
        !(same(region.x, r.x) || (same(region.x, 0) && r.x <= m + EPS)) ||
        !(same(region.y, r.y) || (same(region.y, 0) && r.y <= m + EPS)) ||
        !(
          same(region.x + region.w, r.x + r.w) ||
          (same(region.x + region.w, s.width) && s.width - r.x - r.w <= m + EPS)
        ) ||
        !(
          same(region.y + region.h, r.y + r.h) ||
          (same(region.y + region.h, s.height) &&
            s.height - r.y - r.h <= m + EPS)
        ) ||
        polygons.some((p) => overlap(rectanglePoints(region), p))
      )
        throw Error("Cut set region is no longer valid / 餘料分離範圍已失效");
      required.push(...missingSegments(perimeter(region), existing));
    }
    const exact = mergeCommonLines(required).map((l) => ({
      start: l.start,
      end: l.end,
    }));
    if (
      key(exact) !== key(set.segments) ||
      !exact.every((l) => safeSegment(l, polygons, s.kerf ?? 0, existing))
    )
      throw Error("Cut set is no longer valid / 切線組已失效，請重新檢視");
    lines.push(...exact);
  }
  return mergeCommonLines(lines).map((l) => ({
    start: l.start,
    end: l.end,
    role: "separation-cut",
  }));
}
export function remainingOffcutFrames(offcuts, sets) {
  const released = new Set(
    sets.flatMap((s) =>
      s.offcuts.map((r) => JSON.stringify([r.x, r.y, r.w, r.h])),
    ),
  );
  return offcuts.filter(
    (r) => !released.has(JSON.stringify([r.x, r.y, r.w, r.h])),
  );
}
