// Isolated engine context: only collision contours enter SVGNest.
// Original entities stay in the parent; no engine-generated drawing is exported.
window.addEventListener("message", (event) => {
  if (
    event.source !== parent ||
    event.origin !== location.origin ||
    event.data.type !== "start"
  )
    return;
  const { parts, settings, run, seed = [] } = event.data;
  const offsets = new Map();
  let x = settings.width + 1000;
  const body = parts
    .map((p) => {
      offsets.set(p.id, x);
      const points = p.outer.map((v) => `${v.x + x},${v.y}`).join(" ");
      x += Math.max(...p.outer.map((v) => v.x)) + 1000;
      return `<polygon id="${p.id}" points="${points}"/>`;
    })
    .join("");
  const margin = settings.margin;
  const safety = 0.06;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><rect id="sheet" x="0" y="0" width="${settings.width - 2 * margin}" height="${settings.height - 2 * margin}"/>${body}</svg>`;
  const send = (type, data = {}) =>
    parent.postMessage({ type, run, ...data }, location.origin);
  try {
    SvgNest.config({
      spacing: settings.gap + safety,
      rotations: settings.rotations,
      seed,
      refine: settings.rotations >= 72,
      curveTolerance: 0.005,
      populationSize: 8,
      mutationRate: 15,
      useHoles: false,
      exploreConcave: true,
    });
    const parsed = SvgNest.parsesvg(svg);
    SvgNest.setbin(parsed.querySelector("#sheet"));
    SvgNest.start(
      (p) => send("progress", { progress: p }),
      (sheets) => {
        if (!sheets) return;
        const placements = [];
        sheets.forEach((sheet, index) => {
          for (const g of sheet.children) {
            if (g.tagName.toLowerCase() !== "g") continue;
            const shape = g.querySelector("polygon[id]");
            if (!shape) continue;
            const id = shape.id;
            const m = g.transform.baseVal.consolidate().matrix;
            const offset = offsets.get(id);
            const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI;
            // SVGNest normalises the inset bin to its own origin. Add the physical sheet margin.
            placements.push({
              id,
              x: m.e + offset * m.a + margin,
              y: m.f + offset * m.b + margin,
              angle,
              sheet: index,
            });
          }
        });
        send("layout", { placements });
      },
    );
  } catch (error) {
    send("error", { message: error.message });
  }
});
window.addEventListener("error", (e) =>
  parent.postMessage(
    { type: "engine-error", message: e.message },
    location.origin,
  ),
);
parent.postMessage({ type: "ready" }, location.origin);
