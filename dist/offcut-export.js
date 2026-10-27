import { transformed, clearance } from "./geometry.js?v=0.29.2";
export const rectanglePoints = (r) => [
  { x: r.x, y: r.y },
  { x: r.x + r.w, y: r.y },
  { x: r.x + r.w, y: r.y + r.h },
  { x: r.x, y: r.y + r.h },
];
export function checkedOffcuts(
  parts,
  placements,
  sheet,
  settings,
  options = {},
) {
  const rectangles = options.offcuts || [];
  if (!Array.isArray(rectangles))
    throw new Error("Invalid offcut selection / 餘料選擇無效");
  const byId = new Map(parts.map((p) => [p.id, p]));
  const polygons = placements
    .filter((t) => t.sheet === sheet)
    .map((t) => transformed(byId.get(t.id).outer, t));
  const checked = [];
  for (const r of rectangles) {
    if (
      ![r.x, r.y, r.w, r.h].every(Number.isFinite) ||
      r.w <= 0 ||
      r.h <= 0 ||
      Math.min(r.w, r.h) < (settings.minOffcutSide ?? 20) - 1e-6 ||
      r.x < settings.margin - 1e-6 ||
      r.y < settings.margin - 1e-6 ||
      r.x + r.w > settings.width - settings.margin + 1e-6 ||
      r.y + r.h > settings.height - settings.margin + 1e-6
    )
      throw new Error("Invalid offcut dimensions / 餘料尺寸無效");
    const points = rectanglePoints(r);
    if (
      polygons.some((p) => !clearance(points, p, settings.gap)) ||
      checked.some((p) => !clearance(points, p, settings.gap))
    )
      throw new Error(
        "Offcut cut lines overlap parts or another offcut / 餘料切割線與零件或其他餘料相交",
      );
    checked.push(points);
  }
  return checked;
}
