import {
  magneticSnapCandidates,
  rebuildContacts,
} from "./manual-layout.js?v=0.32.2";
import { contactComponents } from "./cluster-docking.js?v=0.32.2";
import { evaluateLayout, improves } from "./search.js?v=0.32.2";
import { count } from "./nesting-profile.js?v=0.32.2";

// Give nearby zero-clearance and endpoint events a turn before expensive
// orientation search. Use the manual geometry and the normal global score.
export function alignNearby(parts, initial, settings, options = {}) {
  let placements = initial,
    report = evaluateLayout(parts, placements, settings),
    changed = false;
  if (!settings.commonEdgeMode) return { placements, report, changed };
  const now = options.now || (() => performance.now()),
    deadline = options.deadline ?? now() + 350;
  const locked = new Set((settings.lockedPlacements || []).map((t) => t.id));
  for (let pass = 0; pass < 2 && now() < deadline; pass++) {
    let moved = false;
    const components = contactComponents(
      rebuildContacts(parts, placements, settings),
    );
    const selections = [
      ...placements.map((t) => [t.id]),
      ...components.filter((g) => g.length > 1),
    ];
    const offset = (options.startOffset || 0) % Math.max(1, selections.length);
    for (let k = 0; k < selections.length && now() < deadline; k++) {
      const ids = selections[(k + offset) % selections.length];
      if (ids.some((id) => locked.has(id))) continue;
      const candidates = magneticSnapCandidates(
        parts,
        placements,
        ids,
        settings,
        Math.max(0.1, settings.gap * 2 + 0.1),
        () => now() >= deadline,
      );
      let best = null;
      const seen = new Set();
      for (const candidate of candidates) {
        if (now() >= deadline) break;
        count("alignmentCandidates");
        if (!candidate.valid) continue;
        const key = candidate.placements
          .map((t) => [t.id, t.x, t.y, t.angle].join(","))
          .join(";");
        if (seen.has(key)) continue;
        seen.add(key);
        const metrics = evaluateLayout(parts, candidate.placements, settings);
        const better = improves(metrics.score, (best?.report || report).score);
        options.onDebug?.({
          stage: "auto-alignment",
          partIds: ids,
          kind: candidate.kind,
          sharedLength: candidate.sharedLength,
          reason: better ? "best-so-far" : "global-score-not-better",
          score: metrics.score,
        });
        if (better)
          best = { placements: candidate.placements, report: metrics };
      }
      if (best) {
        placements = best.placements;
        report = best.report;
        changed = moved = true;
        options.onImprove?.(best);
      }
    }
    if (!moved) break;
  }
  return { placements, report, changed };
}
