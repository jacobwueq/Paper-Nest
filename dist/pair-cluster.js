import * as vendor from "./engine/util/clipper.js?v=0.32.1";
import {
  transformed,
  transform,
  bounds,
  area,
  clearance,
  validateLayout,
} from "./geometry.js?v=0.32.1";
import { commonContactClearance } from "./common-contact.js?v=0.32.1";
import { pocketTranslations } from "./pocket-search.js?v=0.32.1";
import { evaluateLayout, improves } from "./search.js?v=0.32.1";
import { count, measured } from "./nesting-profile.js?v=0.32.1";
const C = globalThis.ClipperLib || vendor.default,
  S = 1e6;

// No recursive macros: original children remain authoritative for all output.
export function createPairCluster(a, ta, b, tb, gap) {
  if (a.children || b.children || a.id === b.id || ta.sheet !== tb.sheet)
    return null;
  const contact = commonContactClearance(a, ta, b, tb, gap);
  if (!contact.valid || !contact.shared?.length) return null;
  return createPartCluster([a, b], [ta, tb], gap);
}
// Flat original children, 2–4 parts; no nested replacement geometry.
export function createPartCluster(parts, placements, gap) {
  if (
    parts.length < 2 ||
    parts.length > 4 ||
    parts.some((p) => p.children) ||
    new Set(parts.map((p) => p.id)).size !== parts.length ||
    placements.length !== parts.length ||
    new Set(placements.map((t) => t.id)).size !== parts.length ||
    new Set(placements.map((t) => t.sheet)).size !== 1
  )
    return null;
  const byId = new Map(parts.map((p) => [p.id, p]));
  if (placements.some((t) => !byId.has(t.id))) return null;
  const graph = new Map(parts.map((p) => [p.id, new Set()]));
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i],
        b = placements[j],
        result = commonContactClearance(
          byId.get(a.id),
          a,
          byId.get(b.id),
          b,
          gap,
        );
      if (!result.valid) return null;
      if (result.shared?.length) {
        graph.get(a.id).add(b.id);
        graph.get(b.id).add(a.id);
      }
    }
  const reached = new Set(),
    visit = (id) => {
      if (reached.has(id)) return;
      reached.add(id);
      for (const other of graph.get(id)) visit(other);
    };
  visit(parts[0].id);
  if (reached.size !== parts.length) return null;
  const polygons = placements.map((t) => transformed(byId.get(t.id).outer, t));
  const clip = new C.Clipper(),
    tree = new C.PolyTree();
  for (const p of polygons) {
    let path = p.map((v) => ({
      X: Math.round(v.x * S),
      Y: Math.round(v.y * S),
    }));
    if (!C.Clipper.Orientation(path)) path.reverse();
    clip.AddPath(path, C.PolyType.ptSubject, true);
  }
  if (
    !clip.Execute(
      C.ClipType.ctUnion,
      tree,
      C.PolyFillType.pftNonZero,
      C.PolyFillType.pftNonZero,
    )
  )
    return null;
  const contours = tree.Childs();
  // Disconnected components and holes cannot be represented by today's single outer polygon.
  if (contours.length !== 1 || contours[0].Childs().length) return null;
  const world = contours[0].Contour().map((v) => ({ x: v.X / S, y: v.Y / S }));
  const box = bounds(world),
    ids = new Set(parts.map((p) => p.id));
  const children = placements.map((t) => ({
    part: byId.get(t.id),
    placement: {
      ...t,
      x: t.x - box.x,
      y: t.y - box.y,
      sharedEdges: (t.sharedEdges || []).filter((d) => ids.has(d.otherPartId)),
    },
  }));
  return {
    id: "cluster:" + JSON.stringify(parts.map((p) => p.id).sort()),
    name: parts.map((p) => p.name || p.id).join(" + "),
    outer: world.map((p) => ({ x: p.x - box.x, y: p.y - box.y })),
    origin: { x: 0, y: 0 },
    size: { x: 0, y: 0, w: box.w, h: box.h },
    children, // actual original part references, never replacement drawing entities
    placement: {
      id: "cluster:" + JSON.stringify(parts.map((p) => p.id).sort()),
      x: box.x,
      y: box.y,
      angle: 0,
      scale: 1,
      mirrored: false,
      sheet: placements[0].sheet,
    },
  };
}
export function expandPairCluster(cluster, placement = cluster.placement) {
  if (
    !cluster.children ||
    cluster.children.length < 2 ||
    cluster.children.length > 4
  )
    throw new Error("Expected a 2–4 part cluster");
  return cluster.children.map(({ part, placement: t }) => {
    const origin = transform({ x: t.x, y: t.y }, placement);
    return {
      ...t,
      id: part.id,
      ...origin,
      sheet: placement.sheet,
      angle:
        (((placement.angle + (placement.mirrored ? -t.angle : t.angle)) % 360) +
          360) %
        360,
      scale: (placement.scale ?? 1) * (t.scale ?? 1),
      mirrored: !!placement.mirrored !== !!t.mirrored,
    };
  });
}
export function expandClusterLayout(parts, placements) {
  const map = new Map(parts.map((p) => [p.id, p])),
    expandedParts = [],
    expandedPlacements = [];
  for (const t of placements) {
    const p = map.get(t.id);
    if (!p) throw new Error("Unknown placement");
    if (p.children) {
      expandedParts.push(...p.children.map((c) => c.part));
      expandedPlacements.push(...expandPairCluster(p, t));
    } else {
      expandedParts.push(p);
      expandedPlacements.push(t);
    }
  }
  return { parts: expandedParts, placements: expandedPlacements };
}
export function findPairClusters(parts, placements, gap) {
  const byId = new Map(parts.map((p) => [p.id, p])),
    used = new Set(),
    result = [];
  for (const a of placements)
    for (const b of placements) {
      if (a.id >= b.id || used.has(a.id) || used.has(b.id)) continue;
      const ids = new Set([a.id, b.id]);
      // A pair linked to a third child belongs to a larger graph; leave it alone.
      if (
        placements.some((t) =>
          (t.sharedEdges || []).some(
            (d) => ids.has(t.id) !== ids.has(d.otherPartId),
          ),
        )
      )
        continue;
      if (
        !(a.sharedEdges || []).some((d) => d.otherPartId === b.id) &&
        !(b.sharedEdges || []).some((d) => d.otherPartId === a.id)
      )
        continue;
      const cluster = createPairCluster(
        byId.get(a.id),
        a,
        byId.get(b.id),
        b,
        gap,
      );
      if (cluster) {
        result.push(cluster);
        used.add(a.id);
        used.add(b.id);
      }
    }
  return result;
}
export function compactPairClusters(parts, initial, settings, options = {}) {
  return measured("pairClusters", () => {
    const now = options.now || (() => performance.now()),
      deadline = options.deadline ?? Infinity;
    let placements = initial,
      report = evaluateLayout(parts, initial, settings),
      moved = 0,
      generated = 0;
    const clusters = findPairClusters(parts, placements, settings.gap);
    for (const cluster of clusters) {
      if (now() >= deadline) break;
      const ids = new Set(cluster.children.map((c) => c.part.id));
      const fixed = placements.filter((t) => !ids.has(t.id));
      const byId = new Map(parts.map((p) => [p.id, p]));
      const obstacles = fixed
        .filter((t) => t.sheet === cluster.placement.sheet)
        .map((t) => transformed(byId.get(t.id).outer, t));
      const step = 360 / settings.rotations;
      const angles =
        settings.rotations === 1
          ? [0]
          : [
              ...new Set(
                [0, 180, 90, 270, step, 360 - step].map(
                  (a) => (Math.round(a / step) * step) % 360,
                ),
              ),
            ];
      let best = null;
      for (const angle of angles) {
        if (now() >= deadline) break;
        const base = { ...cluster.placement, x: 0, y: 0, angle };
        const moving = transformed(cluster.outer, base);
        // The unchanged normal placement source uses the union exterior and gap.
        const candidates = pocketTranslations(
          moving,
          obstacles,
          {
            x: settings.margin,
            y: settings.margin,
            w: settings.width - 2 * settings.margin,
            h: settings.height - 2 * settings.margin,
          },
          settings.gap,
          () => now() >= deadline,
        );
        for (const position of candidates) {
          if (now() >= deadline) break;
          generated++;
          count("clusterCandidates");
          count("generatedCandidates");
          const macro = { ...base, ...position },
            outline = transformed(cluster.outer, macro);
          if (obstacles.some((p) => !clearance(outline, p, settings.gap)))
            continue;
          const children = expandPairCluster(cluster, macro),
            map = new Map(children.map((t) => [t.id, t]));
          const trial = placements.map((t) => map.get(t.id) || t);
          if (validateLayout(parts, trial, settings).length) continue;
          const candidate = evaluateLayout(parts, trial, settings);
          if (improves(candidate.score, (best?.report || report).score))
            best = { placements: trial, report: candidate };
        }
      }
      if (best) {
        placements = best.placements;
        report = best.report;
        moved++;
        options.onImprove?.(best);
      }
    }
    return {
      placements,
      report,
      changed: moved > 0,
      clusterCount: clusters.length,
      clustersMoved: moved,
      clusterCandidateCount: generated,
    };
  });
}
