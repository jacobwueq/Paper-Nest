import { bounds, transformed } from "./geometry.js?v=0.30.1";
import { mergeCommonLines } from "./common-line.js?v=0.30.1";
const EPS = 1e-6;
function sheetBounds(parts, placements, sheet) {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return placements
    .filter((t) => t.sheet === sheet)
    .map((t) => {
      const p = byId.get(t.id);
      if (!p) throw Error("Unknown part");
      return bounds(transformed(p.outer, t));
    });
}
function checkSettings(s) {
  if (
    ![s.width, s.height, s.kerf ?? 0].every(Number.isFinite) ||
    s.width <= 0 ||
    s.height <= 0 ||
    (s.kerf ?? 0) < 0
  )
    throw Error("Invalid sheet or kerf / 板材或 kerf 無效");
}
export function checkedSeparations(
  parts,
  placements,
  sheet,
  settings,
  lines = [],
) {
  checkSettings(settings);
  if (!Array.isArray(lines) || lines.length > 2)
    throw Error("At most two separation cuts / 最多兩條分離線");
  const boxes = sheetBounds(parts, placements, sheet),
    pad = (settings.kerf ?? 0) / 2;
  const result = [];
  for (const l of lines) {
    const { start: a, end: b } = l;
    if (!a || !b || ![a.x, a.y, b.x, b.y].every(Number.isFinite))
      throw Error("Invalid separation line");
    const horizontal =
      Math.abs(a.y - b.y) < EPS &&
      Math.abs(Math.min(a.x, b.x)) < EPS &&
      Math.abs(Math.max(a.x, b.x) - settings.width) < EPS;
    const vertical =
      Math.abs(a.x - b.x) < EPS &&
      Math.abs(Math.min(a.y, b.y)) < EPS &&
      Math.abs(Math.max(a.y, b.y) - settings.height) < EPS;
    if (!horizontal && !vertical)
      throw Error("Separation must span the full sheet / 分離線必須貫穿板材");
    const value = horizontal ? a.y : a.x,
      limit = horizontal ? settings.height : settings.width;
    if (value <= EPS || value >= limit - EPS)
      throw Error("Cut must divide the sheet interior");
    if (
      boxes.some((r) => {
        const low = horizontal ? r.y : r.x,
          high = low + (horizontal ? r.h : r.w);
        return value >= low - pad - EPS && value <= high + pad + EPS;
      })
    )
      throw Error(
        "Separation intersects part or kerf envelope / 分離線侵入零件或 kerf 範圍",
      );
    result.push({ start: { ...a }, end: { ...b }, role: "separation-cut" });
  }
  // Proposals cannot coincide with part edges (even at zero kerf); duplicates
  // within the separation selection are canonicalised independently of layers.
  return mergeCommonLines(result, { tolerance: EPS });
}
export function proposeSeparations(parts, placements, sheet, settings) {
  checkSettings(settings);
  const boxes = sheetBounds(parts, placements, sheet);
  if (!boxes.length) return [];
  const pad = (settings.kerf ?? 0) / 2 + 0.01,
    minSide = settings.minOffcutSide ?? 20,
    proposals = [];
  for (const axis of ["x", "y"]) {
    const limit = axis === "x" ? settings.width : settings.height,
      length = axis === "x" ? settings.height : settings.width;
    const lo = Math.min(...boxes.map((b) => b[axis])),
      hi = Math.max(...boxes.map((b) => b[axis] + (axis === "x" ? b.w : b.h)));
    const choices = [
      { value: lo - pad, free: lo - pad },
      { value: hi + pad, free: limit - hi - pad },
    ].filter((c) => c.value > 0 && c.value < limit && c.free >= minSide);
    choices.sort((a, b) => b.free - a.free);
    if (!choices.length) continue;
    const c = choices[0],
      line =
        axis === "x"
          ? {
              start: { x: c.value, y: 0 },
              end: { x: c.value, y: settings.height },
            }
          : {
              start: { x: 0, y: c.value },
              end: { x: settings.width, y: c.value },
            };
    checkedSeparations(parts, placements, sheet, settings, [line]);
    proposals.push({
      ...line,
      id: `${sheet}:${axis}:${c.value.toFixed(6)}`,
      axis,
      length,
      freeDepth: c.free,
    });
  }
  return proposals;
}
