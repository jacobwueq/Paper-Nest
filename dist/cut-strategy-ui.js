import { proposeSeparations } from "./separation.js?v=0.13.0";
import { cuttingMetrics } from "./cut-metrics.js?v=0.13.0";
import { fmt } from "./geometry.js?v=0.13.0";
export function installCutStrategy({
  state,
  readSettings,
  render,
  sheetOffcuts,
}) {
  const $ = (id) => document.getElementById(id),
    excluded = new Set();
  const panel = document.createElement("section");
  panel.className = "cut-strategy";
  panel.innerHTML = `<h3>Recovery strategy · 餘料切割方案</h3><label for="cut-strategy">Choose strategy · 選擇方案</label><select id="cut-strategy"><option value="full">A · Preserve full remnant / 完整餘料框</option><option value="quick">B · Quick separation / 快速分離</option></select><label id="separation-toggle"><input id="separation-enabled" type="checkbox" checked> Include purple cuts · 輸出紫色分離線</label><div id="separation-choices"></div><div id="strategy-comparison" class="help"></div><p class="help">Purple lines reach the physical sheet edge. Green areas remain reference remnants; quick cuts do not trace their frames.<br>紫線延伸至實際板邊；快速分離不會沿綠色餘料框切割。先切零件，最後執行分離線。</p>`;
  document.querySelector(".export-area").prepend(panel);
  for (const id of ["cut-strategy", "separation-enabled", "separation-kerf"])
    $(id).addEventListener("change", render);
  panel.addEventListener("change", (e) => {
    const id = e.target.dataset.separation;
    if (id) {
      e.target.checked ? excluded.delete(id) : excluded.add(id);
      render();
    }
  });
  function plan() {
    return proposeSeparations(
      state.parts,
      state.placements,
      state.sheet,
      readSettings(),
    );
  }
  function options(sheet) {
    if ($("cut-strategy").value !== "quick") return null;
    const lines = $("separation-enabled").checked
      ? proposeSeparations(
          state.parts,
          state.placements,
          sheet,
          readSettings(),
        ).filter((l) => !excluded.has(l.id))
      : [];
    return { offcuts: [], separationCuts: lines };
  }
  function update() {
    const quick = $("cut-strategy").value === "quick";
    $("include-offcuts").disabled = quick;
    $("separation-toggle").hidden = !quick;
    let lines = [];
    try {
      lines = plan();
    } catch (e) {
      $("strategy-comparison").textContent = e.message;
      return;
    }
    $("separation-choices").hidden = !quick;
    $("separation-choices").innerHTML = lines.length
      ? lines
          .map(
            (l) =>
              `<label><input type="checkbox" data-separation="${l.id}" ${excluded.has(l.id) ? "" : "checked"}>${l.axis === "x" ? "Vertical / 垂直" : "Horizontal / 水平"} · ${l.length.toFixed(1)} mm</label>`,
          )
          .join("")
      : "No safe full-sheet cut / 無安全嘅全板分離線";
    const selected = lines.filter((l) => !excluded.has(l.id)),
      rects = sheetOffcuts(state.sheet).filter(
        (r) => !state.excludedOffcuts.has(r.id),
      );
    const full = rects.reduce((n, r) => n + 2 * (r.w + r.h), 0),
      short = selected.reduce((n, l) => n + l.length, 0);
    const base = state.placements.length
      ? cuttingMetrics(
          state.parts,
          state.placements.filter((t) => t.sheet === state.sheet),
          readSettings(),
        )[
          $("merge-common-lines").checked
            ? "estimatedCutLength"
            : "rawCutLength"
        ]
      : 0;
    $("strategy-comparison").innerHTML =
      `<table class="strategy-table"><caption>Recovery cuts / 回收切線比較</caption><thead><tr><th></th><th>A · Full<br>完整框</th><th>B · Quick<br>分離線</th></tr></thead><tbody><tr><th>Extra length<br>額外長度</th><td>${full.toFixed(1)} mm</td><td>${short.toFixed(1)} mm</td></tr><tr><th>Segments<br>線段</th><td>${rects.length * 4}</td><td>${selected.length}</td></tr><tr><th>Total est.<br>預計總長</th><td>${(base + full).toFixed(1)} mm</td><td>${(base + short).toFixed(1)} mm</td></tr><tr><th>Remnant<br>餘料</th><td>Full frame<br>完整框</td><td>Partial<br>部分</td></tr></tbody></table><p>Selected export / 目前輸出: ${(base + (quick ? ($("separation-enabled").checked ? short : 0) : $("include-offcuts").checked ? full : 0)).toFixed(1)} mm${short >= full && lines.length ? " · Quick is not shorter / 快速方案並非較短" : ""}</p>`;
    if (state.view !== "layout") return;
    const all = sheetOffcuts(state.sheet);
    document
      .querySelectorAll(".offcut-preview")
      .forEach((r, i) =>
        r.classList.toggle(
          "offcut-cut-preview",
          !quick &&
            $("include-offcuts").checked &&
            !state.excludedOffcuts.has(all[i]?.id),
        ),
      );
    if (quick && $("separation-enabled").checked)
      for (const l of selected) {
        const line = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "line",
        );
        line.setAttribute("class", "separation-preview");
        for (const [k, v] of Object.entries({
          x1: l.start.x,
          y1: l.start.y,
          x2: l.end.x,
          y2: l.end.y,
        }))
          line.setAttribute(k, fmt(v));
        line.innerHTML = "<title>Separation cut / 分離切線</title>";
        $("canvas").append(line);
      }
    $("canvas-caption").textContent = quick
      ? "Quick separation / 快速分離 · 紫線為新增切割路徑"
      : $("canvas-caption").textContent;
  }
  return { render: update, options };
}
