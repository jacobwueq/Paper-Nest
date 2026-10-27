// Shared by the UI and worker: conservative clear rectangles, in millimetres.
// Row bands include every intersecting edge, not just cell centres, so a thin
// or diagonal contour can never disappear between samples. Concave row spans
// are conservatively filled; holes are not counted as recoverable offcuts.
(function (root) {
  // Bounded area discount: 4wh/(w+h)^2 is 1 for a square and tends to 0
  // for a thin strip. Monotone in each side: trimming a rectangle cannot game it.
  function utility(r, weight = 0) {
    const a = r.w * r.h,
      sum = r.w + r.h;
    if (!Number.isFinite(weight) || weight < 0 || weight > 0.5)
      throw new Error("Invalid offcut shape weight");
    return weight === 0
      ? (r.area ?? a)
      : sum > 0
        ? a * (1 - weight + (weight * 4 * a) / (sum * sum))
        : 0;
  }
  function bounds(points) {
    var x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (var p of points) {
      x = Math.min(x, p.x);
      y = Math.min(y, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
    return { x, y, w: right - x, h: bottom - y };
  }
  function edgeRectangles(b, sheet, padding = 0, minSide = 0) {
    var x = sheet.x || 0,
      y = sheet.y || 0;
    var right = x + sheet.w,
      bottom = y + sheet.h;
    var rectangles = [
      { x, y, w: Math.max(0, b.x - padding - x), h: sheet.h },
      {
        x: Math.min(right, b.x + b.w + padding),
        y,
        w: Math.max(0, right - b.x - b.w - padding),
        h: sheet.h,
      },
      { x, y, w: sheet.w, h: Math.max(0, b.y - padding - y) },
      {
        x,
        y: Math.min(bottom, b.y + b.h + padding),
        w: sheet.w,
        h: Math.max(0, bottom - b.y - b.h - padding),
      },
    ];
    return rectangles.filter(
      (r) => r.w > 0 && r.h > 0 && Math.min(r.w, r.h) >= minSide,
    );
  }
  function edgeRectangle(b, sheet, padding = 0, minSide = 0) {
    return edgeRectangles(b, sheet, padding, minSide).reduce(
      (a, b) => (b.w * b.h > a.w * a.h ? b : a),
      { x: sheet.x || 0, y: sheet.y || 0, w: 0, h: 0 },
    );
  }
  function analyse(
    polygons,
    sheet,
    padding = 0,
    minSide = 0,
    findAlternatives = false,
    context = null,
  ) {
    context?.count?.("offcutAnalyses");
    var x = sheet.x || 0,
      y = sheet.y || 0;
    if (!polygons.length)
      return {
        rectangle: { x, y, w: sheet.w, h: sheet.h, area: sheet.w * sheet.h },
        alternatives: [
          { x, y, w: sheet.w, h: sheet.h, area: sheet.w * sheet.h },
        ],
        occupiedArea: 0,
      };
    var all = bounds(polygons.flat());
    var best = { x, y, w: 0, h: 0 },
      alternatives = new Map();
    function offer(r) {
      const area = r.w * r.h;
      if (area <= 1e-6 || Math.min(r.w, r.h) + 1e-8 < minSide) return;
      const value = utility(r, context?.shapeWeight || 0),
        bestValue = utility(best, context?.shapeWeight || 0);
      if (value > bestValue + 1e-6) {
        best = r;
        alternatives.clear();
      }
      if (Math.abs(value - utility(best, context?.shapeWeight || 0)) < 1e-6) {
        if (Math.min(r.w, r.h) > Math.min(best.w, best.h)) best = r;
        if (findAlternatives)
          alternatives.set(
            [r.x, r.y, r.w, r.h].map((v) => v.toFixed(7)).join(","),
            { ...r, area },
          );
      }
    }
    for (const r of edgeRectangles(all, sheet, padding, minSide)) offer(r);
    // At most 256 cells along the longest edge. Exact full-width/full-height
    // strips are also tested above, avoiding grid rounding for common offcuts.
    var step = Math.max(sheet.w, sheet.h) / 256;
    var cols = Math.max(1, Math.ceil(sheet.w / step));
    var rows = Math.max(1, Math.ceil(sheet.h / step));
    var dx = sheet.w / cols,
      dy = sheet.h / rows;
    // This context belongs to one collect() call: sheet and padding are fixed.
    // Original parts never change while additional offcuts are marked occupied.
    var reuse = !!context?.baseMask;
    var occupied = reuse
      ? context.baseMask.slice()
      : new Uint8Array(cols * rows);
    context?.count?.(
      reuse ? "offcutBaseRasterReuses" : "offcutBaseRasterBuilds",
    );
    for (var poly of reuse ? polygons.slice(context.baseCount) : polygons) {
      context?.count?.("offcutRasterisedPolygons");
      var b = bounds(poly);
      var first = Math.max(0, Math.floor((b.y - padding - y) / dy));
      var last = Math.min(rows - 1, Math.floor((b.y + b.h + padding - y) / dy));
      for (var row = first; row <= last; row++) {
        var low = y + row * dy - padding,
          high = y + (row + 1) * dy + padding;
        var left = Infinity,
          right = -Infinity;
        for (var i = 0; i < poly.length; i++) {
          var a = poly[i],
            c = poly[(i + 1) % poly.length];
          if (Math.max(a.y, c.y) < low || Math.min(a.y, c.y) > high) continue;
          if (Math.abs(a.y - c.y) < 1e-12) {
            left = Math.min(left, a.x, c.x);
            right = Math.max(right, a.x, c.x);
          } else {
            var t0 = Math.max(
              0,
              Math.min((low - a.y) / (c.y - a.y), (high - a.y) / (c.y - a.y)),
            );
            var t1 = Math.min(
              1,
              Math.max((low - a.y) / (c.y - a.y), (high - a.y) / (c.y - a.y)),
            );
            if (t0 > t1) continue;
            var u = a.x + t0 * (c.x - a.x),
              v = a.x + t1 * (c.x - a.x);
            left = Math.min(left, u, v);
            right = Math.max(right, u, v);
          }
        }
        if (!Number.isFinite(left)) continue;
        var begin = Math.max(0, Math.floor((left - padding - x) / dx));
        var end = Math.min(cols - 1, Math.floor((right + padding - x) / dx));
        occupied.fill(1, row * cols + begin, row * cols + end + 1);
      }
    }
    if (context && !reuse && polygons.length === context.baseCount)
      context.baseMask = occupied.slice();
    var heights = new Uint16Array(cols),
      stackStarts = new Uint16Array(cols + 1),
      stackHeights = new Uint16Array(cols + 1);
    for (var row = 0; row < rows; row++) {
      var stackLength = 0;
      for (var col = 0; col <= cols; col++) {
        var height =
          col === cols ? 0 : occupied[row * cols + col] ? 0 : heights[col] + 1;
        if (col < cols) heights[col] = height;
        var start = col;
        while (stackLength && stackHeights[stackLength - 1] > height) {
          stackLength--;
          var previousHeight = stackHeights[stackLength];
          start = stackStarts[stackLength];
          var w = (col - start) * dx,
            h = previousHeight * dy;
          // An inferior rectangle cannot affect offer(). Avoid allocating it.
          if (w * h >= utility(best, context?.shapeWeight || 0) - 1e-6)
            offer({
              x: x + start * dx,
              y: y + (row + 1 - previousHeight) * dy,
              w,
              h,
            });
        }
        if (!stackLength || stackHeights[stackLength - 1] < height) {
          stackStarts[stackLength] = start;
          stackHeights[stackLength++] = height;
        }
      }
    }
    return {
      alternatives: [...alternatives.values()],
      rectangle: { ...best, area: best.w * best.h },
      occupiedArea: all.w * all.h,
      compactness: polygons.reduce((sum, p) => {
        const b = bounds(p);
        return (
          sum + (b.x + b.w / 2 - all.x) ** 2 + (b.y + b.h / 2 - all.y) ** 2
        );
      }, 0),
    };
  }
  function compareAreas(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const delta = (a[i] || 0) - (b[i] || 0);
      if (Math.abs(delta) > 1e-5) return delta > 0 ? -1 : 1;
    }
    return 0;
  }
  const points = (r) => [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  // The analysis grid for a sheet (same arithmetic as analyse).
  function grid(sheet) {
    var step = Math.max(sheet.w, sheet.h) / 256;
    var cols = Math.max(1, Math.ceil(sheet.w / step)), rows = Math.max(1, Math.ceil(sheet.h / step));
    return { x: sheet.x || 0, y: sheet.y || 0, cols, rows, dx: sheet.w / cols, dy: sheet.h / rows };
  }
  // Cells a rectangle covers when rasterised as a blocked polygon (with padding),
  // exactly as analyse's row/column arithmetic does for an axis-aligned rectangle.
  function blockedCells(r, g, padding) {
    return {
      top: Math.max(0, Math.floor((r.y - padding - g.y) / g.dy)),
      bottom: Math.min(g.rows - 1, Math.floor((r.y + r.h + padding - g.y) / g.dy)),
      left: Math.max(0, Math.floor((r.x - padding - g.x) / g.dx)),
      right: Math.min(g.cols - 1, Math.floor((r.x + r.w + padding - g.x) / g.dx)),
    };
  }
  // Cells of a free rectangle produced by the histogram (whole cells).
  function freeCells(r, g) {
    var left = Math.round((r.x - g.x) / g.dx), top = Math.round((r.y - g.y) / g.dy);
    return { top, bottom: top + Math.round(r.h / g.dy) - 1, left, right: left + Math.round(r.w / g.dx) - 1 };
  }
  function keptAlternatives(parent, added, sheet, padding) {
    if (!parent || !parent.alternatives || parent.alternatives.length < 2) return null;
    var g = grid(sheet), b = blockedCells(added, g, padding);
    var kept = parent.alternatives.filter((r) => {
      var c = freeCells(r, g);
      return c.right < b.left || c.left > b.right || c.bottom < b.top || c.top > b.bottom;
    });
    if (!kept.length) return null;
    // analyse's tie rule: the first rectangle, replaced only by a later one with a
    // strictly longer short side.
    var best = kept[0];
    for (var r of kept) if (Math.min(r.w, r.h) > Math.min(best.w, best.h)) best = r;
    return { alternatives: kept, rectangle: { ...best, area: best.w * best.h } };
  }
  function collect(polygons, sheet, padding = 0, minSide = 20, options = {}) {
    const context = {
      baseCount: polygons.length,
      count: options.count,
      shapeWeight: options.shapeWeight || 0,
    };
    const first = analyse(polygons, sheet, padding, minSide, true, context);
    // Keep alternative equal-largest placements alive, comparing their next
    // rectangles before pruning. Bounds apply to search alternatives, never to
    // the number of recovered rectangles. The grid itself is conservative.
    let beam = [
      { rectangles: [], blocked: polygons, next: first, done: false },
    ];
    while (beam.some((s) => !s.done)) {
      let next = [];
      for (const state of beam) {
        if (state.done) {
          next.push(state);
          continue;
        }
        const choices = state.next.alternatives.filter(
          (r) => r.area > 1e-6 && Math.min(r.w, r.h) + 1e-8 >= minSide,
        );
        if (!choices.length) {
          next.push({ ...state, done: true });
          continue;
        }
        // Spatially spread the retained ties if a drawing produces many equal
        // maxima. This bounded look-ahead is not a global optimality proof.
        const retained =
          choices.length <= 32
            ? choices
            : Array.from(
                { length: 32 },
                (_, i) => choices[Math.floor((i * (choices.length - 1)) / 31)],
              );
        for (const r of retained) {
          const blocked = [...state.blocked, points(r)];
          next.push({
            rectangles: [...state.rectangles, r],
            blocked,
            next: null,
            parent: state.next,
            added: r,
            done: false,
          });
        }
      }
      const seen = new Set();
      next = next.filter((s) => {
        const key = s.rectangles
          .map((r) => [r.x, r.y, r.w, r.h].map((v) => v.toFixed(7)).join(","))
          .sort()
          .join(";");
        if (seen.has(key)) {
          context.count?.("offcutDuplicateStatesAvoided");
          return false;
        }
        seen.add(key);
        return true;
      });
      // Same first-wins deduplication as before, before the expensive analysis.
      for (const state of next)
        if (!state.next) {
          // Roadmap 3.6: adding rectangle r only removes free space. If an
          // equal-best rectangle of the parent stays clear of r's cells, the best
          // value cannot change and the child's equal-best set is exactly the
          // parent's minus those that touch r; no new grid pass is needed.
          const kept = keptAlternatives(state.parent, state.added, sheet, padding);
          state.next = kept
            ? (context.count?.("offcutAnalysesSkipped"), kept)
            : analyse(state.blocked, sheet, padding, minSide, true, context);
          if (kept && options.verifyShortcut) {
            const full = analyse(state.blocked, sheet, padding, minSide, true, { ...context, count: null });
            const key = (r) => [r.x, r.y, r.w, r.h].map((v) => v.toFixed(7)).join(",");
            if (key(full.rectangle) !== key(kept.rectangle) || full.alternatives.map(key).join(";") !== kept.alternatives.map(key).join(";"))
              throw new Error("offcut shortcut mismatch");
          }
          state.parent = null;
        }
      const ranked = (s) => [
        ...s.rectangles.map((r) => utility(r, context.shapeWeight)),
        ...(s.done ? [] : [utility(s.next.rectangle, context.shapeWeight)]),
      ];
      next.sort((a, b) => compareAreas(ranked(a), ranked(b)));
      // A smaller prefix can never beat a larger one, however many small
      // offcuts follow. Keep only tied prefixes, with eight continuations.
      const winning = ranked(next[0]);
      beam = next
        .filter((s) => compareAreas(ranked(s), winning) === 0)
        .slice(0, 8);
    }
    const rectangles = beam[0].rectangles;
    return {
      ...first,
      alternatives: undefined,
      rectangle: rectangles[0] || {
        x: sheet.x || 0,
        y: sheet.y || 0,
        w: 0,
        h: 0,
        area: 0,
      },
      rectangles,
      recoveredArea: rectangles.reduce((sum, r) => sum + r.area, 0),
    };
  }
  function score(unplaced, reports, shapeWeight = 0) {
    const areas = reports
      .flatMap((r) =>
        (r.rectangles || [r.rectangle]).map((q) => utility(q, shapeWeight)),
      )
      .filter((a) => a > 1e-6)
      .sort((a, b) => b - a);
    return [
      unplaced,
      reports.length,
      areas,
      reports.reduce((s, r) => s + r.occupiedArea, 0),
      reports.reduce((s, r) => s + (r.compactness || 0), 0),
    ];
  }
  function compare(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (Array.isArray(a[i]) || Array.isArray(b[i])) {
        const result = compareAreas(a[i] || [], b[i] || []);
        if (result) return result;
      } else {
        const delta = (a[i] || 0) - (b[i] || 0);
        if (Math.abs(delta) > (i < 2 ? 0 : 1e-5)) return delta < 0 ? -1 : 1;
      }
    }
    return 0;
  }
  root.PaperOffcut = {
    utility,
    analyse,
    collect,
    score,
    compare,
    bounds,
    edgeRectangle,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
