import { svgStraightSegments } from "./common-edge.js?v=0.27.0";
import {
  bounds,
  area,
  near,
  entityPoints,
  containsPolygon,
  simplePolygon,
  sampleArc,
  TOL,
} from "./geometry.js?v=0.27.0";
import aciColours from "./vendor/aci-colours.js";
const fail = (s) => {
  throw new Error(s);
};
const n = (r, c, d = 0) => {
  const v = r.tags.find((t) => t[0] === c);
  const x = v ? Number(v[1]) : d;
  if (!Number.isFinite(x)) fail("Invalid DXF number / DXF 數值無效");
  return x;
};
const str = (r, c, d = "") => r.tags.find((t) => t[0] === c)?.[1] ?? d;
const colorData = (r) => ({
  aci: n(r, 62, 256),
  trueColor: r.tags.some((t) => t[0] === 420) ? n(r, 420) : null,
});
const colorHex = (c) =>
  c.trueColor !== null
    ? `#${c.trueColor.toString(16).padStart(6, "0")}`
    : c.aci === 7
      ? "#000000"
      : `#${(aciColours[c.aci] ?? 0).toString(16).padStart(6, "0")}`;
function hull(points) {
  const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = [];
  for (const q of p) {
    while (half.length > 1 && cross(half.at(-2), half.at(-1), q) <= 0)
      half.pop();
    half.push(q);
  }
  const lower = half.length;
  for (let i = p.length - 2; i >= 0; i--) {
    const q = p[i];
    while (half.length > lower && cross(half.at(-2), half.at(-1), q) <= 0)
      half.pop();
    half.push(q);
  }
  half.pop();
  return half;
}
function clean(points) {
  return points.filter((p, i) => !i || !near(p, points[i - 1]));
}
export function identifyParts(entities) {
  if (!entities.length) fail("No supported drawing geometry / 搵唔到可用圖形");
  if (entities.length > 3000)
    fail("Prototype limit: 3,000 entities / 試作版上限：3,000 個圖元");
  const seen = new Set();
  for (const e of entities) {
    e.points = clean(entityPoints(e));
    if (e.closed && e.points.length && near(e.points[0], e.points.at(-1)))
      e.points.pop();
    if (
      e.points.length < 2 ||
      e.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
    )
      fail("Invalid or zero-length geometry / 圖形座標無效或長度為零");
    if (e.points.length > 2500)
      fail("Outline too complex; simplify it first / 輪廓過於複雜，請先簡化");
    const signature = e.points
      .map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`)
      .sort()
      .join(";");
    if (seen.has(signature))
      fail(
        "Duplicate geometry at the same position. Remove duplicate cut paths first. / 同一位置有重複圖形，請先移除重複切割線。",
      );
    seen.add(signature);
  }
  const candidates = entities
    .filter((e) => e.closed)
    .map((e) => ({ points: e.points, members: [e] }));
  const open = entities.filter((e) => !e.closed);
  const used = new Set();
  // Join only genuinely coincident endpoints. Do not close small gaps silently.
  for (const e of open) {
    if (used.has(e)) continue;
    const chain = [e],
      pts = e.points.slice();
    let current = pts.at(-1);
    let closed = false;
    for (let k = 0; k < open.length; k++) {
      const matches = open.filter(
        (o) =>
          o !== e &&
          !used.has(o) &&
          !chain.includes(o) &&
          (near(o.points[0], current) || near(o.points.at(-1), current)),
      );
      if (near(current, pts[0])) {
        closed = true;
        break;
      }
      if (matches.length !== 1) break;
      const next = matches[0],
        np = near(next.points[0], current)
          ? next.points
          : next.points.slice().reverse();
      pts.push(...np.slice(1));
      chain.push(next);
      current = pts.at(-1);
    }
    if (closed) {
      pts.pop();
      chain.forEach((o) => used.add(o));
      candidates.push({ points: clean(pts), members: chain });
    }
  }
  for (const c of candidates) {
    if (!simplePolygon(c.points))
      fail(
        "Open, zero-area or self-intersecting outline / 輪廓未閉合、面積為零或自交",
      );
  }
  if (!candidates.length)
    fail(
      "No closed outer boundary found. Join endpoints or use closed polylines. / 找不到封閉外輪廓，請連接端點或使用封閉 polyline。",
    );
  // Native explicit groups take precedence over inferred containment.
  const explicit = new Map();
  for (const e of entities)
    if (e.group) {
      if (!explicit.has(e.group)) explicit.set(e.group, []);
      explicit.get(e.group).push(e);
    }
  const assigned = new Set(),
    raw = [];
  for (const [group, members] of explicit) {
    const cs = candidates.filter((c) =>
      c.members.every((e) => members.includes(e)),
    );
    if (!cs.length)
      fail(`Group has no closed outline: ${group} / 群組缺少封閉外輪廓`);
    const all = members.flatMap((e) => e.points);
    let outer = cs.find((c) => containsPolygon(c.points, all))?.points;
    const conservative = !outer;
    if (!outer) outer = hull(all);
    raw.push({
      entities: members,
      outer,
      group: conservative
        ? "Explicit group · conservative envelope / 群組保守邊界"
        : "Explicit group / 指定群組",
    });
    members.forEach((e) => assigned.add(e));
  }
  const free = candidates.filter((c) =>
    c.members.every((e) => !assigned.has(e)),
  );
  // Outermost loops own contained holes and details. The user confirms this inference.
  const roots = free.filter(
    (c) =>
      !free.some(
        (o) =>
          o !== c &&
          Math.abs(area(o.points)) > Math.abs(area(c.points)) + 1e-5 &&
          containsPolygon(o.points, c.points),
      ),
  );
  for (const c of roots) {
    const members = entities.filter(
      (e) => !assigned.has(e) && containsPolygon(c.points, e.points),
    );
    if (!members.length) continue;
    raw.push({
      entities: members,
      outer: c.points,
      group: "Inferred by containment / 按內外輪廓推斷",
    });
    members.forEach((e) => assigned.add(e));
  }
  const orphan = entities.filter((e) => !assigned.has(e));
  if (orphan.length)
    fail(
      `${orphan.length} entities have no part boundary. Group each detail with a closed outline. / ${orphan.length} 個圖元未能歸入零件，請與封閉外輪廓 group。`,
    );
  const parts = raw.map((p, i) => {
    const b = bounds(p.outer);
    return {
      id: `part-${i + 1}`,
      name: `Part ${String(i + 1).padStart(2, "0")} / 零件`,
      origin: { x: b.x, y: b.y },
      size: b,
      outer: p.outer.map((q) => ({ x: q.x - b.x, y: q.y - b.y })),
      entities: p.entities,
      group: p.group,
    };
  });
  if (parts.length > 80)
    fail("Prototype limit: 80 parts per drawing / 試作版每檔最多 80 件零件");
  return parts;
}
export function parseDXF(text, unitOverride = "auto") {
  if (text.startsWith("AutoCAD Binary"))
    fail(
      "Binary DXF is not supported. Save an ASCII DXF. / 請另存 ASCII DXF。",
    );
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.length && lines.at(-1).trim() === "") lines.pop();
  if (lines.length % 2) fail("Incomplete DXF / DXF 檔案不完整");
  const tags = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code))
      fail("Invalid DXF group code / DXF group code 無效");
    tags.push([code, lines[i + 1].trim()]);
  }
  let section = "",
    record = null;
  const records = [],
    header = [];
  for (let i = 0; i < tags.length; i++) {
    const [c, v] = tags[i];
    if (c === 0 && v === "SECTION") {
      section = tags[++i]?.[1];
      record = null;
      continue;
    }
    if (c === 0 && v === "ENDSEC") {
      section = "";
      record = null;
      continue;
    }
    if (section === "HEADER") header.push(tags[i]);
    if (c === 0) {
      record = { type: v, section, tags: [] };
      records.push(record);
    } else if (record) record.tags.push(tags[i]);
  }
  if (!records.some((r) => r.type === "EOF"))
    fail("DXF is missing EOF / DXF 缺少 EOF");
  const ui = header.findIndex((t) => t[0] === 9 && t[1] === "$INSUNITS");
  const unit = ui >= 0 ? Number(header[ui + 1]?.[1]) : 0;
  const scales = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
  const scale = unitOverride === "auto" ? scales[unit] : Number(unitOverride);
  if (!scale)
    fail(
      "Drawing units are missing or unsupported. Choose DXF drawing units, then import again. / 圖面單位不明，請先選擇 DXF 單位再匯入。",
    );
  const layerColors = new Map(
    records
      .filter((r) => r.section === "TABLES" && r.type === "LAYER")
      .map((r) => [str(r, 2), { ...colorData(r), flags: n(r, 70) }]),
  );
  const groupMap = new Map();
  for (const r of records.filter(
    (r) => r.section === "OBJECTS" && r.type === "GROUP",
  ))
    for (const t of r.tags.filter((t) => t[0] === 340)) {
      if (groupMap.has(t[1]))
        fail("Overlapping AutoCAD GROUP membership / AutoCAD GROUP 成員重疊");
      groupMap.set(t[1], `group-${str(r, 5)}`);
    }
  const blocks = new Map();
  let block = null;
  for (const r of records.filter((r) => r.section === "BLOCKS")) {
    if (r.type === "BLOCK") {
      block = { base: { x: n(r, 10), y: n(r, 20) }, items: [] };
      blocks.set(str(r, 2), block);
    } else if (r.type === "ENDBLK") block = null;
    else if (block) block.items.push(r);
  }
  const out = [],
    unsupported = new Set();
  let insertId = 0;
  function emit(
    r,
    m = { a: 1, b: 0, c: 0, d: 1, x: 0, y: 0 },
    group = null,
    inheritedLayer = "0",
    depth = 0,
    inheritedColor = { aci: 7, trueColor: null },
  ) {
    if (depth > 12)
      fail("Nested blocks exceed supported depth / 巢狀 block 層級過深");
    if (n(r, 67) !== 0)
      fail(
        "Paper-space geometry found. Export model-space geometry only. / 請只匯出 Model Space 圖形。",
      );
    if (
      Math.abs(n(r, 30)) > 1e-7 ||
      Math.abs(n(r, 38)) > 1e-7 ||
      Math.abs(n(r, 210)) > 1e-7 ||
      Math.abs(n(r, 220)) > 1e-7 ||
      Math.abs(n(r, 230, 1) - 1) > 1e-7
    )
      fail("Only flat XY-plane geometry is supported / 只支援 XY 平面二維圖形");
    const layer = str(r, 8, "0") === "0" ? inheritedLayer : str(r, 8);
    group = group || groupMap.get(str(r, 5));
    const p = (x, y) => ({
      x: (m.a * x + m.c * y + m.x) * scale,
      y: -(m.b * x + m.d * y + m.y) * scale,
    });
    const factor = Math.hypot(m.a, m.b) * scale;
    const layerColor = layerColors.get(layer) || {
      aci: 7,
      trueColor: null,
      flags: 0,
    };
    const sourceColor = colorData(r);
    const resolvedColor =
      sourceColor.trueColor !== null
        ? sourceColor
        : sourceColor.aci === 0
          ? inheritedColor
          : sourceColor.aci === 256
            ? layerColor
            : sourceColor;
    if (n(r, 60) || n(r, 39) || layerColor.aci < 0 || layerColor.flags & 1)
      fail(
        "Hidden, frozen or thickness geometry is unsupported. Export a visible flat drawing. / 暫不支援隱藏、凍結或有厚度嘅圖形，請匯出可見平面圖形。",
      );
    const base = {
      layer,
      color: colorHex(resolvedColor),
      dxfColor: sourceColor.aci === 0 ? resolvedColor : sourceColor,
      layerColor,
      group,
    };
    if (r.type === "INSERT") {
      const name = str(r, 2),
        bl = blocks.get(name);
      if (!bl) fail(`Unresolved block: ${name} / 找不到 block`);
      const sx = n(r, 41, 1),
        sy = n(r, 42, 1);
      if (
        sx <= 0 ||
        Math.abs(sx - sy) > 1e-8 ||
        n(r, 70, 1) > 1 ||
        n(r, 71, 1) > 1
      )
        fail(
          "Only single, uniformly scaled, unmirrored blocks are supported / 暫只支援單一、等比及非鏡像 block",
        );
      const angle = (n(r, 50) * Math.PI) / 180,
        c = Math.cos(angle) * sx,
        s = Math.sin(angle) * sx;
      const a = m.a * c + m.c * s,
        b = m.b * c + m.d * s,
        cc = -m.a * s + m.c * c,
        d = -m.b * s + m.d * c;
      const tx = n(r, 10) - c * bl.base.x + s * bl.base.y,
        ty = n(r, 20) - s * bl.base.x - c * bl.base.y;
      const next = {
        a,
        b,
        c: cc,
        d,
        x: m.a * tx + m.c * ty + m.x,
        y: m.b * tx + m.d * ty + m.y,
      };
      const g = group || `insert-${++insertId}`;
      bl.items.forEach((e) =>
        emit(e, next, g, layer, depth + 1, resolvedColor),
      );
      return;
    }
    if (r.type === "LINE") {
      if (Math.abs(n(r, 31)) > 1e-7) fail("Non-planar LINE / 非平面 LINE");
      out.push({
        ...base,
        kind: "poly",
        vertices: [p(n(r, 10), n(r, 20)), p(n(r, 11), n(r, 21))],
        closed: false,
      });
    } else if (r.type === "LWPOLYLINE") {
      if (
        n(r, 43) ||
        r.tags.some((t) => (t[0] === 40 || t[0] === 41) && Number(t[1]) !== 0)
      )
        fail(
          "Polyline width must be zero for cutting / 切割 polyline 闊度必須為零",
        );
      const vs = [];
      let v;
      for (const [c, value] of r.tags) {
        if (c === 10) {
          v = { x: Number(value), y: 0, bulge: 0 };
          vs.push(v);
        } else if (c === 20 && v) v.y = Number(value);
        else if (c === 42 && v) v.bulge = Number(value);
      }
      if (vs.length < 2) fail("Degenerate polyline / 無效 polyline");
      out.push({
        ...base,
        kind: "poly",
        vertices: vs.map((v) => ({ ...p(v.x, v.y), bulge: -v.bulge })),
        closed: !!(n(r, 70) & 1),
      });
    } else if (r.type === "CIRCLE" || r.type === "ARC") {
      const c = p(n(r, 10), n(r, 20)),
        radius = n(r, 40) * factor;
      if (radius <= 0)
        fail("Circle radius must be positive / 圓半徑必須大於零");
      if (r.type === "CIRCLE")
        out.push({
          ...base,
          kind: "circle",
          cx: c.x,
          cy: c.y,
          r: radius,
          closed: true,
        });
      else {
        let sweep = (n(r, 51) - n(r, 50)) % 360;
        if (sweep <= 0) sweep += 360;
        out.push({
          ...base,
          kind: "arc",
          cx: c.x,
          cy: c.y,
          r: radius,
          start: -((n(r, 50) * Math.PI) / 180 + Math.atan2(m.b, m.a)),
          sweep: (-sweep * Math.PI) / 180,
          closed: false,
        });
      }
    } else unsupported.add(r.type);
  }
  records.filter((r) => r.section === "ENTITIES").forEach((r) => emit(r));
  if (unsupported.size)
    fail(
      `Unsupported DXF entities: ${[...unsupported].join(", ")}. No geometry was discarded. Convert text to outlines; use LINE, ARC, CIRCLE or LWPOLYLINE. / 未支援圖元，未有略過任何圖形。文字請轉輪廓，其他圖形請轉受支援線段。`,
    );
  return {
    parts: identifyParts(out),
    format: "dxf",
    unitLabel: `DXF · ${scale === 1 ? "mm" : `${scale} mm / drawing unit`} · ${out.length} entities / 圖元`,
    warnings: [
      "Check inferred groups and physical dimensions before arranging. / 排料前請核對分組及實際尺寸。",
    ],
  };
}
function svgLength(value) {
  const match = String(value || "")
    .trim()
    .match(/^([\d.+-]+)(mm|cm|in|pt|px)?$/);
  if (!match) return null;
  const f = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 };
  return Number(match[1]) * f[match[2] || "px"];
}
export function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (
    doc.querySelector("parsererror") ||
    doc.documentElement.localName !== "svg"
  )
    fail("Invalid SVG / SVG 格式無效");
  const root = doc.documentElement;
  const bad = [...root.querySelectorAll("*")].filter(
    (e) =>
      ![
        "g",
        "path",
        "rect",
        "circle",
        "ellipse",
        "polygon",
        "polyline",
        "line",
        "title",
        "desc",
        "metadata",
      ].includes(e.localName),
  );
  if (bad.length)
    fail(
      `Unsupported SVG content: ${[...new Set(bad.map((e) => e.localName))].join(", ")}. Outline text and expand symbols first. / 請先將文字轉輪廓及展開符號。`,
    );
  for (const e of [root, ...root.querySelectorAll("*")]) {
    if (
      e.hasAttribute("style") ||
      e.hasAttribute("class") ||
      e.hasAttribute("display") ||
      e.hasAttribute("visibility") ||
      e.hasAttribute("opacity") ||
      e.hasAttribute("clip-path") ||
      e.hasAttribute("mask") ||
      e.hasAttribute("filter") ||
      e.hasAttribute("vector-effect")
    )
      fail(
        "SVG styles, visibility effects or clipping require expansion first / SVG style、隱藏效果或 clipping 請先展開",
      );
    for (const a of [...e.attributes])
      if (
        /^on/i.test(a.name) ||
        /href/i.test(a.name) ||
        /url\s*\(/i.test(a.value)
      )
        fail("SVG contains external or active content / SVG 含外部或互動內容");
  }
  const width = svgLength(root.getAttribute("width")),
    height = svgLength(root.getAttribute("height"));
  if (!width || !height)
    fail(
      "SVG needs explicit width and height. Export with millimetres. / SVG 需要明確闊高，請以 mm 匯出。",
    );
  const vb = (
    root.getAttribute("viewBox") ||
    `0 0 ${(width * 96) / 25.4} ${(height * 96) / 25.4}`
  )
    .trim()
    .split(/[ ,]+/)
    .map(Number);
  if (
    vb.length !== 4 ||
    vb.some((v) => !Number.isFinite(v)) ||
    vb[2] <= 0 ||
    vb[3] <= 0
  )
    fail("Invalid SVG viewBox / viewBox 無效");
  const sx = width / vb[2],
    sy = height / vb[3];
  if (Math.abs(sx - sy) > 1e-5)
    fail(
      "SVG viewBox and physical aspect ratios differ / SVG viewBox 與實際比例不符",
    );
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none";
  const svg = document.importNode(root, true);
  svg.setAttribute("width", vb[2]);
  svg.setAttribute("height", vb[3]);
  host.append(svg);
  document.body.append(host);
  const entities = [];
  try {
    let groupIndex = 0;
    const groupIds = new Map();
    for (const g of svg.querySelectorAll("g")) {
      let top = g;
      while (top.parentElement && top.parentElement !== svg)
        top = top.parentElement;
      if (!groupIds.has(top)) groupIds.set(top, `svg-group-${++groupIndex}`);
    }
    const rootMatrix = svg.getCTM().inverse();
    const leaves = [
      ...svg.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line"),
    ];
    for (const el of leaves) {
      let top = el.parentElement;
      while (top && top.parentElement && top.parentElement !== svg)
        top = top.parentElement;
      const group = groupIds.get(top);
      const m = rootMatrix.multiply(el.getCTM());
      const physical = new DOMMatrix([
        sx,
        0,
        0,
        sy,
        -vb[0] * sx,
        -vb[1] * sy,
      ]).multiply(m);
      const data = el.getPathData({ normalize: true });
      let sub = [],
        subs = [];
      for (const seg of data) {
        if (seg.type === "M" && sub.length) {
          subs.push(sub);
          sub = [];
        }
        sub.push(seg);
      }
      if (sub.length) subs.push(sub);
      let inherited = el;
      let stroke = null;
      while (inherited) {
        stroke = stroke || inherited.getAttribute("stroke");
        inherited = inherited.parentElement;
      }
      if (!stroke || stroke === "none") stroke = "#263e65";
      const svgGroup =
        group || (subs.length > 1 ? `compound-${entities.length}` : undefined);
      let exportedOriginal = false;
      for (const segments of subs) {
        const path = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setPathData(segments);
        svg.append(path);
        const length = path.getTotalLength();
        if (length > 100000 || !Number.isFinite(length))
          fail("SVG path exceeds prototype limits / SVG 路徑超過試作版限制");
        const points = [];
        const at = (t) => {
          const p = path.getPointAtLength(t);
          const q = new DOMPoint(p.x, p.y).matrixTransform(physical);
          return { x: q.x, y: q.y };
        };
        function sample(a, b, pa, pb, depth = 0) {
          const mid = (a + b) / 2,
            pm = at(mid);
          const dx = pb.x - pa.x,
            dy = pb.y - pa.y;
          const dist = (p) => {
            const l = dx * dx + dy * dy;
            const t = l
              ? Math.max(
                  0,
                  Math.min(1, ((p.x - pa.x) * dx + (p.y - pa.y) * dy) / l),
                )
              : 0;
            return Math.hypot(p.x - pa.x - t * dx, p.y - pa.y - t * dy);
          };
          if (
            depth < 18 &&
            (dist(pm) > TOL / 2 ||
              dist(at((3 * a + b) / 4)) > TOL / 2 ||
              dist(at((a + 3 * b) / 4)) > TOL / 2 ||
              Math.hypot(dx, dy) > 3)
          ) {
            sample(a, mid, pa, pm, depth + 1);
            sample(mid, b, pm, pb, depth + 1);
          } else points.push(pb);
        }
        points.push(at(0));
        sample(0, length, at(0), at(length));
        const closed =
          segments.at(-1)?.type === "Z" ||
          (points.length > 2 && near(points[0], points.at(-1)));
        const matrix = `matrix(${[physical.a, physical.b, physical.c, physical.d, physical.e, physical.f].join(" ")})`;
        path.remove();
        if (
          !CSS.supports("color", stroke) ||
          /^(currentcolor|inherit|unset|initial|transparent)$/i.test(stroke)
        )
          fail("Unsupported SVG stroke colour / SVG 線條顏色未能確認");
        const safeStroke = stroke;
        // Tessellation belongs only to collision detection. Keep the original SVG element for export.
        const original = el.cloneNode(false);
        original.removeAttribute("id");
        original.setAttribute("transform", matrix);
        original.setAttribute("fill", "none");
        original.setAttribute("stroke", safeStroke);
        original.setAttribute("stroke-width", String(0.15 / sx));
        const retained = exportedOriginal
          ? ""
          : new XMLSerializer().serializeToString(original);
        exportedOriginal = true;
        entities.push({
          kind: "svg",
          straightSegments: svgStraightSegments(segments, physical),
          pathCommands: segments.map((s) => ({
            type: s.type,
            values: [...s.values],
          })),
          pathMatrix: Object.fromEntries(
            ["a", "b", "c", "d", "e", "f"].map((k) => [k, physical[k]]),
          ),
          color: safeStroke,
          pathStrokeWidth: 0.15 / sx,
          points,
          closed,
          group: svgGroup,
          layer: el.getAttribute("data-layer") || "SVG",
          svg: retained,
        });
      }
    }
  } finally {
    host.remove();
  }
  return {
    parts: identifyParts(entities),
    format: "svg",
    unitLabel: `SVG · mm · ${entities.length} paths / 路徑`,
    warnings: [
      "SVG curves export as SVG. DXF export is available for DXF drawings. / SVG 曲線以 SVG 輸出；DXF 圖檔可匯出 DXF。",
    ],
  };
}
