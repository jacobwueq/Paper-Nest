import {
  bounds,
  transformed,
  clearance,
  validateLayout,
} from "./geometry.js?v=0.5.1";
import { evaluateLayout, improves } from "./search.js?v=0.5.1";

// Coordinate descent in drawing coordinates. All moves are collision checked
// against the retained contours; no simplified or re-created drawing is exported.
export function compactLayout(parts, initial, settings, options = {}) {
  const now = options.now || (() => performance.now());
  const deadline = now() + (options.milliseconds ?? 1800);
  const byId = new Map(parts.map((p) => [p.id, p]));
  let placements = initial.map((t) => ({ ...t }));
  if (validateLayout(parts, placements, settings).length)
    return { placements, changed: false };
  let report = evaluateLayout(parts, placements, settings),
    changed = false;
  let visited = 0;
  const startOffset = options.startOffset || 0;
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
  function proxy(pp) {
    let free = 0,
      occupied = 0,
      moment = 0;
    for (const sheet of new Set(placements.map((t) => t.sheet))) {
      const shapes = pp.filter((p, i) => placements[i].sheet === sheet);
      const b = bounds(shapes.flat());
      const r = globalThis.PaperOffcut.edgeRectangle(
        b,
        {
          x: settings.margin,
          y: settings.margin,
          w: settings.width - 2 * settings.margin,
          h: settings.height - 2 * settings.margin,
        },
        gap,
      );
      free = Math.max(free, r.w * r.h);
      occupied += b.w * b.h;
      for (const p of shapes) {
        const a = bounds(p);
        moment += (a.x + a.w / 2 - b.x) ** 2 + (a.y + a.h / 2 - b.y) ** 2;
      }
    }
    return [-free, occupied, moment];
  }
  function compare(a, b) {
    for (let i = 0; i < a.length; i++)
      if (Math.abs(a[i] - b[i]) > 1e-5) return a[i] - b[i];
    return 0;
  }
  for (let pass = 0; pass < (options.passes ?? 5) && now() < deadline; pass++) {
    let moved = false;
    // Alternate orders so small circles can vacate gaps before large contours
    // are reconsidered, and vice versa.
    const order = placements.map((t, i) => i);
    if (pass % 2 === 0) order.reverse();
    order.push(...order.splice(0, startOffset % Math.max(1, order.length)));
    for (const index of order) {
      if (now() >= deadline) break;
      visited++;
      const current = placements[index],
        source = byId.get(current.id).outer;
      const pp = polys(),
        oldBounds = bounds(pp[index]),
        oldProxy = proxy(pp);
      const neighbours = pp.filter(
        (p, i) => i !== index && placements[i].sheet === current.sheet,
      );
      const neighbourBounds = neighbours.map(bounds);
      const candidates = [];
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
      function consider(t, known = false) {
        const poly = transformed(source, t),
          b = bounds(poly);
        if (!known && !valid(poly, b)) return;
        const trial = pp.slice();
        trial[index] = poly;
        const value = proxy(trial);
        if (compare(value, oldProxy) >= -1e-5) return;
        candidates.push({ t, value });
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
      candidates.sort((a, b) => compare(a.value, b.value));
      let best = null;
      for (const candidate of candidates.slice(0, 8)) {
        if (now() >= deadline) break;
        const trial = placements.slice();
        trial[index] = candidate.t;
        const metrics = evaluateLayout(parts, trial, settings);
        if (improves(metrics.score, (best?.report || report).score))
          best = { placements: trial, report: metrics };
      }
      if (best) {
        placements = best.placements;
        report = best.report;
        changed = moved = true;
        options.onImprove?.({ placements, report });
      }
    }
    if (!moved) break;
  }
  return {
    placements,
    report,
    changed,
    incomplete: now() >= deadline,
    nextOffset: (startOffset + visited) % Math.max(1, placements.length),
  };
}
