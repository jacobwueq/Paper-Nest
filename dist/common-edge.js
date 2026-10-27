import {
  cached,
  objectKey,
  count,
  poseKey,
} from "./nesting-profile.js?v=0.30.1";
// Candidate geometry only: does not authorise contact, change scoring or merge cuts.
import { area, transform, segmentDistance, TOL } from "./geometry.js?v=0.30.1";
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const norm = (a) => ((a % 360) + 360) % 360;
const angleDifference = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
function makeEdge(start, end, metadata) {
  const v = sub(end, start),
    length = Math.hypot(v.x, v.y);
  if (!Number.isFinite(length) || length <= 1e-8) return null;
  const direction = { x: v.x / length, y: v.y / length };
  return {
    ...metadata,
    start: { ...start },
    end: { ...end },
    length,
    direction,
    angle: norm((Math.atan2(direction.y, direction.x) * 180) / Math.PI),
    outwardNormal: { x: direction.y, y: -direction.x },
  };
}
// Normalise winding so material is on the left, including after reflection.
export function extractPolygonEdges(
  points,
  { partId, contourId = "outer", isHole = false } = {},
) {
  const polygon = points.slice();
  if (
    polygon.length > 1 &&
    Math.hypot(
      polygon[0].x - polygon.at(-1).x,
      polygon[0].y - polygon.at(-1).y,
    ) < 1e-8
  )
    polygon.pop();
  if (
    polygon.length < 3 ||
    !polygon.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) ||
    Math.abs(area(polygon)) < 1e-8
  )
    return [];
  const reverse = area(polygon) > 0 === isHole;
  return polygon
    .map((p, i) => {
      const q = polygon[(i + 1) % polygon.length];
      return makeEdge(reverse ? q : p, reverse ? p : q, {
        partId,
        contourId,
        edgeIndex: i,
        isHole,
      });
    })
    .filter(Boolean);
}
// Normalised SVG path commands retain real lines separately from curve samples.
export function svgStraightSegments(
  commands,
  matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
) {
  const mapped = (p) => ({
    x: matrix.a * p.x + matrix.c * p.y + matrix.e,
    y: matrix.b * p.x + matrix.d * p.y + matrix.f,
  });
  const result = [];
  let current = null,
    start = null;
  commands.forEach((s, index) => {
    const v = s.values;
    if (s.type === "M") {
      current = { x: v[0], y: v[1] };
      start = current;
    } else if (s.type === "L" || s.type === "Z") {
      const end = s.type === "Z" ? start : { x: v[0], y: v[1] };
      if (current && end)
        result.push({
          start: mapped(current),
          end: mapped(end),
          segmentIndex: index,
        });
      current = end;
    } else if (v.length >= 2) current = { x: v.at(-2), y: v.at(-1) };
  });
  return result;
}
export function extractPartEdges(part) {
  return cached("edgeExtraction", objectKey(part), () =>
    extractPartEdgesImpl(part),
  );
}
function extractPartEdgesImpl(part) {
  if (part.edges) return part.edges;
  const outer = extractPolygonEdges(part.outer, { partId: part.id });
  // Explicit polygon-only callers assert that their polygon consists of real lines.
  if (!part.entities) return outer;
  const origin = part.origin || { x: 0, y: 0 },
    result = [];
  part.entities.forEach((entity, entityIndex) => {
    let segments = [];
    if (entity.kind === "poly") {
      for (
        let i = 0;
        i < entity.vertices.length - (entity.closed ? 0 : 1);
        i++
      ) {
        const a = entity.vertices[i],
          b = entity.vertices[(i + 1) % entity.vertices.length];
        if (!a.bulge) segments.push({ start: a, end: b, segmentIndex: i });
      }
    } else if (entity.kind === "svg") segments = entity.straightSegments || [];
    // Arcs/circles and SVGs without source line metadata are never tessellated into sharing edges.
    for (const s of segments) {
      const a = sub(s.start, origin),
        b = sub(s.end, origin);
      const boundary = outer.filter((e) => {
        const av = sub(b, a),
          bv = sub(e.end, e.start);
        return (
          Math.abs(cross(av, bv)) <= 1e-7 * Math.hypot(av.x, av.y) * e.length &&
          segmentDistance(e.start, a, b) <= TOL &&
          segmentDistance(e.end, a, b) <= TOL
        );
      });
      if (!boundary.length) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length <= 1e-8) continue;
      const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      const intervals = boundary
        .map((e) =>
          [dot(sub(e.start, a), d), dot(sub(e.end, a), d)].sort(
            (x, y) => x - y,
          ),
        )
        .sort((x, y) => x[0] - y[0]);
      let covered = 0;
      for (const [lo, hi] of intervals) {
        if (lo > covered + TOL) break;
        covered = Math.max(covered, hi);
      }
      if (covered < length - TOL) continue;
      const reverse = dot(d, boundary[0].direction) < 0;
      const edge = makeEdge(reverse ? b : a, reverse ? a : b, {
        partId: part.id,
        contourId: "outer",
        edgeIndex: boundary[0].edgeIndex,
        entityIndex,
        sourceSegmentIndex: s.segmentIndex,
        isHole: false,
      });
      if (edge) result.push(edge);
    }
  });
  return result;
}
export function transformEdge(edge, placement) {
  return cached(
    "transformedEdge",
    objectKey(edge) + ":" + poseKey(placement),
    () => transformEdgeImpl(edge, placement),
  );
}
function transformEdgeImpl(edge, placement) {
  const a = transform(edge.start, placement),
    b = transform(edge.end, placement);
  return makeEdge(placement.mirrored ? b : a, placement.mirrored ? a : b, {
    partId: edge.partId,
    contourId: edge.contourId,
    edgeIndex: edge.edgeIndex,
    entityIndex: edge.entityIndex,
    sourceSegmentIndex: edge.sourceSegmentIndex,
    isHole: edge.isHole,
  });
}
export function edgeCompatibility(
  a,
  b,
  { angleTolerance = 0.1, minOverlap = 0.01 } = {},
) {
  count("compatibilityChecks");
  if (
    !Number.isFinite(angleTolerance) ||
    angleTolerance < 0 ||
    angleTolerance > 90 ||
    !Number.isFinite(minOverlap) ||
    minOverlap <= 0
  )
    throw new Error("Invalid edge tolerances");
  const reject = (reason) => ({ compatible: false, reason, maxOverlap: 0 });
  if (
    !a ||
    !b ||
    !Number.isFinite(a.length) ||
    !Number.isFinite(b.length) ||
    Math.min(a.length, b.length) < minOverlap
  )
    return reject("too-short");
  if (a.partId !== undefined && a.partId === b.partId)
    return reject("same-part");
  if (a.isHole || b.isHole) return reject("hole-boundary");
  const delta = angleDifference(a.angle, b.angle);
  if (Math.min(delta, 180 - delta) > angleTolerance + 1e-9)
    return reject("not-parallel");
  if (
    Math.abs(180 - delta) > angleTolerance + 1e-9 ||
    dot(a.outwardNormal, b.outwardNormal) >= 0
  )
    return reject("same-facing");
  return {
    compatible: true,
    maxOverlap: Math.min(a.length, b.length),
    angleError: Math.abs(180 - delta),
  };
}
// Actual overlap at the supplied poses, distinct from potential overlap after sliding.
export function sharedSection(
  a,
  b,
  { linearTolerance = 1e-6, minOverlap = 0.01 } = {},
) {
  if (!edgeCompatibility(a, b, { angleTolerance: 1e-6, minOverlap }).compatible)
    return null;
  if (
    Math.abs(cross(sub(b.start, a.start), a.direction)) > linearTolerance ||
    Math.abs(cross(sub(b.end, a.start), a.direction)) > linearTolerance
  )
    return null;
  const values = [
    dot(sub(b.start, a.start), a.direction),
    dot(sub(b.end, a.start), a.direction),
  ].sort((x, y) => x - y);
  const lo = Math.max(0, values[0]),
    hi = Math.min(a.length, values[1]);
  if (hi - lo < minOverlap - 1e-9) return null;
  const at = (d) => ({
    x: a.start.x + d * a.direction.x,
    y: a.start.y + d * a.direction.y,
  });
  return { start: at(lo), end: at(hi), length: hi - lo };
}
// Endpoint events only. Point-only contacts are discarded; each retained pose
// has an exact collinear shared interval. No along-edge sampling or snap drift.
export function* commonEdgeCandidates(
  moving,
  movingPlacement,
  fixed,
  fixedPlacement,
  {
    rotations = 360,
    minOverlap = 0.01,
    shouldStop = () => false,
    diagonalCommonEdgesEnabled = false,
    preserveContactAlternatives = diagonalCommonEdgesEnabled,
    onDebug,
  } = {},
) {
  if (moving.id === fixed.id || movingPlacement.sheet !== fixedPlacement.sheet)
    return;
  if (
    !Number.isInteger(rotations) ||
    rotations < 1 ||
    !Number.isFinite(minOverlap) ||
    minOverlap <= 0
  )
    throw new Error("Invalid candidate settings");
  const step = 360 / rotations,
    seen = new Set(),
    fixedEdges = extractPartEdges(fixed),
    movingEdges = extractPartEdges(moving);
  for (const localA of fixedEdges) {
    const a = transformEdge(localA, fixedPlacement);
    for (const localB of movingEdges) {
      count("edgePairComparisons");
      if (shouldStop()) return;
      const oriented = transformEdge(localB, {
        ...movingPlacement,
        x: 0,
        y: 0,
        angle: 0,
      });
      const required = norm(a.angle + 180 - oriented.angle);
      const angle =
        rotations === 1
          ? norm(movingPlacement.angle)
          : diagonalCommonEdgesEnabled
            ? required
            : norm(Math.round(required / step) * step);
      if (angleDifference(angle, required) > 1e-7) {
        onDebug?.({
          stage: "edge-pair",
          movingPartId: moving.id,
          fixedPartId: fixed.id,
          movingEdge: localB.edgeIndex,
          fixedEdge: localA.edgeIndex,
          reason: "rotation-grid",
          requiredAngle: required,
        });
        continue;
      } // Locked rotations remain locked; enabled diagonal matching uses exact contact angles.
      const base = { ...movingPlacement, x: 0, y: 0, angle };
      const b = transformEdge(localB, base);
      const compatible = edgeCompatibility(a, b, {
        angleTolerance: 1e-6,
        minOverlap,
      });
      if (!compatible.compatible) continue;
      onDebug?.({
        stage: "edge-pair",
        movingPartId: moving.id,
        fixedPartId: fixed.id,
        movingEdge: localB.edgeIndex,
        fixedEdge: localA.edgeIndex,
        status: "compatible",
        maxOverlap: compatible.maxOverlap,
        angle,
      });
      for (const [af, bf] of [
        ["start", "start"],
        ["start", "end"],
        ["end", "start"],
        ["end", "end"],
      ]) {
        const placement = {
          ...base,
          x: a[af].x - b[bf].x,
          y: a[af].y - b[bf].y,
        };
        const key = [
          placement.x,
          placement.y,
          placement.angle,
          placement.mirrored,
          ...(preserveContactAlternatives
            ? [
                localA.edgeIndex,
                localB.edgeIndex,
                localA.entityIndex,
                localB.entityIndex,
              ]
            : []),
        ].join(",");
        if (seen.has(key)) continue;
        const section = sharedSection(a, transformEdge(localB, placement), {
          minOverlap,
        });
        if (!section) continue;
        seen.add(key);
        onDebug?.({
          stage: "generated",
          candidateKey: JSON.stringify([
            moving.id,
            placement.x,
            placement.y,
            placement.angle,
            !!placement.mirrored,
          ]),
          movingPartId: moving.id,
          fixedPartId: fixed.id,
          sharedLength: section.length,
          placement,
          movingEdge: localB.edgeIndex,
          fixedEdge: localA.edgeIndex,
        });
        yield {
          source: "common-edge",
          placement,
          fixedPartId: fixed.id,
          fixedPlacement: { ...fixedPlacement },
          movingEdge: localB,
          fixedEdge: localA,
          event: `${af}-to-${bf}`,
          sharedSection: section,
          maxOverlap: compatible.maxOverlap,
        };
      }
    }
  }
}
