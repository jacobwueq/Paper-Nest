// Re-slice a fixed layout so aligned part edges can share one full-workpiece cut.
// A bounded memoised search always retains the original valid slicing tree.
const EPS = 1e-7;
const close = (a, b) => Math.abs(a - b) <= EPS;
const key = (r) => [r.x, r.y, r.w, r.h].map((n) => n.toFixed(7)).join(',');
const rectangle = ({ x, y, w, h }) => ({ x, y, w, h });
function copy(node) {
  const result = { ...node };
  if (node.first) result.first = copy(node.first);
  if (node.second) result.second = copy(node.second);
  return result;
}
function compare(a, b) {
  if (a.count !== b.count) return a.count - b.count;
  for (let i = 0; i < Math.max(a.offcuts.length, b.offcuts.length); i++) {
    const difference = (b.offcuts[i] || 0) - (a.offcuts[i] || 0);
    if (Math.abs(difference) > EPS) return difference;
  }
  return a.length - b.length;
}
function result(node, first, second) {
  if (node.kind !== 'cut') return { node, count: 0, length: 0, offcuts: node.kind === 'free' && Math.min(node.w, node.h) >= 50 - EPS ? [node.w * node.h] : [] };
  return { node, count: 1 + first.count + (second?.count || 0), length: (node.axis === 'x' ? node.h : node.w) + first.length + (second?.length || 0), offcuts: [...first.offcuts, ...(second?.offcuts || [])].sort((a, b) => b - a) };
}
export function simplifyTimberCuts(root, kerf, { direction = 'auto', maxStates = 900 } = {}) {
  const originals = new Map(), memo = new Map(), parts = [];
  const index = (node) => {
    if (node.kind === 'part') parts.push(node.part);
    const entry = result(node, node.first && index(node.first), node.second && index(node.second));
    originals.set(key(node), entry); return entry;
  };
  const baseline = index(root);
  if (baseline.count <= Math.max(0, parts.length - 1)) return { root: copy(root), before: baseline.count, after: baseline.count };
  let states = 0;
  function solve(region, inside, isRoot = false) {
    if (!inside.length) return result({ ...region, kind: 'free' });
    if (inside.length === 1) {
      const p = inside[0];
      if (close(p.x, region.x) && close(p.y, region.y) && close(p.w, region.w) && close(p.h, region.h)) return result({ ...region, kind: 'part', part: p });
    }
    const id = key(region);
    if (memo.has(id)) return memo.get(id);
    let best = originals.get(id) || null;
    if (++states > maxStates) return best;
    const choices = [];
    for (const axis of ['x', 'y']) {
      // Explicit rip/cross preferences still determine the first stock cut.
      if (isRoot && direction !== 'auto' && root.kind === 'cut' && axis !== root.axis) continue;
      const size = axis === 'x' ? 'w' : 'h', start = region[axis], end = start + region[size];
      const positions = new Set(inside.flatMap((p) => [p[axis] + p[size], p[axis] - kerf]));
      for (const position of positions) {
        if (position <= start + EPS || position >= end - EPS) continue;
        const consumed = Math.min(kerf, end - position), first = [], second = [];
        let valid = true, aligned = 0;
        for (const p of inside) {
          if (p[axis] + p[size] <= position + EPS) first.push(p);
          else if (p[axis] >= position + consumed - EPS) second.push(p);
          else { valid = false; break; }
          if (close(p[axis] + p[size], position) || close(p[axis], position + consumed)) aligned++;
        }
        if (!valid) continue;
        choices.push({ axis, size, position, consumed, first, second, aligned });
      }
    }
    choices.sort((a, b) => b.aligned - a.aligned || Math.abs(a.first.length - a.second.length) - Math.abs(b.first.length - b.second.length) || a.axis.localeCompare(b.axis) || a.position - b.position);
    for (const c of choices) {
      if (states > maxStates) break;
      const firstRegion = { ...region, [c.size]: c.position - region[c.axis] };
      const secondSize = region[c.axis] + region[c.size] - c.position - c.consumed;
      const first = solve(firstRegion, c.first); if (!first) continue;
      const second = secondSize > EPS ? solve({ ...region, [c.axis]: c.position + c.consumed, [c.size]: secondSize }, c.second) : null;
      if (secondSize > EPS && !second) continue;
      const node = { ...region, kind: 'cut', axis: c.axis, amount: c.position - region[c.axis], kerf: c.consumed, first: first.node, ...(second ? { second: second.node } : {}) };
      const candidate = result(node, first, second);
      if (!best || compare(candidate, best) < 0) best = candidate;
      if (best.count === inside.length - 1) break; // Binary cuts cannot release n parts in fewer than n−1 strokes.
    }
    memo.set(id, best); return best;
  }
  const best = solve(rectangle(root), parts, true) || baseline;
  return { root: copy(best.node), before: baseline.count, after: best.count };
}
