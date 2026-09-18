// Remnants are output/planning geometry, never source part boundaries.
export const GEOMETRY_ROLES = Object.freeze({
  part: "part-boundary",
  shared: "common-cut",
  remnant: "remnant-boundary",
  split: "generated-split-line",
});
export function remnantPlan(rectangles, sheet = 0) {
  return rectangles.map((r, i) => {
    const corners = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
    return {
      id: r.id || `remnant-${sheet}-${i}`,
      role: GEOMETRY_ROLES.remnant,
      sheet,
      rectangle: { x: r.x, y: r.y, w: r.w, h: r.h },
      splitLines: corners.map((start, j) => ({
        role: GEOMETRY_ROLES.split,
        start,
        end: corners[(j + 1) % 4],
        remnantId: r.id || `remnant-${sheet}-${i}`,
      })),
    };
  });
}
export function preservedRemnants(settings) {
  // Undefined preserves the old behaviour: no reservations unless explicitly supplied.
  return settings.preserveRemnantSplitLines === false
    ? []
    : settings.preservedRemnants || [];
}

// Stable reservations and newly found rectangles must remain disjoint, including
// the same gap required by export validation. Restore derived display area.
export function visibleRemnantRectangles(current, plans, sheet, gap) {
  const reserved = plans
    .filter((r) => r.sheet === sheet)
    .map((r) => r.rectangle);
  const conflicts = (a, b) =>
    a.x < b.x + b.w + gap - 1e-7 &&
    b.x < a.x + a.w + gap - 1e-7 &&
    a.y < b.y + b.h + gap - 1e-7 &&
    b.y < a.y + a.h + gap - 1e-7;
  return [
    ...reserved,
    ...current.filter((r) => !reserved.some((p) => conflicts(r, p))),
  ].map((r) => ({ ...r, area: r.w * r.h }));
}
