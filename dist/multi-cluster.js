import { dockConnectedClusters } from "./cluster-docking.js?v=0.26.4";
import { clusterPierceLowerBound } from "./cluster-pierces.js?v=0.26.4";
import {
  extractPartEdges,
  commonEdgeCandidates,
} from "./common-edge.js?v=0.26.4";
import {
  contactsAtPlacement,
  commonContactClearance,
} from "./common-contact.js?v=0.26.4";
import {
  createPartCluster,
  expandPairCluster,
} from "./pair-cluster.js?v=0.26.4";
import {
  area,
  bounds,
  transformed,
  clearance,
  validateLayout,
} from "./geometry.js?v=0.26.4";
import { cuttingMetrics } from "./cut-metrics.js?v=0.26.4";
import { pocketTranslations } from "./pocket-search.js?v=0.26.4";
import { evaluateLayout, improves } from "./search.js?v=0.26.4";
import { count, measured } from "./nesting-profile.js?v=0.26.4";
import { scoreDecision } from "./nesting-debug.js?v=0.26.4";
const norm = (a) => ((a % 360) + 360) % 360;
const perimeter = (p) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + Math.hypot(a.x - b.x, a.y - b.y);
  }, 0);
export function clusterSettings(settings) {
  const maxClusterParts = settings.maxClusterParts ?? 4,
    beamWidth = settings.clusterBeamWidth ?? 8,
    minSharedLength = settings.clusterMinSharedLength ?? 1;
  if (
    !Number.isInteger(maxClusterParts) ||
    maxClusterParts < 2 ||
    maxClusterParts > 4 ||
    !Number.isInteger(beamWidth) ||
    beamWidth < 2 ||
    beamWidth > 32 ||
    !Number.isFinite(minSharedLength) ||
    minSharedLength <= 0
  )
    throw Error("Invalid cluster search settings");
  return { maxClusterParts, beamWidth, minSharedLength };
}
// O(n²) pair eligibility, followed by bounded neighbours, never n-choose-3/4.
// Arbitrary contact rotations make any two genuine straight edges potentially
// compatible; rotation-locked/grid modes also test their relative orientation.
export function compatibilityGraph(parts, placements, settings, options = {}) {
  const { beamWidth, minSharedLength } = clusterSettings(settings),
    byPose = new Map(placements.map((t) => [t.id, t]));
  const graph = new Map(parts.map((p) => [p.id, []]));
  const edges = new Map(parts.map((p) => [p.id, extractPartEdges(p)]));
  const stop = options.shouldStop || (() => false),
    limit = Math.min(16, beamWidth * 2),
    step = 360 / settings.rotations;
  pairLoop: for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      if (stop()) {
        options.onDebug?.({ stage: "cluster-prune", reason: "graph-deadline" });
        break pairLoop;
      }
      const a = parts[i],
        b = parts[j],
        ta = byPose.get(a.id),
        tb = byPose.get(b.id);
      if (!ta || !tb || ta.sheet !== tb.sheet) continue;
      let potential = 0;
      for (const ea of edges.get(a.id))
        for (const eb of edges.get(b.id)) {
          count("clusterGraphEdgePairs");
          const length = Math.min(
            ea.length * (ta.scale ?? 1),
            eb.length * (tb.scale ?? 1),
          );
          if (length < minSharedLength || length <= potential) continue;
          if (
            settings.rotations === 1 ||
            settings.diagonalCommonEdgesEnabled !== true
          ) {
            const aa = norm(
              ta.angle + (ta.mirrored ? 180 - ea.angle : ea.angle),
            );
            const mirrorChoices = settings.allowMirror
              ? [false, true]
              : [!!tb.mirrored];
            if (
              !mirrorChoices.some((mirrored) => {
                const bb = norm(mirrored ? 180 - eb.angle : eb.angle),
                  required = norm(aa + 180 - bb);
                const available =
                  settings.rotations === 1
                    ? norm(tb.angle)
                    : norm(Math.round(required / step) * step);
                return (
                  Math.abs(((required - available + 540) % 360) - 180) <= 1e-7
                );
              })
            )
              continue;
          }
          potential = length;
        }
      if (potential) {
        graph.get(a.id).push({ id: b.id, potential });
        graph.get(b.id).push({ id: a.id, potential });
      }
    }
  for (const [id, links] of graph) {
    links.sort((a, b) => b.potential - a.potential || a.id.localeCompare(b.id));
    if (links.length > limit)
      options.onDebug?.({
        stage: "cluster-prune",
        reason: "neighbour-limit",
        partId: id,
        discarded: links.length - limit,
      });
    graph.set(id, links.slice(0, limit));
  }
  return graph;
}
function declared(parts, poses) {
  return poses.map((t) => ({
    ...t,
    sharedEdges: contactsAtPlacement(
      parts.find((p) => p.id === t.id),
      t,
      parts,
      poses,
    ),
  }));
}
export function clusterMetrics(cluster, settings) {
  const parts = cluster.children.map((c) => c.part),
    poses = expandPairCluster(cluster),
    cut = cuttingMetrics(parts, poses, settings);
  const materialArea = parts.reduce(
      (s, p, i) => s + Math.abs(area(p.outer)) * (poses[i].scale ?? 1) ** 2,
      0,
    ),
    boundingArea = cluster.size.w * cluster.size.h;
  const pierceLowerBound = clusterPierceLowerBound(parts, poses);
  const exteriorPerimeter = perimeter(cluster.outer),
    voidArea = Math.max(0, boundingArea - materialArea);
  // Conservative narrow-void proxy: area/perimeter width, not an exact remnant.
  const voidBoundary =
    exteriorPerimeter + 2 * (cluster.size.w + cluster.size.h);
  const voidWidth = voidBoundary ? (2 * voidArea) / voidBoundary : 0;
  const narrowWasteEstimate =
    voidWidth < (settings.minOffcutSide ?? 20) ? voidArea : 0;
  return {
    ...cut,
    pierceLowerBound,
    materialArea,
    boundingArea,
    areaUtilisation: materialArea / Math.max(boundingArea, 1e-9),
    exteriorPerimeter,
    narrowWasteEstimate,
    localScore: [
      boundingArea / Math.max(materialArea, 1e-9),
      narrowWasteEstimate / Math.max(materialArea, 1e-9),
      cut.estimatedCutLength / Math.sqrt(materialArea),
      pierceLowerBound,
      exteriorPerimeter / Math.sqrt(materialArea),
      -cut.sharedLength / Math.sqrt(materialArea),
    ],
  };
}
const compare = (a, b) => {
  for (let i = 0; i < a.metrics.localScore.length; i++) {
    const d = a.metrics.localScore[i] - b.metrics.localScore[i];
    if (Math.abs(d) > 1e-7) return d;
  }
  return a.key.localeCompare(b.key);
};
function stateFor(parts, poses, settings) {
  const cluster = createPartCluster(
    parts,
    declared(parts, poses),
    settings.gap,
  );
  if (!cluster) return null;
  const normal = expandPairCluster(cluster, {
    ...cluster.placement,
    x: 0,
    y: 0,
  });
  const key = normal
    .map((t) => [t.id, t.x, t.y, t.angle, t.scale, !!t.mirrored].join(":"))
    .sort()
    .join("|");
  return {
    cluster,
    key,
    metrics: clusterMetrics(cluster, settings),
    ids: parts.map((p) => p.id).sort(),
  };
}
function retain(states, width, debug) {
  const unique = new Map();
  for (const s of states) if (!unique.has(s.key)) unique.set(s.key, s);
  const ranked = [...unique.values()].sort(compare),
    result = [],
    memberships = new Set();
  // Preserve alternative memberships before spending the rest on orientations.
  for (const s of ranked) {
    const key = JSON.stringify(s.ids);
    if (!memberships.has(key)) {
      memberships.add(key);
      result.push(s);
      if (result.length === width) break;
    }
  }
  for (const s of ranked) {
    if (result.length === width) break;
    if (!result.includes(s)) result.push(s);
  }
  if (ranked.length > result.length)
    debug?.({
      stage: "cluster-prune",
      reason: "beam-width",
      generated: ranked.length,
      retained: result.map((s) => ({
        ids: s.ids,
        localScore: s.metrics.localScore,
      })),
    });
  return result;
}
export function searchMultiPartClusters(
  parts,
  placements,
  settings,
  options = {},
) {
  const { maxClusterParts, beamWidth, minSharedLength } =
      clusterSettings(settings),
    debug = options.onDebug;
  const clock = options.now || (() => performance.now()),
    start = clock(),
    end = options.searchDeadline ?? Infinity;
  let phaseEnd = Number.isFinite(end) ? start + (end - start) * 0.2 : Infinity,
    phaseEvents = 0;
  const stop = () =>
    options.shouldStop?.() ||
    clock() >= phaseEnd ||
    phaseEvents >= beamWidth * 64;
  const byId = new Map(parts.map((p) => [p.id, p])),
    byPose = new Map(placements.map((t) => [t.id, t]));
  const graph = compatibilityGraph(parts, placements, settings, {
      ...options,
      shouldStop: stop,
    }),
    pairs = [];
  phaseEnd = Number.isFinite(end) ? start + (end - start) * 0.45 : Infinity;
  for (const [a, links] of graph)
    for (const b of links)
      if (a < b.id || !graph.get(b.id).some((q) => q.id === a))
        pairs.push([a, b.id]);
  let generated = 0;
  const seeds = [],
    offset = (options.startOffset || 0) % Math.max(1, pairs.length);
  let visited = 0;
  function* attach(stateParts, statePoses, child, childPose) {
    // All original boundaries are considered; internal contacts reject geometrically.
    let events = 0;
    for (const fixed of statePoses) {
      if (
        !graph.get(fixed.id).some((l) => l.id === child.id) &&
        !graph.get(child.id).some((l) => l.id === fixed.id)
      )
        continue;
      for (const mirrored of settings.allowMirror
        ? [!!childPose.mirrored, !childPose.mirrored]
        : [!!childPose.mirrored])
        for (const c of commonEdgeCandidates(
          child,
          { ...childPose, mirrored },
          byId.get(fixed.id),
          fixed,
          {
            rotations: settings.rotations,
            diagonalCommonEdgesEnabled:
              settings.diagonalCommonEdgesEnabled === true,
            minOverlap: minSharedLength,
            preserveContactAlternatives: true,
            shouldStop: stop,
            onDebug: debug,
          },
        )) {
          if (stop()) return;
          generated++;
          phaseEvents++;
          count("clusterAssemblyCandidates");
          const next = stateFor(
            [...stateParts, child],
            [...statePoses, c.placement],
            settings,
          );
          if (next) {
            debug?.({
              stage: "cluster-assembly",
              status: "valid",
              ids: next.ids,
              metrics: next.metrics,
            });
            yield next;
          } else if (debug) {
            const allParts = [...stateParts, child],
              allPoses = declared(allParts, [...statePoses, c.placement]),
              reasons = [];
            for (let i = 0; i < allPoses.length; i++)
              for (let j = i + 1; j < allPoses.length; j++) {
                const r = commonContactClearance(
                  allParts[i],
                  allPoses[i],
                  allParts[j],
                  allPoses[j],
                  settings.gap,
                );
                if (!r.valid)
                  reasons.push({
                    parts: [allParts[i].id, allParts[j].id],
                    reason: r.reason,
                  });
              }
            debug({
              stage: "cluster-assembly",
              reason: reasons.length
                ? "validation"
                : "disconnected-or-holed-union",
              errors: reasons,
              ids: allParts.map((p) => p.id),
            });
          }
          if (++events >= 96) {
            debug?.({
              stage: "cluster-prune",
              reason: "contact-event-limit",
              partId: child.id,
            });
            return;
          }
        }
    }
  }
  // Reserve bounded work for expansion rather than permanently committing a pair.
  for (let i = 0; i < pairs.length && !stop(); i++) {
    const [a, b] = pairs[(offset + i) % pairs.length];
    visited++;
    const ta = { ...byPose.get(a), x: 0, y: 0 },
      tb = { ...byPose.get(b), x: 0, y: 0 };
    seeds.push(...attach([byId.get(a)], [ta], byId.get(b), tb));
    if (visited >= Math.max(8, beamWidth * 4)) {
      debug?.({
        stage: "cluster-prune",
        reason: "seed-pair-limit",
        visited,
        total: pairs.length,
      });
      break;
    }
  }
  let beam = retain(seeds, beamWidth, debug);
  const levels = [beam];
  for (let size = 3; size <= maxClusterParts; size++) {
    phaseEvents = 0;
    phaseEnd = Number.isFinite(end)
      ? start + (end - start) * (size === maxClusterParts ? 1 : 0.72)
      : Infinity;
    if (stop()) break;
    const next = [];
    for (const state of beam) {
      if (stop()) break;
      const ids = new Set(state.ids),
        neighbourIds = new Set(
          state.ids.flatMap((id) => graph.get(id).map((l) => l.id)),
        );
      const childParts = state.cluster.children.map((c) => c.part),
        childPoses = expandPairCluster(state.cluster);
      for (const id of neighbourIds) {
        if (stop()) break;
        if (ids.has(id)) continue;
        next.push(
          ...attach(childParts, childPoses, byId.get(id), byPose.get(id)),
        );
      }
    }
    beam = retain(next, beamWidth, debug);
    levels.push(beam);
  }
  debug?.({
    stage: "cluster-search",
    status:
      clock() >= phaseEnd || options.shouldStop?.()
        ? "deadline"
        : phaseEvents >= beamWidth * 64
          ? "phase-event-limit"
          : "complete",
    sizes: levels.map((l, i) => ({ size: i + 2, count: l.length })),
    generated,
    seedPairsVisited: visited,
    totalSeedPairs: pairs.length,
  });
  return {
    candidates: levels.flat(),
    levels,
    generated,
    nextOffset: (offset + visited) % Math.max(1, pairs.length),
  };
}
export function compactMultiPartClusters(
  parts,
  initial,
  settings,
  options = {},
) {
  return measured("multiPartClusters", () => {
    const now = options.now || (() => performance.now()),
      deadline = options.deadline ?? Infinity,
      started = now(),
      debug = options.onDebug;
    const docking = dockConnectedClusters(parts, initial, settings, {
      ...options,
      now,
      deadline: Number.isFinite(deadline)
        ? started + (deadline - started) * 0.25
        : Infinity,
    });
    const assemblyStart = now();
    const assemblyDeadline = Number.isFinite(deadline)
      ? assemblyStart + (deadline - assemblyStart) * 0.5
      : Infinity;
    const search = searchMultiPartClusters(parts, initial, settings, {
      ...options,
      now,
      searchDeadline: assemblyDeadline,
      shouldStop: () => now() >= assemblyDeadline,
    });
    let report = evaluateLayout(parts, initial, settings),
      best = docking.changed ? docking : null,
      generated = docking.generated;
    const byId = new Map(parts.map((p) => [p.id, p])),
      byPose = new Map(initial.map((t) => [t.id, t]));
    // Give larger clusters a turn; every accepted result uses the full sheet score.
    const candidates = search.candidates
      .slice()
      .sort((a, b) => b.ids.length - a.ids.length || compare(a, b));
    for (const state of candidates) {
      if (now() >= deadline) break;
      const cluster = state.cluster,
        ids = new Set(state.ids),
        sheet = cluster.placement.sheet;
      const fixed = initial
        .filter((t) => !ids.has(t.id))
        .map((t) => ({
          ...t,
          sharedEdges: (t.sharedEdges || []).filter(
            (d) => !ids.has(d.otherPartId),
          ),
        }));
      const obstacles = fixed
        .filter((t) => t.sheet === sheet)
        .map((t) => transformed(byId.get(t.id).outer, t));
      const angles =
        settings.rotations === 1
          ? [0]
          : [0, 90, 180, 270].filter(
              (a) =>
                Math.abs(
                  a / (360 / settings.rotations) -
                    Math.round(a / (360 / settings.rotations)),
                ) < 1e-8,
            );
      for (const angle of angles) {
        if (now() >= deadline) break;
        const base = { ...cluster.placement, x: 0, y: 0, angle },
          moving = transformed(cluster.outer, base),
          bb = bounds(moving),
          seen = new Set();
        const positions = [
          { x: settings.margin - bb.x, y: settings.margin - bb.y },
          ...cluster.children.map((c) => ({
            x: byPose.get(c.part.id).x - c.placement.x,
            y: byPose.get(c.part.id).y - c.placement.y,
          })),
        ];
        positions.push(
          ...pocketTranslations(
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
          ),
        );
        for (const position of positions) {
          if (now() >= deadline) break;
          const key = JSON.stringify(position);
          if (seen.has(key)) continue;
          seen.add(key);
          generated++;
          count("generatedCandidates");
          count("clusterCandidates");
          const macro = { ...base, ...position };
          if (
            obstacles.some(
              (p) =>
                !clearance(transformed(cluster.outer, macro), p, settings.gap),
            )
          ) {
            debug?.({
              stage: "cluster-global",
              reason: "external-clearance",
              ids: state.ids,
            });
            continue;
          }
          const children = expandPairCluster(cluster, macro),
            map = new Map([...fixed, ...children].map((t) => [t.id, t])),
            trial = initial.map((t) => map.get(t.id));
          const errors = validateLayout(parts, trial, settings);
          if (errors.length) {
            debug?.({
              stage: "cluster-global",
              reason: "validation",
              ids: state.ids,
              errors,
            });
            continue;
          }
          const candidate = evaluateLayout(parts, trial, settings),
            better = improves(candidate.score, (best?.report || report).score);
          debug?.({
            stage: "cluster-global",
            reason: better ? "best-so-far" : "not-better",
            ids: state.ids,
            metrics: state.metrics,
            score: candidate.score,
            decidingCriterion: scoreDecision(
              candidate.score,
              (best?.report || report).score,
            ),
          });
          if (better)
            best = { placements: trial, report: candidate, ids: state.ids };
        }
      }
    }
    if (best) {
      debug?.({
        stage: "cluster-selected",
        ids: best.ids,
        score: best.report.score,
      });
      options.onImprove?.(best);
    }
    return {
      placements: best?.placements || initial,
      report: best?.report || report,
      changed: !!best,
      clustersMoved: best ? 1 : 0,
      clusterCount: search.candidates.length,
      clusterCandidateCount: generated,
      clusterAssemblyCount: search.generated,
      maxClusterSize: Math.max(
        0,
        ...search.candidates.map((c) => c.ids.length),
      ),
      nextClusterOffset: search.nextOffset,
      nextDockOffset: docking.nextOffset,
      dockingCandidateCount: docking.generated,
    };
  });
}
