import { commonEdgeCandidates } from "./common-edge.js?v=0.27.2";
import { contactsAtPlacement } from "./common-contact.js?v=0.27.2";
import { transform, validateLayout } from "./geometry.js?v=0.27.2";
import { evaluateLayout, improves } from "./search.js?v=0.27.2";
import { count, measured } from "./nesting-profile.js?v=0.27.2";
import { scoreDecision } from "./nesting-debug.js?v=0.27.2";

// Components use declared, validated contacts, not proximity or bounding boxes.
export function contactComponents(placements) {
  const byId = new Map(placements.map((t) => [t.id, t])),
    graph = new Map(placements.map((t) => [t.id, new Set()]));
  for (const t of placements)
    for (const edge of t.sharedEdges || []) {
      const peer = byId.get(edge.otherPartId);
      if (peer && peer.sheet === t.sheet) {
        graph.get(t.id).add(peer.id);
        graph.get(peer.id).add(t.id);
      }
    }
  const seen = new Set(),
    result = [];
  for (const t of placements) {
    if (seen.has(t.id)) continue;
    const ids = [],
      queue = [t.id];
    seen.add(t.id);
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      ids.push(id);
      for (const peer of graph.get(id))
        if (!seen.has(peer)) {
          seen.add(peer);
          queue.push(peer);
        }
    }
    result.push(ids);
  }
  return result;
}
export function moveRigidComponent(poses, anchor, target) {
  const angle = target.angle - anchor.angle,
    rotation = { x: 0, y: 0, angle, scale: 1 };
  const old = transform(anchor, rotation),
    dx = target.x - old.x,
    dy = target.y - old.y;
  return poses.map((t) => {
    const p = transform(t, rotation);
    return {
      ...t,
      x: p.x + dx,
      y: p.y + dy,
      angle: (((t.angle + angle) % 360) + 360) % 360,
    };
  });
}
// Move an entire existing connected component, using original straight child
// edges. This also works for networks larger than the new-assembly beam limit.
export function dockConnectedClusters(parts, initial, settings, options = {}) {
  return measured("clusterDocking", () => {
    const report = evaluateLayout(parts, initial, settings),
      empty = {
        placements: initial,
        report,
        changed: false,
        generated: 0,
        nextOffset: options.dockOffset || 0,
      };
    if (settings.commonEdgeMode !== true) return empty;
    const now = options.now || (() => performance.now()),
      deadline = options.deadline ?? Infinity,
      debug = options.onDebug;
    const groups = contactComponents(initial),
      byId = new Map(parts.map((p) => [p.id, p])),
      poses = new Map(initial.map((t) => [t.id, t]));
    const queue = [];
    for (const ids of groups) {
      if (ids.length < 2) continue;
      const members = new Set(ids),
        sheet = poses.get(ids[0]).sheet;
      for (const anchorId of ids)
        for (const fixed of initial)
          if (!members.has(fixed.id) && fixed.sheet === sheet)
            queue.push({ ids, anchorId, fixed });
    }
    let best = null,
      generated = 0,
      visited = 0;
    const offset = (options.dockOffset || 0) % Math.max(1, queue.length),
      seen = new Set();
    for (
      let i = 0;
      i < queue.length && now() < deadline && generated < 256;
      i++
    ) {
      const { ids, anchorId, fixed } = queue[(offset + i) % queue.length],
        anchor = poses.get(anchorId),
        members = new Set(ids);
      visited++;
      for (const candidate of commonEdgeCandidates(
        byId.get(anchorId),
        anchor,
        byId.get(fixed.id),
        fixed,
        {
          rotations: settings.rotations,
          diagonalCommonEdgesEnabled:
            settings.diagonalCommonEdgesEnabled === true,
          preserveContactAlternatives: true,
          minOverlap: settings.clusterMinSharedLength ?? 1,
          shouldStop: () => now() >= deadline || generated >= 256,
        },
      )) {
        if (now() >= deadline || generated >= 256) break;
        const moved = moveRigidComponent(
          ids.map((id) => poses.get(id)),
          anchor,
          candidate.placement,
        );
        const key = JSON.stringify(moved.map((t) => [t.id, t.x, t.y, t.angle]));
        if (seen.has(key)) {
          count("clusterDockingDuplicates");
          continue;
        }
        seen.add(key);
        generated++;
        count("generatedCandidates");
        count("clusterDockingCandidates");
        const updates = new Map(moved.map((t) => [t.id, t]));
        let trial = initial.map((t) => updates.get(t.id) || t);
        trial = trial.map((t) =>
          members.has(t.id)
            ? {
                ...t,
                sharedEdges: contactsAtPlacement(
                  byId.get(t.id),
                  t,
                  parts,
                  trial,
                ),
              }
            : t,
        );
        const errors = validateLayout(parts, trial, settings);
        const detail = {
          stage: "cluster-docking",
          movingIds: ids,
          fixedPartId: fixed.id,
          sharedLength: candidate.sharedSection.length,
        };
        if (errors.length) {
          debug?.({ ...detail, reason: "validation", errors });
          continue;
        }
        if (now() >= deadline) {
          debug?.({ ...detail, reason: "deadline-before-score" });
          break;
        }
        const metrics = evaluateLayout(parts, trial, settings),
          better = improves(metrics.score, (best?.report || report).score);
        debug?.({
          ...detail,
          reason: better ? "best-so-far" : "not-better",
          score: metrics.score,
          decidingCriterion: scoreDecision(
            metrics.score,
            (best?.report || report).score,
          ),
        });
        if (better) best = { placements: trial, report: metrics, ids };
      }
    }
    debug?.({
      stage: "cluster-docking-summary",
      generated,
      visited,
      totalPairs: queue.length,
      reason:
        now() >= deadline
          ? "deadline"
          : generated >= 256
            ? "event-limit"
            : "complete",
    });
    return {
      ...empty,
      ...best,
      changed: !!best,
      generated,
      nextOffset: (offset + visited) % Math.max(1, queue.length),
    };
  });
}
