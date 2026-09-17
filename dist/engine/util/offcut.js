// Shared by the UI and worker: conservative clear rectangles, in millimetres.
// Row bands include every intersecting edge, not just cell centres, so a thin
// or diagonal contour can never disappear between samples. Concave row spans
// are conservatively filled; holes are not counted as recoverable offcuts.
(function (root) {
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
  function edgeRectangle(b, sheet, padding = 0, minSide = 0) {
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
    return rectangles
      .filter((r) => Math.min(r.w, r.h) >= minSide)
      .reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a), { x, y, w: 0, h: 0 });
  }
  function analyse(
    polygons,
    sheet,
    padding = 0,
    minSide = 0,
    findPair = false,
  ) {
    var x = sheet.x || 0,
      y = sheet.y || 0;
    if (!polygons.length)
      return {
        rectangle: { x, y, w: sheet.w, h: sheet.h, area: sheet.w * sheet.h },
        occupiedArea: 0,
      };
    var all = bounds(polygons.flat());
    var best = edgeRectangle(all, sheet, padding, minSide);
    // At most 256 cells along the longest edge. Exact full-width/full-height
    // strips are also tested above, avoiding grid rounding for common offcuts.
    var step = Math.max(sheet.w, sheet.h) / 256;
    var cols = Math.max(1, Math.ceil(sheet.w / step));
    var rows = Math.max(1, Math.ceil(sheet.h / step));
    var dx = sheet.w / cols,
      dy = sheet.h / rows;
    var occupied = new Uint8Array(cols * rows);
    for (var poly of polygons) {
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
    var heights = new Uint16Array(cols);
    for (var row = 0; row < rows; row++) {
      var stack = [];
      for (var col = 0; col <= cols; col++) {
        var height =
          col === cols ? 0 : occupied[row * cols + col] ? 0 : heights[col] + 1;
        if (col < cols) heights[col] = height;
        var start = col;
        while (stack.length && stack[stack.length - 1].height > height) {
          var previous = stack.pop();
          start = previous.start;
          var w = (col - start) * dx,
            h = previous.height * dy;
          if (
            Math.min(w, h) + 1e-8 >= minSide &&
            (w * h > best.w * best.h + 1e-6 ||
              (Math.abs(w * h - best.w * best.h) < 1e-6 &&
                Math.min(w, h) > Math.min(best.w, best.h)))
          )
            best = {
              x: x + start * dx,
              y: y + (row + 1 - previous.height) * dy,
              w,
              h,
            };
        }
        if (!stack.length || stack[stack.length - 1].height < height)
          stack.push({ start, height });
      }
    }
    return {
      pair: findPair
        ? gridPair(occupied, cols, rows, dx, dy, x, y, padding, minSide)
        : [],
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
  // Two disjoint axis-aligned rectangles are separated by a horizontal or
  // vertical line. Prefix/suffix histogram maxima test every grid separation;
  // choosing the largest rectangle first would miss better combined pairs.
  function gridPair(occupied, cols, rows, dx, dy, x, y, padding, minSide) {
    function sweep(transpose, reverse) {
      const width = transpose ? rows : cols,
        height = transpose ? cols : rows;
      const cw = transpose ? dy : dx,
        ch = transpose ? dx : dy;
      const heights = new Uint16Array(width),
        prefix = [];
      let best = null;
      for (let row = 0; row < height; row++) {
        const actual = reverse ? height - 1 - row : row,
          stack = [];
        for (let col = 0; col <= width; col++) {
          const cell = transpose ? col * cols + actual : actual * cols + col;
          const h = col === width ? 0 : occupied[cell] ? 0 : heights[col] + 1;
          if (col < width) heights[col] = h;
          let start = col;
          while (stack.length && stack[stack.length - 1].height > h) {
            const prev = stack.pop();
            start = prev.start;
            const w = (col - start) * cw,
              hh = prev.height * ch,
              area = w * hh;
            if (
              Math.min(w, hh) + 1e-8 >= minSide &&
              (!best || area > best.area)
            ) {
              const r0 = reverse ? height - 1 - row : row + 1 - prev.height;
              best = transpose
                ? { x: x + r0 * dx, y: y + start * dy, w: hh, h: w, area }
                : { x: x + start * dx, y: y + r0 * dy, w, h: hh, area };
            }
          }
          if (!stack.length || stack[stack.length - 1].height < h)
            stack.push({ start, height: h });
        }
        prefix[row] = best;
      }
      return prefix;
    }
    let best = [];
    const total = (rs) => rs.reduce((sum, r) => sum + r.area, 0);
    function consider(rs) {
      rs = rs.filter(Boolean).sort((a, b) => b.area - a.area);
      if (
        total(rs) > total(best) + 1e-6 ||
        (Math.abs(total(rs) - total(best)) < 1e-6 &&
          (rs[0]?.area || 0) > (best[0]?.area || 0))
      )
        best = rs;
    }
    for (const transpose of [false, true]) {
      const n = transpose ? cols : rows,
        unit = transpose ? dx : dy;
      const forward = sweep(transpose, false),
        backward = sweep(transpose, true);
      consider([forward[n - 1]]);
      const gap = Math.ceil(padding / unit);
      for (let i = 0; i < n; i++) {
        const remaining = n - i - gap - 2;
        if (remaining >= 0) consider([forward[i], backward[remaining]]);
      }
    }
    return best;
  }
  function collect(polygons, sheet, padding = 0, minSide = 20) {
    const first = analyse(polygons, sheet, padding, minSide, true);
    let rectangles = first.pair || [];
    const r = first.rectangle;
    // Also preserve exact (non-grid-rounded) edge-strip solutions.
    if (r.area > 1e-6 && Math.min(r.w, r.h) + 1e-8 >= minSide) {
      const blocked = [
        ...polygons,
        [
          { x: r.x, y: r.y },
          { x: r.x + r.w, y: r.y },
          { x: r.x + r.w, y: r.y + r.h },
          { x: r.x, y: r.y + r.h },
        ],
      ];
      const second = analyse(blocked, sheet, padding, minSide).rectangle;
      const greedy = [r, ...(second.area > 1e-6 ? [second] : [])].sort(
        (a, b) => b.area - a.area,
      );
      const sum = (rs) => rs.reduce((n, r) => n + r.area, 0);
      if (
        sum(greedy) > sum(rectangles) + 1e-6 ||
        (Math.abs(sum(greedy) - sum(rectangles)) < 1e-6 &&
          r.area > (rectangles[0]?.area || 0))
      )
        rectangles = greedy;
    }
    const recoveredArea = rectangles.reduce((sum, r) => sum + r.area, 0);
    return {
      ...first,
      rectangle: rectangles[0] || {
        x: sheet.x || 0,
        y: sheet.y || 0,
        w: 0,
        h: 0,
        area: 0,
      },
      rectangles,
      recoveredArea,
    };
  }
  function score(unplaced, reports) {
    return [
      unplaced,
      reports.length,
      -reports.reduce((s, r) => s + (r.recoveredArea ?? r.rectangle.area), 0),
      -Math.max(0, ...reports.map((r) => r.rectangle.area)),
      reports.reduce((s, r) => s + r.occupiedArea, 0),
      reports.reduce((s, r) => s + (r.compactness || 0), 0),
    ];
  }
  function compare(a, b) {
    for (var i = 0; i < a.length; i++)
      if (Math.abs(a[i] - b[i]) > (i < 2 ? 0 : 1e-5))
        return a[i] < b[i] ? -1 : 1;
    return 0;
  }
  root.PaperOffcut = {
    analyse,
    collect,
    score,
    compare,
    bounds,
    edgeRectangle,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
