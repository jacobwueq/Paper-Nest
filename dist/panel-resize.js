// Presentation only: preferred widths survive reload; current widths fit the viewport.
export function fitPanelWidths(
  width,
  left,
  right,
  showLeft = true,
  showRight = true,
) {
  const budget = Math.max(0, width - Math.max(400, width * 0.44));
  let l = showLeft ? Math.max(220, Math.min(440, left)) : 0;
  let r = showRight ? Math.max(280, Math.min(520, right)) : 0;
  const excess = Math.max(0, l + r - budget),
    room = Math.max(0, l - 220) + Math.max(0, r - 280);
  if (excess && room) {
    l -= (excess * Math.max(0, l - 220)) / room;
    r -= (excess * Math.max(0, r - 280)) / room;
  }
  return { left: l, right: r };
}
export function installPanelResize() {
  const workspace = document.querySelector(".workspace");
  let preferred = { left: 280, right: 340 };
  try {
    const saved = JSON.parse(localStorage.getItem("paper-nest-panel-widths"));
    for (const side of ["left", "right"])
      if (Number.isFinite(saved?.[side])) preferred[side] = saved[side];
  } catch {}
  const handles = {};
  const persist = () => {
    try {
      localStorage.setItem(
        "paper-nest-panel-widths",
        JSON.stringify(preferred),
      );
    } catch {}
  };
  const physicalSide = (side) =>
    document.body.dataset.stage === "export"
      ? side === "left"
        ? "right"
        : "left"
      : side;
  function update() {
    const desktop = window.innerWidth >= 1100,
      body = document.body;
    const left =
      !body.classList.contains("settings-hidden") &&
      !body.classList.contains("canvas-max");
    const right =
      body.dataset.stage === "export" &&
      !body.classList.contains("review-collapsed") &&
      !body.classList.contains("canvas-max");
    const controls = workspace.querySelector(".controls"),
      drawing = workspace.querySelector(".drawing-area"),
      review = workspace.querySelector(".review-panel");
    for (const el of [controls, drawing, review])
      el.style.removeProperty("grid-column");
    if (!desktop) {
      workspace.style.removeProperty("grid-template-columns");
      Object.values(handles).forEach((h) => (h.hidden = true));
      return;
    }
    const widths = fitPanelWidths(
      workspace.clientWidth,
      preferred.left,
      preferred.right,
      left,
      right,
    );
    const exportStage = body.dataset.stage === "export";
    const columns = [
      ...(left ? [`${widths.left}px`] : []),
      "minmax(0,1fr)",
      ...(right ? [`${widths.right}px`] : []),
    ];
    workspace.style.gridTemplateColumns = (
      exportStage ? columns.reverse() : columns
    ).join(" ");
    if (exportStage) {
      review.style.gridColumn = "1";
      drawing.style.gridColumn = right ? "2" : "1";
      controls.style.gridColumn = String((right ? 1 : 0) + 2);
    }
    for (const side of ["left", "right"]) {
      const h = handles[side];
      h.hidden = side === "left" ? !left : !right;
      h.style.left = h.style.right = "";
      h.style[physicalSide(side)] = `${widths[side] - 4}px`;
      h.setAttribute("aria-valuenow", String(Math.round(widths[side])));
    }
  }
  for (const side of ["left", "right"]) {
    const h = document.createElement("div");
    h.className = `panel-divider ${side}`;
    h.tabIndex = 0;
    h.setAttribute("role", "separator");
    h.setAttribute("aria-orientation", "vertical");
    h.setAttribute(
      "aria-label",
      `${side === "left" ? "Settings panel width / 設定欄寬度" : "Review panel width / 檢視欄寬度"}`,
    );
    h.setAttribute("aria-valuemin", side === "left" ? "220" : "280");
    h.setAttribute("aria-valuemax", side === "left" ? "440" : "520");
    h.title = "Drag to resize; double-click to reset / 拖動調整；雙擊還原";
    handles[side] = h;
    workspace.append(h);
    let drag = null;
    h.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag = { x: e.clientX, width: Number(h.getAttribute("aria-valuenow")) };
      h.setPointerCapture(e.pointerId);
      document.body.classList.add("resizing-panels");
    };
    h.onpointermove = (e) => {
      if (!drag) return;
      preferred[side] = Math.max(
        side === "left" ? 220 : 280,
        Math.min(
          side === "left" ? 440 : 520,
          drag.width +
            (e.clientX - drag.x) * (physicalSide(side) === "left" ? 1 : -1),
        ),
      );
      update();
    };
    const end = () => {
      drag = null;
      document.body.classList.remove("resizing-panels");
      persist();
    };
    h.onpointerup = end;
    h.onpointercancel = end;
    h.onlostpointercapture = end;
    h.ondblclick = () => {
      preferred[side] = side === "left" ? 280 : 340;
      persist();
      update();
    };
    h.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(e.key)) return;
      e.preventDefault();
      preferred[side] =
        e.key === "Home"
          ? side === "left"
            ? 280
            : 340
          : Number(h.getAttribute("aria-valuenow")) +
            (e.key === "ArrowRight" ? 10 : -10) *
              (physicalSide(side) === "left" ? 1 : -1);
      persist();
      update();
    };
  }
  new ResizeObserver(update).observe(workspace);
  new MutationObserver(update).observe(document.body, {
    attributes: true,
    attributeFilter: ["class", "data-stage"],
  });
  window.addEventListener("resize", update);
  update();
}
