import { preservedRemnants } from "./remnant-policy.js?v=0.26.2";
import {
  cached,
  objectKey,
  poseKey,
  count,
} from "./nesting-profile.js?v=0.26.2";
import {
  commonContactClearance,
  sharedJunctions,
  junctionClearance,
} from "./common-contact.js?v=0.26.2";
// Geometry is expressed in millimetres, with screen Y pointing down.
export const TOL = 0.02;
export const near = (a, b, e = 1e-5) => Math.hypot(a.x - b.x, a.y - b.y) <= e;
export const area = (p) =>
  p.reduce((s, a, i) => {
    const b = p[(i + 1) % p.length];
    return s + a.x * b.y - b.x * a.y;
  }, 0) / 2;
export function bounds(p) {
  const xs = p.map((p) => p.x),
    ys = p.map((p) => p.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
export function transform(p, t) {
  const c = Math.cos((t.angle * Math.PI) / 180),
    s = Math.sin((t.angle * Math.PI) / 180);
  const scale = t.scale ?? 1;
  const x = p.x * scale * (t.mirrored ? -1 : 1),
    y = p.y * scale;
  return { x: x * c - y * s + t.x, y: x * s + y * c + t.y };
}
export const transformed = (p, t) =>
  cached("transformedGeometry", objectKey(p) + ":" + poseKey(t), () =>
    p.map((v) => transform(v, t)),
  );
export const pathPoints = (p) => p.map((v) => `${v.x},${v.y}`).join(" ");
export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export const fmt = (n) => Number(n.toFixed(7));
function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
export function pointIn(p, poly) {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i],
      b = poly[j];
    if (
      a.y > p.y != b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      yes = !yes;
  }
  return yes;
}
export function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = dx * dx + dy * dy;
  const t = l
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function segmentsCross(a, b, c, d) {
  const u = cross(a, b, c),
    v = cross(a, b, d),
    w = cross(c, d, a),
    z = cross(c, d, b);
  return (
    ((u > 1e-8 && v < -1e-8) || (u < -1e-8 && v > 1e-8)) &&
    ((w > 1e-8 && z < -1e-8) || (w < -1e-8 && z > 1e-8))
  );
}
export function simplePolygon(p) {
  if (p.length < 3 || Math.abs(area(p)) < 1e-6) return false;
  for (let i = 0; i < p.length; i++)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      if (
        segmentsCross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])
      )
        return false;
    }
  return true;
}
export function containsPolygon(outer, inner) {
  return (
    inner.every(
      (p) =>
        pointIn(p, outer) ||
        outer.some(
          (a, i) => segmentDistance(p, a, outer[(i + 1) % outer.length]) < 1e-5,
        ),
    ) &&
    !inner.some((a, i) =>
      outer.some((b, j) =>
        segmentsCross(
          a,
          inner[(i + 1) % inner.length],
          b,
          outer[(j + 1) % outer.length],
        ),
      ),
    )
  );
}
export function clearance(a, b, limit) {
  count("collisionTests");
  const ba = bounds(a),
    bb = bounds(b);
  if (
    ba.x + ba.w + limit < bb.x ||
    bb.x + bb.w + limit < ba.x ||
    ba.y + ba.h + limit < bb.y ||
    bb.y + bb.h + limit < ba.y
  )
    return true;
  if (pointIn(a[0], b) || pointIn(b[0], a)) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i],
      q = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const r = b[j],
        s = b[(j + 1) % b.length];
      if (segmentsCross(p, q, r, s)) return false;
      if (
        Math.min(
          segmentDistance(p, r, s),
          segmentDistance(q, r, s),
          segmentDistance(r, p, q),
          segmentDistance(s, p, q),
        ) <
        limit - 1e-5
      )
        return false;
    }
  }
  return true;
}
export function validateLayout(parts, placements, settings) {
  const errors = [],
    ids = new Set();
  const byId = new Map(parts.map((p) => [p.id, p]));
  const polygons = [];
  for (const locked of settings.lockedPlacements || []) {
    const current = placements.find((t) => t.id === locked.id);
    if (
      !current ||
      ["x", "y", "angle", "sheet"].some(
        (k) => Math.abs(current[k] - locked[k]) > 1e-8,
      ) ||
      (current.scale ?? 1) !== (locked.scale ?? 1) ||
      !!current.mirrored !== !!locked.mirrored
    )
      errors.push(`${locked.id}: locked position / 已鎖定位置`);
  }
  for (const t of placements) {
    const p = byId.get(t.id);
    if (!p || ids.has(t.id)) {
      errors.push("Duplicate or unknown part / 零件重複或不明");
      continue;
    }
    ids.add(t.id);
    if (![t.x, t.y, t.angle, t.sheet].every(Number.isFinite)) {
      errors.push("Invalid placement / 排位座標無效");
      continue;
    }
    if (
      (t.scale !== undefined && (!Number.isFinite(t.scale) || t.scale <= 0)) ||
      (t.mirrored && settings.allowMirror === false)
    ) {
      errors.push("Invalid scale or mirror setting / 比例或鏡像設定不符");
      continue;
    }
    const poly = transformed(p.outer, t),
      b = bounds(poly);
    if (
      b.x < settings.margin - 1e-4 ||
      b.y < settings.margin - 1e-4 ||
      b.x + b.w > settings.width - settings.margin + 1e-4 ||
      b.y + b.h > settings.height - settings.margin + 1e-4
    )
      errors.push(`${p.name}: outside sheet / 超出板材`);
    polygons.push({ t, p, poly });
  }
  for (const remnant of preservedRemnants(settings)) {
    const r = remnant.rectangle;
    if (
      remnant.role !== "remnant-boundary" ||
      !r ||
      ![r.x, r.y, r.w, r.h].every(Number.isFinite) ||
      r.w <= 0 ||
      r.h <= 0
    ) {
      errors.push("Invalid preserved remnant");
      continue;
    }
    const outline = [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ];
    for (const p of polygons)
      if (
        p.t.sheet === remnant.sheet &&
        !clearance(p.poly, outline, settings.gap)
      )
        errors.push(`${p.t.id}: preserved-remnant / 已保留餘料`);
  }
  const failures = [],
    sharedPairs = [];
  for (let i = 0; i < polygons.length; i++)
    for (let j = i + 1; j < polygons.length; j++) {
      const a = polygons[i],
        b = polygons[j];
      if (a.t.sheet === b.t.sheet) {
        const result =
          settings.commonEdgeMode === true
            ? commonContactClearance(a.p, a.t, b.p, b.t, settings.gap)
            : {
                valid: clearance(a.poly, b.poly, settings.gap),
                reason: "clearance",
              };
        if (!result.valid) failures.push({ a, b, result });
        else if (
          settings.multiPartClusteringEnabled === true &&
          result.shared?.length
        )
          sharedPairs.push({
            a: a.t.id,
            b: b.t.id,
            sheet: a.t.sheet,
            shared: result.shared,
          });
      }
    }
  for (const { a, b, result } of failures) {
    const authorisedJunction =
      settings.commonEdgeMode === true &&
      settings.multiPartClusteringEnabled === true &&
      result.reason === "unapproved-touch" &&
      junctionClearance(
        a.poly,
        b.poly,
        settings.gap,
        sharedJunctions(sharedPairs, a.t.id, b.t.id, a.t.sheet),
      );
    if (!authorisedJunction)
      errors.push(
        settings.commonEdgeMode === true
          ? `${a.p.name} / ${b.p.name}: ${result.reason} / 接觸或間距無效`
          : `${a.p.name} / ${b.p.name}: clearance / 間距不足`,
      );
  }
  if (settings.commonEdgeMode === true)
    for (const { t } of polygons) {
      if (t.sharedEdges !== undefined && !Array.isArray(t.sharedEdges)) {
        errors.push("Invalid shared metadata");
        continue;
      }
      for (const d of t.sharedEdges || [])
        if (
          !d ||
          d.otherPartId === t.id ||
          !polygons.some(
            (q) => q.t.id === d.otherPartId && q.t.sheet === t.sheet,
          )
        )
          errors.push("Unknown or cross-sheet shared partner");
    }
  return [...new Set(errors)];
}
export function sampleArc(cx, cy, r, start, sweep) {
  const step = 2 * Math.acos(Math.max(-1, 1 - TOL / Math.max(r, TOL)));
  const n = Math.max(
    2,
    Math.ceil(Math.abs(sweep) / Math.min(step, Math.PI / 12)),
  );
  if (n > 4000) throw new Error("Curve is too complex / 曲線過於複雜");
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: cx + r * Math.cos(start + (sweep * i) / n),
    y: cy + r * Math.sin(start + (sweep * i) / n),
  }));
}
export function bulgeArc(a, b, bulge) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    l = Math.hypot(dx, dy);
  const factor = (1 - bulge * bulge) / (4 * bulge);
  const cx = (a.x + b.x) / 2 - dy * factor,
    cy = (a.y + b.y) / 2 + dx * factor;
  return {
    cx,
    cy,
    r: (l * (1 + bulge * bulge)) / (4 * Math.abs(bulge)),
    start: Math.atan2(a.y - cy, a.x - cx),
    sweep: 4 * Math.atan(bulge),
  };
}
export function entityPoints(e) {
  if (e.kind === "svg") return e.points;
  if (e.kind === "circle")
    return sampleArc(e.cx, e.cy, e.r, 0, Math.PI * 2).slice(0, -1);
  if (e.kind === "arc") return sampleArc(e.cx, e.cy, e.r, e.start, e.sweep);
  const out = [];
  for (let i = 0; i < e.vertices.length; i++) {
    const a = e.vertices[i],
      b = e.vertices[(i + 1) % e.vertices.length];
    out.push({ x: a.x, y: a.y });
    if (a.bulge && (e.closed || i < e.vertices.length - 1)) {
      const c = bulgeArc(a, b, a.bulge);
      out.push(...sampleArc(c.cx, c.cy, c.r, c.start, c.sweep).slice(1, -1));
    }
  }
  return out;
}
export function entitySVG(e) {
  const color = e.color || "#263e65";
  const attrs = `fill="none" stroke="${esc(color)}" stroke-width="0.15" data-layer="${esc(e.layer || "0")}"`;
  if (e.kind === "svg") return e.svg;
  if (e.kind === "circle")
    return `<circle ${attrs} cx="${e.cx}" cy="${e.cy}" r="${e.r}"/>`;
  if (e.kind === "arc") {
    const a = {
        x: e.cx + e.r * Math.cos(e.start),
        y: e.cy + e.r * Math.sin(e.start),
      },
      b = {
        x: e.cx + e.r * Math.cos(e.start + e.sweep),
        y: e.cy + e.r * Math.sin(e.start + e.sweep),
      };
    return `<path ${attrs} d="M${a.x} ${a.y} A${e.r} ${e.r} 0 ${Math.abs(e.sweep) > Math.PI ? 1 : 0} ${e.sweep > 0 ? 1 : 0} ${b.x} ${b.y}"/>`;
  }
  let d = "";
  e.vertices.forEach((a, i) => {
    if (i === 0) d = `M${a.x} ${a.y}`;
    const b = e.vertices[(i + 1) % e.vertices.length];
    if (e.closed || i < e.vertices.length - 1) {
      if (a.bulge) {
        const c = bulgeArc(a, b, a.bulge);
        d += ` A${c.r} ${c.r} 0 ${Math.abs(c.sweep) > Math.PI ? 1 : 0} ${c.sweep > 0 ? 1 : 0} ${b.x} ${b.y}`;
      } else d += ` L${b.x} ${b.y}`;
    }
  });
  if (e.closed) d += " Z";
  return `<path ${attrs} d="${d}"/>`;
}
export function partSVG(p) {
  return `<g transform="translate(${-p.origin.x} ${-p.origin.y})">${p.entities.map(entitySVG).join("")}</g>`;
}
export function sampleParts() {
  const all = [];
  const add = (name, vertices, details = []) => {
    const e = {
      kind: "poly",
      vertices: vertices.map(([x, y]) => ({ x, y })),
      closed: true,
      layer: "CUT",
      color: "#223f72",
    };
    const pts = entityPoints(e),
      b = bounds(pts);
    all.push({
      id: `part-${all.length + 1}`,
      name,
      outer: pts.map((p) => ({ x: p.x - b.x, y: p.y - b.y })),
      origin: { x: b.x, y: b.y },
      entities: [e, ...details],
      group: "Sample / 示範",
      size: b,
    });
  };
  for (let i = 0; i < 3; i++)
    add(
      `Wall ${i + 1} / 牆板`,
      [
        [0, 0],
        [92, 0],
        [92, 100],
        [0, 100],
      ],
      [
        {
          kind: "poly",
          vertices: [
            { x: 32, y: 37 },
            { x: 60, y: 37 },
            { x: 60, y: 90 },
            { x: 32, y: 90 },
          ],
          closed: true,
          layer: "CUT",
          color: "#223f72",
        },
        {
          kind: "poly",
          vertices: [
            { x: 8, y: 15 },
            { x: 84, y: 15 },
          ],
          closed: false,
          layer: "SCORE",
          color: "#c07927",
        },
      ],
    );
  for (let i = 0; i < 4; i++)
    add(`Brace ${i + 1} / 撐架`, [
      [0, 0],
      [66, 0],
      [66, 19],
      [20, 19],
      [20, 72],
      [0, 72],
    ]);
  for (let i = 0; i < 3; i++) {
    const pts = Array.from({ length: 9 }, (_, j) => {
      const a = (j * Math.PI) / 8;
      return [30 + 30 * Math.cos(a), 30 - 30 * Math.sin(a)];
    });
    add(`Arch ${i + 1} / 拱片`, [[0, 55], [0, 30], ...pts.reverse(), [60, 55]]);
  }
  for (let i = 0; i < 2; i++)
    add(
      `Base ${i + 1} / 底板`,
      [
        [0, 0],
        [85, 0],
        [85, 40],
        [0, 40],
      ],
      [
        {
          kind: "circle",
          cx: 20,
          cy: 20,
          r: 5,
          closed: true,
          layer: "CUT",
          color: "#223f72",
        },
      ],
    );
  return all;
}
