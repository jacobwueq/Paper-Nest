import { alignNearby } from "./auto-align.js?v=0.13.0";
import { compactMultiPartClusters } from "./multi-cluster.js?v=0.13.0";
import {
  createNestingDiagnostics,
  scoreDecision,
} from "./nesting-debug.js?v=0.13.0";
import { compactPairClusters } from "./pair-cluster.js?v=0.13.0";
import { profiled, count } from "./nesting-profile.js?v=0.13.0";
import {
  contactFromCandidate,
  replacePlacement,
  contactsAtPlacement,
} from "./common-contact.js?v=0.13.0";
import { commonEdgeCandidates } from "./common-edge.js?v=0.13.0";
import { pocketTranslations } from "./pocket-search.js?v=0.13.0";
import {
  bounds,
  transformed,
  clearance,
  validateLayout,
} from "./geometry.js?v=0.13.0";
import { evaluateLayout, improves } from "./search.js?v=0.13.0";

// Remove two parts together, keep several alternatives for the first, and
// reinsert the second. Only complete, improved layouts leave this function.
function repairPairs(parts, initial, settings, options) {
  const { now, deadline } = options;
  const byId = new Map(parts.map((p) => [p.id, p]));
  let placements = initial,
    report = evaluateLayout(parts, initial, settings),
    changed = false,
    visited = 0;
  const guard = 0.025 * Math.max(1, settings.scale ?? 1),
    gap = settings.gap + 2 * guard;
  const sheet = {
    x: settings.margin + guard,
    y: settings.margin + guard,
    w: settings.width - 2 * (settings.margin + guard),
    h: settings.height - 2 * (settings.margin + guard),
  };
  const step = 360 / settings.rotations;
  let pairDeadline = deadline;
  function* insert(t, fixed) {
    const obstacles = fixed
      .filter((p) => p.sheet === t.sheet)
      .map((p) => transformed(byId.get(p.id).outer, p));
    const angles = new Set([t.angle]);
    if (settings.rotations > 1)
      for (const d of [180, 90, -90])
        angles.add(
          (((Math.round((t.angle + d) / step) * step) % 360) + 360) % 360,
        );
    for (const angle of angles) {
      if (now() >= pairDeadline) return;
      const base = { ...t, x: 0, y: 0, angle };
      if (settings.commonEdgeMode === true) delete base.sharedEdges;
      const points = pocketTranslations(
        transformed(byId.get(t.id).outer, base),
        obstacles,
        sheet,
        gap,
        () => now() >= pairDeadline,
      );
      const envelope = bounds(
        initial
          .filter((p) => p.sheet === t.sheet)
          .flatMap((p) => transformed(byId.get(p.id).outer, p)),
      );
      const movingBounds = bounds(transformed(byId.get(t.id).outer, base));
      const expansion = (p) =>
        Math.max(
          0,
          p.x + movingBounds.x + movingBounds.w - envelope.x - envelope.w,
        ) +
        Math.max(
          0,
          p.y + movingBounds.y + movingBounds.h - envelope.y - envelope.h,
        );
      points.sort(
        (a, b) => expansion(a) - expansion(b) || a.y - b.y || a.x - b.x,
      );
      const sampled = [];
      for (const p of points) {
        // Rounded clearance corners create many almost-identical vertices.
        // Give spatially different pair alternatives a turn within the budget.
        if (sampled.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1)) continue;
        sampled.push(p);
        if (now() >= pairDeadline) return;
        const candidate = [...fixed, { ...base, ...p }];
        count("generatedCandidates");
        count("pairRepairCandidates");
        if (!validateLayout(parts, candidate, settings).length) yield candidate;
      }
    }
  }
  const concave = (poly) => {
    let positive = false,
      negative = false;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        c = poly[(i + 2) % poly.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      positive ||= cross > 1e-7;
      negative ||= cross < -1e-7;
    }
    return positive && negative;
  };
  // Pocket partners need not be near the part's current location. Search all
  // pairs, prioritising a concave holder and a convex part, and resume the queue.
  const pairs = [];
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      if (placements[i].sheet !== placements[j].sheet) continue;
      const ca = concave(byId.get(placements[i].id).outer),
        cb = concave(byId.get(placements[j].id).outer);
      let priority = ca !== cb ? 1 : ca ? 2 : 3;
      if (ca !== cb) {
        const holder = bounds(byId.get(placements[ca ? i : j].id).outer);
        const guest = bounds(byId.get(placements[ca ? j : i].id).outer);
        if (
          (guest.w <= holder.w && guest.h <= holder.h) ||
          (settings.rotations > 1 && guest.h <= holder.w && guest.w <= holder.h)
        )
          priority = 0;
      }
      pairs.push({ i, j, priority });
    }
  pairs.sort((a, b) => a.priority - b.priority || a.i - b.i || a.j - b.j);
  const offset = (options.pairOffset || 0) % Math.max(1, pairs.length);
  for (let n = 0; n < pairs.length && now() < deadline; n++) {
    const { i, j } = pairs[(offset + n) % pairs.length];
    const a = placements[i],
      b = placements[j];
    pairDeadline = Math.min(deadline, now() + 450);
    visited++;
    const fixed = placements
      .filter((t, k) => k !== i && k !== j)
      .map((t) => {
        if (settings.commonEdgeMode !== true) return t;
        return {
          ...t,
          sharedEdges: (t.sharedEdges || []).filter(
            (d) => d.otherPartId !== a.id && d.otherPartId !== b.id,
          ),
        };
      });
    let best = null;
    for (const [first, second] of [
      [a, b],
      [b, a],
    ]) {
      const beam = [];
      let alternatives = 0;
      for (const partial of insert(first, fixed)) {
        const score = evaluateLayout(parts, partial, settings).score;
        beam.push({ partial, score });
        beam.sort((a, b) => globalThis.PaperOffcut.compare(a.score, b.score));
        if (beam.length > 4) beam.pop();
        // Reserve time for completing the pair, rather than consuming the
        // entire job on partial arrangements that cannot be published.
        if (++alternatives >= 12) break;
      }
      for (const { partial } of beam)
        for (const complete of insert(second, partial)) {
          const metrics = evaluateLayout(parts, complete, settings);
          if (improves(metrics.score, (best?.report || report).score))
            best = { placements: complete, report: metrics };
        }
    }
    if (best) {
      // Keep stable part ordering and identity for continuation and exports.
      const map = new Map(best.placements.map((t) => [t.id, t]));
      placements = placements.map((t) => map.get(t.id));
      report = best.report;
      changed = true;
      options.onImprove?.({ placements, report });
    }
  }
  return {
    placements,
    report,
    changed,
    visited,
    nextPairOffset: (offset + visited) % Math.max(1, pairs.length),
  };
}

// Coordinate descent in drawing coordinates. All moves are collision checked
// against the retained contours; no simplified or re-created drawing is exported.
export function compactLayout(parts, initial, settings, options = {}) {
  const debug = createNestingDiagnostics(
    options.debug || settings.debugCommonEdges,
    options.debugLimit,
  );
  const result = profiled(options, () =>
    compactLayoutImpl(parts, initial, settings, {
      ...options,
      onDebug: debug.record || options.onDebug,
    }),
  );
  if (debug.snapshot())
    result.diagnostics = {
      ...debug.snapshot(),
      finalScore: result.report?.score,
      finalPlacements: result.placements,
    };
  return result;
}
function compactLayoutImpl(parts, initial, settings, options) {
  const now = options.now || (() => performance.now());
  const enhancedCommon =
    settings.commonEdgeMode === true &&
    (settings.multiPartClusteringEnabled === true ||
      settings.diagonalCommonEdgesEnabled === true);
  const deadline = now() + (options.milliseconds ?? 1800);
  const byId = new Map(parts.map((p) => [p.id, p]));
  let placements = initial.map((t) => ({ ...t }));
  if (validateLayout(parts, placements, settings).length)
    return { placements, changed: false };
  let report = evaluateLayout(parts, placements, settings),
    changed = false;
  if (enhancedCommon) {
    const aligned = alignNearby(parts, placements, settings, {
      ...options,
      now,
      deadline: Math.min(
        deadline,
        now() + Math.min(350, (options.milliseconds ?? 1800) * 0.25),
      ),
    });
    placements = aligned.placements;
    report = aligned.report;
    changed = aligned.changed;
  }
  let clusterResult = null;
  if (
    settings.commonEdgeMode === true &&
    (settings.pairClusters === true ||
      settings.multiPartClusteringEnabled === true)
  ) {
    clusterResult = (
      settings.multiPartClusteringEnabled === true
        ? compactMultiPartClusters
        : compactPairClusters
    )(parts, placements, settings, {
      ...options,
      now,
      deadline: Math.min(
        deadline,
        now() + (settings.multiPartClusteringEnabled ? 700 : 450),
      ),
      startOffset: options.clusterOffset || 0,
    });
    // Keep the ordinary search branch alive instead of committing early to a
    // locally attractive multi-part assembly. Compare both full layouts below.
    if (clusterResult.changed && settings.multiPartClusteringEnabled !== true) {
      placements = clusterResult.placements;
      report = clusterResult.report;
      changed = true;
    }
  }
  let visited = 0;
  const startOffset = options.startOffset || 0;
  let commonEdgeCandidateCount = 0;
  const guard = 0.025 * Math.max(1, settings.scale ?? 1);
  const margin = settings.margin + guard;
  const gap = settings.gap + guard * 2;
  const dirs = [
    [0, -1],
    [-1, 0],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [0, 1],
    [1, 0],
    [1, 1],
  ];
  const step = 360 / settings.rotations;
  const polys = () =>
    placements.map((t) => transformed(byId.get(t.id).outer, t));
  for (
    let pass = 0;
    pass < (options.groupOnly ? 0 : (options.passes ?? 5)) && now() < deadline;
    pass++
  ) {
    let moved = false;
    // Alternate orders so small circles can vacate gaps before large contours
    // are reconsidered, and vice versa.
    const order = placements.map((t, i) => i);
    if (pass % 2 === 0) order.reverse();
    order.push(...order.splice(0, startOffset % Math.max(1, order.length)));
    for (const index of order) {
      if (now() >= deadline) break;
      visited++;
      if (settings.lockedPlacements?.some((t) => t.id === placements[index].id))
        continue;
      const current = placements[index],
        source = byId.get(current.id).outer;
      const pp = polys(),
        oldBounds = bounds(pp[index]);
      const neighbours = pp.filter(
        (p, i) => i !== index && placements[i].sheet === current.sheet,
      );
      const neighbourBounds = neighbours.map(bounds);
      const seen = new Set(),
        exactSeen = new Set();
      let best = null;
      function valid(poly, b) {
        if (
          b.x < margin - 1e-6 ||
          b.y < margin - 1e-6 ||
          b.x + b.w > settings.width - margin + 1e-6 ||
          b.y + b.h > settings.height - margin + 1e-6
        )
          return false;
        return neighbours.every((other, i) => {
          const a = neighbourBounds[i];
          if (
            b.x + b.w + gap < a.x ||
            a.x + a.w + gap < b.x ||
            b.y + b.h + gap < a.y ||
            a.y + a.h + gap < b.y
          )
            return true;
          return clearance(poly, other, gap);
        });
      }
      function consider(t, known = false, contact = null) {
        count("generatedCandidates");
        const detail = contact
          ? {
              candidateKey: JSON.stringify([
                t.id,
                t.x,
                t.y,
                t.angle,
                !!t.mirrored,
              ]),
              partId: t.id,
              placement: t,
              contacts: contact,
              sharedLength: 0,
            }
          : null;
        if (contact && enhancedCommon) {
          contact = contactsAtPlacement(byId.get(t.id), t, parts, placements);
          detail.contacts = contact;
          detail.sharedLength = contact.reduce(
            (sum, d) =>
              sum +
              Math.hypot(
                d.ownSection[1].x - d.ownSection[0].x,
                d.ownSection[1].y - d.ownSection[0].y,
              ) *
                (t.scale ?? 1),
            0,
          );
        }
        const log = (reason, extra = {}) => {
          if (detail)
            options.onDebug?.({
              stage: "candidate",
              ...detail,
              reason,
              ...extra,
            });
        };
        const exactKey = JSON.stringify([
          t.x,
          t.y,
          t.angle,
          t.scale ?? 1,
          !!t.mirrored,
          t.sheet,
          known,
          contact,
        ]);
        if (options.optimise !== false && exactSeen.has(exactKey)) {
          count("earlyDuplicateCandidates");
          log("exact-duplicate");
          return;
        }
        exactSeen.add(exactKey);
        const poly = transformed(source, t),
          b = bounds(poly);
        const trial =
          settings.commonEdgeMode === true
            ? replacePlacement(placements, t, contact)
            : placements.slice();
        if (settings.commonEdgeMode === true) {
          const errors = validateLayout(parts, trial, settings);
          if (errors.length) {
            log("validation", { errors });
            return;
          }
        } else {
          if (!known && !valid(poly, b)) return;
          trial[index] = t;
          if (
            settings.lockedPlacements?.length &&
            validateLayout(parts, trial, settings).length
          )
            return;
          if (
            settings.preserveRemnantSplitLines !== false &&
            settings.preservedRemnants?.length &&
            validateLayout(parts, trial, settings).length
          )
            return;
        }
        if (now() >= deadline) {
          log("deadline-before-score");
          return;
        }
        const key =
          settings.commonEdgeMode === true && enhancedCommon
            ? JSON.stringify([t.x, t.y, t.angle, !!t.mirrored, contact])
            : [t.x, t.y, t.angle, !!t.mirrored]
                .map((v) => (typeof v === "number" ? v.toFixed(4) : v))
                .join(":");
        if (seen.has(key)) {
          count("duplicateCandidates");
          log("duplicate-pose-and-contacts");
          return;
        }
        seen.add(key);
        const metrics = evaluateLayout(parts, trial, settings);
        const better = improves(metrics.score, (best?.report || report).score);
        log(better ? "best-so-far" : "not-better", {
          score: metrics.score,
          cutting: metrics.cutting,
          incumbentScore: (best?.report || report).score,
          decidingCriterion: scoreDecision(
            metrics.score,
            (best?.report || report).score,
          ),
        });
        if (better) best = { placements: trial, report: metrics };
      }
      // Explicit contacts use the common-boundary validator only when enabled.
      // Disabled mode retains its original geometry gate and scoring path.
      for (const fixed of placements) {
        if (fixed.id === current.id || fixed.sheet !== current.sheet) continue;
        for (const candidate of commonEdgeCandidates(
          byId.get(current.id),
          current,
          byId.get(fixed.id),
          fixed,
          {
            rotations: settings.rotations,
            diagonalCommonEdgesEnabled:
              settings.commonEdgeMode === true &&
              settings.diagonalCommonEdgesEnabled === true,
            preserveContactAlternatives: enhancedCommon,
            onDebug: options.onDebug,
            shouldStop: () => now() >= deadline,
          },
        )) {
          commonEdgeCandidateCount++;
          options.onCandidate?.(candidate);
          consider(
            candidate.placement,
            false,
            settings.commonEdgeMode === true
              ? contactFromCandidate(candidate)
              : null,
          );
        }
        if (now() >= deadline) break;
      }
      // Evaluate pocket candidates before local nudges. No bounding-box proxy
      // or top-eight shortlist may discard a legal pocket before full scoring.
      const pocketAngles = new Set([current.angle]);
      if (settings.rotations > 1)
        pocketAngles.add(
          (((Math.round((current.angle + 180) / step) * step) % 360) + 360) %
            360,
        );
      for (const angle of pocketAngles) {
        if (now() >= deadline) break;
        const base = { ...current, x: 0, y: 0, angle };
        const translations = pocketTranslations(
          transformed(source, base),
          neighbours,
          {
            x: margin,
            y: margin,
            w: settings.width - 2 * margin,
            h: settings.height - 2 * margin,
          },
          gap,
          () => now() >= deadline,
        );
        translations.sort((a, b) => a.y - b.y || a.x - b.x);
        for (const point of translations) {
          if (now() >= deadline) break;
          consider({ ...base, ...point });
        }
      }

      function slide(t, dir) {
        const p = transformed(source, t),
          b = bounds(p);
        if (!valid(p, b)) return;
        const [dx, dy] = dir;
        const max = Math.min(
          dx < 0
            ? (b.x - margin) / -dx
            : dx > 0
              ? (settings.width - margin - b.x - b.w) / dx
              : Infinity,
          dy < 0
            ? (b.y - margin) / -dy
            : dy > 0
              ? (settings.height - margin - b.y - b.h) / dy
              : Infinity,
        );
        if (max <= 0.02) return;
        const at = (d) => ({ ...t, x: t.x + dx * d, y: t.y + dy * d });
        function clear(d) {
          const poly = p.map((v) => ({ x: v.x + dx * d, y: v.y + dy * d }));
          return valid(poly, { ...b, x: b.x + dx * d, y: b.y + dy * d });
        }
        let low = 0,
          high = max;
        if (clear(high)) low = high;
        else
          for (let n = 0; n < 16 && high - low > 0.02; n++) {
            const mid = (low + high) / 2;
            if (clear(mid)) low = mid;
            else high = mid;
          }
        if (low > 0.02) {
          const end = at(low);
          consider(end, true);
          return end;
        }
      }
      for (const dir of dirs) {
        if (now() >= deadline) break;
        slide(current, dir);
      }
      const angles = new Set([current.angle]);
      const centre = {
        x:
          (Math.min(...source.map((p) => p.x)) +
            Math.max(...source.map((p) => p.x))) /
          2,
        y:
          (Math.min(...source.map((p) => p.y)) +
            Math.max(...source.map((p) => p.y))) /
          2,
      };
      const radii = source.map((p) =>
        Math.hypot(p.x - centre.x, p.y - centre.y),
      );
      const circular =
        source.length > 20 && Math.max(...radii) - Math.min(...radii) < 0.05;
      if (settings.rotations > 1 && !circular)
        for (const delta of [180, 90, -90, step, -step, 5 * step, -5 * step])
          angles.add(
            (((Math.round((current.angle + delta) / step) * step) % 360) +
              360) %
              360,
          );
      for (const angle of angles)
        for (const mirrored of settings.allowMirror
          ? [!!current.mirrored, !current.mirrored]
          : [false]) {
          if (now() >= deadline) break;
          const t = { ...current, angle, mirrored };
          const b = bounds(transformed(source, t));
          const anchors = [
            [oldBounds.x, oldBounds.y],
            [
              oldBounds.x + (oldBounds.w - b.w) / 2,
              oldBounds.y + (oldBounds.h - b.h) / 2,
            ],
            [margin, margin],
          ];
          for (const other of neighbourBounds)
            anchors.push(
              [other.x, other.y + other.h + gap],
              [other.x + other.w + gap, other.y],
              [other.x - b.w - gap, other.y],
              [other.x, other.y - b.h - gap],
            );
          for (const [x, y] of anchors) {
            if (now() >= deadline) break;
            const trial = { ...t, x: t.x + x - b.x, y: t.y + y - b.y };
            const poly = transformed(source, trial),
              bb = bounds(poly);
            if (!valid(poly, bb)) continue;
            consider(trial, true);
            // Reinsert into a new gap, then slide to contact. This also allows a
            // sideways move followed by an upward move around a concave contour.
            for (const dir of dirs.slice(0, 4)) {
              if (now() >= deadline) break;
              const end = slide(trial, dir);
              if (end && dir[0] !== 0) slide(end, [0, -1]);
            }
          }
        }
      if (best) {
        placements = best.placements;
        report = best.report;
        changed = moved = true;
        options.onDebug?.({
          stage: "selected",
          partId: current.id,
          placement: placements[index],
          score: report.score,
        });
        options.onImprove?.({ placements, report });
      }
    }
    if (!moved) break;
  }
  let nextPairOffset = options.pairOffset || 0;
  if (now() < deadline) {
    const repaired = repairPairs(parts, placements, settings, {
      ...options,
      now,
      deadline,
    });
    if (repaired.changed) {
      placements = repaired.placements;
      report = repaired.report;
      changed = true;
    }
    nextPairOffset = repaired.nextPairOffset;
  }
  let selectedMultiCluster = false;
  if (settings.multiPartClusteringEnabled === true && clusterResult?.changed) {
    selectedMultiCluster = improves(clusterResult.report.score, report.score);
    options.onDebug?.({
      stage: "cluster-portfolio",
      reason: selectedMultiCluster ? "selected" : "ordinary-layout-better",
      clusterScore: clusterResult.report.score,
      ordinaryScore: report.score,
    });
    if (selectedMultiCluster) {
      placements = clusterResult.placements;
      report = clusterResult.report;
      changed = true;
    }
  }
  return {
    placements,
    report,
    changed,
    incomplete: now() >= deadline,
    nextPairOffset,
    commonEdgeCandidateCount,
    clusterCount: clusterResult?.clusterCount || 0,
    nextClusterOffset: clusterResult?.nextClusterOffset || 0,
    nextDockOffset: clusterResult?.nextDockOffset || 0,
    dockingCandidateCount: clusterResult?.dockingCandidateCount || 0,
    maxClusterSize: clusterResult?.maxClusterSize || 0,
    clusterAssemblyCount: clusterResult?.clusterAssemblyCount || 0,
    clustersMoved:
      settings.multiPartClusteringEnabled === true
        ? selectedMultiCluster
          ? clusterResult.clustersMoved
          : 0
        : clusterResult?.clustersMoved || 0,
    clusterCandidateCount: clusterResult?.clusterCandidateCount || 0,
    nextOffset: (startOffset + visited) % Math.max(1, placements.length),
  };
}
