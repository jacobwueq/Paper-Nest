import { dxfTemplate } from "./dxf-template.js?v=0.13.0";

export const DXF_MODEL_SPACE = dxfTemplate.modelSpace;
export const DXF_GROUP_DICTIONARY = dxfTemplate.groupDictionary;
export const DXF_LAYER_TABLE = dxfTemplate.layerTable;
export const DXF_PLOT_STYLE = dxfTemplate.plotStyle;
export const DXF_MATERIAL = dxfTemplate.material;
// R2004 is not UTF-8: represent non-ASCII text with DXF Unicode escapes.
export function dxfTags(...values) {
  return (
    values
      .map((value) => {
        if (typeof value === "number" && !Number.isFinite(value))
          throw new Error(
            "Cannot export non-finite DXF geometry / DXF 座標無效",
          );
        return String(value)
          .replace(/[\r\n\x00]/g, " ")
          .replace(
            /[^\x20-\x7e]/g,
            (c) =>
              "\\U+" +
              c.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0"),
          );
      })
      .join("\n") + "\n"
  );
}
export function dxfDocument({
  entities,
  layers,
  groups,
  width,
  height,
  handseed,
}) {
  const tags = dxfTags;
  function section(name, body) {
    return tags(0, "SECTION", 2, name) + body + tags(0, "ENDSEC");
  }
  function template(name) {
    let type = "",
      recordHandle = "";
    return dxfTemplate.sections[name]
      .map(([code, value]) => {
        if (code === 0) {
          type = value;
          recordHandle = "";
        }
        if (code === 5) recordHandle = value;
        if (type === "PAPER_NEST_LAYERS") return layers;
        // The active model-space view starts centred on this actual sheet.
        if (type === "VPORT") {
          if (code === 12) value = width / 2;
          if (code === 22) value = height / 2;
          if (code === 40) value = height * 1.1;
          if (code === 41) value = width / height;
        }
        const text = tags(code, value);
        if (
          type === "DICTIONARY" &&
          recordHandle === DXF_GROUP_DICTIONARY &&
          code === 281
        )
          return (
            text +
            groups
              .map((g, i) => tags(3, `PART_${i + 1}`, 350, g.handle))
              .join("")
          );
        return text;
      })
      .join("");
  }
  const header = tags(
    9,
    "$ACADVER",
    1,
    "AC1018",
    9,
    "$DWGCODEPAGE",
    3,
    "ANSI_1252",
    9,
    "$HANDSEED",
    5,
    handseed,
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
    9,
    "$TILEMODE",
    70,
    1,
    9,
    "$INSBASE",
    10,
    0,
    20,
    0,
    30,
    0,
    9,
    "$EXTMIN",
    10,
    0,
    20,
    0,
    30,
    0,
    9,
    "$EXTMAX",
    10,
    width,
    20,
    height,
    30,
    0,
    9,
    "$LIMMIN",
    10,
    0,
    20,
    0,
    9,
    "$LIMMAX",
    10,
    width,
    20,
    height,
  );
  const groupObjects = groups
    .map(
      (g) =>
        tags(
          0,
          "GROUP",
          5,
          g.handle,
          330,
          DXF_GROUP_DICTIONARY,
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
    .join("");
  return (
    section("HEADER", header) +
    section("CLASSES", template("CLASSES")) +
    section("TABLES", template("TABLES")) +
    section("BLOCKS", template("BLOCKS")) +
    section("ENTITIES", entities.join("")) +
    section("OBJECTS", template("OBJECTS") + groupObjects) +
    tags(0, "EOF")
  );
}
