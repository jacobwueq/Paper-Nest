import { transform, esc } from "./geometry.js?v=0.31.1";
import { mergeCommonLines, lineOperationKey } from "./common-line.js?v=0.31.1";

// Make an export-only copy. Geometry stays in each owner's source coordinates;
// detection happens after the complete placement transform, in physical mm.
export function prepareCommonLineExport(
  parts,
  placements,
  sheet,
  options = {},
) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const copies = new Map(),
    lines = [];
  for (const t of placements.filter((t) => t.sheet === sheet)) {
    const p = byId.get(t.id),
      copy = { ...p, entities: [] };
    copies.set(p.id, copy);
    const world = (q) =>
      transform({ x: q.x - p.origin.x, y: q.y - p.origin.y }, t);
    const inverse = (q) => {
      const a = (t.angle * Math.PI) / 180,
        dx = q.x - t.x,
        dy = q.y - t.y,
        s = t.scale ?? 1;
      return {
        x:
          p.origin.x +
          ((dx * Math.cos(a) + dy * Math.sin(a)) / s) * (t.mirrored ? -1 : 1),
        y: p.origin.y + (-dx * Math.sin(a) + dy * Math.cos(a)) / s,
      };
    };
    const add = (start, end, e) => {
      lines.push({
        start: world(start),
        end: world(end),
        owner: p.id,
        role: "part-boundary",
        inverse,
        entity: e,
        // Different fabrication operations must never be silently conflated.
        mergeKey: lineOperationKey(e),
      });
    };
    for (const e of p.entities) {
      if (e.kind === "poly") {
        for (let i = 0; i < e.vertices.length - (e.closed ? 0 : 1); i++) {
          const a = e.vertices[i],
            b = e.vertices[(i + 1) % e.vertices.length];
          if (a.bulge)
            copy.entities.push({
              ...e,
              closed: false,
              vertices: [{ ...a }, { ...b, bulge: 0 }],
            });
          else add(a, b, e);
        }
      } else if (e.kind === "svg" && e.pathCommands) {
        const m = e.pathMatrix;
        const physical = (q) => ({
          x: m.a * q.x + m.c * q.y + m.e,
          y: m.b * q.x + m.d * q.y + m.f,
        });
        let cursor = null,
          first = null;
        for (const command of e.pathCommands) {
          const { type, values: v } = command;
          if (type === "M") {
            cursor = { x: v[0], y: v[1] };
            first = cursor;
            continue;
          }
          const end =
            type === "Z" ? first : { x: v[v.length - 2], y: v[v.length - 1] };
          if (type === "L" || type === "Z")
            add(physical(cursor), physical(end), e);
          else {
            if (type !== "C")
              throw new Error("Unsupported normalised SVG command");
            copy.entities.push({
              ...e,
              pathCommands: undefined,
              straightSegments: [],
              svg: `<path fill="none" stroke="${esc(e.color || "#263e65")}" stroke-width="${e.pathStrokeWidth ?? 0.15}" data-layer="${esc(e.layer || "SVG")}" transform="matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].join(" ")})" d="M ${cursor.x} ${cursor.y} C ${v.join(" ")}"/>`,
            });
          }
          cursor = end;
        }
      } else {
        if (e.kind === "svg" && e.straightSegments?.length)
          throw new Error(
            "Re-import this SVG before common-line cleanup / 共線清理前請重新匯入 SVG",
          );
        copy.entities.push(e);
      }
    }
  }
  for (const s of mergeCommonLines(lines, options)) {
    copies.get(s.owner).entities.push({
      ...s.entity,
      kind: "poly",
      closed: false,
      vertices: [s.inverse(s.start), s.inverse(s.end)],
      segmentOwners: s.owners,
      geometryRole: s.role,
    });
  }
  return parts.map((p) => copies.get(p.id) || p);
}
