import { scheduleCuts } from './timber-cut-passes.js?v=0.32.3';
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
export function simplifyTimberCuts(root, kerf, { direction = 'auto', saw = 'panel', limit = 1220, maxStates = 900 } = {}) {
  const originals = new Map(), memo = new Map(), parts = [];
  const index = (node) => {
    if (node.kind === 'part') parts.push(node.part);
    const entry = result(node, node.first && index(node.first), node.second && index(node.second));
    originals.set(key(node), entry); return entry;
  };
  const baseline = index(root);
  if (baseline.count <= Math.max(0, parts.length - 1)) { const schedule = scheduleCuts(root, saw, { limit }); return { root: copy(root), before: baseline.count, after: schedule.count, splitCount: baseline.count, alignmentCost: schedule.alignmentCost }; }
  let states = 0;
  const roots = [baseline];
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
      if (isRoot) roots.push(candidate);
      if (!best || compare(candidate, best) < 0) best = candidate;
      if (best.count === inside.length - 1) break; // Binary cuts cannot release n parts in fewer than n−1 strokes.
    }
    memo.set(id, best); return best;
  }
  // Compare whole-line sweeps as well as locally efficient slicing trees.
  // Coverage favours a shared height across a row before narrow column cuts.
  // With `lines`, a straight line already cut elsewhere is reused first, so pieces that sit
  // side by side are divided in the same order and later cuts can pass through them together.
  function sweep(region, inside, bias, forced = null, lines = null) {
    if (!inside.length) return result({ ...region, kind: 'free' });
    if (inside.length === 1) { const p = inside[0]; if (close(p.x,region.x) && close(p.y,region.y) && close(p.w,region.w) && close(p.h,region.h)) return result({ ...region, kind:'part', part:p }); }
    const choices = [];
    for (const axis of ['x','y']) {
      const size = axis === 'x' ? 'w' : 'h', across = axis === 'x' ? 'y' : 'x', extent = axis === 'x' ? 'h' : 'w';
      for (const position of new Set(inside.flatMap((p) => [p[axis]+p[size],p[axis]-kerf]))) {
        if (position <= region[axis]+EPS || position >= region[axis]+region[size]-EPS) continue;
        if (forced && (forced.axis !== axis || !close(forced.amount,position-region[axis]))) continue;
        const consumed = Math.min(kerf,region[axis]+region[size]-position), first=[],second=[], intervals=[];
        let valid=true;
        for(const p of inside){
          if(p[axis]+p[size]<=position+EPS) first.push(p); else if(p[axis]>=position+consumed-EPS) second.push(p); else {valid=false;break;}
          if(close(p[axis]+p[size],position)||close(p[axis],position+consumed)) intervals.push([p[across],p[across]+p[extent]]);
        }
        if(!valid)continue;
        intervals.sort((a,b)=>a[0]-b[0]);let coverage=0,end=-Infinity;
        // A kerf-wide gap between neighbouring parts is still one straight line through the panel.
        for(const [a,b] of intervals){const from=end>-Infinity&&a-end<=kerf+EPS?end:a;coverage+=Math.max(0,b-Math.max(from,end));end=Math.max(end,b);}
        choices.push({axis,size,position,consumed,first,second,coverage:coverage/region[extent],aligned:intervals.length,clears:!first.length||!second.length});
      }
    }
    // Between equally straight lines, strip waste off the panel before dividing it.
    const lineOf = (c) => `${c.axis}:${c.position.toFixed(7)}`, order = (c) => lines?.get(lineOf(c)) ?? Infinity;
    choices.sort((a,b)=>(order(a)-order(b) || 0) || b.coverage-a.coverage || Number(b.clears)-Number(a.clears) || Number(b.axis===bias)-Number(a.axis===bias) || b.aligned-a.aligned || Math.abs(a.first.length-a.second.length)-Math.abs(b.first.length-b.second.length) || a.position-b.position);
    for(const c of choices){
      if (lines && !lines.has(lineOf(c))) lines.set(lineOf(c), lines.size);
      const a=sweep({...region,[c.size]:c.position-region[c.axis]},c.first,bias,null,lines);if(!a)continue;
      const remaining=region[c.axis]+region[c.size]-c.position-c.consumed;
      const b=remaining>EPS?sweep({...region,[c.axis]:c.position+c.consumed,[c.size]:remaining},c.second,bias,null,lines):null;if(remaining>EPS&&!b)continue;
      return result({...region,kind:'cut',axis:c.axis,amount:c.position-region[c.axis],kerf:c.consumed,first:a.node,...(b?{second:b.node}:{})},a,b);
    }
    return originals.get(key(region)) || null;
  }
  solve(rectangle(root), parts, true);
  if (maxStates > 0) {
    const starts = [...new Map(roots.filter((entry)=>entry.node.kind==='cut').map((entry)=>[`${entry.node.axis}:${entry.node.amount.toFixed(7)}`,entry.node])).values()];
    for(const start of starts.slice(0,parts.length>80?1:12)) for(const bias of ['y','x']) for(const reuse of [false,true]) {
      const entry=sweep(rectangle(root),parts,bias,start,reuse?new Map():null);if(entry)roots.push(entry);
    }
  }
  const candidates = roots.map((entry) => ({ entry, schedule: scheduleCuts(entry.node, saw, { limit }) }));
  // Equal pass counts: fewer pieces held in alignment, then shorter aligned lines, so long
  // lines are cut while the panel is still one piece.
  // Table saw: rip into strips before crosscutting (narrowest widest crosscut), then fewer fence
  // settings, then fewer pieces fed through the saw, then fewer steps.
  if (saw === 'table') candidates.sort((a, b) => a.schedule.widestCrosscut - b.schedule.widestCrosscut || a.schedule.setups - b.schedule.setups || a.schedule.feeds - b.schedule.feeds || a.schedule.count - b.schedule.count || compare(a.entry, b.entry));
  // Hybrid: fewer steps in total, then fewer pieces held in line on the panel saw, then fewer fence settings.
  else if (saw === 'hybrid') candidates.sort((a, b) => a.schedule.count - b.schedule.count || a.schedule.alignmentCost - b.schedule.alignmentCost || a.schedule.setups - b.schedule.setups || a.schedule.feeds - b.schedule.feeds || a.schedule.alignmentLength - b.schedule.alignmentLength || compare(a.entry, b.entry));
  else candidates.sort((a, b) => a.schedule.count - b.schedule.count || a.schedule.alignmentCost - b.schedule.alignmentCost || a.schedule.alignmentLength - b.schedule.alignmentLength || compare(a.entry, b.entry));
  const best = candidates[0];
  return { root: copy(best.entry.node), before: baseline.count, after: best.schedule.count, splitCount: best.entry.count, alignmentCost: best.schedule.alignmentCost };
}

// Roadmap 1.2: the same sheet (same tree of cuts, parts and offcuts in the same places)
// comes up again and again during a search. `cache` is a Map owned by one search; a
// hit returns a fresh copy of the remembered tree with this sheet's own part records,
// so callers can label and mutate it as before. The key holds every input that
// simplifyTimberCuts reads: each node's kind, rectangle, axis, amount and kerf, plus
// the options.
const treeKey = (n) => n.kind === 'cut'
  ? `C${n.axis}${n.amount.toFixed(7)}k${n.kerf.toFixed(7)}[${key(n)}](${treeKey(n.first)})(${n.second ? treeKey(n.second) : ''})`
  : `${n.kind[0]}[${key(n)}]${n.kind === 'part' ? `{${key(n.part)}}` : ''}`;
const CACHE_LIMIT = 4000;
function strip(node) {
  const result = { ...node };
  if (node.kind === 'part') result.part = { x: node.part.x, y: node.part.y, w: node.part.w, h: node.part.h };
  if (node.first) result.first = strip(node.first);
  if (node.second) result.second = strip(node.second);
  return result;
}
function rebind(node, parts) {
  const result = { ...node };
  if (node.kind === 'part') result.part = parts.get(key(node.part));
  if (node.first) result.first = rebind(node.first, parts);
  if (node.second) result.second = rebind(node.second, parts);
  return result;
}
export function cachedSimplifyTimberCuts(root, kerf, options = {}, cache = null) {
  if (!cache) return simplifyTimberCuts(root, kerf, options);
  const { direction = 'auto', saw = 'panel', limit = 1220, maxStates = 900 } = options;
  const id = `${kerf}|${direction}|${saw}|${limit}|${maxStates}|${treeKey(root)}`;
  const parts = new Map();
  (function collect(n) { if (n.kind === 'part') parts.set(key(n.part), n.part); if (n.first) collect(n.first); if (n.second) collect(n.second); })(root);
  const hit = cache.get(id);
  if (hit) { cache.hits = (cache.hits || 0) + 1; return { ...hit, root: rebind(hit.root, parts) }; }
  const fresh = simplifyTimberCuts(root, kerf, options);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(id, { ...fresh, root: strip(fresh.root) });
  return fresh;
}
