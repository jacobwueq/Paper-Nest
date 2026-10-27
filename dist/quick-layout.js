import { transformed, bounds, partHoles, containsPolygon, insideHole, pointIn, clearance } from "./geometry.js?v=0.32.2";
// A first layout in milliseconds, before the nesting engine answers (found with the
// 80-part A2 stress test: the engine had not placed even 20 irregular parts after its
// 20 s budget). Bounding boxes are packed largest first (MaxRects), turned 90° when
// that fits better and the rotation setting allows it. Boxes are kept apart by the
// part gap plus a small allowance, so the result is valid by construction; compaction
// then tightens it with the exact outlines, and any better engine layout replaces it.
// With part-in-part on, parts with openings are packed first and the largest
// remaining parts that fit are packed into a rectangle inside each opening.
export function shelfLayout(parts, settings) {
  const gap = settings.gap + 0.2, margin = settings.margin;
  const width = settings.width - 2 * margin, height = settings.height - 2 * margin;
  const quarter = settings.rotations % 4 === 0;
  const options = (p) => (quarter ? [0, 90] : [0]).map((angle) => {
    const t = { id: p.id, x: 0, y: 0, angle, scale: settings.scale ?? 1, mirrored: false, sheet: 0 };
    return { t, b: bounds(transformed(p.outer, t)) };
  }).sort((a, b) => a.b.h - b.b.h || a.t.angle - b.t.angle);
  const items = parts.map((p) => ({ id: p.id, part: p, all: options(p), option: options(p).find((o) => o.b.w <= width + 1e-6 && o.b.h <= height + 1e-6) }))
    .filter((i) => i.option);
  // MaxRects (best short side fit) on boxes grown by the gap, sheet by sheet: the
  // earliest sheet that can take a box gets it. Packs far tighter than plain shelves.
  const bins = [], placements = [];
  const shelve = ({ all }) => {
    const fitting = all.filter((o) => o.b.w <= width + 1e-6 && o.b.h <= height + 1e-6);
    for (let sheet = 0; ; sheet++) {
      bins[sheet] ??= [{ x: 0, y: 0, w: width + gap, h: height + gap }];
      let best = null;
      for (const o of fitting) {
        const w = o.b.w + gap, h = o.b.h + gap;
        for (const r of bins[sheet]) {
          if (w > r.w + 1e-6 || h > r.h + 1e-6) continue;
          const score = [Math.min(r.w - w, r.h - h), Math.max(r.w - w, r.h - h)];
          if (!best || score[0] < best.score[0] - 1e-9 || (Math.abs(score[0] - best.score[0]) <= 1e-9 && score[1] < best.score[1])) best = { o, r, w, h, score };
        }
      }
      if (!best) continue;
      const { o: { t, b }, r, w, h } = best, used = { x: r.x, y: r.y, w, h };
      const placed = { ...t, sheet, x: margin + r.x - b.x, y: margin + r.y - b.y };
      placements.push(placed);
      bins[sheet] = split(bins[sheet], used);
      return placed;
    }
  };
  const byArea = (a, b) => b.option.b.w * b.option.b.h - a.option.b.w * a.option.b.h || (a.id < b.id ? -1 : 1);
  if (settings.partInPart !== true) { items.sort(byArea).forEach(shelve); return placements; }

  const hosts = items.filter((i) => partHoles(i.part).length).sort(byArea);
  const guests = new Set(items.filter((i) => !hosts.includes(i)));
  for (const host of hosts) {
    const t = shelve(host);
    for (const local of partHoles(host.part)) {
      const hole = transformed(local, t);
      // Try the true-shape fill and each candidate rectangle; keep whichever holds the
      // most guest area.
      const filled = fillHole(hole, t.sheet);
      let best = { packed: filled, area: filled.reduce((n, { g }) => n + g.option.b.w * g.option.b.h, 0) };
      for (const r of inscribed(hole)) {
        const packed = packInto(hole, r, t.sheet);
        const area = packed.reduce((n, { g }) => n + g.option.b.w * g.option.b.h, 0);
        if (!best || area > best.area) best = { packed, area };
      }
      for (const { g, placed } of best?.packed || []) { placements.push(placed); guests.delete(g); }
    }
  }
  // Bottom-left fill with the real outlines: largest guest first, each at the first
  // grid position (rows from the top of the opening) and allowed angle where it sits
  // inside the opening with the gap to its edges and to guests already there. Finds
  // room in concave openings (arrows, C shapes) that no single rectangle covers.
  // A raster screens positions first: a cell is usable when its centre lies inside the
  // opening at least `gap` from its edge and clear of guests already placed, and a
  // guest needs every cell whose centre it covers to be usable. Any position that
  // truly fits passes that screen, so only the exact check below decides.
  function fillHole(hole, sheet) {
    const hb = bounds(hole), out = [], polys = [], g2 = settings.gap + 0.05;
    const c = Math.max(0.5, Math.min(hb.w, hb.h) / 60);
    const nx = Math.max(1, Math.ceil(hb.w / c)), ny = Math.max(1, Math.ceil(hb.h / c));
    const free = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const q = { x: hb.x + (i + 0.5) * c, y: hb.y + (j + 0.5) * c };
      free[j * nx + i] = pointIn(q, hole) && edgeDistance(q, hole) >= settings.gap ? 1 : 0;
    }
    const angleStep = Math.max(45, 360 / Math.max(1, settings.rotations));
    let left = Math.abs(polygonArea(hole));
    for (const g of [...guests].sort((a, b) => b.option.b.w * b.option.b.h - a.option.b.w * a.option.b.h)) {
      if (Math.abs(polygonArea(g.part.outer)) * (settings.scale ?? 1) ** 2 > left) continue;
      let hit = null;
      for (let angle = 0; angle < 360 && !hit; angle += angleStep) {
        const t0 = { id: g.id, x: 0, y: 0, angle, scale: settings.scale ?? 1, mirrored: false, sheet };
        const base = transformed(g.part.outer, t0), bb = bounds(base);
        const cw = Math.ceil(bb.w / c), ch = Math.ceil(bb.h / c);
        if (cw > nx || ch > ny) continue;
        const cells = [];
        for (let v = 0; v < ch; v++) for (let u = 0; u < cw; u++)
          if (pointIn({ x: bb.x + (u + 0.5) * c, y: bb.y + (v + 0.5) * c }, base)) cells.push(v * nx + u);
        for (let j = 0; j + ch <= ny && !hit; j++)
          for (let i = 0; i + cw <= nx; i++) {
            const at = j * nx + i;
            if (!cells.every((k) => free[at + k])) continue;
            const dx = hb.x + i * c - bb.x, dy = hb.y + j * c - bb.y, poly = base.map((q) => ({ x: q.x + dx, y: q.y + dy }));
            if (!insideHole(hole, poly, g2)) continue;
            if (polys.some((o) => !clearance(o, poly, g2))) continue;
            hit = { placed: { ...t0, x: dx, y: dy }, poly };
            break;
          }
      }
      if (!hit) continue;
      out.push({ g, placed: hit.placed }); polys.push(hit.poly);
      left -= Math.abs(polygonArea(hit.poly));
      // Cells now covered by the guest, or within the gap of it, are no longer usable.
      const pb = bounds(hit.poly);
      for (let j = Math.max(0, Math.floor((pb.y - g2 - hb.y) / c)); j < Math.min(ny, Math.ceil((pb.y + pb.h + g2 - hb.y) / c)); j++)
        for (let i = Math.max(0, Math.floor((pb.x - g2 - hb.x) / c)); i < Math.min(nx, Math.ceil((pb.x + pb.w + g2 - hb.x) / c)); i++) {
          if (!free[j * nx + i]) continue;
          const q = { x: hb.x + (i + 0.5) * c, y: hb.y + (j + 0.5) * c };
          if (pointIn(q, hit.poly) || edgeDistance(q, hit.poly) < settings.gap) free[j * nx + i] = 0;
        }
    }
    return out;
  }
  // Pack the largest guests that fit into rectangle r inside the hole, on small shelves.
  function packInto(hole, r, sheet) {
    const inner = { x: r.x + gap, y: r.y + gap, w: r.w - 2 * gap, h: r.h - 2 * gap }, out = [];
    let x = 0, y = 0, rowH = 0;
    for (const g of [...guests].sort((a, b) => b.option.b.w * b.option.b.h - a.option.b.w * a.option.b.h)) {
      for (const o of g.all) {
        let gx = x, gy = y, gh = rowH;
        if (gx + o.b.w > inner.w + 1e-6) { gx = 0; gy = y + rowH + gap; gh = 0; }
        if (gx + o.b.w > inner.w + 1e-6 || gy + o.b.h > inner.h + 1e-6) continue;
        const placed = { ...o.t, sheet, x: inner.x + gx - o.b.x, y: inner.y + gy - o.b.y };
        if (!insideHole(hole, transformed(g.part.outer, placed), settings.gap)) continue;
        out.push({ g, placed });
        x = gx + o.b.w + gap; y = gy; rowH = Math.max(gh, o.b.h);
        break;
      }
    }
    return out;
  }
  [...guests].sort(byArea).forEach(shelve);
  return placements;
}
function edgeDistance(q, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    const f = l ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(q.x - a.x - f * dx, q.y - a.y - f * dy));
  }
  return best;
}
const polygonArea = (p) => p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a.x * b.y - b.x * a.y; }, 0) / 2;
// MaxRects: cut `used` out of every free rectangle it overlaps, then drop free
// rectangles contained in others.
function split(free, used) {
  const out = [];
  for (const r of free) {
    if (used.x >= r.x + r.w || used.x + used.w <= r.x || used.y >= r.y + r.h || used.y + used.h <= r.y) { out.push(r); continue; }
    if (used.x > r.x) out.push({ x: r.x, y: r.y, w: used.x - r.x, h: r.h });
    if (used.x + used.w < r.x + r.w) out.push({ x: used.x + used.w, y: r.y, w: r.x + r.w - used.x - used.w, h: r.h });
    if (used.y > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: used.y - r.y });
    if (used.y + used.h < r.y + r.h) out.push({ x: r.x, y: used.y + used.h, w: r.w, h: r.y + r.h - used.y - used.h });
  }
  return out.filter((a, i) => !out.some((b, j) => j !== i && b.x <= a.x + 1e-9 && b.y <= a.y + 1e-9 && b.x + b.w >= a.x + a.w - 1e-9 && b.y + b.h >= a.y + a.h - 1e-9 && (j < i || b.w * b.h > a.w * a.h + 1e-9)));
}
// Large axis-aligned rectangles inside a hole. Candidate edges are the hole's own
// vertex coordinates (a C-shaped opening's arms line up with them), or an even
// 14-step grid when the outline has many vertices; a box shrunk about the middle is
// also tried in a few proportions. All candidates are returned; the caller keeps the
// one that holds the most parts.
function inscribed(hole) {
  const b = bounds(hole);
  const lines = (values, lo, size) => {
    const distinct = [...new Set(values.map((v) => Math.round(v * 1000) / 1000))].sort((a, c) => a - c);
    return distinct.length <= 14 ? distinct : Array.from({ length: 15 }, (_, i) => lo + (size * i) / 14);
  };
  const xs = lines(hole.map((p) => p.x), b.x, b.w), ys = lines(hole.map((p) => p.y), b.y, b.h);
  const found = [];
  let best = null;
  for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++)
    for (let k = 0; k < ys.length; k++) for (let l = k + 1; l < ys.length; l++) {
      // Pull each edge in by a hair so a rectangle on the hole's own edge counts as inside.
      const r = { x: xs[i] + 1e-3, y: ys[k] + 1e-3, w: xs[j] - xs[i] - 2e-3, h: ys[l] - ys[k] - 2e-3 };
      if (best && r.w * r.h <= best.w * best.h) continue;
      const corners = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
      if (containsPolygon(hole, corners)) best = r;
    }
  if (best) found.push(best);
  // Round openings fit a centred box better than a grid: shrink one about the middle,
  // in a few proportions.
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  if (pointIn({ x: cx, y: cy }, hole))
    for (const [fw, fh] of [[1, 1], [1, 0.7], [0.7, 1], [1, 0.5], [0.5, 1]])
      for (let f = 0.98; f > 0.2; f -= 0.02) {
        const w = b.w * fw * f, h = b.h * fh * f, r = { x: cx - w / 2, y: cy - h / 2, w, h };
        if (containsPolygon(hole, [{ x: r.x, y: r.y }, { x: r.x + w, y: r.y }, { x: r.x + w, y: r.y + h }, { x: r.x, y: r.y + h }])) { found.push(r); break; }
      }
  return found;
}
