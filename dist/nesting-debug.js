// Bounded, opt-in diagnostics; callbacks never affect candidate ordering.
export function createNestingDiagnostics(enabled, limit = 600) {
  const events = [],
    decisions = [],
    counts = {};
  let dropped = 0;
  return {
    record: enabled
      ? (event) => {
          const key = `${event.stage}:${event.reason || event.status || "visited"}`;
          counts[key] = (counts[key] || 0) + 1;
          if (
            [
              "selected",
              "cluster-selected",
              "cluster-search",
              "cluster-portfolio",
              "cluster-docking-summary",
            ].includes(event.stage)
          ) {
            decisions.push(event);
            if (decisions.length > 100) decisions.shift();
          }
          if (events.length < limit) events.push(event);
          else dropped++;
        }
      : undefined,
    snapshot: () =>
      enabled ? { events, decisions, counts, dropped, limit } : undefined,
  };
}
export function scoreDecision(candidate, incumbent) {
  const names = [
    "unplaced-parts",
    "sheet-count",
    "offcut-area-and-proportions",
    "bounding-area",
    "cutting-cost",
    "compactness",
  ];
  for (let i = 0; i < Math.max(candidate.length, incumbent.length); i++) {
    const a = candidate[i],
      b = incumbent[i];
    if (Array.isArray(a)) {
      for (let j = 0; j < Math.max(a.length, b.length); j++)
        if (Math.abs((a[j] || 0) - (b[j] || 0)) > 1e-5)
          return names[i] + `[${j}]`;
    } else if (Math.abs((a || 0) - (b || 0)) > (i < 2 ? 0 : 1e-5))
      return names[i];
  }
  return "equal-score";
}
