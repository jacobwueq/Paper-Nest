// Preserve operation identity when cleanup is applied to fabrication output.
export const lineOperationKey = (e) =>
  JSON.stringify([
    e.layer || "0",
    e.color || null,
    e.dxfColor || null,
    e.layerColor || null,
    e.operation || null,
  ]);
// Output-only line arrangement: split at overlap events, retain each interval once.
// Input records and polygon topology are never mutated.
export function mergeCommonLines(lines, { tolerance = 1e-6 } = {}) {
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Invalid line tolerance");
  const groups = [];
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  for (const line of lines) {
    if (
      ![line.start?.x, line.start?.y, line.end?.x, line.end?.y].every(
        Number.isFinite,
      )
    )
      throw new Error("Invalid line coordinates");
    const len = distance(line.start, line.end);
    if (len === 0) continue;
    let start = line.start,
      end = line.end;
    if (start.x > end.x || (start.x === end.x && start.y > end.y))
      [start, end] = [end, start];
    const direction = {
      x: (end.x - start.x) / len,
      y: (end.y - start.y) / len,
    };
    let group = groups.find(
      (g) =>
        g.key === line.mergeKey &&
        Math.abs(g.u.x * direction.y - g.u.y * direction.x) <= 1e-10 &&
        [start, end].every(
          (p) =>
            Math.abs((p.x - g.origin.x) * g.u.y - (p.y - g.origin.y) * g.u.x) <=
            tolerance,
        ),
    );
    if (!group) {
      group = {
        key: line.mergeKey,
        origin: { ...start },
        u: direction,
        items: [],
      };
      groups.push(group);
    }
    const project = (p) =>
      (p.x - group.origin.x) * group.u.x + (p.y - group.origin.y) * group.u.y;
    const [lo, hi] = [project(start), project(end)].sort((a, b) => a - b);
    group.items.push({ lo, hi, line });
  }
  const result = [];
  for (const g of groups) {
    // Keep all distinct endpoints, even when close: tolerance must not erase a
    // short non-overlapping tail or bridge a gap.
    const events = [...new Set(g.items.flatMap((i) => [i.lo, i.hi]))].sort(
      (a, b) => a - b,
    );
    const point = (t) => ({
      x: g.origin.x + g.u.x * t,
      y: g.origin.y + g.u.y * t,
    });
    for (let i = 1; i < events.length; i++) {
      const lo = events[i - 1],
        hi = events[i],
        mid = (lo + hi) / 2;
      const owners = g.items.filter((s) => s.lo <= mid && s.hi >= mid);
      if (!owners.length || hi <= lo) continue;
      result.push({
        ...owners[0].line,
        start: point(lo),
        end: point(hi),
        sources: owners.map((o) => o.line),
        owners: [
          ...new Set(
            owners.flatMap(
              (o) =>
                o.line.owners ||
                (o.line.owner === undefined ? [] : [o.line.owner]),
            ),
          ),
        ],
        role:
          owners.length > 1
            ? "common-cut"
            : owners[0].line.role || "part-boundary",
        shared: owners.length > 1,
      });
    }
  }
  return result;
}
export const lineLength = (s) =>
  Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
