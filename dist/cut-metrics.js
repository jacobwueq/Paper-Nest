import { entityPoints, bulgeArc } from "./geometry.js?v=0.13.0";
import { commonContactClearance } from "./common-contact.js?v=0.13.0";
import {
  mergeCommonLines,
  lineLength,
  lineOperationKey,
} from "./common-line.js?v=0.13.0";
const perimeter = (p, closed = true) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return (
      s + (closed || i < p.length - 1 ? Math.hypot(b.x - a.x, b.y - a.y) : 0)
    );
  }, 0);
function entityLength(e) {
  if (e.kind === "circle") return 2 * Math.PI * e.r;
  if (e.kind === "arc") return Math.abs(e.sweep) * e.r;
  if (e.kind === "poly")
    return e.vertices.reduce((s, a, i) => {
      if (!e.closed && i === e.vertices.length - 1) return s;
      const b = e.vertices[(i + 1) % e.vertices.length];
      if (a.bulge) {
        const arc = bulgeArc(a, b, a.bulge);
        return s + arc.r * Math.abs(arc.sweep);
      }
      return s + Math.hypot(b.x - a.x, b.y - a.y);
    }, 0);
  return perimeter(entityPoints(e), e.closed); // SVG curve length is sampled estimate.
}
export function cuttingMetrics(parts, placements, settings) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  let rawCutLength = 0;
  for (const t of placements) {
    const p = byId.get(t.id);
    rawCutLength +=
      (p.entities?.length
        ? p.entities.reduce((s, e) => s + entityLength(e), 0)
        : perimeter(p.outer)) * (t.scale ?? 1);
  }
  const sections = [];
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i],
        b = placements[j];
      if (
        a.sheet !== b.sheet ||
        ![...(a.sharedEdges || []), ...(b.sharedEdges || [])].some(
          (d) => d.otherPartId === a.id || d.otherPartId === b.id,
        )
      )
        continue;
      const result = commonContactClearance(
        byId.get(a.id),
        a,
        byId.get(b.id),
        b,
        settings.gap,
      );
      if (result.valid) {
        const declarations = [
          ...(a.sharedEdges || [])
            .filter((d) => d.otherPartId === b.id)
            .map((d) => [a, b, d]),
          ...(b.sharedEdges || [])
            .filter((d) => d.otherPartId === a.id)
            .map((d) => [b, a, d]),
        ];
        for (let k = 0; k < (result.shared || []).length; k++) {
          const [own, other, d] = declarations[k];
          const ownPart = byId.get(own.id),
            otherPart = byId.get(other.id);
          const ea = ownPart.entities?.[d.ownEdge.entityIndex];
          const eb = otherPart.entities?.[d.otherEdge.entityIndex];
          // Polygon-only geometry fixtures imply a single cutting operation.
          // Imported entities must resolve to matching export operations.
          if (
            (ownPart.entities || otherPart.entities) &&
            (!ea || !eb || lineOperationKey(ea) !== lineOperationKey(eb))
          )
            continue;
          const [start, end] = result.shared[k];
          sections.push({ start, end, mergeKey: a.sheet });
        }
      }
    }
  const sharedLength = mergeCommonLines(sections).reduce(
    (s, e) => s + lineLength(e),
    0,
  );
  return {
    rawCutLength,
    sharedLength,
    estimatedCutLength: Math.max(0, rawCutLength - sharedLength),
    pierceCount: null,
  };
}
