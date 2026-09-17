import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { exportDXF } from "../dist/exporters.js";
import { sampleParts } from "../dist/geometry.js";
import { dxfTags } from "../dist/dxf-document.js";
function records(text) {
  const lines = text.trimEnd().split("\n");
  const result = [];
  let current;
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]),
      value = lines[i + 1];
    if (code === 0) {
      current = { type: value, tags: [] };
      result.push(current);
    }
    current.tags.push([code, value]);
  }
  return result;
}
const value = (r, c) => r.tags.find(([code]) => code === c)?.[1];
const parts = sampleParts();
const poses = parts.map((p, i) => ({
  id: p.id,
  x: 5 + (i % 4) * 100,
  y: 5 + Math.floor(i / 4) * 90,
  angle: 0,
  sheet: 0,
}));
const settings = { width: 420, height: 297, margin: 5, gap: 2 };
test("DXF contains valid model-space ownership and unique handles without parser repair", () => {
  const text = exportDXF(parts, poses, 0, settings),
    rs = records(text);
  const handles = rs
    .filter((r) => r.type !== "SECTION")
    .flatMap((r) =>
      r.tags.filter(([c]) => c === 5 || c === 105).map(([, v]) => v),
    );
  assert.equal(new Set(handles).size, handles.length);
  const model = rs.find(
    (r) => r.type === "BLOCK_RECORD" && value(r, 2) === "*Model_Space",
  );
  assert.ok(model);
  const entities = rs.filter((r) =>
    ["LINE", "LWPOLYLINE", "CIRCLE", "ARC"].includes(r.type),
  );
  assert.equal(entities.length, 20);
  for (const e of entities) {
    // Ignore the group reactor 330: the owner is outside its 102 braces.
    let inReactor = false,
      owner;
    for (const [c, v] of e.tags) {
      if (c === 102) inReactor = v !== "}";
      if (c === 330 && !inReactor) owner = v;
    }
    assert.equal(owner, value(model, 5));
  }
  for (const t of rs.filter((r) => r.type === "TABLE")) {
    assert.ok(value(t, 5));
    assert.equal(value(t, 100), "AcDbSymbolTable");
  }
  for (const layer of rs.filter((r) => r.type === "LAYER")) {
    assert.ok(
      handles.includes(value(layer, 390)),
      "Layer plot style must resolve (AutoCAD requires this)",
    );
    assert.ok(
      handles.includes(value(layer, 347)),
      "Layer material must resolve",
    );
  }
  const handseed = Number.parseInt(
    text.match(/\$HANDSEED\n5\n([^\n]+)/)[1],
    16,
  );
  assert.ok(handles.every((h) => Number.parseInt(h, 16) < handseed));
  const groups = rs.filter((r) => r.type === "GROUP");
  assert.equal(groups.length, 12);
  for (const g of groups)
    for (const [code, h] of g.tags)
      if (code === 340) assert.ok(handles.includes(h));
  fs.mkdirSync("work/dxf-fixtures", { recursive: true });
  fs.writeFileSync("work/dxf-fixtures/sample.dxf", text);
});
test("DXF view and limits track sheet size and force model space", () => {
  const text = exportDXF(parts, poses, 0, {
    ...settings,
    width: 900,
    height: 600,
  });
  assert.match(text, /\$TILEMODE\n70\n1/);
  const viewport = records(text).find((r) => r.type === "VPORT");
  assert.equal(Number(value(viewport, 12)), 450);
  assert.equal(Number(value(viewport, 22)), 300);
  assert.equal(Number(value(viewport, 40)), 660);
});
test("R2004 text uses ASCII Unicode escapes and cannot inject tag lines", () => {
  assert.equal(dxfTags(8, "切割"), "8\n\\U+5207\\U+5272\n");
  assert.equal(dxfTags(8, "CUT\n0\rEOF"), "8\nCUT 0 EOF\n");
  assert.throws(() => dxfTags(10, NaN), /non-finite/);
  const p = structuredClone(parts[0]);
  p.entities.forEach((e) => (e.layer = "切割"));
  const text = exportDXF([p], [poses[0]], 0, settings);
  assert.match(text, /\\U\+5207\\U\+5272/);
  assert.ok(!/[^\x00-\x7f]/.test(text));
  fs.mkdirSync("work/dxf-fixtures", { recursive: true });
  fs.writeFileSync("work/dxf-fixtures/unicode.dxf", text);
});
test("offcut and merged-line exports also assign every entity to model space", () => {
  for (const cleanup of [false, true]) {
    const text = exportDXF([parts[0]], [poses[0]], 0, settings, {
      mergeCommonLines: cleanup,
      offcuts: [{ x: 250, y: 10, w: 100, h: 200 }],
    });
    const rs = records(text),
      model = rs.find(
        (r) => r.type === "BLOCK_RECORD" && value(r, 2) === "*Model_Space",
      );
    const offcuts = rs.filter((r) => value(r, 8) === "OFFCUT_CUT");
    assert.equal(offcuts.length, cleanup ? 4 : 1);
    for (const e of offcuts) assert.equal(value(e, 330), value(model, 5));
    fs.mkdirSync("work/dxf-fixtures", { recursive: true });
    fs.writeFileSync(`work/dxf-fixtures/offcuts-${cleanup}.dxf`, text);
  }
});
