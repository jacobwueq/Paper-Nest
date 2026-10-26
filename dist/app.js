import { saveFile } from './file-download.js?v=0.24.0';
import { installCutStrategy } from "./cut-strategy-ui.js?v=0.15.0";
let cutStrategyUI = null;
import { installWorkspace } from "./workspace-ui.js?v=0.14.2";
let workspaceUI = null;
import { SHEET_PRESETS } from "./sheet-presets.js?v=0.13.0";
import {
  remnantPlan,
  visibleRemnantRectangles,
} from "./remnant-policy.js?v=0.13.0";
import { extractPartEdges } from "./common-edge.js?v=0.13.0";
import {
  sampleParts,
  partSVG,
  pathPoints,
  esc,
  validateLayout,
} from "./geometry.js?v=0.13.0";
import { parseDXF, parseSVG } from "./importers.js?v=0.13.0";
import { exportSVG, exportDXF } from "./exporters.js?v=0.15.0";
import {
  ROTATIONS,
  searchSettings,
  evaluateLayout,
  improves,
  searchSeed,
} from "./search.js?v=0.13.0";
const $ = (id) => document.getElementById(id);
const state = {
  parts: sampleParts(),
  selected: "part-1",
  view: "review",
  placements: [],
  sheet: 0,
  format: "dxf",
  name: "Sample · Scenic paper kit",
  meta: "示範圖檔 · 12 paper scenery parts / 紙材模型零件",
  running: false,
  run: 0,
  invalid: false,
  metrics: null,
  firstResultSeconds: null,
  accepted: 0,
  preservedRemnants: [],
  diagnostics: [],
  excludedOffcuts: new Set(),
};
let engine = null,
  compactor = null,
  compacting = false,
  compactQueued = false,
  stopTimer = null,
  ticker = null,
  started = 0,
  runSettings = null,
  budgetSeconds = 20,
  lastFile = null;
const readSettings = () => ({
  width: Number($("width").value),
  kerf: Number($("separation-kerf")?.value ?? 0.15),
  height: Number($("height").value),
  gap: Number($("gap").value),
  minOffcutSide: Number($("min-offcut-side").value),
  offcutShapeWeight: Number($("offcut-shape-weight").value),
  margin: Number($("margin").value),
  rotations: Number($("rotation").value),
  scale: Number($("scale").value) / 100,
  allowMirror: $("allow-mirror").checked,
  commonEdgeMode: $("common-edge").checked,
  pairClusters: $("common-edge").checked && $("pair-clusters").checked,
  commonEdgeWeight: Number($("common-edge-weight").value),
  multiPartClusteringEnabled:
    $("common-edge").checked && $("multi-part-clusters").checked,
  maxClusterParts: Number($("max-cluster-parts").value),
  clusterBeamWidth: Number($("cluster-beam-width").value),
  diagonalCommonEdgesEnabled: $("diagonal-common-edges").checked,
  preserveRemnantSplitLines: $("preserve-remnant-splits").checked,
  preservedRemnants: $("preserve-remnant-splits").checked
    ? state.preservedRemnants
    : [],
  debugCommonEdges: $("debug-common-edges").checked,
  lockedPlacements: workspaceUI?.locked() || [],
});
function checkSettings(s) {
  if (
    ![
      s.width,
      s.height,
      s.gap,
      s.margin,
      s.rotations,
      s.scale,
      s.minOffcutSide,
      s.offcutShapeWeight,
      s.commonEdgeWeight,
    ].every(Number.isFinite) ||
    !Number.isInteger(s.maxClusterParts) ||
    s.maxClusterParts < 2 ||
    s.maxClusterParts > 4 ||
    !Number.isInteger(s.clusterBeamWidth) ||
    s.clusterBeamWidth < 2 ||
    s.clusterBeamWidth > 32 ||
    s.commonEdgeWeight < 0 ||
    s.commonEdgeWeight > 100 ||
    s.offcutShapeWeight < 0 ||
    s.offcutShapeWeight > 0.5 ||
    s.minOffcutSide < 0 ||
    s.minOffcutSide > 3000 ||
    s.scale < 0.01 ||
    s.scale > 10 ||
    s.width < 10 ||
    s.height < 10 ||
    s.width > 3000 ||
    s.height > 3000 ||
    s.gap < 0.1 ||
    s.gap > 50 ||
    s.margin < 0 ||
    s.margin * 2 + 2 * s.gap >= Math.min(s.width, s.height) ||
    !ROTATIONS.includes(s.rotations)
  )
    throw new Error(
      "Check sheet dimensions, gap and margins. / 請檢查板材尺寸、間距及留邊。",
    );
  return s;
}
function message(text = "", error = false) {
  $("message").hidden = !text;
  $("message").textContent = text;
  $("message").classList.toggle("error", error);
}
function setStatus(text) {
  $("status").textContent = text;
}
function sheetCount() {
  return state.placements.length
    ? Math.max(...state.placements.map((p) => p.sheet)) + 1
    : 0;
}
const offcutId = (sheet, r) =>
  [sheet, r.x, r.y, r.w, r.h].map((n) => Number(n).toFixed(5)).join(":");
function sheetOffcuts(sheet) {
  const current =
    state.metrics?.sheets.find((r) => r.sheet === sheet)?.rectangles || [];
  const plans = $("preserve-remnant-splits").checked
    ? state.preservedRemnants
    : [];
  return visibleRemnantRectangles(
    current,
    plans,
    sheet,
    Number($("gap").value),
  ).map((r, i) => ({ ...r, id: offcutId(sheet, r), number: i + 1 }));
}
function exportOptions(sheet, include = $("include-offcuts").checked) {
  const strategy = cutStrategyUI?.options(sheet);
  return {
    mergeCommonLines: $("merge-common-lines").checked,
    offcuts: include
      ? sheetOffcuts(sheet).filter((r) => !state.excludedOffcuts.has(r.id))
      : [],
    ...strategy,
  };
}
function render() {
  const parts = state.parts,
    s = readSettings();
  $("drawing-name").textContent = state.name;
  $("drawing-meta").textContent = state.meta;
  let draws = [],
    w,
    h;
  const layout = state.view === "layout" && state.placements.length;
  if (layout) {
    w = s.width;
    h = s.height;
    const map = new Map(parts.map((p) => [p.id, p]));
    draws = state.placements
      .filter((t) => t.sheet === state.sheet)
      .map((t) => ({ p: map.get(t.id), t }));
  } else {
    const cols = Math.min(3, parts.length || 1),
      cellW = Math.max(1, ...parts.map((p) => p.size.w)) + 22,
      cellH = Math.max(1, ...parts.map((p) => p.size.h)) + 26;
    w = cols * cellW - 15;
    h = Math.ceil(parts.length / cols) * cellH - 12;
    draws = parts.map((p, i) => ({
      p,
      t: { x: (i % cols) * cellW, y: Math.floor(i / cols) * cellH, angle: 0 },
    }));
  }
  const cutting = state.metrics?.cutting;
  $("cut-summary").hidden = !layout || !cutting;
  $("cut-summary").textContent = cutting
    ? `Shared / 共邊 ${cutting.sharedLength.toFixed(1)} mm · Estimated cutting / 預計切線 ${cutting.estimatedCutLength.toFixed(1)} mm · Cluster moves / 組合移動 ${state.clusterMoves || 0}`
    : "";
  const remaining = layout ? sheetOffcuts(state.sheet) : [];
  $("offcut-summary").hidden = !layout;
  $("offcut-list").hidden = !layout || !remaining.length;
  const displayMm = (n) => Math.floor(n * 10) / 10;
  $("offcut-size").textContent = remaining.length
    ? `${remaining.length} pieces / 塊 · ${Math.floor(remaining.reduce((sum, r) => sum + r.area, 0) / 100)} cm²`
    : "No offcut meets the minimum side / 未有符合最短邊尺寸嘅餘料";
  $("offcut-list").innerHTML = remaining
    .map(
      (r) =>
        `<label class="offcut-choice"><input type="checkbox" data-offcut="${r.id}" ${$("include-offcuts").checked && !state.excludedOffcuts.has(r.id) ? "checked" : ""}/><span><strong>${r.number.toString().padStart(2, "0")} · ${displayMm(r.w)} × ${displayMm(r.h)} mm</strong><small>${Math.floor(r.area / 100)} cm² · ${(Math.max(r.w, r.h) / Math.min(r.w, r.h)).toFixed(1)}:1 · ${((r.area / (s.width * s.height)) * 100).toFixed(1)}% of sheet / 原板</small></span></label>`,
    )
    .join("");
  const pad = Math.max(w, h) * 0.035;
  $("canvas").setAttribute(
    "viewBox",
    `${-pad} ${-pad} ${w + 2 * pad} ${h + 2 * pad}`,
  );
  $("canvas").innerHTML =
    (layout
      ? `<rect class="sheet-outline" x="0" y="0" width="${w}" height="${h}"/><rect class="sheet-margin" x="${s.margin}" y="${s.margin}" width="${w - 2 * s.margin}" height="${h - 2 * s.margin}"/>`
      : "") +
    remaining
      .map(
        (r) =>
          `<rect data-offcut-preview="${r.id}" class="offcut-preview ${state.excludedOffcuts.has(r.id) ? "offcut-excluded" : ""}" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}"><title>Offcut ${r.number} / 餘料 ${r.number}</title></rect><text class="offcut-number" x="${r.x + r.w / 2}" y="${r.y + r.h / 2}">${r.number.toString().padStart(2, "0")}</text>`,
      )
      .join("") +
    draws
      .map(
        ({ p, t }) =>
          `<g class="drawing-part ${state.selected === p.id ? "selected" : ""}" data-part="${p.id}" transform="translate(${t.x} ${t.y}) rotate(${t.angle}) scale(${(t.scale ?? 1) * (t.mirrored ? -1 : 1)} ${t.scale ?? 1})"><polygon class="part-hit" points="${pathPoints(p.outer)}"/><g class="part-detail">${partSVG(p)}</g>${!layout ? `<text class="part-label" x="0" y="${p.size.h + 11}">${esc(p.name)}</text>` : ""}</g>`,
      )
      .join("");
  $("canvas-label").textContent = layout
    ? `SHEET ${state.sheet + 1} / 板材 · ${w} × ${h} mm`
    : "PART REVIEW / 零件檢查 · 已分開顯示";
  $("canvas-caption").textContent = layout
    ? `${s.scale * 100}% scale / 比例 · ${$("include-offcuts").checked ? "Selected offcut cut lines included / 包括已選餘料切割線" : "Parts only / 只輸出零件"}`
    : "Select a part to check its details · 點選零件，核對內部線條";
  $("parts-list").innerHTML = parts
    .map(
      (p) =>
        `<button class="part-row ${state.selected === p.id ? "active" : ""}" data-part="${p.id}"><svg viewBox="-3 -3 ${p.size.w + 6} ${p.size.h + 6}"><polygon points="${pathPoints(p.outer)}" fill="#eef3fe" stroke="#859bc2" stroke-width="2"/></svg><span><strong>${esc(p.name)}</strong><small>${(p.size.w * s.scale).toFixed(1)} × ${(p.size.h * s.scale).toFixed(1)} mm</small></span></button>`,
    )
    .join("");
  const p = parts.find((p) => p.id === state.selected),
    t = state.placements.find((t) => t.id === state.selected);
  const layers = p
    ? [...new Set(p.entities.map((e) => e.layer || "0"))].map(esc).join(", ")
    : "";
  $("inspector").innerHTML = p
    ? `<strong>${esc(p.name)}</strong>${p.entities.length} entities / 圖元<br>Layers: ${layers}<br>${esc(p.group)}${t ? `<br>Sheet ${t.sheet + 1} · ${Math.round(t.angle)}° / 第 ${t.sheet + 1} 張${t.mirrored ? " · Mirrored / 鏡像" : ""}` : ""}`
    : "";
  $("count").textContent = parts.length;
  $("part-total").textContent = parts.length;
  $("sheets").textContent = sheetCount() || "—";
  $("unplaced").textContent = state.placements.length
    ? parts.length - state.placements.length
    : "—";
  let validSettings = true;
  try {
    checkSettings(s);
  } catch {
    validSettings = false;
  }
  $("nest").disabled =
    !$("confirmed").checked || state.running || state.invalid || !validSettings;
  $("nest").hidden = state.running;
  $("stop").hidden = !state.running;
  $("continue").hidden = state.running || !state.placements.length;
  $("continue").disabled =
    state.invalid || !validSettings || !$("confirmed").checked;
  $("nest").className = state.placements.length ? "secondary" : "primary";
  $("nest").innerHTML = state.placements.length
    ? "Start again <span>重新排料 ↗</span>"
    : "Arrange parts <span>自動排料 ↗</span>";
  $("run-note").textContent =
    "Shows a layout immediately, then moves and turns parts to close gaps and consolidate free space. Stop whenever ready. / 有排位即顯示，再移近及轉動零件，收緊空隙、集中餘料；可隨時停止。";
  $("file").disabled = state.running;
  $("demo").disabled = state.running;
  $("confirmed").disabled = state.running;
  for (const id of [
    "width",
    "height",
    "gap",
    "margin",
    "preset",
    "rotation",
    "scale",
    "allow-mirror",
    "min-offcut-side",
    "offcut-shape-weight",
    "units",
    "common-edge",
  ])
    $(id).disabled = state.running;
  for (const id of [
    "multi-part-clusters",
    "max-cluster-parts",
    "cluster-beam-width",
    "diagonal-common-edges",
  ])
    $(id).disabled = state.running || !$("common-edge").checked;
  $("debug-common-edges").disabled = state.running;
  $("download-diagnostics").disabled = !state.diagnostics.length;
  $("pair-clusters").disabled = state.running || !$("common-edge").checked;
  $("common-edge-weight").disabled = state.running || !$("common-edge").checked;
  $("export").disabled =
    state.invalid || state.placements.length !== parts.length || !parts.length;
  $("export-format").querySelector('[value="dxf"]').disabled =
    state.format === "svg";
  if (state.format === "svg") $("export-format").value = "svg";
  $("review-tab").classList.toggle("active", !layout);
  $("layout-tab").classList.toggle("active", !!layout);
  $("layout-tab").disabled = !state.placements.length;
  $("sheet-navigation").hidden = !layout || sheetCount() < 2;
  $("sheet-number").textContent =
    `Sheet ${state.sheet + 1} of ${sheetCount()} · 第 ${state.sheet + 1} / ${sheetCount()} 張`;
  $("previous").disabled = state.sheet === 0;
  $("next").disabled = state.sheet >= sheetCount() - 1;
  workspaceUI?.afterRender();
  cutStrategyUI?.render();
}
function stop() {
  state.running = false;
  compactor?.terminate();
  compactor = null;
  compacting = compactQueued = false;
  if (engine) {
    engine.remove();
    engine = null;
  }
  clearTimeout(stopTimer);
  clearInterval(ticker);
  $("progress").style.width = "0%";
  const n = state.parts.length - state.placements.length;
  if (state.placements.length) {
    setStatus(n ? `${n} unplaced / 未排` : "Ready to export / 可匯出");
    if (n)
      message(
        `${n} parts were not placed. Try a larger sheet or finer rotations. Export remains disabled. / ${n} 件零件未排好，請嘗試較大板材或更細旋轉級距。`,
      );
  } else setStatus("No layout yet / 未有排位");
  render();
}
function invalidate() {
  workspaceUI?.reset();
  stop();
  state.placements = [];
  state.view = "review";
  state.sheet = 0;
  state.invalid = false;
  state.metrics = null;
  state.clusterMoves = 0;
  state.excludedOffcuts.clear();
  state.preservedRemnants = [];
  state.diagnostics = [];
  state.firstResultSeconds = null;
  state.accepted = 0;
  message();
  setStatus("Review parts / 確認零件");
  render();
}
function beginNest(continuing = false) {
  if (state.running || state.invalid || !$("confirmed").checked) return;
  if (!continuing) {
    workspaceUI?.reset();
    state.refineOnly = false;
  }
  let settings;
  try {
    settings = checkSettings(readSettings());
  } catch (e) {
    message(e.message, true);
    return;
  }
  if (continuing && !state.placements.length) return;
  if (continuing) {
    captureRemnants();
    settings.preservedRemnants = state.preservedRemnants;
  }
  stop();
  if (!continuing) {
    state.preservedRemnants = [];
    settings.preservedRemnants = [];
    state.diagnostics = [];
    state.placements = [];
    state.sheet = 0;
    state.accepted = 0;
    state.metrics = null;
    state.clusterMoves = 0;
    state.firstResultSeconds = null;
  }
  state.running = true;
  budgetSeconds = searchSettings(settings.rotations).seconds;
  runSettings = settings;
  message();
  started = performance.now();
  startEngine();
  ticker = setInterval(updateSearchStatus, 250);
  render();
}
function updateSearchStatus() {
  if (!state.running) return;
  const elapsed = (performance.now() - started) / 1000;
  $("progress").style.width =
    `${Math.min(100, (elapsed / budgetSeconds) * 100)}%`;
  const label =
    state.placements.length === state.parts.length
      ? "Improving offcut / 改善餘料"
      : "Arranging / 排料中";
  setStatus(`${label} · ${Math.floor(elapsed)}s`);
}
function startEngine() {
  const run = ++state.run;
  compactor = new Worker(
    new URL("./compaction-worker.js?v=0.13.0", import.meta.url),
    { type: "module" },
  );
  compactor.onmessage = ({ data }) => {
    if (data.run === state.run && data.diagnostics) {
      state.diagnostics.push({
        ...data.diagnostics,
        maxClusterSize: data.maxClusterSize,
        finalScore: data.report?.score,
      });
      if (state.diagnostics.length > 12) state.diagnostics.shift();
      $("download-diagnostics").disabled = false;
    }
    if (
      data.run === state.run &&
      data.type === "complete" &&
      data.clustersMoved
    )
      state.clusterMoves = (state.clusterMoves || 0) + data.clustersMoved;
    if (!state.running || data.run !== state.run) return;
    if (data.placements) considerLayout(data.placements);
    if (data.type === "complete" || data.type === "error") {
      compacting = false;
      if (data.type === "error") console.warn("Compaction: " + data.message);
      if (data.changed || data.incomplete) compactQueued = true;
      if (compactQueued) scheduleCompaction();
    }
  };
  compactor.onerror = () => {
    compacting = false;
  };
  scheduleCompaction();
  if (state.refineOnly || runSettings.lockedPlacements?.length) {
    stopTimer = setTimeout(stop, budgetSeconds * 1000);
    updateSearchStatus();
    return;
  }
  const frame = document.createElement("iframe");
  engine = frame;
  frame.hidden = true;
  frame.title = "Nesting calculation";
  frame.onload = () => {
    if (!state.running || engine !== frame || state.run !== run) return;
    frame.contentWindow.postMessage(
      {
        type: "start",
        run,
        parts: state.parts.map((p) => ({
          id: p.id,
          outer: p.outer.map((v) => ({
            x: v.x * runSettings.scale,
            y: v.y * runSettings.scale,
          })),
        })),
        settings: runSettings,
        seed: searchSeed(state.placements),
      },
      location.origin,
    );
  };
  frame.src = "engine/index.html?v=0.13.0";
  document.body.append(frame);
  stopTimer = setTimeout(() => {
    stop();
    if (!state.placements.length)
      message(
        "No valid layout found. Try a larger sheet or fewer parts. / 未找到有效排位，請嘗試較大板材或較少零件。",
        true,
      );
  }, budgetSeconds * 1000);
  updateSearchStatus();
}
window.addEventListener("message", (event) => {
  if (
    event.origin !== location.origin ||
    !engine ||
    event.source !== engine.contentWindow ||
    !state.running
  )
    return;
  const data = event.data;
  if (
    data.type === "engine-error" ||
    (data.type === "error" && data.run === state.run)
  ) {
    stop();
    message(
      `Nesting calculation failed: ${data.message} / 排料運算失敗。`,
      true,
    );
    return;
  }
  if (data.run !== state.run || data.type !== "layout") return;
  if (considerLayout(data.placements)) scheduleCompaction();
});
function scheduleCompaction() {
  if (
    !state.running ||
    !compactor ||
    state.placements.length !== state.parts.length
  )
    return;
  if (compacting) {
    compactQueued = true;
    return;
  }
  compacting = true;
  compactQueued = false;
  compactor.postMessage({
    run: state.run,
    parts: state.parts.map((p) => ({
      id: p.id,
      outer: p.outer,
      edges: extractPartEdges(p),
      ...(runSettings.commonEdgeMode === true
        ? { entities: p.entities, origin: p.origin }
        : {}),
    })),
    placements: state.placements,
    settings: runSettings,
  });
}
function considerLayout(placements) {
  const errors = validateLayout(state.parts, placements, readSettings());
  if (errors.length) {
    console.warn("Rejected layout: " + errors.join("; "));
    return;
  }
  const candidate = evaluateLayout(state.parts, placements, runSettings);
  if (
    placements.length &&
    (!state.metrics || improves(candidate.score, state.metrics.score))
  ) {
    state.accepted++;
    state.metrics = candidate;
    if (
      state.firstResultSeconds === null &&
      placements.length === state.parts.length
    )
      state.firstResultSeconds = (performance.now() - started) / 1000;
    workspaceUI?.autoAccepted(placements);
    state.placements = placements;
    state.view = "layout";
    state.sheet = Math.min(state.sheet, sheetCount() - 1);
    render();
    return true;
  }
  return false;
}
async function importFile(file) {
  if (state.running || !file) return;
  if (file.size > 5 * 1024 * 1024) {
    message("Maximum file size: 5 MB / 檔案上限 5 MB", true);
    return;
  }
  const text = await file.text();
  lastFile = { name: file.name, text };
  loadText(file.name, text);
}
function loadText(name, text) {
  invalidate();
  $("confirmed").checked = false;
  try {
    const result = /\.dxf$/i.test(name)
      ? parseDXF(text, $("units").value)
      : /\.svg$/i.test(name)
        ? parseSVG(text)
        : (() => {
            throw new Error("Choose a DXF or SVG file / 請選擇 DXF 或 SVG");
          })();
    state.parts = result.parts;
    state.selected = result.parts[0]?.id;
    state.format = result.format;
    state.name = name;
    state.meta = result.unitLabel;
    message(result.warnings.join("\n"));
    setStatus("Review parts / 確認零件");
  } catch (e) {
    state.invalid = true;
    message(
      `Import rejected / 匯入失敗\n${e.message}\nPrevious drawing remains on screen. / 畫面仍顯示上一份圖檔。`,
      true,
    );
    setStatus("Import rejected / 匯入失敗");
  }
  render();
}
function loadDemo() {
  invalidate();
  lastFile = null;
  state.parts = sampleParts();
  state.selected = "part-1";
  state.format = "dxf";
  state.name = "Sample · Scenic paper kit";
  state.meta = "示範圖檔 · 12 paper scenery parts / 紙材模型零件";
  $("confirmed").checked = false;
  message(
    "Sample data: wall panels, braces, arches and bases. / 示範：牆板、撐架、拱片及底板。",
  );
  render();
}
function download() {
  workspaceUI?.prepareExport();
  const settings = checkSettings(readSettings());
  const errors = validateLayout(state.parts, state.placements, settings);
  if (errors.length || state.placements.length !== state.parts.length) {
    message(
      "Export blocked: layout validation failed. / 排位未通過檢查，暫不能輸出。",
      true,
    );
    return;
  }
  const format = $("export-format").value;
  const content =
    format === "dxf"
      ? exportDXF(
          state.parts,
          state.placements,
          state.sheet,
          settings,
          exportOptions(state.sheet),
        )
      : exportSVG(
          state.parts,
          state.placements,
          state.sheet,
          settings,
          exportOptions(state.sheet),
        );
  const name = `${state.name.replace(/\.(dxf|svg)$/i, "").replace(/[^\p{L}\p{N}._-]+/gu, "-")}-sheet-${state.sheet + 1}.${format}`;
  saveFile(content, name, format === "svg" ? "image/svg+xml" : "application/dxf");
}
document.addEventListener("click", (e) => {
  const row = e.target.closest("[data-part]");
  if (row) {
    state.selected = row.dataset.part;
    const t = state.placements.find((t) => t.id === state.selected);
    if (t && state.view === "layout") state.sheet = t.sheet;
    render();
  }
});
$("confirmed").addEventListener("change", render);
function captureRemnants() {
  state.preservedRemnants =
    $("include-offcuts").checked && $("preserve-remnant-splits").checked
      ? (state.metrics?.sheets || []).flatMap((s) =>
          remnantPlan(
            sheetOffcuts(s.sheet).filter(
              (r) => !state.excludedOffcuts.has(r.id),
            ),
            s.sheet,
          ),
        )
      : [];
}
$("download-diagnostics").onclick = () => {
  saveFile(JSON.stringify({ settings: readSettings(), jobs: state.diagnostics }, null, 2), "paper-nest-diagnostics.json", "application/json");
};
$("preserve-remnant-splits").addEventListener("change", () => {
  if (state.running) stop();
  captureRemnants();
  render();
});
$("include-offcuts").addEventListener("change", () => {
  if (state.running) stop();
  captureRemnants();
  render();
});
$("offcut-list").addEventListener("change", (e) => {
  const id = e.target.dataset.offcut;
  if (!id) return;
  const checked = e.target.checked;
  if (state.running) stop();
  if (checked && !$("include-offcuts").checked) {
    for (const r of sheetOffcuts(state.sheet)) state.excludedOffcuts.add(r.id);
    $("include-offcuts").checked = true;
  }
  if (checked) state.excludedOffcuts.delete(id);
  else state.excludedOffcuts.add(id);
  captureRemnants();
  render();
});
$("demo").onclick = loadDemo;
$("nest").onclick = () => beginNest(false);
$("continue").onclick = () => beginNest(true);
$("stop").onclick = stop;
$("export").onclick = () => {
  try {
    download();
  } catch (e) {
    message(e.message, true);
  }
};
$("file").onchange = (e) => {
  importFile(e.target.files[0]);
  e.target.value = "";
};
const drop = $("dropzone");
for (const name of ["dragenter", "dragover"])
  drop.addEventListener(name, (e) => {
    e.preventDefault();
    drop.classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  drop.addEventListener(name, (e) => {
    e.preventDefault();
    drop.classList.remove("dragging");
  });
drop.addEventListener("drop", (e) => importFile(e.dataTransfer.files[0]));
for (const id of [
  "width",
  "height",
  "gap",
  "margin",
  "rotation",
  "scale",
  "allow-mirror",
  "min-offcut-side",
  "offcut-shape-weight",
  "common-edge",
  "pair-clusters",
  "multi-part-clusters",
  "max-cluster-parts",
  "cluster-beam-width",
  "diagonal-common-edges",
  "common-edge-weight",
])
  $(id).addEventListener("change", () => {
    if (id === "width" || id === "height") $("preset").value = "custom";
    if (id === "common-edge") {
      const enabled = $("common-edge").checked;
      $("pair-clusters").disabled = !enabled;
      $("common-edge-weight").disabled = !enabled;
      $("merge-common-lines").checked = enabled;
    }
    invalidate();
  });
$("min-offcut-side").addEventListener("input", invalidate);
$("preset").onchange = () => {
  const preset = SHEET_PRESETS[$("preset").value];
  if (preset) {
    $("width").value = preset.width;
    $("height").value = preset.height;
  }
  invalidate();
};
$("units").onchange = () => {
  if (lastFile && /\.dxf$/i.test(lastFile.name))
    loadText(lastFile.name, lastFile.text);
};
$("review-tab").onclick = () => {
  state.view = "review";
  render();
};
$("layout-tab").onclick = () => {
  state.view = "layout";
  render();
};
$("previous").onclick = () => {
  state.sheet--;
  render();
};
$("next").onclick = () => {
  state.sheet++;
  render();
};
workspaceUI = installWorkspace({
  state,
  readSettings,
  render,
  stop,
  beginNest,
  message,
});
cutStrategyUI = installCutStrategy({
  state,
  readSettings,
  render,
  sheetOffcuts,
});

render();
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    {
      name: "read_nesting_status",
      description: "Read the drawing, settings, part count and layout status.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: () => ({
        drawing: state.name,
        parts: state.parts.length,
        placed: state.placements.length,
        sheets: sheetCount(),
        running: state.running,
        settings: readSettings(),
        search: {
          angleStep: 360 / readSettings().rotations,
          elapsedSeconds: state.running
            ? Math.floor((performance.now() - started) / 1000)
            : null,
          firstResultSeconds: state.firstResultSeconds,
          acceptedLayouts: state.accepted,
          bestScore: state.metrics?.score || null,
        },
        mirroredParts: state.placements
          .filter((p) => p.mirrored)
          .map((p) => p.id),
        includeOffcutCuts: $("include-offcuts").checked,
        cutting: state.metrics?.cutting || null,
        pairMoves: state.clusterMoves || 0,
        mergeCommonLines: $("merge-common-lines").checked,
        offcuts:
          state.metrics?.sheets.flatMap(({ sheet }) =>
            sheetOffcuts(sheet).map((r) => ({
              ...r,
              sheet: sheet + 1,
              selected: !state.excludedOffcuts.has(r.id),
            })),
          ) || [],
      }),
    },
    {
      name: "configure_nesting_sheet",
      description:
        "Set sheet dimensions, clearance and margin; clears the previous layout.",
      inputSchema: {
        type: "object",
        properties: {
          width: { type: "number", minimum: 10, maximum: 3000 },
          height: { type: "number", minimum: 10, maximum: 3000 },
          gap: { type: "number", minimum: 0.1, maximum: 50 },
          margin: { type: "number", minimum: 0 },
          minOffcutSide: { type: "number", minimum: 0, maximum: 3000 },
        },
        required: ["width", "height", "gap", "margin"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        if (state.running)
          throw new Error("Stop nesting before changing settings.");
        if (
          !input ||
          Object.keys(input).some(
            (k) =>
              !["width", "height", "gap", "margin", "minOffcutSide"].includes(
                k,
              ),
          )
        )
          throw new Error("Invalid settings");
        const s = checkSettings({
          ...readSettings(),
          ...input,
        });
        for (const key of ["width", "height", "gap", "margin"])
          $(key).value = s[key];
        $("min-offcut-side").value = s.minOffcutSide;
        $("preset").value = "custom";
        invalidate();
        return { settings: readSettings(), layoutCleared: true };
      },
    },
    {
      name: "export_nesting_sheet",
      description:
        "Produce SVG or DXF file content at the selected drawing scale for one validated sheet. Does not upload or send files.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["svg", "dxf"] },
          sheet: { type: "integer", minimum: 1 },
          includeOffcuts: {
            type: "boolean",
            description:
              "Include selected offcut cut lines; defaults to the page checkbox.",
          },
        },
        required: ["format", "sheet"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        if (
          !input ||
          !["svg", "dxf"].includes(input.format) ||
          !Number.isInteger(input.sheet) ||
          input.sheet < 1 ||
          input.sheet > sheetCount() ||
          (input.includeOffcuts !== undefined &&
            typeof input.includeOffcuts !== "boolean") ||
          Object.keys(input).some(
            (k) => !["format", "sheet", "includeOffcuts"].includes(k),
          )
        )
          throw new Error("Invalid export options");
        if (
          state.invalid ||
          state.placements.length !== state.parts.length ||
          validateLayout(state.parts, state.placements, readSettings()).length
        )
          throw new Error("A complete validated layout is required.");
        const content =
          input.format === "dxf"
            ? exportDXF(
                state.parts,
                state.placements,
                input.sheet - 1,
                readSettings(),
                exportOptions(
                  input.sheet - 1,
                  input.includeOffcuts ?? $("include-offcuts").checked,
                ),
              )
            : exportSVG(
                state.parts,
                state.placements,
                input.sheet - 1,
                readSettings(),
                exportOptions(
                  input.sheet - 1,
                  input.includeOffcuts ?? $("include-offcuts").checked,
                ),
              );
        return {
          filename: `paper-nest-sheet-${input.sheet}.${input.format}`,
          content,
        };
      },
    },
  ];
  for (const tool of tools)
    try {
      Promise.resolve(
        document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
      ).catch((error) =>
        console.warn("Agent tool registration:", tool.name, error.message),
      );
    } catch (error) {
      console.warn("Agent tool registration:", tool.name, error.message);
    }
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
