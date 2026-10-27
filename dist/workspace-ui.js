import {
  ManualLayout,
  translateSelection,
  rotateSelection,
  magneticSnap,
  rotationSuggestion,
  rebuildContacts,
} from "./manual-layout.js?v=0.31.2";
import { cuttingMetrics } from "./cut-metrics.js?v=0.31.2";
import { evaluateLayout } from "./search.js?v=0.31.2";
import {
  validateLayout,
  bounds,
  transformed,
  esc,
  area,
} from "./geometry.js?v=0.31.2";
export function installWorkspace({
  state,
  readSettings,
  render,
  stop,
  beginNest,
  message,
}) {
  const $ = (id) => document.getElementById(id),
    canvas = $("canvas"),
    controls = document.querySelector(".controls");
  let model = null,
    stage = "setup",
    selection = [],
    camera = null,
    sheetKey = "",
    gesture = null,
    draft = null,
    suggestion = null,
    space = false;
  const nav = document.createElement("nav");
  nav.className = "stage-nav";
  nav.setAttribute("aria-label", "Workflow / 工作階段");
  nav.innerHTML =
    '<button id="toggle-settings" aria-expanded="true">☰ Panel · 面板</button>' +
    [
      ["setup", "1 · Setup 設定"],
      ["optimise", "2 · Auto Nest 排料"],
      ["manual", "3 · Manual Adjust 微調"],
      ["export", "4 · Review & Export 匯出"],
    ]
      .map(([id, label]) => `<button data-stage="${id}">${label}</button>`)
      .join("");
  document.querySelector(".workspace").before(nav);
  const sections = [...controls.children],
    panels = {};
  for (const id of ["setup", "optimise", "manual", "export"]) {
    const p = document.createElement("div");
    p.dataset.panel = id;
    controls.append(p);
    panels[id] = p;
  }
  panels.setup.append(sections[0], sections[1]);
  panels.optimise.append(sections[2]);
  // Settings in three levels: essentials stay visible (drawing, sheet size, gap, margin);
  // "More options" holds everyday adjustments; "Expert settings" holds search tuning.
  const adjust = document.createElement("details");
  adjust.className = "settings-tier settings-adjust";
  adjust.innerHTML = "<summary>More options · 更多選項</summary>";
  const advanced = document.createElement("details");
  advanced.className = "settings-tier settings-expert";
  advanced.innerHTML = "<summary>Expert settings · 專家設定</summary>";
  panels.setup.append(adjust, advanced);
  for (const id of [
    "offcut-shape-weight",
    "pair-clusters",
    "max-cluster-parts",
    "cluster-beam-width",
    "diagonal-common-edges",
    "preserve-remnant-splits",
    "debug-common-edges",
    "download-diagnostics",
    "common-edge-weight",
  ]) {
    const input = $(id),
      node = input.closest(".field") || input.closest("label") || input;
    advanced.append(node);
  }
  for (const p of sections[1].querySelectorAll(".help"))
    if (/selected offcut|Material use/.test(p.textContent)) advanced.append(p);
  const material = document.createElement("div");
  material.className = "field";
  material.innerHTML =
    '<label for="material-label">Material · 材料（記錄用）</label><select id="material-label"><option>Paper / 紙</option><option>Card / 卡紙</option><option>Other / 其他</option></select><label for="separation-kerf">Separation kerf · 分離切線刀縫 (mm)</label><input id="separation-kerf" type="number" min="0" max="10" step="0.01" value="0.15"><p class="help">Kerf clearance for separation cuts only; part geometry stays unchanged.<br>只用於分離線避讓；不補償零件輪廓。</p>';
  const unitsField = $("units").closest(".field"),
    unitsHelp = unitsField.nextElementSibling?.classList.contains("help")
      ? unitsField.nextElementSibling
      : null;
  adjust.append(unitsField);
  if (unitsHelp) adjust.append(unitsHelp);
  adjust.append(material);
  const scaleHelp = [...sections[1].querySelectorAll(".help")].find((p) =>
    /100% keeps/.test(p.textContent),
  );
  for (const id of ["rotation", "scale", "allow-mirror", "part-in-part", "min-offcut-side"]) {
    const input = $(id);
    adjust.append(input.closest(".field") || input.closest("label") || input);
    if (id === "scale" && scaleHelp) adjust.append(scaleHelp);
  }
  for (const id of ["common-edge", "multi-part-clusters"])
    adjust.append($(id).closest("label"));
  const list = document.createElement("details");
  list.innerHTML = "<summary>Parts & details · 零件及詳情</summary>";
  list.append($("parts-list"), $("inspector"));
  panels.setup.append(list);
  panels.export.append(
    document.querySelector(".export-area"),
    $("offcut-summary"),
    $("offcut-list"),
  );
  // Retain hidden part-count target used by the existing renderer.
  panels.setup.append($("part-total"));
  $("part-total").hidden = true;
  document.querySelector(".parts-panel").remove();
  panels.manual.innerHTML = `<p class="help">Drag to move. Shift-click to select more. Space-drag to pan.<br>拖動移位；Shift 多選；空白鍵拖動畫面。</p>
 <p id="manual-selection"></p>
 <section class="manual-section"><h3>Selection · 選取</h3><label><input id="select-cluster" type="checkbox"> Select cluster · 選整組</label><label><input id="magnetic-snap" type="checkbox" checked> Magnetic edges · 磁力共邊</label></section>
 <section class="manual-section"><h3>History · 復原記錄</h3><div class="manual-buttons"><button id="edit-undo">Undo · 復原</button><button id="edit-redo">Redo · 重做</button></div></section>
 <section class="manual-section"><h3>Transform · 變換</h3><div class="manual-buttons"><button id="rotate90">+90°</button><button id="rotate180">+180°</button></div><label for="edit-angle">Rotate by degrees · 旋轉角度</label><div class="inline-field"><input id="edit-angle" type="number" value="1" step="0.1"><button id="rotate-custom">Rotate · 旋轉</button></div></section>
 <section class="manual-section"><h3>Grouping · 組合</h3><div class="manual-buttons"><button id="edit-group">Group · 組合</button><button id="edit-detach">Detach · 獨立移動</button></div></section>
 <section class="manual-section"><h3>Position · 位置</h3><div class="manual-buttons"><button id="edit-lock">Lock · 鎖定</button><button id="edit-unlock">Unlock · 解鎖</button><button id="edit-reset">Reset to auto · 還原</button></div></section>
 <section id="suggested-match" class="manual-section" hidden><h3>Suggested edge match · 建議共邊</h3><p id="suggested-details" class="help"></p><p class="help">Preview is temporary. Apply moves the selected part(s).<br>預覽不會改位；套用後才移動所選零件。</p><div class="manual-buttons"><button id="preview-snap">Preview · 預覽</button><button id="cancel-snap-preview">Clear preview · 清除預覽</button></div><button id="rotate-snap" class="secondary">Use suggested edge match<br>使用建議共邊</button></section>
 <section class="manual-section"><h3>Optimisation · 優化</h3><button id="refine-unlocked" class="primary">Re-optimise unlocked · 改善未鎖定零件</button></section>
 <p class="help">Invalid moves are not committed. Detach then drag to break a shared contact.<br>無效移動不會套用；獨立移動再拖開即可解除共邊。</p>`;
  const tools = document.createElement("div");
  tools.className = "canvas-tools";
  tools.innerHTML =
    '<button id="zoom-in" aria-label="Zoom in">＋</button><button id="zoom-out" aria-label="Zoom out">−</button><button id="fit-sheet">Fit · 全板</button><button id="pan-mode" aria-pressed="false">Pan · 平移</button><button id="max-canvas">Maximise · 放大工作區</button>';
  $("canvas-wrap").append(tools);
  const status = document.createElement("div");
  status.id = "edit-status";
  status.setAttribute("role", "status");
  $("canvas-wrap").append(status);
  const metrics = document.createElement("div");
  metrics.id = "manual-metrics";
  document.querySelector(".result-strip").after(metrics);
  let panMode = false;
  const settings = () => (model ? model.validationSettings() : readSettings());
  function notice(text) {
    status.textContent = text;
  }
  function ensure() {
    if (!state.placements.length) {
      message("Arrange parts first / 請先自動排料", true);
      return false;
    }
    stop();
    if (!model)
      model = new ManualLayout(state.parts, state.placements, readSettings());
    model.settings = readSettings();
    delete model.settings.lockedPlacements;
    state.view = "layout";
    return true;
  }
  function activate(id) {
    if (id === "manual" && !ensure()) return;
    if (id === "export" && !state.placements.length) {
      message("Arrange parts first / 請先自動排料", true);
      return;
    }
    if (id === "export") {
      stop();
      state.view = "layout";
    }
    document.body.classList.remove("settings-hidden");
    $("toggle-settings").setAttribute("aria-expanded", "true");
    stage = id;
    controls.scrollTop = 0;
    if (id !== "manual") notice("");
    document.body.dataset.stage = id;
    for (const [key, p] of Object.entries(panels)) p.hidden = key !== id;
    nav
      .querySelectorAll("[data-stage]")
      .forEach((b) =>
        b.setAttribute("aria-pressed", String(b.dataset.stage === id)),
      );
    if (id === "manual") {
      state.view = "layout";
      notice("Drag a part to edit / 拖動零件開始編輯");
    }
    render();
  }
  nav.addEventListener("click", (e) => {
    if (e.target.dataset.stage) activate(e.target.dataset.stage);
  });
  $("toggle-settings").onclick = () => {
    document.body.classList.toggle("settings-hidden");
    $("toggle-settings").setAttribute(
      "aria-expanded",
      String(!document.body.classList.contains("settings-hidden")),
    );
  };
  function sync() {
    state.placements = model.placements;
    state.metrics = evaluateLayout(
      state.parts,
      state.placements,
      readSettings(),
    );
    state.view = "layout";
    state.excludedOffcuts.clear();
    draft = null;
    suggestion = null;
    $("suggested-match").hidden = true;
    render();
  }
  function action(fn) {
    if (!ensure()) return;
    try {
      const result = fn();
      if (result?.valid === false) {
        notice("Invalid / 無效: " + result.errors.join("; "));
        return;
      }
      sync();
      notice("Saved · 已套用");
    } catch (e) {
      notice(e.message);
    }
  }
  function selected() {
    return selection.length
      ? selection
      : state.selected
        ? [state.selected]
        : [];
  }
  $("select-cluster").onchange = () => {
    if (model) {
      selection = model.selection(state.selected, $("select-cluster").checked);
      render();
    }
  };
  $("edit-undo").onclick = () => action(() => model.undo());
  $("edit-redo").onclick = () => action(() => model.redo());
  for (const [id, angle] of [
    ["rotate90", 90],
    ["rotate180", 180],
    ["rotate-custom", null],
  ])
    $(id).onclick = () =>
      action(() =>
        model.commit(
          rotateSelection(
            state.parts,
            model.placements,
            selected(),
            angle ?? Number($("edit-angle").value),
          ),
        ),
      );
  $("edit-group").onclick = () => action(() => model.group(selected()));
  $("edit-detach").onclick = () =>
    action(() => {
      model.ungroup(selected());
      $("select-cluster").checked = false;
      selection = [state.selected];
    });
  $("edit-lock").onclick = () => action(() => model.lock(selected(), true));
  $("edit-unlock").onclick = () => action(() => model.lock(selected(), false));
  $("edit-reset").onclick = () => action(() => model.reset(selected()));
  $("cancel-snap-preview").onclick = () => {
    render();
    notice("");
  };
  $("preview-snap").onclick = () => {
    if (suggestion) preview(suggestion.placements, suggestion, []);
  };
  $("rotate-snap").onclick = () => {
    if (suggestion) action(() => model.commit(suggestion.placements));
  };
  $("refine-unlocked").onclick = () => {
    if (!ensure()) return;
    state.refineOnly = true;
    beginNest(true);
    activate("optimise");
    notice("Refining unlocked parts / 改善未鎖定零件");
  };
  $("magnetic-snap").onchange = () => {
    if ($("magnetic-snap").checked) {
      $("common-edge").checked = true;
      $("multi-part-clusters").checked = true;
      $("merge-common-lines").checked = true;
    }
    if (model) {
      model.settings = readSettings();
      delete model.settings.lockedPlacements;
    }
    render();
  };
  function point(e) {
    const p = new DOMPoint(e.clientX, e.clientY);
    return p.matrixTransform(canvas.getScreenCTM().inverse());
  }
  function view() {
    return canvas.getAttribute("viewBox").split(/\s+/).map(Number);
  }
  function zoom(f, e) {
    let [x, y, w, h] = view();
    if (w * f < 1 || w * f > 30000) return;
    const p = e ? point(e) : { x: x + w / 2, y: y + h / 2 };
    camera = [p.x - (p.x - x) * f, p.y - (p.y - y) * f, w * f, h * f];
    canvas.setAttribute("viewBox", camera.join(" "));
  }
  $("zoom-in").onclick = () => zoom(0.8);
  $("zoom-out").onclick = () => zoom(1.25);
  $("fit-sheet").onclick = () => {
    camera = null;
    render();
  };
  $("pan-mode").onclick = () => {
    panMode = !panMode;
    $("pan-mode").setAttribute("aria-pressed", String(panMode));
  };
  $("max-canvas").onclick = () => {
    document.body.classList.toggle("canvas-max");
    camera = null;
    render();
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.12 : 0.89, e);
    },
    { passive: false },
  );
  function preview(poses, snap, errors) {
    for (const t of poses) {
      const g = [...canvas.querySelectorAll("[data-part]")].find(
        (g) => g.dataset.part === t.id,
      );
      if (g)
        g.setAttribute(
          "transform",
          `translate(${t.x} ${t.y}) rotate(${t.angle}) scale(${(t.scale ?? 1) * (t.mirrored ? -1 : 1)} ${t.scale ?? 1})`,
        );
    }
    canvas.classList.toggle("invalid-preview", !!errors.length);
    canvas.querySelector(".snap-preview")?.remove();
    if (snap) {
      const line = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "line",
      );
      line.setAttribute("class", "snap-preview");
      for (const [k, v] of Object.entries({
        x1: snap.section.start.x,
        y1: snap.section.start.y,
        x2: snap.section.end.x,
        y2: snap.section.end.y,
      }))
        line.setAttribute(k, v);
      line.style.stroke = errors.length ? "#d83c43" : "#008a66";
      canvas.append(line);
    }
    notice(
      errors.length
        ? "Invalid · 無效: " + errors[0]
        : snap
          ? snap.kind === "sheet"
            ? "Sheet margin snap / 板材留邊吸附 · 放手套用"
            : `${snap.kind === "aligned-edge" ? "Aligned / 已齊口 · " : ""}Shared edge / 共邊 ${snap.sharedLength.toFixed(1)} mm · release to apply / 放手套用`
          : "Valid move · 合法移動",
    );
  }
  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const id = e.target.closest("[data-part]")?.dataset.part;
    if (space || panMode || e.button === 1 || !id) {
      gesture = { pan: true, start: point(e), camera: view() };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (stage !== "manual" || state.running) return;
    if (!model) return;
    if (e.shiftKey) {
      selection = selection.includes(id)
        ? selection.filter((x) => x !== id)
        : [...selection, id];
    } else if (!selection.includes(id))
      selection = model.selection(id, $("select-cluster").checked);
    state.selected = id;
    render();
    if (
      !selection.length ||
      selection.some((id) => model.data.locks.includes(id))
    ) {
      notice("Locked selection / 選擇已鎖定");
      return;
    }
    model.settings = readSettings();
    delete model.settings.lockedPlacements;
    if ($("magnetic-snap").checked) {
      $("common-edge").checked = true;
      $("multi-part-clusters").checked = true;
      $("merge-common-lines").checked = true;
      model.settings = readSettings();
      delete model.settings.lockedPlacements;
    }
    gesture = {
      start: point(e),
      initial: structuredClone(model.placements),
      ids: [...selection],
    };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!gesture) return;
    const p = point(e);
    if (gesture.pan) {
      const [x, y, w, h] = view();
      camera = [x + gesture.start.x - p.x, y + gesture.start.y - p.y, w, h];
      canvas.setAttribute("viewBox", camera.join(" "));
      return;
    }
    let poses = translateSelection(
        gesture.initial,
        gesture.ids,
        p.x - gesture.start.x,
        p.y - gesture.start.y,
      ),
      snap = null;
    const pixel = canvas.getScreenCTM(),
      radius = 10 / Math.max(0.01, Math.hypot(pixel.a, pixel.b));
    if ($("magnetic-snap").checked)
      snap = magneticSnap(state.parts, poses, gesture.ids, settings(), radius);
    if (snap) poses = snap.placements;
    else poses = rebuildContacts(state.parts, poses, settings());
    const errors = snap
      ? snap.errors
      : validateLayout(state.parts, poses, settings());
    draft = { placements: poses, valid: !errors.length, snap, errors };
    preview(poses, snap, errors);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!gesture) return;
    const pan = gesture.pan;
    gesture = null;
    if (canvas.hasPointerCapture(e.pointerId))
      canvas.releasePointerCapture(e.pointerId);
    if (pan) return;
    const last = draft;
    draft = null;
    canvas.classList.remove("invalid-preview");
    if (last?.valid) {
      const result = model.commit(last.placements);
      if (result.valid) sync();
      else render();
    } else render();
    if (last && !last.valid)
      notice(
        "Move rejected / 移動無效: " +
          (last.errors?.[0] || "位置不合法") +
          " · previous layout kept / 保留原位",
      );
    suggestion = rotationSuggestion(
      state.parts,
      model.placements,
      selected(),
      settings(),
      Math.min(30, 20 / Math.max(0.01, canvas.getScreenCTM().a)),
    );
    $("suggested-match").hidden = !suggestion;
    if (suggestion) {
      const angle = Math.abs(suggestion.angle),
        direction =
          angle === 180
            ? ""
            : suggestion.angle < 0
              ? " · anticlockwise / 逆時針"
              : " · clockwise / 順時針";
      $("suggested-details").textContent =
        `Rotation / 旋轉：${Number(angle.toFixed(1))}°${direction} · Shared edge / 共邊：${suggestion.sharedLength.toFixed(1)} mm`;
    }
  });
  canvas.addEventListener("pointercancel", () => {
    gesture = null;
    draft = null;
    canvas.classList.remove("invalid-preview");
    render();
  });
  canvas.addEventListener(
    "click",
    (e) => {
      if (stage === "manual") {
        e.stopPropagation();
      }
    },
    true,
  );
  canvas.addEventListener("contextmenu", (e) => {
    if (stage === "manual") {
      e.preventDefault();
      const id = e.target.closest("[data-part]")?.dataset.part;
      if (id) {
        state.selected = id;
        selection = model.selection(id, $("select-cluster").checked);
        document.body.classList.remove("settings-hidden");
        render();
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.code === "Space") {
      space = true;
      e.preventDefault();
    }
    if (
      stage === "manual" &&
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "z"
    ) {
      e.preventDefault();
      action(() => (e.shiftKey ? model.redo() : model.undo()));
    }
    if (e.key === "Escape") {
      gesture = null;
      draft = null;
      render();
    }
    if (
      stage === "manual" &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      action(() =>
        model.commit(
          translateSelection(
            model.placements,
            selected(),
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
          ),
        ),
      );
    }
  });
  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") space = false;
  });
  function afterRender() {
    nav.querySelectorAll("[data-stage]").forEach((b) => {
      b.setAttribute(
        "aria-current",
        b.dataset.stage === stage ? "step" : "false",
      );
      b.disabled =
        ["manual", "export"].includes(b.dataset.stage) &&
        !state.placements.length;
    });
    controls
      .querySelectorAll("[data-next]")
      .forEach(
        (b) =>
          (b.disabled =
            b.dataset.next !== "optimise" && !state.placements.length),
      );
    const key =
      state.view +
      ":" +
      state.sheet +
      ":" +
      readSettings().width +
      ":" +
      readSettings().height;
    if (key !== sheetKey) {
      camera = null;
      sheetKey = key;
    }
    if (camera) canvas.setAttribute("viewBox", camera.join(" "));
    if (!state.placements.length) {
      model = null;
      selection = [];
    }
    if (model) {
      for (const g of canvas.querySelectorAll("[data-part]")) {
        g.classList.toggle("selected", selection.includes(g.dataset.part));
        g.classList.toggle(
          "locked-part",
          model.data.locks.includes(g.dataset.part),
        );
      }
    }
    $("manual-selection").textContent =
      selected()
        .map((id) => state.parts.find((p) => p.id === id)?.name || id)
        .join(", ") || "Select a part / 選擇零件";
    $("edit-undo").disabled = !model?.past.length;
    $("edit-redo").disabled = !model?.future.length;
    const s = readSettings(),
      used = state.placements.reduce(
        (sum, t) =>
          sum +
          Math.abs(area(state.parts.find((p) => p.id === t.id).outer)) *
            (t.scale ?? 1) ** 2,
        0,
      ),
      sheets = new Set(state.placements.map((t) => t.sheet)).size;
    const cutting =
      state.metrics?.cutting ||
      (state.placements.length
        ? cuttingMetrics(state.parts, state.placements, s)
        : null);
    metrics.textContent = state.metrics
      ? `Area / 面積 ${((100 * used) / (s.width * s.height * Math.max(1, sheets))).toFixed(1)}% · Bounding / 佔用 ${state.metrics.score[3].toFixed(0)} mm² · Shared / 共邊 ${(cutting?.sharedLength || 0).toFixed(1)} mm · Cut / 切線 ${(cutting?.estimatedCutLength || 0).toFixed(1)} mm`
      : "";
    if (stage === "manual" && state.running)
      notice("Stop optimisation before editing / 請先停止運算再編輯");
  }
  const guidance = {
    setup: [
      "1 — Setup · 設定",
      "Import, check groups and set sheet / nesting rules. 匯入、核對零件，再設定板材及排料規則。",
    ],
    optimise: [
      "2 — Auto Nest · 自動排料",
      "Confirm the groups, then run Arrange parts. 確認零件歸屬，再按自動排料。",
    ],
    manual: [
      "3 — Manual Adjust · 手動微調",
      "Optional: move, snap and lock good areas. 可選：移位、吸附及鎖定理想位置。",
    ],
    export: [
      "4 — Review & Export · 檢查及匯出",
      "Choose a cutting strategy, review the preview, then download. 選擇切割方案、核對預覽，再下載。",
    ],
  };
  for (const [id, p] of Object.entries(panels)) {
    const intro = document.createElement("div");
    intro.className = "step-intro";
    intro.innerHTML = `<h2>${guidance[id][0]}</h2><p>${guidance[id][1]}</p>`;
    p.prepend(intro);
    const next = { setup: "optimise", optimise: "manual", manual: "export" }[
      id
    ];
    if (next) {
      const b = document.createElement("button");
      b.className = "step-next primary";
      b.dataset.next = next;
      b.textContent = {
        optimise: "Next: Auto Nest → 下一步排料",
        manual: "Next: Manual Adjust → 下一步微調",
        export: "Next: Review & Export → 下一步匯出",
      }[next];
      const [en, zh] = b.textContent.split(" → ");
      b.replaceChildren();
      for (const text of [en, zh + " →"]) {
        const span = document.createElement("span");
        span.textContent = text;
        b.append(span);
      }
      b.onclick = () => activate(next);
      p.append(b);
    }
  }
  activate("setup");
  return {
    afterRender,
    locked: () =>
      model
        ? model.placements.filter((t) => model.data.locks.includes(t.id))
        : [],
    reset: () => {
      model = null;
      selection = [];
      camera = null;
    },
    autoAccepted: (poses) => {
      if (model) {
        model.settings = readSettings();
        delete model.settings.lockedPlacements;
        model.commit(poses);
      }
    },
    prepareExport: () => {
      if (model) {
        state.placements = rebuildContacts(
          state.parts,
          state.placements,
          readSettings(),
        );
        model.data.placements = state.placements;
      }
    },
    isManual: () => stage === "manual",
  };
}
