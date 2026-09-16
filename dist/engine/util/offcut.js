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
  function edgeRectangle(b, sheet, padding = 0) {
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
    return rectangles.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  }
  function analyse(polygons, sheet, padding = 0) {
    var x = sheet.x || 0,
      y = sheet.y || 0;
    if (!polygons.length)
      return {
        rectangle: { x, y, w: sheet.w, h: sheet.h, area: sheet.w * sheet.h },
        occupiedArea: 0,
      };
    var all = bounds(polygons.flat());
    var best = edgeRectangle(all, sheet, padding);
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
            w * h > best.w * best.h + 1e-6 ||
            (Math.abs(w * h - best.w * best.h) < 1e-6 &&
              Math.min(w, h) > Math.min(best.w, best.h))
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
      rectangle: { ...best, area: best.w * best.h },
      occupiedArea: all.w * all.h,
    };
  }
  function score(unplaced, reports) {
    var areas = reports.map((s) => s.rectangle.area);
    return [
      unplaced,
      reports.length,
      -Math.max(0, ...areas),
      -areas.reduce((s, a) => s + a, 0),
      reports.reduce((s, r) => s + r.occupiedArea, 0),
    ];
  }
  function compare(a, b) {
    for (var i = 0; i < a.length; i++)
      if (Math.abs(a[i] - b[i]) > (i < 2 ? 0 : 1e-5))
        return a[i] < b[i] ? -1 : 1;
    return 0;
  }
  root.PaperOffcut = { analyse, score, compare, bounds, edgeRectangle };
})(typeof globalThis !== "undefined" ? globalThis : self);
