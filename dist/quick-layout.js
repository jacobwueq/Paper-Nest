import { transformed, bounds, partHoles, containsPolygon, insideHole } from "./geometry.js?v=0.32.0";
// A first layout in milliseconds, before the nesting engine answers (found with the
// 80-part A2 stress test: the engine had not placed even 20 irregular parts after its
// 20 s budget). Parts go on shelves by bounding box, tallest first, turned 90° when
// that lowers them and the rotation setting allows it. Boxes are kept apart by the
// part gap plus a small allowance, so the result is valid by construction; compaction
// then tightens it with the exact outlines, and any better engine layout replaces it.
// With part-in-part on, parts with openings are shelved first and the largest
// remaining parts that fit are packed into a rectangle inside each opening.
export function shelfLayout(parts, settings) {
  const gap = settings.gap + 0.2, margin = settings.margin;
  const width = settings.width - 2 * margin, height = settings.height - 2 * margin;
  const quarter = settings.rotations % 4 === 0;
  const options = (p) => (quarter ? [0, 90] : [0]).map((angle) => {
    const t = { id: p.id, x: 0, y: 0, angle, scale: settings.scale ?? 1, mirrored: false, sheet: 0 };
    return { t, b: bounds(transformed(p.outer, t)) };
  }).sort((a, b) => a.b.h - b.b.h || a.t.angle - b.t.angle);
  const byHeight = (a, b) => b.option.b.h - a.option.b.h || b.option.b.w - a.option.b.w || (a.id < b.id ? -1 : 1);
  const items = parts.map((p) => ({ id: p.id, part: p, all: options(p), option: options(p).find((o) => o.b.w <= width + 1e-6 && o.b.h <= height + 1e-6) }))
    .filter((i) => i.option);
  const shelves = [], sheetTop = [], placements = [];
  const shelve = ({ option: { t, b } }) => {
    let shelf = shelves.find((s) => s.x + b.w <= width + 1e-6 && b.h <= s.h + 1e-6);
    if (!shelf) {
      let sheet = 0;
      while ((sheetTop[sheet] ?? 0) + b.h > height + 1e-6) sheet++;
      shelf = { sheet, y: sheetTop[sheet] ?? 0, h: b.h, x: 0 };
      sheetTop[sheet] = shelf.y + b.h + gap;
      shelves.push(shelf);
    }
    const placed = { ...t, sheet: shelf.sheet, x: margin + shelf.x - b.x, y: margin + shelf.y - b.y };
    placements.push(placed); shelf.x += b.w + gap;
    return placed;
  };
  if (settings.partInPart !== true) { items.sort(byHeight).forEach(shelve); return placements; }

  const hosts = items.filter((i) => partHoles(i.part).length).sort(byHeight);
  const guests = new Set(items.filter((i) => !hosts.includes(i)));
  for (const host of hosts) {
    const t = shelve(host);
    for (const local of partHoles(host.part)) {
      const hole = transformed(local, t), r = inscribed(hole);
      if (!r) continue;
      // Pack the largest guests that fit into the rectangle, on small shelves.
      const inner = { x: r.x + gap, y: r.y + gap, w: r.w - 2 * gap, h: r.h - 2 * gap };
      let x = 0, y = 0, rowH = 0;
      for (const g of [...guests].sort((a, b) => b.option.b.w * b.option.b.h - a.option.b.w * a.option.b.h)) {
        for (const o of g.all) {
          let gx = x, gy = y, gh = rowH;
          if (gx + o.b.w > inner.w + 1e-6) { gx = 0; gy = y + rowH + gap; gh = 0; }
          if (gx + o.b.w > inner.w + 1e-6 || gy + o.b.h > inner.h + 1e-6) continue;
          const placed = { ...o.t, sheet: t.sheet, x: inner.x + gx - o.b.x, y: inner.y + gy - o.b.y };
          if (!insideHole(hole, transformed(g.part.outer, placed), settings.gap)) continue;
          placements.push(placed); guests.delete(g);
          x = gx + o.b.w + gap; y = gy; rowH = Math.max(gh, o.b.h);
          break;
        }
      }
    }
  }
  [...guests].sort(byHeight).forEach(shelve);
  return placements;
}
// A large axis-aligned rectangle inside a hole: shrink the hole's bounding box about
// its centre (and try wide and tall variants) until the rectangle fits inside.
function inscribed(hole) {
  const b = bounds(hole), cx = hole.reduce((s, p) => s + p.x, 0) / hole.length, cy = hole.reduce((s, p) => s + p.y, 0) / hole.length;
  let best = null;
  for (const [fw, fh] of [[1, 1], [1, 0.7], [0.7, 1], [1, 0.5], [0.5, 1]])
    for (let f = 0.98; f > 0.3; f -= 0.04) {
      const w = b.w * fw * f, h = b.h * fh * f, r = { x: cx - w / 2, y: cy - h / 2, w, h };
      const corners = [{ x: r.x, y: r.y }, { x: r.x + w, y: r.y }, { x: r.x + w, y: r.y + h }, { x: r.x, y: r.y + h }];
      if (containsPolygon(hole, corners)) { if (!best || w * h > best.w * best.h) best = r; break; }
    }
  return best;
}
