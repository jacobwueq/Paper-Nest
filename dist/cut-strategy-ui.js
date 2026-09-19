import { installPanelResize } from "./panel-resize.js?v=0.14.2";
import { proposeSeparations } from "./separation.js?v=0.13.0";
import { cuttingMetrics } from "./cut-metrics.js?v=0.13.0";
import { recoveryLines } from "./exporters.js?v=0.14.0";
import { lineLength } from "./common-line.js?v=0.13.0";
export function installCutStrategy({
  state,
  readSettings,
  render,
  sheetOffcuts,
}) {
  const $ = (id) => document.getElementById(id),
    selected = new Set();
  const panel = document.createElement("aside");
  panel.className = "review-panel";
  panel.id = "review-panel";
  panel.innerHTML = `<header><h2>Review cuts · 切線清單</h2><button id="close-review" aria-label="Collapse review / 收起清單">×</button></header><div id="remnant-review"></div><section class="cut-strategy"><h3>Quick Separation Cuts<br>快速分離切線</h3><label><input id="separation-visible" type="checkbox" checked> Show suggestions · 顯示建議</label><p class="help">Preview only until selected. Cut parts first, separation last.<br>勾選才會輸出。先切零件，最後分離板材。</p><div id="separation-choices"></div></section><div id="strategy-comparison" class="help" aria-live="polite"></div>`;
  document.querySelector(".workspace").append(panel);
  const offcutHelp = $("include-offcuts").closest("label").nextElementSibling;
  if (offcutHelp?.classList.contains("help")) offcutHelp.remove();
  $("remnant-review").append(
    $("offcut-summary"),
    $("include-offcuts").closest("label"),
    $("offcut-list"),
  );
  const toggle = document.createElement("button");
  toggle.id = "toggle-review";
  toggle.textContent = "Review cuts · 切線清單";
  toggle.setAttribute("aria-controls", "review-panel");
  document.querySelector(".stage-nav").append(toggle);
  let collapsed = window.innerWidth < 1100;
  function collapse(value) {
    collapsed = value;
    document.body.classList.toggle("review-collapsed", value);
    toggle.setAttribute("aria-expanded", String(!value));
  }
  collapse(collapsed);
  installPanelResize();
  toggle.onclick = () => collapse(!collapsed);
  $("close-review").onclick = () => collapse(true);
  $("separation-visible").onchange = render;
  $("separation-kerf").addEventListener("change", render);
  panel.addEventListener("change", (e) => {
    const id = e.target.dataset.separation;
    if (id) {
      e.target.checked ? selected.add(id) : selected.delete(id);
      render();
    }
  });
  function highlight(e, on) {
    const row = e.target.closest("label");
    if (!row) return;
    const input = row.querySelector(
      "input[data-separation], input[data-offcut]",
    );
    if (!input) return;
    const quick = input.dataset.separation;
    document
      .querySelectorAll(quick ? "[data-cut-preview]" : "[data-offcut-preview]")
      .forEach((el) => {
        if (
          (quick ? el.dataset.cutPreview : el.dataset.offcutPreview) ===
          (quick || input.dataset.offcut)
        )
          el.classList.toggle("review-highlight", on);
      });
  }
  for (const [event, on] of [
    ["mouseover", true],
    ["mouseout", false],
    ["focusin", true],
    ["focusout", false],
  ])
    panel.addEventListener(event, (e) => highlight(e, on));
  function options(sheet) {
    return {
      separationCuts: proposeSeparations(
        state.parts,
        state.placements,
        sheet,
        readSettings(),
      ).filter((l) => selected.has(l.id)),
    };
  }
  function update() {
    const lines = proposeSeparations(
      state.parts,
      state.placements,
      state.sheet,
      readSettings(),
    );
    $("separation-choices").innerHTML =
      lines
        .map(
          (l, i) =>
            `<label class="offcut-choice"><input type="checkbox" data-separation="${l.id}" ${selected.has(l.id) ? "checked" : ""}><span>Cut ${String.fromCharCode(65 + i)} · ${l.axis === "x" ? "Vertical / 垂直" : "Horizontal / 水平"}<br>${l.length.toFixed(1)} mm</span></label>`,
        )
        .join("") || "No safe full-sheet cut / 無安全全板分離線";
    const all = sheetOffcuts(state.sheet),
      rects = $("include-offcuts").checked
        ? all.filter((r) => !state.excludedOffcuts.has(r.id))
        : [];
    const cuts = rects.map((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]);
    const recovery = recoveryLines(
      cuts,
      lines.filter((l) => selected.has(l.id)),
    );
    const quick = recovery.quick.reduce((n, l) => n + lineLength(l), 0),
      remnant =
        !$("merge-common-lines").checked && !quick
          ? rects.reduce((n, r) => n + 2 * (r.w + r.h), 0)
          : recovery.remnant.reduce((n, l) => n + lineLength(l), 0);
    const metrics = state.placements.length
      ? cuttingMetrics(
          state.parts,
          state.placements.filter((t) => t.sheet === state.sheet),
          readSettings(),
        )
      : { rawCutLength: 0, estimatedCutLength: 0, sharedLength: 0 };
    const savings = $("merge-common-lines").checked ? metrics.sharedLength : 0,
      base = metrics.rawCutLength - savings;
    $("strategy-comparison").innerHTML =
      `<h3>Selected export · 目前輸出</h3><dl><dt>Part cuts · 零件原切線</dt><dd>${metrics.rawCutLength.toFixed(1)} mm</dd><dt>Shared savings · 共線節省</dt><dd>−${savings.toFixed(1)} mm</dd><dt>Quick cuts · 分離線</dt><dd>${quick.toFixed(1)} mm</dd><dt>Remnant cuts · 餘料線</dt><dd>${remnant.toFixed(1)} mm</dd><dt><strong>Total · 總長</strong></dt><dd><strong>${(base + quick + remnant).toFixed(1)} mm</strong></dd></dl>`;
    document
      .querySelectorAll(".offcut-preview")
      .forEach((el, i) =>
        el.classList.toggle(
          "offcut-cut-preview",
          $("include-offcuts").checked &&
            !state.excludedOffcuts.has(all[i]?.id),
        ),
      );
    document
      .querySelectorAll(".quick-preview-group")
      .forEach((el) => el.remove());
    if (
      state.view !== "layout" ||
      document.body.dataset.stage !== "export" ||
      !$("separation-visible").checked
    )
      return;
    const svgNS = "http://www.w3.org/2000/svg",
      s = readSettings(),
      extension = Math.max(s.width, s.height) * 0.018;
    for (const [i, l] of lines.entries()) {
      const group = document.createElementNS(svgNS, "g");
      group.setAttribute("class", "quick-preview-group");
      group.dataset.cutPreview = l.id;
      const vertical = l.axis === "x",
        start = { ...l.start },
        end = { ...l.end };
      if (vertical) {
        start.y -= extension;
        end.y += extension;
      } else {
        start.x -= extension;
        end.x += extension;
      }
      group.innerHTML = `<title>Cut ${String.fromCharCode(65 + i)} · ${l.length.toFixed(1)} mm</title><line class="separation-preview ${selected.has(l.id) ? "export-selected" : ""}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"/><g class="scissors" transform="translate(${(l.start.x + l.end.x) / 2} ${(l.start.y + l.end.y) / 2}) rotate(${vertical ? 0 : -90}) scale(${extension / 14})"><circle cx="-4" cy="-4" r="2.5"/><circle cx="4" cy="-4" r="2.5"/><path d="M-2 -2 L5 7 M2 -2 L-5 7"/></g>`;
      $("canvas").append(group);
    }
  }
  return { render: update, options };
}
