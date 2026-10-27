import {
  cached,
  objectKey,
  poseKey,
  count,
  measured,
} from "./nesting-profile.js?v=0.28.0";
// Explicit shared-boundary validation. Ordinary clearance remains untouched.
import * as vendor from "./engine/util/clipper.js?v=0.28.0";
import {
  transformed,
  segmentDistance,
  clearance,
  bounds,
} from "./geometry.js?v=0.28.0";
import {
  extractPartEdges,
  transformEdge,
  edgeCompatibility,
  sharedSection,
} from "./common-edge.js?v=0.28.0";
const C = globalThis.ClipperLib || vendor.default;
const EPS = 1e-6,
  SCALE = 1e6;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const cross = (a, b) => a.x * b.y - a.y * b.x;
const lerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS;
const edges = (p) => p.map((a, i) => [a, p[(i + 1) % p.length]]);
const on = (p, e) => segmentDistance(p, ...e) <= EPS;
const length = (e) => Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
function inverse(p, t) {
  const angle = (t.angle * Math.PI) / 180,
    dx = p.x - t.x,
    dy = p.y - t.y,
    s = t.scale ?? 1;
  return {
    x:
      ((dx * Math.cos(angle) + dy * Math.sin(angle)) / s) *
      (t.mirrored ? -1 : 1),
    y: (-dx * Math.sin(angle) + dy * Math.cos(angle)) / s,
  };
}
const ref = (e) => ({
  contourId: e.contourId,
  edgeIndex: e.edgeIndex,
  entityIndex: e.entityIndex,
  sourceSegmentIndex: e.sourceSegmentIndex,
});
export function contactFromCandidate(c) {
  const section = [c.sharedSection.start, c.sharedSection.end];
  return {
    otherPartId: c.fixedPartId,
    ownEdge: ref(c.movingEdge),
    otherEdge: ref(c.fixedEdge),
    ownSection: section.map((p) => inverse(p, c.placement)),
    otherSection: section.map((p) => inverse(p, c.fixedPlacement)),
  };
}
function resolve(part, reference) {
  if (!reference) return null;
  return extractPartEdges(part).find((e) =>
    ["contourId", "edgeIndex", "entityIndex", "sourceSegmentIndex"].every(
      (k) => e[k] === reference[k],
    ),
  );
}
function worldSection(local, t) {
  if (
    !Array.isArray(local) ||
    local.length !== 2 ||
    !local.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
  )
    return null;
  return transformed(local, t);
}
function interiorOverlap(a, b) {
  count("polygonIntersections");
  const path = (p) =>
    p.map((v) => ({ X: Math.round(v.x * SCALE), Y: Math.round(v.y * SCALE) }));
  const clip = new C.Clipper(),
    result = [];
  clip.AddPath(path(a), C.PolyType.ptSubject, true);
  clip.AddPath(path(b), C.PolyType.ptClip, true);
  if (
    !clip.Execute(
      C.ClipType.ctIntersection,
      result,
      C.PolyFillType.pftNonZero,
      C.PolyFillType.pftNonZero,
    )
  )
    return true;
  return (
    result.reduce((s, p) => s + Math.abs(C.Clipper.Area(p)), 0) /
      (SCALE * SCALE) >
    // Integer rounding can create sub-micron slivers along rotated contacts.
    // Bound that area error by the input perimeter times the coordinate grid.
    EPS *
      (edges(a).reduce((s, e) => s + length(e), 0) +
        edges(b).reduce((s, e) => s + length(e), 0))
  );
}
// Intersection geometry, including collinear intervals and endpoint-only touches.
function intersection(a, b) {
  const u = sub(a[1], a[0]),
    v = sub(b[1], b[0]),
    w = sub(b[0], a[0]),
    den = cross(u, v);
  if (Math.abs(den) > 1e-12 * Math.max(1, length(a) * length(b))) {
    const t = cross(w, v) / den,
      q = cross(w, u) / den;
    if (t >= -1e-9 && t <= 1 + 1e-9 && q >= -1e-9 && q <= 1 + 1e-9) {
      const p = lerp(...a, Math.max(0, Math.min(1, t)));
      return [p, p];
    }
    return null;
  }
  const uu = dot(u, u);
  if (uu < EPS * EPS) return on(a[0], b) ? [a[0], a[0]] : null;
  if (Math.abs(cross(w, u)) / Math.sqrt(uu) > EPS) return null;
  const ts = [dot(w, u) / uu, dot(sub(b[1], a[0]), u) / uu].sort(
    (a, b) => a - b,
  );
  const lo = Math.max(0, ts[0]),
    hi = Math.min(1, ts[1]);
  return hi >= lo - 1e-9
    ? [lerp(...a, lo), lerp(...a, Math.max(lo, hi))]
    : null;
}
function intervals(segment, shared) {
  const u = sub(segment[1], segment[0]),
    ll = dot(u, u);
  if (ll < EPS * EPS) return [];
  return shared
    .map((s) => intersection(segment, s))
    .filter(Boolean)
    .map((s) =>
      [
        dot(sub(s[0], segment[0]), u) / ll,
        dot(sub(s[1], segment[0]), u) / ll,
      ].sort((a, b) => a - b),
    )
    .sort((a, b) => a[0] - b[0]);
}
function authorised(contact, shared) {
  if (length(contact) <= EPS) return shared.some((s) => on(contact[0], s));
  let end = 0;
  for (const [lo, hi] of intervals(contact, shared)) {
    if (lo > end + EPS / length(contact)) return false;
    end = Math.max(end, hi);
  }
  return end >= 1 - EPS / length(contact);
}
// Remove redundant straight-line vertices only for distance checking. Source
// edge IDs and contact declarations keep their original indexing.
function straightBoundary(polygon) {
  // Deduplicate first: filtering both copies of a vertex simultaneously can
  // erase a genuine corner and invent a diagonal boundary for clearance.
  const clean = polygon.filter((p, i) => !i || !near(p, polygon[i - 1]));
  if (clean.length > 1 && near(clean[0], clean[clean.length - 1])) clean.pop();
  return clean.filter((p, i) => {
    const prev = clean[(i + clean.length - 1) % clean.length],
      next = clean[(i + 1) % clean.length];
    return segmentDistance(p, prev, next) > 1e-9;
  });
}
function exteriorPieces(polygon, shared, gap) {
  const result = [],
    endpoints = shared.flat();
  for (const e of edges(straightBoundary(polygon))) {
    let cursor = 0,
      pieces = [];
    for (const [lo, hi] of intervals(e, shared)) {
      if (hi - lo <= EPS / Math.max(length(e), EPS)) continue;
      if (lo > cursor) pieces.push([lerp(...e, cursor), lerp(...e, lo)]);
      cursor = Math.max(cursor, hi);
    }
    if (cursor < 1) pieces.push([lerp(...e, cursor), e[1]]);
    for (let piece of pieces) {
      // Incident boundary rays necessarily approach a shared endpoint closer than
      // gap. Exempt only their initial gap-length run-out, never remote edges.
      for (const p of endpoints) {
        const l = length(piece);
        if (l <= EPS) break;
        if (near(piece[0], p))
          piece = [lerp(...piece, Math.min(1, (gap + EPS) / l)), piece[1]];
        else if (near(piece[1], p))
          piece = [piece[0], lerp(...piece, Math.max(0, 1 - (gap + EPS) / l))];
      }
      if (length(piece) > EPS) result.push(piece);
    }
  }
  return result;
}
function spaced(as, bs, gap) {
  return as.every((a) =>
    bs.every(
      (b) =>
        !intersection(a, b) &&
        Math.min(
          segmentDistance(a[0], ...b),
          segmentDistance(a[1], ...b),
          segmentDistance(b[0], ...a),
          segmentDistance(b[1], ...a),
        ) >=
          gap - EPS,
    ),
  );
}
export function commonContactClearance(partA, tA, partB, tB, gap) {
  count("collisionTests");
  return cached(
    "commonCollision",
    objectKey(partA) +
      ":" +
      poseKey(tA) +
      ":" +
      objectKey(partB) +
      ":" +
      poseKey(tB) +
      ":" +
      gap,
    () => commonContactClearanceImpl(partA, tA, partB, tB, gap),
  );
}
function commonContactClearanceImpl(partA, tA, partB, tB, gap) {
  const a = transformed(partA.outer, tA),
    b = transformed(partB.outer, tB);
  const declarations = [];
  for (const [p, t, q, u] of [
    [partA, tA, partB, tB],
    [partB, tB, partA, tA],
  ]) {
    if (t.sharedEdges !== undefined && !Array.isArray(t.sharedEdges))
      return { valid: false, reason: "invalid-shared-metadata" };
    for (const d of t.sharedEdges || [])
      if (d?.otherPartId === q.id) declarations.push([p, t, q, u, d]);
  }
  if (!declarations.length) {
    // Retain the ordinary distance rule; mode-on additionally rejects all
    // undesignated contact even when the caller explicitly requests gap=0.
    const ba = bounds(a),
      bb = bounds(b);
    if (
      ba.x + ba.w + gap < bb.x ||
      bb.x + bb.w + gap < ba.x ||
      ba.y + ba.h + gap < bb.y ||
      bb.y + bb.h + gap < ba.y
    )
      return { valid: true };
    if (interiorOverlap(a, b))
      return { valid: false, reason: "interior-overlap" };
    if (edges(a).some((e) => edges(b).some((f) => intersection(e, f))))
      return { valid: false, reason: "unapproved-touch" };
    return { valid: clearance(a, b, gap), reason: "clearance" };
  }
  const shared = [];
  for (const [p, t, q, u, d] of declarations) {
    const ea = resolve(p, d.ownEdge),
      eb = resolve(q, d.otherEdge);
    if (!ea || !eb) return { valid: false, reason: "unknown-shared-edge" };
    const wa = transformEdge(ea, t),
      wb = transformEdge(eb, u);
    const sa = worldSection(d.ownSection, t),
      sb = worldSection(d.otherSection, u);
    if (
      !sa ||
      !sb ||
      length(sa) <= EPS ||
      !edgeCompatibility(wa, wb, { angleTolerance: 1e-6, minOverlap: EPS })
        .compatible ||
      !sa.every((v) => on(v, [wa.start, wa.end])) ||
      !sb.every((v) => on(v, [wb.start, wb.end])) ||
      !(
        (near(sa[0], sb[0]) && near(sa[1], sb[1])) ||
        (near(sa[0], sb[1]) && near(sa[1], sb[0]))
      )
    )
      return { valid: false, reason: "invalid-shared-section" };
    shared.push(sa);
  }
  if (interiorOverlap(a, b))
    return { valid: false, reason: "interior-overlap" };
  for (const e of edges(a))
    for (const f of edges(b)) {
      const c = intersection(e, f);
      if (c && !authorised(c, shared))
        return { valid: false, reason: "unapproved-touch" };
    }
  const ar = exteriorPieces(a, shared, gap),
    br = exteriorPieces(b, shared, gap);
  if (
    !spaced(ar, br, gap) ||
    !spaced(ar, shared, gap) ||
    !spaced(br, shared, gap)
  )
    return { valid: false, reason: "clearance" };
  return { valid: true, shared };
}
// A moved part cannot retain stale contacts, including claims stored by peers.
export function replacePlacement(placements, t, contact) {
  return placements.map((old) => {
    const next = old.id === t.id ? { ...t } : { ...old };
    const kept =
      old.id === t.id
        ? []
        : (old.sharedEdges || []).filter((d) => d.otherPartId !== t.id);
    if (old.id === t.id && contact)
      kept.push(...(Array.isArray(contact) ? contact : [contact]));
    if (kept.length) next.sharedEdges = kept;
    else delete next.sharedEdges;
    return next;
  });
}

// Discover every genuine straight-edge contact at a proposed pose. This does
// not authorise overlap: commonContactClearance still validates every pair.
export function contactsAtPlacement(
  part,
  placement,
  parts,
  placements,
  minOverlap = 0.01,
) {
  const byId = new Map(parts.map((p) => [p.id, p])),
    result = [];
  // Contact discovery depends only on source geometry and exact poses, not on
  // existing contact claims. Per-job caching never rounds coordinates.
  const geometryPose = (t) =>
    JSON.stringify([t.x, t.y, t.angle, t.scale ?? 1, !!t.mirrored]);
  for (const t of placements) {
    if (t.id === part.id || t.sheet !== placement.sheet) continue;
    const other = byId.get(t.id);
    const key = JSON.stringify([
      objectKey(part),
      geometryPose(placement),
      objectKey(other),
      geometryPose(t),
      minOverlap,
    ]);
    const contacts = cached("contactDiscovery", key, () => {
      const found = [],
        own = extractPartEdges(part).map((e) => [
          e,
          transformEdge(e, placement),
        ]);
      for (const local of extractPartEdges(other)) {
        const world = transformEdge(local, t);
        for (const [edge, ownWorld] of own) {
          count("contactDiscoveryEdgePairs");
          // Disjoint segment bounds cannot overlap, even within linear tolerance.
          const a = world,
            b = ownWorld;
          if (
            Math.max(a.start.x, a.end.x) + EPS < Math.min(b.start.x, b.end.x) ||
            Math.max(b.start.x, b.end.x) + EPS < Math.min(a.start.x, a.end.x) ||
            Math.max(a.start.y, a.end.y) + EPS < Math.min(b.start.y, b.end.y) ||
            Math.max(b.start.y, b.end.y) + EPS < Math.min(a.start.y, a.end.y)
          ) {
            count("contactDiscoveryBoundsRejected");
            continue;
          }
          const section = sharedSection(world, ownWorld, { minOverlap });
          if (section)
            found.push(
              contactFromCandidate({
                placement,
                fixedPlacement: t,
                fixedPartId: t.id,
                movingEdge: edge,
                fixedEdge: local,
                sharedSection: section,
              }),
            );
        }
      }
      return found;
    });
    result.push(...contacts);
  }
  return result;
}

// A junction needs a local path of independently validated shared edges through
// the very same endpoint. Membership in a distant cluster is not sufficient.
export function sharedJunctions(sharedPairs, idA, idB, sheet) {
  const nodes = [];
  for (const pair of sharedPairs) {
    if (pair.sheet !== sheet) continue;
    for (const point of pair.shared.flat()) {
      let node = nodes.find((n) => near(n.point, point));
      if (!node) {
        node = { point, links: new Map() };
        nodes.push(node);
      }
      for (const [a, b] of [
        [pair.a, pair.b],
        [pair.b, pair.a],
      ]) {
        if (!node.links.has(a)) node.links.set(a, new Set());
        node.links.get(a).add(b);
      }
    }
  }
  return nodes
    .filter((n) => {
      if (n.links.size < 3 || !n.links.has(idA) || !n.links.has(idB))
        return false;
      const queue = [idA],
        seen = new Set(queue);
      for (let i = 0; i < queue.length; i++)
        for (const id of n.links.get(queue[i]) || [])
          if (!seen.has(id)) {
            seen.add(id);
            queue.push(id);
          }
      return seen.has(idB);
    })
    .map((n) => n.point);
}
export function junctionClearance(a, b, gap, points) {
  if (!points.length || interiorOverlap(a, b)) return false;
  let touched = false;
  for (const e of edges(a))
    for (const f of edges(b)) {
      const contact = intersection(e, f);
      if (!contact) continue;
      touched = true;
      if (length(contact) > EPS || !points.some((p) => near(contact[0], p)))
        return false;
    }
  if (!touched) return false;
  const endpoints = points.map((p) => [p, p]);
  return spaced(
    exteriorPieces(a, endpoints, gap),
    exteriorPieces(b, endpoints, gap),
    gap,
  );
}
