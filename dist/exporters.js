import { partSVG, transform, fmt, esc } from "./geometry.js";
export function exportSVG(parts, placements, sheet, settings) {
  const map = new Map(parts.map((p) => [p.id, p]));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${settings.width}mm" height="${settings.height}mm" viewBox="0 0 ${settings.width} ${settings.height}">\n<title>Paper Nest — Sheet ${sheet + 1} — millimetres</title>\n${placements
    .filter((t) => t.sheet === sheet)
    .map(
      (t) =>
        `<g id="${esc(t.id)}" transform="translate(${fmt(t.x)} ${fmt(t.y)}) rotate(${fmt(t.angle)})">${partSVG(map.get(t.id))}</g>`,
    )
    .join("\n")}\n</svg>`;
}
export function exportDXF(parts, placements, sheet, settings) {
  const map = new Map(parts.map((p) => [p.id, p]));
  const layerSet = new Map([["0", { aci: 7, trueColor: null }]]);
  const entities = [],
    groups = [];
  let handle = 65536;
  const tags = (...values) => values.map(String).join("\n") + "\n";
  for (const t of placements.filter((p) => p.sheet === sheet)) {
    const groupHandle = (1048576 + groups.length).toString(16),
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
                      ? [42, fmt(-e.vertices[i].bulge)]
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
              tags(100, "AcDbCircle", 10, c.x, 20, c.y, 30, 0, 40, fmt(e.r)),
          );
        else {
          const norm = (a) => ((a % 360) + 360) % 360;
          let a = -((e.start * 180) / Math.PI + t.angle),
            b = -(((e.start + e.sweep) * 180) / Math.PI + t.angle);
          if (e.sweep > 0) [a, b] = [b, a];
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
                fmt(e.r),
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
  const layers = [...layerSet]
    .map(([name, color], i) =>
      tags(
        0,
        "LAYER",
        5,
        (4096 + i).toString(16),
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
      ),
    )
    .join("");
  return (
    tags(
      0,
      "SECTION",
      2,
      "HEADER",
      9,
      "$ACADVER",
      1,
      "AC1018",
      9,
      "$INSUNITS",
      70,
      4,
      9,
      "$MEASUREMENT",
      70,
      1,
      9,
      "$LUNITS",
      70,
      2,
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "TABLES",
      0,
      "TABLE",
      2,
      "LTYPE",
      70,
      1,
      0,
      "LTYPE",
      100,
      "AcDbSymbolTableRecord",
      100,
      "AcDbLinetypeTableRecord",
      2,
      "CONTINUOUS",
      70,
      0,
      3,
      "Solid line",
      72,
      65,
      73,
      0,
      40,
      0,
      0,
      "ENDTAB",
      0,
      "TABLE",
      2,
      "LAYER",
      70,
      layerSet.size,
    ) +
    layers +
    tags(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES") +
    entities.join("") +
    tags(
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "OBJECTS",
      0,
      "DICTIONARY",
      5,
      "1",
      330,
      "0",
      100,
      "AcDbDictionary",
      281,
      1,
      3,
      "ACAD_GROUP",
      350,
      "2",
      0,
      "DICTIONARY",
      5,
      "2",
      330,
      "1",
      100,
      "AcDbDictionary",
      281,
      1,
    ) +
    groups.map((g) => tags(3, g.name, 350, g.handle)).join("") +
    groups
      .map(
        (g) =>
          tags(
            0,
            "GROUP",
            5,
            g.handle,
            330,
            "2",
            100,
            "AcDbGroup",
            300,
            "Paper Nest part",
            70,
            0,
            71,
            1,
          ) + g.members.map((h) => tags(340, h)).join(""),
      )
      .join("") +
    tags(0, "ENDSEC", 0, "EOF")
  );
}
