import { installPanelResize } from "./panel-resize.js?v=0.26.3";
import {
  proposeCutSets,
  checkedCutSets,
  remainingOffcutFrames,
} from "./separation-sets.js?v=0.26.3";
import { cuttingMetrics } from "./cut-metrics.js?v=0.26.3";
import { recoveryLines } from "./exporters.js?v=0.26.3";
import { lineLength } from "./common-line.js?v=0.26.3";
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
  panel.innerHTML = `<header><h2>Review cuts · 切線清單</h2><button id="close-review" aria-label="Collapse review / 收起清單">×</button></header><div id="remnant-review"></div><section class="cut-strategy"><h3>Quick Separation Cuts<br>快速分離切線</h3><label><input id="separation-visible" type="checkbox" checked> Show cut previews · 顯示切線預覽</label><p class="help">Selected cut sets replace full frames for the offcuts they release. Cut parts first, separation last.<br>勾選切線組後，將取代對應餘料的完整切割框；先切零件，最後分離。</p><div id="separation-choices"></div></section><div id="strategy-comparison" class="help" aria-live="polite"></div>`;
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
    if (quick) {
      const ids =
        currentSets.find((s) => s.id === quick)?.offcuts.map((r) => r.id) || [];
      document.querySelectorAll("[data-offcut-preview]").forEach((el) => {
        if (ids.includes(el.dataset.offcutPreview))
          el.classList.toggle("review-highlight", on);
      });
    }
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
  let currentSets = [];
  let planCache = null;
  function plans(sheet) {
    const settings = readSettings(),
      offcuts = sheetOffcuts(sheet);
    const key = JSON.stringify([
      sheet,
      settings.width,
      settings.height,
      settings.margin,
      settings.kerf,
      offcuts,
    ]);
    if (
      planCache?.key === key &&
      planCache.parts === state.parts &&
      planCache.placements === state.placements
    )
      return planCache.sets;
    const sets = proposeCutSets(
      state.parts,
      state.placements,
      sheet,
      settings,
      offcuts,
    );
    planCache = { key, parts: state.parts, placements: state.placements, sets };
    return sets;
  }
  function options(sheet) {
    return { cutSets: plans(sheet).filter((s) => selected.has(s.id)) };
  }
  function update() {
    const sets = (currentSets = plans(state.sheet));
    $("separation-choices").innerHTML =
      `<p class="help">${sets.length} suggestions / 個建議 · Include in export / 加入輸出</p>` +
      sets
        .map(
          (set, i) =>
            `<label class="offcut-choice"><input type="checkbox" data-separation="${set.id}" ${selected.has(set.id) ? "checked" : ""}><span><strong>Cut Set ${i + 1} · 切線組</strong><small>${set.segments.length} segments / 段 · ${set.length.toFixed(1)} mm<br>Releases / 釋放：${set.offcuts.map((r) => String(r.number).padStart(2, "0")).join(", ")}<br>${(set.area / 100).toFixed(1)} cm² preserved / 保留</small></span></label>`,
        )
        .join("");
    const all = sheetOffcuts(state.sheet),
      rects = $("include-offcuts").checked
        ? all.filter((r) => !state.excludedOffcuts.has(r.id))
        : [];
    const chosen = sets.filter((s) => selected.has(s.id));
    const lines = checkedCutSets(
      state.parts,
      state.placements,
      state.sheet,
      readSettings(),
      chosen,
    );
    const frames = remainingOffcutFrames(rects, chosen);
    const cuts = frames.map((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x + r.w, y: r.y + r.h },
      { x: r.x, y: r.y + r.h },
    ]);
    const recovery = recoveryLines(cuts, lines);
    const quick = recovery.quick.reduce((n, l) => n + lineLength(l), 0),
      remnant =
        !$("merge-common-lines").checked && !quick
          ? frames.reduce((n, r) => n + 2 * (r.w + r.h), 0)
          : recovery.remnant.reduce((n, l) => n + lineLength(l), 0);
    const released = [
      ...new Map(
        [...rects, ...chosen.flatMap((s) => s.offcuts)].map((r) => [r.id, r]),
      ).values(),
    ];
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
      `<h3>Output Result · 輸出結果</h3><dl><dt>Parts · 零件</dt><dd>${state.placements.filter((t) => t.sheet === state.sheet).length}</dd><dt>Offcuts · 餘料</dt><dd>${released.length} · ${(released.reduce((n, r) => n + r.w * r.h, 0) / 100).toFixed(1)} cm²</dd><dt>Cut sets · 切線組</dt><dd>${chosen.length} · ${lines.length} segments / 段</dd><dt>Part cuts · 零件原切線</dt><dd>${metrics.rawCutLength.toFixed(1)} mm</dd><dt>Shared savings · 共線節省</dt><dd>−${savings.toFixed(1)} mm</dd><dt>Quick cuts · 分離線</dt><dd>${quick.toFixed(1)} mm</dd><dt>Remnant cuts · 餘料線</dt><dd>${remnant.toFixed(1)} mm</dd><dt><strong>Total · 總長</strong></dt><dd><strong>${(base + quick + remnant).toFixed(1)} mm</strong></dd></dl>`;
    document.querySelectorAll(".offcut-preview").forEach((el, i) =>
      el.classList.toggle(
        "offcut-cut-preview",
        frames.some((r) => r.id === all[i]?.id),
      ),
    );
    document
      .querySelectorAll(".quick-preview-group")
      .forEach((el) => el.remove());
    const chosenIds = new Set(
      chosen.flatMap((s) => s.offcuts.map((r) => r.id)),
    );
    document
      .querySelectorAll("[data-offcut-preview]")
      .forEach((el) =>
        el.classList.toggle(
          "cut-set-released",
          chosenIds.has(el.dataset.offcutPreview),
        ),
      );
    if (
      state.view !== "layout" ||
      document.body.dataset.stage !== "export" ||
      !$("separation-visible").checked
    )
      return;
    const svgNS = "http://www.w3.org/2000/svg",
      s = readSettings(),
      extension = Math.max(s.width, s.height) * 0.018;
    for (const [i, set] of sets.entries()) {
      const group = document.createElementNS(svgNS, "g");
      group.setAttribute("class", "quick-preview-group");
      group.dataset.cutPreview = set.id;
      group.innerHTML =
        `<title>Cut Set ${i + 1} · ${set.length.toFixed(1)} mm</title>` +
        set.segments
          .map((l) => {
            const vertical = Math.abs(l.start.x - l.end.x) < 1e-6;
            return `<line class="separation-preview ${selected.has(set.id) ? "export-selected" : ""}" x1="${l.start.x}" y1="${l.start.y}" x2="${l.end.x}" y2="${l.end.y}"/><g class="scissors" transform="translate(${(l.start.x + l.end.x) / 2} ${(l.start.y + l.end.y) / 2}) rotate(${vertical ? 0 : -90}) scale(${extension / 14})"><circle cx="-4" cy="-4" r="2.5"/><circle cx="4" cy="-4" r="2.5"/><path d="M-2 -2 L5 7 M2 -2 L-5 7"/></g>`;
          })
          .join("");
      $("canvas").append(group);
    }
  }
  return { render: update, options };
}
