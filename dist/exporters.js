import {
  checkedCutSets,
  remainingOffcutFrames,
} from "./separation-sets.js?v=0.26.2";
import { checkedSeparations } from "./separation.js?v=0.26.2";
import {
  dxfDocument,
  dxfTags,
  DXF_MODEL_SPACE,
  DXF_GROUP_DICTIONARY,
  DXF_LAYER_TABLE,
  DXF_PLOT_STYLE,
  DXF_MATERIAL,
} from "./dxf-document.js?v=0.26.2";
import { mergeCommonLines } from "./common-line.js?v=0.26.2";
import { prepareCommonLineExport } from "./common-line-export.js?v=0.26.2";
import { partSVG, transform, fmt, esc } from "./geometry.js?v=0.26.2";
import { checkedOffcuts } from "./offcut-export.js?v=0.26.2";
export function recoveryLines(cuts, separation, options = {}) {
  const merged = mergeCommonLines(
    [
      ...separation.map((s) => ({ ...s, recoveryKind: "quick" })),
      ...offcutLines(cuts, options).map((s) => ({
        ...s,
        recoveryKind: "remnant",
      })),
    ],
    { tolerance: options.lineTolerance ?? 1e-6 },
  );
  return {
    remnant: merged.filter((s) => s.recoveryKind === "remnant"),
    quick: merged.filter((s) => s.recoveryKind === "quick"),
  };
}
function offcutLines(cuts, options) {
  return mergeCommonLines(
    cuts.flatMap((points) =>
      points.map((start, i) => ({
        start,
        role: "generated-split-line",
        end: points[(i + 1) % points.length],
      })),
    ),
    { tolerance: options.lineTolerance ?? 1e-6 },
  );
}
export function exportSVG(parts, placements, sheet, settings, options = {}) {
  const cuts = checkedOffcuts(parts, placements, sheet, settings, {
    ...options,
    offcuts: remainingOffcutFrames(
      options.offcuts || [],
      options.cutSets || [],
    ),
  });
  const separation = mergeCommonLines([
    ...checkedSeparations(
      parts,
      placements,
      sheet,
      settings,
      options.separationCuts || [],
    ),
    ...checkedCutSets(
      parts,
      placements,
      sheet,
      settings,
      options.cutSets || [],
    ),
  ]);
  const recovery = recoveryLines(cuts, separation, options);
  const cleanup =
    (options.mergeCommonLines ?? settings.commonEdgeMode) === true;
  const exportParts = cleanup
    ? prepareCommonLineExport(parts, placements, sheet, {
        tolerance: options.lineTolerance ?? 1e-6,
      })
    : parts;
  const map = new Map(exportParts.map((p) => [p.id, p]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width}mm" height="${settings.height}mm" viewBox="0 0 ${settings.width} ${settings.height}">\n<title>Paper Nest — Sheet ${sheet + 1} — millimetres</title>\n${placements
    .filter((t) => t.sheet === sheet)
    .map(
      (t) =>
        `<g id="${esc(t.id)}" transform="translate(${fmt(t.x)} ${fmt(t.y)}) rotate(${fmt(t.angle)}) scale(${fmt((t.scale ?? 1) * (t.mirrored ? -1 : 1))} ${fmt(t.scale ?? 1)})">${partSVG(map.get(t.id))}</g>`,
    )
    .join("\n")}${
    cuts.length
      ? `\n<g id="OFFCUT_CUT" fill="none" stroke="#008000" stroke-width="0.1">${
          cleanup || separation.length
            ? recovery.remnant
                .map(
                  (s) =>
                    `<path d="M${fmt(s.start.x)} ${fmt(s.start.y)} L${fmt(s.end.x)} ${fmt(s.end.y)}"/>`,
                )
                .join("\n")
            : cuts
                .map(
                  (points, i) =>
                    `<polygon id="offcut-${i + 1}" points="${points.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ")}"/>`,
                )
                .join("\n")
        }</g>`
      : ""
  }${separation.length ? `\n<g id="SEPARATION_CUT" fill="none" stroke="#8b3fd6" stroke-width="0.1">${separation.map((l) => `<path d="M${fmt(l.start.x)} ${fmt(l.start.y)} L${fmt(l.end.x)} ${fmt(l.end.y)}"/>`).join("")}</g>` : ""}\n</svg>`;
}
export function exportDXF(parts, placements, sheet, settings, options = {}) {
  const cuts = checkedOffcuts(parts, placements, sheet, settings, {
    ...options,
    offcuts: remainingOffcutFrames(
      options.offcuts || [],
      options.cutSets || [],
    ),
  });
  const separation = mergeCommonLines([
    ...checkedSeparations(
      parts,
      placements,
      sheet,
      settings,
      options.separationCuts || [],
    ),
    ...checkedCutSets(
      parts,
      placements,
      sheet,
      settings,
      options.cutSets || [],
    ),
  ]);
  const recovery = recoveryLines(cuts, separation, options);
  const cleanup =
    (options.mergeCommonLines ?? settings.commonEdgeMode) === true;
  const exportParts = cleanup
    ? prepareCommonLineExport(parts, placements, sheet, {
        tolerance: options.lineTolerance ?? 1e-6,
      })
    : parts;
  const map = new Map(exportParts.map((p) => [p.id, p]));
  const layerSet = new Map([["0", { aci: 7, trueColor: null }]]);
  const entities = [],
    groups = [];
  let handle = 65536;
  const tags = dxfTags;
  for (const t of placements.filter((p) => p.sheet === sheet)) {
    const groupHandle = (handle++).toString(16),
      members = [];
    const part = map.get(t.id);
    const point = (p) => {
      const q = transform(
        { x: p.x - part.origin.x, y: p.y - part.origin.y },
        t,
      );
      return { x: fmt(q.x), y: fmt(settings.height - q.y) };
    };
    for (const e of part.entities) {
      if (e.kind === "svg")
        throw new Error(
          "SVG drawings must export as SVG / SVG 圖檔請以 SVG 輸出",
        );
      const layer = e.layer || "0";
      layerSet.set(layer, e.layerColor || { aci: 7, trueColor: null });
      const entityHandle = (handle++).toString(16);
      members.push(entityHandle);
      const common = tags(
        5,
        entityHandle,
        102,
        "{ACAD_REACTORS",
        330,
        groupHandle,
        102,
        "}",
        330,
        DXF_MODEL_SPACE,
        100,
        "AcDbEntity",
        8,
        layer,
        ...(e.dxfColor
          ? [
              62,
              e.dxfColor.aci,
              ...(e.dxfColor.trueColor !== null
                ? [420, e.dxfColor.trueColor]
                : []),
            ]
          : [420, parseInt((e.color || "#273b5d").slice(1), 16)]),
      );
      if (e.kind === "poly") {
        const vs = e.vertices.map(point);
        const linear =
          vs.length === 2 && !e.closed && !e.vertices.some((v) => v.bulge);
        if (linear) {
          entities.push(
            tags(0, "LINE") +
              common +
              tags(
                100,
                "AcDbLine",
                10,
                vs[0].x,
                20,
                vs[0].y,
                30,
                0,
                11,
                vs[1].x,
                21,
                vs[1].y,
                31,
                0,
              ),
          );
        } else {
          entities.push(
            tags(0, "LWPOLYLINE") +
              common +
              tags(100, "AcDbPolyline", 90, vs.length, 70, e.closed ? 1 : 0) +
              vs
                .map((v, i) =>
                  tags(
                    10,
                    v.x,
                    20,
                    v.y,
                    ...(e.vertices[i].bulge
                      ? [42, fmt((t.mirrored ? 1 : -1) * e.vertices[i].bulge)]
                      : []),
                  ),
                )
                .join(""),
          );
        }
      } else {
        const c = point({ x: e.cx, y: e.cy });
        if (e.kind === "circle")
          entities.push(
            tags(0, "CIRCLE") +
              common +
              tags(
                100,
                "AcDbCircle",
                10,
                c.x,
                20,
                c.y,
                30,
                0,
                40,
                fmt(e.r * (t.scale ?? 1)),
              ),
          );
        else {
          const norm = (a) => ((a % 360) + 360) % 360;
          const start = t.mirrored ? Math.PI - e.start : e.start;
          const sweep = e.sweep * (t.mirrored ? -1 : 1);
          let a = -((start * 180) / Math.PI + t.angle),
            b = -(((start + sweep) * 180) / Math.PI + t.angle);
          if (sweep > 0) [a, b] = [b, a];
          entities.push(
            tags(0, "ARC") +
              common +
              tags(
                100,
                "AcDbCircle",
                10,
                c.x,
                20,
                c.y,
                30,
                0,
                40,
                fmt(e.r * (t.scale ?? 1)),
                100,
                "AcDbArc",
                50,
                fmt(norm(a)),
                51,
                fmt(norm(b)),
              ),
          );
        }
      }
    }
    groups.push({ handle: groupHandle, name: t.id, members });
  }
  if (cuts.length) {
    let layer = "OFFCUT_CUT",
      suffix = 2;
    while (layerSet.has(layer)) layer = `OFFCUT_CUT_${suffix++}`;
    layerSet.set(layer, { aci: 3, trueColor: null });
    if (cleanup || separation.length) {
      for (const s of recovery.remnant)
        entities.push(
          tags(
            0,
            "LINE",
            5,
            (handle++).toString(16),
            330,
            DXF_MODEL_SPACE,
            100,
            "AcDbEntity",
            8,
            layer,
            62,
            256,
            100,
            "AcDbLine",
            10,
            fmt(s.start.x),
            20,
            fmt(settings.height - s.start.y),
            30,
            0,
            11,
            fmt(s.end.x),
            21,
            fmt(settings.height - s.end.y),
            31,
            0,
          ),
        );
    }
    for (const points of cleanup || separation.length ? [] : cuts) {
      entities.push(
        tags(
          0,
          "LWPOLYLINE",
          5,
          (handle++).toString(16),
          330,
          DXF_MODEL_SPACE,
          100,
          "AcDbEntity",
          8,
          layer,
          62,
          256,
          100,
          "AcDbPolyline",
          90,
          4,
          70,
          1,
        ) +
          points
            .map((p) => tags(10, fmt(p.x), 20, fmt(settings.height - p.y)))
            .join(""),
      );
    }
  }
  if (separation.length) {
    let layer = "SEPARATION_CUT",
      suffix = 2;
    while (layerSet.has(layer)) layer = `SEPARATION_CUT_${suffix++}`;
    layerSet.set(layer, { aci: 6, trueColor: 0x8b3fd6 });
    for (const l of separation)
      entities.push(
        tags(
          0,
          "LINE",
          5,
          (handle++).toString(16),
          330,
          DXF_MODEL_SPACE,
          100,
          "AcDbEntity",
          8,
          layer,
          62,
          256,
          100,
          "AcDbLine",
          10,
          fmt(l.start.x),
          20,
          fmt(settings.height - l.start.y),
          30,
          0,
          11,
          fmt(l.end.x),
          21,
          fmt(settings.height - l.end.y),
          31,
          0,
        ),
      );
  }
  const layers = [...layerSet]
    .map(([name, color], i) =>
      tags(
        0,
        "LAYER",
        5,
        (handle++).toString(16),
        330,
        DXF_LAYER_TABLE,
        100,
        "AcDbSymbolTableRecord",
        100,
        "AcDbLayerTableRecord",
        2,
        name,
        70,
        0,
        62,
        color.aci,
        ...(color.trueColor !== null ? [420, color.trueColor] : []),
        6,
        "CONTINUOUS",
        370,
        -3,
        390,
        DXF_PLOT_STYLE,
        347,
        DXF_MATERIAL,
      ),
    )
    .join("");
  return dxfDocument({
    entities,
    groups,
    width: settings.width,
    height: settings.height,
    handseed: handle.toString(16),
    layers:
      tags(
        0,
        "TABLE",
        2,
        "LAYER",
        5,
        DXF_LAYER_TABLE,
        330,
        "0",
        100,
        "AcDbSymbolTable",
        70,
        layerSet.size,
      ) +
      layers +
      tags(0, "ENDTAB"),
  });
}
